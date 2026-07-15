'use strict';

const assert = require('node:assert/strict');
const { afterEach, test } = require('node:test');
const {
  buildProviderIdempotencyKey,
  buildProviderNamespace,
} = require('../../src/provider-integrations/idempotency');
const {
  providerLockName,
  withLocalProviderConnectionLock,
} = require('../../src/provider-integrations/locks');
const {
  decryptSecretBundle,
  encryptSecretBundle,
} = require('../../src/provider-integrations/secrets');
const {
  redactProviderCredentials,
} = require('../../src/provider-integrations/redaction');
const {
  runIsolatedProviderConnections,
} = require('../../src/provider-integrations/runner');
const {
  normalizeSafeObject,
  serializeConnection,
} = require('../../src/provider-integrations/connection-service');

const originalKey = process.env.INTEGRATION_SECRETS_MASTER_KEY;

afterEach(() => {
  if (originalKey === undefined) delete process.env.INTEGRATION_SECRETS_MASTER_KEY;
  else process.env.INTEGRATION_SECRETS_MASTER_KEY = originalKey;
});

function context(overrides = {}) {
  return {
    clubId: 3,
    connectionId: 7,
    organizationId: 2,
    provider: 'beeline',
    publicId: 'ic_0123456789abcdef0123456789abcdef',
    ...overrides,
  };
}

test('encrypted secret bundle uses authenticated ciphertext and never serializes plaintext', () => {
  process.env.INTEGRATION_SECRETS_MASTER_KEY = Buffer.alloc(32, 7).toString('base64');
  const identity = context();
  const encrypted = encryptSecretBundle(
    { apiToken: 'api-token-value', webhookSecret: 'webhook-secret-value' },
    identity,
  );
  assert.equal(encrypted.includes('api-token-value'), false);
  assert.equal(encrypted.includes('webhook-secret-value'), false);
  assert.deepEqual(
    decryptSecretBundle(encrypted, identity),
    { apiToken: 'api-token-value', webhookSecret: 'webhook-secret-value' },
  );
  assert.throws(
    () => decryptSecretBundle(encrypted, context({ publicId: 'ic_fedcba9876543210fedcba9876543210' })),
    (error) => error.code === 'INTEGRATION_SECRET_DECRYPTION_FAILED',
  );
});

test('public serialization and safe config reject credential-shaped fields', () => {
  const serialized = serializeConnection({
    clubId: 3,
    config: { apiBaseUrl: 'https://provider.example' },
    connectionKey: 'default',
    id: 7,
    metadata: { label: 'Primary' },
    organizationId: 2,
    provider: 'beeline',
    publicId: context().publicId,
    purpose: 'telephony',
    secretCiphertext: 'must-not-leak',
    secretKeyVersion: 'v1',
    status: 'active',
  });
  assert.equal(JSON.stringify(serialized).includes('must-not-leak'), false);
  assert.equal(Object.hasOwn(serialized, 'secretCiphertext'), false);
  assert.throws(
    () => normalizeSafeObject({ nested: { apiToken: 'forged' } }, 'config'),
    (error) => error.code === 'INTEGRATION_CONNECTION_CONFIG_CONTAINS_SECRET',
  );
});

test('raw provider redaction removes credentials without destroying business contact fields', () => {
  const redacted = redactProviderCredentials({
    authorization: 'Bearer provider-secret',
    client: { email: 'client@example.test', phone: '+79990000000' },
    nested: { apiToken: 'provider-token', eventId: 'evt-1' },
  });
  assert.deepEqual(redacted, {
    authorization: '[redacted]',
    client: { email: 'client@example.test', phone: '+79990000000' },
    nested: { apiToken: '[redacted]', eventId: 'evt-1' },
  });
  assert.equal(JSON.stringify(redacted).includes('provider-secret'), false);
  assert.equal(JSON.stringify(redacted).includes('provider-token'), false);
});

test('idempotency and lock namespaces include provider, tenant and connection', () => {
  const first = context();
  const otherConnection = context({ connectionId: 8 });
  const otherClub = context({ clubId: 4 });
  assert.equal(buildProviderIdempotencyKey(first, 'external-1'), buildProviderIdempotencyKey(first, 'external-1'));
  assert.notEqual(buildProviderIdempotencyKey(first, 'external-1'), buildProviderIdempotencyKey(otherConnection, 'external-1'));
  assert.notEqual(buildProviderIdempotencyKey(first, 'external-1'), buildProviderIdempotencyKey(otherClub, 'external-1'));
  assert.notEqual(buildProviderNamespace(first), buildProviderNamespace(otherConnection));
  assert.notEqual(providerLockName(first), providerLockName(otherClub));
  assert.ok(providerLockName(first).length <= 64);
});

test('same connection serializes while different clubs can progress independently', async () => {
  const first = context();
  const otherClub = context({ clubId: 4, connectionId: 9 });
  const order = [];
  let releaseFirst;
  const gate = new Promise((resolve) => { releaseFirst = resolve; });
  const firstRun = withLocalProviderConnectionLock(first, async () => {
    order.push('first-start');
    await gate;
    order.push('first-end');
  });
  const sameRun = withLocalProviderConnectionLock(first, async () => order.push('same'));
  const parallelRun = withLocalProviderConnectionLock(otherClub, async () => order.push('parallel'));
  await parallelRun;
  assert.deepEqual(order, ['first-start', 'parallel']);
  releaseFirst();
  await Promise.all([firstRun, sameRun]);
  assert.deepEqual(order, ['first-start', 'parallel', 'first-end', 'same']);
});

test('provider runner isolates a failed connection and never returns its secret bundle', async () => {
  const connections = [
    { ...context(), secrets: { apiToken: 'must-not-leak' } },
    { ...context({ clubId: 4, connectionId: 8, publicId: 'ic_fedcba9876543210fedcba9876543210' }), secrets: {} },
  ];
  const visited = [];
  const results = await runIsolatedProviderConnections(connections, async (connection) => {
    visited.push(connection.connectionId);
    if (connection.connectionId === 7) throw new Error('must-not-leak');
    return { action: 'processed' };
  });
  assert.deepEqual(visited.sort(), [7, 8]);
  assert.deepEqual(results.map((result) => result.action), ['failed', 'processed']);
  assert.equal(JSON.stringify(results).includes('must-not-leak'), false);
});
