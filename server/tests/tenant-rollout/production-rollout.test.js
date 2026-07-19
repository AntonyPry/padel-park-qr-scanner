'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  ROLLOUT_MAINTENANCE_ENV,
  TENANT_ROLLOUT_STAGES,
  digestJson,
  evaluateCapabilityStage,
  validateRolloutMaintenanceConfiguration,
} = require('../../src/tenant-rollout/contract');
const {
  rolloutMaintenanceGate,
} = require('../../src/middleware/rollout-maintenance');
const {
  PRESERVATION_SCHEMA,
  PRESERVATION_SCHEMA_VERSION,
  compareInstallationIdentitySnapshots,
} = require('../../src/tenant-rollout/preservation-evidence');
const {
  assertUniqueArtifactRoots,
  mutationSourcesCheck,
  parseArgs,
  provisioningCheck,
  reportChecks,
  validatePriorReport,
} = require('../../scripts/tenant-production-rollout');
const createApp = require('../../src/app');
const { rolloutSocketMaintenanceGate } = require('../../src/sockets');

function capabilityEnv(stageId) {
  const through = stageId === 'schema-off'
    ? -1
    : TENANT_ROLLOUT_STAGES.findIndex((stage) => stage.id === stageId);
  return Object.fromEntries(TENANT_ROLLOUT_STAGES.map((stage, index) => [
    stage.env,
    index <= through ? 'true' : 'false',
  ]));
}

function snapshot(tables) {
  return {
    schema: PRESERVATION_SCHEMA,
    schemaVersion: PRESERVATION_SCHEMA_VERSION,
    tables,
  };
}

test('capability rollout accepts only the exact dependency prefix', () => {
  const accepted = evaluateCapabilityStage(
    capabilityEnv('bookings-courts'),
    'bookings-courts',
  );
  assert.equal(accepted.ok, true);

  const gap = capabilityEnv('bookings-courts');
  gap.TENANT_VISITS_SCANNER_ENABLED = 'false';
  const rejectedGap = evaluateCapabilityStage(gap, 'bookings-courts');
  assert.equal(rejectedGap.ok, false);
  assert.equal(
    rejectedGap.findings.some((finding) =>
      finding.code === 'TENANT_ROLLOUT_REQUIRED_FLAG_DISABLED'),
    true,
  );

  const later = capabilityEnv('context');
  later.TENANT_ENFORCEMENT_ENABLED = 'true';
  const rejectedLater = evaluateCapabilityStage(later, 'context');
  assert.equal(rejectedLater.ok, false);
  assert.equal(
    rejectedLater.findings.some((finding) =>
      finding.code === 'TENANT_ROLLOUT_LATER_FLAG_ENABLED'),
    true,
  );
});

test('rollout gate refuses implicit or malformed capability flags', () => {
  const missing = capabilityEnv('schema-off');
  delete missing.TENANT_CONTEXT_ENABLED;
  assert.equal(evaluateCapabilityStage(missing, 'schema-off').ok, false);

  const malformed = capabilityEnv('schema-off');
  malformed.TENANT_CONTEXT_ENABLED = 'enabled';
  assert.equal(evaluateCapabilityStage(malformed, 'schema-off').ok, false);
});

test('rollout requires installation provisioning to be explicitly disabled', () => {
  assert.equal(provisioningCheck({ INSTALLATION_PROVISIONING_ENABLED: 'false' }).ok, true);
  assert.equal(provisioningCheck({ INSTALLATION_PROVISIONING_ENABLED: 'true' }).ok, false);
  assert.equal(provisioningCheck({}).ok, false);
});

test('rollout requires bots and background runners to stay explicitly disabled', () => {
  assert.equal(mutationSourcesCheck({
    BACKGROUND_RUNNERS_ENABLED: 'false',
    BOTS_ENABLED: 'off',
  }).ok, true);
  assert.equal(mutationSourcesCheck({
    BACKGROUND_RUNNERS_ENABLED: 'false',
    BOTS_ENABLED: 'true',
  }).ok, false);
  assert.equal(mutationSourcesCheck({}).ok, false);
});

