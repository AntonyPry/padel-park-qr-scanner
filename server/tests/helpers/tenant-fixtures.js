'use strict';

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

module.exports = { getDefaultOrganizationId, getDefaultTenantIds };
