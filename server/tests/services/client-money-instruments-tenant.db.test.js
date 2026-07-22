'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const mysql = require('mysql2/promise');
const SequelizePackage = require('sequelize');
const {
  ACCEPTED_TENANT_CAPABILITY_ENV,
  applyAcceptedTenantMigrations,
} = require('../helpers/accepted-tenant-schema');
const xlsx = require('xlsx');
const {
  DEFAULT_CLUB_SLUG,
  DEFAULT_ORGANIZATION_SLUG,
} = require('../../src/tenant-foundation/constants');

const SERVER_ROOT = path.resolve(__dirname, '../..');
const FEATURE_MIGRATION_FILE =
  '20260719120000-add-tenant-finance-prepayments-wave.js';
const BIRTH_DATE_MIGRATION_FILE =
  '20260721100000-add-client-birth-date.js';
const CAPABILITY_ENV = ACCEPTED_TENANT_CAPABILITY_ENV;

function databaseName() {
  return process.env.CLIENT_MONEY_TEST_DB_NAME ||
    `setly_client_money_f7_1_${process.pid}_${Date.now()}`;
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

async function captureCleanupPlan(queryInterface, migration, removedLegacyUnique) {
  const capture = async (kind, items) => Promise.all(items.map(async (item) => {
    const rows = await migration.__testing.readArtifact(
      queryInterface,
      kind,
      item,
    );
    assert.ok(rows.length > 0, `missing ${kind} ${item.table}.${item.name}`);
    return {
      ...item,
      signature: migration.__testing.artifactSignature(kind, rows),
    };
  }));
  return {
    column: await capture('column', migration.__testing.COLUMNS.map((item) => ({
      name: item.column,
      table: item.table,
    }))),
    foreignKey: await capture(
      'foreignKey',
      Object.entries(migration.__testing.FOREIGN_KEYS).map(([name, item]) => ({
        name,
        table: item.table,
      })),
    ),
    index: await capture(
      'index',
      Object.entries(migration.__testing.INDEXES).map(([name, item]) => ({
        name,
        table: item.table,
      })),
    ),
    removedLegacyUnique,
    trigger: await capture(
      'trigger',
      Object.entries(migration.__testing.TRIGGERS).map(([name, item]) => ({
        name,
        table: item.table,
      })),
    ),
  };
}

async function snapshotCleanupState(sequelize, migration) {
  const schemaQueries = {
    columns: `SELECT TABLE_NAME,COLUMN_NAME,ORDINAL_POSITION,COLUMN_TYPE,
      IS_NULLABLE,COLUMN_DEFAULT,EXTRA,CHARACTER_SET_NAME,COLLATION_NAME,
      COLUMN_COMMENT,GENERATION_EXPRESSION
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA=DATABASE()
      ORDER BY TABLE_NAME,ORDINAL_POSITION`,
    foreignKeys: `SELECT k.TABLE_NAME,k.CONSTRAINT_NAME,k.COLUMN_NAME,
      k.REFERENCED_TABLE_NAME,k.REFERENCED_COLUMN_NAME,
      r.UPDATE_RULE,r.DELETE_RULE
      FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE k
      JOIN INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS r
        ON r.CONSTRAINT_SCHEMA=k.CONSTRAINT_SCHEMA
       AND r.TABLE_NAME=k.TABLE_NAME
       AND r.CONSTRAINT_NAME=k.CONSTRAINT_NAME
      WHERE k.CONSTRAINT_SCHEMA=DATABASE()
      ORDER BY k.TABLE_NAME,k.CONSTRAINT_NAME,k.ORDINAL_POSITION`,
    indexes: `SELECT TABLE_NAME,INDEX_NAME,NON_UNIQUE,SEQ_IN_INDEX,COLUMN_NAME,
      SUB_PART,COLLATION,INDEX_TYPE
      FROM INFORMATION_SCHEMA.STATISTICS
      WHERE TABLE_SCHEMA=DATABASE()
      ORDER BY TABLE_NAME,INDEX_NAME,SEQ_IN_INDEX`,
    triggers: `SELECT TRIGGER_NAME,EVENT_OBJECT_TABLE,EVENT_MANIPULATION,
      ACTION_TIMING,ACTION_STATEMENT
      FROM INFORMATION_SCHEMA.TRIGGERS
      WHERE TRIGGER_SCHEMA=DATABASE()
      ORDER BY TRIGGER_NAME`,
  };
  const informationSchema = {};
  for (const [key, sql] of Object.entries(schemaQueries)) {
    informationSchema[key] = await sequelize.query(sql, {
      type: SequelizePackage.QueryTypes.SELECT,
    });
  }
  const businessTables = [
    'Organizations',
    'Clubs',
    ...new Set(migration.__testing.COLUMNS.map((item) => item.table)),
  ];
  const [checksums] = await sequelize.query(
    `CHECKSUM TABLE ${businessTables.map((table) => `\`${table}\``).join(',')} EXTENDED`,
  );
  return JSON.stringify({ checksums, informationSchema });
}

async function assertCleanupRefusalPreserves(
  sequelize,
  queryInterface,
  migration,
  cleanupPlan,
) {
  const before = await snapshotCleanupState(sequelize, migration);
  await assert.rejects(
    migration.__testing.cleanupInvocation(queryInterface, cleanupPlan),
    (error) =>
      error.code === 'TENANT_CLIENT_MONEY_CLEANUP_OWNERSHIP_LOST' &&
      /operator repair/.test(error.message),
  );
  assert.equal(await snapshotCleanupState(sequelize, migration), before);
}

async function assertTrackedArtifact(
  queryInterface,
  migration,
  kind,
  tracked,
) {
  const rows = await migration.__testing.readArtifact(
    queryInterface,
    kind,
    tracked,
  );
  assert.equal(
    migration.__testing.artifactSignature(kind, rows),
    tracked.signature,
  );
}

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

test('Feature 7.1 migration and client-money two-Organization/two-Club isolation', async () => {
  assert.ok(process.env.DB_USER, 'DB_USER is required for DB-backed tenant tests');
  const database = databaseName();
  const previous = Object.fromEntries([
    ...CAPABILITY_ENV,
    'CLIENT_MONEY_TEST_DB_NAME',
    'DB_NAME',
    'NODE_ENV',
    'TENANT_CLIENT_MONEY_MIGRATION_FAIL_STEP',
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

  let schema;
  let db;
  try {
    schema = await createSchemaBeforeFeature(database);
    const queryInterface = schema.getQueryInterface();
    const migration = require(`../../migrations/${FEATURE_MIGRATION_FILE}`);
    assert.deepEqual(
      await migration.__testing.classifyState(queryInterface),
      { reasons: [], state: 'legacy' },
    );

    const legacyTypes = JSON.stringify(await schema.query(
      'SELECT id,name,status FROM SubscriptionTypes ORDER BY id',
      { type: SequelizePackage.QueryTypes.SELECT },
    ));
    await queryInterface.addColumn('Certificates', 'clubId', {
      allowNull: true,
      type: SequelizePackage.STRING,
    });
    await assert.rejects(
      migration.up(queryInterface, SequelizePackage),
      /refused partial schema/,
    );
    assert.equal(JSON.stringify(await schema.query(
      'SELECT id,name,status FROM SubscriptionTypes ORDER BY id',
      { type: SequelizePackage.QueryTypes.SELECT },
    )), legacyTypes);
    assert.equal(
      Boolean((await queryInterface.describeTable('ClientSubscriptions')).clubId),
      false,
    );
    await queryInterface.removeColumn('Certificates', 'clubId');

    for (const forcedStage of [
      'after_columns',
      'after_backfill',
      'after_constraints',
      'after_triggers',
      'after_legacy_unique_drop',
    ]) {
      process.env.TENANT_CLIENT_MONEY_MIGRATION_FAIL_STEP = forcedStage;
      await assert.rejects(
        migration.up(queryInterface, SequelizePackage),
        (error) => error.code === 'TENANT_CLIENT_MONEY_MIGRATION_FORCED_FAILURE',
      );
      delete process.env.TENANT_CLIENT_MONEY_MIGRATION_FAIL_STEP;
      assert.equal((await migration.__testing.classifyState(queryInterface)).state, 'legacy');
    }

    const removedLegacyUnique = await Promise.all(
      migration.__testing.LEGACY_UNIQUES.map((item) =>
        migration.__testing.captureRemovedLegacyUnique(queryInterface, item)),
    );
    await migration.up(queryInterface, SequelizePackage);
    assert.equal((await migration.__testing.classifyState(queryInterface)).state, 'ready');
    const cleanupPlan = await captureCleanupPlan(
      queryInterface,
      migration,
      removedLegacyUnique,
    );

    const changedColumn = cleanupPlan.column.find((item) =>
      item.table === 'Finances' && item.name === 'organizationId');
    await schema.query(
      "ALTER TABLE `Finances` MODIFY COLUMN `organizationId` INT NULL COMMENT 'ownership loss'",
    );
    await assertCleanupRefusalPreserves(
      schema,
      queryInterface,
      migration,
      cleanupPlan,
    );
    await schema.query(
      "ALTER TABLE `Finances` MODIFY COLUMN `organizationId` INT NULL COMMENT ''",
    );
    await assertTrackedArtifact(
      queryInterface,
      migration,
      'column',
      changedColumn,
    );

    const changedIndex = cleanupPlan.index.find((item) =>
      item.name === 'certificates_club_client_status_expires_idx');
    await queryInterface.removeIndex(changedIndex.table, changedIndex.name);
    await queryInterface.addIndex(
      changedIndex.table,
      ['clubId', 'status', 'clientId', 'expiresAt'],
      { name: changedIndex.name },
    );
    await assertCleanupRefusalPreserves(
      schema,
      queryInterface,
      migration,
      cleanupPlan,
    );
    await queryInterface.removeIndex(changedIndex.table, changedIndex.name);
    await queryInterface.addIndex(
      changedIndex.table,
      migration.__testing.INDEXES[changedIndex.name].columns,
      { name: changedIndex.name },
    );
    await assertTrackedArtifact(
      queryInterface,
      migration,
      'index',
      changedIndex,
    );

    const changedForeignKey = cleanupPlan.foreignKey.find((item) =>
      item.name === 'finances_organization_fk');
    const foreignKeyDefinition =
      migration.__testing.FOREIGN_KEYS[changedForeignKey.name];
    const addFinanceOrganizationForeignKey = (onDelete) =>
      queryInterface.addConstraint(changedForeignKey.table, {
        fields: [foreignKeyDefinition.column],
        name: changedForeignKey.name,
        onDelete,
        onUpdate: foreignKeyDefinition.onUpdate,
        references: {
          field: foreignKeyDefinition.referencedColumn,
          table: foreignKeyDefinition.referencedTable,
        },
        type: 'foreign key',
      });
    await queryInterface.removeConstraint(
      changedForeignKey.table,
      changedForeignKey.name,
    );
    await addFinanceOrganizationForeignKey('CASCADE');
    await assertCleanupRefusalPreserves(
      schema,
      queryInterface,
      migration,
      cleanupPlan,
    );
    await queryInterface.removeConstraint(
      changedForeignKey.table,
      changedForeignKey.name,
    );
    await addFinanceOrganizationForeignKey(foreignKeyDefinition.onDelete);
    await assertTrackedArtifact(
      queryInterface,
      migration,
      'foreignKey',
      changedForeignKey,
    );

    const legacyNameCollision = removedLegacyUnique.find((item) =>
      item.table === 'EvotorSaleSettings' && item.name === 'itemName');
    await queryInterface.addIndex(
      legacyNameCollision.table,
      ['saleIntent'],
      { name: legacyNameCollision.name },
    );
    await assertCleanupRefusalPreserves(
      schema,
      queryInterface,
      migration,
      cleanupPlan,
    );
    await queryInterface.removeIndex(
      legacyNameCollision.table,
      legacyNameCollision.name,
    );

    const changedTrigger = cleanupPlan.trigger.find((item) =>
      item.name === 'evotor_sale_settings_tenant_bi');
    const triggerDefinition = migration.__testing.TRIGGERS[changedTrigger.name];
    const restorationConflict = removedLegacyUnique.find((item) =>
      item.table === 'SubscriptionTypes' &&
      item.name === 'subscription_types_name_unique');
    await schema.query(`DROP TRIGGER \`${changedTrigger.name}\``);
    await schema.query(
      `CREATE TRIGGER \`${changedTrigger.name}\` BEFORE INSERT ON ` +
        `\`${triggerDefinition.table}\` FOR EACH ROW BEGIN SET @ownership_loss=1; END`,
    );
    await queryInterface.addIndex(
      restorationConflict.table,
      ['status'],
      { name: restorationConflict.name },
    );
    await assertCleanupRefusalPreserves(
      schema,
      queryInterface,
      migration,
      cleanupPlan,
    );
    await queryInterface.removeIndex(
      restorationConflict.table,
      restorationConflict.name,
    );
    await schema.query(`DROP TRIGGER \`${changedTrigger.name}\``);
    await schema.query(
      `CREATE TRIGGER \`${changedTrigger.name}\` BEFORE ` +
        `${triggerDefinition.event} ON \`${triggerDefinition.table}\` FOR EACH ROW ` +
        triggerDefinition.body,
    );
    await assertTrackedArtifact(
      queryInterface,
      migration,
      'trigger',
      changedTrigger,
    );

    const defaultTenant = await selectOne(schema, `
      SELECT o.id AS organizationId,c.id AS clubId
      FROM Organizations o JOIN Clubs c ON c.organizationId=o.id
      WHERE o.slug=:organizationSlug AND c.slug=:clubSlug
    `, {
      clubSlug: DEFAULT_CLUB_SLUG,
      organizationSlug: DEFAULT_ORGANIZATION_SLUG,
    });
    const duplicateSuffix = `${process.pid}-${Date.now()}`;
    const duplicateNow = new Date();
    await queryInterface.bulkInsert('Clubs', [{
      createdAt: duplicateNow,
      name: 'Feature 7.1 cleanup duplicate club',
      organizationId: defaultTenant.organizationId,
      slug: `feature-7-1-cleanup-${duplicateSuffix}`,
      status: 'active',
      timezone: 'Europe/Moscow',
      updatedAt: duplicateNow,
    }]);
    const duplicateClub = await selectOne(
      schema,
      'SELECT id FROM Clubs WHERE organizationId=:organizationId AND slug=:slug',
      {
        organizationId: defaultTenant.organizationId,
        slug: `feature-7-1-cleanup-${duplicateSuffix}`,
      },
    );
    const duplicateItemName = `Feature 7.1 duplicate ${duplicateSuffix}`;
    await queryInterface.bulkInsert('EvotorSaleSettings', [
      {
        clubId: defaultTenant.clubId,
        createdAt: duplicateNow,
        itemName: duplicateItemName,
        organizationId: defaultTenant.organizationId,
        saleIntent: 'normal',
        updatedAt: duplicateNow,
      },
      {
        clubId: duplicateClub.id,
        createdAt: duplicateNow,
        itemName: duplicateItemName,
        organizationId: defaultTenant.organizationId,
        saleIntent: 'normal',
        updatedAt: duplicateNow,
      },
    ]);
    assert.equal(
      await migration.__testing.legacyUniqueHasDuplicates(
        queryInterface,
        legacyNameCollision,
      ),
      true,
    );
    await assertCleanupRefusalPreserves(
      schema,
      queryInterface,
      migration,
      cleanupPlan,
    );
    await queryInterface.bulkDelete(
      'EvotorSaleSettings',
      { itemName: duplicateItemName },
    );
    await queryInterface.bulkDelete('Clubs', { id: duplicateClub.id });

    await migration.__testing.cleanupInvocation(queryInterface, cleanupPlan);
    assert.equal((await migration.__testing.classifyState(queryInterface)).state, 'legacy');
    for (const item of removedLegacyUnique) {
      await assertTrackedArtifact(
        queryInterface,
        migration,
        'index',
        item,
      );
    }
    assert.equal(JSON.stringify(await schema.query(
      'SELECT id,name,status FROM SubscriptionTypes ORDER BY id',
      { type: SequelizePackage.QueryTypes.SELECT },
    )), legacyTypes);

    await migration.up(queryInterface, SequelizePackage);
    assert.equal((await migration.__testing.classifyState(queryInterface)).state, 'ready');
    await migration.up(queryInterface, SequelizePackage);
    assert.equal(JSON.stringify(await schema.query(
      'SELECT id,name,status FROM SubscriptionTypes ORDER BY id',
      { type: SequelizePackage.QueryTypes.SELECT },
    )), legacyTypes);
    await migration.down(queryInterface, SequelizePackage);
    assert.equal((await migration.__testing.classifyState(queryInterface)).state, 'legacy');
    await migration.up(queryInterface, SequelizePackage);
    assert.equal((await migration.__testing.classifyState(queryInterface)).state, 'ready');

    await applyAcceptedTenantMigrations(queryInterface, {
      afterFile: FEATURE_MIGRATION_FILE,
    });
    await applyTrackedMigration(queryInterface, BIRTH_DATE_MIGRATION_FILE);
    assert.ok(
      (await queryInterface.describeTable('Users')).birthDate,
      'production-like schema must include Users.birthDate before current models load',
    );

    db = require('../../models');
    const tenantContextService = require('../../src/services/tenant-context.service');
    const subscriptionsService = require('../../src/services/subscriptions.service');
    const certificatesService = require('../../src/services/certificates.service');
    const corporateClientsService = require('../../src/services/corporate-clients.service');
    const pendingSaleService = require('../../src/services/pending-sale.service');
    const prepaymentsDashboardService = require(
      '../../src/services/prepayments-dashboard.service'
    );
    const onboardingService = require('../../src/services/onboarding.service');

    const organizationA = await db.Organization.findOne({
      where: { slug: DEFAULT_ORGANIZATION_SLUG },
    });
    const clubA = await db.Club.findOne({
      where: { organizationId: organizationA.id, slug: DEFAULT_CLUB_SLUG },
    });
    const siblingClubA = await db.Club.create({
      name: 'Feature 7.1 sibling club',
      organizationId: organizationA.id,
      slug: `feature-7-1-sibling-${Date.now()}`,
      status: 'active',
      timezone: 'Europe/Moscow',
    });
    const organizationB = await db.Organization.create({
      name: 'Feature 7.1 Organization B',
      slug: `feature-7-1-org-b-${Date.now()}`,
      status: 'active',
    });
    const clubB = await db.Club.create({
      name: 'Feature 7.1 Club B',
      organizationId: organizationB.id,
      slug: `feature-7-1-club-b-${Date.now()}`,
      status: 'active',
      timezone: 'Europe/Moscow',
    });
    const ownerA = await db.Account.create({
      email: `feature-7-1-owner-a-${Date.now()}@example.test`,
      passwordHash: 'test-only',
      role: 'owner',
      status: 'active',
    });
    const ownerB = await db.Account.create({
      email: `feature-7-1-owner-b-${Date.now()}@example.test`,
      passwordHash: 'test-only',
      role: 'owner',
      status: 'active',
    });
    const membershipA = await db.Membership.create({
      accountId: ownerA.id,
      organizationId: organizationA.id,
      role: 'owner',
      status: 'active',
    });
    await db.Membership.create({
      accountId: ownerB.id,
      organizationId: organizationB.id,
      role: 'owner',
      status: 'active',
    });
    const actorA = { id: ownerA.id, role: 'owner' };
    const actorB = { id: ownerB.id, role: 'owner' };
    const organizationTenantA = await tenantContextService.resolveTenantContext({
      accountId: ownerA.id,
      organizationId: organizationA.id,
      scope: 'organization',
    });
    const organizationTenantB = await tenantContextService.resolveTenantContext({
      accountId: ownerB.id,
      organizationId: organizationB.id,
      scope: 'organization',
    });
    const tenantA = await tenantContextService.resolveTenantContext({
      accountId: ownerA.id,
      clubId: clubA.id,
      organizationId: organizationA.id,
      scope: 'club',
    });
    const tenantSiblingA = await tenantContextService.resolveTenantContext({
      accountId: ownerA.id,
      clubId: siblingClubA.id,
      organizationId: organizationA.id,
      scope: 'club',
    });
    const tenantB = await tenantContextService.resolveTenantContext({
      accountId: ownerB.id,
      clubId: clubB.id,
      organizationId: organizationB.id,
      scope: 'club',
    });
    const sharedPhone = `+79997${String(Date.now()).slice(-6)}`;
    const clientA = await db.User.create({
      name: 'Feature 7.1 Client',
      organizationId: organizationA.id,
      phone: sharedPhone,
      phoneNormalized: sharedPhone.replace(/\D/g, ''),
      source: 'Feature 7.1',
      status: 'active',
      webId: `feature-7-1-client-a-${Date.now()}`,
    });
    const clientB = await db.User.create({
      name: 'Feature 7.1 Client',
      organizationId: organizationB.id,
      phone: sharedPhone,
      phoneNormalized: sharedPhone.replace(/\D/g, ''),
      source: 'Feature 7.1',
      status: 'active',
      webId: `feature-7-1-client-b-${Date.now()}`,
    });

    const sharedTypeName = `Feature 7.1 shared ${Date.now()}`;
    const typeA = await subscriptionsService.createSubscriptionType({
      name: sharedTypeName,
      sessionsTotal: 8,
      price: 8000,
    }, actorA, organizationTenantA);
    const typeB = await subscriptionsService.createSubscriptionType({
      name: sharedTypeName,
      sessionsTotal: 8,
      price: 8000,
    }, actorB, organizationTenantB);
    assert.notEqual(typeA.id, typeB.id);
    assert.equal(
      (await subscriptionsService.listSubscriptionTypes({}, organizationTenantA))
        .some((type) => type.id === typeB.id),
      false,
    );

    const subscriptionA = await db.ClientSubscription.create({
      organizationId: organizationA.id,
      clubId: clubA.id,
      clientId: clientA.id,
      subscriptionTypeId: typeA.id,
      source: 'manual',
      typeName: sharedTypeName,
      serviceType: 'training',
      sessionsTotal: 8,
      sessionsUsed: 0,
      startsAt: new Date('2099-01-01T00:00:00.000Z'),
      expiresAt: new Date('2099-12-31T00:00:00.000Z'),
      status: 'active',
    });
    const unlimitedB = await db.ClientSubscription.create({
      organizationId: organizationB.id,
      clubId: clubB.id,
      clientId: clientB.id,
      subscriptionTypeId: typeB.id,
      source: 'manual',
      typeName: sharedTypeName,
      serviceType: 'training',
      sessionsTotal: null,
      sessionsUsed: 0,
      isUnlimited: true,
      startsAt: new Date('2099-01-01T00:00:00.000Z'),
      expiresAt: new Date('2099-12-31T00:00:00.000Z'),
      status: 'active',
    });
    assert.deepEqual(
      (await subscriptionsService.listClientSubscriptions(clientA.id, {}, tenantA))
        .map((subscription) => subscription.id),
      [subscriptionA.id],
    );
    await assert.rejects(
      subscriptionsService.getClientSubscription(unlimitedB.id, tenantA),
      /Абонемент клиента не найден/,
    );
    const unlimitedResult = await subscriptionsService.redeemClientSubscription(
      unlimitedB.id,
      { quantity: 25 },
      actorB,
      tenantB,
    );
    assert.equal(unlimitedResult.subscription.sessionsUsed, 25);
    assert.equal(unlimitedResult.subscription.status, 'active');

    const sharedCode = `F71-${Date.now()}`;
    const certificateA = await db.Certificate.create({
      organizationId: organizationA.id,
      clubId: clubA.id,
      clientId: clientA.id,
      code: sharedCode,
      source: 'manual',
      certificateType: 'money',
      title: 'Feature 7.1 money',
      amountTotal: 100,
      amountUsed: 0,
      startsAt: new Date('2099-01-01T00:00:00.000Z'),
      expiresAt: new Date('2099-12-31T00:00:00.000Z'),
      status: 'active',
    });
    const siblingCertificate = await db.Certificate.create({
      organizationId: organizationA.id,
      clubId: siblingClubA.id,
      clientId: clientA.id,
      code: sharedCode,
      source: 'manual',
      certificateType: 'service',
      title: 'Feature 7.1 service',
      serviceType: 'training',
      serviceName: 'Training',
      unitsTotal: 2,
      startsAt: new Date('2099-01-01T00:00:00.000Z'),
      expiresAt: new Date('2099-12-31T00:00:00.000Z'),
      status: 'active',
    });
    const certificateB = await db.Certificate.create({
      organizationId: organizationB.id,
      clubId: clubB.id,
      clientId: clientB.id,
      code: sharedCode,
      source: 'manual',
      certificateType: 'money',
      title: 'Feature 7.1 money',
      amountTotal: 100,
      amountUsed: 0,
      startsAt: new Date('2099-01-01T00:00:00.000Z'),
      expiresAt: new Date('2099-12-31T00:00:00.000Z'),
      status: 'active',
    });
    assert.deepEqual(
      (await certificatesService.listClientCertificates(clientA.id, {}, tenantA))
        .map((certificate) => certificate.id),
      [certificateA.id],
    );
    assert.deepEqual(
      (await certificatesService.listClientCertificates(clientA.id, {}, tenantSiblingA))
        .map((certificate) => certificate.id),
      [siblingCertificate.id],
    );
    await assert.rejects(
      certificatesService.redeemCertificate(certificateB.id, { amount: 1 }, actorA, tenantA),
      /Сертификат не найден/,
    );

    const concurrentRedemptions = await Promise.allSettled([
      certificatesService.redeemCertificate(
        certificateA.id,
        { amount: 60, comment: 'race-a' },
        actorA,
        tenantA,
      ),
      certificatesService.redeemCertificate(
        certificateA.id,
        { amount: 60, comment: 'race-b' },
        actorA,
        tenantA,
      ),
    ]);
    assert.equal(concurrentRedemptions.filter((result) => result.status === 'fulfilled').length, 1);
    assert.equal(concurrentRedemptions.filter((result) => result.status === 'rejected').length, 1);
    assert.equal(Number((await certificateA.reload()).amountUsed), 60);

    await pendingSaleService.saveSaleSetting({
      itemName: 'Feature 7.1 same POS item',
      saleIntent: 'certificate',
    }, actorA, tenantA);
    await pendingSaleService.saveSaleSetting({
      itemName: 'Feature 7.1 same POS item',
      saleIntent: 'certificate',
    }, actorB, tenantB);
    assert.equal((await pendingSaleService.getSaleSettings(tenantA)).length, 1);
    assert.equal((await pendingSaleService.getSaleSettings(tenantB)).length, 1);
    async function createPendingReceipt(
      organizationId,
      clubId,
      tenant,
      suffix,
    ) {
      const receipt = await db.Receipt.create({
        organizationId,
        clubId,
        dateTime: new Date('2099-01-15T10:00:00.000Z'),
        evotorId: `feature-7-1-${suffix}-${Date.now()}`,
        totalAmount: 100,
        type: 'SELL',
      });
      await db.ReceiptItem.create({
        name: 'Feature 7.1 same POS item',
        price: 100,
        quantity: 1,
        receiptId: receipt.id,
        sum: 100,
        sumPrice: 100,
      });
      const first = await pendingSaleService.createPendingSalesForReceipt(
        receipt.id,
        { tenant },
      );
      const replay = await pendingSaleService.createPendingSalesForReceipt(
        receipt.id,
        { tenant },
      );
      assert.equal(first.created, 1);
      assert.equal(replay.created, 0);
      return first.items[0].id;
    }
    const pendingAId = await createPendingReceipt(
      organizationA.id,
      clubA.id,
      tenantA,
      'a',
    );
    const pendingBId = await createPendingReceipt(
      organizationB.id,
      clubB.id,
      tenantB,
      'b',
    );
    const queueA = await pendingSaleService.listPendingSales(
      { status: 'all' },
      tenantA,
    );
    assert.equal(queueA.some((sale) => sale.id === pendingAId), true);
    assert.equal(queueA.some((sale) => sale.id === pendingBId), false);
    assert.equal(
      await db.PendingSaleHistory.count({
        where: {
          clubId: clubA.id,
          organizationId: organizationA.id,
          pendingSaleId: pendingAId,
        },
      }),
      1,
    );

    const corporateA = await corporateClientsService.createCorporateClient(
      { name: 'Feature 7.1 Corporate' },
      actorA,
      tenantA,
    );
    const corporateB = await corporateClientsService.createCorporateClient(
      { name: 'Feature 7.1 Corporate' },
      actorB,
      tenantB,
    );
    const incomeCategory = await db.Category.create({
      isActive: true,
      name: `Feature 7.1 income ${Date.now()}`,
      type: 'income',
    });
    await corporateClientsService.createDeposit(corporateA.id, {
      amount: 500,
      category: incomeCategory.name,
      date: '2099-02-01',
    }, actorA, tenantA);
    await corporateClientsService.createDeposit(corporateB.id, {
      amount: 900,
      category: incomeCategory.name,
      date: '2099-02-01',
    }, actorB, tenantB);
    const ledgerA = await corporateClientsService.getLedgerDetails(
      corporateA.id,
      {},
      actorA,
      tenantA,
    );
    assert.equal(ledgerA.summary.endingBalance, 500);
    await assert.rejects(
      corporateClientsService.exportLedgerDetails(corporateB.id, {}, actorA, tenantA),
      /Корпоративный клиент не найден/,
    );
    const exportA = await corporateClientsService.exportLedgerDetails(
      corporateA.id,
      {},
      actorA,
      tenantA,
    );
    const workbookA = xlsx.read(exportA.buffer, { type: 'buffer' });
    const exportedA = xlsx.utils.sheet_to_json(workbookA.Sheets['Детализация']);
    assert.equal(exportedA.length, 1);
    assert.equal(exportedA[0]['Сумма'], 500);

    const dashboardA = await prepaymentsDashboardService.getDashboard(
      { status: 'all' },
      actorA,
      tenantA,
    );
    assert.equal(
      dashboardA.sections.certificates.items.some((item) => item.id === certificateB.id),
      false,
    );
    assert.equal(
      dashboardA.sections.subscriptions.items.some((item) => item.id === unlimitedB.id),
      false,
    );
    assert.equal(
      dashboardA.sections.corporateBalances.items.some((item) => item.id === corporateB.id),
      false,
    );
    assert.equal(
      dashboardA.sections.pendingSales.items.some((item) => item.id === pendingBId),
      false,
    );

    await expectDatabaseReject(
      db.sequelize.query(
        'UPDATE Certificates SET clubId=:clubId WHERE id=:id',
        { replacements: { clubId: siblingClubA.id, id: certificateA.id } },
      ),
      /tenant attribution is immutable/,
    );
    await expectDatabaseReject(
      db.sequelize.query(`
        INSERT INTO CertificateRedemptions
          (organizationId,clubId,certificateId,clientId,amount,redeemedAt,status,createdAt,updatedAt)
        VALUES (:organizationId,:clubId,:certificateId,:clientId,1,NOW(),'active',NOW(),NOW())
      `, {
        replacements: {
          certificateId: certificateA.id,
          clientId: clientA.id,
          clubId: clubB.id,
          organizationId: organizationB.id,
        },
      }),
      /parent tenant mismatch/,
    );
    await assert.rejects(
      db.Certificate.create({
        clientId: clientA.id,
        code: `MISSING-${Date.now()}`,
        source: 'manual',
        title: 'Missing tenant',
        startsAt: new Date(),
      }),
      (error) => error.code === 'TENANT_CONTEXT_REQUIRED',
    );

    await onboardingService.setTrainingMode(
      actorA,
      { isEnabled: true, role: 'owner' },
      tenantA,
    );
    await onboardingService.setTrainingMode(
      actorB,
      { isEnabled: true, role: 'owner' },
      tenantB,
    );
    const trainingMarkerA = await onboardingService.getTrainingDataMarker(actorA, tenantA);
    const trainingMarkerB = await onboardingService.getTrainingDataMarker(actorB, tenantB);
    const trainingCorporateA = await db.CorporateClient.create({
      organizationId: organizationA.id,
      name: 'Feature 7.1 training A',
      ...trainingMarkerA,
    });
    const trainingCorporateB = await db.CorporateClient.create({
      organizationId: organizationB.id,
      name: 'Feature 7.1 training B',
      ...trainingMarkerB,
    });
    await db.CorporateLedgerEntry.create({
      organizationId: organizationA.id,
      clubId: clubA.id,
      corporateClientId: trainingCorporateA.id,
      type: 'spending',
      date: '2099-03-01',
      amount: 1,
      ...trainingMarkerA,
    });
    const trainingLedgerB = await db.CorporateLedgerEntry.create({
      organizationId: organizationB.id,
      clubId: clubB.id,
      corporateClientId: trainingCorporateB.id,
      type: 'spending',
      date: '2099-03-01',
      amount: 1,
      ...trainingMarkerB,
    });
    await onboardingService.cleanupTrainingData(actorA, { role: 'owner' }, tenantA);
    assert.equal(await db.CorporateClient.count({ where: { id: trainingCorporateA.id } }), 0);
    assert.equal(await db.CorporateClient.count({ where: { id: trainingCorporateB.id } }), 1);
    assert.equal(await db.CorporateLedgerEntry.count({ where: { id: trainingLedgerB.id } }), 1);

    process.env.TENANT_CLIENT_MONEY_INSTRUMENTS_ENABLED = 'false';
    await assert.rejects(
      subscriptionsService.createSubscriptionType({
        name: `Feature 7.1 flag off ${Date.now()}`,
        sessionsTotal: 1,
        price: 1,
      }, null, tenantB),
      (error) => error.code === 'TENANT_SINGLE_DEFAULT_REQUIRED',
    );
    process.env.TENANT_CLIENT_MONEY_INSTRUMENTS_ENABLED = 'true';

    await assert.rejects(
      migration.down(queryInterface, SequelizePackage),
      (error) => error.code === 'TENANT_CLIENT_MONEY_ROLLBACK_SECOND_ORGANIZATION',
    );
    assert.equal((await migration.__testing.classifyState(queryInterface)).state, 'ready');

    await membershipA.update({ status: 'inactive' });
    await assert.rejects(
      certificatesService.listCertificates({}, tenantA),
      (error) => error.code === 'TENANT_CONTEXT_NOT_FOUND',
    );
  } finally {
    if (db?.sequelize) await db.sequelize.close();
    if (schema) await schema.close();
    await admin.query(`DROP DATABASE IF EXISTS \`${database}\``);
    await admin.end();
    restoreEnv(previous);
  }
});
