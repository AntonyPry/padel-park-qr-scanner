'use strict';

const db = require('../../models');
const {
  DEFAULT_CLUB_SLUG,
  DEFAULT_ORGANIZATION_SLUG,
} = require('../tenant-foundation/constants');
const { TENANT_SCOPES } = require('../tenant-context/route-scope-declarations');
const {
  isTenantBookingsCourtsEnabled,
} = require('../tenant-context/capabilities');
const {
  isTrustedTenantContext,
  safeTenantDenial,
} = require('./tenant-context.service');

const resolvedBookingContexts = new WeakSet();

function positiveId(value) {
  const normalized = Number(value);
  return Number.isSafeInteger(normalized) && normalized > 0
    ? normalized
    : null;
}

function queryLock(transaction, lock) {
  return transaction && lock ? transaction.LOCK.UPDATE : undefined;
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
  { lock = false, transaction } = {},
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

async function loadAuthoritativeMembership(
  { accountId, clubId, membershipId, organizationId },
  { allowInvalid = false, lock = false, transaction } = {},
) {
  const invalid = () => {
    if (allowInvalid) return null;
    throw safeTenantDenial();
  };
  const id = positiveId(accountId);
  if (!id) return invalid();

  let roots;
  try {
    roots = await loadActiveOrganizationAndClub(
      organizationId,
      clubId,
      { lock, transaction },
    );
  } catch (error) {
    if (allowInvalid) return null;
    throw error;
  }

  const account = await db.Account.findOne({
    attributes: ['id', 'staffId', 'status'],
    lock: queryLock(transaction, lock),
    transaction,
    where: { id, status: 'active' },
  });
  if (!account) return invalid();

  const membershipWhere = {
    accountId: account.id,
    organizationId: roots.organization.id,
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
        organizationId: roots.organization.id,
        status: 'active',
      },
    })
    : null;
  if (!staffIdentityIsAuthoritative(account, membership, staff)) return invalid();

  let effectiveRole = membership.role;
  if (membership.role !== 'owner') {
    const access = await db.MembershipClubAccess.findOne({
      attributes: ['membershipId', 'roleOverride'],
      lock: queryLock(transaction, lock),
      transaction,
      where: {
        clubId: roots.club.id,
        membershipId: membership.id,
        organizationId: roots.organization.id,
        status: 'active',
      },
    });
    if (!access || access.roleOverride === 'owner') return invalid();
    effectiveRole = access.roleOverride || membership.role;
  }

  return {
    account,
    club: roots.club,
    effectiveRole,
    membership,
    organization: roots.organization,
    staff,
  };
}

function freezeContext(values) {
  const context = Object.freeze({
    ...values,
    scoped: Boolean(values.readScoped),
  });
  resolvedBookingContexts.add(context);
  return context;
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
  return freezeContext({
    accountId: null,
    authority: 'legacy-default',
    clubId: Number(club.id),
    effectiveRole: null,
    membershipId: null,
    membershipRole: null,
    organizationId: Number(organization.id),
    readScoped: false,
    scope: TENANT_SCOPES.CLUB,
  });
}

async function resolveRequestContext(tenant, options = {}) {
  const trustedInput = isTrustedTenantContext(tenant) ||
    resolvedBookingContexts.has(tenant);
  if (
    !tenant ||
    !trustedInput ||
    !Object.isFrozen(tenant) ||
    tenant.scope !== TENANT_SCOPES.CLUB ||
    !positiveId(tenant.accountId) ||
    !positiveId(tenant.membershipId) ||
    !positiveId(tenant.organizationId) ||
    !positiveId(tenant.clubId)
  ) {
    throw safeTenantDenial();
  }
  const authority = await loadAuthoritativeMembership(
    tenant,
    options,
  );
  return freezeContext({
    accountId: Number(authority.account.id),
    authority: 'request',
    clubId: Number(authority.club.id),
    effectiveRole: authority.effectiveRole,
    membershipId: Number(authority.membership.id),
    membershipRole: authority.membership.role,
    organizationId: Number(authority.organization.id),
    readScoped: true,
    scope: TENANT_SCOPES.CLUB,
  });
}

async function resolveBookingAccessContext(tenant, options = {}) {
  if (!isTenantBookingsCourtsEnabled()) return resolveLegacyContext(options);
  return resolveRequestContext(tenant, options);
}

function bookingTenantWhere(context, values = {}, { force = false } = {}) {
  if (!context || (!context.readScoped && !force)) return values;
  return {
    ...values,
    clubId: context.clubId,
    organizationId: context.organizationId,
  };
}

async function resolveEligibleBookingStaff(
  staffId,
  context,
  { allowInvalid = false, lock = false, transaction } = {},
) {
  const invalid = () => {
    if (allowInvalid) return null;
    throw safeTenantDenial();
  };
  const id = positiveId(staffId);
  if (!id) return invalid();
  const staff = await db.Staff.findOne({
    attributes: ['id', 'organizationId', 'status'],
    lock: queryLock(transaction, lock),
    transaction,
    where: {
      id,
      organizationId: context?.organizationId,
      status: 'active',
    },
  });
  if (!staff) return invalid();
  const membership = await db.Membership.findOne({
    attributes: ['id', 'accountId', 'organizationId', 'role', 'staffId'],
    lock: queryLock(transaction, lock),
    transaction,
    where: {
      organizationId: context.organizationId,
      staffId: staff.id,
      status: 'active',
    },
  });
  if (!membership) return invalid();
  const account = await db.Account.findOne({
    attributes: ['id', 'staffId', 'status'],
    lock: queryLock(transaction, lock),
    transaction,
    where: {
      id: membership.accountId,
      staffId: staff.id,
      status: 'active',
    },
  });
  if (!account || !staffIdentityIsAuthoritative(account, membership, staff)) {
    return invalid();
  }
  if (membership.role !== 'owner') {
    const access = await db.MembershipClubAccess.findOne({
      attributes: ['membershipId', 'roleOverride'],
      lock: queryLock(transaction, lock),
      transaction,
      where: {
        clubId: context.clubId,
        membershipId: membership.id,
        organizationId: context.organizationId,
        status: 'active',
      },
    });
    if (!access || access.roleOverride === 'owner') return invalid();
  }
  return staff;
}

module.exports = {
  _private: {
    loadAuthoritativeMembership,
    positiveId,
    resolveLegacyContext,
    resolveRequestContext,
    staffIdentityIsAuthoritative,
  },
  bookingTenantWhere,
  resolveBookingAccessContext,
  resolveEligibleBookingStaff,
};
