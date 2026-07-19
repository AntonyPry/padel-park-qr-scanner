'use strict';

const crypto = require('node:crypto');
const {
  DEFAULT_CLUB_SLUG,
  DEFAULT_ORGANIZATION_SLUG,
} = require('../../src/tenant-foundation/constants');

async function getDefaultOrganizationId(db) {
  const organization = await db.Organization.findOne({
    attributes: ['id'],
    where: { slug: DEFAULT_ORGANIZATION_SLUG },
  });
  if (!organization) {
    throw new Error('Default organization fixture is missing');
  }
  return Number(organization.id);
}

async function getDefaultTenantIds(db) {
  const organizationId = await getDefaultOrganizationId(db);
  const club = await db.Club.findOne({
    attributes: ['id'],
    where: {
      organizationId,
      slug: DEFAULT_CLUB_SLUG,
    },
  });
  if (!club) {
    throw new Error('Default club fixture is missing');
  }
  return { clubId: Number(club.id), organizationId };
}

async function createActiveTrainingFixture(
  db,
  { clubId, organizationId, role = 'owner' },
) {
  const suffix = `${process.pid}-${Date.now()}-${crypto.randomUUID()}`;
  const account = await db.Account.create({
    email: `training-fixture-${suffix}@setly.test`,
    passwordHash: 'test-only',
    role,
    status: 'active',
  });
  const membership = await db.Membership.create({
    accountId: account.id,
    organizationId,
    role,
    status: 'active',
  });
  const sessionId = crypto.randomUUID();
  const mode = await db.OnboardingTrainingMode.create({
    accountId: account.id,
    clubId,
    enabledAt: new Date(),
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    isEnabled: true,
    membershipId: membership.id,
    organizationId,
    role,
    sessionId,
  });
  return {
    account,
    membership,
    mode,
    ownership: {
      isTraining: true,
      trainingAccountId: account.id,
      trainingRole: role,
      trainingSessionId: sessionId,
    },
  };
}

function mockExactSingletonDefault(_db, { clubId = 1, organizationId = 1 } = {}) {
  const tenantFoundation = require('../../src/services/tenant-foundation.service');
  const originalLoader = tenantFoundation.loadTenantFoundationSnapshot;
  tenantFoundation.loadTenantFoundationSnapshot = async () => ({
    accesses: [],
    accounts: [{ id: 900001, role: 'owner', staffId: null, status: 'active' }],
    clubs: [{
      id: clubId,
      name: 'Setly test default',
      organizationId,
      slug: DEFAULT_CLUB_SLUG,
      status: 'active',
      timezone: 'Europe/Moscow',
    }],
    memberships: [{
      accountId: 900001,
      id: 900001,
      organizationId,
      role: 'owner',
      staffId: null,
      status: 'active',
    }],
    organizations: [{
      id: organizationId,
      name: 'Setly test default',
      slug: DEFAULT_ORGANIZATION_SLUG,
      status: 'active',
    }],
    staffIdentitySchema: 'ready',
    staffs: [],
  });
  return () => {
    tenantFoundation.loadTenantFoundationSnapshot = originalLoader;
  };
}

module.exports = {
  createActiveTrainingFixture,
  getDefaultOrganizationId,
  getDefaultTenantIds,
  mockExactSingletonDefault,
};
