'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const SequelizePackage = require('sequelize');
const {
  connect,
  createDisposableDatabase,
  dropDisposableDatabase,
  migrateAll,
  seedTwoTenantFixture,
} = require('../helpers/final-tenant-rc-fixture');

const CAPABILITY_ENV = [
  'TENANT_CONTEXT_ENABLED',
  'TENANT_CACHE_REALTIME_ENABLED',
  'TENANT_FILES_WORKERS_ENABLED',
  'TENANT_PROVIDER_INTEGRATIONS_ENABLED',
  'TENANT_STAFF_ACCESS_ENABLED',
  'TENANT_CLIENTS_REFERENCES_ENABLED',
  'TENANT_VISITS_SCANNER_ENABLED',
  'TENANT_CLIENT_BASES_CALL_TASKS_ENABLED',
  'TENANT_BOOKINGS_COURTS_ENABLED',
  'TENANT_METHODOLOGY_SKILL_MAP_ENABLED',
  'TENANT_TRAINING_NOTES_PLANS_ENABLED',
  'TENANT_CLIENT_MONEY_INSTRUMENTS_ENABLED',
  'TENANT_SHIFTS_REPORTS_ENABLED',
  'TENANT_AUDIT_LOG_ENABLED',
  'TENANT_ONBOARDING_ENABLED',
  'TENANT_ENFORCEMENT_ENABLED',
];

