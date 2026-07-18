'use strict';

const db = require('../../models');
const {
  requireExactSingletonDefault,
} = require('../tenant-enforcement/legacy-singleton');
const { TENANT_SCOPES } = require('../tenant-context/route-scope-declarations');
const {
  isTenantVisitsScannerEnabled,
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

async function resolveLegacyContext({ lock, transaction } = {}) {
  const singleton = await requireExactSingletonDefault({ lock, transaction });

  return Object.freeze({
    accountId: null,
    authority: 'legacy-default',
    clubId: singleton.clubId,
    membershipId: null,
    organizationId: singleton.organizationId,
    readScoped: false,
  });
}

async function resolveRequestContext(tenant, { lock, transaction } = {}) {
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

  const organization = await db.Organization.findOne({
    attributes: ['id'],
    lock: queryLock(transaction, lock),
    transaction,
    where: {
      id: positiveId(tenant.organizationId),
      status: 'active',
    },
  });
  if (!organization) throw safeTenantDenial();

  const membership = await db.Membership.findOne({
    attributes: ['id', 'accountId', 'organizationId', 'role'],
    lock: queryLock(transaction, lock),
    transaction,
    where: {
      accountId: positiveId(tenant.accountId),
      id: positiveId(tenant.membershipId),
      organizationId: organization.id,
      status: 'active',
    },
  });
  if (!membership) throw safeTenantDenial();

  const club = await db.Club.findOne({
    attributes: ['id', 'organizationId'],
    lock: queryLock(transaction, lock),
    transaction,
    where: {
      id: positiveId(tenant.clubId),
      organizationId: organization.id,
      status: 'active',
    },
  });
  if (!club) throw safeTenantDenial();

  if (membership.role !== 'owner') {
    const access = await db.MembershipClubAccess.findOne({
      attributes: ['membershipId'],
      lock: queryLock(transaction, lock),
      transaction,
      where: {
        clubId: club.id,
        membershipId: membership.id,
        organizationId: organization.id,
        status: 'active',
      },
    });
    if (!access) throw safeTenantDenial();
  }

  return Object.freeze({
    accountId: Number(membership.accountId),
    authority: 'request',
    clubId: Number(club.id),
    membershipId: Number(membership.id),
    organizationId: Number(organization.id),
    readScoped: true,
  });
}

async function resolveVisitAccessContext(authority, options = {}) {
  if (!isTenantVisitsScannerEnabled()) {
    return resolveLegacyContext(options);
  }
  return resolveRequestContext(authority, options);
}

function visitTenantWhere(context, values = {}, { force = false } = {}) {
  if (!context || (!context.readScoped && !force)) return values;
  return {
    ...values,
    clubId: context.clubId,
    organizationId: context.organizationId,
  };
}

module.exports = {
  _private: {
    positiveId,
    resolveLegacyContext,
    resolveRequestContext,
  },
  resolveVisitAccessContext,
  visitTenantWhere,
};
