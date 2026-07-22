'use strict';

const db = require('../../models');
const {
  requireExactSingletonDefault,
} = require('../tenant-enforcement/legacy-singleton');
const { TENANT_SCOPES } = require('../tenant-context/route-scope-declarations');
const {
  isTenantClientMoneyInstrumentsEnabled,
} = require('../tenant-context/capabilities');
const {
  isLegacyProviderContext,
} = require('../provider-integrations/rollout');
const {
  isTrustedTenantContext,
  safeTenantDenial,
} = require('./tenant-context.service');

const resolvedContexts = new WeakSet();

function positiveId(value) {
  const normalized = Number(value);
  return Number.isSafeInteger(normalized) && normalized > 0
    ? normalized
    : null;
}

function queryLock(transaction, lock) {
  return transaction && lock ? transaction.LOCK.UPDATE : undefined;
}

function freezeContext(values) {
  const context = Object.freeze({
    ...values,
    scoped: Boolean(values.readScoped),
  });
  resolvedContexts.add(context);
  return context;
}

function staffIdentityIsAuthoritative(account, membership, staff) {
  const accountStaffId = positiveId(account?.staffId);
  const membershipStaffId = positiveId(membership?.staffId);
  if (!accountStaffId && !membershipStaffId) return true;
  return Boolean(
    accountStaffId &&
      membershipStaffId &&
      accountStaffId === membershipStaffId &&
      staff &&
      Number(staff.id) === membershipStaffId &&
      Number(staff.organizationId) === Number(membership.organizationId) &&
      staff.status === 'active',
  );
}

async function resolveLegacyContext({ lock = false, transaction } = {}) {
  const singleton = await requireExactSingletonDefault({ lock, transaction });
  return freezeContext({
    accountId: null,
    authority: 'legacy-default',
    clubId: singleton.clubId,
    connectionId: null,
    effectiveRole: null,
    membershipId: null,
    membershipRole: null,
    organizationId: singleton.organizationId,
    provider: null,
    readScoped: false,
    scope: TENANT_SCOPES.CLUB,
  });
}

function isProviderAuthority(authority) {
  return Boolean(
    authority &&
      positiveId(authority.connectionId) &&
      positiveId(authority.organizationId) &&
      positiveId(authority.clubId) &&
      authority.provider === 'evotor',
  );
}

async function resolveProviderContext(authority, { lock = false, transaction } = {}) {
  const connection = await db.IntegrationConnection.unscoped().findOne({
    attributes: [
      'id',
      'organizationId',
      'clubId',
      'provider',
      'purpose',
      'status',
    ],
    lock: queryLock(transaction, lock),
    transaction,
    where: {
      clubId: positiveId(authority.clubId),
      id: positiveId(authority.connectionId),
      organizationId: positiveId(authority.organizationId),
      provider: 'evotor',
      purpose: 'point_of_sale',
      status: 'active',
    },
  });
  if (!connection) throw safeTenantDenial();
  const [organization, club] = await Promise.all([
    db.Organization.findOne({
      attributes: ['id'],
      lock: queryLock(transaction, lock),
      transaction,
      where: { id: connection.organizationId, status: 'active' },
    }),
    db.Club.findOne({
      attributes: ['id', 'organizationId'],
      lock: queryLock(transaction, lock),
      transaction,
      where: {
        id: connection.clubId,
        organizationId: connection.organizationId,
        status: 'active',
      },
    }),
  ]);
  if (!organization || !club) throw safeTenantDenial();
  return freezeContext({
    accountId: null,
    authority: 'provider',
    clubId: Number(club.id),
    connectionId: Number(connection.id),
    effectiveRole: null,
    membershipId: null,
    membershipRole: null,
    organizationId: Number(organization.id),
    provider: 'evotor',
    readScoped: true,
    scope: TENANT_SCOPES.CLUB,
  });
}

async function resolveLegacyProviderAuthority(
  authority,
  { lock = false, transaction } = {},
) {
  const singleton = await requireExactSingletonDefault({ lock, transaction });
  if (
    !isLegacyProviderContext(authority, 'evotor') ||
    positiveId(authority.organizationId) !== singleton.organizationId ||
    positiveId(authority.clubId) !== singleton.clubId
  ) {
    throw safeTenantDenial();
  }
  return freezeContext({
    accountId: null,
    authority: 'legacy-provider',
    clubId: singleton.clubId,
    connectionId: null,
    effectiveRole: null,
    membershipId: null,
    membershipRole: null,
    organizationId: singleton.organizationId,
    provider: 'evotor',
    readScoped: true,
    scope: TENANT_SCOPES.CLUB,
  });
}

