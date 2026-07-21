'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
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
  ACCEPTED_TENANT_CAPABILITY_ENV,
} = require('../helpers/accepted-tenant-schema');
const {
  assertFeature10_4InstallationOperatorSchema,
  assertFeature10_4IntegrationConnectionSchema,
} = require('../helpers/feature-10-4-schema');

const migration = require('../../migrations/20260720220000-add-installation-operator-management');

async function targetSchemaFingerprint(schema) {
  const [rows] = await schema.query(`
    SELECT 'column' AS kind, TABLE_NAME AS ownerName, COLUMN_NAME AS artifactName,
           CONCAT(ORDINAL_POSITION, ':', COLUMN_TYPE, ':', IS_NULLABLE, ':',
                  COALESCE(COLUMN_DEFAULT, '<null>'), ':', EXTRA) AS definition
      FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA=DATABASE()
       AND (TABLE_NAME IN ('InstallationOperatorSessions', 'InstallationMutationOperations')
         OR (TABLE_NAME='IntegrationConnections' AND COLUMN_NAME IN
           ('credentialFingerprint','providerIdentityFingerprint','fingerprintKeyVersion')))
    UNION ALL
    SELECT 'index', TABLE_NAME, INDEX_NAME,
           CONCAT(NON_UNIQUE, ':', SEQ_IN_INDEX, ':', COLUMN_NAME)
      FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA=DATABASE()
       AND (TABLE_NAME IN ('InstallationOperatorSessions', 'InstallationMutationOperations')
         OR INDEX_NAME LIKE '%installation_operator%'
         OR INDEX_NAME LIKE '%installation_mutation%'
         OR INDEX_NAME LIKE '%integration_provider_%_fingerprint%')
    UNION ALL
    SELECT 'constraint', TABLE_NAME, CONSTRAINT_NAME,
           CONCAT(COLUMN_NAME, ':', COALESCE(REFERENCED_TABLE_NAME, ''), ':',
                  COALESCE(REFERENCED_COLUMN_NAME, ''))
      FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
     WHERE CONSTRAINT_SCHEMA=DATABASE()
       AND (TABLE_NAME IN ('InstallationOperatorSessions', 'InstallationMutationOperations')
         OR CONSTRAINT_NAME LIKE 'fk_installation_mutation%')
    UNION ALL
    SELECT 'trigger', EVENT_OBJECT_TABLE, TRIGGER_NAME,
           CONCAT(ACTION_TIMING, ':', EVENT_MANIPULATION, ':', ACTION_STATEMENT)
      FROM INFORMATION_SCHEMA.TRIGGERS
     WHERE TRIGGER_SCHEMA=DATABASE()
       AND (EVENT_OBJECT_TABLE IN ('InstallationOperatorSessions', 'InstallationMutationOperations')
         OR TRIGGER_NAME LIKE 'trg_installation_operator%'
         OR TRIGGER_NAME LIKE 'trg_installation_mutation%')
    ORDER BY kind, ownerName, artifactName, definition
  `);
  return JSON.stringify(rows);
}

async function connectionSnapshot(schema) {
  const [rows] = await schema.query(`
    SELECT publicId, organizationId, clubId, provider, purpose, connectionKey,
           status, config, metadata, secretCiphertext, secretKeyVersion,
           secretUpdatedAt, createdAt, updatedAt
      FROM IntegrationConnections
     ORDER BY id
  `);
  return JSON.stringify(rows);
}

function provisioningPayload(suffix) {
  return {
    clubs: [{ name: `Клуб ${suffix}`, timezone: 'Europe/Moscow' }],
    idempotencyKey: crypto.randomUUID(),
    organization: { name: `Организация ${suffix}` },
    owner: {
      email: `owner-${suffix}@operator-security.test`,
      name: `Владелец ${suffix}`,
      phone: '+79991112233',
    },
  };
}

