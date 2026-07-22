'use strict';

const assert = require('node:assert/strict');

const INSTALLATION_MANAGEMENT_MIGRATION_FILE =
  '20260720220000-add-installation-operator-management.js';
const CURRENT_INTEGRATION_CONNECTION_COLUMNS = Object.freeze([
  'credentialFingerprint',
  'fingerprintKeyVersion',
  'providerIdentityFingerprint',
]);
const CURRENT_INSTALLATION_OPERATOR_TABLE_COLUMNS = Object.freeze({
  InstallationMutationOperations: Object.freeze([
    'action',
    'auditLogId',
    'clubId',
    'createdAt',
    'id',
    'idempotencyKeyHash',
    'organizationId',
    'payloadHash',
    'response',
    'updatedAt',
  ]),
  InstallationOperatorSessions: Object.freeze([
    'createdAt',
    'expiresAt',
    'id',
    'revokedAt',
    'sessionId',
    'updatedAt',
    'username',
  ]),
});

async function tableColumns(queryInterface, tableName) {
  const definition = await queryInterface.describeTable(tableName);
  return Object.keys(definition).sort();
}

async function assertFeature10_4IntegrationConnectionSchema(queryInterface) {
  const columns = await tableColumns(queryInterface, 'IntegrationConnections');
  const missing = CURRENT_INTEGRATION_CONNECTION_COLUMNS.filter(
    (column) => !columns.includes(column),
  );
  assert.deepEqual(
    missing,
    [],
    'Current-head DB fixture requires credentialFingerprint, providerIdentityFingerprint and fingerprintKeyVersion before using IntegrationConnection',
  );
}

async function assertFeature10_4InstallationOperatorSchema(queryInterface) {
  for (const [tableName, expectedColumns] of Object.entries(
    CURRENT_INSTALLATION_OPERATOR_TABLE_COLUMNS,
  )) {
    assert.deepEqual(
      await tableColumns(queryInterface, tableName),
      [...expectedColumns].sort(),
      `Current-head DB fixture requires the exact Feature 10.4 ${tableName} schema before using installation operator models`,
    );
  }
}

module.exports = {
  CURRENT_INSTALLATION_OPERATOR_TABLE_COLUMNS,
  CURRENT_INTEGRATION_CONNECTION_COLUMNS,
  INSTALLATION_MANAGEMENT_MIGRATION_FILE,
  assertFeature10_4InstallationOperatorSchema,
  assertFeature10_4IntegrationConnectionSchema,
};