test('maintenance mode is explicit and blocks every API path except health/openapi', () => {
  const previous = process.env[ROLLOUT_MAINTENANCE_ENV];
  process.env[ROLLOUT_MAINTENANCE_ENV] = 'full-stop';
  try {
    assert.equal(validateRolloutMaintenanceConfiguration().active, true);
    let nextCalled = false;
    const response = {
      body: null,
      headers: {},
      set(name, value) { this.headers[name] = value; return this; },
      status(value) { this.statusCode = value; return this; },
      json(value) { this.body = value; return this; },
    };
    rolloutMaintenanceGate(
      { method: 'GET', path: '/clients' },
      response,
      () => { nextCalled = true; },
    );
    assert.equal(nextCalled, false);
    assert.equal(response.statusCode, 503);
    assert.equal(response.body.code, 'ROLLOUT_MAINTENANCE_ACTIVE');

    rolloutMaintenanceGate(
      { method: 'GET', path: '/health' },
      response,
      () => { nextCalled = true; },
    );
    assert.equal(nextCalled, true);
  } finally {
    if (previous === undefined) delete process.env[ROLLOUT_MAINTENANCE_ENV];
    else process.env[ROLLOUT_MAINTENANCE_ENV] = previous;
  }
});

test('full-stop is mounted before provider ingress and authenticated API routes', async () => {
  const previous = process.env[ROLLOUT_MAINTENANCE_ENV];
  process.env[ROLLOUT_MAINTENANCE_ENV] = 'full-stop';
  const server = createApp().listen(0, '127.0.0.1');
  try {
    await new Promise((resolve, reject) => {
      server.once('listening', resolve);
      server.once('error', reject);
    });
    const { port } = server.address();
    for (const target of [
      '/api/webhooks/evotor/forged-public-id',
      '/api/auth/login',
    ]) {
      const response = await fetch(`http://127.0.0.1:${port}${target}`, {
        body: '{}',
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      });
      assert.equal(response.status, 503);
      assert.equal((await response.json()).code, 'ROLLOUT_MAINTENANCE_ACTIVE');
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (previous === undefined) delete process.env[ROLLOUT_MAINTENANCE_ENV];
    else process.env[ROLLOUT_MAINTENANCE_ENV] = previous;
  }
});

test('full-stop rejects new Socket.IO handshakes before tenant or auth reads', () => {
  const previous = process.env[ROLLOUT_MAINTENANCE_ENV];
  process.env[ROLLOUT_MAINTENANCE_ENV] = 'full-stop';
  try {
    let error;
    rolloutSocketMaintenanceGate({}, (received) => { error = received; });
    assert.equal(error.message, 'ROLLOUT_MAINTENANCE_ACTIVE');
    assert.equal(error.data.code, 'ROLLOUT_MAINTENANCE_ACTIVE');
    assert.equal(error.data.status, 503);
  } finally {
    if (previous === undefined) delete process.env[ROLLOUT_MAINTENANCE_ENV];
    else process.env[ROLLOUT_MAINTENANCE_ENV] = previous;
  }
});

test('maintenance configuration fails closed on ambiguous values', () => {
  assert.throws(
    () => validateRolloutMaintenanceConfiguration({
      [ROLLOUT_MAINTENANCE_ENV]: 'true',
    }),
    (error) => error.code === 'ROLLOUT_MAINTENANCE_CONFIGURATION_INVALID',
  );
});

test('preservation evidence proves business row identity and ignores control backfill', () => {
  const before = snapshot([
    {
      controlTable: false,
      preservedColumns: ['id', 'name'],
      preservedDataDigest: 'clients-data',
      primaryKeyColumns: ['id'],
      primaryKeyDigest: 'clients',
      rowCount: 8,
      tableName: 'Users',
    },
    {
      controlTable: true,
      preservedColumns: ['id'],
      preservedDataDigest: 'empty-control',
      preservedRowDigests: [],
      primaryKeyColumns: ['id'],
      primaryKeyDigest: null,
      rowCount: 0,
      tableName: 'Organizations',
    },
  ]);
  const after = snapshot([
    {
      controlTable: false,
      preservedColumns: ['id', 'name'],
      preservedDataDigest: 'clients-data',
      primaryKeyColumns: ['id'],
      primaryKeyDigest: 'clients',
      rowCount: 8,
      tableName: 'Users',
    },
    {
      controlTable: true,
      preservedColumns: ['id'],
      preservedDataDigest: 'backfilled-control',
      preservedRowDigests: ['default-org'],
      primaryKeyColumns: ['id'],
      primaryKeyDigest: 'default-org',
      rowCount: 1,
      tableName: 'Organizations',
    },
  ]);
  const accepted = compareInstallationIdentitySnapshots(before, after);
  assert.equal(accepted.ok, true);
  assert.equal(accepted.preservedRows, 8);

  after.tables[0].primaryKeyDigest = 'changed';
  const rejected = compareInstallationIdentitySnapshots(before, after);
  assert.equal(rejected.ok, false);
  assert.equal(rejected.findings[0].code, 'ROLLOUT_PRIMARY_KEY_SET_CHANGED');

  after.tables[0].primaryKeyDigest = 'clients';
  after.tables[0].preservedDataDigest = 'changed-data';
  const rejectedHistoricalMutation = compareInstallationIdentitySnapshots(before, after);
  assert.equal(rejectedHistoricalMutation.ok, false);
  assert.equal(
    rejectedHistoricalMutation.findings[0].code,
    'ROLLOUT_HISTORICAL_DATA_CHANGED',
  );

  const preexistingControlBefore = snapshot([{
    controlTable: true,
    preservedColumns: ['id', 'provider'],
    preservedDataDigest: 'connection-data',
    preservedRowDigests: ['connection-row'],
    primaryKeyColumns: ['id'],
    primaryKeyDigest: 'connection-id',
    rowCount: 1,
    tableName: 'IntegrationConnections',
  }]);
  const preexistingControlAfter = snapshot([{
    ...preexistingControlBefore.tables[0],
    preservedDataDigest: 'changed-connection-data',
    preservedRowDigests: ['changed-connection-row', 'new-connection-row'],
    rowCount: 2,
  }]);
  const rejectedControlMutation = compareInstallationIdentitySnapshots(
    preexistingControlBefore,
    preexistingControlAfter,
  );
  assert.equal(rejectedControlMutation.ok, false);
  assert.equal(
    rejectedControlMutation.findings[0].code,
    'ROLLOUT_PREEXISTING_CONTROL_DATA_CHANGED',
  );
});

test('CLI parser and report chain require successful immutable prior evidence', () => {
  assert.deepEqual(
    parseArgs(['--phase=stage', '--stage', 'context', '--output=/tmp/out.json']),
    { phase: 'stage', stage: 'context', output: '/tmp/out.json' },
  );
  const prior = {
    generatedAt: '2026-07-19T00:00:00.000Z',
    git: {
      actual: 'a'.repeat(40),
      clean: true,
      expected: 'a'.repeat(40),
      ok: true,
    },
    ok: true,
    phase: 'post-migrations',
    schema: 'setly.tenant-production-rollout-gate',
    schemaVersion: 1,
  };
  prior.evidenceDigest = digestJson({
    ...prior,
    evidenceDigest: undefined,
  });
  assert.equal(validatePriorReport(prior, 'post-migrations'), prior);
  assert.throws(() => validatePriorReport({ ...prior, ok: false }, 'post-migrations'));
  assert.throws(
    () => validatePriorReport({ ...prior, generatedAt: 'tampered' }, 'post-migrations'),
    (error) => error.code === 'TENANT_ROLLOUT_EVIDENCE_DIGEST_INVALID',
  );
  assert.equal(reportChecks({ git: { ok: true }, maintenance: { ok: true } }), true);
  assert.equal(reportChecks({ git: { ok: false }, maintenance: { ok: true } }), false);
  assert.throws(
    () => assertUniqueArtifactRoots([
      ['database', __filename],
      ['tenant-storage', __filename],
    ]),
    (error) => error.code === 'ROLLOUT_BACKUP_ARTIFACT_PATH_COLLISION',
  );
});
