'use strict';

const db = require('../../models');
const {
  requireExactSingletonDefault,
} = require('../tenant-enforcement/legacy-singleton');
const { TENANT_SCOPES } = require('../tenant-context/route-scope-declarations');
const {
  isTenantClientsReferencesEnabled,
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

function isProviderAuthority(authority) {
  return Boolean(
    authority &&
      positiveId(authority.connectionId) &&
      positiveId(authority.organizationId) &&
      positiveId(authority.clubId) &&
      authority.provider,
  );
}

async function resolveProviderContext(authority, { lock, transaction }) {
  const connection = await db.IntegrationConnection.unscoped().findOne({
    attributes: [
      'id',
      'organizationId',
      'clubId',
      'provider',
      'purpose',
      'connectionKey',
      'status',
    ],
    lock: queryLock(transaction, lock),
    transaction,
    where: {
      clubId: positiveId(authority.clubId),
      id: positiveId(authority.connectionId),
      organizationId: positiveId(authority.organizationId),
      provider: authority.provider,
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
      attributes: ['id'],
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

  return Object.freeze({
    accountId: null,
    authority: 'provider',
    clubId: Number(club.id),
    connectionId: Number(connection.id),
    membershipId: null,
    organizationId: Number(organization.id),
    provider: connection.provider,
    scoped: true,
  });
}

async function resolveRequestContext(tenant, { lock, transaction }) {
  if (
    !tenant ||
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

  let clubId = null;
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
        attributes: ['membershipId'],
        lock: queryLock(transaction, lock),
        transaction,
        where: {
          clubId,
          membershipId: membership.id,
          organizationId: organization.id,
          status: 'active',
        },
      });
      if (!access) throw safeTenantDenial();
    }
  }

  return Object.freeze({
    accountId: Number(membership.accountId),
    authority: 'request',
    clubId,
    connectionId: null,
    membershipId: Number(membership.id),
    organizationId: Number(organization.id),
    provider: null,
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
    authority: 'legacy-default',
    clubId: null,
    connectionId: null,
    membershipId: null,
    organizationId: singleton.organizationId,
    provider: null,
    scoped: false,
  });
}

async function resolveClientAccessContext(authority, options = {}) {
  if (!isTenantClientsReferencesEnabled()) {
    return resolveLegacyContext(options);
  }
  if (isProviderAuthority(authority)) {
    return resolveProviderContext(authority, options);
  }
  return resolveRequestContext(authority, options);
}

module.exports = {
  _private: {
    isProviderAuthority,
    positiveId,
    resolveLegacyContext,
    resolveProviderContext,
    resolveRequestContext,
  },
  resolveClientAccessContext,
};
