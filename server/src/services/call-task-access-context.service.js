'use strict';

const db = require('../../models');
const {
  DEFAULT_CLUB_SLUG,
  DEFAULT_ORGANIZATION_SLUG,
} = require('../tenant-foundation/constants');
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

async function resolveLegacyContext(options = {}) {
  const organization = await db.Organization.findOne({
    attributes: ['id'],
    lock: queryLock(options.transaction, options.lock),
    transaction: options.transaction,
    where: { slug: DEFAULT_ORGANIZATION_SLUG, status: 'active' },
  });
  if (!organization) throw safeTenantDenial();

  const club = await db.Club.findOne({
    attributes: ['id', 'organizationId'],
    lock: queryLock(options.transaction, options.lock),
    transaction: options.transaction,
    where: {
      organizationId: organization.id,
      slug: DEFAULT_CLUB_SLUG,
      status: 'active',
    },
  });
  if (!club) throw safeTenantDenial();

  let membership = null;
  if (positiveId(options.accountId)) {
    membership = await db.Membership.findOne({
      attributes: ['id', 'accountId', 'role', 'staffId'],
      lock: queryLock(options.transaction, options.lock),
      transaction: options.transaction,
      where: {
        accountId: positiveId(options.accountId),
        organizationId: organization.id,
      },
    });
    if (!membership) throw safeTenantDenial();
  }

  return freezeContext({
    accountId: membership ? Number(membership.accountId) : null,
    authority: 'legacy-default',
    clubId: Number(club.id),
    effectiveRole: null,
    membershipId: membership ? Number(membership.id) : null,
    membershipRole: membership?.role || null,
    organizationId: Number(organization.id),
    readScoped: false,
    staffId: membership?.staffId ? Number(membership.staffId) : null,
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

  const { club, organization } = await loadActiveOrganizationAndClub(
    tenant.organizationId,
    tenant.clubId,
    options,
  );
  const membership = await db.Membership.findOne({
    attributes: ['id', 'accountId', 'organizationId', 'role', 'staffId'],
    lock: queryLock(options.transaction, options.lock),
    transaction: options.transaction,
    where: {
      accountId: positiveId(tenant.accountId),
      id: positiveId(tenant.membershipId),
      organizationId: organization.id,
      status: 'active',
    },
  });
  if (!membership) throw safeTenantDenial();

  let effectiveRole = membership.role;
  if (membership.role !== 'owner') {
    const access = await db.MembershipClubAccess.findOne({
      attributes: ['membershipId', 'roleOverride'],
      lock: queryLock(options.transaction, options.lock),
      transaction: options.transaction,
      where: {
        clubId: club.id,
        membershipId: membership.id,
        organizationId: organization.id,
        status: 'active',
      },
    });
    if (!access || access.roleOverride === 'owner') throw safeTenantDenial();
    effectiveRole = access.roleOverride || membership.role;
  }

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

  const account = await db.Account.findOne({
    attributes: ['id', 'role', 'staffId', 'status'],
    transaction,
    where: { id, status: 'active' },
  });
  if (!account) {
    if (allowInvalid) return null;
    throw safeTenantDenial();
  }

  if (!context?.readScoped) {
    if (!roles.includes(account.role)) {
      if (allowInvalid) return null;
      throw safeTenantDenial();
    }
    return Number(account.id);
  }

  const membership = await db.Membership.findOne({
    attributes: ['id', 'role', 'staffId'],
    transaction,
    where: {
      accountId: account.id,
      organizationId: context.organizationId,
      status: 'active',
    },
  });
  if (!membership) {
    if (allowInvalid) return null;
    throw safeTenantDenial();
  }

  if (membership.staffId) {
    const staff = await db.Staff.findOne({
      attributes: ['id'],
      transaction,
      where: {
        id: membership.staffId,
        organizationId: context.organizationId,
        status: 'active',
      },
    });
    if (
      !staff ||
      (account.staffId && Number(account.staffId) !== Number(membership.staffId))
    ) {
      if (allowInvalid) return null;
      throw safeTenantDenial();
    }
  }

  let effectiveRole = membership.role;
  if (membership.role !== 'owner') {
    const access = await db.MembershipClubAccess.findOne({
      attributes: ['roleOverride'],
      transaction,
      where: {
        clubId: context.clubId,
        membershipId: membership.id,
        organizationId: context.organizationId,
        status: 'active',
      },
    });
    if (!access || access.roleOverride === 'owner') {
      if (allowInvalid) return null;
      throw safeTenantDenial();
    }
    effectiveRole = access.roleOverride || membership.role;
  }

  if (!roles.includes(effectiveRole)) {
    if (allowInvalid) return null;
    throw safeTenantDenial();
  }
  if (
    membership.staffId &&
    account.staffId &&
    Number(membership.staffId) !== Number(account.staffId)
  ) {
    if (allowInvalid) return null;
    throw safeTenantDenial();
  }
  return Number(account.id);
}

module.exports = {
  _private: {
    loadActiveOrganizationAndClub,
    positiveId,
    resolveLegacyContext,
    resolveRequestContext,
  },
  callTaskTenantWhere,
  resolveCallTaskAccessContext,
  resolveEligibleCallTaskAccount,
  resolveStoredCallTaskContext,
};
