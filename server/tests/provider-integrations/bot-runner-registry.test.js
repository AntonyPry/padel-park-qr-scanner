'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { test } = require('node:test');

process.env.INTEGRATION_SECRETS_MASTER_KEY = crypto.randomBytes(32).toString('base64');
process.env.INTEGRATION_SECRETS_KEY_VERSION = 'registry-test-v1';

const { BotRunnerRegistry } = require('../../src/provider-integrations/bot-runner-registry');

function connection(clubId, token, provider = 'telegram') {
  return Object.freeze({
    clubId,
    connectionId: clubId,
    config: Object.freeze({}),
    organizationId: 10,
    provider,
    publicId: `ic_${String(clubId).padStart(32, '0')}`,
    secrets: Object.freeze({ botToken: token }),
  });
}

test('multi-Club bot registry isolates start failures and targeted restarts', async () => {
  const connections = [connection(1, 'telegram-token-a'), connection(2, 'telegram-token-b')];
  const events = [];
  const attempts = new Map();
  const registry = new BotRunnerRegistry({
    assertReady: async () => {},
    factories: {
      telegram: (item) => ({
        start: async () => {
          const count = (attempts.get(item.clubId) || 0) + 1;
          attempts.set(item.clubId, count);
          events.push(`start:${item.clubId}:${count}`);
          if (item.clubId === 1 && count === 1) throw new Error('isolated start failure');
        },
        stop: async () => events.push(`stop:${item.clubId}`),
      }),
    },
    listConnections: async () => connections,
    listIdentityRows: async () => [],
  });

  const started = await registry.startProvider('telegram');
  assert.deepEqual(started.map((item) => item.status), ['failed', 'started']);
  assert.deepEqual(registry.snapshot().map((item) => item.clubId), [2]);
  await registry.reconcile({ clubId: 1, organizationId: 10, provider: 'telegram' });
  assert.deepEqual(registry.snapshot().map((item) => item.clubId).sort(), [1, 2]);
  assert.equal(events.includes('stop:2'), false);
  await registry.reconcile({ clubId: 1, organizationId: 10, provider: 'telegram' });
  assert.equal(events.filter((item) => item === 'stop:1').length, 1);
  assert.equal(events.includes('stop:2'), false);
});

test('duplicate bot credential or provider identity fails before any runner starts', async () => {
  const calls = [];
  const duplicateCredentialRegistry = new BotRunnerRegistry({
    assertReady: async () => {},
    factories: { telegram: () => ({ start: async () => calls.push('start') }) },
    listConnections: async () => [
      connection(1, 'same-token'),
      connection(2, 'same-token'),
    ],
    listIdentityRows: async () => [],
  });
  await assert.rejects(
    duplicateCredentialRegistry.startProvider('telegram'),
    (error) => error.code === 'INTEGRATION_CREDENTIAL_DUPLICATE',
  );
  assert.deepEqual(calls, []);

  const duplicateIdentityRegistry = new BotRunnerRegistry({
    assertReady: async () => {},
    factories: { telegram: () => ({ start: async () => calls.push('start') }) },
    listConnections: async () => [
      connection(1, 'token-a'),
      connection(2, 'token-b'),
    ],
    listIdentityRows: async () => [
      { providerIdentityFingerprint: 'same-identity' },
      { providerIdentityFingerprint: 'same-identity' },
    ],
  });
  await assert.rejects(
    duplicateIdentityRegistry.startProvider('telegram'),
    (error) => error.code === 'INTEGRATION_CREDENTIAL_DUPLICATE',
  );
  assert.deepEqual(calls, []);
});

test('target runner stops before a failed reconciliation lookup', async () => {
  const events = [];
  const registry = new BotRunnerRegistry({
    assertReady: async () => {},
    factories: {
      telegram: (item) => ({
        start: async () => events.push(`start:${item.clubId}`),
        stop: async () => events.push(`stop:${item.clubId}`),
      }),
    },
    listConnections: async () => [connection(1, 'token-a')],
    listIdentityRows: async () => [],
  });
  await registry.startProvider('telegram');
  registry.listConnections = async () => {
    throw new Error('database unavailable');
  };

  await assert.rejects(
    registry.reconcile({ clubId: 1, organizationId: 10, provider: 'telegram' }),
    /database unavailable/u,
  );
  assert.deepEqual(events, ['start:1', 'stop:1']);
  assert.deepEqual(registry.snapshot(), []);
});
