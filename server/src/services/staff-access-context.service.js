'use strict';

const db = require('../../models');
const {
  requireExactSingletonDefault,
} = require('../tenant-enforcement/legacy-singleton');
const { TENANT_SCOPES } = require('../tenant-context/route-scope-declarations');
const {
  isTenantStaffAccessEnabled,
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

async function resolveScopedContext(tenant, { lock, transaction }) {
  if (
    !tenant ||
    tenant.scope !== TENANT_SCOPES.ORGANIZATION ||
    !positiveId(tenant.accountId) ||
    !positiveId(tenant.membershipId) ||
    !positiveId(tenant.organizationId)
  ) {
    throw safeTenantDenial();
  }

  const organization = await db.Organization.findOne({
    lock: queryLock(transaction, lock),
    transaction,
    where: {
      id: positiveId(tenant.organizationId),
      status: 'active',
    },
  });
  if (!organization) throw safeTenantDenial();

  const membership = await db.Membership.findOne({
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

  return Object.freeze({
    accountId: Number(membership.accountId),
    membershipId: Number(membership.id),
    organizationId: Number(organization.id),
    scoped: true,
  });
}

async function resolveLegacyContext({ lock, transaction }) {
  const singleton = await requireExactSingletonDefault({
    lock,
    requireClub: false,
    transaction,
  });
  return Object.freeze({
    accountId: null,
    membershipId: null,
    organizationId: singleton.organizationId,
    scoped: false,
  });
}

async function resolveStaffAccessContext(tenant, options = {}) {
  if (isTenantStaffAccessEnabled()) {
    return resolveScopedContext(tenant, options);
  }
  return resolveLegacyContext(options);
}

module.exports = {
  _private: { positiveId, resolveLegacyContext, resolveScopedContext },
  resolveStaffAccessContext,
};
