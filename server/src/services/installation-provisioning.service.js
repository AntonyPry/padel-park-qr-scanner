'use strict';

const crypto = require('crypto');
const db = require('../../models');
const authService = require('./auth.service');
const accountLifecycle = require('./account-lifecycle.service');
const accountMetadata = require('./account-metadata.service');
const auditService = require('./audit.service');
const {
  assertTenantFoundationInitialized,
  invalidateTenantFoundationGateCache,
} = require('./tenant-foundation.service');
const {
  isTenantEnforcementEnabled,
} = require('../tenant-context/capabilities');

const ACTIVATION_TTL_MS = 24 * 60 * 60 * 1000;
const ACTIVATION_PATH = '/activate-owner';
const CYRILLIC_SLUG_MAP = Object.freeze({
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z',
  и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r',
  с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh',
  щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
});

function provisioningError(message, statusCode, code, details) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  if (details) error.details = details;
  return error;
}

function assertEnabledFoundation() {
  if (!isTenantEnforcementEnabled()) {
    throw provisioningError(
      'Создание организаций требует включённой tenant-защиты',
      503,
      'TENANT_ENFORCEMENT_REQUIRED',
    );
  }
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function canonicalSlug(value, fallback) {
  const transliterated = Array.from(String(value).trim().toLowerCase())
    .map((character) => CYRILLIC_SLUG_MAP[character] ?? character)
    .join('');
  const slug = transliterated
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/gu, '')
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 150)
    .replace(/-+$/gu, '');
  return slug || fallback;
}

function allocateClubSlugs(clubs) {
  const used = new Set();
  return clubs.map((club) => {
    const base = canonicalSlug(club.name, 'club');
    let slug = base;
    let suffix = 2;
    while (used.has(slug)) {
      slug = `${base}-${suffix}`;
      suffix += 1;
    }
    used.add(slug);
    return slug;
  });
}

