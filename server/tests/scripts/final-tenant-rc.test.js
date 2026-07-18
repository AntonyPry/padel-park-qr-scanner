'use strict';

const assert = require('node:assert/strict');
const { afterEach, beforeEach, test } = require('node:test');
const {
  assertSafeEnvironment,
  commandsFor,
  disposableFullDatabaseName,
  parseArgs,
} = require('../../scripts/run-final-tenant-rc');

let previousEnvironment;

beforeEach(() => {
  previousEnvironment = {
    DB_NAME: process.env.DB_NAME,
    NODE_ENV: process.env.NODE_ENV,
  };
  process.env.DB_NAME = 'setly_local_test';
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
