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
const {
  assertFeature10_4IntegrationConnectionSchema,
} = require('../helpers/feature-10-4-schema');
const {
  FOREIGN_KEY_DEFINITIONS,
  INDEX_DEFINITIONS,
  TRIGGER_DEFINITIONS,
  classifyFinalEnforcementDefinition,
} = require('../../src/tenant-enforcement/final-enforcement-definition');

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

async function enforcementFingerprint(schema) {
  const queries = [
    `SELECT TABLE_NAME,INDEX_NAME,NON_UNIQUE,INDEX_TYPE,SEQ_IN_INDEX,COLUMN_NAME,SUB_PART,COLLATION
       FROM INFORMATION_SCHEMA.STATISTICS
      WHERE TABLE_SCHEMA=DATABASE()
        AND (INDEX_NAME LIKE 'uq_final_%' OR INDEX_NAME LIKE 'fk_final_%')
      ORDER BY TABLE_NAME,INDEX_NAME,SEQ_IN_INDEX`,
    `SELECT k.TABLE_NAME,k.CONSTRAINT_NAME,k.COLUMN_NAME,k.REFERENCED_TABLE_NAME,
            k.REFERENCED_COLUMN_NAME,k.ORDINAL_POSITION,r.UPDATE_RULE,r.DELETE_RULE
       FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE AS k
       LEFT JOIN INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS AS r
         ON r.CONSTRAINT_SCHEMA=k.CONSTRAINT_SCHEMA
        AND r.TABLE_NAME=k.TABLE_NAME
        AND r.CONSTRAINT_NAME=k.CONSTRAINT_NAME
      WHERE k.CONSTRAINT_SCHEMA=DATABASE()
        AND k.CONSTRAINT_NAME LIKE 'fk_final_%'
      ORDER BY k.TABLE_NAME,k.CONSTRAINT_NAME,k.ORDINAL_POSITION`,
    `SELECT EVENT_OBJECT_TABLE,TRIGGER_NAME,EVENT_MANIPULATION,ACTION_TIMING,
            ACTION_ORIENTATION,ACTION_STATEMENT
       FROM INFORMATION_SCHEMA.TRIGGERS
      WHERE TRIGGER_SCHEMA=DATABASE() AND TRIGGER_NAME LIKE 'trg_final_%'
      ORDER BY EVENT_OBJECT_TABLE,TRIGGER_NAME`,
    `SELECT
       (SELECT COUNT(*) FROM Organizations) AS organizations,
       (SELECT COUNT(*) FROM Clubs) AS clubs,
       (SELECT COUNT(*) FROM Staffs) AS staffs,
       (SELECT COUNT(*) FROM Memberships) AS memberships,
       (SELECT COUNT(*) FROM MembershipClubAccesses) AS accesses,
       (SELECT COUNT(*) FROM TelephonyCalls) AS calls,
       (SELECT COUNT(*) FROM TelephonyRawEvents) AS rawEvents,
       (SELECT COUNT(*) FROM TelephonyTranscriptionJobs) AS jobs,
       (SELECT COUNT(*) FROM TelephonyTranscriptSegments) AS segments`,
  ];
  const result = [];
  for (const sql of queries) {
    const [rows] = await schema.query(sql);
    result.push(rows);
  }
  return JSON.stringify(result);
}

async function expectBlockedWithoutMutation(schema, operation, code = 'TENANT_ENFORCEMENT_MIGRATION_BLOCKED') {
  const before = await enforcementFingerprint(schema);
  await assert.rejects(operation(), (error) => error.code === code);
  assert.equal(await enforcementFingerprint(schema), before);
}

