'use strict';

const assert = require('node:assert/strict');
const { afterEach, test } = require('node:test');
const {
  buildCapabilityCallbackUrl,
  generateCallbackToken,
} = require('../../src/provider-integrations/beeline-callback');
const {
  cutoverBeelineCallback,
  parseArgs,
} = require('../../scripts/cutover-beeline-callback');

const ORIGINAL_ENV = {
  SETLY_BEELINE_CAPABILITY_CUTOVER_ENABLED:
    process.env.SETLY_BEELINE_CAPABILITY_CUTOVER_ENABLED,
  SETLY_ROLLOUT_MAINTENANCE_MODE: process.env.SETLY_ROLLOUT_MAINTENANCE_MODE,
};

afterEach(() => {
  for (const [name, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

function capabilityConnection() {
  return {
    clubId: 2,
    config: {
      callbackBaseUrl: 'https://setly.tech/api/integrations/beeline/events',
      webhookAuthMode: 'capability_uri',
    },
    organizationId: 1,
    provider: 'beeline',
    publicId: `ic_${'a'.repeat(32)}`,
    secrets: {
      apiToken: 'provider-api-token',
      callbackToken: generateCallbackToken(),
    },
  };
}

test('cutover CLI parser is exact and rejects unsupported or duplicate modes', () => {
  assert.deepEqual(parseArgs(['--dry-run']), { apply: false });
  assert.deepEqual(parseArgs(['--apply']), { apply: true });
  for (const args of [[], ['--output=x'], ['--apply', '--apply'], ['--apply', '--dry-run']]) {
    assert.throws(
      () => parseArgs(args),
      (error) => error.code === 'BEELINE_CUTOVER_ARGUMENT_INVALID',
    );
  }
});

test('dry-run resolves the exact capability connection without exposing its token', async () => {
  const connection = capabilityConnection();
  let subscribed = false;
  const result = await cutoverBeelineCallback({ apply: false }, {
    resolveConnection: async ({ connectionKey, provider, tenant }) => {
      assert.equal(connectionKey, 'default');
      assert.equal(provider, 'beeline');
      assert.deepEqual(tenant, { clubId: 2, organizationId: 1 });
      return connection;
    },
    resolveTenant: async () => ({ clubId: 2, organizationId: 1 }),
    subscribe: async () => { subscribed = true; },
  });
  assert.equal(subscribed, false);
  assert.equal(JSON.stringify(result).includes(connection.secrets.callbackToken), false);
  assert.match(result.callbackUrl, /beeline\/events\/\[redacted\]$/u);
});

test('apply requires the narrow full-stop exception and redacts provider response surfaces', async () => {
  const connection = capabilityConnection();
  const dependencies = {
    resolveConnection: async () => connection,
    resolveTenant: async () => ({ clubId: 2, organizationId: 1 }),
    subscribe: async () => ({
      callbackUrl: buildCapabilityCallbackUrl(connection),
      lastRequest: { url: buildCapabilityCallbackUrl(connection) },
      status: 'active',
    }),
  };
  await assert.rejects(
    cutoverBeelineCallback({ apply: true }, dependencies),
    (error) => error.code === 'BEELINE_CUTOVER_MAINTENANCE_REQUIRED',
  );
  process.env.SETLY_ROLLOUT_MAINTENANCE_MODE = 'full-stop';
  process.env.SETLY_BEELINE_CAPABILITY_CUTOVER_ENABLED = 'true';
  const result = await cutoverBeelineCallback({ apply: true }, dependencies);
  assert.equal(JSON.stringify(result).includes(connection.secrets.callbackToken), false);
  assert.equal(result.subscriptionStatus, 'active');
  assert.equal(Object.hasOwn(result, 'subscription'), false);
});
