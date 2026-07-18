'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { afterEach, beforeEach, test } = require('node:test');
const {
  REMOTE_HOST_PROOF,
  REMOTE_OPT_IN,
  REMOTE_PURPOSE_PROOF,
  REMOTE_PURPOSE_VALUE,
  assertSafeDatabaseHost,
  assertSafeEnvironment,
  commandsFor,
  disposableFullDatabaseName,
  parseArgs,
  prepareArtifactRoot,
  prepareFullDatabase,
  runRc,
} = require('../../scripts/run-final-tenant-rc');

let previousEnvironment;

beforeEach(() => {
  previousEnvironment = {
    DB_NAME: process.env.DB_NAME,
    DB_HOST: process.env.DB_HOST,
    NODE_ENV: process.env.NODE_ENV,
    [REMOTE_OPT_IN]: process.env[REMOTE_OPT_IN],
    [REMOTE_HOST_PROOF]: process.env[REMOTE_HOST_PROOF],
    [REMOTE_PURPOSE_PROOF]: process.env[REMOTE_PURPOSE_PROOF],
  };
  process.env.DB_NAME = 'setly_local_test';
  process.env.DB_HOST = '127.0.0.1';
  process.env.NODE_ENV = 'test';
});

afterEach(() => {
  for (const [name, value] of Object.entries(previousEnvironment)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

test('parses targeted/full RC modes and refuses unknown arguments', () => {
  assert.deepEqual(parseArgs([]), { full: false, output: null });
  assert.deepEqual(
    parseArgs(['--full', '--output=/tmp/setly-f9-rc-candidate']),
    { full: true, output: '/tmp/setly-f9-rc-candidate' },
  );
  assert.throws(() => parseArgs(['--tenant-selective']), /Unsupported/);
});

test('refuses production-like database and artifact targets', () => {
  assert.doesNotThrow(() =>
    assertSafeEnvironment({ output: '/tmp/setly-f9-rc-candidate' }),
  );
  process.env.DB_NAME = 'setly_production';
  assert.throws(
    () => assertSafeEnvironment({ output: '/tmp/setly-f9-rc-candidate' }),
    /production-like DB_NAME/,
  );
  process.env.DB_NAME = 'setly_local_test';
  for (const output of [
    '/tmp/release-candidate',
    '/tmp/setly-f9-rc-production',
    '/tmp/live/setly-f9-rc-candidate',
  ]) {
    assert.throws(
      () => assertSafeEnvironment({ output }),
      /must contain|production-like artifact/,
    );
  }
  process.env.NODE_ENV = 'production';
  assert.throws(
    () => assertSafeEnvironment({ output: '/tmp/setly-f9-rc-candidate' }),
    /NODE_ENV=production/,
  );
});

test('refuses non-loopback database hosts without three-part remote disposable proof', () => {
  process.env.DB_HOST = 'mysql.production.internal';
  assert.throws(() => assertSafeDatabaseHost(), /refuses production-like DB_HOST/);
  process.env[REMOTE_OPT_IN] = 'true';
  process.env[REMOTE_HOST_PROOF] = process.env.DB_HOST;
  process.env[REMOTE_PURPOSE_PROOF] = REMOTE_PURPOSE_VALUE;
  assert.throws(() => assertSafeDatabaseHost(), /refuses production-like DB_HOST/);
  process.env.DB_HOST = 'mysql.disposable.internal';
  process.env[REMOTE_HOST_PROOF] = 'mysql.other.internal';
  assert.throws(() => assertSafeDatabaseHost(), /refuses non-loopback DB_HOST/);
  process.env[REMOTE_HOST_PROOF] = process.env.DB_HOST;
  process.env[REMOTE_PURPOSE_PROOF] = 'generic-test';
  assert.throws(() => assertSafeDatabaseHost(), /refuses non-loopback DB_HOST/);
  process.env[REMOTE_PURPOSE_PROOF] = REMOTE_PURPOSE_VALUE;
  assert.equal(assertSafeDatabaseHost(), 'mysql.disposable.internal');
});

test('artifact target must be fresh, current-user-owned and non-symlink', () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'setly-f9-rc-unit-'));
  try {
    const fresh = path.join(parent, 'setly-f9-rc-fresh');
    assert.equal(prepareArtifactRoot({ output: fresh }), fresh);
    assert.ok(fs.lstatSync(fresh).isDirectory());
    assert.throws(
      () => prepareArtifactRoot({ output: fresh }),
      /must not pre-exist/,
    );
    const symlink = path.join(parent, 'setly-f9-rc-link');
    fs.symlinkSync(fresh, symlink);
    assert.throws(
      () => prepareArtifactRoot({ output: symlink }),
      /must not pre-exist or be a symlink/,
    );
  } finally {
    fs.rmSync(parent, { force: true, recursive: true });
  }
});

test('pre-existing disposable database collision is never dropped', async () => {
  let dropped = false;
  await assert.rejects(
    prepareFullDatabase('setly_f9_rc_full_collision', {
      async createFreshDisposableDatabase() {
        const error = new Error('already exists');
        error.code = 'TENANT_RC_DATABASE_COLLISION';
        throw error;
      },
      async dropDisposableDatabase() { dropped = true; },
    }),
    (error) => error.code === 'TENANT_RC_DATABASE_COLLISION',
  );
  assert.equal(dropped, false);
});

test('command failure drops only run-owned database and still writes report', async () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'setly-f9-rc-unit-'));
  const output = path.join(parent, 'setly-f9-rc-command-failure');
  const calls = [];
  try {
    const result = await runRc(
      { full: true, output },
      {
        databaseName: 'setly_f9_rc_full_unit_failure',
        dependencies: {
          connect(database) {
            calls.push(['connect', database]);
            return { close: async () => calls.push(['close', database]) };
          },
          async createFreshDisposableDatabase(database) {
            calls.push(['create', database]);
          },
          async dropDisposableDatabase(database) {
            calls.push(['drop', database]);
          },
          async migrateAll() { calls.push(['migrate']); },
          runCommand(step) {
            calls.push(['command', step.label]);
            return { status: 9 };
          },
        },
      },
    );
    assert.equal(result.status, 9);
    assert.equal(result.report.ok, false);
    assert.equal(result.report.database.cleanup, 'dropped');
    assert.equal(result.report.failedStep, 'final tenant direct-write/alias/route audit');
    assert.deepEqual(
      calls.filter(([operation]) => ['create', 'drop'].includes(operation)),
      [
        ['create', 'setly_f9_rc_full_unit_failure'],
        ['drop', 'setly_f9_rc_full_unit_failure'],
      ],
    );
    assert.deepEqual(
      JSON.parse(fs.readFileSync(result.reportPath, 'utf8')).database,
      result.report.database,
    );
  } finally {
    fs.rmSync(parent, { force: true, recursive: true });
  }
});

test('full RC uses a disposable database name and includes all release gates', () => {
  assert.match(
    disposableFullDatabaseName(),
    /^setly_f9_rc_full_[0-9]+_[0-9]+$/,
  );
  assert.deepEqual(
    commandsFor({ full: true }).map((step) => step.label),
    [
      'final tenant direct-write/alias/route audit',
      'serialized full server suite',
      'server typecheck',
      'OpenAPI/generated client regeneration',
      'OpenAPI/generated no-drift assertion',
      'strict onboarding audit',
      'full client tests',
      'client lint',
      'client build',
    ],
  );
});
