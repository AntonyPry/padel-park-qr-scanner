'use strict';

const db = require('../../models');
const { DEFAULT_ORGANIZATION_SLUG } = require('../tenant-foundation/constants');
const { TENANT_SCOPES } = require('../tenant-context/route-scope-declarations');
const {
  isTenantMethodologySkillMapEnabled,
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
  return transaction && lock ? transaction.LOCK.UPDATE : undefined;
}

function freezeContext(values) {
  const context = Object.freeze(values);
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
  const organization = await db.Organization.findOne({
    attributes: ['id'],
    lock: queryLock(transaction, lock),
    transaction,
    where: { slug: DEFAULT_ORGANIZATION_SLUG, status: 'active' },
  });
  if (!organization) throw safeTenantDenial();
  return freezeContext({
    accountId: null,
    authority: 'legacy-default',
    clubId: null,
    effectiveRole: null,
    membershipId: null,
    membershipRole: null,
    organizationId: Number(organization.id),
    readScoped: false,
    scope: TENANT_SCOPES.ORGANIZATION,
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
    effectiveRole,
    membershipId: Number(membership.id),
    membershipRole: membership.role,
    organizationId: Number(organization.id),
    readScoped: true,
    scope: tenant.scope,
  });
}

async function resolveMethodologyAccessContext(tenant, options = {}) {
  if (!isTenantMethodologySkillMapEnabled()) {
    return resolveLegacyContext(options);
  }
  return resolveRequestContext(tenant, options);
}

function methodologyTenantWhere(context, values = {}, { force = false } = {}) {
  if (!context || (!context.readScoped && !force)) return values;
  return { ...values, organizationId: context.organizationId };
}

function bindMethodologyActor(actor, context) {
  if (!context?.readScoped) return actor;
  if (
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

module.exports = {
  _private: {
    positiveId,
    resolveLegacyContext,
    resolveRequestContext,
    staffIdentityIsAuthoritative,
  },
  bindMethodologyActor,
  methodologyTenantWhere,
  resolveMethodologyAccessContext,
};
