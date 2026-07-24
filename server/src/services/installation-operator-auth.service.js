'use strict';

const crypto = require('crypto');
const db = require('../../models');
const operatorDirectory = require('./installation-operator-directory.service');

const SESSION_TTL_SECONDS = 60 * 30;
const TOKEN_KIND = 'installation-operator';
const authorities = new WeakSet();

function authorityError() {
  const error = new Error('Сессия оператора недействительна');
  error.code = 'INSTALLATION_OPERATOR_SESSION_INVALID';
  error.statusCode = 401;
  return error;
}

function mintAuthority({
  authMode,
  credentialVersion,
  expiresAt,
  operatorId,
  sessionId,
  username,
}) {
  const authority = Object.freeze({
    authMode,
    credentialVersion,
    expiresAt: new Date(expiresAt).toISOString(),
    operatorId,
    sessionId,
    username,
  });
  authorities.add(authority);
  return authority;
}

function assertAuthority(operator) {
  if (!operator || !Object.isFrozen(operator) || !authorities.has(operator)) {
    throw authorityError();
  }
  return operator;
}

function envEnabled(name) {
  return ['1', 'true', 'yes', 'on'].includes(
    String(process.env[name] || '')
      .trim()
      .toLowerCase(),
  );
}

function isManagementEnabled() {
  return envEnabled('INSTALLATION_MANAGEMENT_ENABLED');
}

function isProvisioningEnabled() {
  return envEnabled('INSTALLATION_PROVISIONING_ENABLED');
}

function isEnabled() {
  return isManagementEnabled() || isProvisioningEnabled();
}

function assertManagementEnabled() {
  if (isManagementEnabled()) return;
  const error = new Error('Управление организациями и клубами отключено');
  error.code = 'INSTALLATION_MANAGEMENT_DISABLED';
  error.statusCode = 404;
  throw error;
}

function assertProvisioningEnabled() {
  if (isProvisioningEnabled()) return;
  const error = new Error('Создание организаций отключено');
  error.code = 'INSTALLATION_PROVISIONING_DISABLED';
  error.statusCode = 404;
  throw error;
}

function disabledError() {
  const error = new Error('Installation provisioning is disabled');
  error.code = 'INSTALLATION_PROVISIONING_DISABLED';
  error.statusCode = 404;
  return error;
}

function configurationError() {
  const error = new Error('Installation operator login is unavailable');
  error.code = 'INSTALLATION_OPERATOR_CONFIGURATION_INVALID';
  error.statusCode = 503;
  return error;
}

function credentialError() {
  const error = new Error('Неверный логин или пароль оператора');
  error.code = 'INSTALLATION_OPERATOR_CREDENTIALS_INVALID';
  error.statusCode = 401;
  return error;
}

function sessionSigningConfiguration() {
  if (!isEnabled()) {
    throw disabledError();
  }

  const secret = String(process.env.INSTALLATION_OPERATOR_SECRET || '');
  if (secret.length < 32) throw configurationError();
  return { secret };
}

function loginCredentialConfiguration() {
  const signing = sessionSigningConfiguration();
  try {
    return { ...signing, directory: operatorDirectory.directoryConfiguration() };
  } catch (_error) {
    throw configurationError();
  }
}

function safeEqual(left, right) {
  const leftDigest = crypto.createHash('sha256').update(String(left)).digest();
  const rightDigest = crypto.createHash('sha256').update(String(right)).digest();
  return crypto.timingSafeEqual(leftDigest, rightDigest);
}

