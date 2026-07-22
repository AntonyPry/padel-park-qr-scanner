'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { test } = require('node:test');
const mysql = require('mysql2/promise');
const SequelizePackage = require('sequelize');

const SERVER_ROOT = path.resolve(__dirname, '../..');
const FEATURE_MIGRATION = require('../../migrations/20260715160000-add-tenant-provider-integrations');
const HARDENING_MIGRATION = require('../../migrations/20260716100000-harden-tenant-provider-integrations');
const VALIDATION_MIGRATION = require(
  '../../migrations/20260716120000-validate-provider-reconciliation-connections'
);
const PROVIDER_VALIDATION_MIGRATION_FILE =
  '20260716120000-validate-provider-reconciliation-connections.js';
const BIRTH_DATE_MIGRATION_FILE =
  '20260721100000-add-client-birth-date.js';
const {
  ACCEPTED_TENANT_CAPABILITY_ENV,
  applyAcceptedTenantMigrations,
} = require('../helpers/accepted-tenant-schema');
const {
  INSTALLATION_MANAGEMENT_MIGRATION_FILE,
  assertFeature10_4IntegrationConnectionSchema,
} = require('../helpers/feature-10-4-schema');

function databaseName() {
  return process.env.TENANT_PROVIDER_TEST_DB_NAME ||
    `setly_tenant_provider_${process.pid}_${Date.now()}`;
}

function runProviderBootstrapPackage() {
  return spawnSync('npm', ['run', 'tenant:providers:bootstrap'], {
    cwd: SERVER_ROOT,
    encoding: 'utf8',
    env: process.env,
  });
}

function runBeelineCutoverPackage(mode) {
  return spawnSync('npm', ['run', 'tenant:providers:beeline:cutover', '--', mode], {
    cwd: SERVER_ROOT,
    encoding: 'utf8',
    env: process.env,
  });
}

function parseProviderBootstrapOutput(stdout) {
  const jsonStart = stdout.indexOf('{\n  "connections"');
  assert.ok(jsonStart >= 0, stdout);
  return JSON.parse(stdout.slice(jsonStart));
}

async function bulkCreateInBatches(Model, rows, size = 500) {
  for (let offset = 0; offset < rows.length; offset += size) {
    await Model.bulkCreate(rows.slice(offset, offset + size));
  }
}

async function migrateFresh(database) {
  const sequelize = new SequelizePackage.Sequelize(
    database,
    process.env.DB_USER,
    process.env.DB_PASSWORD,
    { dialect: 'mysql', host: '127.0.0.1', logging: false },
  );
  const queryInterface = sequelize.getQueryInterface();
  await queryInterface.createTable('SequelizeMeta', {
    name: {
      allowNull: false,
      primaryKey: true,
      type: SequelizePackage.STRING,
      unique: true,
    },
  });
  const migrations = fs.readdirSync(path.join(SERVER_ROOT, 'migrations'))
    .filter(
      (file) =>
        file.endsWith('.js') &&
        file.localeCompare(PROVIDER_VALIDATION_MIGRATION_FILE) <= 0,
    )
    .sort();
  for (const file of migrations) {
    const migration = require(path.join(SERVER_ROOT, 'migrations', file));
    await migration.up(queryInterface, SequelizePackage);
    await queryInterface.bulkInsert('SequelizeMeta', [{ name: file }]);
  }
  return sequelize;
}

async function applyTrackedMigration(queryInterface, file) {
  const [applied] = await queryInterface.sequelize.query(
    'SELECT name FROM SequelizeMeta WHERE name=:name LIMIT 1',
    {
      replacements: { name: file },
      type: SequelizePackage.QueryTypes.SELECT,
    },
  );
  if (applied) return;

  const migration = require(path.join(SERVER_ROOT, 'migrations', file));
  await migration.up(queryInterface, SequelizePackage);
  await queryInterface.bulkInsert('SequelizeMeta', [{ name: file }]);
}

function fakeResponse() {
  return {
    body: null,
    statusCode: 200,
    json(body) {
      this.body = body;
      return this;
    },
    send(body) {
      this.body = body;
      return this;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
  };
}

async function listen(app) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => resolve(server));
    server.once('error', reject);
  });
}

async function closeServer(server) {
  if (!server) return;
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}

