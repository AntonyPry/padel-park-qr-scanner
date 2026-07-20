'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { afterEach, test } = require('node:test');

const {
  bootstrapProviderConnections,
} = require('../../scripts/bootstrap-provider-connections');
const {
  PROVIDER_PURPOSE,
} = require('../../src/provider-integrations/constants');

const ORIGINAL_ENV = {
  INTEGRATION_SECRETS_KEY_VERSION: process.env.INTEGRATION_SECRETS_KEY_VERSION,
  INTEGRATION_SECRETS_MASTER_KEY: process.env.INTEGRATION_SECRETS_MASTER_KEY,
};

afterEach(() => {
  for (const [name, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

function configureSecrets() {
  process.env.INTEGRATION_SECRETS_MASTER_KEY = Buffer.alloc(32, 71).toString('base64');
  process.env.INTEGRATION_SECRETS_KEY_VERSION = 'v1';
}

function definition(provider) {
  const secrets = provider === 'beeline'
    ? { apiToken: `${provider}-api-secret`, webhookSecret: `${provider}-webhook-secret` }
    : provider === 'evotor'
      ? { webhookSecret: `${provider}-webhook-secret` }
      : { botToken: `${provider}-bot-secret` };
  return {
    config: {},
    provider,
    publicId: `ic_${provider.charCodeAt(0).toString(16).padStart(2, '0').repeat(16)}`,
    required: Object.values(secrets),
    secrets,
  };
}

function connection(provider, id, overrides = {}) {
  return {
    clubId: 20,
    config: {},
    connectionKey: 'default',
    createdAt: '2026-07-20T05:00:00.000Z',
    id,
    metadata: { source: 'legacy_env_bootstrap' },
    organizationId: 10,
    provider,
    publicId: definition(provider).publicId,
    purpose: PROVIDER_PURPOSE[provider],
    secretCiphertext: `ciphertext-${provider}`,
    secretKeyVersion: 'v1',
    status: 'active',
    updatedAt: '2026-07-20T05:00:00.000Z',
    ...overrides,
  };
}

function fakeDatabase(initialRows = []) {
  let committedRows = initialRows.map((row) => ({ ...row }));
  let committedAttribution = [];
  let transactionCalls = 0;
  const models = {
    IntegrationConnection: {
      async findOne({ transaction, where }) {
        return transaction.rows.find((row) =>
          row.organizationId === where.organizationId &&
          row.clubId === where.clubId &&
          row.provider === where.provider &&
          row.connectionKey === where.connectionKey) || null;
      },
    },
    sequelize: {
      async transaction(callback) {
        transactionCalls += 1;
        const transaction = {
          attribution: [...committedAttribution],
          rows: committedRows.map((row) => ({ ...row })),
        };
        const result = await callback(transaction);
        committedRows = transaction.rows;
        committedAttribution = transaction.attribution;
        return result;
      },
    },
  };
  return {
    models,
    snapshot() {
      return {
        attribution: [...committedAttribution],
        rows: committedRows.map((row) => ({ ...row })),
        transactionCalls,
      };
    },
  };
}

function dependencies(database, { failCreateProvider, failReconcileProvider } = {}) {
  const reconciled = [];
  const created = [];
  return {
    create: async (payload, { transaction }) => {
      if (payload.provider === failCreateProvider) throw new Error('forced create failure');
      const row = connection(payload.provider, transaction.rows.length + 1, {
        config: payload.config,
        metadata: payload.metadata,
        publicId: payload.publicId,
      });
      transaction.rows.push(row);
      created.push(payload.provider);
      return row;
    },
    created,
    models: database.models,
    reconcile: async (snapshot, { transaction }) => {
      reconciled.push(snapshot.provider);
      transaction.attribution.push(snapshot.provider);
      if (snapshot.provider === failReconcileProvider) {
        throw new Error('forced reconciliation failure');
      }
      return { rows: 1 };
    },
    reconciled,
    resolveTenant: async () => ({ clubId: 20, organizationId: 10 }),
  };
}

test('bootstrap reconciles only beeline/evotor and never emits configured secrets', async () => {
  configureSecrets();
  const database = fakeDatabase();
  const deps = dependencies(database);
  const results = await bootstrapProviderConnections({
    ...deps,
    definitions: ['beeline', 'evotor', 'telegram', 'vk'].map(definition),
  });

  assert.deepEqual(deps.reconciled, ['beeline', 'evotor']);
  assert.deepEqual(deps.created, ['beeline', 'evotor', 'telegram', 'vk']);
  assert.equal(database.snapshot().rows.length, 4);
  const output = JSON.stringify(results);
  for (const secret of [
    'beeline-api-secret',
    'beeline-webhook-secret',
    'evotor-webhook-secret',
    'telegram-bot-secret',
    'vk-bot-secret',
    'ciphertext-',
  ]) assert.equal(output.includes(secret), false);
});

test('bootstrap rolls back connections and reconciliation as one configured batch', async () => {
  configureSecrets();
  for (const failure of [
    { failReconcileProvider: 'evotor' },
    { failCreateProvider: 'telegram' },
  ]) {
    const database = fakeDatabase();
    const deps = dependencies(database, failure);
    await assert.rejects(
      bootstrapProviderConnections({
        ...deps,
        definitions: ['beeline', 'evotor', 'telegram'].map(definition),
      }),
      /forced/u,
    );
    assert.deepEqual(database.snapshot().rows, []);
    assert.deepEqual(database.snapshot().attribution, []);
  }
});

test('bootstrap reuses an exact parent-like telegram partial row without mutation', async () => {
  configureSecrets();
  const existing = connection('telegram', 41, {
    config: { accepted: true },
    metadata: { source: 'legacy_env_bootstrap', retained: true },
    publicId: 'ic_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    secretCiphertext: 'retained-parent-ciphertext',
  });
  const fingerprint = JSON.stringify(existing);
  const database = fakeDatabase([existing]);
  const deps = dependencies(database);
  const results = await bootstrapProviderConnections({
    ...deps,
    definitions: ['telegram', 'vk'].map(definition),
  });

  assert.deepEqual(results.map(({ action, provider }) => ({ action, provider })), [
    { action: 'exists', provider: 'telegram' },
    { action: 'created', provider: 'vk' },
  ]);
  assert.deepEqual(deps.reconciled, []);
  assert.equal(JSON.stringify(database.snapshot().rows[0]), fingerprint);
  assert.equal(database.snapshot().rows.length, 2);
});

test('bootstrap secret preflight fails before opening a transaction', async () => {
  delete process.env.INTEGRATION_SECRETS_MASTER_KEY;
  delete process.env.INTEGRATION_SECRETS_KEY_VERSION;
  const database = fakeDatabase();
  await assert.rejects(
    bootstrapProviderConnections({
      ...dependencies(database),
      definitions: [definition('telegram')],
    }),
    (error) => error.code === 'INTEGRATION_SECRET_CONFIGURATION_INVALID',
  );
  assert.equal(database.snapshot().transactionCalls, 0);
  assert.deepEqual(database.snapshot().rows, []);
});

test('provider secret preflight CLI validates configuration without printing the key', () => {
  const masterKey = Buffer.alloc(32, 72).toString('base64');
  const script = path.resolve(__dirname, '../../scripts/preflight-provider-secrets.js');
  const valid = spawnSync(process.execPath, [script], {
    encoding: 'utf8',
    env: {
      ...process.env,
      INTEGRATION_SECRETS_KEY_VERSION: 'v1',
      INTEGRATION_SECRETS_MASTER_KEY: masterKey,
    },
  });
  assert.equal(valid.status, 0, valid.stderr);
  assert.equal(`${valid.stdout}\n${valid.stderr}`.includes(masterKey), false);
  assert.deepEqual(JSON.parse(valid.stdout.trim().split('\n').at(-1)), {
    keyVersion: 'v1',
    status: 'ok',
  });

  const invalid = spawnSync(process.execPath, [script], {
    encoding: 'utf8',
    env: {
      ...process.env,
      INTEGRATION_SECRETS_KEY_VERSION: 'v1',
      INTEGRATION_SECRETS_MASTER_KEY: 'not-canonical-base64',
    },
  });
  assert.notEqual(invalid.status, 0);
  assert.equal(`${invalid.stdout}\n${invalid.stderr}`.includes('not-canonical-base64'), false);
  assert.match(invalid.stderr, /INTEGRATION_SECRET_CONFIGURATION_INVALID/u);
});
