'use strict';

const fs = require('node:fs');
const path = require('node:path');
const SequelizePackage = require('sequelize');

const SERVER_ROOT = path.resolve(__dirname, '../..');
const ACCEPTED_TENANT_SCHEMA_MIGRATION =
  '20260719220000-add-tenant-onboarding.js';

const ACCEPTED_TENANT_CAPABILITY_ENV = Object.freeze([
  'TENANT_CONTEXT_ENABLED',
  'TENANT_CACHE_REALTIME_ENABLED',
  'TENANT_FILES_WORKERS_ENABLED',
  'TENANT_PROVIDER_INTEGRATIONS_ENABLED',
  'TENANT_STAFF_ACCESS_ENABLED',
  'TENANT_CLIENTS_REFERENCES_ENABLED',
  'TENANT_VISITS_SCANNER_ENABLED',
  'TENANT_CLIENT_BASES_CALL_TASKS_ENABLED',
  'TENANT_BOOKINGS_COURTS_ENABLED',
  'TENANT_METHODOLOGY_SKILL_MAP_ENABLED',
  'TENANT_TRAINING_NOTES_PLANS_ENABLED',
  'TENANT_CLIENT_MONEY_INSTRUMENTS_ENABLED',
  'TENANT_SHIFTS_REPORTS_ENABLED',
  'TENANT_AUDIT_LOG_ENABLED',
  'TENANT_ONBOARDING_ENABLED',
]);

async function applyAcceptedTenantMigrations(
  queryInterface,
  { afterFile, throughFile = ACCEPTED_TENANT_SCHEMA_MIGRATION },
) {
  const migrations = fs
    .readdirSync(path.join(SERVER_ROOT, 'migrations'))
    .filter(
      (file) =>
        file.endsWith('.js') &&
        file.localeCompare(afterFile) > 0 &&
        file.localeCompare(throughFile) <= 0,
    )
    .sort();

  for (const file of migrations) {
    const [applied] = await queryInterface.sequelize.query(
      'SELECT name FROM SequelizeMeta WHERE name=:name LIMIT 1',
      {
        replacements: { name: file },
        type: SequelizePackage.QueryTypes.SELECT,
      },
    );
    if (applied) continue;
    const migration = require(path.join(SERVER_ROOT, 'migrations', file));
    await migration.up(queryInterface, SequelizePackage);
    await queryInterface.bulkInsert('SequelizeMeta', [{ name: file }]);
  }

  return migrations;
}

module.exports = {
  ACCEPTED_TENANT_CAPABILITY_ENV,
  ACCEPTED_TENANT_SCHEMA_MIGRATION,
  applyAcceptedTenantMigrations,
};
