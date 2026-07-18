'use strict';

const db = require('../../models');
const {
  requireExactSingletonDefault,
} = require('../tenant-enforcement/legacy-singleton');
const { TENANT_SCOPES } = require('../tenant-context/route-scope-declarations');
const {
  isTenantAuditLogEnabled,
} = require('../tenant-context/capabilities');
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
  return transaction && lock ? transaction.LOCK.SHARE : undefined;
}

function freezeContext(values) {
  const context = Object.freeze(values);
  resolvedContexts.add(context);
  return context;
}

function requireSupportedScope(scope) {
  if (![
    TENANT_SCOPES.MEMBERSHIP,
    TENANT_SCOPES.ORGANIZATION,
    TENANT_SCOPES.CLUB,
  ].includes(scope)) {
    throw safeTenantDenial();
  }
  return scope;
}

function assertStaffIdentity(account, membership, staff) {
  const accountStaffId = positiveId(account?.staffId);
  const membershipStaffId = positiveId(membership?.staffId);
  if (!accountStaffId && !membershipStaffId) return;
  if (
    !accountStaffId ||
    !membershipStaffId ||
    accountStaffId !== membershipStaffId ||
    !staff ||
    positiveId(staff.id) !== membershipStaffId ||
    positiveId(staff.organizationId) !== positiveId(membership.organizationId) ||
    staff.status !== 'active'
  ) {
    throw safeTenantDenial();
  }
}

async function resolveLegacyContext(actor, scope, options = {}) {
  const singleton = await requireExactSingletonDefault({
    lock: options.lock,
    transaction: options.transaction,
  });

  return freezeContext({
    accountId: positiveId(actor?.id),
    actorRole: actor?.role || null,
    authority: 'legacy-default',
    clubId: scope === TENANT_SCOPES.CLUB ? singleton.clubId : null,
    effectiveRole: actor?.role || null,
    membershipId: null,
    membershipRole: actor?.role || null,
    organizationId: singleton.organizationId,
    readScoped: false,
    scope,
  });
}

async function resolveRequestContext(actor, tenant, scope, options = {}) {
  if (
    !actor ||
    !isTrustedTenantContext(tenant) ||
    !Object.isFrozen(tenant) ||
    tenant.scope !== scope ||
    positiveId(actor.id) !== positiveId(tenant.accountId) ||
    !positiveId(tenant.membershipId) ||
    !positiveId(tenant.organizationId)
  ) {
    throw safeTenantDenial();
  }

  const lock = queryLock(options.transaction, options.lock);
  const organization = await db.Organization.findOne({
    attributes: ['id'],
    lock,
    transaction: options.transaction,
    where: { id: positiveId(tenant.organizationId), status: 'active' },
  });
  if (!organization) throw safeTenantDenial();

  const account = await db.Account.findOne({
    attributes: ['id', 'staffId', 'status'],
    lock,
    transaction: options.transaction,
    where: { id: positiveId(tenant.accountId), status: 'active' },
  });
  if (!account) throw safeTenantDenial();

  const membership = await db.Membership.findOne({
    attributes: ['id', 'accountId', 'organizationId', 'role', 'staffId', 'status'],
    lock,
    transaction: options.transaction,
    where: {
      accountId: account.id,
      id: positiveId(tenant.membershipId),
      organizationId: organization.id,
      status: 'active',
    },
  });
  if (!membership) throw safeTenantDenial();

  const staffId = positiveId(membership.staffId);
  const staff = staffId
    ? await db.Staff.findOne({
      attributes: ['id', 'organizationId', 'status'],
      lock,
      transaction: options.transaction,
      where: {
        id: staffId,
        organizationId: organization.id,
        status: 'active',
      },
    })
    : null;
  assertStaffIdentity(account, membership, staff);

  let clubId = null;
  let effectiveRole = membership.role;
  if (scope === TENANT_SCOPES.CLUB) {
    clubId = positiveId(tenant.clubId);
    if (!clubId) throw safeTenantDenial();
    const club = await db.Club.findOne({
      attributes: ['id'],
      lock,
      transaction: options.transaction,
      where: {
        id: clubId,
        organizationId: organization.id,
        status: 'active',
      },
    });
    if (!club) throw safeTenantDenial();
    if (membership.role !== 'owner') {
      const access = await db.MembershipClubAccess.findOne({
        attributes: ['membershipId', 'roleOverride'],
        lock,
        transaction: options.transaction,
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

  const actorRole = scope === TENANT_SCOPES.CLUB
    ? effectiveRole
    : membership.role;
  return freezeContext({
    accountId: positiveId(account.id),
    actorRole,
    authority: 'request',
    clubId,
    effectiveRole,
    membershipId: positiveId(membership.id),
    membershipRole: membership.role,
    organizationId: positiveId(organization.id),
    readScoped: true,
    scope,
  });
}

async function resolveAuditAccessContext(actor, tenant, scope, options = {}) {
  const normalizedScope = requireSupportedScope(scope);
  if (!isTenantAuditLogEnabled()) {
    return resolveLegacyContext(actor, normalizedScope, options);
  }
  return resolveRequestContext(actor, tenant, normalizedScope, options);
}

function requireResolvedContext(context) {
  if (!resolvedContexts.has(context) || !Object.isFrozen(context)) {
    throw safeTenantDenial();
  }
  return context;
}

function auditTenantWhere(context, values = {}) {
  requireResolvedContext(context);
  if (!context.readScoped) return values;
  return { ...values, organizationId: context.organizationId };
}

function auditTenantValues(context) {
  requireResolvedContext(context);
  return {
    clubId: context.clubId,
    organizationId: context.organizationId,
  };
}

function bindAuditActor(actor, context) {
  requireResolvedContext(context);
  if (!context.readScoped) return actor;
  if (positiveId(actor?.id) !== context.accountId || !context.actorRole) {
    throw safeTenantDenial();
  }
  return Object.freeze({ ...actor, id: context.accountId, role: context.actorRole });
}

function toOrganizationRealtimeContext(context) {
  requireResolvedContext(context);
  if (!context.readScoped) return null;
  return Object.freeze({
    accountId: context.accountId,
    clubId: null,
    effectiveRole: context.membershipRole,
    membershipId: context.membershipId,
    membershipRole: context.membershipRole,
    organizationId: context.organizationId,
    scope: TENANT_SCOPES.ORGANIZATION,
  });
}

module.exports = {
  _private: {
    assertStaffIdentity,
    positiveId,
    resolveLegacyContext,
    resolveRequestContext,
  },
  auditTenantValues,
  auditTenantWhere,
  bindAuditActor,
  resolveAuditAccessContext,
  toOrganizationRealtimeContext,
};