test('Feature 10.4 operator authority, history triggers and migration safety', async (t) => {
  assert.ok(process.env.DB_USER, 'DB_USER is required for operator security DB tests');
  const database = `setly_f9_rc_operator_security_${process.pid}_${Date.now()}`;
  const envKeys = [
    ...ACCEPTED_TENANT_CAPABILITY_ENV,
    'DB_NAME',
    'INSTALLATION_MANAGEMENT_ENABLED',
    'INSTALLATION_MANAGEMENT_MIGRATION_FAIL_STEP',
    'INSTALLATION_OPERATOR_PASSWORD',
    'INSTALLATION_OPERATOR_SECRET',
    'INSTALLATION_OPERATOR_USERNAME',
    'INSTALLATION_PROVISIONING_ENABLED',
    'NODE_ENV',
    'TENANT_ENFORCEMENT_ENABLED',
  ];
  const previous = Object.fromEntries(envKeys.map((name) => [name, process.env[name]]));
  let schema;
  let db;
  await createDisposableDatabase(database);
  process.env.DB_NAME = database;
  process.env.NODE_ENV = 'test';
  process.env.INSTALLATION_MANAGEMENT_ENABLED = 'true';
  process.env.INSTALLATION_PROVISIONING_ENABLED = 'true';
  process.env.INSTALLATION_OPERATOR_PASSWORD = 'operator-security-password';
  process.env.INSTALLATION_OPERATOR_SECRET = 'operator-security-secret-that-is-long-enough';
  process.env.INSTALLATION_OPERATOR_USERNAME = 'operator-security-test';
  for (const name of ACCEPTED_TENANT_CAPABILITY_ENV) process.env[name] = 'false';
  process.env.TENANT_ENFORCEMENT_ENABLED = 'false';

  try {
    schema = connect(database);
    await migrateAll(schema);
    const queryInterface = schema.getQueryInterface();
    const fixture = await seedTwoTenantFixture(schema);
    const legacyConnections = await connectionSnapshot(schema);

    await t.test('clean down preserves legacy provider rows and absent accepts every forced stage', async () => {
      await migration.down(queryInterface);
      assert.equal((await migration.__testing.classifyState(queryInterface)).state, 'absent');
      assert.equal(await connectionSnapshot(schema), legacyConnections);
      for (const step of migration.__testing.DDL_STEPS) {
        process.env.INSTALLATION_MANAGEMENT_MIGRATION_FAIL_STEP = step;
        const before = await targetSchemaFingerprint(schema);
        await assert.rejects(
          migration.up(queryInterface, SequelizePackage),
          (error) => error.code === 'INSTALLATION_MANAGEMENT_MIGRATION_FORCED_FAILURE',
        );
        assert.equal(await targetSchemaFingerprint(schema), before, step);
        assert.equal((await migration.__testing.classifyState(queryInterface)).state, 'absent', step);
        assert.equal(await connectionSnapshot(schema), legacyConnections, step);
      }
      delete process.env.INSTALLATION_MANAGEMENT_MIGRATION_FAIL_STEP;
    });

    await t.test('same-named index on an unrelated table is ignored and preserved', async () => {
      await schema.query(`
        CREATE TABLE OperatorOwnedBackup (
          id INT NOT NULL AUTO_INCREMENT,
          sessionId VARCHAR(32) NOT NULL,
          note VARCHAR(64) NOT NULL,
          PRIMARY KEY (id),
          UNIQUE KEY uq_installation_operator_session_id (sessionId)
        ) ENGINE=InnoDB
      `);
      await schema.query(`
        INSERT INTO OperatorOwnedBackup (sessionId,note)
        VALUES ('backup-session','must remain byte stable')
      `);
      const [createBeforeRows] = await schema.query('SHOW CREATE TABLE OperatorOwnedBackup');
      const createBefore = createBeforeRows[0]['Create Table'];
      const [dataBefore] = await schema.query('SELECT * FROM OperatorOwnedBackup ORDER BY id');
      assert.equal((await migration.__testing.classifyState(queryInterface)).state, 'absent');
      await migration.up(queryInterface, SequelizePackage);
      assert.equal((await migration.__testing.classifyState(queryInterface)).state, 'ready');
      await migration.down(queryInterface);
      assert.equal((await migration.__testing.classifyState(queryInterface)).state, 'absent');
      const [createAfterRows] = await schema.query('SHOW CREATE TABLE OperatorOwnedBackup');
      const [dataAfter] = await schema.query('SELECT * FROM OperatorOwnedBackup ORDER BY id');
      assert.equal(createAfterRows[0]['Create Table'], createBefore);
      assert.deepEqual(dataAfter, dataBefore);
      await queryInterface.dropTable('OperatorOwnedBackup');
    });

    await t.test('partial and lookalike states refuse before mutation', async () => {
      await queryInterface.addColumn('IntegrationConnections', 'credentialFingerprint', {
        allowNull: true,
        type: SequelizePackage.STRING(63),
      });
      const partial = await targetSchemaFingerprint(schema);
      await assert.rejects(
        migration.up(queryInterface, SequelizePackage),
        (error) => error.code === 'INSTALLATION_MANAGEMENT_REPAIR_REQUIRED',
      );
      assert.equal(await targetSchemaFingerprint(schema), partial);
      await queryInterface.removeColumn('IntegrationConnections', 'credentialFingerprint');

      await schema.query(`
        CREATE TRIGGER trg_installation_operator_sessions_bi
        BEFORE UPDATE ON Organizations FOR EACH ROW SET @operator_lookalike=OLD.id
      `);
      const lookalike = await targetSchemaFingerprint(schema);
      await assert.rejects(
        migration.up(queryInterface, SequelizePackage),
        (error) => error.code === 'INSTALLATION_MANAGEMENT_REPAIR_REQUIRED',
      );
      assert.equal(await targetSchemaFingerprint(schema), lookalike);
      await schema.query('DROP TRIGGER trg_installation_operator_sessions_bi');
    });

    await t.test('cleanup ownership loss is detected before cleanup mutation', async () => {
      await queryInterface.addColumn('IntegrationConnections', 'credentialFingerprint', {
        allowNull: true,
        type: SequelizePackage.STRING(64),
      });
      const artifact = {
        name: 'credentialFingerprint',
        table: 'IntegrationConnections',
      };
      const definition = await migration.__testing.readArtifact(queryInterface, 'column', artifact);
      const plan = {
        column: [{
          ...artifact,
          signature: migration.__testing.artifactSignature('column', definition),
        }],
        foreignKey: [],
        index: [],
        table: [],
        trigger: [],
      };
      await queryInterface.changeColumn('IntegrationConnections', 'credentialFingerprint', {
        allowNull: true,
        type: SequelizePackage.STRING(63),
      });
      const before = await targetSchemaFingerprint(schema);
      await assert.rejects(
        migration.__testing.cleanupInvocation(queryInterface, plan),
        (error) => error.code === 'INSTALLATION_MANAGEMENT_CLEANUP_OWNERSHIP_LOST',
      );
      assert.equal(await targetSchemaFingerprint(schema), before);
      await queryInterface.removeColumn('IntegrationConnections', 'credentialFingerprint');
    });

    await t.test('up is exact, preserves legacy rows and exact-ready reapply is mutation-free', async () => {
      await migration.up(queryInterface, SequelizePackage);
      assert.equal((await migration.__testing.classifyState(queryInterface)).state, 'ready');
      const ready = await targetSchemaFingerprint(schema);
      await migration.up(queryInterface, SequelizePackage);
      assert.equal(await targetSchemaFingerprint(schema), ready);
      assert.equal(await connectionSnapshot(schema), legacyConnections);
    });

    await t.test('wrong authoritative index signatures refuse without mutation', async () => {
      const indexName = 'uq_integration_provider_credential_fingerprint';
      const restore = async () => {
        await queryInterface.addIndex(
          'IntegrationConnections',
          ['provider', 'credentialFingerprint'],
          { name: indexName, unique: true },
        );
      };
      const variants = [
        {
          create: () => queryInterface.addIndex(
            'IntegrationConnections',
            ['provider', 'credentialFingerprint'],
            { name: indexName, unique: false },
          ),
          name: 'non-unique',
        },
        {
          create: () => queryInterface.addIndex(
            'IntegrationConnections',
            ['credentialFingerprint', 'provider'],
            { name: indexName, unique: true },
          ),
          name: 'wrong column order',
        },
        {
          create: () => schema.query(`
            CREATE UNIQUE INDEX uq_integration_provider_credential_fingerprint
              ON IntegrationConnections (provider,credentialFingerprint(16))
          `),
          name: 'prefix',
        },
      ];
      if (await migration.__testing.supportsIndexVisibility(queryInterface)) {
        variants.push({
          create: async () => {
            await restore();
            await schema.query(`
              ALTER TABLE IntegrationConnections
              ALTER INDEX uq_integration_provider_credential_fingerprint INVISIBLE
            `);
          },
          name: 'invisible',
          precreated: true,
        });
      }
      for (const variant of variants) {
        await queryInterface.removeIndex('IntegrationConnections', indexName);
        try {
          await variant.create();
          const before = await targetSchemaFingerprint(schema);
          await assert.rejects(
            migration.up(queryInterface, SequelizePackage),
            (error) => error.code === 'INSTALLATION_MANAGEMENT_REPAIR_REQUIRED',
            variant.name,
          );
          assert.equal(await targetSchemaFingerprint(schema), before, variant.name);
        } finally {
          const current = await migration.__testing.readArtifact(queryInterface, 'index', {
            name: indexName,
            table: 'IntegrationConnections',
          });
          if (current.length > 0) {
            await queryInterface.removeIndex('IntegrationConnections', indexName);
          }
          await restore();
        }
      }
      assert.equal((await migration.__testing.classifyState(queryInterface)).state, 'ready');
    });

    await t.test('non-null fingerprint state makes down mutation-free', async () => {
      await schema.query(`
        UPDATE IntegrationConnections
           SET credentialFingerprint=:fingerprint,
               fingerprintKeyVersion='test-v1'
         ORDER BY id LIMIT 1
      `, { replacements: { fingerprint: 'a'.repeat(64) } });
      const before = await targetSchemaFingerprint(schema);
      await assert.rejects(
        migration.down(queryInterface),
        (error) => error.code === 'INSTALLATION_MANAGEMENT_ROLLBACK_FINGERPRINTS_PRESENT',
      );
      assert.equal(await targetSchemaFingerprint(schema), before);
      await schema.query(`
        UPDATE IntegrationConnections
           SET credentialFingerprint=NULL,
               fingerprintKeyVersion=NULL
         WHERE credentialFingerprint=:fingerprint
      `, { replacements: { fingerprint: 'a'.repeat(64) } });
    });

    for (const name of ACCEPTED_TENANT_CAPABILITY_ENV) process.env[name] = 'true';
    process.env.TENANT_ENFORCEMENT_ENABLED = 'true';
    await assertFeature10_4IntegrationConnectionSchema(queryInterface);
    await assertFeature10_4InstallationOperatorSchema(queryInterface);
    db = require('../../models');
    const auth = require('../../src/services/installation-operator-auth.service');
    const auditService = require('../../src/services/audit.service');
    const management = require('../../src/services/installation-management.service');
    const provisioning = require('../../src/services/installation-provisioning.service');
    const createAuthority = async () => {
      const session = await auth.createSession({
        password: process.env.INSTALLATION_OPERATOR_PASSWORD,
        username: process.env.INSTALLATION_OPERATOR_USERNAME,
      });
      return auth.verifySession(session.token);
    };

    await t.test('forged, cloned and expired authorities fail without business history', async () => {
      const organizationId = fixture.organizations.A;
      const organization = await db.Organization.findByPk(organizationId);
      const input = {
        expectedUpdatedAt: organization.updatedAt.toISOString(),
        idempotencyKey: crypto.randomUUID(),
        name: 'Не должно сохраниться',
      };
      const counts = async () => ({
        audits: await db.AuditLog.count({ where: { action: 'installation.organization.update' } }),
        operations: await db.InstallationMutationOperation.count(),
      });
      const before = await counts();
      for (const actor of [
        { sessionId: 'a'.repeat(32), username: process.env.INSTALLATION_OPERATOR_USERNAME },
        Object.freeze({ sessionId: 'b'.repeat(32), username: process.env.INSTALLATION_OPERATOR_USERNAME }),
      ]) {
        await assert.rejects(
          management.updateOrganization(organizationId, input, actor),
          (error) => error.code === 'INSTALLATION_OPERATOR_SESSION_INVALID',
        );
      }
      const authority = await createAuthority();
      await assert.rejects(
        management.updateOrganization(organizationId, input, { ...authority }),
        (error) => error.code === 'INSTALLATION_OPERATOR_SESSION_INVALID',
      );
      const originalNow = Date.now;
      Date.now = () => new Date(authority.expiresAt).getTime() + 1;
      try {
        await assert.rejects(
          management.getInstallationOrganization(organizationId, authority),
          (error) => error.code === 'INSTALLATION_OPERATOR_SESSION_INVALID',
        );
      } finally {
        Date.now = originalNow;
      }
      assert.deepEqual(await counts(), before);
      assert.equal((await db.Organization.findByPk(organizationId)).name, organization.name);
    });

    await t.test('verify then revoke then management/provisioning calls are mutation-free', async () => {
      const authority = await createAuthority();
      const organizationId = fixture.organizations.A;
      const organization = await db.Organization.findByPk(organizationId);
      const before = {
        audits: await db.AuditLog.count(),
        managementOperations: await db.InstallationMutationOperation.count(),
        organizations: await db.Organization.count(),
        provisioningOperations: await db.InstallationProvisioningOperation.count(),
      };
      await auth.revokeSession(authority);
      await assert.rejects(
        management.updateOrganization(organizationId, {
          expectedUpdatedAt: organization.updatedAt.toISOString(),
          idempotencyKey: crypto.randomUUID(),
          name: 'TOCTOU rename',
        }, authority),
        (error) => error.code === 'INSTALLATION_OPERATOR_SESSION_INVALID',
      );
      await assert.rejects(
        management.getInstallationOrganization(organizationId, authority),
        (error) => error.code === 'INSTALLATION_OPERATOR_SESSION_INVALID',
      );
      await assert.rejects(
        provisioning.provisionOrganization(provisioningPayload('revoked'), authority),
        (error) => error.code === 'INSTALLATION_OPERATOR_SESSION_INVALID',
      );
      await assert.rejects(
        provisioning.getInstallationSnapshot(authority),
        (error) => error.code === 'INSTALLATION_OPERATOR_SESSION_INVALID',
      );
      assert.equal((await db.Organization.findByPk(organizationId)).name, organization.name);
      assert.deepEqual({
        audits: await db.AuditLog.count(),
        managementOperations: await db.InstallationMutationOperation.count(),
        organizations: await db.Organization.count(),
        provisioningOperations: await db.InstallationProvisioningOperation.count(),
      }, before);
    });

    await t.test('raw session and operation history mutations are blocked with exact provenance', async () => {
      const authority = await createAuthority();
      const organizationId = fixture.organizations.A;
      const clubId = fixture.clubs.A[0];
      const club = await db.Club.findByPk(clubId);
      await management.updateClub(organizationId, clubId, {
        expectedUpdatedAt: club.updatedAt.toISOString(),
        idempotencyKey: crypto.randomUUID(),
        name: 'Клуб с защищённой историей',
        timezone: club.timezone,
      }, authority);
      const session = await db.InstallationOperatorSession.findOne({
        where: { sessionId: authority.sessionId },
      });
      await auth.revokeSession(authority);
      await assert.rejects(schema.query(
        'UPDATE InstallationOperatorSessions SET revokedAt=NULL WHERE id=:id',
        { replacements: { id: session.id } },
      ));
      await assert.rejects(schema.query(
        'UPDATE InstallationOperatorSessions SET username=\'forged\' WHERE id=:id',
        { replacements: { id: session.id } },
      ));
      await assert.rejects(schema.query(
        'DELETE FROM InstallationOperatorSessions WHERE id=:id',
        { replacements: { id: session.id } },
      ));

      const operation = await db.InstallationMutationOperation.findOne({
        where: { clubId, organizationId },
      });
      await assert.rejects(schema.query(
        'UPDATE InstallationMutationOperations SET action=\'forged\' WHERE id=:id',
        { replacements: { id: operation.id } },
      ));
      await assert.rejects(schema.query(
        'DELETE FROM InstallationMutationOperations WHERE id=:id',
        { replacements: { id: operation.id } },
      ));
      const audit = await db.AuditLog.findByPk(operation.auditLogId);
      const crossAudit = await db.sequelize.transaction((transaction) =>
        auditService.recordInstallation({
          action: 'installation.test.cross_scope',
          clubId: fixture.clubs.B[0],
          entityId: 'cross-scope',
          entityType: 'installation_test',
          metadata: {},
          method: 'POST',
          organizationId: fixture.organizations.B,
          path: '/api/installation/test',
          statusCode: 200,
          summary: 'Cross-scope test audit',
        }, transaction));
      await assert.rejects(schema.query(`
        INSERT INTO InstallationMutationOperations
          (idempotencyKeyHash,payloadHash,organizationId,clubId,action,response,
           auditLogId,createdAt,updatedAt)
        VALUES (:idempotency,:payload,:organizationId,:clubId,'forged','{}',
          :auditLogId,NOW(),NOW())
      `, {
        replacements: {
          auditLogId: audit.id,
          clubId: fixture.clubs.B[0],
          idempotency: 'c'.repeat(64),
          organizationId,
          payload: 'd'.repeat(64),
        },
      }));
      await assert.rejects(schema.query(`
        INSERT INTO InstallationMutationOperations
          (idempotencyKeyHash,payloadHash,organizationId,clubId,action,response,
           auditLogId,createdAt,updatedAt)
        VALUES (:idempotency,:payload,:organizationId,:clubId,'forged','{}',
          :auditLogId,NOW(),NOW())
      `, {
        replacements: {
          auditLogId: crossAudit.id,
          clubId,
          idempotency: 'e'.repeat(64),
          organizationId,
          payload: 'f'.repeat(64),
        },
      }));
    });

    await t.test('populated history makes down mutation-free', async () => {
      const before = await targetSchemaFingerprint(schema);
      await assert.rejects(
        migration.down(queryInterface),
        (error) => error.code === 'INSTALLATION_MANAGEMENT_ROLLBACK_HISTORY_PRESENT',
      );
      assert.equal(await targetSchemaFingerprint(schema), before);
      assert.equal((await migration.__testing.classifyState(queryInterface)).state, 'ready');
    });
  } finally {
    if (db?.sequelize) await db.sequelize.close();
    if (schema) await schema.close();
    await dropDisposableDatabase(database);
    for (const [name, previousValue] of Object.entries(previous)) {
      if (previousValue === undefined) delete process.env[name];
      else process.env[name] = previousValue;
    }
  }
});
