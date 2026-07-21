'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { test } = require('node:test');
const {
  connect,
  createDisposableDatabase,
  dropDisposableDatabase,
  migrateAll,
  seedTwoTenantFixture,
} = require('../helpers/final-tenant-rc-fixture');
const {
  ACCEPTED_TENANT_CAPABILITY_ENV,
} = require('../helpers/accepted-tenant-schema');

test('Feature 10.4 exact-Club settings and encrypted integration mutations', async () => {
  assert.ok(process.env.DB_USER, 'DB_USER is required for Feature 10.4 DB tests');
  const database = `setly_f9_rc_installation_management_${process.pid}_${Date.now()}`;
  const previous = Object.fromEntries([
    ...ACCEPTED_TENANT_CAPABILITY_ENV,
    'TENANT_ENFORCEMENT_ENABLED',
    'DB_NAME',
    'INTEGRATION_SECRETS_KEY_VERSION',
    'INTEGRATION_SECRETS_MASTER_KEY',
    'INSTALLATION_PROVIDER_VALIDATION_MODE',
    'INSTALLATION_MANAGEMENT_ENABLED',
    'INSTALLATION_OPERATOR_PASSWORD',
    'INSTALLATION_OPERATOR_SECRET',
    'INSTALLATION_OPERATOR_USERNAME',
    'NODE_ENV',
  ].map((name) => [name, process.env[name]]));
  let schema;
  let db;
  let restoreInstrumentation = () => {};
  await createDisposableDatabase(database);
  process.env.DB_NAME = database;
  process.env.NODE_ENV = 'test';
  process.env.INTEGRATION_SECRETS_KEY_VERSION = 'test-v1';
  process.env.INTEGRATION_SECRETS_MASTER_KEY = crypto.randomBytes(32).toString('base64');
  process.env.INSTALLATION_PROVIDER_VALIDATION_MODE = 'preview';
  process.env.INSTALLATION_MANAGEMENT_ENABLED = 'true';
  process.env.INSTALLATION_OPERATOR_PASSWORD = 'feature-10-4-db-password';
  process.env.INSTALLATION_OPERATOR_SECRET = 'feature-10-4-db-secret-that-is-long-enough';
  process.env.INSTALLATION_OPERATOR_USERNAME = 'feature-10-4-db-test';
  for (const name of ACCEPTED_TENANT_CAPABILITY_ENV) process.env[name] = 'false';
  process.env.TENANT_ENFORCEMENT_ENABLED = 'false';

  try {
    schema = connect(database);
    await migrateAll(schema);
    const fixture = await seedTwoTenantFixture(schema);
    for (const name of ACCEPTED_TENANT_CAPABILITY_ENV) process.env[name] = 'true';
    process.env.TENANT_ENFORCEMENT_ENABLED = 'true';
    db = require('../../models');
    const connectionService = require('../../src/provider-integrations/connection-service');
    const operatorValidation = require('../../src/provider-integrations/operator-validation');
    const telephonyService = require('../../src/services/telephony.service');
    const originalContextWithSecrets = connectionService.contextWithSecrets;
    const originalValidateProviderCandidate = operatorValidation.validateProviderCandidate;
    const originalCheckEventSubscription = telephonyService.checkEventSubscription;
    const counters = { decrypts: 0, providerCalls: 0 };
    let providerGate = null;
    connectionService.contextWithSecrets = (row) => {
      counters.decrypts += 1;
      return originalContextWithSecrets(row);
    };
    operatorValidation.validateProviderCandidate = async (...args) => {
      counters.providerCalls += 1;
      if (providerGate?.kind === 'validation') {
        const gate = providerGate;
        providerGate = null;
        gate.entered();
        await gate.release;
      }
      return originalValidateProviderCandidate(...args);
    };
    telephonyService.checkEventSubscription = async (...args) => {
      counters.providerCalls += 1;
      if (providerGate?.kind === 'beeline') {
        const gate = providerGate;
        providerGate = null;
        gate.entered();
        await gate.release;
      }
      if (process.env.INSTALLATION_PROVIDER_VALIDATION_MODE === 'authority-race') {
        return { lastCheckedAt: new Date().toISOString(), status: 'active' };
      }
      return originalCheckEventSubscription(...args);
    };
    restoreInstrumentation = () => {
      connectionService.contextWithSecrets = originalContextWithSecrets;
      operatorValidation.validateProviderCandidate = originalValidateProviderCandidate;
      telephonyService.checkEventSubscription = originalCheckEventSubscription;
    };
    const management = require('../../src/services/installation-management.service');
    const operatorAuth = require('../../src/services/installation-operator-auth.service');
    const { contextWithSecrets } = connectionService;
    const operatorSession = await operatorAuth.createSession({
      password: process.env.INSTALLATION_OPERATOR_PASSWORD,
      username: process.env.INSTALLATION_OPERATOR_USERNAME,
    });
    const operator = await operatorAuth.verifySession(operatorSession.token);
    const organizationId = fixture.organizations.A;
    const clubId = fixture.clubs.A[1];
    const peerClubId = fixture.clubs.B[1];

    const organizationBefore = await db.Organization.findByPk(organizationId);
    const organizationSlug = organizationBefore.slug;
    const renameInput = {
      expectedUpdatedAt: organizationBefore.updatedAt.toISOString(),
      idempotencyKey: crypto.randomUUID(),
      name: '  Организация   после обновления  ',
    };
    const renamed = await management.updateOrganization(organizationId, renameInput, operator);
    assert.equal(renamed.organization.name, 'Организация после обновления');
    assert.equal((await db.Organization.findByPk(organizationId)).slug, organizationSlug);
    const replayed = await management.updateOrganization(organizationId, renameInput, operator);
    assert.equal(replayed.idempotency.replayed, true);
    assert.equal(replayed.auditLogId, renamed.auditLogId);

    const mutationCounts = async () => ({
      audits: await db.AuditLog.count({ where: { action: 'installation.organization.update' } }),
      operations: await db.InstallationMutationOperation.count({
        where: { action: 'installation.organization.update' },
      }),
    });
    assert.deepEqual(await mutationCounts(), { audits: 1, operations: 1 });
    await assert.rejects(
      management.updateOrganization(organizationId, {
        ...renameInput,
        idempotencyKey: crypto.randomUUID(),
        name: 'Несвежее изменение',
      }, operator),
      (error) => error.code === 'INSTALLATION_STALE_STATE',
    );
    assert.deepEqual(await mutationCounts(), { audits: 1, operations: 1 });

    const clubBefore = await db.Club.findByPk(clubId);
    const clubSlug = clubBefore.slug;
    await management.updateClub(organizationId, clubId, {
      expectedUpdatedAt: clubBefore.updatedAt.toISOString(),
      idempotencyKey: crypto.randomUUID(),
      name: 'Клуб с новым названием',
      timezone: 'Europe/Moscow',
    }, operator);
    const clubAfter = await db.Club.findByPk(clubId);
    assert.equal(clubAfter.slug, clubSlug);
    assert.equal(clubAfter.timezone, 'Europe/Moscow');
    await assert.rejects(
      management.updateClub(organizationId, peerClubId, {
        expectedUpdatedAt: clubAfter.updatedAt.toISOString(),
        idempotencyKey: crypto.randomUUID(),
        name: 'Подмена клуба',
        timezone: 'Europe/Moscow',
      }, operator),
      (error) => error.code === 'INSTALLATION_CLUB_NOT_FOUND',
    );

    const telegramToken = 'preview-telegram-token-club-a';
    const configured = await management.configureIntegration(
      organizationId,
      clubId,
      'telegram',
      {
        credential: telegramToken,
        expectedUpdatedAt: null,
        idempotencyKey: crypto.randomUUID(),
        proxyUrl: 'socks5://preview-user:preview-pass@127.0.0.1:1080',
      },
      operator,
    );
    assert.equal(configured.integration.configured, true);
    assert.equal(configured.integration.status, 'disabled');
    assert.equal(configured.integration.proxyConfigured, true);
    assert.equal(JSON.stringify(configured).includes(telegramToken), false);
    const telegramRow = await db.IntegrationConnection.unscoped().findOne({
      where: { clubId, organizationId, provider: 'telegram' },
    });
    assert.equal(telegramRow.secretCiphertext.includes(telegramToken), false);
    assert.equal(contextWithSecrets(telegramRow).secrets.botToken, telegramToken);
    assert.match(telegramRow.credentialFingerprint, /^[a-f0-9]{64}$/u);
    assert.notEqual(
      telegramRow.credentialFingerprint,
      crypto.createHash('sha256').update(telegramToken).digest('hex'),
    );

    const ciphertextBeforeBlankEdit = telegramRow.secretCiphertext;
    const secretUpdatedBeforeBlankEdit = telegramRow.secretUpdatedAt.toISOString();
    await management.configureIntegration(
      organizationId,
      clubId,
      'telegram',
      {
        expectedUpdatedAt: telegramRow.updatedAt.toISOString(),
        idempotencyKey: crypto.randomUUID(),
      },
      operator,
    );
    await telegramRow.reload();
    assert.equal(telegramRow.secretCiphertext, ciphertextBeforeBlankEdit);
    assert.equal(telegramRow.secretUpdatedAt.toISOString(), secretUpdatedBeforeBlankEdit);

    const beforeDuplicate = {
      audits: await db.AuditLog.count(),
      connections: await db.IntegrationConnection.count(),
      operations: await db.InstallationMutationOperation.count(),
    };
    await assert.rejects(
      management.configureIntegration(
        fixture.organizations.B,
        peerClubId,
        'telegram',
        {
          credential: telegramToken,
          expectedUpdatedAt: null,
          idempotencyKey: crypto.randomUUID(),
        },
        operator,
      ),
      (error) => error.code === 'INTEGRATION_CREDENTIAL_DUPLICATE',
    );
    assert.deepEqual({
      audits: await db.AuditLog.count(),
      connections: await db.IntegrationConnection.count(),
      operations: await db.InstallationMutationOperation.count(),
    }, beforeDuplicate);

    const detail = await management.getInstallationOrganization(organizationId, operator);
    const projection = detail.clubs.find((club) => club.id === clubId)
      .integrations.find((item) => item.provider === 'telegram');
    assert.equal(projection.configured, true);
    assert.equal(JSON.stringify(detail).includes(telegramToken), false);
    assert.equal(JSON.stringify(detail).includes('secretCiphertext'), false);
    assert.equal(JSON.stringify(detail).includes('credentialFingerprint'), false);

    await management.setIntegrationStatus(
      organizationId,
      clubId,
      'telegram',
      'active',
      {
        expectedUpdatedAt: telegramRow.updatedAt.toISOString(),
        idempotencyKey: crypto.randomUUID(),
      },
      operator,
    );
    await telegramRow.reload();
    assert.equal(telegramRow.status, 'active');
    await management.setIntegrationStatus(
      organizationId,
      clubId,
      'telegram',
      'revoked',
      {
        expectedUpdatedAt: telegramRow.updatedAt.toISOString(),
        idempotencyKey: crypto.randomUUID(),
      },
      operator,
    );
    await telegramRow.reload();
    assert.equal(telegramRow.status, 'revoked');
    await assert.rejects(
      management.setIntegrationStatus(
        organizationId,
        clubId,
        'telegram',
        'active',
        {
          expectedUpdatedAt: telegramRow.updatedAt.toISOString(),
          idempotencyKey: crypto.randomUUID(),
        },
        operator,
      ),
      (error) => error.code === 'INTEGRATION_CREDENTIAL_REVOKED',
    );
    await management.rotateIntegrationCredential(
      organizationId,
      clubId,
      'telegram',
      {
        credential: 'preview-telegram-token-after-revoke',
        expectedUpdatedAt: telegramRow.updatedAt.toISOString(),
        idempotencyKey: crypto.randomUUID(),
      },
      operator,
    );
    await telegramRow.reload();
    assert.equal(telegramRow.status, 'disabled');
    await management.setIntegrationStatus(
      organizationId,
      clubId,
      'telegram',
      'active',
      {
        expectedUpdatedAt: telegramRow.updatedAt.toISOString(),
        idempotencyKey: crypto.randomUUID(),
      },
      operator,
    );
    await telegramRow.reload();
    assert.equal(telegramRow.status, 'active');

    const legacyBeelineRows = await db.IntegrationConnection.unscoped().findAll({
      where: { provider: 'beeline' },
    });
    for (const row of legacyBeelineRows) {
      await row.update({
        credentialFingerprint: crypto.createHmac(
          'sha256',
          Buffer.from(process.env.INTEGRATION_SECRETS_MASTER_KEY, 'base64'),
        ).update(`legacy-test\u001f${row.publicId}`).digest('hex'),
        fingerprintKeyVersion: process.env.INTEGRATION_SECRETS_KEY_VERSION,
      });
    }
    const beelineConfigured = await management.configureIntegration(
      organizationId,
      clubId,
      'beeline',
      {
        credential: 'preview-beeline-token-club-a',
        expectedUpdatedAt: null,
        idempotencyKey: crypto.randomUUID(),
        settings: {
          apiBaseUrl: 'https://provider.example',
          apiTimeoutMs: 15000,
          callbackBaseUrl: 'https://api.setly.test/api/integrations/beeline/events',
          recordsPath: '/records',
          statisticsPath: '/statistics',
          subscriptionAutoRenewEnabled: true,
          subscriptionExpiresSeconds: 3600,
          subscriptionPath: '/subscription',
          subscriptionPattern: '.*',
          subscriptionRenewBeforeSeconds: 600,
          subscriptionType: 'CALL_EVENTS',
        },
      },
      operator,
    );
    assert.equal(beelineConfigured.integration.status, 'disabled');
    const beelineRow = await db.IntegrationConnection.unscoped().findOne({
      where: { clubId, organizationId, provider: 'beeline' },
    });
    await management.setIntegrationStatus(
      organizationId,
      clubId,
      'beeline',
      'active',
      {
        expectedUpdatedAt: beelineRow.updatedAt.toISOString(),
        idempotencyKey: crypto.randomUUID(),
      },
      operator,
    );
    await beelineRow.reload();

    const createAuthority = async () => {
      const session = await operatorAuth.createSession({
        password: process.env.INSTALLATION_OPERATOR_PASSWORD,
        username: process.env.INSTALLATION_OPERATOR_USERNAME,
      });
      return operatorAuth.verifySession(session.token);
    };
    const gatedActionWins = async (kind, action) => {
      const authority = await createAuthority();
      let entered;
      let release;
      const enteredPromise = new Promise((resolve) => { entered = resolve; });
      const releasePromise = new Promise((resolve) => { release = resolve; });
      providerGate = { entered, kind, release: releasePromise };
      const actionPromise = action(authority);
      await Promise.race([
        enteredPromise,
        actionPromise.then(() => {
          throw new Error(`${kind} action completed before provider preflight gate`);
        }),
        new Promise((resolve, reject) => setTimeout(
          () => reject(new Error(`${kind} provider preflight gate timed out`)),
          5000,
        )),
      ]);
      let revoked = false;
      const revokePromise = operatorAuth.revokeSession(authority).then((result) => {
        revoked = true;
        return result;
      });
      await new Promise((resolve) => setTimeout(resolve, 40));
      assert.equal(revoked, false, `${kind} must retain the session row lock through commit`);
      release();
      await actionPromise;
      assert.equal(await revokePromise, true);
    };

    await gatedActionWins('validation', (authority) => management.configureIntegration(
      fixture.organizations.B,
      fixture.clubs.B[1],
      'vk',
      {
        credential: 'preview-vk-action-wins',
        expectedUpdatedAt: null,
        idempotencyKey: crypto.randomUUID(),
      },
      authority,
    ));
    await telegramRow.reload();
    await gatedActionWins('validation', (authority) => management.rotateIntegrationCredential(
      organizationId,
      clubId,
      'telegram',
      {
        credential: 'preview-telegram-token-action-wins',
        expectedUpdatedAt: telegramRow.updatedAt.toISOString(),
        idempotencyKey: crypto.randomUUID(),
      },
      authority,
    ));
    await telegramRow.reload();
    await management.setIntegrationStatus(
      organizationId,
      clubId,
      'telegram',
      'disabled',
      {
        expectedUpdatedAt: telegramRow.updatedAt.toISOString(),
        idempotencyKey: crypto.randomUUID(),
      },
      operator,
    );
    await telegramRow.reload();
    await gatedActionWins('validation', (authority) => management.setIntegrationStatus(
      organizationId,
      clubId,
      'telegram',
      'active',
      {
        expectedUpdatedAt: telegramRow.updatedAt.toISOString(),
        idempotencyKey: crypto.randomUUID(),
      },
      authority,
    ));
    await telegramRow.reload();
    await gatedActionWins('validation', (authority) => management.validateIntegration(
      organizationId,
      clubId,
      'telegram',
      {
        expectedUpdatedAt: telegramRow.updatedAt.toISOString(),
        idempotencyKey: crypto.randomUUID(),
      },
      authority,
    ));
    await beelineRow.reload();
    process.env.INSTALLATION_PROVIDER_VALIDATION_MODE = 'authority-race';
    try {
      await gatedActionWins('beeline', (authority) => management.runBeelineAction(
        organizationId,
        clubId,
        'check',
        {
          expectedUpdatedAt: beelineRow.updatedAt.toISOString(),
          idempotencyKey: crypto.randomUUID(),
        },
        authority,
      ));
    } finally {
      process.env.INSTALLATION_PROVIDER_VALIDATION_MODE = 'preview';
    }

    const revokedAuthority = await createAuthority();
    await operatorAuth.revokeSession(revokedAuthority);
    await telegramRow.reload();
    await beelineRow.reload();
    const beforeRevokedPreflights = {
      audits: await db.AuditLog.count(),
      connections: await db.IntegrationConnection.count(),
      decrypts: counters.decrypts,
      operations: await db.InstallationMutationOperation.count(),
      providerCalls: counters.providerCalls,
    };
    const revokedPreflights = [
      () => management.configureIntegration(
        fixture.organizations.B,
        fixture.clubs.B[1],
        'evotor',
        {
          credential: 'preview-evotor-revoke-wins',
          expectedUpdatedAt: null,
          idempotencyKey: crypto.randomUUID(),
        },
        revokedAuthority,
      ),
      () => management.rotateIntegrationCredential(
        organizationId,
        clubId,
        'telegram',
        {
          credential: 'preview-telegram-revoke-wins',
          expectedUpdatedAt: telegramRow.updatedAt.toISOString(),
          idempotencyKey: crypto.randomUUID(),
        },
        revokedAuthority,
      ),
      () => management.setIntegrationStatus(
        organizationId,
        clubId,
        'telegram',
        'active',
        {
          expectedUpdatedAt: telegramRow.updatedAt.toISOString(),
          idempotencyKey: crypto.randomUUID(),
        },
        revokedAuthority,
      ),
      () => management.validateIntegration(
        organizationId,
        clubId,
        'telegram',
        {
          expectedUpdatedAt: telegramRow.updatedAt.toISOString(),
          idempotencyKey: crypto.randomUUID(),
        },
        revokedAuthority,
      ),
      () => management.runBeelineAction(
        organizationId,
        clubId,
        'check',
        {
          expectedUpdatedAt: beelineRow.updatedAt.toISOString(),
          idempotencyKey: crypto.randomUUID(),
        },
        revokedAuthority,
      ),
    ];
    for (const action of revokedPreflights) {
      await assert.rejects(
        action(),
        (error) => error.code === 'INSTALLATION_OPERATOR_SESSION_INVALID',
      );
    }
    assert.deepEqual({
      audits: await db.AuditLog.count(),
      connections: await db.IntegrationConnection.count(),
      decrypts: counters.decrypts,
      operations: await db.InstallationMutationOperation.count(),
      providerCalls: counters.providerCalls,
    }, beforeRevokedPreflights);

    const replayAuthority = await createAuthority();
    await telegramRow.reload();
    const replayInput = {
      expectedUpdatedAt: telegramRow.updatedAt.toISOString(),
      idempotencyKey: crypto.randomUUID(),
    };
    await management.validateIntegration(
      organizationId,
      clubId,
      'telegram',
      replayInput,
      replayAuthority,
    );
    await operatorAuth.revokeSession(replayAuthority);
    const beforeRevokedReplay = { ...counters };
    await assert.rejects(
      management.validateIntegration(
        organizationId,
        clubId,
        'telegram',
        replayInput,
        replayAuthority,
      ),
      (error) => error.code === 'INSTALLATION_OPERATOR_SESSION_INVALID',
    );
    assert.deepEqual(counters, beforeRevokedReplay);

    const clubBeforeArchive = await db.Club.findByPk(clubId);
    await management.setClubLifecycle(
      organizationId,
      clubId,
      'archived',
      {
        confirmImpact: true,
        expectedUpdatedAt: clubBeforeArchive.updatedAt.toISOString(),
        idempotencyKey: crypto.randomUUID(),
      },
      operator,
    );
    await telegramRow.reload();
    assert.equal(telegramRow.status, 'disabled');
    const archivedClub = await db.Club.findByPk(clubId);
    assert.equal(archivedClub.status, 'archived');
    await management.setClubLifecycle(
      organizationId,
      clubId,
      'active',
      {
        expectedUpdatedAt: archivedClub.updatedAt.toISOString(),
        idempotencyKey: crypto.randomUUID(),
      },
      operator,
    );
    await telegramRow.reload();
    assert.equal((await db.Club.findByPk(clubId)).status, 'active');
    assert.equal(telegramRow.status, 'disabled');
  } finally {
    restoreInstrumentation();
    if (db?.sequelize) await db.sequelize.close();
    if (schema) await schema.close();
    await dropDisposableDatabase(database);
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});
