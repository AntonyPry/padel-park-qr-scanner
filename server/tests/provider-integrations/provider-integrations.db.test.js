'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { test } = require('node:test');
const mysql = require('mysql2/promise');
const SequelizePackage = require('sequelize');

const SERVER_ROOT = path.resolve(__dirname, '../..');
const FEATURE_MIGRATION = require('../../migrations/20260715160000-add-tenant-provider-integrations');

function databaseName() {
  return process.env.TENANT_PROVIDER_TEST_DB_NAME ||
    `setly_tenant_provider_${process.pid}_${Date.now()}`;
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
    .filter((file) => file.endsWith('.js'))
    .sort();
  for (const file of migrations) {
    const migration = require(path.join(SERVER_ROOT, 'migrations', file));
    await migration.up(queryInterface, SequelizePackage);
    await queryInterface.bulkInsert('SequelizeMeta', [{ name: file }]);
  }
  return sequelize;
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
    EVOTOR_WEBHOOK_SECRET: process.env.EVOTOR_WEBHOOK_SECRET,
    INTEGRATION_SECRETS_MASTER_KEY: process.env.INTEGRATION_SECRETS_MASTER_KEY,
    NODE_ENV: process.env.NODE_ENV,
    TENANT_CACHE_REALTIME_ENABLED: process.env.TENANT_CACHE_REALTIME_ENABLED,
    TENANT_CONTEXT_ENABLED: process.env.TENANT_CONTEXT_ENABLED,
    TENANT_FILES_WORKERS_ENABLED: process.env.TENANT_FILES_WORKERS_ENABLED,
    TENANT_PROVIDER_INTEGRATIONS_ENABLED: process.env.TENANT_PROVIDER_INTEGRATIONS_ENABLED,
  };
  process.env.DB_NAME = database;
  process.env.NODE_ENV = 'test';
  process.env.INTEGRATION_SECRETS_MASTER_KEY = Buffer.alloc(32, 11).toString('base64');
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
  try {
    schemaSequelize = await migrateFresh(database);
    db = require('../../models');
    const queryInterface = schemaSequelize.getQueryInterface();
    const {
      createConnection,
      contextWithSecrets,
      generatePublicId,
      resolveIngressConnection,
    } = require('../../src/provider-integrations/connection-service');
    const {
      buildProviderIdempotencyKey,
      buildProviderNamespace,
    } = require('../../src/provider-integrations/idempotency');
    const {
      withProviderConnectionLock,
    } = require('../../src/provider-integrations/locks');
    const evotorService = require('../../src/services/evotor.service');
    const telephonyService = require('../../src/services/telephony.service');
    const tenantFoundation = require('../../src/services/tenant-foundation.service');
    const { tenantFoundationGate } = require('../../src/middleware/tenant-foundation-gate');

    await t.test('migration rolls back and reapplies before provider rows exist', async () => {
      await FEATURE_MIGRATION.down(queryInterface, SequelizePackage);
      assert.equal(
        (await queryInterface.showAllTables()).includes('IntegrationConnections'),
        false,
      );
      await FEATURE_MIGRATION.up(queryInterface, SequelizePackage);
      assert.equal(
        (await queryInterface.showAllTables()).includes('IntegrationConnections'),
        true,
      );
    });

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

    await t.test('HTTP ingress resolves connection and secret before parsing body; flag-off stays legacy', async () => {
      const tenant = {
        clubId: Number(defaultClub.id),
        organizationId: Number(defaultOrganization.id),
      };
      const evotorPublicId = generatePublicId();
      const evotorSmoke = await createConnection({
        ...tenant,
        connectionKey: 'http-smoke',
        provider: 'evotor',
        publicId: evotorPublicId,
        secrets: { webhookSecret: 'evotor-http-secret' },
      });
      const beelinePublicId = generatePublicId();
      await createConnection({
        ...tenant,
        config: {
          apiBaseUrl: 'https://provider.example',
          callbackUrl: `https://crm.example/api/integrations/beeline/events/${beelinePublicId}`,
          subscriptionAutoRenewEnabled: false,
        },
        connectionKey: 'http-smoke',
        provider: 'beeline',
        publicId: beelinePublicId,
        secrets: { apiToken: 'beeline-api-secret', webhookSecret: 'beeline-http-secret' },
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

      delete process.env.TENANT_PROVIDER_INTEGRATIONS_ENABLED;
      const legacyEvotor = await fetch(`${baseUrl}/webhooks/evotor`, {
        body: JSON.stringify({ id: 'http-evotor-legacy', positions: [] }),
        headers: {
          'content-type': 'application/json',
          'x-evotor-token': process.env.EVOTOR_WEBHOOK_SECRET,
        },
        method: 'POST',
      });
      assert.equal(legacyEvotor.status, 200);
      const legacyBeeline = await fetch(`${baseUrl}/integrations/beeline/events`, {
        body: JSON.stringify({ eventId: 'http-beeline-legacy', eventType: 'unknown' }),
        headers: {
          'content-type': 'application/json',
          'x-beeline-webhook-secret': process.env.BEELINE_WEBHOOK_SECRET,
        },
        method: 'POST',
      });
      assert.equal(legacyBeeline.status, 200);
      process.env.TENANT_PROVIDER_INTEGRATIONS_ENABLED = 'true';
      await closeServer(apiServer);
      apiServer = null;
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
    const tenant2 = { clubId: club2Id, organizationId: organization2Id };
    const tenant3 = { clubId: club3Id, organizationId: organization2Id };
    const beeline1Row = await connection('beeline', defaultTenant, 'primary');
    const beeline2Row = await connection('beeline', defaultTenant, 'secondary');
    const beeline3Row = await connection('beeline', tenant2, 'club-2');
    const beeline4Row = await connection('beeline', tenant3, 'club-3');
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
    const beeline3 = await resolveCreatedConnection({
      provider: 'beeline',
      publicId: beeline3Row.publicId,
    });
    const beeline4 = await resolveCreatedConnection({
      provider: 'beeline',
      publicId: beeline4Row.publicId,
    });
    const evotor1 = await resolveCreatedConnection({
      provider: 'evotor',
      publicId: evotor1Row.publicId,
    });
    const evotor2 = await resolveCreatedConnection({
      provider: 'evotor',
      publicId: evotor2Row.publicId,
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

      delete process.env.TENANT_PROVIDER_INTEGRATIONS_ENABLED;
      const legacy = await evotorService.processReceipt({ id: 'legacy-evotor-id', positions: [] });
      const legacyReplay = await evotorService.processReceipt({ id: 'legacy-evotor-id', positions: [] });
      assert.equal(legacy.alreadyProcessed, false);
      assert.equal(legacyReplay.alreadyProcessed, true);
      process.env.TENANT_PROVIDER_INTEGRATIONS_ENABLED = 'true';
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