function restoreEnv(previous) {
  for (const [name, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

async function expectDatabaseReject(promise, pattern) {
  await assert.rejects(
    promise,
    (error) => pattern.test(String(error?.parent?.sqlMessage || error?.message || error)),
  );
}

test('Feature 9 final enforcement, detector and two-Organization RC matrix', async () => {
  assert.ok(process.env.DB_USER, 'DB_USER is required for Feature 9 DB gate');
  const database = process.env.TENANT_ENFORCEMENT_TEST_DB_NAME ||
    `setly_f9_rc_enforcement_${process.pid}_${Date.now()}`;
  const previous = Object.fromEntries([
    ...CAPABILITY_ENV,
    'DB_NAME',
    'NODE_ENV',
    'TENANT_ENFORCEMENT_TEST_DB_NAME',
  ].map((name) => [name, process.env[name]]));
  let rootDb;
  let schema;
  await createDisposableDatabase(database);
  process.env.DB_NAME = database;
  process.env.NODE_ENV = 'test';
  for (const name of CAPABILITY_ENV) process.env[name] = 'false';

  try {
    schema = connect(database);
    const migrations = await migrateAll(schema);
    assert.equal(migrations.at(-1), '20260720100000-add-final-tenant-enforcement.js');
    const finalMigration = require('../../migrations/20260720100000-add-final-tenant-enforcement');
    const queryInterface = schema.getQueryInterface();

    await finalMigration.down(queryInterface, SequelizePackage);
    await finalMigration.up(queryInterface, SequelizePackage);
    await finalMigration.up(queryInterface, SequelizePackage);

    const fixture = await seedTwoTenantFixture(schema);
    for (const name of CAPABILITY_ENV) process.env[name] = 'true';
    rootDb = require('../../models');
    const {
      classifyTenantFoundation,
    } = require('../../src/services/tenant-foundation.service');
    const {
      runTenantIntegrityDetector,
    } = require('../../src/tenant-enforcement/integrity-detector');
    const tenantContextService = require('../../src/services/tenant-context.service');
    const classification = await classifyTenantFoundation({ sequelize: rootDb.sequelize });
    assert.equal(classification.state, 'initialized');
    assert.deepEqual(classification.counts, {
      accesses: 20,
      accounts: 12,
      clubs: 4,
      memberships: 12,
      organizations: 2,
    });
    assert.equal(classification.diagnostics.enforcementEnabled, true);

    const report = await runTenantIntegrityDetector({
      sequelize: rootDb.sequelize,
      strict: true,
    });
    assert.equal(report.ok, true, JSON.stringify(report.findings, null, 2));
    assert.equal(report.counts.unsafe, 0);
    assert.ok(report.counts.tables >= 70);
    assert.ok(report.counts.foreignKeys >= 210);

    const identityA = fixture.identities.A.admin;
    const organizationContextA = await tenantContextService.resolveTenantContext({
      accountId: identityA.accountId,
      organizationId: fixture.organizations.A,
      scope: 'organization',
    });
    const clubContextA = await tenantContextService.resolveTenantContext({
      accountId: identityA.accountId,
      clubId: fixture.clubs.A[0],
      organizationId: fixture.organizations.A,
      scope: 'club',
    });
    const secondClubContextA = await tenantContextService.resolveTenantContext({
      accountId: identityA.accountId,
      clubId: fixture.clubs.A[1],
      organizationId: fixture.organizations.A,
      scope: 'club',
    });
    assert.notEqual(clubContextA.clubId, secondClubContextA.clubId);
    await assert.rejects(
      tenantContextService.resolveTenantContext({
        accountId: identityA.accountId,
        clubId: fixture.clubs.B[0],
        organizationId: fixture.organizations.B,
        scope: 'club',
      }),
      (error) => error.code === 'TENANT_CONTEXT_NOT_FOUND',
    );

    const contexts = [
      require('../../src/services/staff-access-context.service')
        .resolveStaffAccessContext(organizationContextA),
      require('../../src/services/client-access-context.service')
        .resolveClientAccessContext(clubContextA),
      require('../../src/services/visit-access-context.service')
        .resolveVisitAccessContext(clubContextA),
      require('../../src/services/call-task-access-context.service')
        .resolveCallTaskAccessContext(clubContextA),
      require('../../src/services/booking-access-context.service')
        .resolveBookingAccessContext(clubContextA),
      require('../../src/services/methodology-access-context.service')
        .resolveMethodologyAccessContext(clubContextA),
      require('../../src/services/client-money-access-context.service')
        .resolveClientMoneyAccessContext(clubContextA),
      require('../../src/services/audit-access-context.service')
        .resolveAuditAccessContext(
          { id: identityA.accountId, role: 'admin' },
          organizationContextA,
          'organization',
        ),
      require('../../src/services/onboarding-access-context.service')
        .resolveOnboardingAccessContext(
          { id: identityA.accountId, role: 'admin' },
          organizationContextA,
          'organization',
        ),
    ];
    const resolved = await Promise.all(contexts);
    assert.equal(resolved.length, 9);
    assert.ok(resolved.every(
      (context) => Number(context.organizationId) === fixture.organizations.A,
    ));

    const filesWorkerTenant = require('../../src/files-workers/tenant-context');
    assert.deepEqual(
      await filesWorkerTenant.resolveTrustedTenantAttribution({
        clubId: fixture.clubs.B[0],
        organizationId: fixture.organizations.B,
      }),
      {
        clubId: fixture.clubs.B[0],
        organizationId: fixture.organizations.B,
      },
    );
    await assert.rejects(
      filesWorkerTenant.getExactDefaultTenant(),
      (error) => error.code === 'TENANT_SINGLE_DEFAULT_REQUIRED',
    );
    assert.deepEqual(
      await require('../../src/provider-integrations/runtime')
        .assertLegacyDownstreamReady({
          clubId: fixture.clubs.B[0],
          organizationId: fixture.organizations.B,
        }),
      {
        clubId: fixture.clubs.B[0],
        organizationId: fixture.organizations.B,
      },
    );

    const { buildTenantStorageKey } = require('../../src/storage/tenant-storage');
    const storageA = buildTenantStorageKey({
      clubId: fixture.clubs.A[0],
      domain: 'reports',
      fileId: 'same-file',
      organizationId: fixture.organizations.A,
      recordId: 'same-record',
    });
    const storageB = buildTenantStorageKey({
      clubId: fixture.clubs.B[0],
      domain: 'reports',
      fileId: 'same-file',
      organizationId: fixture.organizations.B,
      recordId: 'same-record',
    });
    assert.notEqual(storageA, storageB);
    const cache = require('../../src/services/cache.service');
    assert.notEqual(
      cache.buildTenantCachePrefix({ domain: 'clients', scope: 'club', tenant: clubContextA }),
      cache.buildTenantCachePrefix({
        domain: 'clients',
        scope: 'club',
        tenant: await tenantContextService.resolveTenantContext({
          accountId: fixture.identities.B.admin.accountId,
          clubId: fixture.clubs.B[0],
          organizationId: fixture.organizations.B,
          scope: 'club',
        }),
      }),
    );
    const { getTenantDomainRoom } = require('../../src/realtime/permissions');
    const clubContextB = await tenantContextService.resolveTenantContext({
      accountId: fixture.identities.B.admin.accountId,
      clubId: fixture.clubs.B[0],
      organizationId: fixture.organizations.B,
      scope: 'club',
    });
    assert.notEqual(
      getTenantDomainRoom('club', clubContextA, 'clients'),
      getTenantDomainRoom('club', clubContextB, 'clients'),
    );

    process.env.TENANT_CLIENTS_REFERENCES_ENABLED = 'false';
    await assert.rejects(
      require('../../src/services/client-access-context.service')
        .resolveClientAccessContext(null),
      (error) => error.code === 'TENANT_SINGLE_DEFAULT_REQUIRED' && error.statusCode === 503,
    );
    process.env.TENANT_CLIENTS_REFERENCES_ENABLED = 'true';

    await expectDatabaseReject(
      schema.query(
        'UPDATE Clubs SET organizationId=:organizationId WHERE id=:clubId',
        {
          replacements: {
            clubId: fixture.clubs.A[1],
            organizationId: fixture.organizations.B,
          },
        },
      ),
      /Club tenant attribution is immutable/,
    );
    await expectDatabaseReject(
      schema.query(
        `INSERT INTO TelephonyRawEvents
           (organizationId,clubId,integrationConnectionId,idempotencyKey,deliveryCount,
            provider,payload,receivedAt,processingStatus,telephonyCallId,createdAt,updatedAt)
         VALUES (:organizationId,:clubId,:connectionId,'cross-raw-event',1,'beeline','{}',
           NOW(),'new',:callId,NOW(),NOW())`,
        {
          replacements: {
            callId: fixture.providers.A.callId,
            clubId: fixture.clubs.B[0],
            connectionId: fixture.providers.B.beelineConnectionId,
            organizationId: fixture.organizations.B,
          },
        },
      ),
      /foreign key constraint fails/i,
    );

    await schema.query('SET FOREIGN_KEY_CHECKS=0');
    try {
      await schema.query(
        `INSERT INTO Clubs
           (organizationId,slug,name,timezone,status,createdAt,updatedAt)
         VALUES (999999,'orphan-f9','Orphan','Europe/Moscow','active',NOW(),NOW())`,
      );
      await schema.query(
        `INSERT INTO TelephonyTranscriptionJobs
           (organizationId,clubId,telephonyCallId,status,attemptCount,createdAt,updatedAt)
         VALUES (:organizationId,:clubId,:callId,'queued',0,NOW(),NOW())`,
        {
          replacements: {
            callId: fixture.providers.A.callId,
            clubId: fixture.clubs.B[0],
            organizationId: fixture.organizations.B,
          },
        },
      );
      const violated = await runTenantIntegrityDetector({
        sequelize: rootDb.sequelize,
        strict: true,
      });
      assert.equal(violated.ok, false);
      assert.ok(violated.findings.some(
        (item) => item.code === 'MISSING_ORGANIZATION_OWNER' && item.table === 'Clubs',
      ));
      assert.ok(violated.findings.some(
        (item) => item.code === 'CROSS_TENANT_TRANSCRIPTION_JOB_CALL',
      ));
      await schema.query(
        'DELETE FROM TelephonyTranscriptionJobs WHERE telephonyCallId=:callId AND organizationId=:organizationId',
        {
          replacements: {
            callId: fixture.providers.A.callId,
            organizationId: fixture.organizations.B,
          },
        },
      );
      await schema.query("DELETE FROM Clubs WHERE slug='orphan-f9'");
    } finally {
      await schema.query('SET FOREIGN_KEY_CHECKS=1');
    }
    const cleanAgain = await runTenantIntegrityDetector({
      sequelize: rootDb.sequelize,
      strict: true,
    });
    assert.equal(cleanAgain.ok, true, JSON.stringify(cleanAgain.findings, null, 2));
    if (process.env.TENANT_RC_ARTIFACT_DIR) {
      const artifactRoot = path.resolve(process.env.TENANT_RC_ARTIFACT_DIR);
      assert.match(artifactRoot, /setly-f9-rc-/);
      fs.mkdirSync(artifactRoot, { recursive: true });
      fs.writeFileSync(
        path.join(artifactRoot, 'tenant-integrity-report.json'),
        `${JSON.stringify({
          fixtureCounts: classification.counts,
          generatedAt: new Date().toISOString(),
          ...cleanAgain,
        }, null, 2)}\n`,
        { flag: 'wx' },
      );
    }

    await assert.rejects(
      finalMigration.down(queryInterface, SequelizePackage),
      (error) => error.code === 'TENANT_ENFORCEMENT_ROLLBACK_REFUSED',
    );
  } finally {
    await rootDb?.sequelize.close().catch(() => {});
    await schema?.close().catch(() => {});
    restoreEnv(previous);
    await dropDisposableDatabase(database).catch(() => {});
  }
});
