'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const mysql = require('mysql2/promise');
const SequelizePackage = require('sequelize');
const {
  DEFAULT_CLUB_SLUG,
  DEFAULT_ORGANIZATION_SLUG,
} = require('../../src/tenant-foundation/constants');

const SERVER_ROOT = path.resolve(__dirname, '../..');
const FEATURE_MIGRATION_FILE = '20260719220000-add-tenant-onboarding.js';
const BIRTH_DATE_MIGRATION_FILE =
  '20260721100000-add-client-birth-date.js';
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
];

function databaseName() {
  return process.env.ONBOARDING_TEST_DB_NAME ||
    `setly_onboarding_f8_3_${process.pid}_${Date.now()}`;
}

async function createSchemaBeforeFeature(database) {
  const sequelize = new SequelizePackage.Sequelize(
    database,
    process.env.DB_USER,
    process.env.DB_PASSWORD,
    {
      dialect: 'mysql',
      host: process.env.DB_HOST || '127.0.0.1',
      logging: false,
    },
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
  const migrations = fs
    .readdirSync(path.join(SERVER_ROOT, 'migrations'))
    .filter((file) => file.endsWith('.js') && file < FEATURE_MIGRATION_FILE)
    .sort();
  for (const file of migrations) {
    const migration = require(path.join(SERVER_ROOT, 'migrations', file));
    await migration.up(queryInterface, SequelizePackage);
    await queryInterface.bulkInsert('SequelizeMeta', [{ name: file }]);
  }
  return sequelize;
}

async function selectOne(sequelize, sql, replacements = {}) {
  const rows = await sequelize.query(sql, {
    replacements,
    type: SequelizePackage.QueryTypes.SELECT,
  });
  return rows[0] || null;
}

async function applyTrackedMigration(queryInterface, file) {
  const applied = await selectOne(
    queryInterface.sequelize,
    'SELECT name FROM SequelizeMeta WHERE name=:name LIMIT 1',
    { name: file },
  );
  if (applied) return;

  const migration = require(path.join(SERVER_ROOT, 'migrations', file));
  await migration.up(queryInterface, SequelizePackage);
  await queryInterface.bulkInsert('SequelizeMeta', [{ name: file }]);
}

async function insertAccountAndMembership(
  schema,
  { email, organizationId, role = 'owner' },
) {
  const now = new Date();
  await schema.query(
    `INSERT INTO Accounts (email,passwordHash,role,status,createdAt,updatedAt)
     VALUES (:email,'test-hash',:role,'active',:now,:now)`,
    { replacements: { email, now, role } },
  );
  const account = await selectOne(schema, 'SELECT id FROM Accounts WHERE email=:email', { email });
  await schema.query(
    `INSERT INTO Memberships
       (organizationId,accountId,role,status,createdAt,updatedAt)
     VALUES (:organizationId,:accountId,:role,'active',:now,:now)`,
    { replacements: { accountId: account.id, now, organizationId, role } },
  );
  const membership = await selectOne(
    schema,
    'SELECT id FROM Memberships WHERE organizationId=:organizationId AND accountId=:accountId',
    { accountId: account.id, organizationId },
  );
  return { accountId: Number(account.id), membershipId: Number(membership.id) };
}

function restoreEnv(previous) {
  for (const [name, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

async function expectTenantDenial(promise) {
  await assert.rejects(
    promise,
    (error) => error.code === 'TENANT_CONTEXT_NOT_FOUND' && error.statusCode === 404,
  );
}

async function expectDatabaseReject(promise, pattern) {
  await assert.rejects(
    promise,
    (error) => pattern.test(String(error?.parent?.sqlMessage || error?.message || error)),
  );
}

async function ownershipInventory(schema) {
  const queries = [
    `SELECT * FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE()
      AND (TABLE_NAME LIKE 'Onboarding%' OR TABLE_NAME='TenantOnboardingMigrationPlans'
        OR COLUMN_NAME='trainingSessionId')
      ORDER BY TABLE_NAME,ORDINAL_POSITION`,
    `SELECT * FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE()
      AND (TABLE_NAME LIKE 'Onboarding%' OR TABLE_NAME='TenantOnboardingMigrationPlans'
        OR INDEX_NAME='training_session_idx')
      ORDER BY TABLE_NAME,INDEX_NAME,SEQ_IN_INDEX`,
    `SELECT * FROM information_schema.KEY_COLUMN_USAGE WHERE CONSTRAINT_SCHEMA=DATABASE()
      AND (TABLE_NAME LIKE 'Onboarding%' OR CONSTRAINT_NAME LIKE 'f83_%')
      ORDER BY TABLE_NAME,CONSTRAINT_NAME,ORDINAL_POSITION`,
    `SELECT * FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE()
      AND (TABLE_NAME LIKE 'Onboarding%' OR CONSTRAINT_NAME LIKE 'f83_%')
      ORDER BY TABLE_NAME,CONSTRAINT_NAME`,
    `SELECT TRIGGER_NAME,EVENT_MANIPULATION,EVENT_OBJECT_TABLE,ACTION_ORDER,ACTION_STATEMENT,
            ACTION_ORIENTATION,ACTION_TIMING,SQL_MODE,CHARACTER_SET_CLIENT,
            COLLATION_CONNECTION,DATABASE_COLLATION
       FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE()
        AND (TRIGGER_NAME LIKE 'trg_onboarding_%' OR TRIGGER_NAME LIKE 'trg_f83_%')
      ORDER BY TRIGGER_NAME`,
    'SELECT * FROM OnboardingProgresses ORDER BY id',
    'SELECT * FROM OnboardingTrainingModes ORDER BY id',
    'SELECT * FROM OnboardingEvents ORDER BY id',
    'SELECT * FROM TenantOnboardingMigrationPlans ORDER BY featureKey',
  ];
  const output = [];
  for (let index = 0; index < queries.length; index += 1) {
    const rows = await schema.query(queries[index], { type: SequelizePackage.QueryTypes.SELECT });
    output.push(index === 1
      ? rows.map(({ CARDINALITY: _volatileCardinality, ...row }) => row)
      : rows);
  }
  return JSON.parse(JSON.stringify(output));
}

async function expectMutationFreeOwnershipRefusal(schema, operation) {
  const before = await ownershipInventory(schema);
  await assert.rejects(
    operation(),
    (error) => error.code === 'TENANT_ONBOARDING_CLEANUP_OWNERSHIP_LOST' &&
      error.operatorRepair === true,
  );
  assert.deepEqual(await ownershipInventory(schema), before);
}

async function fixtureInventory(schema) {
  const tables = [
    'Accounts', 'Memberships', 'MembershipClubAccesses', 'Staffs', 'Users',
    'Visits', 'ScannerEvents', 'Receipts', 'ReceiptItems', 'Shifts', 'Finances',
    'Utilizations', 'Bookings', 'BookingChangeLogs', 'ClientBases', 'CallTasks',
    'CallTaskClients', 'CallTaskAttempts', 'TrainingNotes',
  ];
  const output = {};
  for (const table of tables) {
    output[table] = await schema.query(`SELECT * FROM \`${table}\` ORDER BY 1`, {
      type: SequelizePackage.QueryTypes.SELECT,
    });
  }
  return JSON.parse(JSON.stringify(output));
}

async function expectMutationFreeFixtureRefusal(schema, operation) {
  const before = await fixtureInventory(schema);
  await assert.rejects(
    operation(),
    (error) => error.code === 'TENANT_SEEDER_ARTIFACT_OWNERSHIP_LOST',
  );
  assert.deepEqual(await fixtureInventory(schema), before);
}

test('Feature 8.3 real MySQL migration and two-tenant onboarding/cleanup/fixture matrix', async () => {
  assert.ok(process.env.DB_USER, 'DB_USER is required for DB-backed tenant tests');
  const database = databaseName();
  const previous = Object.fromEntries([
    ...CAPABILITY_ENV,
    'DB_NAME',
    'NODE_ENV',
    'ONBOARDING_TEST_DB_NAME',
    'TENANT_ONBOARDING_MIGRATION_FAIL_STEP',
  ].map((name) => [name, process.env[name]]));
  const admin = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    password: process.env.DB_PASSWORD,
    user: process.env.DB_USER,
  });
  await admin.query(`DROP DATABASE IF EXISTS \`${database}\``);
  await admin.query(
    `CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
  );

  process.env.DB_NAME = database;
  process.env.NODE_ENV = 'test';
  for (const name of CAPABILITY_ENV) process.env[name] = 'true';

  let accountSeederAdapter;
  let db;
  let schema;
  try {
    schema = await createSchemaBeforeFeature(database);
    const queryInterface = schema.getQueryInterface();
    const migration = require(`../../migrations/${FEATURE_MIGRATION_FILE}`);
    assert.equal(await migration._private.classify(queryInterface), 'legacy');
    const defaultTenant = await selectOne(
      schema,
      `SELECT o.id organizationId,c.id clubId FROM Organizations o
       JOIN Clubs c ON c.organizationId=o.id
       WHERE o.slug=:organizationSlug AND c.slug=:clubSlug`,
      {
        clubSlug: DEFAULT_CLUB_SLUG,
        organizationSlug: DEFAULT_ORGANIZATION_SLUG,
      },
    );
    const tenantA = await insertAccountAndMembership(schema, {
      email: 'owner-a-onboarding@test.local',
      organizationId: Number(defaultTenant.organizationId),
    });
    const now = new Date();
    await queryInterface.bulkInsert('OnboardingProgresses', [{
      accountId: tenantA.accountId,
      completedAt: now,
      createdAt: now,
      metadata: '{}',
      role: 'admin',
      status: 'completed',
      taskKey: 'admin.access.create-visit',
      updatedAt: now,
    }]);
    await queryInterface.bulkInsert('OnboardingTrainingModes', [{
      accountId: tenantA.accountId,
      createdAt: now,
      enabledAt: now,
      isEnabled: true,
      metadata: '{}',
      role: 'admin',
      updatedAt: now,
    }]);
    await queryInterface.bulkInsert('OnboardingEvents', [{
      accountId: tenantA.accountId,
      completedTaskKeys: '[]',
      createdAt: now,
      entityId: 'legacy-1',
      entityType: 'legacy',
      eventKey: 'audit.viewed',
      isTraining: true,
      payload: '{}',
      role: 'admin',
      updatedAt: now,
    }]);
    await queryInterface.bulkInsert('Users', [{
      createdAt: now,
      isTraining: true,
      name: 'Legacy training client',
      organizationId: Number(defaultTenant.organizationId),
      phone: '+70000000001',
      phoneNormalized: '70000000001',
      source: 'test',
      status: 'active',
      trainingAccountId: tenantA.accountId,
      trainingRole: 'admin',
      updatedAt: now,
      webId: 'legacy-training-client',
    }]);

    await queryInterface.addColumn('OnboardingProgresses', 'organizationId', {
      allowNull: true,
      type: SequelizePackage.STRING,
    });
    await assert.rejects(migration.up(queryInterface, SequelizePackage), /refused partial schema/);
    assert.equal(await migration._private.classify(queryInterface), 'partial');
    await queryInterface.removeColumn('OnboardingProgresses', 'organizationId');

    await queryInterface.addIndex('OnboardingProgresses', ['role'], {
      name: 'onboarding_progress_account_idx',
    });
    const collisionBefore = await selectOne(
      schema,
      'SELECT COUNT(*) count FROM OnboardingEvents',
    );
    await assert.rejects(
      schema.transaction((transaction) =>
        migration._private.cleanupOwnedPartialMigration(queryInterface, transaction)),
      (error) => error.code === 'TENANT_ONBOARDING_CLEANUP_OWNERSHIP_LOST' &&
        error.operatorRepair === true,
    );
    assert.deepEqual(
      await selectOne(schema, 'SELECT COUNT(*) count FROM OnboardingEvents'),
      collisionBefore,
    );
    assert.ok((await queryInterface.showIndex('OnboardingProgresses'))
      .some((index) => index.name === 'onboarding_progress_account_idx'));
    await queryInterface.removeIndex(
      'OnboardingProgresses',
      'onboarding_progress_account_idx',
    );

    for (const stage of ['after_columns', 'after_backfill', 'after_constraints']) {
      process.env.TENANT_ONBOARDING_MIGRATION_FAIL_STEP = stage;
      await assert.rejects(
        migration.up(queryInterface, SequelizePackage),
        (error) => error.code === 'TENANT_ONBOARDING_FORCED_FAILURE',
      );
      delete process.env.TENANT_ONBOARDING_MIGRATION_FAIL_STEP;
      assert.equal(await migration._private.classify(queryInterface), 'legacy');
      assert.equal(Number((await selectOne(schema, 'SELECT COUNT(*) count FROM OnboardingEvents')).count), 1);
    }

    await migration.up(queryInterface, SequelizePackage);
    assert.equal(await migration._private.classify(queryInterface), 'ready');
    await migration.up(queryInterface, SequelizePackage);
    const migrated = await selectOne(schema, `
      SELECT p.organizationId,p.membershipId,mode.clubId,mode.sessionId,
             e.trainingSessionId,u.trainingSessionId artifactSession
      FROM OnboardingProgresses p
      JOIN OnboardingTrainingModes mode ON mode.membershipId=p.membershipId
      JOIN OnboardingEvents e ON e.membershipId=p.membershipId
      JOIN Users u ON u.trainingAccountId=p.accountId AND u.isTraining=1
      LIMIT 1
    `);
    assert.equal(Number(migrated.organizationId), Number(defaultTenant.organizationId));
    assert.equal(Number(migrated.membershipId), tenantA.membershipId);
    assert.equal(Number(migrated.clubId), Number(defaultTenant.clubId));
    assert.ok(migrated.sessionId);
    assert.equal(migrated.trainingSessionId, migrated.sessionId);
    assert.equal(migrated.artifactSession, migrated.sessionId);

    const artifactPlan = require('../../src/onboarding/migration-artifact-plan');
    const capturedPlan = await artifactPlan.loadPlan(queryInterface);
    const progressIndex = capturedPlan.artifacts.find((artifact) =>
      artifact.kind === 'index' && artifact.name === 'onboarding_training_modes_account_idx');
    assert.ok(progressIndex);
    await schema.query('DROP INDEX onboarding_training_modes_account_idx ON OnboardingTrainingModes');
    await expectMutationFreeOwnershipRefusal(
      schema,
      () => migration.down(queryInterface, SequelizePackage),
    );
    await schema.query(
      'CREATE INDEX onboarding_training_modes_account_idx ON OnboardingTrainingModes (accountId)',
    );
    await schema.query('DROP INDEX onboarding_training_modes_account_idx ON OnboardingTrainingModes');
    await schema.query(
      'CREATE UNIQUE INDEX onboarding_training_modes_account_idx ON OnboardingTrainingModes (accountId)',
    );
    await expectMutationFreeOwnershipRefusal(
      schema,
      () => migration.down(queryInterface, SequelizePackage),
    );
    await schema.query('DROP INDEX onboarding_training_modes_account_idx ON OnboardingTrainingModes');
    await schema.query(
      'CREATE INDEX onboarding_training_modes_account_idx ON OnboardingTrainingModes (accountId)',
    );

    await schema.query(
      'ALTER TABLE OnboardingProgresses DROP FOREIGN KEY onboardingprogresses_club_fk',
    );
    await expectMutationFreeOwnershipRefusal(
      schema,
      () => migration.down(queryInterface, SequelizePackage),
    );
    await schema.query(
      `ALTER TABLE OnboardingProgresses ADD CONSTRAINT onboardingprogresses_club_fk
        FOREIGN KEY (clubId) REFERENCES Clubs(id) ON UPDATE CASCADE ON DELETE RESTRICT`,
    );
    await schema.query(
      'ALTER TABLE OnboardingProgresses DROP FOREIGN KEY onboardingprogresses_club_fk',
    );
    await schema.query(
      `ALTER TABLE OnboardingProgresses ADD CONSTRAINT onboardingprogresses_club_fk
        FOREIGN KEY (clubId) REFERENCES Clubs(id) ON UPDATE CASCADE ON DELETE CASCADE`,
    );
    await expectMutationFreeOwnershipRefusal(
      schema,
      () => migration.down(queryInterface, SequelizePackage),
    );
    await schema.query(
      'ALTER TABLE OnboardingProgresses DROP FOREIGN KEY onboardingprogresses_club_fk',
    );
    await schema.query(
      `ALTER TABLE OnboardingProgresses ADD CONSTRAINT onboardingprogresses_club_fk
        FOREIGN KEY (clubId) REFERENCES Clubs(id) ON UPDATE CASCADE ON DELETE RESTRICT`,
    );

    const deleteTrigger = 'trg_onboarding_event_delete_training_only';
    const deleteBody = migration._private.TRIGGERS[deleteTrigger];
    await schema.query(`DROP TRIGGER ${deleteTrigger}`);
    await expectMutationFreeOwnershipRefusal(
      schema,
      () => migration.down(queryInterface, SequelizePackage),
    );
    await schema.query(`CREATE TRIGGER ${deleteTrigger} BEFORE DELETE ON OnboardingEvents FOR EACH ROW ${deleteBody}`);
    await schema.query(`DROP TRIGGER ${deleteTrigger}`);
    await schema.query(`CREATE TRIGGER ${deleteTrigger} AFTER DELETE ON OnboardingEvents FOR EACH ROW ${deleteBody}`);
    await expectMutationFreeOwnershipRefusal(
      schema,
      () => migration.down(queryInterface, SequelizePackage),
    );
    await schema.query(`DROP TRIGGER ${deleteTrigger}`);
    await schema.query(`CREATE TRIGGER ${deleteTrigger} BEFORE DELETE ON OnboardingEvents FOR EACH ROW ${deleteBody}`);
    await schema.query(`DROP TRIGGER ${deleteTrigger}`);
    await schema.query(
      `CREATE TRIGGER ${deleteTrigger} BEFORE DELETE ON OnboardingEvents FOR EACH ROW
       ${deleteBody.replace('Production OnboardingEvent rows are immutable', 'production OnboardingEvent rows are immutable')}`,
    );
    await expectMutationFreeOwnershipRefusal(
      schema,
      () => migration.down(queryInterface, SequelizePackage),
    );
    await schema.query(`DROP TRIGGER ${deleteTrigger}`);
    await schema.query(`CREATE TRIGGER ${deleteTrigger} BEFORE DELETE ON OnboardingEvents FOR EACH ROW ${deleteBody}`);

    const legacyProgress = capturedPlan.legacy.find((item) => item.table === 'OnboardingProgresses');
    await schema.query(
      `CREATE INDEX \`${legacyProgress.name}\` ON OnboardingProgresses (status)`,
    );
    await expectMutationFreeOwnershipRefusal(
      schema,
      () => migration.down(queryInterface, SequelizePackage),
    );
    await schema.query(`DROP INDEX \`${legacyProgress.name}\` ON OnboardingProgresses`);

    const legacyAccountColumn = legacyProgress.columns.accountId;
    const legacyAccountNullSql = legacyAccountColumn.IS_NULLABLE === 'YES' ? 'NULL' : 'NOT NULL';
    await schema.query(
      `ALTER TABLE OnboardingProgresses MODIFY accountId ${legacyAccountColumn.COLUMN_TYPE}
        ${legacyAccountNullSql} COMMENT 'tamper'`,
    );
    await expectMutationFreeOwnershipRefusal(
      schema,
      () => migration.down(queryInterface, SequelizePackage),
    );
    await schema.query(
      `ALTER TABLE OnboardingProgresses MODIFY accountId ${legacyAccountColumn.COLUMN_TYPE}
        ${legacyAccountNullSql} COMMENT ${schema.escape(legacyAccountColumn.COLUMN_COMMENT || '')}`,
    );

    const [[savedPlanRow]] = await schema.query(
      'SELECT planJson FROM TenantOnboardingMigrationPlans WHERE featureKey=:featureKey',
      { replacements: { featureKey: artifactPlan.PLAN_KEY } },
    );
    await schema.query(
      "ALTER TABLE TenantOnboardingMigrationPlans MODIFY planJson LONGTEXT NOT NULL COMMENT 'tamper'",
    );
    await expectMutationFreeOwnershipRefusal(
      schema,
      () => migration.down(queryInterface, SequelizePackage),
    );
    await schema.query(
      "ALTER TABLE TenantOnboardingMigrationPlans MODIFY planJson LONGTEXT NOT NULL COMMENT ''",
    );
    await schema.query('ALTER TABLE TenantOnboardingMigrationPlans DROP COLUMN planJson');
    await expectMutationFreeOwnershipRefusal(
      schema,
      () => migration.down(queryInterface, SequelizePackage),
    );
    await schema.query('ALTER TABLE TenantOnboardingMigrationPlans ADD COLUMN planJson LONGTEXT NULL');
    await schema.query(
      'UPDATE TenantOnboardingMigrationPlans SET planJson=:planJson WHERE featureKey=:featureKey',
      { replacements: { featureKey: artifactPlan.PLAN_KEY, planJson: savedPlanRow.planJson } },
    );
    await schema.query('ALTER TABLE TenantOnboardingMigrationPlans MODIFY planJson LONGTEXT NOT NULL');

    await migration.down(queryInterface, SequelizePackage);
    assert.equal(await migration._private.classify(queryInterface), 'legacy');
    assert.equal(Number((await selectOne(schema, 'SELECT COUNT(*) count FROM OnboardingProgresses')).count), 1);
    await migration.up(queryInterface, SequelizePackage);
    assert.equal(await migration._private.classify(queryInterface), 'ready');

    await applyTrackedMigration(queryInterface, BIRTH_DATE_MIGRATION_FILE);
    assert.ok(
      (await queryInterface.describeTable('Users')).birthDate,
      'production-like schema must include Users.birthDate before current models load',
    );

    db = require('../../models');
    accountSeederAdapter = require('../../src/services/account-seeder-adapter');
    const performanceFixture = require('../../../scripts/seed-performance-data');
    const bulkReceiptSeeder = require('../../seeders/20260503162130-bulk-100-receipts');
    const demoCrmSeeder = require('../../seeders/20260511120000-demo-crm-data');
    const demoBookingSeeder = require('../../seeders/20260526101000-demo-bookings');
    const fixtureDryRun = await accountSeederAdapter.runInitializedSeederBatch(
      queryInterface,
      async (_scopedQueryInterface, _accountBatch, foundation) => ({
        clubId: Number(foundation.club.id),
        organizationId: Number(foundation.organization.id),
      }),
    );
    assert.deepEqual(fixtureDryRun, {
      clubId: Number(defaultTenant.clubId),
      organizationId: Number(defaultTenant.organizationId),
    });
    assert.deepEqual(
      await performanceFixture._private.resolveFixtureContext(),
      {
        accountId: tenantA.accountId,
        clubId: Number(defaultTenant.clubId),
        organizationId: Number(defaultTenant.organizationId),
      },
    );
    await queryInterface.bulkInsert('Receipts', [{
      cash: 777,
      cashless: 0,
      clubId: Number(defaultTenant.clubId),
      createdAt: now,
      dateTime: now,
      employeeId: 'production',
      evotorId: 'production-receipt-id-collision',
      id: 10000,
      organizationId: Number(defaultTenant.organizationId),
      paymentSource: 'CASH',
      shiftId: 'production-shift',
      totalAmount: 777,
      totalDiscount: 0,
      totalTax: 0,
      type: 'SELL',
      updatedAt: now,
    }]);
    const bulkCollisionBefore = await schema.query(
      'SELECT * FROM Receipts WHERE id BETWEEN 10000 AND 10099 ORDER BY id',
      { type: SequelizePackage.QueryTypes.SELECT },
    );
    await assert.rejects(
      bulkReceiptSeeder.up(queryInterface, SequelizePackage),
      (error) => error.code === 'TENANT_SEEDER_ARTIFACT_OWNERSHIP_LOST',
    );
    assert.deepEqual(await schema.query(
      'SELECT * FROM Receipts WHERE id BETWEEN 10000 AND 10099 ORDER BY id',
      { type: SequelizePackage.QueryTypes.SELECT },
    ), bulkCollisionBefore);
    await queryInterface.bulkDelete('Receipts', { id: 10000 });
    await bulkReceiptSeeder.up(queryInterface, SequelizePackage);
    assert.equal(Number((await selectOne(schema, `
      SELECT COUNT(*) count FROM Receipts
       WHERE organizationId=:organizationId AND clubId=:clubId
         AND id BETWEEN 10000 AND 10099
    `, defaultTenant)).count), 100);
    await bulkReceiptSeeder.down(queryInterface, SequelizePackage);
    assert.equal(Number((await selectOne(schema, `
      SELECT COUNT(*) count FROM Receipts WHERE id BETWEEN 10000 AND 10099
    `)).count), 0);
    await demoBookingSeeder.up(queryInterface, SequelizePackage);
    await demoBookingSeeder.down(queryInterface, SequelizePackage);
    await queryInterface.bulkInsert('CatalogRules', [{
      category: 'Production',
      createdAt: now,
      id: 910000,
      itemName: 'production-owned-collision',
      updatedAt: now,
    }]);
    const beforeCollision = await selectOne(
      schema,
      'SELECT COUNT(*) count FROM Receipts WHERE id BETWEEN 20000 AND 29999',
    );
    await assert.rejects(
      demoCrmSeeder.up(queryInterface, SequelizePackage),
      (error) => error.code === 'TENANT_SEEDER_ARTIFACT_OWNERSHIP_LOST',
    );
    assert.deepEqual(
      await selectOne(schema, 'SELECT itemName FROM CatalogRules WHERE id=910000'),
      { itemName: 'production-owned-collision' },
    );
    assert.deepEqual(
      await selectOne(schema, 'SELECT COUNT(*) count FROM Receipts WHERE id BETWEEN 20000 AND 29999'),
      beforeCollision,
    );
    await queryInterface.bulkDelete('CatalogRules', { id: 910000 });

    await queryInterface.bulkInsert('Users', [{
      createdAt: now,
      name: 'Production prefix collision',
      organizationId: Number(defaultTenant.organizationId),
      phone: '+79099999999',
      source: 'production',
      status: 'active',
      updatedAt: now,
    }]);
    await expectMutationFreeFixtureRefusal(
      schema,
      () => demoCrmSeeder.up(queryInterface, SequelizePackage),
    );
    await queryInterface.bulkDelete('Users', { phone: '+79099999999' });

    await queryInterface.bulkInsert('Staffs', [{
      createdAt: now,
      name: 'Production staff collision',
      organizationId: Number(defaultTenant.organizationId),
      phone: '+79000000199',
      role: 'Администратор',
      status: 'active',
      updatedAt: now,
    }]);
    await expectMutationFreeFixtureRefusal(
      schema,
      () => demoCrmSeeder.down(queryInterface, SequelizePackage),
    );
    await queryInterface.bulkDelete('Staffs', { phone: '+79000000199' });

    const productionDemoAccount = await insertAccountAndMembership(schema, {
      email: 'production@padelpark.demo',
      organizationId: Number(defaultTenant.organizationId),
      role: 'viewer',
    });
    await queryInterface.bulkInsert('MembershipClubAccesses', [{
      clubId: Number(defaultTenant.clubId),
      createdAt: now,
      membershipId: productionDemoAccount.membershipId,
      organizationId: Number(defaultTenant.organizationId),
      roleOverride: null,
      status: 'active',
      updatedAt: now,
    }]);
    await expectMutationFreeFixtureRefusal(
      schema,
      () => demoCrmSeeder.up(queryInterface, SequelizePackage),
    );
    await queryInterface.bulkDelete('MembershipClubAccesses', {
      membershipId: productionDemoAccount.membershipId,
    });
    await queryInterface.bulkDelete('Memberships', { id: productionDemoAccount.membershipId });
    await queryInterface.bulkDelete('Accounts', { id: productionDemoAccount.accountId });

    await queryInterface.bulkInsert('Receipts', [{
      cash: 888,
      cashless: 0,
      clubId: Number(defaultTenant.clubId),
      createdAt: now,
      dateTime: now,
      employeeId: 'production',
      evotorId: 'production-demo-range-collision',
      id: 20099,
      organizationId: Number(defaultTenant.organizationId),
      paymentSource: 'CASH',
      shiftId: 'production',
      totalAmount: 888,
      totalDiscount: 0,
      totalTax: 0,
      type: 'SELL',
      updatedAt: now,
    }]);
    await expectMutationFreeFixtureRefusal(
      schema,
      () => demoCrmSeeder.down(queryInterface, SequelizePackage),
    );
    await queryInterface.bulkDelete('Receipts', { id: 20099 });

    await queryInterface.bulkInsert('Shifts', [{
      actualHours: 1,
      adminName: 'Production',
      clubId: Number(defaultTenant.clubId),
      comment: '[demo] production collision',
      createdAt: now,
      date: '2026-05-14',
      hours: 1,
      status: 'closed',
      updatedAt: now,
    }]);
    await expectMutationFreeFixtureRefusal(
      schema,
      () => demoCrmSeeder.up(queryInterface, SequelizePackage),
    );
    await queryInterface.bulkDelete('Shifts', { comment: '[demo] production collision' });

    await queryInterface.bulkInsert('Finances', [{
      amount: 999,
      category: 'Production',
      clubId: Number(defaultTenant.clubId),
      comment: '[demo] production finance collision',
      createdAt: now,
      date: '2026-05-14',
      organizationId: Number(defaultTenant.organizationId),
      type: 'income',
      updatedAt: now,
    }]);
    await expectMutationFreeFixtureRefusal(
      schema,
      () => demoCrmSeeder.down(queryInterface, SequelizePackage),
    );
    await queryInterface.bulkDelete('Finances', { comment: '[demo] production finance collision' });

    await queryInterface.bulkInsert('Utilizations', [{
      booked1: 1,
      booked2: 1,
      clubId: Number(defaultTenant.clubId),
      createdAt: now,
      date: '2026-05-14',
      organizationId: Number(defaultTenant.organizationId),
      sessions1: 1,
      sessions2: 1,
      updatedAt: now,
    }]);
    await expectMutationFreeFixtureRefusal(
      schema,
      () => demoCrmSeeder.up(queryInterface, SequelizePackage),
    );
    await queryInterface.bulkDelete('Utilizations', {
      clubId: Number(defaultTenant.clubId),
      date: '2026-05-14',
      organizationId: Number(defaultTenant.organizationId),
    });

    await demoCrmSeeder.up(queryInterface, SequelizePackage);
    assert.equal(Number((await selectOne(schema, `
      SELECT COUNT(*) count FROM Accounts account
      JOIN Memberships membership ON membership.accountId=account.id
      WHERE account.email LIKE '%@padelpark.demo'
        AND membership.organizationId=:organizationId
    `, defaultTenant)).count), 6);
    assert.equal(Number((await selectOne(schema, `
      SELECT COUNT(*) count FROM MembershipClubAccesses access
      JOIN Memberships membership ON membership.id=access.membershipId
      JOIN Accounts account ON account.id=membership.accountId
      WHERE account.email LIKE '%@padelpark.demo'
        AND access.organizationId=:organizationId AND access.clubId=:clubId
    `, defaultTenant)).count), 5);
    assert.equal(Number((await selectOne(schema, `
      SELECT COUNT(*) count FROM Receipts WHERE id BETWEEN 20000 AND 29999
        AND organizationId=:organizationId AND clubId=:clubId
    `, defaultTenant)).count), 44);
    await demoBookingSeeder.up(queryInterface, SequelizePackage);
    const demoBooking = await selectOne(
      schema,
      `SELECT id,comment FROM Bookings WHERE organizationId=:organizationId AND clubId=:clubId
        AND comment='Демо: бронь по телефону, оплатили безналом.'`,
      defaultTenant,
    );
    assert.ok(demoBooking, 'exact demo booking fixture must be created');
    await schema.query(
      "UPDATE Bookings SET comment='Демо: production collision' WHERE id=:id",
      { replacements: { id: demoBooking.id } },
    );
    await expectMutationFreeFixtureRefusal(
      schema,
      () => demoBookingSeeder.down(queryInterface, SequelizePackage),
    );
    await schema.query(
      'UPDATE Bookings SET comment=:comment WHERE id=:id',
      { replacements: { comment: demoBooking.comment, id: demoBooking.id } },
    );
    await demoBookingSeeder.down(queryInterface, SequelizePackage);
    await schema.query(
      "UPDATE Memberships SET status='inactive' WHERE id=:membershipId",
      { replacements: { membershipId: tenantA.membershipId } },
    );
    await schema.query(
      "UPDATE Accounts SET status='inactive' WHERE id=:accountId",
      { replacements: { accountId: tenantA.accountId } },
    );
    await assert.rejects(
      demoCrmSeeder.down(queryInterface, SequelizePackage),
      (error) => error.code === 'TENANT_SEEDER_LAST_OWNER',
    );
    assert.equal(Number((await selectOne(
      schema,
      "SELECT COUNT(*) count FROM Accounts WHERE email LIKE '%@padelpark.demo'",
    )).count), 6);
    await schema.query(
      "UPDATE Memberships SET status='active' WHERE id=:membershipId",
      { replacements: { membershipId: tenantA.membershipId } },
    );
    await schema.query(
      "UPDATE Accounts SET status='active' WHERE id=:accountId",
      { replacements: { accountId: tenantA.accountId } },
    );
    await demoCrmSeeder.down(queryInterface, SequelizePackage);
    assert.equal(Number((await selectOne(
      schema,
      "SELECT COUNT(*) count FROM Accounts WHERE email LIKE '%@padelpark.demo'",
    )).count), 0);

    performanceFixture._private.setFixtureContext({
      accountId: tenantA.accountId,
      clubId: Number(defaultTenant.clubId),
      organizationId: Number(defaultTenant.organizationId),
    });
    await db.User.create({
      name: 'Production performance-prefix collision',
      organizationId: Number(defaultTenant.organizationId),
      phone: '+7988999999',
      source: 'production',
      status: 'active',
    });
    await expectMutationFreeFixtureRefusal(
      schema,
      () => performanceFixture._private.cleanup(),
    );
    await db.User.destroy({ where: { phone: '+7988999999' } });

    await queryInterface.bulkInsert('Organizations', [{
      createdAt: now,
      name: 'Tenant B',
      slug: 'tenant-b-onboarding',
      status: 'active',
      updatedAt: now,
    }]);
    const organizationB = await selectOne(
      schema,
      "SELECT id FROM Organizations WHERE slug='tenant-b-onboarding'",
    );
    await queryInterface.bulkInsert('Clubs', [{
      createdAt: now,
      name: 'Tenant B Club',
      organizationId: organizationB.id,
      slug: 'tenant-b-club',
      status: 'active',
      timezone: 'Europe/Moscow',
      updatedAt: now,
    }]);
    const clubB = await selectOne(schema, "SELECT id FROM Clubs WHERE slug='tenant-b-club'");
    const tenantB = await insertAccountAndMembership(schema, {
      email: 'owner-b-onboarding@test.local',
      organizationId: Number(organizationB.id),
    });

    await schema.query(
      `INSERT INTO Memberships
        (organizationId,accountId,role,status,createdAt,updatedAt)
       VALUES (:organizationId,:accountId,'owner','active',:now,:now)`,
      { replacements: {
        accountId: tenantA.accountId,
        now,
        organizationId: Number(organizationB.id),
      } },
    );
    const duplicateMembership = await selectOne(
      schema,
      `SELECT id FROM Memberships WHERE organizationId=:organizationId AND accountId=:accountId`,
      { accountId: tenantA.accountId, organizationId: Number(organizationB.id) },
    );
    await schema.query(
      `INSERT INTO OnboardingProgresses
        (accountId,organizationId,membershipId,clubId,role,taskKey,status,
         completedAt,metadata,createdAt,updatedAt)
       SELECT accountId,:organizationId,:membershipId,NULL,role,taskKey,status,
              completedAt,metadata,:now,:now
         FROM OnboardingProgresses WHERE accountId=:accountId LIMIT 1`,
      { replacements: {
        accountId: tenantA.accountId,
        membershipId: duplicateMembership.id,
        now,
        organizationId: Number(organizationB.id),
      } },
    );
    await expectMutationFreeOwnershipRefusal(
      schema,
      () => schema.transaction((transaction) =>
        migration._private.assertCleanupOwnership(queryInterface, transaction)),
    );
    await queryInterface.bulkDelete('OnboardingProgresses', {
      membershipId: duplicateMembership.id,
    });
    await queryInterface.bulkDelete('Memberships', { id: duplicateMembership.id });

    await assert.rejects(migration.down(queryInterface, SequelizePackage), /exact active default/);
    assert.equal(await migration._private.classify(queryInterface), 'ready');

    const tenantContextService = require('../../src/services/tenant-context.service');
    const onboardingService = require('../../src/services/onboarding.service');
    const actorA = { id: tenantA.accountId, role: 'owner' };
    const actorB = { id: tenantB.accountId, role: 'owner' };
    const membershipContextA = await tenantContextService.resolveTenantContext({
      accountId: tenantA.accountId,
      organizationId: Number(defaultTenant.organizationId),
      scope: 'membership',
    });
    const membershipContextB = await tenantContextService.resolveTenantContext({
      accountId: tenantB.accountId,
      organizationId: Number(organizationB.id),
      scope: 'membership',
    });
    await onboardingService.completeTask(
      actorA,
      'admin.client.create',
      { role: 'admin' },
      membershipContextA,
    );
    await onboardingService.completeTask(
      actorB,
      'admin.client.create',
      { role: 'admin' },
      membershipContextB,
    );
    const isolatedProgress = await schema.query(
      `SELECT membershipId,COUNT(*) count FROM OnboardingProgresses
       WHERE taskKey='admin.client.create' GROUP BY membershipId ORDER BY membershipId`,
      { type: SequelizePackage.QueryTypes.SELECT },
    );
    assert.deepEqual(isolatedProgress.map((row) => Number(row.count)), [1, 1]);
    await expectTenantDenial(onboardingService.getOverview(
      actorA,
      { role: 'admin' },
      { ...membershipContextA },
    ));
    await schema.query(
      "UPDATE Memberships SET status='inactive' WHERE id=:membershipId",
      { replacements: { membershipId: tenantA.membershipId } },
    );
    await expectTenantDenial(onboardingService.getOverview(
      actorA,
      { role: 'admin' },
      membershipContextA,
    ));
    await expectDatabaseReject(
      schema.query(
        'UPDATE OnboardingProgresses SET updatedAt=NOW() WHERE membershipId=:membershipId',
        { replacements: { membershipId: tenantA.membershipId } },
      ),
      /tenant authority mismatch/,
    );
    await schema.query(
      "UPDATE Memberships SET status='active' WHERE id=:membershipId",
      { replacements: { membershipId: tenantA.membershipId } },
    );

    const clubContextA = await tenantContextService.resolveTenantContext({
      accountId: tenantA.accountId,
      clubId: Number(defaultTenant.clubId),
      organizationId: Number(defaultTenant.organizationId),
      scope: 'club',
    });
    const clubContextB = await tenantContextService.resolveTenantContext({
      accountId: tenantB.accountId,
      clubId: Number(clubB.id),
      organizationId: Number(organizationB.id),
      scope: 'club',
    });
    const overrideTenant = await insertAccountAndMembership(schema, {
      email: 'role-override-onboarding@test.local',
      organizationId: Number(defaultTenant.organizationId),
      role: 'admin',
    });
    await queryInterface.bulkInsert('MembershipClubAccesses', [{
      clubId: Number(defaultTenant.clubId),
      createdAt: now,
      membershipId: overrideTenant.membershipId,
      organizationId: Number(defaultTenant.organizationId),
      roleOverride: 'trainer',
      status: 'active',
      updatedAt: now,
    }]);
    const overrideActor = { id: overrideTenant.accountId, role: 'admin' };
    const trainerContext = await tenantContextService.resolveTenantContext({
      accountId: overrideTenant.accountId,
      clubId: Number(defaultTenant.clubId),
      organizationId: Number(defaultTenant.organizationId),
      scope: 'club',
    });
    assert.equal(trainerContext.membershipRole, 'admin');
    assert.equal(trainerContext.effectiveRole, 'trainer');
    await onboardingService.setTrainingMode(
      overrideActor,
      { isEnabled: true, role: 'trainer' },
      trainerContext,
    );
    const overrideEvent = await onboardingService.recordClientEvent(overrideActor, {
      entityId: 'trainer.client.skill-map-review',
      eventKey: 'trainer.viewed',
      role: 'trainer',
    }, trainerContext);
    assert.equal(overrideEvent.event.role, 'trainer');
    await schema.query(
      `UPDATE MembershipClubAccesses SET roleOverride='viewer'
        WHERE membershipId=:membershipId AND clubId=:clubId`,
      { replacements: {
        clubId: Number(defaultTenant.clubId),
        membershipId: overrideTenant.membershipId,
      } },
    );
    await expectTenantDenial(onboardingService.getOverview(
      overrideActor,
      { role: 'trainer' },
      trainerContext,
    ));
    await expectDatabaseReject(
      schema.query(
        `INSERT INTO OnboardingEvents
          (accountId,organizationId,membershipId,clubId,trainingSessionId,idempotencyKey,
           role,eventKey,entityType,entityId,isTraining,payload,completedTaskKeys,createdAt,updatedAt)
         VALUES (:accountId,:organizationId,:membershipId,:clubId,NULL,'stale-override-event',
           'trainer','trainer.viewed','task','stale-override',0,'{}','[]',NOW(),NOW())`,
        { replacements: {
          accountId: overrideTenant.accountId,
          clubId: Number(defaultTenant.clubId),
          membershipId: overrideTenant.membershipId,
          organizationId: Number(defaultTenant.organizationId),
        } },
      ),
      /tenant authority mismatch/,
    );
    const viewerContext = await tenantContextService.resolveTenantContext({
      accountId: overrideTenant.accountId,
      clubId: Number(defaultTenant.clubId),
      organizationId: Number(defaultTenant.organizationId),
      scope: 'club',
    });
    assert.equal(viewerContext.effectiveRole, 'viewer');
    await onboardingService.cleanupTrainingData(
      overrideActor,
      { role: 'trainer' },
      viewerContext,
    );
    await onboardingService.setTrainingMode(
      overrideActor,
      { isEnabled: true, role: 'viewer' },
      viewerContext,
    );
    await expectTenantDenial(onboardingService.getOverview(
      actorA,
      { role: 'viewer' },
      viewerContext,
    ));
    await onboardingService.setTrainingMode(actorA, { isEnabled: true, role: 'admin' }, clubContextA);
    await onboardingService.setTrainingMode(actorB, { isEnabled: true, role: 'admin' }, clubContextB);
    const markerA = await onboardingService.getTrainingDataMarker(actorA, clubContextA);
    const markerB = await onboardingService.getTrainingDataMarker(actorB, clubContextB);
    assert.ok(markerA.trainingSessionId);
    assert.ok(markerB.trainingSessionId);
    assert.notEqual(markerA.trainingSessionId, markerB.trainingSessionId);
    await db.User.bulkCreate([
      {
        ...markerA,
        name: 'Tenant A training',
        organizationId: Number(defaultTenant.organizationId),
        phone: '+70000000002',
        source: 'test',
        webId: 'tenant-a-training',
      },
      {
        ...markerB,
        name: 'Tenant B training',
        organizationId: Number(organizationB.id),
        phone: '+70000000003',
        source: 'test',
        webId: 'tenant-b-training',
      },
      {
        isTraining: false,
        name: 'Tenant A production',
        organizationId: Number(defaultTenant.organizationId),
        phone: '+70000000004',
        source: 'test',
        webId: 'tenant-a-production',
      },
    ]);
    const trainingUserA = await db.User.findOne({ where: { webId: 'tenant-a-training' } });
    await assert.rejects(
      trainingUserA.update({ trainingSessionId: markerB.trainingSessionId }),
      (error) => /ownership is immutable/.test(String(error?.parent?.sqlMessage || error)),
    );
    await expectDatabaseReject(
      schema.query(
        `UPDATE Users SET trainingRole='viewer' WHERE id=:id`,
        { replacements: { id: trainingUserA.id } },
      ),
      /ownership is immutable/,
    );
    await expectDatabaseReject(
      queryInterface.bulkUpdate(
        'Users',
        { trainingAccountId: tenantB.accountId },
        { id: trainingUserA.id },
      ),
      /ownership is immutable/,
    );
    await expectDatabaseReject(
      db.User.create({
        ...markerA,
        name: 'Cross tenant forged training',
        organizationId: Number(organizationB.id),
        phone: '+70000000005',
        source: 'test',
        webId: 'cross-tenant-forged-training',
      }),
      /session mismatch/,
    );

    const eventA1 = await onboardingService.recordClientEvent(actorA, {
      entityId: 'audit-page',
      eventKey: 'audit.viewed',
      role: 'admin',
    }, clubContextA);
    const eventA2 = await onboardingService.recordClientEvent(actorA, {
      entityId: 'audit-page',
      eventKey: 'audit.viewed',
      role: 'admin',
    }, clubContextA);
    const eventB = await onboardingService.recordClientEvent(actorB, {
      entityId: 'audit-page',
      eventKey: 'audit.viewed',
      role: 'admin',
    }, clubContextB);
    assert.equal(Number(eventA1.event.id), Number(eventA2.event.id));
    assert.notEqual(Number(eventA1.event.id), Number(eventB.event.id));
    assert.deepEqual(eventA2.progressedTaskKeys, []);
    const productionEventA = await onboardingService.recordClientEvent(actorA, {
      entityId: 'audit-production-page',
      eventKey: 'audit.viewed',
      role: 'manager',
    }, clubContextA);
    assert.equal(productionEventA.event.isTraining, false);
    await expectDatabaseReject(
      schema.query(
        'DELETE FROM OnboardingEvents WHERE id=:eventId',
        { replacements: { eventId: productionEventA.event.id } },
      ),
      /Production OnboardingEvent rows are immutable/,
    );
    await expectDatabaseReject(
      schema.query(
        `INSERT INTO OnboardingEvents
          (accountId,organizationId,membershipId,clubId,trainingSessionId,idempotencyKey,
           role,eventKey,entityType,entityId,isTraining,payload,completedTaskKeys,createdAt,updatedAt)
         VALUES
          (:accountId,:organizationId,:membershipId,:clubId,:trainingSessionId,:idempotencyKey,
           'admin','audit.viewed','client','forged-session',1,'{}','[]',NOW(),NOW())`,
        { replacements: {
          accountId: tenantA.accountId,
          clubId: Number(defaultTenant.clubId),
          idempotencyKey: 'forged-session-idempotency',
          membershipId: tenantA.membershipId,
          organizationId: Number(defaultTenant.organizationId),
          trainingSessionId: markerB.trainingSessionId,
        } },
      ),
      /training session mismatch/,
    );

    const cleanup = await onboardingService.cleanupTrainingData(
      actorA,
      { role: 'admin' },
      clubContextA,
    );
    assert.ok(cleanup.deleted.clients >= 1);
    assert.equal(await db.User.count({ where: { webId: 'tenant-a-training' } }), 0);
    assert.equal(await db.User.count({ where: { webId: 'tenant-b-training' } }), 1);
    assert.equal(await db.User.count({ where: { webId: 'tenant-a-production' } }), 1);
    assert.equal(await db.OnboardingEvent.count({ where: { id: productionEventA.event.id } }), 1);
    assert.equal(await db.OnboardingTrainingMode.count({
      where: { membershipId: tenantA.membershipId, sessionId: null },
    }), 1);

    await onboardingService.setTrainingMode(actorA, { isEnabled: true, role: 'admin' }, clubContextA);
    const raceMarker = await onboardingService.getTrainingDataMarker(actorA, clubContextA);
    const writer = await db.sequelize.transaction();
    await db.User.create({
      ...raceMarker,
      name: 'Cleanup race artifact',
      organizationId: Number(defaultTenant.organizationId),
      phone: '+70000000006',
      source: 'test',
      webId: 'cleanup-race-artifact',
    }, { transaction: writer });
    let cleanupSettled = false;
    const racedCleanup = onboardingService.cleanupTrainingData(
      actorA,
      { role: 'admin' },
      clubContextA,
    ).finally(() => { cleanupSettled = true; });
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(cleanupSettled, false, 'cleanup must wait for the writer session lease');
    await writer.commit();
    await racedCleanup;
    assert.equal(await db.User.count({ where: { webId: 'cleanup-race-artifact' } }), 0);

    await assert.rejects(
      accountSeederAdapter.runInitializedSeederBatch(
        queryInterface,
        async () => null,
      ),
      (error) => ['TENANT_SEEDER_DEFAULT_ONLY', 'TENANT_FOUNDATION_STATE_INVALID']
        .includes(error.code),
    );
    await assert.rejects(
      performanceFixture._private.resolveFixtureContext(),
      (error) => error.name === 'TenantFoundationStateError',
    );
    for (const seeder of [bulkReceiptSeeder, demoCrmSeeder, demoBookingSeeder]) {
      await assert.rejects(
        seeder.up(queryInterface, SequelizePackage),
        (error) => error.code === 'TENANT_SEEDER_DEFAULT_ONLY',
      );
    }
    await schema.query(
      'DELETE FROM Memberships WHERE id=:membershipId',
      { replacements: { membershipId: tenantB.membershipId } },
    );
    for (const table of [
      'OnboardingProgresses',
      'OnboardingTrainingModes',
      'OnboardingEvents',
    ]) {
      assert.equal(Number((await selectOne(
        schema,
        `SELECT COUNT(*) count FROM ${table} WHERE membershipId=:membershipId`,
        { membershipId: tenantB.membershipId },
      )).count), 0);
    }
  } finally {
    delete process.env.TENANT_ONBOARDING_MIGRATION_FAIL_STEP;
    if (db?.sequelize) await db.sequelize.close();
    if (schema) await schema.close();
    await admin.query(`DROP DATABASE IF EXISTS \`${database}\``);
    await admin.end();
    restoreEnv(previous);
  }
});
