'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const TEST_ROOT = path.resolve(__dirname, '..');
const CURRENT_SCHEMA_FIXTURES = Object.freeze({
  'provider-integrations/provider-integrations.db.test.js': Object.freeze({
    anchor: "db = require('../../models')",
    bridge: true,
    integration: true,
  }),
  'services/client-references-tenant.db.test.js': Object.freeze({
    anchor: 'const telegramConnection = await createConnection(',
    bridge: true,
    integration: true,
  }),
  'services/installation-management-security.db.test.js': Object.freeze({
    anchor: "db = require('../../models')",
    integration: true,
    operator: true,
  }),
  'services/installation-management.db.test.js': Object.freeze({
    anchor: "db = require('../../models')",
    integration: true,
    operator: true,
  }),
  'services/installation-provisioning.db.test.js': Object.freeze({
    anchor: "db = require('../../models')",
    operator: true,
  }),
  'tenant-enforcement/final-tenant-enforcement.db.test.js': Object.freeze({
    anchor: "rootDb = require('../../models')",
    integration: true,
  }),
  'tenant-enforcement/installation-backup-restore.db.test.js': Object.freeze({
    anchor: "rootDb = require('../../models')",
    integration: true,
  }),
  'tenant-enforcement/legacy-singleton.db.test.js': Object.freeze({
    anchor: "db = require('../../models')",
    integration: true,
  }),
});
const CURRENT_MODEL_CONSUMER_PATTERNS = Object.freeze([
  /provider-integrations\/(?:connection-service|operator-validation|rollout|runtime)/u,
  /src\/services\/installation-(?:management|operator-auth)\.service/u,
  /scripts\/tenant-backup-manifest/u,
  /\bdb\.IntegrationConnection\b/u,
  /\bdb\.Installation(?:MutationOperation|OperatorSession)\b/u,
]);

function listDbTests(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...listDbTests(absolute));
    if (entry.isFile() && entry.name.endsWith('.db.test.js')) files.push(absolute);
  }
  return files;
}

function relativeTestPath(file) {
  return path.relative(TEST_ROOT, file).split(path.sep).join('/');
}

function assertCallPrecedesAnchor(source, call, anchor, file) {
  const callIndex = source.indexOf(call);
  const anchorIndex = source.indexOf(anchor);
  assert.ok(callIndex >= 0, `${file} is missing ${call}`);
  assert.ok(anchorIndex >= 0, `${file} inventory anchor is stale: ${anchor}`);
  assert.ok(
    callIndex < anchorIndex,
    `${file} must assert its Feature 10.4 schema before current-model use`,
  );
}

test('current Feature 10.4 DB model consumers declare a current-schema bridge', () => {
  const detected = listDbTests(TEST_ROOT)
    .filter((file) => {
      const source = fs.readFileSync(file, 'utf8');
      return CURRENT_MODEL_CONSUMER_PATTERNS.some((pattern) => pattern.test(source));
    })
    .map(relativeTestPath)
    .sort();
  assert.deepEqual(
    detected,
    Object.keys(CURRENT_SCHEMA_FIXTURES).sort(),
    'Update the Feature 10.4 schema fixture inventory for every new current-model DB consumer',
  );

  for (const [file, contract] of Object.entries(CURRENT_SCHEMA_FIXTURES)) {
    const source = fs.readFileSync(path.join(TEST_ROOT, file), 'utf8');
    if (contract.bridge) {
      assert.match(source, /applyAcceptedTenantMigrations\s*\(/u, file);
      assert.match(
        source,
        /throughFile:\s*INSTALLATION_MANAGEMENT_MIGRATION_FILE/u,
        `${file} must bridge its current-model phase through Feature 10.4`,
      );
      assert.match(
        source,
        /BIRTH_DATE_MIGRATION_FILE\s*=\s*\n\s*'20260721100000-add-client-birth-date\.js'/u,
        `${file} must bridge its current-model phase through current main`,
      );
      assertCallPrecedesAnchor(
        source,
        'await applyTrackedMigration(queryInterface, BIRTH_DATE_MIGRATION_FILE);',
        contract.anchor,
        file,
      );
    } else {
      assert.match(source, /await migrateAll\s*\(/u, `${file} must apply the full schema`);
    }
    if (contract.integration) {
      assertCallPrecedesAnchor(
        source,
        'await assertFeature10_4IntegrationConnectionSchema(',
        contract.anchor,
        file,
      );
    }
    if (contract.operator) {
      assertCallPrecedesAnchor(
        source,
        'await assertFeature10_4InstallationOperatorSchema(',
        contract.anchor,
        file,
      );
    }
  }
});
