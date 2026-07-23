'use strict';

const crypto = require('node:crypto');
const db = require('../../models');
const normalSessions = require('./normal-user-session.service');
const auditService = require('./audit.service');

const TOKEN_PREFIX = 'setly_r1_';
const TOKEN_BYTES = 32;
const TOKEN_TTL_MS = 30 * 60 * 1000;
const TOKEN_PATTERN = new RegExp(`^${TOKEN_PREFIX}[A-Za-z0-9_-]{43}$`, 'u');
const REQUEST_STATUSES = ['created', 'issued', 'used', 'revoked', 'expired'];
const PUBLIC_FAILURE = Object.freeze({ available: false });

function recoveryError(message, statusCode = 400, code = 'ACCOUNT_RECOVERY_INVALID') {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function digestToken(token) { return crypto.createHash('sha256').update(token, 'utf8').digest('hex'); }
function issueRawToken() { return `${TOKEN_PREFIX}${crypto.randomBytes(TOKEN_BYTES).toString('base64url')}`; }
function safeEmail(account) {
  const email = String(account?.email || '');
  if (/[*•]|@f9-rc\.test$/u.test(email)) return `${account?.role || 'user'}@example.test`;
  return email;
}

async function auditRecovery(entry, transaction) {
  return auditService.recordInstallation({
    action: entry.action,
    entityType: 'account_recovery',
    entityId: entry.entityId || null,
    method: entry.method || 'POST',
    path: entry.path || '/api/account-recovery',
    statusCode: entry.result === 'failure' ? 400 : 200,
    organizationId: Number(entry.organizationId),
    clubId: Number(entry.clubId),
    summary: entry.summary,
    metadata: {
      actor: entry.actor || null,
      accountId: entry.accountId || null,
      result: entry.result || 'success',
      at: new Date().toISOString(),
    },
  }, transaction);
}

async function assertScope(organizationId, clubId, transaction) {
  const club = await db.Club.findOne({ where: { id: Number(clubId), organizationId: Number(organizationId), status: 'active' }, transaction });
  if (!club) throw recoveryError('Клуб не найден', 404, 'ACCOUNT_RECOVERY_SCOPE_NOT_FOUND');
  return club;
}

async function findMembership(accountId, organizationId, clubId, transaction, lock = false) {
  return db.Membership.findOne({
    where: { accountId: Number(accountId), organizationId: Number(organizationId), status: 'active' },
    include: [{ model: db.MembershipClubAccess, required: false, where: { clubId: Number(clubId), status: 'active' } }],
    transaction,
    lock: lock ? transaction.LOCK.UPDATE : undefined,
  });
}

function effectiveRole(membership) {
  return membership?.MembershipClubAccesses?.[0]?.roleOverride || membership?.role || null;
}

async function findScopedAccount(accountId, organizationId, clubId, transaction, lock = false) {
  const membership = await findMembership(accountId, organizationId, clubId, transaction, lock);
  if (!membership || !membership.MembershipClubAccesses?.length && effectiveRole(membership) !== 'owner') return null;
  const account = await db.Account.findOne({ where: { id: Number(accountId), status: 'active' }, include: [{ model: db.Staff, required: false }], transaction, lock: lock ? transaction.LOCK.UPDATE : undefined });
  return account ? { account, membership, role: account.role === 'owner' ? 'owner' : effectiveRole(membership) } : null;
}

async function assertActor(actor, target, organizationId, clubId, transaction) {
  if (actor?.type === 'operator') return;
  if (actor?.type !== 'owner' || Number(actor.accountId) === Number(target.account.id) || target.role === 'owner' || target.account.role === 'owner') {
    throw recoveryError('Владелец может восстанавливать только другого сотрудника своего клуба', 403, 'ACCOUNT_RECOVERY_OWNER_SCOPE');
  }
  const owner = await findScopedAccount(actor.accountId, organizationId, clubId, transaction);
  if (!owner || owner.role !== 'owner') throw recoveryError('Недостаточно прав для восстановления этого аккаунта', 403, 'ACCOUNT_RECOVERY_OWNER_REQUIRED');
}

function actorLabel(actor) { return actor?.type === 'operator' ? `operator:${actor.username || 'operator'}` : `account:${actor?.accountId}`; }

async function listAccounts(organizationId, clubId) {
  await assertScope(organizationId, clubId);
  const rows = await db.Membership.findAll({ where: { organizationId: Number(organizationId), status: 'active' }, include: [{ model: db.Account, attributes: ['id', 'email', 'role', 'status'], where: { status: 'active' }, include: [{ model: db.Staff, attributes: ['id', 'name', 'phone'], required: false }] }, { model: db.MembershipClubAccess, required: false, where: { clubId: Number(clubId), status: 'active' } }] });
  return rows.filter((row) => row.role === 'owner' || row.MembershipClubAccesses?.length).map((row) => ({ id: row.Account.id, email: safeEmail(row.Account), role: row.Account.role === 'owner' ? 'owner' : (row.MembershipClubAccesses?.[0]?.roleOverride || row.role), displayName: row.Account.Staff?.name || safeEmail(row.Account), staffId: row.Account.Staff?.id || null }));
}

async function organizationForOwner(accountId) {
  const membership = await db.Membership.findOne({ where: { accountId: Number(accountId), status: 'active' }, order: [['id', 'ASC']] });
  if (!membership) throw recoveryError('Аккаунт не привязан к организации', 403, 'ACCOUNT_RECOVERY_OWNER_SCOPE');
  return Number(membership.organizationId);
}

async function getAccount(accountId, organizationId, clubId) {
  const scoped = await findScopedAccount(accountId, organizationId, clubId);
  if (!scoped) throw recoveryError('Аккаунт не найден', 404, 'ACCOUNT_RECOVERY_ACCOUNT_NOT_FOUND');
  return { id: scoped.account.id, email: safeEmail(scoped.account), role: scoped.role, displayName: scoped.account.Staff?.name || safeEmail(scoped.account), phone: scoped.account.Staff?.phone || null };
}

async function updateAccountProfile(accountId, organizationId, clubId, input, operator) {
  const transaction = await db.sequelize.transaction();
  try {
    await assertScope(organizationId, clubId, transaction);
    const scoped = await findScopedAccount(accountId, organizationId, clubId, transaction, true);
    if (!scoped) throw recoveryError('Аккаунт не найден', 404, 'ACCOUNT_RECOVERY_ACCOUNT_NOT_FOUND');
    const email = String(input.email || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) throw recoveryError('Укажите корректный email', 400, 'ACCOUNT_RECOVERY_PROFILE_INVALID');
    await scoped.account.update({ email }, { transaction });
    if (scoped.account.Staff) await scoped.account.Staff.update({ name: String(input.displayName || '').trim() || scoped.account.Staff.name, phone: input.phone === undefined ? scoped.account.Staff.phone : String(input.phone || '').trim() || null }, { transaction });
    await auditRecovery({ action: 'account_recovery.profile_updated', entityId: accountId, accountId, organizationId, clubId, actor: actorLabel({ type: 'operator', username: operator?.username }), summary: 'Account recovery profile updated' }, transaction);
    await transaction.commit();
    return getAccount(accountId, organizationId, clubId);
  } catch (error) { await transaction.rollback(); throw error; }
}

async function listRequests(organizationId, clubId, accountId) {
  const where = { organizationId: Number(organizationId), clubId: Number(clubId) };
  if (accountId) where.accountId = Number(accountId);
  const rows = await db.AccountRecoveryRequest.findAll({ where, include: [{ model: db.Account, as: 'account', attributes: ['id', 'email', 'role'], include: [{ model: db.Staff, attributes: ['name'], required: false }] }, { model: db.AccountRecoveryToken, as: 'tokens', attributes: ['expiresAt', 'consumedAt', 'revokedAt'], required: false }], order: [['createdAt', 'DESC']] });
  return rows.map((row) => {
    const hasExpiredToken = row.status === 'issued' && row.tokens?.some((token) => !token.consumedAt && !token.revokedAt && new Date(token.expiresAt) <= new Date());
    return { id: row.id, account: row.account ? { id: row.account.id, email: safeEmail(row.account), role: row.account.role, displayName: row.account.Staff?.name || safeEmail(row.account) } : null, status: hasExpiredToken ? 'expired' : row.status, initiatedBy: row.initiatedBy, createdAt: row.createdAt };
  });
}

async function listOwnerRequests(organizationId, clubId, accountId, actor) {
  const target = await findScopedAccount(accountId, organizationId, clubId);
  if (!target) throw recoveryError('Аккаунт не найден в этом клубе', 404, 'ACCOUNT_RECOVERY_ACCOUNT_NOT_FOUND');
  await assertActor(actor, target, organizationId, clubId);
  return listRequests(organizationId, clubId, accountId);
}

async function createRequest(organizationId, clubId, input, actor) {
  const transaction = await db.sequelize.transaction();
  try {
    await assertScope(organizationId, clubId, transaction);
    const target = await findScopedAccount(input.accountId, organizationId, clubId, transaction, true);
    if (!target) throw recoveryError('Аккаунт не найден в этом клубе', 404, 'ACCOUNT_RECOVERY_ACCOUNT_NOT_FOUND');
    await assertActor(actor, target, organizationId, clubId, transaction);
    const row = await db.AccountRecoveryRequest.create({ organizationId: Number(organizationId), clubId: Number(clubId), accountId: target.account.id, status: 'created', initiatedBy: actorLabel(actor) }, { transaction });
    await auditRecovery({ action: 'account_recovery.request_created', entityId: row.id, accountId: target.account.id, organizationId, clubId, actor: actorLabel(actor), summary: 'Recovery request created' }, transaction);
    await transaction.commit();
    return { id: row.id, status: row.status };
  } catch (error) { await transaction.rollback(); throw error; }
}

async function issueToken(requestId, actor, organizationId, clubId) {
  const transaction = await db.sequelize.transaction();
  try {
    const request = await db.AccountRecoveryRequest.findByPk(requestId, { transaction, lock: transaction.LOCK.UPDATE });
    if (!request || Number(request.organizationId) !== Number(organizationId) || Number(request.clubId) !== Number(clubId)) throw recoveryError('Запрос восстановления не найден', 404, 'ACCOUNT_RECOVERY_REQUEST_NOT_FOUND');
    if (!['created', 'issued'].includes(request.status)) throw recoveryError('Запрос больше нельзя выдать', 409, 'ACCOUNT_RECOVERY_NOT_READY');
    const target = await findScopedAccount(request.accountId, request.organizationId, request.clubId, transaction, true);
    if (!target) throw recoveryError('Аккаунт больше недоступен', 409, 'ACCOUNT_RECOVERY_ACCOUNT_NOT_FOUND');
    await assertActor(actor, target, request.organizationId, request.clubId, transaction);
    await db.AccountRecoveryToken.update({ revokedAt: new Date(), revokeReason: 'superseded' }, { where: { accountId: request.accountId, consumedAt: null, revokedAt: null }, transaction });
    const rawToken = issueRawToken();
    const issuedAt = new Date();
    await db.AccountRecoveryToken.create({ requestId: request.id, accountId: request.accountId, tokenDigest: digestToken(rawToken), expiresAt: new Date(issuedAt.getTime() + TOKEN_TTL_MS), issuedAt, issuedBy: actorLabel(actor) }, { transaction });
    await request.update({ status: 'issued' }, { transaction });
    await auditRecovery({ action: 'account_recovery.token_issued', entityId: request.id, accountId: request.accountId, organizationId: request.organizationId, clubId: request.clubId, actor: actorLabel(actor), summary: 'One-time password reset link issued' }, transaction);
    await transaction.commit();
    const base = String(process.env.PUBLIC_APP_URL || process.env.INSTALLATION_ACTIVATION_BASE_URL || '').replace(/\/$/u, '');
    return { requestId: request.id, expiresAt: new Date(issuedAt.getTime() + TOKEN_TTL_MS).toISOString(), resetLink: `${base}/reset-password#token=${rawToken}` };
  } catch (error) { await transaction.rollback(); throw error; }
}

async function revokeRequest(requestId, actor, organizationId, clubId) {
  const transaction = await db.sequelize.transaction();
  try {
    const request = await db.AccountRecoveryRequest.findByPk(requestId, { transaction, lock: transaction.LOCK.UPDATE });
    if (!request || Number(request.organizationId) !== Number(organizationId) || Number(request.clubId) !== Number(clubId)) throw recoveryError('Запрос восстановления не найден', 404, 'ACCOUNT_RECOVERY_REQUEST_NOT_FOUND');
    if (!['created', 'issued'].includes(request.status)) throw recoveryError('Запрос уже завершён и не может быть отозван', 409, 'ACCOUNT_RECOVERY_NOT_ACTIVE');
    const target = await findScopedAccount(request.accountId, request.organizationId, request.clubId, transaction, true);
    if (!target) throw recoveryError('Аккаунт больше недоступен', 409, 'ACCOUNT_RECOVERY_ACCOUNT_NOT_FOUND');
    await assertActor(actor, target, request.organizationId, request.clubId, transaction);
    await db.AccountRecoveryToken.update({ revokedAt: new Date(), revokeReason: 'operator_revoked' }, { where: { requestId: request.id, consumedAt: null, revokedAt: null }, transaction });
    await request.update({ status: 'revoked' }, { transaction });
    await auditRecovery({ action: 'account_recovery.request_revoked', entityId: request.id, accountId: request.accountId, organizationId: request.organizationId, clubId: request.clubId, actor: actorLabel(actor), summary: 'Recovery request revoked' }, transaction);
    await transaction.commit();
    return { success: true, status: 'revoked' };
  } catch (error) { await transaction.rollback(); throw error; }
}

async function inspectToken(rawToken) {
  if (!TOKEN_PATTERN.test(String(rawToken || ''))) return PUBLIC_FAILURE;
  const token = await db.AccountRecoveryToken.unscoped().findOne({ where: { tokenDigest: digestToken(rawToken) }, include: [{ model: db.Account, attributes: ['id', 'status'] }, { model: db.AccountRecoveryRequest, attributes: ['status'] }] });
  return { available: Boolean(token && token.Account?.status === 'active' && token.AccountRecoveryRequest?.status === 'issued' && !token.consumedAt && !token.revokedAt && new Date(token.expiresAt) > new Date()) };
}

async function resetPassword(rawToken, newPassword) {
  if (!TOKEN_PATTERN.test(String(rawToken || ''))) throw recoveryError('Ссылка недействительна или устарела', 400, 'ACCOUNT_RECOVERY_TOKEN_INVALID');
  const transaction = await db.sequelize.transaction();
  try {
    const token = await db.AccountRecoveryToken.unscoped().findOne({ where: { tokenDigest: digestToken(rawToken) }, transaction, lock: transaction.LOCK.UPDATE, include: [{ model: db.Account, attributes: ['id', 'status'] }, { model: db.AccountRecoveryRequest, attributes: ['id', 'status', 'organizationId', 'clubId', 'accountId'] }] });
    if (!token || token.Account?.status !== 'active' || token.AccountRecoveryRequest?.status !== 'issued' || token.consumedAt || token.revokedAt) throw recoveryError('Ссылка недействительна или устарела', 400, 'ACCOUNT_RECOVERY_TOKEN_INVALID');
    if (new Date(token.expiresAt) <= new Date()) { await token.AccountRecoveryRequest.update({ status: 'expired' }, { transaction }); await transaction.commit(); throw recoveryError('Ссылка недействительна или устарела', 400, 'ACCOUNT_RECOVERY_TOKEN_INVALID'); }
    const passwordHashing = require('./password-hashing.service');
    const passwordHash = await passwordHashing.hashPassword(newPassword);
    await db.Account.update({ passwordHash }, { where: { id: token.accountId, status: 'active' }, transaction });
    await normalSessions.revokeAllForAccount(token.accountId, normalSessions.REVOCATION_REASONS.PASSWORD_CHANGED, { transaction });
    await token.update({ consumedAt: new Date() }, { transaction });
    await token.AccountRecoveryRequest.update({ status: 'used' }, { transaction });
    await auditRecovery({ action: 'account_recovery.password_reset', entityId: token.requestId, accountId: token.accountId, organizationId: token.AccountRecoveryRequest.organizationId, clubId: token.AccountRecoveryRequest.clubId, actor: 'public-reset-link', summary: 'One-time password reset completed' }, transaction);
    await transaction.commit();
    return { success: true, accountId: token.accountId };
  } catch (error) { if (!transaction.finished) await transaction.rollback(); throw error; }
}

module.exports = { TOKEN_PREFIX, TOKEN_BYTES, TOKEN_TTL_MS, TOKEN_PATTERN, digestToken, listAccounts, organizationForOwner, getAccount, updateAccountProfile, listRequests, listOwnerRequests, createRequest, issueToken, revokeRequest, inspectToken, resetPassword, _private: { issueRawToken, safeEmail } };
