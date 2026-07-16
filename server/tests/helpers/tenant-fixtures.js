'use strict';

const {
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

module.exports = { getDefaultOrganizationId };