test('Feature 9 final enforcement, detector and two-Organization RC matrix', async () => {
  assert.ok(process.env.DB_USER, 'DB_USER is required for Feature 9 DB gate');
  const database = process.env.TENANT_ENFORCEMENT_TEST_DB_NAME ||
    `setly_f9_rc_enforcement_${process.pid}_${Date.now()}`;
  const previous = Object.fromEntries([
    ...CAPABILITY_ENV,
    'DB_NAME',
    'NODE_ENV',
    'TENANT_ENFORCEMENT_MIGRATION_FAIL_AFTER',
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
    assert.ok(
      migrations.includes('20260720100000-add-final-tenant-enforcement.js'),
      'Feature 9 final enforcement migration must be applied',
    );
    const finalMigration = require('../../migrations/20260720100000-add-final-tenant-enforcement');
    const queryInterface = schema.getQueryInterface();
    const {
      createArtifact,
      runUp,
    } = finalMigration.__testing;
    const {
      runTenantIntegrityDetector,
    } = require('../../src/tenant-enforcement/integrity-detector');

    assert.equal(
      (await classifyFinalEnforcementDefinition(schema)).state,
      'ready',
    );

    await finalMigration.down(queryInterface, SequelizePackage);
    const legacyFingerprint = await enforcementFingerprint(schema);
    assert.equal(
      (await classifyFinalEnforcementDefinition(schema)).state,
      'legacy',
    );
    for (const stage of ['indexes', 'foreignKeys', 'triggers']) {
      process.env.TENANT_ENFORCEMENT_MIGRATION_FAIL_AFTER = stage;
      await assert.rejects(
        finalMigration.up(queryInterface, SequelizePackage),
        new RegExp(`forced failure after ${stage}`),
      );
      delete process.env.TENANT_ENFORCEMENT_MIGRATION_FAIL_AFTER;
      assert.equal(await enforcementFingerprint(schema), legacyFingerprint);
      assert.equal(
        (await classifyFinalEnforcementDefinition(schema)).state,
        'legacy',
      );
    }

    await finalMigration.up(queryInterface, SequelizePackage);
    await finalMigration.up(queryInterface, SequelizePackage);
    assert.equal(
      (await classifyFinalEnforcementDefinition(schema)).state,
      'ready',
    );
    await finalMigration.down(queryInterface, SequelizePackage);
    assert.equal(await enforcementFingerprint(schema), legacyFingerprint);
    await finalMigration.up(queryInterface, SequelizePackage);

    const trigger = TRIGGER_DEFINITIONS[0];
    const assertDefinitionDrift = async (key, state = 'drift') => {
      const classification = await classifyFinalEnforcementDefinition(schema);
      const artifact = classification.artifacts.find((item) => item.key === key);
      assert.equal(artifact.state, state);
      const report = await runTenantIntegrityDetector({ sequelize: schema, strict: true });
      assert.equal(report.ok, false);
      assert.ok(report.findings.some((finding) =>
        finding.code === (state === 'absent'
          ? 'FINAL_ENFORCEMENT_DEFINITION_MISSING'
          : 'FINAL_ENFORCEMENT_DEFINITION_DRIFT') &&
        finding.details.key === key));
    };
    const restoreTrigger = async () => {
      await schema.query(`DROP TRIGGER IF EXISTS ${trigger.name}`);
      await createArtifact(queryInterface, trigger);
    };

    const [ownedStaffInsert] = await schema.query(
      `INSERT INTO Staffs (organizationId,name,role,status,createdAt,updatedAt)
       SELECT organizationId,'Feature 9 rollback guard','Test','active',NOW(),NOW()
         FROM Clubs WHERE id=(SELECT MIN(id) FROM Clubs)`,
    );
    await expectBlockedWithoutMutation(
      schema,
      () => finalMigration.down(queryInterface, SequelizePackage),
      'TENANT_ENFORCEMENT_ROLLBACK_REFUSED',
    );
    await schema.query('DELETE FROM Staffs WHERE id=:id', {
      replacements: { id: Number(ownedStaffInsert) },
    });

    await schema.query(`DROP TRIGGER ${trigger.name}`);
    await expectBlockedWithoutMutation(
      schema,
      () => finalMigration.up(queryInterface, SequelizePackage),
    );
    await assertDefinitionDrift(`trigger:${trigger.name}`, 'absent');
    await createArtifact(queryInterface, trigger);

    for (const lookalike of [
      `CREATE TRIGGER ${trigger.name} BEFORE UPDATE ON ${trigger.table}
       FOR EACH ROW BEGIN SET @tenant_lookalike = OLD.organizationId; END`,
      `CREATE TRIGGER ${trigger.name} AFTER UPDATE ON ${trigger.table}
       FOR EACH ROW ${trigger.body}`,
      `CREATE TRIGGER ${trigger.name} BEFORE UPDATE ON Organizations
       FOR EACH ROW BEGIN SET @tenant_wrong_table = OLD.id; END`,
    ]) {
      await schema.query(`DROP TRIGGER ${trigger.name}`);
      await schema.query(lookalike);
      await expectBlockedWithoutMutation(
        schema,
        () => finalMigration.up(queryInterface, SequelizePackage),
      );
      await expectBlockedWithoutMutation(
        schema,
        () => finalMigration.down(queryInterface, SequelizePackage),
      );
      await assertDefinitionDrift(`trigger:${trigger.name}`);
      await restoreTrigger();
    }

    const ruleForeignKey = FOREIGN_KEY_DEFINITIONS.find(
      (definition) => definition.name === 'fk_final_telephony_calls_client_tenant',
    );
    await queryInterface.removeConstraint(ruleForeignKey.table, ruleForeignKey.name);
    await queryInterface.addConstraint(ruleForeignKey.table, {
      fields: [...ruleForeignKey.columns],
      name: ruleForeignKey.name,
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE',
      references: {
        fields: [...ruleForeignKey.referencedColumns],
        table: ruleForeignKey.referencedTable,
      },
      type: 'foreign key',
    });
    await expectBlockedWithoutMutation(
      schema,
      () => finalMigration.up(queryInterface, SequelizePackage),
    );
    await assertDefinitionDrift(`foreignKey:${ruleForeignKey.name}`);
    await queryInterface.removeConstraint(ruleForeignKey.table, ruleForeignKey.name);
    await createArtifact(queryInterface, ruleForeignKey);

    const referenceForeignKey = FOREIGN_KEY_DEFINITIONS.find(
      (definition) => definition.name === 'fk_final_telephony_calls_staff_tenant',
    );
    await queryInterface.removeConstraint(referenceForeignKey.table, referenceForeignKey.name);
    await queryInterface.addConstraint(referenceForeignKey.table, {
      fields: [...referenceForeignKey.columns],
      name: referenceForeignKey.name,
      onDelete: 'RESTRICT',
      onUpdate: 'RESTRICT',
      references: { fields: ['organizationId', 'id'], table: 'Users' },
      type: 'foreign key',
    });
    await expectBlockedWithoutMutation(
      schema,
      () => finalMigration.up(queryInterface, SequelizePackage),
    );
    await assertDefinitionDrift(`foreignKey:${referenceForeignKey.name}`);
    await queryInterface.removeConstraint(referenceForeignKey.table, referenceForeignKey.name);
    await createArtifact(queryInterface, referenceForeignKey);

    const orderedChildForeignKey = FOREIGN_KEY_DEFINITIONS.find(
      (definition) => definition.name === 'fk_final_telephony_raw_events_call_tenant',
    );
    await queryInterface.removeConstraint(
      orderedChildForeignKey.table,
      orderedChildForeignKey.name,
    );
    await queryInterface.addIndex(
      orderedChildForeignKey.referencedTable,
      ['organizationId', 'id', 'clubId'],
      { name: 'uq_f9_test_call_org_id_club', unique: true },
    );
    await queryInterface.addIndex(
      orderedChildForeignKey.table,
      ['organizationId', 'telephonyCallId', 'clubId'],
      { name: 'idx_f9_test_raw_event_call_wrong_order' },
    );
    await queryInterface.addConstraint(orderedChildForeignKey.table, {
      fields: ['organizationId', 'telephonyCallId', 'clubId'],
      name: orderedChildForeignKey.name,
      onDelete: 'RESTRICT',
      onUpdate: 'RESTRICT',
      references: {
        fields: ['organizationId', 'id', 'clubId'],
        table: orderedChildForeignKey.referencedTable,
      },
      type: 'foreign key',
    });
    await expectBlockedWithoutMutation(
      schema,
      () => finalMigration.up(queryInterface, SequelizePackage),
    );
    await assertDefinitionDrift(`foreignKey:${orderedChildForeignKey.name}`);
    await queryInterface.removeConstraint(
      orderedChildForeignKey.table,
      orderedChildForeignKey.name,
    );
    await queryInterface.removeIndex(
      orderedChildForeignKey.table,
      'idx_f9_test_raw_event_call_wrong_order',
    );
    await queryInterface.removeIndex(
      orderedChildForeignKey.referencedTable,
      'uq_f9_test_call_org_id_club',
    );
    await createArtifact(queryInterface, orderedChildForeignKey);

    const tenantIndex = INDEX_DEFINITIONS.find(
      (definition) => definition.name === 'uq_final_telephony_calls_tenant_identity',
    );
    const indexDependents = FOREIGN_KEY_DEFINITIONS.filter((definition) =>
      definition.referencedTable === tenantIndex.table &&
      JSON.stringify(definition.referencedColumns) === JSON.stringify(tenantIndex.columns));
    for (const dependent of indexDependents) {
      await queryInterface.removeConstraint(dependent.table, dependent.name);
    }
    await queryInterface.removeIndex(tenantIndex.table, tenantIndex.name);
    await queryInterface.addIndex(
      tenantIndex.table,
      ['organizationId', 'id', 'clubId'],
      { name: tenantIndex.name, unique: false, using: 'HASH' },
    );
    await expectBlockedWithoutMutation(
      schema,
      () => finalMigration.up(queryInterface, SequelizePackage),
    );
    await assertDefinitionDrift(`index:${tenantIndex.name}`);
    await queryInterface.removeIndex(tenantIndex.table, tenantIndex.name);
    await createArtifact(queryInterface, tenantIndex);
    for (const dependent of indexDependents) await createArtifact(queryInterface, dependent);

    await finalMigration.down(queryInterface, SequelizePackage);
    await assert.rejects(
      runUp(queryInterface, {
        beforeCleanup: async () => {
          await schema.query(`DROP TRIGGER ${trigger.name}`);
          await schema.query(
            `CREATE TRIGGER ${trigger.name} BEFORE UPDATE ON ${trigger.table}
             FOR EACH ROW BEGIN SET @tenant_cleanup_ownership_lost = OLD.organizationId; END`,
          );
        },
        failAfter: 'triggers',
      }),
      (error) => error.code === 'TENANT_ENFORCEMENT_OPERATOR_REPAIR_REQUIRED',
    );
    const ownershipLost = await classifyFinalEnforcementDefinition(schema);
    assert.equal(ownershipLost.state, 'partial');
    assert.equal(
      ownershipLost.artifacts.filter((artifact) => artifact.state === 'exact').length,
      ownershipLost.artifacts.length - 1,
    );
    for (const definition of TRIGGER_DEFINITIONS) {
      await schema.query(`DROP TRIGGER IF EXISTS ${definition.name}`);
    }
    for (const definition of [...FOREIGN_KEY_DEFINITIONS].reverse()) {
      await queryInterface.removeConstraint(definition.table, definition.name);
    }
    for (const definition of [...INDEX_DEFINITIONS].reverse()) {
      await queryInterface.removeIndex(definition.table, definition.name);
    }
    assert.equal(
      (await classifyFinalEnforcementDefinition(schema)).state,
      'legacy',
    );
    await finalMigration.up(queryInterface, SequelizePackage);

    const fixture = await seedTwoTenantFixture(schema);
    for (const name of CAPABILITY_ENV) process.env[name] = 'true';
    await assertFeature10_4IntegrationConnectionSchema(queryInterface);
    rootDb = require('../../models');
    const {
      classifyTenantFoundation,
    } = require('../../src/services/tenant-foundation.service');
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
