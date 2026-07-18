'use strict';

const db = require('../../models');
const {
  requireExactSingletonDefault,
} = require('../tenant-enforcement/legacy-singleton');
const { TENANT_SCOPES } = require('../tenant-context/route-scope-declarations');
const {
  isTenantClientBasesCallTasksEnabled,
} = require('../tenant-context/capabilities');
const { safeTenantDenial } = require('./tenant-context.service');

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
  return Object.freeze({
    ...values,
    clientScoped: Boolean(values.readScoped),
    scoped: Boolean(values.readScoped),
  });
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

async function loadActiveOrganizationAndClub(
  organizationId,
  clubId,
  { lock, transaction } = {},
) {
  const organization = await db.Organization.findOne({
    attributes: ['id'],
    lock: queryLock(transaction, lock),
    transaction,
    where: { id: positiveId(organizationId), status: 'active' },
  });
  if (!organization) throw safeTenantDenial();

  const club = await db.Club.findOne({
    attributes: ['id', 'organizationId'],
    lock: queryLock(transaction, lock),
    transaction,
    where: {
      id: positiveId(clubId),
      organizationId: organization.id,
      status: 'active',
    },
  });
  if (!club) throw safeTenantDenial();
  return { club, organization };
}

async function loadAuthoritativeAccountMembership({
  accountId,
  allowInvalid = false,
  clubId,
  lock,
  membershipId = null,
  organizationId,
  roles = null,
  transaction,
}) {
  const invalid = () => {
    if (allowInvalid) return null;
    throw safeTenantDenial();
  };
  const id = positiveId(accountId);
  if (!id) return invalid();

  let tenantRoot;
  try {
    tenantRoot = await loadActiveOrganizationAndClub(
      organizationId,
      clubId,
      { lock, transaction },
    );
  } catch (error) {
    if (allowInvalid) return null;
    throw error;
  }
  const { club, organization } = tenantRoot;
  const account = await db.Account.findOne({
    attributes: ['id', 'role', 'staffId', 'status'],
    lock: queryLock(transaction, lock),
    transaction,
    where: { id, status: 'active' },
  });
  if (!account) return invalid();

  const membershipWhere = {
    accountId: account.id,
    organizationId: organization.id,
    status: 'active',
  };
  if (positiveId(membershipId)) membershipWhere.id = positiveId(membershipId);
  const membership = await db.Membership.findOne({
    attributes: ['id', 'accountId', 'organizationId', 'role', 'staffId', 'status'],
    lock: queryLock(transaction, lock),
    transaction,
    where: membershipWhere,
  });
  if (!membership) return invalid();

  const linkedStaffId = positiveId(membership.staffId);
  const staff = linkedStaffId
    ? await db.Staff.findOne({
      attributes: ['id', 'organizationId', 'status'],
      lock: queryLock(transaction, lock),
      transaction,
      where: {
        id: linkedStaffId,
        organizationId: organization.id,
        status: 'active',
      },
    })
    : null;
  if (!staffIdentityIsAuthoritative(account, membership, staff)) {
    return invalid();
  }

  let effectiveRole = membership.role;
  if (membership.role !== 'owner') {
    const access = await db.MembershipClubAccess.findOne({
      attributes: ['membershipId', 'roleOverride', 'status'],
      lock: queryLock(transaction, lock),
      transaction,
      where: {
        clubId: club.id,
        membershipId: membership.id,
        organizationId: organization.id,
        status: 'active',
      },
    });
    if (!access || access.roleOverride === 'owner') return invalid();
    effectiveRole = access.roleOverride || membership.role;
  }
  if (roles && !roles.includes(effectiveRole)) return invalid();

  return { account, club, effectiveRole, membership, organization };
}

async function resolveLegacyContext(options = {}) {
  const singleton = await requireExactSingletonDefault({
    lock: options.lock,
    transaction: options.transaction,
  });

  let authority = null;
  if (positiveId(options.accountId)) {
    authority = await loadAuthoritativeAccountMembership({
      accountId: options.accountId,
      clubId: singleton.clubId,
      lock: options.lock,
      organizationId: singleton.organizationId,
      transaction: options.transaction,
    });
  }

  return freezeContext({
    accountId: authority ? Number(authority.membership.accountId) : null,
    authority: 'legacy-default',
    clubId: singleton.clubId,
    effectiveRole: authority?.effectiveRole || null,
    membershipId: authority ? Number(authority.membership.id) : null,
    membershipRole: authority?.membership.role || null,
    organizationId: singleton.organizationId,
    readScoped: false,
    staffId: authority?.membership.staffId
      ? Number(authority.membership.staffId)
      : null,
  });
}

async function resolveRequestContext(tenant, options = {}) {
  if (
    !tenant ||
    !Object.isFrozen(tenant) ||
    tenant.scope !== TENANT_SCOPES.CLUB ||
    !positiveId(tenant.accountId) ||
    !positiveId(tenant.membershipId) ||
    !positiveId(tenant.organizationId) ||
    !positiveId(tenant.clubId)
  ) {
    throw safeTenantDenial();
  }

  const authority = await loadAuthoritativeAccountMembership({
    accountId: tenant.accountId,
    clubId: tenant.clubId,
    lock: options.lock,
    membershipId: tenant.membershipId,
    organizationId: tenant.organizationId,
    transaction: options.transaction,
  });
  const { club, effectiveRole, membership, organization } = authority;

  return freezeContext({
    accountId: Number(membership.accountId),
    authority: 'request',
    clubId: Number(club.id),
    effectiveRole,
    membershipId: Number(membership.id),
    membershipRole: membership.role,
    organizationId: Number(organization.id),
    readScoped: true,
    staffId: membership.staffId ? Number(membership.staffId) : null,
  });
}

async function resolveStoredCallTaskContext(attribution, options = {}) {
  if (!isTenantClientBasesCallTasksEnabled()) {
    return resolveLegacyContext(options);
  }
  const { club, organization } = await loadActiveOrganizationAndClub(
    attribution?.organizationId,
    attribution?.clubId,
    options,
  );
  return freezeContext({
    accountId: null,
    authority: 'stored-root',
    clubId: Number(club.id),
    effectiveRole: null,
    membershipId: null,
    membershipRole: null,
    organizationId: Number(organization.id),
    readScoped: true,
  });
}

async function resolveCallTaskAccessContext(tenant, options = {}) {
  if (!isTenantClientBasesCallTasksEnabled()) {
    return resolveLegacyContext(options);
  }
  return resolveRequestContext(tenant, options);
}

function callTaskTenantWhere(context, values = {}, { force = false } = {}) {
  if (!context || (!context.readScoped && !force)) return values;
  return {
    ...values,
    clubId: context.clubId,
    organizationId: context.organizationId,
  };
}

async function resolveEligibleCallTaskAccount(
  accountId,
  context,
  { allowInvalid = false, roles = ['owner', 'manager', 'admin'], transaction } = {},
) {
  const id = positiveId(accountId);
  if (!id) return null;
  const authority = await loadAuthoritativeAccountMembership({
    accountId: id,
    allowInvalid,
    clubId: context?.clubId,
    organizationId: context?.organizationId,
    roles,
    transaction,
  });
  return authority ? Number(authority.account.id) : null;
}

module.exports = {
  _private: {
    loadAuthoritativeAccountMembership,
    loadActiveOrganizationAndClub,
    positiveId,
    resolveLegacyContext,
    resolveRequestContext,
    staffIdentityIsAuthoritative,
  },
  callTaskTenantWhere,
  resolveCallTaskAccessContext,
  resolveEligibleCallTaskAccount,
  resolveStoredCallTaskContext,
};
