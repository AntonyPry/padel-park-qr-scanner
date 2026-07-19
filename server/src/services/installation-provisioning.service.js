'use strict';

const db = require('../../models');
const {
  assertTenantFoundationInitialized,
} = require('./tenant-foundation.service');
const {
  isTenantEnforcementEnabled,
} = require('../tenant-context/capabilities');

async function getInstallationSnapshot() {
  if (!isTenantEnforcementEnabled()) {
    const error = new Error('Provisioning requires final tenant enforcement');
    error.code = 'TENANT_ENFORCEMENT_REQUIRED';
    error.statusCode = 503;
    throw error;
  }
  const classification = await assertTenantFoundationInitialized({ strict: true });
  const organizations = await db.Organization.findAll({
    attributes: ['id', 'name'],
    include: [
      {
        attributes: ['id'],
        model: db.Club,
        required: false,
      },
      {
        attributes: ['id'],
        model: db.Membership,
        required: false,
        where: { role: 'owner', status: 'active' },
      },
    ],
    order: [
      ['id', 'ASC'],
      [db.Club, 'id', 'ASC'],
    ],
  });

  return {
    foundation: {
      state: classification.state,
    },
    organizations: organizations.map((organization) => ({
      clubCount: (organization.Clubs || []).length,
      id: organization.id,
      name: organization.name,
      ownerCount: (organization.Memberships || []).length,
    })),
  };
}

module.exports = { getInstallationSnapshot };
