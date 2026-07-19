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

const CAPABILITY_ENV = [
  ...ACCEPTED_TENANT_CAPABILITY_ENV,
  'TENANT_ENFORCEMENT_ENABLED',
];
const FEATURE_MIGRATION = require('../../migrations/20260720120000-add-installation-provisioning');

function payload(suffix, idempotencyKey = crypto.randomUUID()) {
  return {
    clubs: [
      { name: `Клуб ${suffix} Центр`, timezone: 'Europe/Moscow' },
      { name: `Клуб ${suffix} Север`, timezone: 'Europe/Moscow' },
    ],
    idempotencyKey,
    organization: { name: `Организация ${suffix}` },
    owner: {
      email: `owner-${suffix}@provisioning.test`,
      name: `Владелец ${suffix}`,
      phone: '+79991112233',
    },
  };
}

function tokenFromLink(link) {
  return new URLSearchParams(new URL(link).hash.replace(/^#/u, '')).get('token');
}

async function counts(db, suffix) {
  const [organizations, clubs, accounts, operations, activations] = await Promise.all([
    db.Organization.count({ where: { name: `Организация ${suffix}` } }),
    db.Club.count({
      where: {
        name: {
          [db.Sequelize.Op.in]: [`Клуб ${suffix} Центр`, `Клуб ${suffix} Север`],
        },
      },
    }),
    db.Account.count({ where: { email: `owner-${suffix}@provisioning.test` } }),
    db.InstallationProvisioningOperation.count(),
    db.OwnerActivationToken.count(),
  ]);
  return { accounts, activations, clubs, operations, organizations };
}

async function provisioningSchemaFingerprint(schema) {
  const [rows] = await schema.query(`
    SELECT 'column' AS kind, TABLE_NAME AS ownerName, COLUMN_NAME AS artifactName,
           CONCAT(ORDINAL_POSITION, ':', COLUMN_TYPE, ':', IS_NULLABLE, ':',
                  COALESCE(COLUMN_DEFAULT, '<null>'), ':', EXTRA) AS definition
      FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA=DATABASE()
       AND TABLE_NAME IN ('OwnerActivationTokens', 'InstallationProvisioningOperations')
    UNION ALL
    SELECT 'index', TABLE_NAME, INDEX_NAME,
           CONCAT(NON_UNIQUE, ':', SEQ_IN_INDEX, ':', COLUMN_NAME)
      FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA=DATABASE()
       AND (TABLE_NAME IN ('OwnerActivationTokens', 'InstallationProvisioningOperations')
            OR INDEX_NAME LIKE '%installation_provisioning%'
            OR INDEX_NAME LIKE '%owner_activation%')
    UNION ALL
    SELECT 'constraint', TABLE_NAME, CONSTRAINT_NAME,
           CONCAT(COLUMN_NAME, ':', COALESCE(REFERENCED_TABLE_NAME, ''), ':',
                  COALESCE(REFERENCED_COLUMN_NAME, ''))
      FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
     WHERE CONSTRAINT_SCHEMA=DATABASE()
       AND (TABLE_NAME IN ('OwnerActivationTokens', 'InstallationProvisioningOperations')
            OR CONSTRAINT_NAME LIKE 'fk_installation_provisioning%'
            OR CONSTRAINT_NAME LIKE 'fk_owner_activation%')
    UNION ALL
    SELECT 'trigger', EVENT_OBJECT_TABLE, TRIGGER_NAME,
           CONCAT(ACTION_TIMING, ':', EVENT_MANIPULATION, ':', ACTION_STATEMENT)
      FROM INFORMATION_SCHEMA.TRIGGERS
     WHERE TRIGGER_SCHEMA=DATABASE()
       AND (EVENT_OBJECT_TABLE IN ('OwnerActivationTokens', 'InstallationProvisioningOperations')
            OR TRIGGER_NAME LIKE 'trg_installation_provisioning%'
            OR TRIGGER_NAME LIKE 'trg_owner_activation%')
    ORDER BY kind, ownerName, artifactName, definition
  `);
  return JSON.stringify(rows);
}

test('Feature 10.2 atomic provisioning and secure owner activation', async (t) => {
  assert.ok(process.env.DB_USER, 'DB_USER is required for provisioning DB tests');
  const database = process.env.INSTALLATION_PROVISIONING_TEST_DB_NAME ||
    `setly_f9_rc_provisioning_${process.pid}_${Date.now()}`;
  const previous = Object.fromEntries([
    ...CAPABILITY_ENV,
    'DB_NAME',
    'INSTALLATION_PROVISIONING_MIGRATION_FAIL_STEP',
    'NODE_ENV',
    'INSTALLATION_ACTIVATION_BASE_URL',
  ].map((name) => [name, process.env[name]]));
  let schema;
  let db;

  await createDisposableDatabase(database);
  process.env.DB_NAME = database;
  process.env.NODE_ENV = 'test';
  process.env.INSTALLATION_ACTIVATION_BASE_URL = 'http://127.0.0.1:5182';
  for (const name of CAPABILITY_ENV) process.env[name] = 'false';

  try {
    schema = connect(database);
    await migrateAll(schema);
    const queryInterface = schema.getQueryInterface();
    await FEATURE_MIGRATION.down(queryInterface);
    await t.test('migration failure/ownership/lookalike matrix is restart-safe', async () => {
      const { normalizeSql } = FEATURE_MIGRATION.__testing;
      assert.equal(
        normalizeSql("BEGIN IF `M`.`role` = 'owner' THEN SET @X = 1; END IF; END"),
        normalizeSql(" begin  if m.role='owner' then set @x=1 ; end if ; end "),
      );
      assert.notEqual(
        normalizeSql("m.role = 'owner'"),
        normalizeSql("M.ROLE='OWNER'"),
      );
      assert.notEqual(
        normalizeSql("SET MESSAGE_TEXT = 'Owner activation history is immutable'"),
        normalizeSql("set message_text='Owner  Activation History is immutable'"),
      );
      assert.notEqual(
        normalizeSql('SET @role = "owner"'),
        normalizeSql('set @ROLE="OWNER"'),
      );
      assert.equal(
        normalizeSql("SET @message = 'Owner''s link'"),
        normalizeSql(" set @MESSAGE='Owner''s link' "),
      );
      assert.notEqual(
        normalizeSql("SET @message = 'Owner''s link'"),
        normalizeSql("SET @message = 'OWNER''s link'"),
      );

      const tablesAfterDown = new Set(
        (await queryInterface.showAllTables()).map((table) =>
          typeof table === 'string' ? table : table.tableName,
        ),
      );
      assert.equal(tablesAfterDown.has('OwnerActivationTokens'), false);
      assert.equal(tablesAfterDown.has('InstallationProvisioningOperations'), false);

      for (const step of FEATURE_MIGRATION.__testing.DDL_STEPS) {
        process.env.INSTALLATION_PROVISIONING_MIGRATION_FAIL_STEP = step;
        await assert.rejects(
          FEATURE_MIGRATION.up(queryInterface, SequelizePackage),
          (error) => error.code === 'INSTALLATION_PROVISIONING_MIGRATION_FORCED_FAILURE',
          step,
        );
        delete process.env.INSTALLATION_PROVISIONING_MIGRATION_FAIL_STEP;
        assert.equal(
          (await FEATURE_MIGRATION.__testing.classifyState(queryInterface)).state,
          'absent',
          step,
        );
        assert.equal(await provisioningSchemaFingerprint(schema), '[]', step);
      }

      await queryInterface.createTable('OwnerActivationTokens', {
        id: { allowNull: false, primaryKey: true, type: SequelizePackage.INTEGER },
      });
      const partialBefore = await provisioningSchemaFingerprint(schema);
      await assert.rejects(
        FEATURE_MIGRATION.up(queryInterface, SequelizePackage),
        (error) => error.code === 'INSTALLATION_PROVISIONING_REPAIR_REQUIRED',
      );
      assert.equal(await provisioningSchemaFingerprint(schema), partialBefore);
      await queryInterface.dropTable('OwnerActivationTokens');

      await schema.query(`
        CREATE TRIGGER trg_owner_activation_tokens_bi
        BEFORE UPDATE ON Organizations FOR EACH ROW SET @provisioning_lookalike=OLD.id
      `);
      const triggerLookalikeBefore = await provisioningSchemaFingerprint(schema);
      await assert.rejects(
        FEATURE_MIGRATION.up(queryInterface, SequelizePackage),
        (error) => error.code === 'INSTALLATION_PROVISIONING_REPAIR_REQUIRED',
      );
      assert.equal(await provisioningSchemaFingerprint(schema), triggerLookalikeBefore);
      await schema.query('DROP TRIGGER trg_owner_activation_tokens_bi');

      await queryInterface.addIndex('Organizations', ['status'], {
        name: 'idx_installation_provisioning_org_created',
      });
      const operatorIndexBefore = await provisioningSchemaFingerprint(schema);
      await FEATURE_MIGRATION.up(queryInterface, SequelizePackage);
      assert.equal((await FEATURE_MIGRATION.__testing.classifyState(queryInterface)).state, 'ready');
      const readyWithOperatorIndex = await provisioningSchemaFingerprint(schema);
      assert.notEqual(readyWithOperatorIndex, operatorIndexBefore);
      await FEATURE_MIGRATION.up(queryInterface, SequelizePackage);
      assert.equal(await provisioningSchemaFingerprint(schema), readyWithOperatorIndex);
      const [operatorIndexRows] = await schema.query(`
        SELECT TABLE_NAME, INDEX_NAME, COLUMN_NAME
          FROM INFORMATION_SCHEMA.STATISTICS
         WHERE TABLE_SCHEMA=DATABASE()
           AND TABLE_NAME='Organizations'
           AND INDEX_NAME='idx_installation_provisioning_org_created'
      `);
      assert.deepEqual(operatorIndexRows.map((row) => ({
        column: row.COLUMN_NAME,
        name: row.INDEX_NAME,
        table: String(row.TABLE_NAME).toLowerCase(),
      })), [{
        column: 'status',
        name: 'idx_installation_provisioning_org_created',
        table: 'organizations',
      }]);
      await queryInterface.removeIndex('Organizations', 'idx_installation_provisioning_org_created');
      const readyFingerprint = await provisioningSchemaFingerprint(schema);

      const roleLiteralTrigger = FEATURE_MIGRATION.__testing.TRIGGERS.find(
        (item) => item.name === 'trg_owner_activation_tokens_bi',
      );
      const trackedRoleTriggerRows = await FEATURE_MIGRATION.__testing.readArtifact(
        queryInterface,
        'trigger',
        roleLiteralTrigger,
      );
      const triggerOwnershipPlan = {
        foreignKey: [],
        index: [],
        table: [],
        trigger: [{
          ...roleLiteralTrigger,
          signature: FEATURE_MIGRATION.__testing.artifactSignature(
            'trigger',
            trackedRoleTriggerRows,
          ),
        }],
      };
      const changedRoleBody = roleLiteralTrigger.body.replace(
        "m.role = 'owner'",
        "m.role = 'OWNER'",
      );
      assert.notEqual(changedRoleBody, roleLiteralTrigger.body);
      await schema.query(`DROP TRIGGER \`${roleLiteralTrigger.name}\``);
      await schema.query(
        `CREATE TRIGGER \`${roleLiteralTrigger.name}\` BEFORE ${roleLiteralTrigger.event} ` +
        `ON \`${roleLiteralTrigger.table}\` FOR EACH ROW ${changedRoleBody}`,
      );
      assert.equal((await FEATURE_MIGRATION.__testing.classifyState(queryInterface)).state, 'partial');
      const changedRoleBefore = await provisioningSchemaFingerprint(schema);
      await assert.rejects(
        FEATURE_MIGRATION.up(queryInterface, SequelizePackage),
        (error) => error.code === 'INSTALLATION_PROVISIONING_REPAIR_REQUIRED',
      );
      assert.equal(await provisioningSchemaFingerprint(schema), changedRoleBefore);
      await assert.rejects(
        FEATURE_MIGRATION.__testing.preflightCleanupInvocation(
          queryInterface,
          triggerOwnershipPlan,
        ),
        (error) => error.code === 'INSTALLATION_PROVISIONING_CLEANUP_OWNERSHIP_LOST',
      );
      assert.equal(await provisioningSchemaFingerprint(schema), changedRoleBefore);
      await schema.query(`DROP TRIGGER \`${roleLiteralTrigger.name}\``);
      await schema.query(
        `CREATE TRIGGER \`${roleLiteralTrigger.name}\` BEFORE ${roleLiteralTrigger.event} ` +
        `ON \`${roleLiteralTrigger.table}\` FOR EACH ROW ${roleLiteralTrigger.body}`,
      );
      assert.equal((await FEATURE_MIGRATION.__testing.classifyState(queryInterface)).state, 'ready');

      const messageLiteralTrigger = FEATURE_MIGRATION.__testing.TRIGGERS.find(
        (item) => item.name === 'trg_owner_activation_tokens_bd',
      );
      const changedMessageBody = messageLiteralTrigger.body.replace(
        'Owner activation history is immutable',
        'Owner  Activation History is immutable',
      );
      assert.notEqual(changedMessageBody, messageLiteralTrigger.body);
      await schema.query(`DROP TRIGGER \`${messageLiteralTrigger.name}\``);
      await schema.query(
        `CREATE TRIGGER \`${messageLiteralTrigger.name}\` BEFORE ${messageLiteralTrigger.event} ` +
        `ON \`${messageLiteralTrigger.table}\` FOR EACH ROW ${changedMessageBody}`,
      );
      assert.equal((await FEATURE_MIGRATION.__testing.classifyState(queryInterface)).state, 'partial');
      const changedMessageBefore = await provisioningSchemaFingerprint(schema);
      await assert.rejects(
        FEATURE_MIGRATION.up(queryInterface, SequelizePackage),
        (error) => error.code === 'INSTALLATION_PROVISIONING_REPAIR_REQUIRED',
      );
      assert.equal(await provisioningSchemaFingerprint(schema), changedMessageBefore);
      await schema.query(`DROP TRIGGER \`${messageLiteralTrigger.name}\``);
      await schema.query(
        `CREATE TRIGGER \`${messageLiteralTrigger.name}\` BEFORE ${messageLiteralTrigger.event} ` +
        `ON \`${messageLiteralTrigger.table}\` FOR EACH ROW ${messageLiteralTrigger.body}`,
      );
      assert.equal((await FEATURE_MIGRATION.__testing.classifyState(queryInterface)).state, 'ready');

      await queryInterface.removeIndex(
        'InstallationProvisioningOperations',
        'idx_installation_provisioning_org_created',
      );
      const missingIndexBefore = await provisioningSchemaFingerprint(schema);
      await assert.rejects(
        FEATURE_MIGRATION.up(queryInterface, SequelizePackage),
        (error) => error.code === 'INSTALLATION_PROVISIONING_REPAIR_REQUIRED',
      );
      assert.equal(await provisioningSchemaFingerprint(schema), missingIndexBefore);
      await queryInterface.addIndex(
        'InstallationProvisioningOperations',
        ['organizationId', 'createdAt'],
        { name: 'idx_installation_provisioning_org_created' },
      );

      const changedTrigger = FEATURE_MIGRATION.__testing.TRIGGERS.find(
        (item) => item.name === 'trg_owner_activation_tokens_bd',
      );
      await schema.query(`DROP TRIGGER \`${changedTrigger.name}\``);
      await schema.query(`
        CREATE TRIGGER \`${changedTrigger.name}\`
        BEFORE DELETE ON OwnerActivationTokens FOR EACH ROW
        BEGIN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='lookalike'; END
      `);
      const changedTriggerBefore = await provisioningSchemaFingerprint(schema);
      await assert.rejects(
        FEATURE_MIGRATION.up(queryInterface, SequelizePackage),
        (error) => error.code === 'INSTALLATION_PROVISIONING_REPAIR_REQUIRED',
      );
      assert.equal(await provisioningSchemaFingerprint(schema), changedTriggerBefore);
      await schema.query(`DROP TRIGGER \`${changedTrigger.name}\``);
      await schema.query(
        `CREATE TRIGGER \`${changedTrigger.name}\` BEFORE ${changedTrigger.event} ` +
        `ON \`${changedTrigger.table}\` FOR EACH ROW ${changedTrigger.body}`,
      );

      await queryInterface.removeConstraint(
        'InstallationProvisioningOperations',
        'fk_installation_provisioning_owner',
      );
      await queryInterface.addConstraint('InstallationProvisioningOperations', {
        fields: ['ownerAccountId'],
        name: 'fk_installation_provisioning_owner',
        onDelete: 'RESTRICT',
        onUpdate: 'RESTRICT',
        references: { field: 'id', table: 'Staffs' },
        type: 'foreign key',
      });
      const changedForeignKeyBefore = await provisioningSchemaFingerprint(schema);
      await assert.rejects(
        FEATURE_MIGRATION.up(queryInterface, SequelizePackage),
        (error) => error.code === 'INSTALLATION_PROVISIONING_REPAIR_REQUIRED',
      );
      assert.equal(await provisioningSchemaFingerprint(schema), changedForeignKeyBefore);
      await queryInterface.removeConstraint(
        'InstallationProvisioningOperations',
        'fk_installation_provisioning_owner',
      );
      await queryInterface.addConstraint('InstallationProvisioningOperations', {
        fields: ['ownerAccountId'],
        name: 'fk_installation_provisioning_owner',
        onDelete: 'RESTRICT',
        onUpdate: 'RESTRICT',
        references: { field: 'id', table: 'Accounts' },
        type: 'foreign key',
      });

      const trackedIndex = {
        name: 'uq_installation_provisioning_idempotency_hash',
        table: 'InstallationProvisioningOperations',
      };
      const trackedRows = await FEATURE_MIGRATION.__testing.readArtifact(
        queryInterface,
        'index',
        trackedIndex,
      );
      const ownershipPlan = {
        foreignKey: [],
        index: [{
          ...trackedIndex,
          signature: FEATURE_MIGRATION.__testing.artifactSignature('index', trackedRows),
        }],
        table: [],
        trigger: [],
      };
      await queryInterface.removeIndex(trackedIndex.table, trackedIndex.name);
      await queryInterface.addIndex(trackedIndex.table, ['payloadHash'], {
        name: trackedIndex.name,
        unique: true,
      });
      const ownershipBefore = await provisioningSchemaFingerprint(schema);
      await assert.rejects(
        FEATURE_MIGRATION.__testing.preflightCleanupInvocation(queryInterface, ownershipPlan),
        (error) => error.code === 'INSTALLATION_PROVISIONING_CLEANUP_OWNERSHIP_LOST',
      );
      assert.equal(await provisioningSchemaFingerprint(schema), ownershipBefore);
      await queryInterface.removeIndex(trackedIndex.table, trackedIndex.name);
      await queryInterface.addIndex(trackedIndex.table, ['idempotencyKeyHash'], {
        name: trackedIndex.name,
        unique: true,
      });

      const trackedTable = { table: FEATURE_MIGRATION.__testing.TABLES.operation };
      const completeOwnershipPlan = {
        foreignKey: [],
        index: [],
        table: [{
          ...trackedTable,
          signature: FEATURE_MIGRATION.__testing.artifactSignature(
            'table',
            await FEATURE_MIGRATION.__testing.readArtifact(
              queryInterface,
              'table',
              trackedTable,
            ),
          ),
        }],
        trigger: [],
      };
      const unownedIndex = 'idx_installation_provisioning_unowned_probe';
      await queryInterface.addIndex(trackedTable.table, ['payloadHash'], {
        name: unownedIndex,
      });
      const unownedBefore = await provisioningSchemaFingerprint(schema);
      await assert.rejects(
        FEATURE_MIGRATION.__testing.preflightCleanupInvocation(
          queryInterface,
          completeOwnershipPlan,
        ),
        (error) => error.code === 'INSTALLATION_PROVISIONING_CLEANUP_OWNERSHIP_LOST',
      );
      assert.equal(await provisioningSchemaFingerprint(schema), unownedBefore);
      await queryInterface.removeIndex(trackedTable.table, unownedIndex);

      assert.equal((await FEATURE_MIGRATION.__testing.classifyState(queryInterface)).state, 'ready');
      const tablesAfterUp = new Set(
        (await queryInterface.showAllTables()).map((table) =>
          typeof table === 'string' ? table : table.tableName,
        ),
      );
      assert.equal(tablesAfterUp.has('OwnerActivationTokens'), true);
      assert.equal(tablesAfterUp.has('InstallationProvisioningOperations'), true);
    });

    await seedTwoTenantFixture(schema);
    for (const name of CAPABILITY_ENV) process.env[name] = 'true';
    db = require('../../models');
    const provisioning = require('../../src/services/installation-provisioning.service');
    const auth = require('../../src/services/auth.service');
    const accountLifecycle = require('../../src/services/account-lifecycle.service');
    const auditService = require('../../src/services/audit.service');
    const tenantContext = require('../../src/services/tenant-context.service');
    const operator = { username: 'db-test-operator' };

    let created;
    let rawToken;
    await t.test('one transaction creates exact Clubs, owner graph, hash-only activation and audit', async () => {
      created = await provisioning.provisionOrganization(payload('alpha'), operator);
      assert.equal(created.idempotency.replayed, false);
      assert.equal(created.clubs.length, 2);
      assert.equal(created.organization.slug, 'organizatsiya-alpha');
      assert.deepEqual(
        created.clubs.map((club) => club.slug),
        ['klub-alpha-tsentr', 'klub-alpha-sever'],
      );
      assert.equal(created.activation.state, 'pending');
      assert.match(created.activation.link, /^http:\/\/127\.0\.0\.1:5182\/activate-owner#token=/u);
      rawToken = tokenFromLink(created.activation.link);
      assert.equal(rawToken.length, 43);
      const stored = await db.OwnerActivationToken.findOne({
        where: { organizationId: created.organization.id },
      });
      assert.equal(stored.tokenHash, provisioning._private.sha256(rawToken));
      assert.equal(JSON.stringify(stored.toJSON()).includes(rawToken), false);
      const membership = await db.Membership.findOne({
        where: { accountId: created.owner.accountId, organizationId: created.organization.id },
      });
      assert.equal(membership.role, 'owner');
      const ownerStaff = await db.Staff.findByPk(membership.staffId);
      assert.equal(ownerStaff.phone, '+79991112233');
      assert.equal(await db.MembershipClubAccess.count({ where: { membershipId: membership.id } }), 0);
      const audit = await db.AuditLog.findByPk(created.audit.id);
      assert.equal(audit.action, 'installation.provisioning.create');
      const auditMetadata = typeof audit.metadata === 'string'
        ? JSON.parse(audit.metadata)
        : audit.metadata;
      assert.deepEqual(
        auditMetadata.clubSlugs,
        ['klub-alpha-tsentr', 'klub-alpha-sever'],
      );
      const snapshot = await provisioning.getInstallationSnapshot();
      assert.equal(
        snapshot.organizations.find((item) => item.id === created.organization.id).ownerState,
        'pending_activation',
      );
      assert.equal(
        snapshot.organizations.find((item) => item.id !== created.organization.id).ownerState,
        'active',
      );
    });

    await t.test('same key is idempotent and a changed payload is rejected without duplicate graph', async () => {
      const original = payload('retry');
      const first = await provisioning.provisionOrganization(original, operator);
      const before = await counts(db, 'retry');
      const replay = await provisioning.provisionOrganization(original, operator);
      assert.equal(replay.idempotency.operationId, first.idempotency.operationId);
      assert.equal(replay.idempotency.replayed, true);
      assert.equal(replay.activation.link, null);
      assert.deepEqual(await counts(db, 'retry'), before);
      const changed = { ...original, organization: { ...original.organization, name: 'Другое имя' } };
      await assert.rejects(
        provisioning.provisionOrganization(changed, operator),
        (error) => error.code === 'IDEMPOTENCY_PAYLOAD_MISMATCH',
      );
      assert.deepEqual(await counts(db, 'retry'), before);
    });

    await t.test('forced mid-graph failure rolls back every row and is safely retryable', async () => {
      const input = payload('rollback');
      const before = await counts(db, 'rollback');
      await assert.rejects(
        provisioning.provisionOrganization(input, operator, { failAfter: 'owner' }),
        /Forced failure after owner graph/u,
      );
      assert.deepEqual(await counts(db, 'rollback'), before);
      const retry = await provisioning.provisionOrganization(input, operator);
      assert.equal(retry.organization.slug, 'organizatsiya-rollback');
      assert.equal(retry.clubs.length, 2);
    });

    await t.test('duplicate organization name and email leave no partial tenant graph', async () => {
      const nameDuplicate = payload('duplicate-name');
      nameDuplicate.organization.name = created.organization.name;
      await assert.rejects(
        provisioning.provisionOrganization(nameDuplicate, operator),
        (error) => error.code === 'ORGANIZATION_NAME_EXISTS',
      );
      assert.equal(
        await db.Account.count({ where: { email: nameDuplicate.owner.email } }),
        0,
      );

      const emailDuplicate = payload('duplicate-email');
      emailDuplicate.owner.email = created.owner.email;
      await assert.rejects(
        provisioning.provisionOrganization(emailDuplicate, operator),
        (error) => error.code === 'OWNER_EMAIL_EXISTS',
      );
      assert.equal(
        await db.Organization.count({ where: { name: emailDuplicate.organization.name } }),
        0,
      );
    });

    await t.test('DB and ORM guards reject cross-Organization inserts and reparenting', async () => {
      const peer = await provisioning.provisionOrganization(payload('authority-peer'), operator);
      const peerOperation = await db.InstallationProvisioningOperation.findByPk(
        peer.idempotency.operationId,
      );
      const legacyOrganization = await db.Organization.findOne({
        where: { id: { [db.Sequelize.Op.notIn]: [created.organization.id, peer.organization.id] } },
      });
      assert.ok(legacyOrganization);

      await assert.rejects(
        db.sequelize.query(`
          INSERT INTO OwnerActivationTokens
            (organizationId, accountId, tokenHash, expiresAt, consumedAt, invalidatedAt, createdAt, updatedAt)
          VALUES
            (:organizationId, :accountId, :tokenHash, DATE_ADD(NOW(), INTERVAL 1 DAY), NULL, NULL, NOW(), NOW())
        `, {
          replacements: {
            accountId: peer.owner.accountId,
            organizationId: legacyOrganization.id,
            tokenHash: crypto.createHash('sha256').update('cross-owner-token').digest('hex'),
          },
        }),
        /Owner activation authority mismatch/u,
      );
      await assert.rejects(
        db.sequelize.query(`
          INSERT INTO InstallationProvisioningOperations
            (idempotencyKeyHash, payloadHash, organizationId, ownerAccountId,
             activationTokenId, auditLogId, createdAt, updatedAt)
          VALUES
            (:keyHash, :payloadHash, :organizationId, :ownerAccountId,
             :activationTokenId, :auditLogId, NOW(), NOW())
        `, {
          replacements: {
            activationTokenId: peerOperation.activationTokenId,
            auditLogId: peerOperation.auditLogId,
            keyHash: crypto.createHash('sha256').update('cross-operation-key').digest('hex'),
            organizationId: legacyOrganization.id,
            ownerAccountId: peer.owner.accountId,
            payloadHash: crypto.createHash('sha256').update('cross-operation-payload').digest('hex'),
          },
        }),
        /Provisioning owner authority mismatch/u,
      );

      const authorityOnly = await db.sequelize.transaction(async (transaction) => {
        const organization = await db.Organization.create({
          name: 'Организация authority-only',
          slug: 'organization-authority-only',
          status: 'active',
        }, { transaction });
        const { account } = await accountLifecycle.createProvisionedOwner({
          email: 'owner-authority-only@provisioning.test',
          name: 'Владелец authority-only',
          organizationId: organization.id,
          passwordHash: auth.hashPassword('AuthorityFixture1234!'),
          phone: '+79991110000',
        }, { transaction });
        const activation = await db.OwnerActivationToken.create({
          accountId: account.id,
          expiresAt: new Date(Date.now() + 60_000),
          organizationId: organization.id,
          tokenHash: crypto.createHash('sha256').update('authority-only-token').digest('hex'),
        }, { transaction });
        const audit = await auditService.recordInstallation({
          action: 'installation.provisioning.create',
          entityId: String(organization.id),
          entityType: 'organization',
          method: 'POST',
          organizationId: organization.id,
          path: '/api/installation/provisioning/organizations',
          statusCode: 201,
          summary: 'Authority guard fixture',
        }, transaction);
        return { account, activation, audit, organization };
      });
      const insertOperation = (overrides) => db.sequelize.query(`
        INSERT INTO InstallationProvisioningOperations
          (idempotencyKeyHash, payloadHash, organizationId, ownerAccountId,
           activationTokenId, auditLogId, createdAt, updatedAt)
        VALUES
          (:keyHash, :payloadHash, :organizationId, :ownerAccountId,
           :activationTokenId, :auditLogId, NOW(), NOW())
      `, {
        replacements: {
          activationTokenId: authorityOnly.activation.id,
          auditLogId: authorityOnly.audit.id,
          keyHash: crypto.createHash('sha256').update(overrides.label).digest('hex'),
          organizationId: authorityOnly.organization.id,
          ownerAccountId: authorityOnly.account.id,
          payloadHash: crypto.createHash('sha256').update(`${overrides.label}-payload`).digest('hex'),
          ...overrides,
        },
      });
      await assert.rejects(
        insertOperation({ activationTokenId: peerOperation.activationTokenId, label: 'token-mismatch' }),
        /Provisioning activation authority mismatch/u,
      );
      await assert.rejects(
        insertOperation({ auditLogId: peerOperation.auditLogId, label: 'audit-mismatch' }),
        /Provisioning audit authority mismatch/u,
      );

      const peerToken = await db.OwnerActivationToken.findByPk(peerOperation.activationTokenId);
      await assert.rejects(
        peerToken.update({ organizationId: legacyOrganization.id }),
        (error) => error.code === 'TENANT_AUTHORITY_IMMUTABLE',
      );
      await assert.rejects(
        peerOperation.update({ ownerAccountId: created.owner.accountId }),
        (error) => error.code === 'TENANT_AUTHORITY_IMMUTABLE',
      );
      await assert.rejects(
        db.sequelize.query(
          'UPDATE OwnerActivationTokens SET organizationId=:organizationId WHERE id=:id',
          { replacements: { id: peerToken.id, organizationId: legacyOrganization.id } },
        ),
        /Owner activation authority is immutable/u,
      );
      const createdOperation = await db.InstallationProvisioningOperation.findByPk(
        created.idempotency.operationId,
      );
      await assert.rejects(
        db.sequelize.query(
          'UPDATE InstallationProvisioningOperations SET activationTokenId=:tokenId WHERE id=:id',
          { replacements: { id: createdOperation.id, tokenId: peerToken.id } },
        ),
        /Provisioning activation authority mismatch/u,
      );
      await assert.rejects(
        db.sequelize.query(
          'UPDATE InstallationProvisioningOperations SET organizationId=:organizationId WHERE id=:id',
          { replacements: { id: createdOperation.id, organizationId: legacyOrganization.id } },
        ),
        /Provisioning operation authority is immutable/u,
      );
    });

    await t.test('stale owner authority fails closed and never changes the victim password', async () => {
      const cases = [
        {
          name: 'membership status',
          mutate: ({ membership }) => db.sequelize.query(
            "UPDATE Memberships SET status='inactive' WHERE id=:id",
            { replacements: { id: membership.id } },
          ),
          restore: ({ membership }) => db.sequelize.query(
            "UPDATE Memberships SET status='active' WHERE id=:id",
            { replacements: { id: membership.id } },
          ),
        },
        {
          name: 'membership role',
          mutate: ({ membership }) => db.sequelize.query(
            "UPDATE Memberships SET role='manager' WHERE id=:id",
            { replacements: { id: membership.id } },
          ),
          restore: ({ membership }) => db.sequelize.query(
            "UPDATE Memberships SET role='owner' WHERE id=:id",
            { replacements: { id: membership.id } },
          ),
        },
        {
          name: 'account status',
          mutate: ({ account }) => db.sequelize.query(
            "UPDATE Accounts SET status='inactive' WHERE id=:id",
            { replacements: { id: account.id } },
          ),
          restore: ({ account }) => db.sequelize.query(
            "UPDATE Accounts SET status='active' WHERE id=:id",
            { replacements: { id: account.id } },
          ),
        },
        {
          name: 'organization status',
          mutate: ({ organization }) => db.sequelize.query(
            "UPDATE Organizations SET status='inactive' WHERE id=:id",
            { replacements: { id: organization.id } },
          ),
          restore: ({ organization }) => db.sequelize.query(
            "UPDATE Organizations SET status='active' WHERE id=:id",
            { replacements: { id: organization.id } },
          ),
        },
        {
          name: 'staff status',
          mutate: ({ staff }) => db.sequelize.query(
            "UPDATE Staffs SET status='inactive' WHERE id=:id",
            { replacements: { id: staff.id } },
          ),
          restore: ({ staff }) => db.sequelize.query(
            "UPDATE Staffs SET status='active' WHERE id=:id",
            { replacements: { id: staff.id } },
          ),
        },
      ];

      for (const [index, staleCase] of cases.entries()) {
        const provisioned = await provisioning.provisionOrganization(
          payload(`stale-${index}`),
          operator,
        );
        const activationToken = tokenFromLink(provisioned.activation.link);
        const account = await db.Account.findByPk(provisioned.owner.accountId);
        const organization = await db.Organization.findByPk(provisioned.organization.id);
        const membership = await db.Membership.findOne({
          where: { accountId: account.id, organizationId: organization.id },
        });
        const staff = await db.Staff.findByPk(account.staffId);
        const graph = { account, membership, organization, staff };
        const passwordHash = account.passwordHash;
        const activationCount = await db.OwnerActivationToken.count({
          where: { accountId: account.id, organizationId: organization.id },
        });
        await staleCase.mutate(graph);
        try {
          assert.deepEqual(
            await provisioning.inspectActivation(activationToken),
            { state: 'invalid' },
            staleCase.name,
          );
          await assert.rejects(
            provisioning.activateOwner(activationToken, 'MustNotBeStored123!'),
            (error) => error.code === 'OWNER_AUTHORITY_UNAVAILABLE',
          );
          await assert.rejects(
            provisioning.reissueActivation(organization.id, operator),
            (error) => error.code === 'OWNER_AUTHORITY_UNAVAILABLE',
          );
          assert.equal((await db.Account.findByPk(account.id)).passwordHash, passwordHash);
          assert.equal(
            await db.OwnerActivationToken.count({
              where: { accountId: account.id, organizationId: organization.id },
            }),
            activationCount,
          );
        } finally {
          await staleCase.restore(graph);
        }
      }
    });

    await t.test('internal organization and club slugs resolve collisions deterministically', async () => {
      const firstInput = payload('slug-collision-a');
      firstInput.organization.name = 'A B';
      firstInput.clubs = [
        { name: 'Центральный клуб', timezone: 'Europe/Moscow' },
        { name: 'Центральный клуб', timezone: 'Europe/Samara' },
      ];
      const first = await provisioning.provisionOrganization(firstInput, operator);
      assert.equal(first.organization.slug, 'a-b');
      assert.deepEqual(first.clubs.map((club) => club.slug), [
        'tsentralnyy-klub',
        'tsentralnyy-klub-2',
      ]);

      const secondInput = payload('slug-collision-b');
      secondInput.organization.name = 'A-B';
      const second = await provisioning.provisionOrganization(secondInput, operator);
      assert.equal(second.organization.slug, 'a-b-2');
    });

    await t.test('activation is single-use and enables ordinary login plus exact membership discovery', async () => {
      const status = await provisioning.inspectActivation(rawToken);
      assert.equal(status.state, 'pending');
      assert.equal(status.owner.email, created.owner.email);
      await provisioning.activateOwner(rawToken, 'OwnerSecure123!');
      assert.deepEqual(await provisioning.inspectActivation(rawToken), { state: 'consumed' });
      const snapshot = await provisioning.getInstallationSnapshot();
      assert.equal(
        snapshot.organizations.find((item) => item.id === created.organization.id).ownerState,
        'active',
      );
      await assert.rejects(
        provisioning.activateOwner(rawToken, 'AnotherSecure123!'),
        (error) => error.code === 'OWNER_ACTIVATION_UNAVAILABLE',
      );
      await assert.rejects(
        provisioning.reissueActivation(created.organization.id, operator),
        (error) => error.code === 'OWNER_ALREADY_ACTIVATED',
      );
      const session = await auth.login({ email: created.owner.email, password: 'OwnerSecure123!' });
      const discovery = await tenantContext.discoverMemberships(session.account.id);
      const membership = discovery.memberships.find(
        (item) => item.organization.id === created.organization.id,
      );
      assert.equal(membership.role, 'owner');
      assert.deepEqual(
        membership.clubs.map((club) => club.slug),
        ['klub-alpha-tsentr', 'klub-alpha-sever'],
      );
      assert.equal(discovery.recommendedContext.organizationId > 0, true);
    });

    await t.test('reissue invalidates the lost link and only the new link remains usable', async () => {
      const input = payload('reissue');
      const provisioned = await provisioning.provisionOrganization(input, operator);
      const previousToken = tokenFromLink(provisioned.activation.link);
      const reissued = await provisioning.reissueActivation(provisioned.organization.id, operator);
      const nextToken = tokenFromLink(reissued.activation.link);
      assert.notEqual(nextToken, previousToken);
      assert.deepEqual(await provisioning.inspectActivation(previousToken), { state: 'invalidated' });
      assert.equal((await provisioning.inspectActivation(nextToken)).state, 'pending');
      assert.equal(
        await db.OwnerActivationToken.count({
          where: { accountId: provisioned.owner.accountId, invalidatedAt: null, consumedAt: null },
        }),
        1,
      );
      const reissueAudit = await db.AuditLog.findByPk(reissued.audit.id);
      assert.equal(reissueAudit.action, 'installation.owner_activation.reissue');
    });

    await t.test('consumed token state cannot be reverted or made impossible', async () => {
      const operation = await db.InstallationProvisioningOperation.findByPk(
        created.idempotency.operationId,
      );
      const consumed = await db.OwnerActivationToken.findByPk(operation.activationTokenId);
      assert.ok(consumed.consumedAt);
      await assert.rejects(
        db.sequelize.query(
          'UPDATE OwnerActivationTokens SET consumedAt=NULL WHERE id=:id',
          { replacements: { id: consumed.id } },
        ),
        /consumption is irreversible/u,
      );
      await assert.rejects(
        db.sequelize.query(
          'UPDATE OwnerActivationTokens SET invalidatedAt=NOW() WHERE id=:id',
          { replacements: { id: consumed.id } },
        ),
        /state is impossible/u,
      );
    });

    await t.test('populated rollback is refused without changing activation history', async () => {
      const before = {
        activations: await db.OwnerActivationToken.count(),
        operations: await db.InstallationProvisioningOperation.count(),
      };
      await assert.rejects(
        FEATURE_MIGRATION.down(db.sequelize.getQueryInterface()),
        (error) => error.code === 'INSTALLATION_PROVISIONING_ROLLBACK_DATA_PRESENT',
      );
      assert.deepEqual({
        activations: await db.OwnerActivationToken.count(),
        operations: await db.InstallationProvisioningOperation.count(),
      }, before);
      assert.equal(
        (await FEATURE_MIGRATION.__testing.classifyState(db.sequelize.getQueryInterface())).state,
        'ready',
      );
    });
  } finally {
    if (db) await db.sequelize.close();
    if (schema) await schema.close();
    await dropDisposableDatabase(database);
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});
