'use strict';

const db = require('../../models');
const {
  DEFAULT_CLUB_SLUG,
  DEFAULT_ORGANIZATION_SLUG,
} = require('../tenant-foundation/constants');
const { TENANT_SCOPES } = require('../tenant-context/route-scope-declarations');
const {
  isTenantOnboardingEnabled,
} = require('../tenant-context/capabilities');
const {
  isTrustedTenantContext,
  safeTenantDenial,
} = require('./tenant-context.service');

const resolvedContexts = new WeakSet();
let authorityResolverOverride = null;

function positiveId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function freezeContext(values) {
  const context = Object.freeze(values);
  resolvedContexts.add(context);
  return context;
}

function queryLock(transaction, lock) {
  return transaction && lock ? transaction.LOCK.SHARE : undefined;
}

function assertScope(scope) {
  if (![
    TENANT_SCOPES.MEMBERSHIP,
    TENANT_SCOPES.ORGANIZATION,
    TENANT_SCOPES.CLUB,
  ].includes(scope)) {
    throw safeTenantDenial();
  }
}

async function loadAuthority(actor, identifiers, scope, options = {}) {
  const lock = queryLock(options.transaction, options.lock);
  const accountId = positiveId(actor?.id);
  if (!accountId || positiveId(identifiers.accountId) !== accountId) {
    throw safeTenantDenial();
  }

  const organization = await db.Organization.findOne({
    attributes: ['id'],
    lock,
    transaction: options.transaction,
    where: {
      id: positiveId(identifiers.organizationId),
      status: 'active',
    },
  });
  const account = await db.Account.findOne({
    attributes: ['id', 'staffId', 'status'],
    lock,
    transaction: options.transaction,
    where: { id: accountId, status: 'active' },
  });
  if (!organization || !account) throw safeTenantDenial();

  const membership = await db.Membership.findOne({
    attributes: ['id', 'accountId', 'organizationId', 'role', 'staffId', 'status'],
    lock,
    transaction: options.transaction,
    where: {
      accountId,
      id: positiveId(identifiers.membershipId),
      organizationId: organization.id,
      status: 'active',
    },
  });
  if (!membership) throw safeTenantDenial();

  const accountStaffId = positiveId(account.staffId);
  const membershipStaffId = positiveId(membership.staffId);
  if (accountStaffId || membershipStaffId) {
    if (!accountStaffId || accountStaffId !== membershipStaffId) {
      throw safeTenantDenial();
    }
    const staff = await db.Staff.findOne({
      attributes: ['id'],
      lock,
      transaction: options.transaction,
      where: {
        id: membershipStaffId,
        organizationId: organization.id,
        status: 'active',
      },
    });
    if (!staff) throw safeTenantDenial();
  }

  let clubId = null;
  let effectiveRole = membership.role;
  if (scope === TENANT_SCOPES.CLUB) {
    clubId = positiveId(identifiers.clubId);
    const club = clubId && await db.Club.findOne({
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
        attributes: ['roleOverride'],
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

  return freezeContext({
    accountId,
    clubId,
    effectiveRole,
    membershipId: positiveId(membership.id),
    membershipRole: membership.role,
    organizationId: positiveId(organization.id),
    scope,
  });
}

async function resolveLegacyContext(actor, scope, options = {}) {
  const organization = await db.Organization.findOne({
    attributes: ['id'],
    transaction: options.transaction,
    where: { slug: DEFAULT_ORGANIZATION_SLUG, status: 'active' },
  });
  if (!organization) throw safeTenantDenial();
  const membership = await db.Membership.findOne({
    attributes: ['id'],
    transaction: options.transaction,
    where: {
      accountId: positiveId(actor?.id),
      organizationId: organization.id,
      status: 'active',
    },
  });
  if (!membership) throw safeTenantDenial();
  let clubId = null;
  if (scope === TENANT_SCOPES.CLUB) {
    const club = await db.Club.findOne({
      attributes: ['id'],
      transaction: options.transaction,
      where: {
        organizationId: organization.id,
        slug: DEFAULT_CLUB_SLUG,
        status: 'active',
      },
    });
    if (!club) throw safeTenantDenial();
    clubId = positiveId(club.id);
  }
  return loadAuthority(actor, {
    accountId: actor.id,
    clubId,
    membershipId: membership.id,
    organizationId: organization.id,
  }, scope, options);
}

async function resolveOnboardingAccessContext(actor, tenant, scope, options = {}) {
  assertScope(scope);
  if (authorityResolverOverride) {
    return authorityResolverOverride(actor, tenant, scope, options, freezeContext);
  }
  if (!isTenantOnboardingEnabled()) {
    return resolveLegacyContext(actor, scope, options);
  }
  if (
    !isTrustedTenantContext(tenant) ||
    !Object.isFrozen(tenant) ||
    tenant.scope !== scope
  ) {
    throw safeTenantDenial();
  }
  return loadAuthority(actor, tenant, scope, options);
}

function bindOnboardingActor(actor, context) {
  if (!resolvedContexts.has(context) || !Object.isFrozen(context)) {
    throw safeTenantDenial();
  }
  return Object.freeze({
    ...actor,
    id: context.accountId,
    role: context.scope === TENANT_SCOPES.CLUB
      ? context.effectiveRole
      : context.membershipRole,
  });
}

module.exports = {
  _private: {
    loadAuthority,
    positiveId,
    resolvedContexts,
    setAuthorityResolverOverride(resolver) {
      authorityResolverOverride = resolver || null;
    },
  },
  bindOnboardingActor,
  resolveOnboardingAccessContext,
};
