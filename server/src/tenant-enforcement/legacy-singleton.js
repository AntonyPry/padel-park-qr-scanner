'use strict';

const {
  DEFAULT_CLUB_SLUG,
  DEFAULT_ORGANIZATION_SLUG,
} = require('../tenant-foundation/constants');

class TenantSingletonRequiredError extends Error {
  constructor(details) {
    super('Legacy tenant bridge requires exactly one initialized default tenant');
    this.name = 'TenantSingletonRequiredError';
    this.code = 'TENANT_SINGLE_DEFAULT_REQUIRED';
    this.statusCode = 503;
    this.details = details;
  }
}

function queryLock(transaction, lock) {
  return transaction && lock ? transaction.LOCK.SHARE : undefined;
}

async function requireExactSingletonDefault({
  lock = false,
  models = null,
  requireClub = true,
  transaction,
} = {}) {
  const db = models || require('../../models');
  const modelOptions = {
    lock: queryLock(transaction, lock),
    transaction,
  };
  const [organizations, clubs] = await Promise.all([
    db.Organization.findAll({
      ...modelOptions,
      attributes: ['id', 'slug', 'status'],
      order: [['id', 'ASC']],
    }),
    db.Club.findAll({
      ...modelOptions,
      attributes: ['id', 'organizationId', 'slug', 'status'],
      order: [['id', 'ASC']],
    }),
  ]);
  const organization = organizations[0] || null;
  const club = clubs[0] || null;
  const validOrganization = Boolean(
    organizations.length === 1 &&
      organization.slug === DEFAULT_ORGANIZATION_SLUG &&
      organization.status === 'active',
  );
  const validClub = Boolean(
    clubs.length === 1 &&
      club.slug === DEFAULT_CLUB_SLUG &&
      club.status === 'active' &&
      Number(club.organizationId) === Number(organization?.id),
  );

  if (!validOrganization || (requireClub && !validClub)) {
    throw new TenantSingletonRequiredError({
      clubCount: clubs.length,
      organizationCount: organizations.length,
      requireClub,
    });
  }

  return Object.freeze({
    clubId: validClub ? Number(club.id) : null,
    organizationId: Number(organization.id),
  });
}

module.exports = {
  TenantSingletonRequiredError,
  requireExactSingletonDefault,
};
