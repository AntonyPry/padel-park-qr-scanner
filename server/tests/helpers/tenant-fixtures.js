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

function mockExactSingletonDefault(db, { clubId = 1, organizationId = 1 } = {}) {
  const originalClubFindAll = db.Club.findAll;
  const originalOrganizationFindAll = db.Organization.findAll;
  db.Organization.findAll = async () => [{
    id: organizationId,
    slug: DEFAULT_ORGANIZATION_SLUG,
    status: 'active',
  }];
  db.Club.findAll = async () => [{
    id: clubId,
    organizationId,
    slug: DEFAULT_CLUB_SLUG,
    status: 'active',
  }];
  return () => {
    db.Club.findAll = originalClubFindAll;
    db.Organization.findAll = originalOrganizationFindAll;
  };
}

module.exports = {
  createActiveTrainingFixture,
  getDefaultOrganizationId,
  getDefaultTenantIds,
  mockExactSingletonDefault,
};