async function resolveRequestContext(tenant, { lock = false, transaction } = {}) {
  const trusted = isTrustedTenantContext(tenant) || resolvedContexts.has(tenant);
  if (
    !trusted ||
    !Object.isFrozen(tenant) ||
    ![TENANT_SCOPES.ORGANIZATION, TENANT_SCOPES.CLUB].includes(tenant.scope) ||
    !positiveId(tenant.accountId) ||
    !positiveId(tenant.membershipId) ||
    !positiveId(tenant.organizationId)
  ) {
    throw safeTenantDenial();
  }

  const organization = await db.Organization.findOne({
    attributes: ['id'],
    lock: queryLock(transaction, lock),
    transaction,
    where: { id: positiveId(tenant.organizationId), status: 'active' },
  });
  if (!organization) throw safeTenantDenial();
  const account = await db.Account.findOne({
    attributes: ['id', 'staffId', 'status'],
    lock: queryLock(transaction, lock),
    transaction,
    where: { id: positiveId(tenant.accountId), status: 'active' },
  });
  if (!account) throw safeTenantDenial();
  const membership = await db.Membership.findOne({
    attributes: ['id', 'accountId', 'organizationId', 'role', 'staffId', 'status'],
    lock: queryLock(transaction, lock),
    transaction,
    where: {
      accountId: account.id,
      id: positiveId(tenant.membershipId),
      organizationId: organization.id,
      status: 'active',
    },
  });
  if (!membership) throw safeTenantDenial();
  const staff = positiveId(membership.staffId)
    ? await db.Staff.findOne({
      attributes: ['id', 'organizationId', 'status'],
      lock: queryLock(transaction, lock),
      transaction,
      where: {
        id: positiveId(membership.staffId),
        organizationId: organization.id,
        status: 'active',
      },
    })
    : null;
  if (!staffIdentityIsAuthoritative(account, membership, staff)) {
    throw safeTenantDenial();
  }

  let clubId = null;
  let effectiveRole = membership.role;
  if (tenant.scope === TENANT_SCOPES.CLUB) {
    clubId = positiveId(tenant.clubId);
    if (!clubId) throw safeTenantDenial();
    const club = await db.Club.findOne({
      attributes: ['id'],
      lock: queryLock(transaction, lock),
      transaction,
      where: { id: clubId, organizationId: organization.id, status: 'active' },
    });
    if (!club) throw safeTenantDenial();
    if (membership.role !== 'owner') {
      const access = await db.MembershipClubAccess.findOne({
        attributes: ['membershipId', 'roleOverride'],
        lock: queryLock(transaction, lock),
        transaction,
        where: {
          clubId,
          membershipId: membership.id,
          organizationId: organization.id,
          status: 'active',
        },
      });
      if (!access || access.roleOverride === 'owner') throw safeTenantDenial();
      effectiveRole = access.roleOverride || membership.role;
    }
  }

  return freezeContext({
    accountId: Number(account.id),
    authority: 'request',
    clubId,
    connectionId: null,
    effectiveRole,
    membershipId: Number(membership.id),
    membershipRole: membership.role,
    organizationId: Number(organization.id),
    provider: null,
    readScoped: true,
    scope: tenant.scope,
  });
}

async function resolveClientMoneyAccessContext(authority, options = {}) {
  if (!isTenantClientMoneyInstrumentsEnabled()) {
    return resolveLegacyContext(options);
  }
  if (isProviderAuthority(authority)) {
    return resolveProviderContext(authority, options);
  }
  if (isLegacyProviderContext(authority, 'evotor')) {
    return resolveLegacyProviderAuthority(authority, options);
  }
  return resolveRequestContext(authority, options);
}

async function resolveClientMoneyAccessContextForModel(
  authority,
  model,
  options = {},
) {
  if (
    !isTenantClientMoneyInstrumentsEnabled() &&
    !authority &&
    (!model?.sequelize || model.sequelize !== db.sequelize)
  ) {
    return null;
  }
  return resolveClientMoneyAccessContext(authority, options);
}

function findClubRecordByPk(model, id, options = {}, context = null) {
  if (!context && typeof model.findByPk === 'function') {
    return model.findByPk(id, options);
  }
  return model.findOne({
    ...options,
    where: clubTenantWhere(context, { id: Number(id) }),
  });
}

function findOrganizationRecordByPk(model, id, options = {}, context = null) {
  if (!context && typeof model.findByPk === 'function') {
    return model.findByPk(id, options);
  }
  return model.findOne({
    ...options,
    where: organizationTenantWhere(context, { id: Number(id) }),
  });
}

function requireClubContext(context) {
  if (
    !context ||
    context.scope !== TENANT_SCOPES.CLUB ||
    !positiveId(context.organizationId) ||
    !positiveId(context.clubId)
  ) {
    throw safeTenantDenial();
  }
  return context;
}

function bindClientMoneyActor(actor, context) {
  if (!context?.readScoped) return actor;
  if (
    context.authority !== 'request' ||
    !actor ||
    positiveId(actor.id) !== positiveId(context.accountId)
  ) {
    throw safeTenantDenial();
  }
  const role = context.scope === TENANT_SCOPES.CLUB
    ? context.effectiveRole
    : context.membershipRole;
  if (!role) throw safeTenantDenial();
  return Object.freeze({ ...actor, id: context.accountId, role });
}

function organizationTenantWhere(context, values = {}, { force = false } = {}) {
  if (!context || (!context.readScoped && !force)) return values;
  return { ...values, organizationId: context.organizationId };
}

function clubTenantWhere(context, values = {}, { force = false } = {}) {
  if (!context) return values;
  requireClubContext(context);
  if (!context.readScoped && !force) return values;
  return {
    ...values,
    clubId: context.clubId,
    organizationId: context.organizationId,
  };
}

function organizationTenantValues(context) {
  if (!context) return {};
  return { organizationId: context.organizationId };
}

function clubTenantValues(context) {
  if (!context) return {};
  requireClubContext(context);
  return {
    clubId: context.clubId,
    organizationId: context.organizationId,
  };
}

module.exports = {
  _private: {
    positiveId,
    resolveLegacyContext,
    resolveProviderContext,
    resolveRequestContext,
    staffIdentityIsAuthoritative,
  },
  bindClientMoneyActor,
  clubTenantValues,
  clubTenantWhere,
  findClubRecordByPk,
  findOrganizationRecordByPk,
  organizationTenantValues,
  organizationTenantWhere,
  requireClubContext,
  resolveClientMoneyAccessContext,
  resolveClientMoneyAccessContextForModel,
};