test('Feature 4.3 DB security matrix isolates provider connections, ingress IDs and locks', async (t) => {
  assert.ok(process.env.DB_USER, 'DB_USER is required for DB-backed provider tests');
  const database = databaseName();
  const admin = await mysql.createConnection({
    host: '127.0.0.1',
    password: process.env.DB_PASSWORD,
    user: process.env.DB_USER,
  });
  await admin.query(`DROP DATABASE IF EXISTS \`${database}\``);
  await admin.query(
    `CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
  );

  const previous = {
    DB_NAME: process.env.DB_NAME,
    BEELINE_WEBHOOK_REQUIRE_SECRET: process.env.BEELINE_WEBHOOK_REQUIRE_SECRET,
    BEELINE_WEBHOOK_SECRET: process.env.BEELINE_WEBHOOK_SECRET,
    EVOTOR_WEBHOOK_LOG_RAW: process.env.EVOTOR_WEBHOOK_LOG_RAW,
    EVOTOR_WEBHOOK_SECRET: process.env.EVOTOR_WEBHOOK_SECRET,
    INTEGRATION_SECRETS_MASTER_KEY: process.env.INTEGRATION_SECRETS_MASTER_KEY,
    INTEGRATION_SECRETS_KEY_VERSION: process.env.INTEGRATION_SECRETS_KEY_VERSION,
    BEELINE_API_BASE_URL: process.env.BEELINE_API_BASE_URL,
    BEELINE_API_TOKEN: process.env.BEELINE_API_TOKEN,
    BEELINE_CALLBACK_URL: process.env.BEELINE_CALLBACK_URL,
    BOT_TOKEN: process.env.BOT_TOKEN,
    NODE_ENV: process.env.NODE_ENV,
    SETLY_BEELINE_CAPABILITY_CUTOVER_ENABLED:
      process.env.SETLY_BEELINE_CAPABILITY_CUTOVER_ENABLED,
    SETLY_ROLLOUT_MAINTENANCE_MODE: process.env.SETLY_ROLLOUT_MAINTENANCE_MODE,
    TENANT_CACHE_REALTIME_ENABLED: process.env.TENANT_CACHE_REALTIME_ENABLED,
    TENANT_CONTEXT_ENABLED: process.env.TENANT_CONTEXT_ENABLED,
    TENANT_FILES_WORKERS_ENABLED: process.env.TENANT_FILES_WORKERS_ENABLED,
    TENANT_PROVIDER_INTEGRATIONS_ENABLED: process.env.TENANT_PROVIDER_INTEGRATIONS_ENABLED,
    VK_TOKEN: process.env.VK_TOKEN,
  };
  for (const name of ACCEPTED_TENANT_CAPABILITY_ENV) {
    if (!Object.hasOwn(previous, name)) previous[name] = process.env[name];
  }
  previous.TENANT_ENFORCEMENT_ENABLED = process.env.TENANT_ENFORCEMENT_ENABLED;
  process.env.DB_NAME = database;
  process.env.NODE_ENV = 'test';
    process.env.INTEGRATION_SECRETS_MASTER_KEY = Buffer.alloc(32, 11).toString('base64');
    process.env.INTEGRATION_SECRETS_KEY_VERSION = 'v1';
  process.env.TENANT_CONTEXT_ENABLED = 'true';
  process.env.TENANT_CACHE_REALTIME_ENABLED = 'true';
  process.env.TENANT_FILES_WORKERS_ENABLED = 'true';
  process.env.TENANT_PROVIDER_INTEGRATIONS_ENABLED = 'true';
  process.env.BEELINE_WEBHOOK_REQUIRE_SECRET = 'true';
  process.env.BEELINE_WEBHOOK_SECRET = 'legacy-beeline-smoke-secret';
  process.env.EVOTOR_WEBHOOK_SECRET = 'legacy-evotor-smoke-secret';

  let schemaSequelize;
  let db;
  let apiServer;
  let providerServer;
  try {
    schemaSequelize = await migrateFresh(database);
    const queryInterface = schemaSequelize.getQueryInterface();

    await t.test('migrations roll back and reapply before provider rows exist', async () => {
      await VALIDATION_MIGRATION.down(queryInterface, SequelizePackage);
      await HARDENING_MIGRATION.down(queryInterface, SequelizePackage);
      await FEATURE_MIGRATION.down(queryInterface, SequelizePackage);
      assert.equal(
        (await queryInterface.showAllTables()).includes('IntegrationConnections'),
        false,
      );
      await FEATURE_MIGRATION.up(queryInterface, SequelizePackage);
      await HARDENING_MIGRATION.up(queryInterface, SequelizePackage);
      await VALIDATION_MIGRATION.up(queryInterface, SequelizePackage);
      assert.equal(
        (await queryInterface.showAllTables()).includes('IntegrationConnections'),
        true,
      );
    });

    await applyAcceptedTenantMigrations(queryInterface, {
      afterFile: PROVIDER_VALIDATION_MIGRATION_FILE,
      throughFile: INSTALLATION_MANAGEMENT_MIGRATION_FILE,
    });
    await applyTrackedMigration(queryInterface, BIRTH_DATE_MIGRATION_FILE);
    assert.ok(
      (await queryInterface.describeTable('Users')).birthDate,
      'production-like schema must include Users.birthDate before current models load',
    );
    await assertFeature10_4IntegrationConnectionSchema(queryInterface);

    db = require('../../models');
    const {
      createConnection,
      contextWithSecrets,
      generatePublicId,
      resolveIngressConnection,
      serializeConnection,
    } = require('../../src/provider-integrations/connection-service');
    const {
      buildProviderIdempotencyKey,
      buildProviderNamespace,
    } = require('../../src/provider-integrations/idempotency');
    const {
      generateCallbackToken,
    } = require('../../src/provider-integrations/beeline-callback');
    const {
      withProviderConnectionLock,
    } = require('../../src/provider-integrations/locks');
    const {
      reconcileLegacyProviderRows,
    } = require('../../src/provider-integrations/rollout');
    const evotorService = require('../../src/services/evotor.service');
    const telephonyService = require('../../src/services/telephony.service');
    const tenantFoundation = require('../../src/services/tenant-foundation.service');
    const { tenantFoundationGate } = require('../../src/middleware/tenant-foundation-gate');
    for (const name of ACCEPTED_TENANT_CAPABILITY_ENV) process.env[name] = 'true';

    await t.test('bootstrap-pending blocks provider ingress before connection lookup', async () => {
      tenantFoundation.invalidateTenantFoundationGateCache();
      const response = fakeResponse();
      let nextCalled = false;
      await tenantFoundationGate(
        { method: 'POST', path: '/webhooks/evotor/ic_unknown' },
        response,
        () => { nextCalled = true; },
      );
      assert.equal(nextCalled, false);
      assert.equal(response.statusCode, 503);
      assert.equal(response.body.code, 'BOOTSTRAP_REQUIRED');
      await assert.rejects(
        telephonyService.maintainAllEventSubscriptions(),
        (error) => error.code === 'BOOTSTRAP_REQUIRED',
      );
    });

    const [[defaultOrganization]] = await db.sequelize.query(
      "SELECT id FROM Organizations WHERE slug = 'padel-park'",
    );
    const [[defaultClub]] = await db.sequelize.query(
      "SELECT id, organizationId FROM Clubs WHERE slug = 'padel-park'",
    );

    await db.sequelize.query(
      `INSERT INTO Accounts(email, passwordHash, role, status, createdAt, updatedAt)
       VALUES ('provider-smoke@example.test', 'not-used', 'owner', 'active', NOW(), NOW())`,
    );
    const [[ownerAccount]] = await db.sequelize.query(
      "SELECT id FROM Accounts WHERE email = 'provider-smoke@example.test'",
    );
    await db.sequelize.query(
      `INSERT INTO Memberships(organizationId, accountId, role, status, createdAt, updatedAt)
       VALUES (:organizationId, :accountId, 'owner', 'active', NOW(), NOW())`,
      {
        replacements: {
          accountId: Number(ownerAccount.id),
          organizationId: Number(defaultOrganization.id),
        },
      },
    );
    tenantFoundation.invalidateTenantFoundationGateCache();
    assert.equal((await tenantFoundation.assertTenantFoundationInitialized()).state, 'initialized');

    await t.test('exact package bootstrap creates configured provider set on empty singleton', async () => {
      const commandSecrets = [
        'empty-bootstrap-beeline-api',
        'empty-bootstrap-beeline-webhook',
        'empty-bootstrap-evotor',
        'empty-bootstrap-telegram',
      ];
      process.env.BEELINE_API_BASE_URL = 'https://provider.bootstrap.test';
      process.env.BEELINE_API_TOKEN = commandSecrets[0];
      process.env.BEELINE_CALLBACK_URL = 'https://setly.test/api/integrations/beeline/events';
      process.env.BEELINE_WEBHOOK_SECRET = commandSecrets[1];
      process.env.EVOTOR_WEBHOOK_SECRET = commandSecrets[2];
      process.env.BOT_TOKEN = commandSecrets[3];
      delete process.env.VK_TOKEN;

      const command = runProviderBootstrapPackage();
      assert.equal(command.status, 0, `${command.stdout}\n${command.stderr}`);
      const output = parseProviderBootstrapOutput(command.stdout);
      const actions = Object.fromEntries(output.connections.map((item) => [
        item.provider,
        item.action,
      ]));
      assert.deepEqual(actions, {
        beeline: 'created',
        evotor: 'created',
        telegram: 'created',
        vk: 'skipped',
      });
      assert.deepEqual(
        output.connections.find((item) => item.provider === 'telegram').reconciliation,
        {},
      );
      assert.equal(await db.IntegrationConnection.count(), 3);
      for (const secret of commandSecrets) {
        assert.equal(`${command.stdout}\n${command.stderr}`.includes(secret), false);
      }

      await db.sequelize.query('DELETE FROM IntegrationConnections');
      assert.equal(await db.IntegrationConnection.count(), 0);
      delete process.env.BEELINE_API_BASE_URL;
      delete process.env.BEELINE_API_TOKEN;
      delete process.env.BEELINE_CALLBACK_URL;
      delete process.env.BOT_TOKEN;
    });

    await t.test('capability bootstrap atomically reconciles the production-shaped 11,583 Beeline roots and is stable', async () => {
      const suffix = `production-shape-${process.pid}-${Date.now()}`;
      const tenant = {
        clubId: Number(defaultClub.id),
        organizationId: Number(defaultOrganization.id),
      };
      const legacyNamespace = buildProviderNamespace(null);
      await bulkCreateInBatches(
        db.TelephonyCall,
        Array.from({ length: 1467 }, (_, index) => ({
          ...tenant,
          externalCallId: `${suffix}-call-${index}`,
          provider: 'beeline',
          providerNamespace: legacyNamespace,
        })),
      );
      await bulkCreateInBatches(
        db.TelephonyRawEvent,
        Array.from({ length: 8607 }, (_, index) => {
          const externalEventId = `${suffix}-event-${index}`;
          return {
            ...tenant,
            eventType: 'production-shaped-history',
            externalEventId,
            idempotencyKey: buildProviderIdempotencyKey(null, externalEventId),
            payload: {},
            provider: 'beeline',
          };
        }),
      );
      await bulkCreateInBatches(
        db.TelephonySubscription,
        Array.from({ length: 1509 }, (_, index) => ({
          ...tenant,
          callbackUrl: 'https://setly.tech/api/integrations/beeline/events',
          provider: 'beeline',
          providerNamespace: legacyNamespace,
          status: index < 1358 ? 'active' : 'failed',
          subscriptionId: `${suffix}-subscription-${index}`,
        })),
      );

      process.env.BEELINE_API_BASE_URL = 'https://provider.bootstrap.test';
      process.env.BEELINE_API_TOKEN = 'production-shape-api-token';
      process.env.BEELINE_CALLBACK_URL =
        'https://setly.tech/api/integrations/beeline/events';
      delete process.env.BEELINE_WEBHOOK_SECRET;
      delete process.env.EVOTOR_WEBHOOK_SECRET;
      delete process.env.BOT_TOKEN;
      delete process.env.VK_TOKEN;

      const command = runProviderBootstrapPackage();
      assert.equal(command.status, 0, `${command.stdout}\n${command.stderr}`);
      const output = parseProviderBootstrapOutput(command.stdout);
      const beeline = output.connections.find((item) => item.provider === 'beeline');
      assert.deepEqual(beeline.reconciliation, {
        rawEvents: 8607,
        subscriptions: 1509,
        telephonyCalls: 1467,
      });
      const connection = await db.IntegrationConnection.unscoped().findOne({
        where: { connectionKey: 'default', provider: 'beeline', ...tenant },
      });
      const decrypted = contextWithSecrets(connection);
      assert.equal(decrypted.config.webhookAuthMode, 'capability_uri');
      assert.match(decrypted.secrets.callbackToken, /^[a-f0-9]{64}$/u);
      const callbackToken = decrypted.secrets.callbackToken;
      assert.equal(`${command.stdout}\n${command.stderr}`.includes(callbackToken), false);
      assert.equal(JSON.stringify(connection.config).includes(callbackToken), false);
      assert.equal(JSON.stringify(connection.metadata).includes(callbackToken), false);
      const dryRun = runBeelineCutoverPackage('--dry-run');
      assert.equal(dryRun.status, 0, `${dryRun.stdout}\n${dryRun.stderr}`);
      assert.equal(`${dryRun.stdout}\n${dryRun.stderr}`.includes(callbackToken), false);
      assert.match(dryRun.stdout, /beeline\/events\/\[redacted\]/u);
      const [[remaining]] = await db.sequelize.query(
        `SELECT
           (SELECT COUNT(*) FROM TelephonyCalls WHERE externalCallId LIKE :prefix AND integrationConnectionId IS NULL) AS calls,
           (SELECT COUNT(*) FROM TelephonyRawEvents WHERE externalEventId LIKE :prefix AND integrationConnectionId IS NULL) AS rawEvents,
           (SELECT COUNT(*) FROM TelephonySubscriptions WHERE subscriptionId LIKE :prefix AND integrationConnectionId IS NULL) AS subscriptions`,
        { replacements: { prefix: `${suffix}%` } },
      );
      assert.deepEqual(
        Object.fromEntries(Object.entries(remaining).map(([key, value]) => [key, Number(value)])),
        { calls: 0, rawEvents: 0, subscriptions: 0 },
      );
      const [beforeRestart] = await db.sequelize.query(
        `SELECT publicId, config, metadata, secretCiphertext, secretKeyVersion,
                secretUpdatedAt, createdAt, updatedAt
         FROM IntegrationConnections WHERE id=:id`,
        { replacements: { id: connection.id } },
      );
      const restart = runProviderBootstrapPackage();
      assert.equal(restart.status, 0, `${restart.stdout}\n${restart.stderr}`);
      const [afterRestart] = await db.sequelize.query(
        `SELECT publicId, config, metadata, secretCiphertext, secretKeyVersion,
                secretUpdatedAt, createdAt, updatedAt
         FROM IntegrationConnections WHERE id=:id`,
        { replacements: { id: connection.id } },
      );
      assert.deepEqual(afterRestart, beforeRestart);
      assert.equal(`${restart.stdout}\n${restart.stderr}`.includes(callbackToken), false);

      await db.TelephonyRawEvent.destroy({ where: {
        externalEventId: { [SequelizePackage.Op.like]: `${suffix}%` },
      } });
      await db.TelephonyCall.destroy({ where: {
        externalCallId: { [SequelizePackage.Op.like]: `${suffix}%` },
      } });
      await db.TelephonySubscription.destroy({ where: {
        subscriptionId: { [SequelizePackage.Op.like]: `${suffix}%` },
      } });
      await connection.destroy();
      delete process.env.BEELINE_API_BASE_URL;
      delete process.env.BEELINE_API_TOKEN;
      delete process.env.BEELINE_CALLBACK_URL;
      process.env.BEELINE_WEBHOOK_SECRET = 'legacy-beeline-smoke-secret';
      process.env.EVOTOR_WEBHOOK_SECRET = 'legacy-evotor-smoke-secret';
    });

    let defaultBeelineConnectionRow;
    let defaultEvotorConnectionRow;
    await t.test('HTTP ingress authenticates capability/header modes before parsing and rejects legacy Beeline', async () => {
      const tenant = {
        clubId: Number(defaultClub.id),
        organizationId: Number(defaultOrganization.id),
      };
      const evotorPublicId = generatePublicId();
      const evotorSmoke = await createConnection({
        ...tenant,
        connectionKey: 'default',
        provider: 'evotor',
        publicId: evotorPublicId,
        secrets: { webhookSecret: 'evotor-http-secret' },
      });
      const beelinePublicId = generatePublicId();
      const beelineSmoke = await createConnection({
        ...tenant,
        config: {
          apiBaseUrl: 'https://provider.example',
          callbackUrl: `https://crm.example/api/integrations/beeline/events/${beelinePublicId}`,
          subscriptionAutoRenewEnabled: false,
          webhookAuthMode: 'shared_secret_header',
        },
        connectionKey: 'default',
        provider: 'beeline',
        publicId: beelinePublicId,
        secrets: { apiToken: 'beeline-api-secret', webhookSecret: 'beeline-http-secret' },
      });
      defaultBeelineConnectionRow = beelineSmoke;
      defaultEvotorConnectionRow = evotorSmoke;
      const parallelBeelinePublicId = generatePublicId();
      await createConnection({
        ...tenant,
        config: {
          apiBaseUrl: 'https://provider.example',
          callbackUrl: `https://crm.example/api/integrations/beeline/events/${parallelBeelinePublicId}`,
          subscriptionAutoRenewEnabled: false,
          webhookAuthMode: 'shared_secret_header',
        },
        connectionKey: 'http-smoke-parallel',
        provider: 'beeline',
        publicId: parallelBeelinePublicId,
        secrets: { apiToken: 'beeline-api-parallel', webhookSecret: 'beeline-http-parallel' },
      });
      const capabilityToken = generateCallbackToken();
      const capabilityPublicId = generatePublicId();
      let providerPutPayload = null;
      providerServer = await listen(async (request, response) => {
        const chunks = [];
        for await (const chunk of request) chunks.push(chunk);
        providerPutPayload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        response.setHeader('content-type', 'application/json');
        response.end(JSON.stringify({
          callbackUrl: providerPutPayload.url,
          status: 'active',
          subscriptionId: 'capability-provider-put',
        }));
      });
      const capabilityBeeline = await createConnection({
        ...tenant,
        config: {
          apiBaseUrl: `http://127.0.0.1:${providerServer.address().port}`,
          callbackBaseUrl: 'https://crm.example/api/integrations/beeline/events',
          subscriptionPath: '/subscription',
          subscriptionAutoRenewEnabled: false,
          webhookAuthMode: 'capability_uri',
        },
        connectionKey: 'capability-http-smoke',
        provider: 'beeline',
        publicId: capabilityPublicId,
        secrets: { apiToken: 'beeline-capability-api', callbackToken: capabilityToken },
      });

      const createApp = require('../../src/app');
      apiServer = await listen(createApp());
      const baseUrl = `http://127.0.0.1:${apiServer.address().port}/api`;

      const unknown = await fetch(
        `${baseUrl}/webhooks/evotor/ic_00000000000000000000000000000000`,
        {
          body: 'not-json-and-must-never-be-parsed',
          headers: { 'content-type': 'application/json', 'x-evotor-token': 'forged' },
          method: 'POST',
        },
      );
      assert.equal(unknown.status, 404);
      assert.equal(await unknown.text(), 'Rejected');

      const evotorAccepted = await fetch(`${baseUrl}/webhooks/evotor/${evotorSmoke.publicId}`, {
        body: JSON.stringify({ clubId: 99999, id: 'http-evotor-connection', positions: [] }),
        headers: { 'content-type': 'application/json', 'x-evotor-token': 'evotor-http-secret' },
        method: 'POST',
      });
      assert.equal(evotorAccepted.status, 200);

      const beelineAccepted = await fetch(
        `${baseUrl}/integrations/beeline/events/${beelinePublicId}`,
        {
          body: JSON.stringify({ eventId: 'http-beeline-connection', eventType: 'unknown' }),
          headers: {
            'content-type': 'application/json',
            'x-beeline-webhook-secret': 'beeline-http-secret',
          },
          method: 'POST',
        },
      );
      assert.equal(beelineAccepted.status, 200);

      const beforeDeniedCapability = await db.TelephonyRawEvent.count();
      for (const url of [
        `${baseUrl}/integrations/beeline/events/${capabilityPublicId}`,
        `${baseUrl}/integrations/beeline/events/${capabilityPublicId}/${'0'.repeat(64)}`,
        `${baseUrl}/integrations/beeline/events?callbackToken=${capabilityToken}`,
      ]) {
        const denied = await fetch(url, {
          body: 'not-json-and-must-never-reach-business-parser',
          headers: { 'content-type': 'application/json' },
          method: 'POST',
        });
        assert.equal(denied.status, 404);
      }
      assert.equal(await db.TelephonyRawEvent.count(), beforeDeniedCapability);
      const capabilityAccepted = await fetch(
        `${baseUrl}/integrations/beeline/events/${capabilityPublicId}/${capabilityToken}?echo=${capabilityToken}`,
        {
          body: JSON.stringify({
            callbackEcho:
              `https://crm.example/api/integrations/beeline/events/${capabilityPublicId}/${capabilityToken}`,
            eventId: 'http-beeline-capability-on',
            eventType: 'subscription-heartbeat',
          }),
          headers: {
            'content-type': 'application/json',
            'x-provider-debug': capabilityToken,
          },
          method: 'POST',
        },
      );
      assert.equal(capabilityAccepted.status, 200);
      const capabilityRaw = await db.TelephonyRawEvent.findOne({
        where: { externalEventId: 'http-beeline-capability-on' },
      });
      assert.equal(
        Number(capabilityRaw.integrationConnectionId),
        Number(capabilityBeeline.id),
      );
      assert.equal(JSON.stringify({
        headers: capabilityRaw.headers,
        payload: capabilityRaw.payload,
        query: capabilityRaw.query,
      }).includes(capabilityToken), false);
      const subscriptionResult = await telephonyService.subscribeToEvents(
        {},
        tenant,
        contextWithSecrets(capabilityBeeline),
      );
      assert.equal(providerPutPayload.url.includes(capabilityToken), true);
      assert.equal(JSON.stringify(subscriptionResult).includes(capabilityToken), false);
      const persistedCapabilitySubscription = await db.TelephonySubscription.findOne({
        where: { subscriptionId: 'capability-provider-put' },
      });
      for (const surface of [
        persistedCapabilitySubscription.callbackUrl,
        persistedCapabilitySubscription.lastRequest,
        persistedCapabilitySubscription.lastResponse,
      ]) assert.equal(JSON.stringify(surface).includes(capabilityToken), false);
      assert.match(
        persistedCapabilitySubscription.callbackUrl,
        /beeline\/events\/\[redacted\]$/u,
      );
      await closeServer(providerServer);
      providerServer = null;

      await db.sequelize.query(
        `CREATE TRIGGER provider_test_raw_insert_delay
         BEFORE INSERT ON TelephonyRawEvents
         FOR EACH ROW
         BEGIN
           DO SLEEP(0.18);
         END`,
      );
      const postBeeline = (connectionPublicId, secret, eventId) => fetch(
        `${baseUrl}/integrations/beeline/events/${connectionPublicId}`,
        {
          body: JSON.stringify({ eventId, eventType: 'subscription-heartbeat' }),
          headers: {
            'content-type': 'application/json',
            'x-beeline-webhook-secret': secret,
          },
          method: 'POST',
        },
      );
      const sameStartedAt = Date.now();
      const sameResponses = await Promise.all([
        postBeeline(beelinePublicId, 'beeline-http-secret', 'http-lock-same-1'),
        postBeeline(beelinePublicId, 'beeline-http-secret', 'http-lock-same-2'),
      ]);
      const sameElapsedMs = Date.now() - sameStartedAt;
      assert.deepEqual(sameResponses.map((response) => response.status), [200, 200]);
      const parallelStartedAt = Date.now();
      const parallelResponses = await Promise.all([
        postBeeline(beelinePublicId, 'beeline-http-secret', 'http-lock-parallel-1'),
        postBeeline(parallelBeelinePublicId, 'beeline-http-parallel', 'http-lock-parallel-2'),
      ]);
      const parallelElapsedMs = Date.now() - parallelStartedAt;
      assert.deepEqual(parallelResponses.map((response) => response.status), [200, 200]);
      assert.ok(
        sameElapsedMs >= parallelElapsedMs + 100,
        `same connection ${sameElapsedMs}ms must serialize vs ${parallelElapsedMs}ms`,
      );
      await db.sequelize.query('DROP TRIGGER provider_test_raw_insert_delay');

      delete process.env.TENANT_PROVIDER_INTEGRATIONS_ENABLED;
      const flagOffConfig = await telephonyService.getConfig();
      assert.equal(flagOffConfig.connectionConfigured, true);
      assert.equal(JSON.stringify(flagOffConfig).includes(capabilityToken), false);
      process.env.EVOTOR_WEBHOOK_LOG_RAW = 'true';
      const evotorLogs = [];
      const originalConsoleLog = console.log;
      console.log = (...args) => evotorLogs.push(args.join(' '));
      let legacyEvotor;
      try {
        legacyEvotor = await fetch(`${baseUrl}/webhooks/evotor`, {
          body: JSON.stringify({
            apiKey: 'evotor-api-key-value',
            id: 'http-evotor-legacy',
            positions: [],
            private_key: 'evotor-private-key-value',
          }),
          headers: {
            'content-type': 'application/json',
            'x-evotor-token': process.env.EVOTOR_WEBHOOK_SECRET,
          },
          method: 'POST',
        });
      } finally {
        console.log = originalConsoleLog;
        delete process.env.EVOTOR_WEBHOOK_LOG_RAW;
      }
      assert.equal(legacyEvotor.status, 200);
      assert.equal(evotorLogs.join('\n').includes('evotor-api-key-value'), false);
      assert.equal(evotorLogs.join('\n').includes('evotor-private-key-value'), false);
      const capabilityOff = await fetch(
        `${baseUrl}/integrations/beeline/events/${capabilityPublicId}/${capabilityToken}`,
        {
          body: JSON.stringify({
            eventId: 'http-beeline-capability-off',
            eventType: 'subscription-heartbeat',
          }),
          headers: { 'content-type': 'application/json' },
          method: 'POST',
        },
      );
      assert.equal(capabilityOff.status, 200);
      const capabilityOffRaw = await db.TelephonyRawEvent.findOne({
        where: { externalEventId: 'http-beeline-capability-off' },
      });
      assert.equal(
        Number(capabilityOffRaw.integrationConnectionId),
        Number(capabilityBeeline.id),
      );

      process.env.SETLY_ROLLOUT_MAINTENANCE_MODE = 'full-stop';
      delete process.env.SETLY_BEELINE_CAPABILITY_CUTOVER_ENABLED;
      const blockedDuringMaintenance = await fetch(
        `${baseUrl}/integrations/beeline/events/${capabilityPublicId}/${capabilityToken}`,
        {
          body: 'authenticated-but-maintenance-exception-is-disabled',
          method: 'POST',
        },
      );
      assert.equal(blockedDuringMaintenance.status, 503);
      const bareDuringMaintenance = await fetch(
        `${baseUrl}/integrations/beeline/events`,
        { body: 'bare-route-must-not-use-the-exception', method: 'POST' },
      );
      assert.equal(bareDuringMaintenance.status, 404);
      process.env.SETLY_BEELINE_CAPABILITY_CUTOVER_ENABLED = 'true';
      const allowedDuringMaintenance = await fetch(
        `${baseUrl}/integrations/beeline/events/${capabilityPublicId}/${capabilityToken}`,
        {
          body: JSON.stringify({
            eventId: 'http-beeline-capability-maintenance',
            eventType: 'subscription-heartbeat',
          }),
          headers: { 'content-type': 'application/json' },
          method: 'POST',
        },
      );
      assert.equal(allowedDuringMaintenance.status, 200);
      delete process.env.SETLY_BEELINE_CAPABILITY_CUTOVER_ENABLED;
      delete process.env.SETLY_ROLLOUT_MAINTENANCE_MODE;

      const rawCountBeforeLegacyBeeline = await db.TelephonyRawEvent.count();
      const legacyBeeline = await fetch(
        `${baseUrl}/integrations/beeline/events?access-key=query-access-value&signingKey=query-sign-value`,
        {
        body: JSON.stringify({
          apiKey: 'payload-api-key-value',
          callId: 'http-beeline-legacy-call',
          clientSecret: 'payload-client-secret-value',
          eventId: 'http-beeline-legacy',
          eventType: 'call.completed',
          phone: '+79990000000',
          private_key: 'payload-private-key-value',
          startDate: '2026-07-15T10:00:00.000Z',
        }),
        headers: {
          'content-type': 'application/json',
          'x-api-key': 'header-api-key-value',
          'x-beeline-webhook-secret': process.env.BEELINE_WEBHOOK_SECRET,
        },
        method: 'POST',
      });
      assert.equal(legacyBeeline.status, 404);
      assert.equal(await db.TelephonyRawEvent.count(), rawCountBeforeLegacyBeeline);

      const legacyRaw = await db.TelephonyRawEvent.create({
        ...tenant,
        eventType: 'call.completed',
        externalEventId: 'http-beeline-legacy',
        idempotencyKey: buildProviderIdempotencyKey(null, 'http-beeline-legacy'),
        payload: {
          callId: 'http-beeline-legacy-call',
          eventType: 'call.completed',
          phone: '+79990000000',
          startDate: '2026-07-15T10:00:00.000Z',
        },
        provider: 'beeline',
      });
      const legacyCall = await db.TelephonyCall.create({
        ...tenant,
        externalCallId: 'http-beeline-legacy-call',
        provider: 'beeline',
        providerNamespace: buildProviderNamespace(null),
      });
      const legacyReceipt = await db.Receipt.unscoped().findOne({
        where: { evotorId: 'http-evotor-legacy' },
      });
      assert.ok(legacyRaw);
      assert.ok(legacyCall);
      assert.ok(legacyReceipt);
      for (const row of [legacyRaw, legacyCall]) {
        assert.equal(Number(row.organizationId), tenant.organizationId);
        assert.equal(Number(row.clubId), tenant.clubId);
        assert.equal(row.integrationConnectionId ?? null, null);
      }
      const [[legacyReceiptAttribution]] = await db.sequelize.query(
        'SELECT organizationId, clubId, integrationConnectionId FROM Receipts WHERE id=:id',
        { replacements: { id: legacyReceipt.id } },
      );
      assert.equal(Number(legacyReceiptAttribution.organizationId), tenant.organizationId);
      assert.equal(Number(legacyReceiptAttribution.clubId), tenant.clubId);
      assert.equal(legacyReceiptAttribution.integrationConnectionId, null);
      const legacySubscription = await db.TelephonySubscription.create({
        ...tenant,
        callbackUrl: 'https://crm.example/api/integrations/beeline/events',
        provider: 'beeline',
        providerNamespace: buildProviderNamespace(null),
        status: 'active',
        subscriptionId: 'legacy-subscription',
      });
      process.env.TENANT_PROVIDER_INTEGRATIONS_ENABLED = 'true';
      await assert.rejects(
        telephonyService.reprocessRawEvent(legacyRaw.id, tenant),
        (error) => error.statusCode === 409 && /attribution is missing/u.test(error.message),
      );
      delete process.env.TENANT_PROVIDER_INTEGRATIONS_ENABLED;
      const beelineReconciliation = await reconcileLegacyProviderRows(
        serializeConnection(beelineSmoke),
      );
      const evotorReconciliation = await reconcileLegacyProviderRows(
        serializeConnection(evotorSmoke),
      );
      assert.ok(beelineReconciliation.rawEvents >= 1);
      assert.ok(beelineReconciliation.telephonyCalls >= 1);
      assert.ok(beelineReconciliation.subscriptions >= 1);
      assert.ok(evotorReconciliation.receipts >= 1);
      await Promise.all([
        legacyRaw.reload(),
        legacyCall.reload(),
        legacyReceipt.reload(),
        legacySubscription.reload(),
      ]);
      assert.equal(Number(legacyRaw.integrationConnectionId), Number(beelineSmoke.id));
      assert.equal(Number(legacyCall.integrationConnectionId), Number(beelineSmoke.id));
      assert.equal(Number(legacySubscription.integrationConnectionId), Number(beelineSmoke.id));
      assert.equal(Number(legacyReceipt.integrationConnectionId), Number(evotorSmoke.id));
      assert.equal(
        legacyRaw.idempotencyKey,
        buildProviderIdempotencyKey(serializeConnection(beelineSmoke), 'http-beeline-legacy'),
      );
      assert.equal(
        legacyReceipt.idempotencyKey,
        buildProviderIdempotencyKey(serializeConnection(evotorSmoke), 'http-evotor-legacy'),
      );
      process.env.TENANT_PROVIDER_INTEGRATIONS_ENABLED = 'true';
      const replay = await telephonyService.reprocessRawEvent(legacyRaw.id, tenant);
      assert.equal(replay.status, 'processed');
      await closeServer(apiServer);
      apiServer = null;
    });

    async function connection(provider, tenant, connectionKey) {
      const publicId = generatePublicId();
      const isBeeline = provider === 'beeline';
      return createConnection({
        ...tenant,
        config: isBeeline
          ? {
              apiBaseUrl: 'https://provider.example',
              callbackUrl: `https://crm.example/api/integrations/beeline/events/${publicId}`,
              subscriptionAutoRenewEnabled: true,
              webhookAuthMode: 'shared_secret_header',
            }
          : {},
        connectionKey,
        metadata: { label: `${provider}-${connectionKey}` },
        provider,
        publicId,
        secrets: isBeeline
          ? { apiToken: `api-${connectionKey}`, webhookSecret: `hook-${connectionKey}` }
          : { webhookSecret: `hook-${connectionKey}` },
      });
    }

    const defaultTenant = {
      clubId: Number(defaultClub.id),
      organizationId: Number(defaultOrganization.id),
    };
    const beeline1Row = await connection('beeline', defaultTenant, 'primary');
    const beeline2Row = await connection('beeline', defaultTenant, 'secondary');
    const evotor1Row = await connection('evotor', defaultTenant, 'primary');
    const evotor2Row = await connection('evotor', defaultTenant, 'secondary');
    const storedBeeline = await db.IntegrationConnection.unscoped().findByPk(beeline1Row.id);
    assert.equal(typeof storedBeeline.secretCiphertext, 'string');
    assert.equal(storedBeeline.publicId, beeline1Row.publicId);
    assert.deepEqual(
      require('../../src/provider-integrations/secrets').decryptSecretBundle(
        storedBeeline.secretCiphertext,
        { provider: storedBeeline.provider, publicId: storedBeeline.publicId },
      ),
      { apiToken: 'api-primary', webhookSecret: 'hook-primary' },
    );
    assert.equal(contextWithSecrets(storedBeeline).connectionId, beeline1Row.id);

    async function resolveCreatedConnection(options) {
      try {
        return await resolveIngressConnection(options);
      } catch (error) {
        const diagnostic = await db.ProviderIngressDiagnostic.findOne({
          order: [['id', 'DESC']],
          raw: true,
        });
        assert.fail(`created connection was rejected: ${diagnostic?.reasonCode || error.code}`);
      }
    }

    const beeline1 = await resolveCreatedConnection({
      provider: 'beeline',
      publicId: beeline1Row.publicId,
    });
    const beeline2 = await resolveCreatedConnection({
      provider: 'beeline',
      publicId: beeline2Row.publicId,
    });
    const evotor1 = await resolveCreatedConnection({
      provider: 'evotor',
      publicId: evotor1Row.publicId,
    });
    const evotor2 = await resolveCreatedConnection({
      provider: 'evotor',
      publicId: evotor2Row.publicId,
    });

    await t.test('legacy NULL binding accepts only the authoritative default provider contract', async () => {
      assert.ok(defaultBeelineConnectionRow);
      assert.ok(defaultEvotorConnectionRow);
      const defaultBeeline = serializeConnection(defaultBeelineConnectionRow);
      const defaultEvotor = serializeConnection(defaultEvotorConnectionRow);
      const legacyNamespace = buildProviderNamespace(null);
      const suffix = `${process.pid}-${Date.now()}`;
      const call = await db.TelephonyCall.create({
        ...defaultTenant,
        externalCallId: `legacy-contract-call-${suffix}`,
        provider: 'beeline',
        providerNamespace: legacyNamespace,
      });
      const rawEvent = await db.TelephonyRawEvent.create({
        ...defaultTenant,
        eventType: 'legacy-contract',
        externalEventId: `legacy-contract-event-${suffix}`,
        idempotencyKey: buildProviderIdempotencyKey(
          null,
          `legacy-contract-event-${suffix}`,
        ),
        payload: {},
        provider: 'beeline',
      });
      const subscription = await db.TelephonySubscription.create({
        ...defaultTenant,
        callbackUrl: 'https://crm.example/legacy-contract',
        provider: 'beeline',
        providerNamespace: legacyNamespace,
        status: 'active',
        subscriptionId: `legacy-contract-subscription-${suffix}`,
      });
      const receipt = await db.Receipt.unscoped().create({
        ...defaultTenant,
        dateTime: new Date(),
        evotorId: `legacy-contract-receipt-${suffix}`,
        idempotencyKey: buildProviderIdempotencyKey(
          null,
          `legacy-contract-receipt-${suffix}`,
        ),
      });

      const crossProviderUpdates = [
        {
          replacements: {
            connectionId: defaultEvotor.connectionId,
            id: call.id,
            providerNamespace: buildProviderNamespace(defaultEvotor),
          },
          sql: `UPDATE TelephonyCalls
                SET integrationConnectionId = :connectionId,
                    providerNamespace = :providerNamespace
                WHERE id = :id`,
        },
        {
          replacements: {
            connectionId: defaultEvotor.connectionId,
            id: rawEvent.id,
            idempotencyKey: buildProviderIdempotencyKey(
              defaultEvotor,
              rawEvent.externalEventId,
            ),
          },
          sql: `UPDATE TelephonyRawEvents
                SET integrationConnectionId = :connectionId,
                    idempotencyKey = :idempotencyKey
                WHERE id = :id`,
        },
        {
          replacements: {
            connectionId: defaultEvotor.connectionId,
            id: subscription.id,
            providerNamespace: buildProviderNamespace(defaultEvotor),
          },
          sql: `UPDATE TelephonySubscriptions
                SET integrationConnectionId = :connectionId,
                    providerNamespace = :providerNamespace
                WHERE id = :id`,
        },
        {
          replacements: {
            connectionId: defaultBeeline.connectionId,
            id: receipt.id,
            idempotencyKey: buildProviderIdempotencyKey(
              defaultBeeline,
              receipt.evotorId,
            ),
          },
          sql: `UPDATE Receipts
                SET integrationConnectionId = :connectionId,
                    idempotencyKey = :idempotencyKey
                WHERE id = :id`,
        },
      ];
      for (const update of crossProviderUpdates) {
        await assert.rejects(
          db.sequelize.query(update.sql, { replacements: update.replacements }),
          /connection contract is invalid/iu,
        );
      }

      await assert.rejects(
        db.sequelize.query(
          `UPDATE TelephonyRawEvents
           SET integrationConnectionId = :connectionId,
               idempotencyKey = :idempotencyKey
           WHERE id = :id`,
          {
            replacements: {
              connectionId: beeline1.connectionId,
              id: rawEvent.id,
              idempotencyKey: buildProviderIdempotencyKey(
                beeline1,
                rawEvent.externalEventId,
              ),
            },
          },
        ),
        /connection contract is invalid/iu,
      );
      await assert.rejects(
        db.sequelize.query(
          `UPDATE Receipts
           SET integrationConnectionId = :connectionId,
               idempotencyKey = :idempotencyKey
           WHERE id = :id`,
          {
            replacements: {
              connectionId: evotor1.connectionId,
              id: receipt.id,
              idempotencyKey: buildProviderIdempotencyKey(evotor1, receipt.evotorId),
            },
          },
        ),
        /connection contract is invalid/iu,
      );
      await assert.rejects(
        reconcileLegacyProviderRows(serializeConnection(beeline1Row)),
        (error) => error.code === 'PROVIDER_RECONCILIATION_CONNECTION_INVALID',
      );
      await assert.rejects(
        reconcileLegacyProviderRows({ ...defaultBeeline, provider: 'evotor' }),
        (error) => error.code === 'PROVIDER_RECONCILIATION_AUTHORITY_MISMATCH',
      );

      const acceptedUpdates = [
        {
          replacements: {
            connectionId: defaultBeeline.connectionId,
            id: call.id,
            providerNamespace: buildProviderNamespace(defaultBeeline),
          },
          sql: `UPDATE TelephonyCalls
                SET integrationConnectionId = :connectionId,
                    providerNamespace = :providerNamespace
                WHERE id = :id`,
        },
        {
          replacements: {
            connectionId: defaultBeeline.connectionId,
            id: rawEvent.id,
            idempotencyKey: buildProviderIdempotencyKey(
              defaultBeeline,
              rawEvent.externalEventId,
            ),
          },
          sql: `UPDATE TelephonyRawEvents
                SET integrationConnectionId = :connectionId,
                    idempotencyKey = :idempotencyKey
                WHERE id = :id`,
        },
        {
          replacements: {
            connectionId: defaultBeeline.connectionId,
            id: subscription.id,
            providerNamespace: buildProviderNamespace(defaultBeeline),
          },
          sql: `UPDATE TelephonySubscriptions
                SET integrationConnectionId = :connectionId,
                    providerNamespace = :providerNamespace
                WHERE id = :id`,
        },
        {
          replacements: {
            connectionId: defaultEvotor.connectionId,
            id: receipt.id,
            idempotencyKey: buildProviderIdempotencyKey(defaultEvotor, receipt.evotorId),
          },
          sql: `UPDATE Receipts
                SET integrationConnectionId = :connectionId,
                    idempotencyKey = :idempotencyKey
                WHERE id = :id`,
        },
      ];
      for (const update of acceptedUpdates) {
        await db.sequelize.query(update.sql, { replacements: update.replacements });
      }
      await Promise.all([
        call.reload(),
        rawEvent.reload(),
        subscription.reload(),
        receipt.reload(),
      ]);
      assert.equal(Number(call.integrationConnectionId), defaultBeeline.connectionId);
      assert.equal(Number(rawEvent.integrationConnectionId), defaultBeeline.connectionId);
      assert.equal(Number(subscription.integrationConnectionId), defaultBeeline.connectionId);
      assert.equal(Number(receipt.integrationConnectionId), defaultEvotor.connectionId);
    });

    await t.test('reconciliation collision rolls back, retries and becomes repeatable', async () => {
      const defaultBeeline = serializeConnection(defaultBeelineConnectionRow);
      const suffix = `${process.pid}-${Date.now()}`;
      const firstExternalId = `legacy-collision-first-${suffix}`;
      const collisionExternalId = `legacy-collision-target-${suffix}`;
      const firstLegacy = await db.TelephonyRawEvent.create({
        ...defaultTenant,
        eventType: 'legacy-collision',
        externalEventId: firstExternalId,
        idempotencyKey: buildProviderIdempotencyKey(null, firstExternalId),
        payload: {},
        provider: 'beeline',
      });
      const collisionLegacy = await db.TelephonyRawEvent.create({
        ...defaultTenant,
        eventType: 'legacy-collision',
        externalEventId: collisionExternalId,
        idempotencyKey: buildProviderIdempotencyKey(null, collisionExternalId),
        payload: {},
        provider: 'beeline',
      });
      const connectedConflict = await db.TelephonyRawEvent.create({
        ...defaultTenant,
        eventType: 'connected-collision',
        externalEventId: `already-connected-${suffix}`,
        idempotencyKey: buildProviderIdempotencyKey(
          defaultBeeline,
          collisionExternalId,
        ),
        integrationConnectionId: defaultBeeline.connectionId,
        payload: {},
        provider: 'beeline',
      });

      await assert.rejects(
        reconcileLegacyProviderRows(defaultBeeline),
        (error) => error.original?.code === 'ER_DUP_ENTRY' || error.parent?.code === 'ER_DUP_ENTRY',
      );
      await Promise.all([firstLegacy.reload(), collisionLegacy.reload()]);
      assert.equal(firstLegacy.integrationConnectionId, null);
      assert.equal(collisionLegacy.integrationConnectionId, null);

      await connectedConflict.destroy();
      const retry = await reconcileLegacyProviderRows(defaultBeeline);
      assert.equal(retry.rawEvents, 2);
      await Promise.all([firstLegacy.reload(), collisionLegacy.reload()]);
      assert.equal(Number(firstLegacy.integrationConnectionId), defaultBeeline.connectionId);
      assert.equal(Number(collisionLegacy.integrationConnectionId), defaultBeeline.connectionId);

      assert.deepEqual(
        await reconcileLegacyProviderRows(defaultBeeline),
        { rawEvents: 0, subscriptions: 0, telephonyCalls: 0 },
      );
    });

    await t.test('exact package bootstrap is atomic and resumes a parent-like partial state', async () => {
      const commandSecrets = [
        'exact-package-evotor-secret',
        'exact-package-telegram-secret',
        'exact-package-vk-secret',
      ];
      delete process.env.BEELINE_API_BASE_URL;
      delete process.env.BEELINE_API_TOKEN;
      delete process.env.BEELINE_CALLBACK_URL;
      delete process.env.BEELINE_WEBHOOK_SECRET;
      process.env.EVOTOR_WEBHOOK_SECRET = commandSecrets[0];
      process.env.BOT_TOKEN = commandSecrets[1];
      process.env.VK_TOKEN = commandSecrets[2];

      const evotorId = `bootstrap-atomic-${process.pid}-${Date.now()}`;
      const rollbackReceipt = await db.Receipt.unscoped().create({
        ...defaultTenant,
        dateTime: new Date(),
        evotorId,
        idempotencyKey: buildProviderIdempotencyKey(null, evotorId),
      });
      const triggerName = 'trg_test_provider_bootstrap_fail';
      await db.sequelize.query(`DROP TRIGGER IF EXISTS ${triggerName}`);
      await db.sequelize.query(`
        CREATE TRIGGER ${triggerName}
        BEFORE INSERT ON IntegrationConnections
        FOR EACH ROW
        BEGIN
          IF NEW.provider = 'vk' THEN
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'forced bootstrap batch failure';
          END IF;
        END
      `);

      try {
        const failed = runProviderBootstrapPackage();
        assert.notEqual(failed.status, 0, failed.stdout);
        for (const secret of commandSecrets) {
          assert.equal(`${failed.stdout}\n${failed.stderr}`.includes(secret), false);
        }
        await rollbackReceipt.reload();
        assert.equal(rollbackReceipt.integrationConnectionId, null);
        assert.equal(await db.IntegrationConnection.count({
          where: { provider: { [SequelizePackage.Op.in]: ['telegram', 'vk'] } },
        }), 0);
      } finally {
        await db.sequelize.query(`DROP TRIGGER IF EXISTS ${triggerName}`);
      }

      const parentLikeTelegram = await createConnection({
        ...defaultTenant,
        metadata: { retained: true, source: 'legacy_env_bootstrap' },
        provider: 'telegram',
        publicId: generatePublicId(),
        secrets: { botToken: commandSecrets[1] },
      });
      const [parentLikeBefore] = await db.sequelize.query(`
        SELECT id, publicId, organizationId, clubId, provider, purpose,
               connectionKey, status, config, metadata, secretCiphertext,
               secretKeyVersion, secretUpdatedAt, createdAt, updatedAt
        FROM IntegrationConnections
        WHERE id=:id
      `, { replacements: { id: parentLikeTelegram.id } });
      const parentLikeFingerprint = JSON.stringify(parentLikeBefore[0]);

      const succeeded = runProviderBootstrapPackage();
      assert.equal(succeeded.status, 0, `${succeeded.stdout}\n${succeeded.stderr}`);
      for (const secret of commandSecrets) {
        assert.equal(`${succeeded.stdout}\n${succeeded.stderr}`.includes(secret), false);
      }
      const output = parseProviderBootstrapOutput(succeeded.stdout);
      const actions = Object.fromEntries(output.connections.map((item) => [
        item.provider,
        item.action,
      ]));
      assert.equal(actions.beeline, 'skipped');
      assert.equal(actions.evotor, 'exists');
      assert.equal(actions.telegram, 'exists');
      assert.equal(actions.vk, 'created');
      assert.deepEqual(
        output.connections.find((item) => item.provider === 'telegram').reconciliation,
        {},
      );
      assert.deepEqual(
        output.connections.find((item) => item.provider === 'vk').reconciliation,
        {},
      );
      await rollbackReceipt.reload();
      assert.equal(
        Number(rollbackReceipt.integrationConnectionId),
        Number(defaultEvotorConnectionRow.id),
      );
      const [parentLikeAfter] = await db.sequelize.query(`
        SELECT id, publicId, organizationId, clubId, provider, purpose,
               connectionKey, status, config, metadata, secretCiphertext,
               secretKeyVersion, secretUpdatedAt, createdAt, updatedAt
        FROM IntegrationConnections
        WHERE id=:id
      `, { replacements: { id: parentLikeTelegram.id } });
      assert.equal(JSON.stringify(parentLikeAfter[0]), parentLikeFingerprint);

      const [beforeRestart] = await db.sequelize.query(`
        SELECT id, publicId, provider, purpose, connectionKey, status,
               config, metadata, secretCiphertext, secretKeyVersion,
               secretUpdatedAt, createdAt, updatedAt
        FROM IntegrationConnections
        WHERE provider IN ('telegram', 'vk')
        ORDER BY provider
      `);
      assert.equal(beforeRestart.length, 2);
      const restart = runProviderBootstrapPackage();
      assert.equal(restart.status, 0, `${restart.stdout}\n${restart.stderr}`);
      const [afterRestart] = await db.sequelize.query(`
        SELECT id, publicId, provider, purpose, connectionKey, status,
               config, metadata, secretCiphertext, secretKeyVersion,
               secretUpdatedAt, createdAt, updatedAt
        FROM IntegrationConnections
        WHERE provider IN ('telegram', 'vk')
        ORDER BY provider
      `);
      assert.deepEqual(afterRestart, beforeRestart);
      for (const secret of commandSecrets) {
        assert.equal(`${restart.stdout}\n${restart.stderr}`.includes(secret), false);
      }
    });

    const [organizationInsert] = await db.sequelize.query(
      `INSERT INTO Organizations(slug, name, status, createdAt, updatedAt)
       VALUES ('provider-org-2', 'Provider Org 2', 'active', NOW(), NOW())`,
    );
    const organization2Id = Number(organizationInsert);
    const [club2Insert] = await db.sequelize.query(
      `INSERT INTO Clubs(organizationId, slug, name, timezone, status, createdAt, updatedAt)
       VALUES (:organizationId, 'provider-club-2', 'Provider Club 2', 'Europe/Moscow', 'active', NOW(), NOW())`,
      { replacements: { organizationId: organization2Id } },
    );
    const club2Id = Number(club2Insert);
    const [club3Insert] = await db.sequelize.query(
      `INSERT INTO Clubs(organizationId, slug, name, timezone, status, createdAt, updatedAt)
       VALUES (:organizationId, 'provider-club-3', 'Provider Club 3', 'Europe/Moscow', 'active', NOW(), NOW())`,
      { replacements: { organizationId: organization2Id } },
    );
    const club3Id = Number(club3Insert);
    const tenant2 = { clubId: club2Id, organizationId: organization2Id };
    const tenant3 = { clubId: club3Id, organizationId: organization2Id };
    const beeline3Row = await connection('beeline', tenant2, 'club-2');
    const beeline4Row = await connection('beeline', tenant3, 'club-3');
    const beeline3 = await resolveCreatedConnection({
      provider: 'beeline',
      publicId: beeline3Row.publicId,
    });
    const beeline4 = await resolveCreatedConnection({
      provider: 'beeline',
      publicId: beeline4Row.publicId,
    });

    await t.test('invalid foundation blocks ingress with two organizations and three clubs', async () => {
      tenantFoundation.invalidateTenantFoundationGateCache();
      const response = fakeResponse();
      await tenantFoundationGate(
        { method: 'POST', path: '/integrations/beeline/events/ic_unknown' },
        response,
        () => assert.fail('invalid foundation must not continue'),
      );
      assert.equal(response.statusCode, 503);
      assert.equal(response.body.code, 'TENANT_FOUNDATION_INVALID');
      await assert.rejects(
        telephonyService.maintainAllEventSubscriptions(),
        (error) => error.code === 'TENANT_FOUNDATION_INVALID',
      );
    });

    await t.test('encrypted credentials and public/error/diagnostic surfaces contain no secret', async () => {
      const [[stored]] = await db.sequelize.query(
        'SELECT secretCiphertext FROM IntegrationConnections WHERE id = :id',
        { replacements: { id: beeline1.connectionId } },
      );
      assert.equal(stored.secretCiphertext.includes('api-primary'), false);
      assert.equal(stored.secretCiphertext.includes('hook-primary'), false);
      assert.equal(JSON.stringify(beeline1).includes('secretCiphertext'), false);

      await assert.rejects(
        resolveIngressConnection({
          provider: 'beeline',
          publicId: 'ic_00000000000000000000000000000000',
          requestId: 'request-with-hook-primary',
        }),
        (error) => error.code === 'PROVIDER_CONNECTION_REJECTED'
          && !error.message.includes('hook-primary'),
      );
      const diagnostics = await db.ProviderIngressDiagnostic.findAll({ raw: true });
      assert.ok(diagnostics.length >= 1);
      assert.equal(JSON.stringify(diagnostics).includes('hook-primary'), false);
      assert.equal(Object.hasOwn(diagnostics[0], 'payload'), false);
    });

    await t.test('disabled, revoked, unknown and provider-mismatched connections fail closed', async () => {
      await beeline3Row.update({ status: 'disabled' });
      await assert.rejects(
        resolveIngressConnection({ provider: 'beeline', publicId: beeline3Row.publicId }),
        (error) => error.code === 'PROVIDER_CONNECTION_REJECTED' && error.statusCode === 404,
      );
      await beeline4Row.update({ status: 'revoked' });
      await assert.rejects(
        resolveIngressConnection({ provider: 'beeline', publicId: beeline4Row.publicId }),
        (error) => error.code === 'PROVIDER_CONNECTION_REJECTED',
      );
      await assert.rejects(
        resolveIngressConnection({ provider: 'evotor', publicId: beeline1Row.publicId }),
        (error) => error.code === 'PROVIDER_CONNECTION_REJECTED',
      );
    });

    await t.test('same external ID is isolated by connection and replay keeps immutable tenant', async () => {
      const externalEventId = 'shared-provider-event';
      const first = await db.TelephonyRawEvent.create({
        clubId: beeline1.clubId,
        deliveryCount: 1,
        eventType: 'call',
        externalEventId,
        idempotencyKey: buildProviderIdempotencyKey(beeline1, externalEventId),
        integrationConnectionId: beeline1.connectionId,
        lastReceivedAt: new Date(),
        organizationId: beeline1.organizationId,
        payload: { eventId: externalEventId, token: '[redacted]' },
        processingStatus: 'new',
        provider: 'beeline',
        receivedAt: new Date(),
      });
      await assert.rejects(
        db.TelephonyRawEvent.create({
          clubId: beeline1.clubId,
          eventType: 'duplicate',
          externalEventId,
          idempotencyKey: buildProviderIdempotencyKey(beeline1, externalEventId),
          integrationConnectionId: beeline1.connectionId,
          organizationId: beeline1.organizationId,
          payload: {},
          provider: 'beeline',
        }),
        (error) => error.name === 'SequelizeUniqueConstraintError',
      );
      const other = await db.TelephonyRawEvent.create({
        clubId: beeline2.clubId,
        eventType: 'call',
        externalEventId,
        idempotencyKey: buildProviderIdempotencyKey(beeline2, externalEventId),
        integrationConnectionId: beeline2.connectionId,
        organizationId: beeline2.organizationId,
        payload: {},
        provider: 'beeline',
      });
      assert.notEqual(first.id, other.id);
      await assert.rejects(
        first.update({ organizationId: organization2Id, clubId: club2Id }),
        (error) => error.code === 'PROVIDER_ATTRIBUTION_IMMUTABLE',
      );
      await assert.rejects(
        db.TelephonyRawEvent.create({
          clubId: club2Id,
          eventType: 'forged',
          externalEventId: 'forged',
          idempotencyKey: buildProviderIdempotencyKey(beeline1, 'forged'),
          integrationConnectionId: beeline1.connectionId,
          organizationId: organization2Id,
          payload: {},
          provider: 'beeline',
        }),
        /foreign key|constraint/u,
      );
    });

    await t.test('Evotor ignores forged tenant fields and namespaces duplicates per connection', async () => {
      const payload = {
        clubId: club2Id,
        id: 'same-evotor-id',
        organizationId: organization2Id,
        positions: [],
        totalAmount: 100,
        type: 'SELL',
      };
      const first = await evotorService.processReceipt(payload, { connection: evotor1 });
      const replay = await evotorService.processReceipt(payload, { connection: evotor1 });
      const other = await evotorService.processReceipt(payload, { connection: evotor2 });
      assert.equal(first.alreadyProcessed, false);
      assert.equal(replay.alreadyProcessed, true);
      assert.equal(other.alreadyProcessed, false);
      assert.equal(Number(first.receipt.organizationId), defaultTenant.organizationId);
      assert.equal(Number(first.receipt.clubId), defaultTenant.clubId);
      assert.notEqual(first.receipt.id, other.receipt.id);
    });

    await t.test('ORM bulk updates, direct SQL and FK cascades cannot move provider attribution', async () => {
      const call = await db.TelephonyCall.create({
        ...defaultTenant,
        externalCallId: 'immutable-call',
        integrationConnectionId: beeline1.connectionId,
        provider: 'beeline',
        providerNamespace: buildProviderNamespace(beeline1),
      });
      const rawEvent = await db.TelephonyRawEvent.create({
        ...defaultTenant,
        eventType: 'immutable',
        externalEventId: 'immutable-event',
        idempotencyKey: buildProviderIdempotencyKey(beeline1, 'immutable-event'),
        integrationConnectionId: beeline1.connectionId,
        payload: {},
        provider: 'beeline',
      });
      const subscription = await db.TelephonySubscription.create({
        ...defaultTenant,
        callbackUrl: 'https://crm.example/immutable',
        integrationConnectionId: beeline1.connectionId,
        provider: 'beeline',
        providerNamespace: buildProviderNamespace(beeline1),
        subscriptionId: 'immutable-subscription',
      });
      const receipt = await db.Receipt.unscoped().create({
        ...defaultTenant,
        dateTime: new Date(),
        evotorId: 'immutable-receipt',
        idempotencyKey: buildProviderIdempotencyKey(evotor1, 'immutable-receipt'),
        integrationConnectionId: evotor1.connectionId,
      });
      const modelRows = [
        [db.TelephonyCall, call],
        [db.TelephonyRawEvent, rawEvent],
        [db.TelephonySubscription, subscription],
        [db.Receipt, receipt],
      ];
      for (const [Model, row] of modelRows) {
        await assert.rejects(
          Model.update(
            { clubId: club2Id, organizationId: organization2Id },
            { where: { id: row.id } },
          ),
          (error) => error.code === 'PROVIDER_ATTRIBUTION_IMMUTABLE',
        );
      }
      await assert.rejects(
        db.IntegrationConnection.update(
          { clubId: club2Id, organizationId: organization2Id },
          { where: { id: beeline1.connectionId } },
        ),
        (error) => error.code === 'PROVIDER_ATTRIBUTION_IMMUTABLE',
      );

      const directUpdates = [
        ['TelephonyCalls', call.id],
        ['TelephonyRawEvents', rawEvent.id],
        ['TelephonySubscriptions', subscription.id],
        ['Receipts', receipt.id],
        ['IntegrationConnections', beeline1.connectionId],
      ];
      for (const [table, id] of directUpdates) {
        await assert.rejects(
          db.sequelize.query(
            `UPDATE ${table}
             SET organizationId = :organizationId, clubId = :clubId
             WHERE id = :id`,
            { replacements: { clubId: club2Id, id, organizationId: organization2Id } },
          ),
          /immutable/iu,
        );
      }
      await assert.rejects(
        db.sequelize.query(
          `UPDATE TelephonyRawEvents
           SET integrationConnectionId = :connectionId
           WHERE id = :id`,
          { replacements: { connectionId: beeline2.connectionId, id: rawEvent.id } },
        ),
        /immutable/iu,
      );

      const [rules] = await db.sequelize.query(
        `SELECT CONSTRAINT_NAME, UPDATE_RULE
         FROM information_schema.REFERENTIAL_CONSTRAINTS
         WHERE CONSTRAINT_SCHEMA = DATABASE()
           AND CONSTRAINT_NAME IN (
             'integration_connections_tenant_club_fk',
             'telephony_calls_connection_tenant_fk',
             'telephony_calls_tenant_club_fk',
             'telephony_raw_events_connection_tenant_fk',
             'telephony_raw_events_tenant_club_fk',
             'telephony_subscriptions_connection_tenant_fk',
             'telephony_subscriptions_tenant_club_fk',
             'receipts_integration_connection_tenant_fk',
             'receipts_tenant_club_fk'
           )`,
      );
      assert.equal(rules.length, 9);
      assert.deepEqual([...new Set(rules.map((rule) => rule.UPDATE_RULE))], ['RESTRICT']);
    });

    await t.test('MySQL locks serialize webhook/runner for one connection and parallelize clubs', async () => {
      const order = [];
      let release;
      let started;
      const startedPromise = new Promise((resolve) => { started = resolve; });
      const gate = new Promise((resolve) => { release = resolve; });
      const webhook = withProviderConnectionLock(beeline1, async () => {
        order.push('webhook-start');
        started();
        await gate;
        order.push('webhook-end');
      });
      await startedPromise;
      const sameRunner = withProviderConnectionLock(beeline1, async () => order.push('same-runner'));
      const otherClubRunner = withProviderConnectionLock(beeline3, async () => order.push('other-club'));
      await otherClubRunner;
      assert.deepEqual(order, ['webhook-start', 'other-club']);
      release();
      await Promise.all([webhook, sameRunner]);
      assert.deepEqual(order, ['webhook-start', 'other-club', 'webhook-end', 'same-runner']);
      assert.notEqual(buildProviderNamespace(beeline1), buildProviderNamespace(beeline3));
    });

    assert.equal(Number(defaultClub.organizationId), Number(defaultOrganization.id));
  } finally {
    await closeServer(apiServer).catch(() => {});
    await closeServer(providerServer).catch(() => {});
    if (db) await db.sequelize.close().catch(() => {});
    if (schemaSequelize) await schemaSequelize.close().catch(() => {});
    await admin.query(`DROP DATABASE IF EXISTS \`${database}\``).catch(() => {});
    await admin.end();
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});
