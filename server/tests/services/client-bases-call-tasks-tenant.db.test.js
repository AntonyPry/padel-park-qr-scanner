'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const mysql = require('mysql2/promise');
const SequelizePackage = require('sequelize');
const {
  ACCEPTED_TENANT_CAPABILITY_ENV,
  applyAcceptedTenantMigrations,
} = require('../helpers/accepted-tenant-schema');
const {
  DEFAULT_CLUB_SLUG,
  DEFAULT_ORGANIZATION_SLUG,
} = require('../../src/tenant-foundation/constants');

const SERVER_ROOT = path.resolve(__dirname, '../..');
const FEATURE_MIGRATION_FILE =
  '20260717100000-add-tenant-client-bases-call-tasks.js';
const CAPABILITY_ENV = ACCEPTED_TENANT_CAPABILITY_ENV;

function databaseName() {
  return process.env.CLIENT_BASES_CALL_TASKS_TEST_DB_NAME ||
    `setly_client_bases_call_tasks_f5_4_${process.pid}_${Date.now()}`;
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
    .filter(
      (file) =>
        file.endsWith('.js') && file < FEATURE_MIGRATION_FILE,
    )
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

async function snapshotMigrationInvariants(sequelize) {
  const schema = {};
  const queries = {
    columns: `SELECT TABLE_NAME tableName,COLUMN_NAME columnName,
        ORDINAL_POSITION ordinalPosition,COLUMN_DEFAULT columnDefault,
        IS_NULLABLE isNullable,DATA_TYPE dataType,COLUMN_TYPE columnType,
        NUMERIC_PRECISION numericPrecision,NUMERIC_SCALE numericScale,
        CHARACTER_MAXIMUM_LENGTH characterMaximumLength,EXTRA extra
      FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE()
      ORDER BY TABLE_NAME,ORDINAL_POSITION`,
    constraints: `SELECT TABLE_NAME tableName,CONSTRAINT_NAME constraintName,
        CONSTRAINT_TYPE constraintType
      FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE()
      ORDER BY TABLE_NAME,CONSTRAINT_NAME`,
    indexes: `SELECT TABLE_NAME tableName,INDEX_NAME indexName,
        NON_UNIQUE nonUnique,INDEX_TYPE indexType,SEQ_IN_INDEX sequenceInIndex,
        COLUMN_NAME columnName,SUB_PART subPart,COLLATION collation
      FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE()
      ORDER BY TABLE_NAME,INDEX_NAME,SEQ_IN_INDEX`,
    keyUsage: `SELECT TABLE_NAME tableName,CONSTRAINT_NAME constraintName,
        COLUMN_NAME columnName,ORDINAL_POSITION ordinalPosition,
        REFERENCED_TABLE_NAME referencedTableName,
        REFERENCED_COLUMN_NAME referencedColumnName
      FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE WHERE CONSTRAINT_SCHEMA=DATABASE()
      ORDER BY TABLE_NAME,CONSTRAINT_NAME,ORDINAL_POSITION`,
    rules: `SELECT TABLE_NAME tableName,CONSTRAINT_NAME constraintName,
        UPDATE_RULE updateRule,DELETE_RULE deleteRule
      FROM INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS
      WHERE CONSTRAINT_SCHEMA=DATABASE()
      ORDER BY TABLE_NAME,CONSTRAINT_NAME`,
    triggers: `SELECT TRIGGER_NAME triggerName,
        EVENT_MANIPULATION eventManipulation,EVENT_OBJECT_TABLE eventObjectTable,
        ACTION_TIMING actionTiming,ACTION_STATEMENT actionStatement
      FROM INFORMATION_SCHEMA.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE()
      ORDER BY TRIGGER_NAME`,
  };
  for (const [key, sql] of Object.entries(queries)) {
    schema[key] = await sequelize.query(sql, {
      type: SequelizePackage.QueryTypes.SELECT,
    });
  }
  const data = {};
  const counts = {};
  const checksums = {};
  for (const tableName of [
    'Organizations',
    'Clubs',
    'Accounts',
    'Memberships',
    'MembershipClubAccesses',
    'Staffs',
    'Users',
    'ClientSavedViews',
    'ClientBases',
    'CallTasks',
    'CallTaskClients',
    'CallTaskAttempts',
    'TelephonyCalls',
  ]) {
    const rows = await sequelize.query(
      `SELECT * FROM \`${tableName}\` ORDER BY 1`,
      { type: SequelizePackage.QueryTypes.SELECT },
    );
    data[tableName] = rows;
    counts[tableName] = rows.length;
    checksums[tableName] = crypto
      .createHash('sha256')
      .update(JSON.stringify(rows))
      .digest('hex');
  }
  return { checksums, counts, data, schema };
}

async function seedLegacyGraph(sequelize) {
  const queryInterface = sequelize.getQueryInterface();
  const now = new Date('2097-01-01T09:00:00.000Z');
  const organization = await selectOne(
    sequelize,
    'SELECT id FROM Organizations WHERE slug=:slug',
    { slug: DEFAULT_ORGANIZATION_SLUG },
  );
  const club = await selectOne(
    sequelize,
    'SELECT id FROM Clubs WHERE slug=:slug',
    { slug: DEFAULT_CLUB_SLUG },
  );
  await queryInterface.bulkInsert('Accounts', [
    {
      createdAt: now,
      email: 'feature-5-4-legacy-owner@example.test',
      passwordHash: 'test-only',
      role: 'owner',
      status: 'active',
      updatedAt: now,
    },
  ]);
  const account = await selectOne(
    sequelize,
    "SELECT id FROM Accounts WHERE email='feature-5-4-legacy-owner@example.test'",
  );
  await queryInterface.bulkInsert('Memberships', [
    {
      accountId: account.id,
      createdAt: now,
      organizationId: organization.id,
      role: 'owner',
      status: 'active',
      updatedAt: now,
    },
  ]);
  await queryInterface.bulkInsert('Users', [
    {
      createdAt: now,
      isTraining: false,
      name: 'Legacy tenant client',
      organizationId: organization.id,
      phone: '+79995550001',
      source: 'Legacy source',
      status: 'active',
      updatedAt: now,
    },
  ]);
  const client = await selectOne(
    sequelize,
    "SELECT id FROM Users WHERE phone='+79995550001'",
  );
  await queryInterface.bulkInsert('ClientSavedViews', [
    {
      accountId: account.id,
      createdAt: now,
      filters: JSON.stringify({ segment: 'all', status: 'active' }),
      name: 'Legacy view',
      updatedAt: now,
    },
  ]);
  await queryInterface.bulkInsert('ClientBases', [
    {
      createdAt: now,
      createdByAccountId: account.id,
      filters: JSON.stringify({ segment: 'all', status: 'active' }),
      lastCalculatedAt: now,
      name: 'Legacy base',
      origin: null,
      recurringEnabled: false,
      recurringInterval: 'none',
      recurringScopeType: 'snapshot',
      status: 'active',
      updatedAt: now,
    },
  ]);
  const base = await selectOne(
    sequelize,
    "SELECT id FROM ClientBases WHERE name='Legacy base'",
  );
  await queryInterface.bulkInsert('CallTasks', [
    {
      clientBaseId: base.id,
      createdAt: now,
      createdByAccountId: account.id,
      scopeType: 'snapshot',
      snapshotClientCount: 1,
      status: 'backlog',
      title: 'Legacy call task',
      updatedAt: now,
    },
  ]);
  const task = await selectOne(
    sequelize,
    "SELECT id FROM CallTasks WHERE title='Legacy call task'",
  );
  await queryInterface.bulkInsert('CallTaskClients', [
    {
      callTaskId: task.id,
      clientName: 'Legacy tenant client',
      clientPhone: '+79995550001',
      createdAt: now,
      status: 'new',
      updatedAt: now,
      userId: client.id,
      visitCount: 0,
    },
  ]);
  const taskClient = await selectOne(
    sequelize,
    'SELECT id FROM CallTaskClients WHERE callTaskId=:taskId',
    { taskId: task.id },
  );
  await queryInterface.bulkInsert('CallTaskAttempts', [
    {
      actorAccountId: account.id,
      callTaskClientId: taskClient.id,
      createdAt: now,
      status: 'no_answer',
      summary: 'Legacy attempt',
      updatedAt: now,
    },
  ]);
  await queryInterface.bulkInsert('TelephonyCalls', [
    {
      callStatus: 'completed',
      clubId: club.id,
      createdAt: now,
      direction: 'outbound',
      followUpCallTaskId: task.id,
      organizationId: organization.id,
      processingStatus: 'processed',
      provider: 'beeline',
      recordingStatus: 'unknown',
      updatedAt: now,
      userId: client.id,
    },
  ]);
  return {
    accountId: Number(account.id),
    baseId: Number(base.id),
    clientId: Number(client.id),
    clubId: Number(club.id),
    organizationId: Number(organization.id),
    taskId: Number(task.id),
  };
}

function tenantFor(account, membership, organizationId, clubId, role = null) {
  const effectiveRole = role || membership.role;
  return Object.freeze({
    accountId: Number(account.id),
    clubId: Number(clubId),
    effectiveRole,
    membershipId: Number(membership.id),
    membershipRole: membership.role,
    organizationId: Number(organizationId),
    scope: 'club',
  });
}

function dbErrorCode(error) {
  return error?.original?.code || error?.parent?.code || error?.code;
}

test('Feature 5.4 client bases/call tasks migration and tenant isolation', async () => {
  assert.ok(process.env.DB_USER, 'DB_USER is required for DB-backed tenant tests');
  const database = databaseName();
  const previousCapabilities = Object.fromEntries(
    CAPABILITY_ENV.map((name) => [name, process.env[name]]),
  );
  const previousDatabase = process.env.DB_NAME;
  const previousNodeEnv = process.env.NODE_ENV;
  const previousFailure =
    process.env.TENANT_CLIENT_BASES_CALL_TASKS_MIGRATION_FAIL_STEP;
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
    const legacy = await seedLegacyGraph(schema);

    await queryInterface.addColumn('ClientBases', 'organizationId', {
      allowNull: true,
      type: SequelizePackage.INTEGER,
    });
    await assert.rejects(
      () => migration.up(queryInterface, SequelizePackage),
      (error) => error.code === 'TENANT_CLIENT_BASES_PARTIAL_SCHEMA',
    );
    await queryInterface.removeColumn('ClientBases', 'organizationId');

    const beforeForcedFailure = await snapshotMigrationInvariants(schema);
    process.env.TENANT_CLIENT_BASES_CALL_TASKS_MIGRATION_FAIL_STEP = 'triggers';
    await assert.rejects(
      () => migration.up(queryInterface, SequelizePackage),
      (error) => error.code === 'TENANT_CLIENT_BASES_MIGRATION_FORCED_FAILURE',
    );
    delete process.env.TENANT_CLIENT_BASES_CALL_TASKS_MIGRATION_FAIL_STEP;
    assert.deepEqual(
      await snapshotMigrationInvariants(schema),
      beforeForcedFailure,
      'forced invocation cleanup must restore exact schema, rows and checksums',
    );
    assert.equal(
      Boolean((await queryInterface.describeTable('ClientBases')).organizationId),
      false,
    );
    assert.equal(
      (await selectOne(schema, 'SELECT COUNT(*) count FROM CallTasks')).count,
      1,
    );

    await migration.up(queryInterface, SequelizePackage);
    await migration.up(queryInterface, SequelizePackage);
    let backfilled = await selectOne(
      schema,
      `SELECT organizationId, clubId FROM ClientBases WHERE id=:id`,
      { id: legacy.baseId },
    );
    assert.deepEqual(
      [Number(backfilled.organizationId), Number(backfilled.clubId)],
      [legacy.organizationId, legacy.clubId],
    );
    const triggerCount = await selectOne(
      schema,
      `SELECT COUNT(*) count FROM INFORMATION_SCHEMA.TRIGGERS
        WHERE TRIGGER_SCHEMA=DATABASE()
          AND TRIGGER_NAME LIKE 'trg_call_task%' OR
              (TRIGGER_SCHEMA=DATABASE() AND TRIGGER_NAME LIKE 'trg_client_base%')`,
    );
    assert.ok(Number(triggerCount.count) >= 8);

    await migration.down(queryInterface);
    assert.equal(
      Boolean((await queryInterface.describeTable('CallTasks')).organizationId),
      false,
    );
    assert.equal(
      (await selectOne(schema, 'SELECT COUNT(*) count FROM CallTaskAttempts')).count,
      1,
    );
    await migration.up(queryInterface, SequelizePackage);

    await applyAcceptedTenantMigrations(queryInterface, {
      afterFile: FEATURE_MIGRATION_FILE,
    });

    db = require('../../models');
    await db.sequelize.authenticate();
    const legacyActor = await db.Account.findByPk(legacy.accountId);
    const legacyMembership = await db.Membership.findOne({
      where: {
        accountId: legacy.accountId,
        organizationId: legacy.organizationId,
      },
    });
    let legacyTenant = tenantFor(
      legacyActor,
      legacyMembership,
      legacy.organizationId,
      legacy.clubId,
    );
    const clientBasesService = require('../../src/services/client-bases.service');
    const callTasksService = require('../../src/services/call-tasks.service');
    const clientsService = require('../../src/services/clients.service');
    const onboardingService = require('../../src/services/onboarding.service');

    process.env.TENANT_CLIENT_BASES_CALL_TASKS_ENABLED = 'false';
    process.env.TENANT_ONBOARDING_ENABLED = 'false';
    const legacyList = await clientBasesService.list({ status: 'all' });
    assert.ok(legacyList.some((base) => Number(base.id) === legacy.baseId));
    const compatibilityBase = await clientBasesService.create(
      legacyActor,
      {
        filters: { q: 'Legacy tenant client', status: 'active' },
        name: 'Flag-off compatibility base',
        organizationId: 999999,
        clubId: 999999,
      },
    );
    const compatibilityRow = await db.ClientBase.findByPk(compatibilityBase.id);
    assert.equal(Number(compatibilityRow.organizationId), legacy.organizationId);
    assert.equal(Number(compatibilityRow.clubId), legacy.clubId);
    process.env.TENANT_CLIENT_BASES_CALL_TASKS_ENABLED = 'true';
    process.env.TENANT_ONBOARDING_ENABLED = 'true';
    const tenantContextService = require('../../src/services/tenant-context.service');
    legacyTenant = await tenantContextService.resolveTenantContext({
      accountId: legacyActor.id,
      clubId: legacy.clubId,
      organizationId: legacy.organizationId,
      scope: 'club',
    });

    const secondClub = await db.Club.create({
      name: 'Feature 5.4 second club',
      organizationId: legacy.organizationId,
      slug: `feature-5-4-second-${Date.now()}`,
      status: 'active',
      timezone: 'Europe/Moscow',
    });
    const foreignOrganization = await db.Organization.create({
      name: 'Feature 5.4 foreign organization',
      slug: `feature-5-4-foreign-${Date.now()}`,
      status: 'active',
    });
    const foreignClub = await db.Club.create({
      name: 'Feature 5.4 foreign club',
      organizationId: foreignOrganization.id,
      slug: `feature-5-4-foreign-club-${Date.now()}`,
      status: 'active',
      timezone: 'Europe/Moscow',
    });
    const foreignActor = await db.Account.create({
      email: `feature-5-4-foreign-owner-${Date.now()}@example.test`,
      passwordHash: 'test-only',
      role: 'owner',
      staffId: null,
      status: 'active',
    });
    const foreignOwnerMembership = await db.Membership.create({
      accountId: foreignActor.id,
      organizationId: foreignOrganization.id,
      role: 'owner',
      staffId: null,
      status: 'active',
    });
    const tenantSecondClub = await tenantContextService.resolveTenantContext({
      accountId: legacyActor.id,
      clubId: secondClub.id,
      organizationId: legacy.organizationId,
      scope: 'club',
    });
    const foreignTenant = await tenantContextService.resolveTenantContext({
      accountId: foreignActor.id,
      clubId: foreignClub.id,
      organizationId: foreignOrganization.id,
      scope: 'club',
    });

    const managerA = await db.Account.create({
      email: `feature-5-4-manager-a-${Date.now()}@example.test`,
      passwordHash: 'test-only',
      role: 'manager',
      status: 'active',
    });
    const managerAMembership = await db.Membership.create({
      accountId: managerA.id,
      organizationId: legacy.organizationId,
      role: 'manager',
      staffId: null,
      status: 'active',
    });
    const managerAAccess = await db.MembershipClubAccess.create({
      clubId: legacy.clubId,
      membershipId: managerAMembership.id,
      organizationId: legacy.organizationId,
      roleOverride: null,
      status: 'active',
    });
    const managerATenant = await tenantContextService.resolveTenantContext({
      accountId: managerA.id,
      clubId: legacy.clubId,
      organizationId: legacy.organizationId,
      scope: 'club',
    });
    const managerBStaff = await db.Staff.create({
      name: `Feature 5.4 manager B staff ${Date.now()}`,
      organizationId: legacy.organizationId,
      role: 'Администратор',
      status: 'active',
    });
    const managerB = await db.Account.create({
      email: `feature-5-4-manager-b-${Date.now()}@example.test`,
      passwordHash: 'test-only',
      role: 'manager',
      staffId: managerBStaff.id,
      status: 'active',
    });
    const managerBMembership = await db.Membership.create({
      accountId: managerB.id,
      organizationId: legacy.organizationId,
      role: 'manager',
      staffId: managerBStaff.id,
      status: 'active',
    });
    await db.MembershipClubAccess.create({
      clubId: secondClub.id,
      membershipId: managerBMembership.id,
      organizationId: legacy.organizationId,
      roleOverride: null,
      status: 'active',
    });
    const managerBTenant = await tenantContextService.resolveTenantContext({
      accountId: managerB.id,
      clubId: secondClub.id,
      organizationId: legacy.organizationId,
      scope: 'club',
    });
    const foreignManagerStaff = await db.Staff.create({
      name: `Feature 5.4 foreign manager staff ${Date.now()}`,
      organizationId: foreignOrganization.id,
      role: 'Администратор',
      status: 'active',
    });
    const foreignManager = await db.Account.create({
      email: `feature-5-4-foreign-manager-${Date.now()}@example.test`,
      passwordHash: 'test-only',
      role: 'manager',
      staffId: foreignManagerStaff.id,
      status: 'active',
    });
    await db.Membership.create({
      accountId: foreignManager.id,
      organizationId: foreignOrganization.id,
      role: 'manager',
      staffId: foreignManagerStaff.id,
      status: 'active',
    });

    const suffix = Date.now();
    const clientA = await db.User.create({
      isTraining: false,
      name: `Feature 5.4 club A client ${suffix}`,
      organizationId: legacy.organizationId,
      phone: '+79995550991',
      source: 'Feature 5.4 source',
      status: 'active',
    });
    const clientB = await db.User.create({
      isTraining: false,
      name: `Feature 5.4 club B client ${suffix}`,
      organizationId: legacy.organizationId,
      phone: '+79995550992',
      source: 'Feature 5.4 source',
      status: 'active',
    });
    const foreignClient = await db.User.create({
      isTraining: false,
      name: `Feature 5.4 foreign client ${suffix}`,
      organizationId: foreignOrganization.id,
      phone: '+79995550991',
      source: 'Feature 5.4 source',
      status: 'active',
    });
    await db.Visit.bulkCreate([
      {
        clubId: legacy.clubId,
        organizationId: legacy.organizationId,
        scannedAt: '2099-01-10T10:00:00.000Z',
        userId: clientA.id,
      },
      {
        clubId: secondClub.id,
        organizationId: legacy.organizationId,
        scannedAt: '2099-01-11T10:00:00.000Z',
        userId: clientB.id,
      },
      {
        clubId: foreignClub.id,
        organizationId: foreignOrganization.id,
        scannedAt: '2099-01-12T10:00:00.000Z',
        userId: foreignClient.id,
      },
    ]);

    const spoofedBase = await clientBasesService.create(
      legacyActor,
      {
        clubId: secondClub.id,
        filters: { q: String(suffix), status: 'active' },
        name: `Feature 5.4 spoof probe ${suffix}`,
        organizationId: foreignOrganization.id,
      },
      legacyTenant,
    );
    const spoofedRow = await db.ClientBase.findByPk(spoofedBase.id);
    assert.equal(Number(spoofedRow.organizationId), legacy.organizationId);
    assert.equal(Number(spoofedRow.clubId), legacy.clubId);

    const savedViewA = await clientsService.createSavedView(
      legacyActor,
      { filters: { q: String(suffix) }, name: `Same scoped view ${suffix}` },
      legacyTenant,
    );
    const savedViewB = await clientsService.createSavedView(
      legacyActor,
      { filters: { q: String(suffix) }, name: `Same scoped view ${suffix}` },
      tenantSecondClub,
    );
    assert.deepEqual(
      (await clientsService.listSavedViews(legacyActor, legacyTenant))
        .filter((view) => view.name === `Same scoped view ${suffix}`)
        .map((view) => Number(view.id)),
      [Number(savedViewA.id)],
    );
    assert.notEqual(Number(savedViewA.id), Number(savedViewB.id));
    await assert.rejects(
      () => clientsService.updateSavedView(
        legacyActor,
        savedViewA.id,
        { name: 'Cross-club saved view mutation' },
        tenantSecondClub,
      ),
      (error) => error.statusCode === 404,
    );

    const foreignBase = await clientBasesService.create(
      foreignActor,
      {
        filters: { q: String(suffix), status: 'active' },
        name: `Feature 5.4 foreign base ${suffix}`,
      },
      foreignTenant,
    );
    await assert.rejects(
      () => clientBasesService.getClients(
        foreignBase.id,
        { page: 1, pageSize: 20 },
        legacyTenant,
      ),
      (error) => error.statusCode === 404,
    );

    const selection = {
      asOf: '2099-12-31',
      from: '2099-01-01',
      kind: 'filters',
      to: '2099-01-31',
    };
    const analyticsBaseA = await clientBasesService.createFromVisitsAnalytics(
      legacyActor,
      { name: `Feature 5.4 analytics A ${suffix}`, selection },
      legacyTenant,
    );
    const analyticsBaseB = await clientBasesService.createFromVisitsAnalytics(
      legacyActor,
      { name: `Feature 5.4 analytics B ${suffix}`, selection },
      tenantSecondClub,
    );
    assert.equal(analyticsBaseA.currentClientCount, 1);
    assert.equal(analyticsBaseB.currentClientCount, 1);
    const analyticsRowA = await db.ClientBase.findByPk(analyticsBaseA.id);
    assert.equal(Number(analyticsRowA.originOrganizationId), legacy.organizationId);
    assert.equal(Number(analyticsRowA.originClubId), legacy.clubId);
    await assert.rejects(
      () => clientBasesService.create(
        legacyActor,
        {
          filters: analyticsBaseA.filters,
          name: 'Spoofed analytics base',
          origin: 'visits_analytics',
          originMetadata: { source: 'client' },
        },
        legacyTenant,
      ),
      (error) => error.statusCode === 400,
    );

    const taskA = await callTasksService.createFromBase(
      legacyActor,
      analyticsBaseA.id,
      {
        assignedToAccountId: managerA.id,
        scopeType: 'dynamic',
        scriptText: 'Tenant-safe call script',
        title: `Feature 5.4 task A ${suffix}`,
      },
      legacyTenant,
    );
    const taskClientIds = (
      await db.CallTaskClient.findAll({ where: { callTaskId: taskA.id } })
    ).map((row) => Number(row.userId));
    assert.deepEqual(taskClientIds, [Number(clientA.id)]);
    assert.equal((await callTasksService.getOne(
      legacyActor,
      taskA.id,
      legacyTenant,
    )).scriptText, 'Tenant-safe call script');

    await assert.rejects(
      () => callTasksService.getOne(legacyActor, taskA.id, tenantSecondClub),
      (error) => error.statusCode === 404,
    );
    await assert.rejects(
      () => clientBasesService.getClients(
        analyticsBaseA.id,
        { page: 1, pageSize: 20 },
        tenantSecondClub,
      ),
      (error) => error.statusCode === 404,
    );
    await assert.rejects(
      () => callTasksService.createFromBase(
        legacyActor,
        analyticsBaseA.id,
        { assignedToAccountId: managerB.id, title: 'Disallowed assignee' },
        legacyTenant,
      ),
      (error) => error.statusCode === 404,
    );
    await assert.rejects(
      () => callTasksService.createFromBase(
        legacyActor,
        analyticsBaseA.id,
        { assignedToAccountId: foreignManager.id, title: 'Foreign assignee' },
        legacyTenant,
      ),
      (error) => error.statusCode === 404,
    );
    assert.equal(
      (await callTasksService.getReport(
        legacyActor,
        { status: 'all' },
        tenantSecondClub,
      )).tasksCount,
      0,
    );

    await managerAAccess.update({ status: 'archived' });
    await assert.rejects(
      () => callTasksService.list(managerA, { status: 'all' }, managerATenant),
      (error) => error.statusCode === 404,
    );
    await managerAAccess.update({ status: 'active' });
    await managerAMembership.update({ status: 'archived' });
    await assert.rejects(
      () => callTasksService.list(managerA, { status: 'all' }, managerATenant),
      (error) => error.statusCode === 404,
    );
    await managerAMembership.update({ status: 'active' });
    const forgedMembershipTenant = Object.freeze({
      ...managerATenant,
      membershipId: managerBMembership.id,
    });
    await assert.rejects(
      () => callTasksService.list(
        managerA,
        { status: 'all' },
        forgedMembershipTenant,
      ),
      (error) => error.statusCode === 404,
    );
    await secondClub.update({ status: 'archived' });
    await assert.rejects(
      () => clientBasesService.list({ status: 'all' }, tenantSecondClub),
      (error) => error.statusCode === 404,
    );
    await secondClub.update({ status: 'active' });
    await foreignOrganization.update({ status: 'archived' });
    await assert.rejects(
      () => clientBasesService.list({ status: 'all' }, foreignTenant),
      (error) => error.statusCode === 404,
    );
    await foreignOrganization.update({ status: 'active' });

    await assert.rejects(
      () => db.CallTaskClient.create({
        callTaskId: taskA.id,
        clientName: foreignClient.name,
        clientPhone: foreignClient.phone,
        status: 'new',
        userId: foreignClient.id,
        visitCount: 0,
      }),
      (error) => dbErrorCode(error) === 'ER_SIGNAL_EXCEPTION',
    );
    await assert.rejects(
      () => analyticsRowA.update({ originClubId: secondClub.id }),
      (error) => error.code === 'CLIENT_BASE_PROVENANCE_IMMUTABLE',
    );
    await assert.rejects(
      () => db.ClientBase.update(
        { organizationId: foreignOrganization.id },
        { where: { id: analyticsBaseA.id } },
      ),
      (error) => error.code === 'CLIENT_BASE_TENANT_IMMUTABLE',
    );
    await assert.rejects(
      () => schema.query(
        'UPDATE ClientBases SET filters=JSON_SET(filters, \'$.spoofed\', true) WHERE id=:id',
        { replacements: { id: analyticsBaseA.id } },
      ),
      (error) => dbErrorCode(error) === 'ER_SIGNAL_EXCEPTION',
    );

    const taskClient = await db.CallTaskClient.findOne({
      where: { callTaskId: taskA.id, userId: clientA.id },
    });
    const {
      resolveEligibleCallTaskAccount,
    } = require('../../src/services/call-task-access-context.service');
    const authorityStaffA = await db.Staff.create({
      name: `Feature 5.4 authority staff A ${suffix}`,
      organizationId: legacy.organizationId,
      role: 'Администратор',
      status: 'active',
    });
    const authorityStaffB = await db.Staff.create({
      name: `Feature 5.4 authority staff B ${suffix}`,
      organizationId: legacy.organizationId,
      role: 'Администратор',
      status: 'active',
    });
    const authorityStaffC = await db.Staff.create({
      name: `Feature 5.4 authority staff C ${suffix}`,
      organizationId: legacy.organizationId,
      role: 'Администратор',
      status: 'active',
    });
    const authorityStaffD = await db.Staff.create({
      name: `Feature 5.4 authority staff D ${suffix}`,
      organizationId: legacy.organizationId,
      role: 'Администратор',
      status: 'active',
    });
    const inactiveAuthorityStaff = await db.Staff.create({
      name: `Feature 5.4 inactive authority staff ${suffix}`,
      organizationId: legacy.organizationId,
      role: 'Администратор',
      status: 'inactive',
    });
    const foreignAuthorityStaff = await db.Staff.create({
      name: `Feature 5.4 foreign authority staff ${suffix}`,
      organizationId: foreignOrganization.id,
      role: 'Администратор',
      status: 'active',
    });

    async function createAuthorityProbe(label, options = {}) {
      const account = await db.Account.create({
        email: `feature-5-4-authority-${label}-${suffix}@example.test`,
        passwordHash: 'test-only',
        role: 'manager',
        staffId: options.accountStaffId ?? null,
        status: options.accountStatus || 'active',
      });
      const membership = await db.Membership.create({
        accountId: account.id,
        organizationId: legacy.organizationId,
        role: 'manager',
        staffId: options.membershipStaffId ?? null,
        status: options.membershipStatus || 'active',
      });
      await db.MembershipClubAccess.create({
        clubId: legacy.clubId,
        membershipId: membership.id,
        organizationId: legacy.organizationId,
        roleOverride: null,
        status: options.accessStatus || 'active',
      });
      if (options.unsafeStaffId !== undefined) {
        const unsafeTransaction = await schema.transaction();
        try {
          await schema.query('SET FOREIGN_KEY_CHECKS=0', {
            transaction: unsafeTransaction,
          });
          await schema.query(
            'UPDATE Accounts SET staffId=:staffId WHERE id=:accountId',
            {
              replacements: {
                accountId: account.id,
                staffId: options.unsafeStaffId,
              },
              transaction: unsafeTransaction,
            },
          );
          await schema.query(
            'UPDATE Memberships SET staffId=:staffId WHERE id=:membershipId',
            {
              replacements: {
                membershipId: membership.id,
                staffId: options.unsafeStaffId,
              },
              transaction: unsafeTransaction,
            },
          );
          await schema.query('SET FOREIGN_KEY_CHECKS=1', {
            transaction: unsafeTransaction,
          });
          await unsafeTransaction.commit();
        } catch (error) {
          await unsafeTransaction.rollback();
          throw error;
        }
      }
      return { account, membership };
    }

    const authorityCases = [
      ['account-staff-membership-null', {
        accountStaffId: authorityStaffA.id,
        membershipStaffId: null,
      }],
      ['account-null-membership-staff', {
        accountStaffId: null,
        membershipStaffId: authorityStaffB.id,
      }],
      ['unequal-staff', {
        accountStaffId: authorityStaffC.id,
        membershipStaffId: authorityStaffD.id,
      }],
      ['inactive-staff', {
        accountStaffId: inactiveAuthorityStaff.id,
        membershipStaffId: inactiveAuthorityStaff.id,
      }],
      ['inactive-account', { accountStatus: 'inactive' }],
      ['inactive-membership', { membershipStatus: 'inactive' }],
      ['revoked-access', { accessStatus: 'archived' }],
      ['cross-organization-staff', {
        unsafeStaffId: foreignAuthorityStaff.id,
      }],
      ['missing-staff', { unsafeStaffId: 2147483000 }],
    ];
    for (const [label, options] of authorityCases) {
      const probe = await createAuthorityProbe(label, options);
      assert.equal(
        await resolveEligibleCallTaskAccount(probe.account.id, legacyTenant, {
          allowInvalid: true,
        }),
        null,
        `${label} runtime authority unexpectedly accepted`,
      );
      await assert.rejects(
        () => db.ClientBase.create({
          clubId: legacy.clubId,
          createdByAccountId: probe.account.id,
          filters: { status: 'active' },
          name: `Feature 5.4 rejected authority base ${label} ${suffix}`,
          organizationId: legacy.organizationId,
          recurringEnabled: false,
          recurringInterval: 'none',
          recurringScopeType: 'snapshot',
          status: 'active',
        }),
        (error) => dbErrorCode(error) === 'ER_SIGNAL_EXCEPTION',
        `${label} creator INSERT unexpectedly accepted`,
      );
      await assert.rejects(
        () => schema.query(
          `UPDATE CallTasks
              SET assignedToAccountId=:accountId, updatedAt=updatedAt
            WHERE id=:taskId`,
          { replacements: { accountId: probe.account.id, taskId: taskA.id } },
        ),
        (error) => dbErrorCode(error) === 'ER_SIGNAL_EXCEPTION',
        `${label} assignee raw UPDATE unexpectedly accepted`,
      );
      await assert.rejects(
        () => db.CallTaskAttempt.bulkCreate([{
          actorAccountId: probe.account.id,
          callTaskClientId: taskClient.id,
          status: 'no_answer',
          summary: `Rejected ${label}`,
        }]),
        (error) => dbErrorCode(error) === 'ER_SIGNAL_EXCEPTION',
        `${label} attempt actor bulk INSERT unexpectedly accepted`,
      );
      await assert.rejects(
        () => db.CallTaskClient.create({
          callTaskId: taskA.id,
          clientName: `Rejected training ${label}`,
          isTraining: true,
          status: 'new',
          trainingAccountId: probe.account.id,
          trainingRole: 'manager',
          visitCount: 0,
        }),
        (error) => dbErrorCode(error) === 'ER_SIGNAL_EXCEPTION',
        `${label} training account INSERT unexpectedly accepted`,
      );
    }
    assert.equal(
      await resolveEligibleCallTaskAccount(managerA.id, legacyTenant),
      Number(managerA.id),
      'NULL/NULL Staff compatibility must remain accepted',
    );
    await secondClub.update({ status: 'archived' });
    await assert.rejects(
      () => schema.query(
        'UPDATE ClientBases SET name=name WHERE id=:baseId',
        { replacements: { baseId: analyticsBaseB.id } },
      ),
      (error) => dbErrorCode(error) === 'ER_SIGNAL_EXCEPTION',
    );
    await secondClub.update({ status: 'active' });

    const concurrentExplicitTasks = await Promise.all([
      callTasksService.createFromBase(
        legacyActor,
        analyticsBaseB.id,
        { title: `Feature 5.4 explicit B1 ${suffix}` },
        tenantSecondClub,
      ),
      callTasksService.createFromBase(
        legacyActor,
        analyticsBaseB.id,
        { title: `Feature 5.4 explicit B2 ${suffix}` },
        tenantSecondClub,
      ),
    ]);
    assert.equal(new Set(concurrentExplicitTasks.map((task) => task.id)).size, 2);
    for (const explicitTask of concurrentExplicitTasks) {
      assert.deepEqual(
        (await db.CallTaskClient.findAll({
          where: { callTaskId: explicitTask.id },
        })).map((row) => Number(row.userId)),
        [Number(clientB.id)],
      );
    }
    const sameTenantReparentTask = await callTasksService.createFromBase(
      legacyActor,
      analyticsBaseA.id,
      { title: `Feature 5.4 same-tenant reparent ${suffix}` },
      legacyTenant,
    );
    const foreignTask = await callTasksService.createFromBase(
      foreignActor,
      foreignBase.id,
      { title: `Feature 5.4 foreign task ${suffix}` },
      foreignTenant,
    );
    const validFollowUpCall = await db.TelephonyCall.create({
      callStatus: 'completed',
      clubId: legacy.clubId,
      direction: 'outbound',
      followUpCallTaskId: taskA.id,
      organizationId: legacy.organizationId,
      processingStatus: 'processed',
      provider: 'beeline',
      recordingStatus: 'unknown',
      userId: clientA.id,
    });
    await assert.rejects(
      () => db.TelephonyCall.bulkCreate([{
        callStatus: 'completed',
        clubId: null,
        direction: 'outbound',
        followUpCallTaskId: taskA.id,
        organizationId: null,
        processingStatus: 'processed',
        provider: 'beeline',
        recordingStatus: 'unknown',
      }]),
      (error) => dbErrorCode(error) === 'ER_SIGNAL_EXCEPTION',
    );
    await assert.rejects(
      () => schema.query(
        `INSERT INTO TelephonyCalls
          (provider,direction,callStatus,recordingStatus,processingStatus,
           organizationId,clubId,followUpCallTaskId,createdAt,updatedAt)
         VALUES
          ('beeline','outbound','completed','unknown','processed',
           NULL,NULL,:taskId,NOW(),NOW())`,
        { replacements: { taskId: taskA.id } },
      ),
      (error) => dbErrorCode(error) === 'ER_SIGNAL_EXCEPTION',
    );
    await assert.rejects(
      () => db.TelephonyCall.bulkCreate([{
        callStatus: 'completed',
        clubId: legacy.clubId,
        direction: 'outbound',
        followUpCallTaskId: concurrentExplicitTasks[0].id,
        organizationId: legacy.organizationId,
        processingStatus: 'processed',
        provider: 'beeline',
        recordingStatus: 'unknown',
      }]),
      (error) => dbErrorCode(error) === 'ER_SIGNAL_EXCEPTION',
    );
    await assert.rejects(
      () => schema.query(
        `UPDATE TelephonyCalls
            SET followUpCallTaskId=:taskId,
                organizationId=:organizationId,
                clubId=:clubId
          WHERE id=:callId`,
        {
          replacements: {
            callId: validFollowUpCall.id,
            clubId: secondClub.id,
            organizationId: legacy.organizationId,
            taskId: concurrentExplicitTasks[0].id,
          },
        },
      ),
      (error) => dbErrorCode(error) === 'ER_SIGNAL_EXCEPTION',
    );
    await assert.rejects(
      () => schema.query(
        `UPDATE TelephonyCalls
            SET followUpCallTaskId=:taskId,
                organizationId=:organizationId,
                clubId=:clubId
          WHERE id=:callId`,
        {
          replacements: {
            callId: validFollowUpCall.id,
            clubId: foreignClub.id,
            organizationId: foreignOrganization.id,
            taskId: foreignTask.id,
          },
        },
      ),
      (error) => dbErrorCode(error) === 'ER_SIGNAL_EXCEPTION',
    );
    await assert.rejects(
      () => schema.query(
        `UPDATE TelephonyCalls
            SET followUpCallTaskId=:taskId,
                organizationId=:organizationId,
                clubId=:clubId
          WHERE id=:callId`,
        {
          replacements: {
            callId: validFollowUpCall.id,
            clubId: legacy.clubId,
            organizationId: legacy.organizationId,
            taskId: foreignTask.id,
          },
        },
      ),
      (error) => dbErrorCode(error) === 'ER_SIGNAL_EXCEPTION',
    );
    await assert.rejects(
      () => schema.query(
        `UPDATE TelephonyCalls
            SET organizationId=NULL, clubId=NULL
          WHERE id=:callId`,
        { replacements: { callId: validFollowUpCall.id } },
      ),
      (error) => dbErrorCode(error) === 'ER_SIGNAL_EXCEPTION',
    );
    let persistedFollowUp = await selectOne(
      schema,
      `SELECT organizationId,clubId,followUpCallTaskId
         FROM TelephonyCalls WHERE id=:callId`,
      { callId: validFollowUpCall.id },
    );
    assert.deepEqual(
      [
        Number(persistedFollowUp.organizationId),
        Number(persistedFollowUp.clubId),
        Number(persistedFollowUp.followUpCallTaskId),
      ],
      [legacy.organizationId, legacy.clubId, Number(taskA.id)],
      'rejected DB writes must leave only an API-mappable valid follow-up link',
    );
    await schema.query(
      'UPDATE TelephonyCalls SET followUpCallTaskId=:taskId WHERE id=:callId',
      {
        replacements: {
          callId: validFollowUpCall.id,
          taskId: sameTenantReparentTask.id,
        },
      },
    );
    persistedFollowUp = await selectOne(
      schema,
      'SELECT followUpCallTaskId FROM TelephonyCalls WHERE id=:callId',
      { callId: validFollowUpCall.id },
    );
    assert.equal(
      Number(persistedFollowUp.followUpCallTaskId),
      Number(sameTenantReparentTask.id),
    );
    await schema.query(
      `UPDATE TelephonyCalls
          SET followUpCallTaskId=NULL
        WHERE id=:callId`,
      { replacements: { callId: validFollowUpCall.id } },
    );
    await db.TelephonyCall.create({
      callStatus: 'completed',
      clubId: null,
      direction: 'outbound',
      followUpCallTaskId: null,
      organizationId: null,
      processingStatus: 'processed',
      provider: 'beeline',
      recordingStatus: 'unknown',
    });

    await callTasksService.addAttempt(
      managerA,
      taskClient.id,
      { status: 'no_answer', summary: 'Scoped attempt' },
      managerATenant,
    );
    const clientDetails = await clientsService.getClientDetails(
      clientA.id,
      legacyActor,
      legacyTenant,
    );
    assert.equal(Number(clientDetails.client.id), Number(clientA.id));
    assert.ok(
      clientDetails.timeline.some((item) => item.type === 'call_task'),
      'client details must include the scoped call task without an invalid subquery alias',
    );
    assert.ok(
      clientDetails.timeline.some((item) => item.type === 'call_attempt'),
      'client details must include attempts loaded separately from the limited task query',
    );
    const attempt = await db.CallTaskAttempt.findOne({
      where: { callTaskClientId: taskClient.id },
    });
    const otherTaskClient = await db.CallTaskClient.findOne({
      where: { callTaskId: concurrentExplicitTasks[0].id },
    });
    await assert.rejects(
      () => schema.query(
        'UPDATE CallTaskAttempts SET callTaskClientId=:callTaskClientId WHERE id=:id',
        { replacements: { callTaskClientId: otherTaskClient.id, id: attempt.id } },
      ),
      (error) => dbErrorCode(error) === 'ER_SIGNAL_EXCEPTION',
    );
    await assert.rejects(
      () => db.CallTaskAttempt.update(
        { actorAccountId: legacyActor.id },
        { where: { id: attempt.id } },
      ),
      (error) => dbErrorCode(error) === 'ER_SIGNAL_EXCEPTION',
    );

    await onboardingService.setTrainingMode(
      legacyActor,
      { isEnabled: true, role: 'owner' },
      legacyTenant,
    );
    await onboardingService.setTrainingMode(
      managerB,
      { isEnabled: true, role: 'manager' },
      managerBTenant,
    );
    const legacyTrainingMarker = await onboardingService.getTrainingDataMarker(
      legacyActor,
      legacyTenant,
    );
    const siblingTrainingMarker = await onboardingService.getTrainingDataMarker(
      managerB,
      managerBTenant,
    );

    async function createTrainingTaskGraph(clubId, client, label, actor, marker) {
      const base = await db.ClientBase.create({
        clubId,
        createdByAccountId: actor.id,
        filters: { status: 'active' },
        ...marker,
        name: `Feature 5.4 training base ${label} ${suffix}`,
        organizationId: legacy.organizationId,
        status: 'active',
      });
      const task = await db.CallTask.create({
        clubId,
        clientBaseId: base.id,
        createdByAccountId: actor.id,
        ...marker,
        organizationId: legacy.organizationId,
        scopeType: 'snapshot',
        snapshotClientCount: 1,
        status: 'backlog',
        title: `Feature 5.4 training task ${label} ${suffix}`,
      });
      const item = await db.CallTaskClient.create({
        callTaskId: task.id,
        clientName: client.name,
        clientPhone: client.phone,
        ...marker,
        status: 'new',
        userId: client.id,
        visitCount: 0,
      });
      await db.CallTaskAttempt.create({
        actorAccountId: actor.id,
        callTaskClientId: item.id,
        ...marker,
        status: 'no_answer',
        summary: `Feature 5.4 training attempt ${label}`,
      });
      return { base, item, task };
    }

    const trainingGraphA = await createTrainingTaskGraph(
      legacy.clubId,
      clientA,
      'A',
      legacyActor,
      legacyTrainingMarker,
    );
    const trainingGraphB = await createTrainingTaskGraph(
      secondClub.id,
      clientB,
      'B',
      managerB,
      siblingTrainingMarker,
    );
    const cleanup = await onboardingService.cleanupTrainingData(
      legacyActor,
      { role: 'owner' },
      legacyTenant,
    );
    assert.equal(cleanup.remaining.entities.find(
      (entity) => entity.key === 'clientBases',
    ).count, 0);
    assert.equal(await db.ClientBase.findByPk(trainingGraphA.base.id), null);
    assert.equal(await db.CallTask.findByPk(trainingGraphA.task.id), null);
    assert.ok(await db.ClientBase.findByPk(trainingGraphB.base.id));
    assert.ok(await db.CallTask.findByPk(trainingGraphB.task.id));
    await callTasksService.update(
      legacyActor,
      taskA.id,
      { status: 'archived' },
      legacyTenant,
    );
    await assert.rejects(
      () => callTasksService.removeArchived(
        legacyActor,
        taskA.id,
        legacyTenant,
      ),
      (error) => error.statusCode === 409 && /история обзвона/.test(error.message),
    );

    const recurringBase = await clientBasesService.create(
      legacyActor,
      {
        filters: { q: String(suffix), status: 'active' },
        name: `Feature 5.4 recurring ${suffix}`,
        recurrence: {
          enabled: true,
          interval: 'daily',
          scopeType: 'snapshot',
          time: '10:00',
        },
      },
      legacyTenant,
    );
    const dueAt = new Date('2099-02-01T10:00:00.000Z');
    await db.ClientBase.update(
      { recurringNextRunAt: new Date('2099-01-31T10:00:00.000Z') },
      { where: { id: recurringBase.id } },
    );
    const recurrenceResults = await Promise.all([
      callTasksService.runDueRecurringTasks(dueAt, legacyTenant, legacyActor),
      callTasksService.runDueRecurringTasks(dueAt, legacyTenant, legacyActor),
    ]);
    assert.equal(
      recurrenceResults.flatMap((result) => result.results)
        .filter((result) => result.baseId === recurringBase.id && result.created)
        .length,
      1,
    );
    assert.equal(
      await db.CallTask.count({ where: { clientBaseId: recurringBase.id } }),
      1,
    );

    const joinedLater = await db.User.create({
      isTraining: false,
      name: `Feature 5.4 joined later ${suffix}`,
      organizationId: legacy.organizationId,
      phone: '+79995550993',
      source: 'Feature 5.4 source',
      status: 'active',
    });
    await db.Visit.create({
      clubId: legacy.clubId,
      organizationId: legacy.organizationId,
      scannedAt: '2099-01-15T10:00:00.000Z',
      userId: joinedLater.id,
    });
    await callTasksService.update(
      legacyActor,
      taskA.id,
      { status: 'backlog' },
      legacyTenant,
    );
    await Promise.all([
      callTasksService.sync(legacyActor, taskA.id, legacyTenant),
      callTasksService.sync(legacyActor, taskA.id, legacyTenant),
    ]);
    assert.equal(
      await db.CallTaskClient.count({
        where: { callTaskId: taskA.id, userId: joinedLater.id },
      }),
      1,
    );

    await clientBasesService.archive(analyticsBaseA.id, legacyTenant);
    await assert.rejects(
      () => clientBasesService.removeArchived(analyticsBaseA.id, legacyTenant),
      (error) => error.statusCode === 409 && /задачи обзвона/.test(error.message),
    );

    const beforeSecondTenantRollback = await snapshotMigrationInvariants(schema);
    await assert.rejects(
      () => migration.down(queryInterface),
      (error) => error.code === 'TENANT_SINGLE_DEFAULT_REQUIRED',
    );
    assert.deepEqual(
      await snapshotMigrationInvariants(schema),
      beforeSecondTenantRollback,
      'second-tenant rollback refusal must be mutation-free',
    );
  } finally {
    if (db?.sequelize) await db.sequelize.close();
    if (schema) await schema.close();
    await admin.query(`DROP DATABASE IF EXISTS \`${database}\``);
    await admin.end();
    if (previousDatabase === undefined) delete process.env.DB_NAME;
    else process.env.DB_NAME = previousDatabase;
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    for (const [name, value] of Object.entries(previousCapabilities)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    if (previousFailure === undefined) {
      delete process.env.TENANT_CLIENT_BASES_CALL_TASKS_MIGRATION_FAIL_STEP;
    } else {
      process.env.TENANT_CLIENT_BASES_CALL_TASKS_MIGRATION_FAIL_STEP =
        previousFailure;
    }
  }
});