async function allocateOrganizationSlug(name, transaction) {
  const base = canonicalSlug(name, 'organization');
  const organizations = await db.Organization.findAll({
    attributes: ['slug'],
    lock: transaction.LOCK.UPDATE,
    transaction,
    where: { slug: { [db.Sequelize.Op.like]: `${base}%` } },
  });
  const used = new Set(organizations.map((organization) => organization.slug));
  if (!used.has(base)) return base;
  let suffix = 2;
  while (used.has(`${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
}

function stablePayload(payload) {
  return JSON.stringify({
    clubs: payload.clubs.map((club) => ({
      name: club.name.trim(),
      timezone: club.timezone.trim(),
    })),
    organization: {
      name: payload.organization.name.trim(),
    },
    owner: {
      email: payload.owner.email.trim().toLowerCase(),
      name: payload.owner.name.trim(),
      phone: canonicalRussianPhone(payload.owner.phone),
    },
  });
}

function canonicalRussianPhone(value) {
  const digits = String(value || '').replace(/\D/gu, '');
  const national = digits.length > 10 && /^[78]/u.test(digits)
    ? digits.slice(1, 11)
    : digits.slice(0, 10);
  return /^[3-9]\d{9}$/u.test(national) ? `+7${national}` : String(value || '').trim();
}

function activationBaseUrl() {
  return String(
    process.env.INSTALLATION_ACTIVATION_BASE_URL ||
      process.env.PUBLIC_APP_URL ||
      'http://127.0.0.1:5173',
  ).replace(/\/$/u, '');
}

function issueActivationSecret() {
  const token = crypto.randomBytes(32).toString('base64url');
  return {
    expiresAt: new Date(Date.now() + ACTIVATION_TTL_MS),
    link: `${activationBaseUrl()}${ACTIVATION_PATH}#token=${encodeURIComponent(token)}`,
    token,
    tokenHash: sha256(token),
  };
}

function activationState(token, now = new Date()) {
  if (token.consumedAt) return 'consumed';
  if (token.invalidatedAt) return 'invalidated';
  if (new Date(token.expiresAt).getTime() <= now.getTime()) return 'expired';
  return 'pending';
}

function ownerAuthorityError() {
  return provisioningError(
    'Полномочия владельца для этой организации недоступны',
    410,
    'OWNER_AUTHORITY_UNAVAILABLE',
  );
}

async function lockOwnerAuthorityGraph(organizationId, accountId, transaction) {
  const organization = await db.Organization.findByPk(organizationId, {
    lock: transaction.LOCK.UPDATE,
    transaction,
  });
  const account = await db.Account.findByPk(accountId, {
    lock: transaction.LOCK.UPDATE,
    transaction,
  });
  const membership = await db.Membership.findOne({
    lock: transaction.LOCK.UPDATE,
    transaction,
    where: { accountId, organizationId, role: 'owner', status: 'active' },
  });
  const staffId = account?.staffId;
  const staff = staffId
    ? await db.Staff.findByPk(staffId, { lock: transaction.LOCK.UPDATE, transaction })
    : null;
  if (
    !organization || organization.status !== 'active' ||
    !account || account.status !== 'active' || account.role !== 'owner' ||
    !membership || Number(membership.staffId) !== Number(staffId) ||
    !staff || staff.status !== 'active' || Number(staff.organizationId) !== Number(organizationId)
  ) {
    throw ownerAuthorityError();
  }
  return { account, membership, organization, staff };
}

async function lockOperationAuthority(operation, transaction) {
  const authority = await lockOwnerAuthorityGraph(
    operation.organizationId,
    operation.ownerAccountId,
    transaction,
  );
  const [activationToken, auditLog] = await Promise.all([
    db.OwnerActivationToken.findByPk(operation.activationTokenId, {
      lock: transaction.LOCK.UPDATE,
      transaction,
    }),
    db.AuditLog.findByPk(operation.auditLogId, {
      lock: transaction.LOCK.UPDATE,
      transaction,
    }),
  ]);
  if (
    !activationToken ||
    Number(activationToken.organizationId) !== Number(operation.organizationId) ||
    Number(activationToken.accountId) !== Number(operation.ownerAccountId) ||
    !auditLog || Number(auditLog.organizationId) !== Number(operation.organizationId)
  ) {
    throw ownerAuthorityError();
  }
  return { ...authority, activationToken, auditLog };
}

async function loadOperationResult(operation, { replayed, transaction }) {
  const [organization, clubs, account, activationToken, auditLog] = await Promise.all([
    db.Organization.findByPk(operation.organizationId, { transaction }),
    db.Club.findAll({
      order: [['id', 'ASC']],
      transaction,
      where: { organizationId: operation.organizationId },
    }),
    db.Account.findByPk(operation.ownerAccountId, {
      include: [{ model: db.Staff }],
      transaction,
    }),
    db.OwnerActivationToken.findByPk(operation.activationTokenId, { transaction }),
    db.AuditLog.findByPk(operation.auditLogId, { transaction }),
  ]);
  return {
    activation: {
      expiresAt: activationToken.expiresAt,
      link: null,
      state: activationState(activationToken),
    },
    audit: {
      action: auditLog.action,
      id: auditLog.id,
      createdAt: auditLog.createdAt,
    },
    clubs: clubs.map((club) => ({
      id: club.id,
      name: club.name,
      slug: club.slug,
      timezone: club.timezone,
    })),
    idempotency: {
      operationId: operation.id,
      replayed,
    },
    organization: {
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
    },
    owner: {
      accountId: account.id,
      email: account.email,
      name: account.Staff?.name || account.email,
    },
  };
}

async function createAudit(
  {
    action,
    entityId,
    metadata,
    organizationId,
    path = '/api/installation/provisioning/organizations',
    statusCode = 201,
    summary,
  },
  transaction,
) {
  return auditService.recordInstallation(
    {
      action,
      entityId: String(entityId),
      entityType: 'organization',
      metadata,
      method: 'POST',
      organizationId,
      path,
      statusCode,
      summary,
    },
    transaction,
  );
}

async function assertUniqueInput(payload, transaction) {
  const [organization, account] = await Promise.all([
    db.Organization.findOne({
      lock: transaction.LOCK.UPDATE,
      transaction,
      where: { name: payload.organization.name },
    }),
    db.Account.findOne({
      lock: transaction.LOCK.UPDATE,
      transaction,
      where: { email: payload.owner.email },
    }),
  ]);
  if (organization) {
    throw provisioningError(
      'Организация с таким названием уже существует',
      409,
      'ORGANIZATION_NAME_EXISTS',
    );
  }
  if (account) {
    throw provisioningError(
      'Аккаунт с таким email уже существует',
      409,
      'OWNER_EMAIL_EXISTS',
    );
  }
}

async function provisionOrganization(input, operator, options = {}) {
  assertEnabledFoundation();
  const normalized = JSON.parse(stablePayload(input));
  const idempotencyKeyHash = sha256(input.idempotencyKey);
  const payloadHash = sha256(stablePayload(input));
  let result;

  try {
    result = await db.sequelize.transaction(async (transaction) => {
      await assertTenantFoundationInitialized({ lock: true, transaction });
      const previous = await db.InstallationProvisioningOperation.findOne({
        lock: transaction.LOCK.UPDATE,
        transaction,
        where: { idempotencyKeyHash },
      });
      if (previous) {
        if (previous.payloadHash !== payloadHash) {
          throw provisioningError(
            'Ключ повторной отправки уже использован с другими данными',
            409,
            'IDEMPOTENCY_PAYLOAD_MISMATCH',
          );
        }
        return loadOperationResult(previous, { replayed: true, transaction });
      }

      await assertUniqueInput(normalized, transaction);
      const organizationSlug = await allocateOrganizationSlug(
        normalized.organization.name,
        transaction,
      );
      const organization = await db.Organization.create(
        { ...normalized.organization, slug: organizationSlug, status: 'active' },
        { transaction },
      );
      if (options.failAfter === 'organization') throw new Error('Forced failure after Organization');

      const clubs = [];
      const clubSlugs = allocateClubSlugs(normalized.clubs);
      for (const [index, club] of normalized.clubs.entries()) {
        clubs.push(await db.Club.create(
          {
            ...club,
            organizationId: organization.id,
            slug: clubSlugs[index],
            status: 'active',
          },
          { transaction },
        ));
      }
      if (options.failAfter === 'clubs') throw new Error('Forced failure after Clubs');

      const { account, membership } = await accountLifecycle.createProvisionedOwner(
        {
          email: normalized.owner.email,
          name: normalized.owner.name,
          organizationId: organization.id,
          passwordHash: authService.hashPassword(crypto.randomBytes(48).toString('base64url')),
          phone: normalized.owner.phone,
        },
        { transaction },
      );
      if (options.failAfter === 'owner') throw new Error('Forced failure after owner graph');

      const issued = issueActivationSecret();
      const activationToken = await db.OwnerActivationToken.create(
        {
          accountId: account.id,
          expiresAt: issued.expiresAt,
          organizationId: organization.id,
          tokenHash: issued.tokenHash,
        },
        { transaction },
      );
      if (options.failAfter === 'activation') throw new Error('Forced failure after activation');

      const auditLog = await createAudit(
        {
          action: 'installation.provisioning.create',
          entityId: organization.id,
          metadata: {
            clubIds: clubs.map((club) => club.id),
            clubSlugs: clubs.map((club) => club.slug),
            membershipId: membership.id,
            operator: operator.username,
            ownerAccountId: account.id,
          },
          organizationId: organization.id,
          summary: `Организация «${organization.name}» создана оператором Setly`,
        },
        transaction,
      );
      const operation = await db.InstallationProvisioningOperation.create(
        {
          activationTokenId: activationToken.id,
          auditLogId: auditLog.id,
          idempotencyKeyHash,
          organizationId: organization.id,
          ownerAccountId: account.id,
          payloadHash,
        },
        { transaction },
      );
      if (options.failAfter === 'operation') throw new Error('Forced failure after operation');

      await assertTenantFoundationInitialized({ lock: true, transaction });
      const created = await loadOperationResult(operation, {
        replayed: false,
        transaction,
      });
      created.activation.link = issued.link;
      return created;
    });
  } catch (error) {
    if (error?.name === 'SequelizeUniqueConstraintError') {
      const previous = await db.InstallationProvisioningOperation.findOne({
        where: { idempotencyKeyHash },
      });
      if (previous) {
        if (previous.payloadHash !== payloadHash) {
          throw provisioningError(
            'Ключ повторной отправки уже использован с другими данными',
            409,
            'IDEMPOTENCY_PAYLOAD_MISMATCH',
          );
        }
        return loadOperationResult(previous, { replayed: true });
      }
      const uniquePaths = new Set(
        (error.errors || []).map((item) => item.path).filter(Boolean),
      );
      if (uniquePaths.has('email')) {
        throw provisioningError(
          'Аккаунт с таким email уже существует',
          409,
          'OWNER_EMAIL_EXISTS',
        );
      }
      if (uniquePaths.has('slug')) {
        throw provisioningError(
          'Не удалось создать организацию с таким названием. Укажите другое название',
          409,
          'ORGANIZATION_NAME_CONFLICT',
        );
      }
    }
    throw error;
  }

  invalidateTenantFoundationGateCache();
  return result;
}

async function getInstallationSnapshot() {
  assertEnabledFoundation();
  const classification = await assertTenantFoundationInitialized({ strict: true });
  const organizations = await db.Organization.findAll({
    attributes: ['id', 'name', 'slug', 'createdAt'],
    include: [
      { attributes: ['id'], model: db.Club, required: false },
      {
        attributes: ['id', 'status'],
        include: [{ attributes: ['id', 'status'], model: db.Account }],
        model: db.Membership,
        required: false,
        where: { role: 'owner' },
      },
    ],
    order: [['id', 'ASC'], [db.Club, 'id', 'ASC']],
  });
  const operations = await db.InstallationProvisioningOperation.findAll({
    include: [{ as: 'activationToken', model: db.OwnerActivationToken }],
    order: [['createdAt', 'DESC']],
  });
  const operationByOrganization = new Map(
    operations.map((operation) => [Number(operation.organizationId), operation]),
  );
  const audits = await db.AuditLog.findAll({
    attributes: ['id', 'organizationId', 'action', 'summary', 'statusCode', 'createdAt'],
    limit: 20,
    order: [['createdAt', 'DESC'], ['id', 'DESC']],
    where: { action: { [db.Sequelize.Op.like]: 'installation.%' } },
  });

  return {
    audits: audits.map((audit) => audit.toJSON()),
    foundation: { state: classification.state },
    organizations: organizations.map((organization) => {
      const operation = operationByOrganization.get(Number(organization.id));
      const ownerMemberships = organization.Memberships || [];
      const hasActiveOwner = ownerMemberships.some(
        (membership) => membership.status === 'active' && membership.Account?.status === 'active',
      );
      const hasPendingActivation = operation && activationState(operation.activationToken) === 'pending';
      const ownerState = hasActiveOwner
        ? (hasPendingActivation ? 'pending_activation' : 'active')
        : (ownerMemberships.length > 0 ? 'inactive' : 'missing');
      return {
        clubCount: (organization.Clubs || []).length,
        createdAt: organization.createdAt,
        id: organization.id,
        name: organization.name,
        ownerState,
        slug: organization.slug,
      };
    }),
  };
}

async function inspectActivation(rawToken) {
  try {
    return await db.sequelize.transaction(async (transaction) => {
      const token = await db.OwnerActivationToken.findOne({
        lock: transaction.LOCK.UPDATE,
        transaction,
        where: { tokenHash: sha256(rawToken) },
      });
      if (!token) return { state: 'invalid' };
      const authority = await lockOwnerAuthorityGraph(
        token.organizationId,
        token.accountId,
        transaction,
      );
      const state = activationState(token);
      if (state !== 'pending') return { state };
      return {
        expiresAt: token.expiresAt,
        organization: {
          id: authority.organization.id,
          name: authority.organization.name,
          slug: authority.organization.slug,
        },
        owner: {
          email: authority.account.email,
          name: authority.staff.name || authority.account.email,
        },
        state,
      };
    });
  } catch (error) {
    if (error?.code === 'OWNER_AUTHORITY_UNAVAILABLE') return { state: 'invalid' };
    throw error;
  }
}

async function activateOwner(rawToken, password) {
  assertEnabledFoundation();
  return db.sequelize.transaction(async (transaction) => {
    const token = await db.OwnerActivationToken.findOne({
      lock: transaction.LOCK.UPDATE,
      transaction,
      where: { tokenHash: sha256(rawToken) },
    });
    if (!token || activationState(token) !== 'pending') {
      throw provisioningError(
        'Ссылка активации недействительна или уже использована',
        410,
        'OWNER_ACTIVATION_UNAVAILABLE',
      );
    }
    await lockOwnerAuthorityGraph(token.organizationId, token.accountId, transaction);
    const account = await accountMetadata.updateAccountMetadata(
      token.accountId,
      { passwordHash: authService.hashPassword(password) },
      { transaction },
    );
    await token.update({ consumedAt: new Date() }, { transaction });
    const auditLog = await createAudit(
      {
        action: 'installation.owner_activation.consume',
        entityId: token.organizationId,
        metadata: { ownerAccountId: account.id },
        organizationId: token.organizationId,
        path: '/api/installation/provisioning/activation/consume',
        statusCode: 200,
        summary: 'Владелец безопасно активировал аккаунт',
      },
      transaction,
    );
    return { auditLogId: auditLog.id, email: account.email, success: true };
  });
}

async function reissueActivation(organizationId, operator) {
  assertEnabledFoundation();
  return db.sequelize.transaction(async (transaction) => {
    const operation = await db.InstallationProvisioningOperation.findOne({
      lock: transaction.LOCK.UPDATE,
      transaction,
      where: { organizationId },
    });
    if (!operation) {
      throw provisioningError(
        'Для этой организации нет управляемой активации',
        404,
        'PROVISIONED_ORGANIZATION_NOT_FOUND',
      );
    }
    const { activationToken: currentActivation } = await lockOperationAuthority(
      operation,
      transaction,
    );
    if (!currentActivation || currentActivation.consumedAt) {
      throw provisioningError(
        'Владелец уже активировал аккаунт',
        409,
        'OWNER_ALREADY_ACTIVATED',
      );
    }
    await db.OwnerActivationToken.update(
      { invalidatedAt: new Date() },
      {
        transaction,
        where: {
          accountId: operation.ownerAccountId,
          consumedAt: null,
          invalidatedAt: null,
          organizationId,
        },
      },
    );
    const issued = issueActivationSecret();
    const activationToken = await db.OwnerActivationToken.create(
      {
        accountId: operation.ownerAccountId,
        expiresAt: issued.expiresAt,
        organizationId,
        tokenHash: issued.tokenHash,
      },
      { transaction },
    );
    await operation.update({ activationTokenId: activationToken.id }, { transaction });
    const auditLog = await createAudit(
      {
        action: 'installation.owner_activation.reissue',
        entityId: organizationId,
        metadata: { operator: operator.username, ownerAccountId: operation.ownerAccountId },
        organizationId,
        path: `/api/installation/provisioning/organizations/${organizationId}/activation/reissue`,
        statusCode: 200,
        summary: 'Ссылка активации перевыпущена; предыдущая аннулирована',
      },
      transaction,
    );
    return {
      activation: {
        expiresAt: issued.expiresAt,
        link: issued.link,
        state: 'pending',
      },
      audit: { action: auditLog.action, createdAt: auditLog.createdAt, id: auditLog.id },
    };
  });
}

module.exports = {
  _private: {
    activationState,
    allocateClubSlugs,
    canonicalSlug,
    lockOperationAuthority,
    lockOwnerAuthorityGraph,
    sha256,
    stablePayload,
  },
  activateOwner,
  getInstallationSnapshot,
  inspectActivation,
  provisionOrganization,
  reissueActivation,
};