function encode(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function signSession(identity, sessionId, secret, { expiresAt, issuedAt }) {
  const issuedAtSeconds = Math.floor(new Date(issuedAt).getTime() / 1000);
  const expiresAtSeconds = Math.floor(new Date(expiresAt).getTime() / 1000);
  const header = encode({ alg: 'HS256', typ: 'JWT' });
  const body = encode({
    exp: expiresAtSeconds,
    cv: identity.credentialVersion,
    iat: issuedAtSeconds,
    kind: TOKEN_KIND,
    mode: identity.authMode,
    oid: identity.operatorId,
    sid: sessionId,
    username: identity.username,
  });
  const signature = crypto
    .createHmac('sha256', secret)
    .update(`${header}.${body}`)
    .digest('base64url');
  return `${header}.${body}.${signature}`;
}

async function authenticateCredentials({ password, username }) {
  try {
    loginCredentialConfiguration();
    const identity = await operatorDirectory.authenticateCredentials({
      password,
      username,
    });
    if (!identity) throw credentialError();
    return identity;
  } catch (_error) {
    if (_error?.code === 'INSTALLATION_PROVISIONING_DISABLED') throw _error;
    if (_error?.code === 'INSTALLATION_OPERATOR_CREDENTIALS_INVALID') throw _error;
    if (_error?.code === 'INSTALLATION_OPERATOR_CONFIGURATION_INVALID') {
      throw configurationError();
    }
    throw credentialError();
  }
}

async function issueSession(identity, options = {}) {
  const configured = sessionSigningConfiguration();
  const sessionId = crypto.randomBytes(16).toString('hex');
  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  const issuedAtSeconds = Math.floor(now.getTime() / 1000);
  const issuedAt = new Date(issuedAtSeconds * 1000);
  const expiresAt = new Date(
    (issuedAtSeconds + SESSION_TTL_SECONDS) * 1000,
  );
  await db.InstallationOperatorSession.create({
    authMode: identity.authMode,
    credentialVersion: identity.credentialVersion,
    expiresAt,
    operatorId: identity.operatorId,
    sessionId,
    twoFactorVerifiedAt: options.twoFactorVerifiedAt || null,
    username: identity.username,
  }, { transaction: options.transaction });
  return {
    expiresAt,
    token: signSession(identity, sessionId, configured.secret, {
      expiresAt,
      issuedAt,
    }),
  };
}

async function createSession(credentials, options = {}) {
  return issueSession(await authenticateCredentials(credentials), options);
}

async function verifySession(token) {
  const configured = sessionSigningConfiguration();
  const [header, body, signature] = String(token || '').split('.');
  if (!header || !body || !signature) return null;
  const expected = crypto
    .createHmac('sha256', configured.secret)
    .update(`${header}.${body}`)
    .digest('base64url');
  if (!safeEqual(signature, expected)) return null;

  try {
    const parsedHeader = JSON.parse(Buffer.from(header, 'base64url').toString('utf8'));
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (
      parsedHeader.alg !== 'HS256' ||
      parsedHeader.typ !== 'JWT' ||
      payload.kind !== TOKEN_KIND ||
      !['legacy', 'static-directory'].includes(payload.mode) ||
      !Number.isSafeInteger(payload.cv) ||
      payload.cv <= 0 ||
      !/^[a-f0-9]{32}$/u.test(String(payload.sid || '')) ||
      !Number.isFinite(payload.exp) ||
      payload.exp <= Math.floor(Date.now() / 1000)
    ) {
      return null;
    }
    const session = await db.InstallationOperatorSession.findOne({
      where: { sessionId: payload.sid },
    });
    const currentIdentity = operatorDirectory.revalidateIdentity({
      authMode: session?.authMode,
      credentialVersion: session?.credentialVersion,
      operatorId: session?.operatorId || null,
      username: session?.username,
    });
    if (
      !session ||
      !currentIdentity ||
      session.revokedAt ||
      payload.mode !== session.authMode ||
      payload.cv !== session.credentialVersion ||
      (payload.oid || null) !== (session.operatorId || null) ||
      payload.username !== session.username ||
      new Date(session.expiresAt).getTime() <= Date.now() ||
      Math.abs(new Date(session.expiresAt).getTime() - payload.exp * 1000) > 1000
    ) {
      return null;
    }
    return mintAuthority({
      ...currentIdentity,
      expiresAt: session.expiresAt,
      sessionId: payload.sid,
    });
  } catch {
    return null;
  }
}

async function lockSessionAuthority(operator, transaction) {
  const authority = assertAuthority(operator);
  if (!transaction) throw new TypeError('Installation operator lock requires a transaction');
  const session = await db.InstallationOperatorSession.findOne({
    lock: transaction.LOCK.UPDATE,
    transaction,
    where: {
      sessionId: authority.sessionId,
    },
  });
  if (
    !session ||
    session.revokedAt ||
    new Date(session.expiresAt).getTime() <= Date.now() ||
    new Date(session.expiresAt).toISOString() !== authority.expiresAt
  ) {
    throw authorityError();
  }
  const currentIdentity = operatorDirectory.revalidateIdentity({
    authMode: session.authMode,
    credentialVersion: session.credentialVersion,
    operatorId: session.operatorId || null,
    username: session.username,
  });
  if (
      !currentIdentity ||
      currentIdentity.authMode !== authority.authMode ||
      currentIdentity.credentialVersion !== authority.credentialVersion ||
      currentIdentity.operatorId !== authority.operatorId
  ) {
      throw authorityError();
  }
  if (currentIdentity.username === authority.username) return authority;
  return mintAuthority({
    ...currentIdentity,
    expiresAt: session.expiresAt,
    sessionId: session.sessionId,
  });
}

async function lockSessionById(sessionId, transaction) {
  if (!transaction) throw new TypeError('Installation operator lock requires a transaction');
  const session = await db.InstallationOperatorSession.findOne({
    lock: transaction.LOCK.UPDATE,
    transaction,
    where: { sessionId: String(sessionId || '') },
  });
  if (
    !session ||
    session.revokedAt ||
    new Date(session.expiresAt).getTime() <= Date.now()
  ) {
    throw authorityError();
  }
  const currentIdentity = operatorDirectory.revalidateIdentity({
    authMode: session.authMode,
    credentialVersion: session.credentialVersion,
    operatorId: session.operatorId || null,
    username: session.username,
  });
  if (!currentIdentity) throw authorityError();
  return mintAuthority({
    ...currentIdentity,
    expiresAt: session.expiresAt,
    sessionId: session.sessionId,
  });
}

async function revalidateSessionAuthority(operator) {
  return db.sequelize.transaction((transaction) =>
    lockSessionAuthority(operator, transaction));
}

async function revokeSession(operator) {
  return db.sequelize.transaction(async (transaction) => {
    const authority = await lockSessionAuthority(operator, transaction);
    const session = await db.InstallationOperatorSession.findOne({
      lock: transaction.LOCK.UPDATE,
      transaction,
      where: { sessionId: authority.sessionId },
    });
    await session.update({ revokedAt: new Date() }, { transaction });
    return true;
  });
}

function getPublicStatus() {
  if (!isEnabled()) {
    return { enabled: false, managementEnabled: false, provisioningEnabled: false };
  }
  try {
    loginCredentialConfiguration();
    return {
      enabled: true,
      managementEnabled: isManagementEnabled(),
      provisioningEnabled: isProvisioningEnabled(),
    };
  } catch (error) {
    if (error.code === 'INSTALLATION_OPERATOR_CONFIGURATION_INVALID') {
      return { enabled: false, managementEnabled: false, provisioningEnabled: false };
    }
    throw error;
  }
}

module.exports = {
  assertManagementEnabled,
  assertProvisioningEnabled,
  authenticateCredentials,
  createSession,
  getPublicStatus,
  issueSession,
  isEnabled,
  isManagementEnabled,
  isProvisioningEnabled,
  lockSessionById,
  lockSessionAuthority,
  revalidateSessionAuthority,
  revokeSession,
  verifySession,
};
