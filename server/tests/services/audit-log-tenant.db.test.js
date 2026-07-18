'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
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
const FEATURE_MIGRATION_FILE = '20260719200000-add-tenant-audit-log.js';
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
];

function databaseName() {
  return process.env.AUDIT_LOG_TEST_DB_NAME ||
    `setly_audit_f8_2_${process.pid}_${Date.now()}`;
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

function restoreEnv(previous) {
  for (const [name, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

async function selectOne(sequelize, sql, replacements = {}) {
  const rows = await sequelize.query(sql, {
    replacements,
    type: SequelizePackage.QueryTypes.SELECT,
  });
  return rows[0] || null;
}

async function selectAll(sequelize, sql, replacements = {}) {
  return sequelize.query(sql, {
    replacements,
    type: SequelizePackage.QueryTypes.SELECT,
  });
}

async function cleanupStateSnapshot(sequelize) {
  const [tables, columns, indexes, foreignKeys, triggers, auditRows] = await Promise.all([
    selectAll(sequelize, `
      SELECT TABLE_NAME, ENGINE, TABLE_COLLATION
      FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_SCHEMA=DATABASE()
      ORDER BY TABLE_NAME
    `),
    selectAll(sequelize, `
      SELECT TABLE_NAME, COLUMN_NAME, ORDINAL_POSITION, DATA_TYPE, COLUMN_TYPE,
             IS_NULLABLE, COLUMN_DEFAULT, EXTRA, CHARACTER_SET_NAME,
             COLLATION_NAME, COLUMN_COMMENT, GENERATION_EXPRESSION
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA=DATABASE()
      ORDER BY TABLE_NAME, ORDINAL_POSITION
    `),
    selectAll(sequelize, `
      SELECT TABLE_NAME, INDEX_NAME, NON_UNIQUE, SEQ_IN_INDEX, COLUMN_NAME,
             SUB_PART, COLLATION, INDEX_TYPE
      FROM INFORMATION_SCHEMA.STATISTICS
      WHERE TABLE_SCHEMA=DATABASE()
      ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX
    `),
    selectAll(sequelize, `
      SELECT k.TABLE_NAME, k.CONSTRAINT_NAME, k.COLUMN_NAME,
             k.REFERENCED_TABLE_NAME, k.REFERENCED_COLUMN_NAME,
             r.UPDATE_RULE, r.DELETE_RULE
      FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE k
      JOIN INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS r
        ON r.CONSTRAINT_SCHEMA=k.CONSTRAINT_SCHEMA
       AND r.CONSTRAINT_NAME=k.CONSTRAINT_NAME
      WHERE k.CONSTRAINT_SCHEMA=DATABASE()
      ORDER BY k.TABLE_NAME, k.CONSTRAINT_NAME, k.ORDINAL_POSITION
    `),
    selectAll(sequelize, `
      SELECT TRIGGER_NAME, EVENT_OBJECT_TABLE, EVENT_MANIPULATION,
             ACTION_TIMING, ACTION_STATEMENT
      FROM INFORMATION_SCHEMA.TRIGGERS
      WHERE TRIGGER_SCHEMA=DATABASE()
      ORDER BY TRIGGER_NAME
    `),
    selectAll(sequelize, 'SELECT * FROM AuditLogs ORDER BY id'),
  ]);
  return { auditRows, columns, foreignKeys, indexes, tables, triggers };
}

function emptyCleanupPlan(restoration) {
  return {
    column: [],
    foreignKey: [],
    index: [],
    removedAccountForeignKeys: [restoration],
    trigger: [],
  };
}

async function assertMutationFreeCleanupRefusal(migration, queryInterface, schema, plan) {
  const before = await cleanupStateSnapshot(schema);
  await assert.rejects(
    migration.__testing.cleanupInvocation(queryInterface, plan),
    (error) => error.code === 'TENANT_AUDIT_LOG_CLEANUP_OWNERSHIP_LOST' &&
      error.operatorRepair === true,
  );
  assert.deepEqual(await cleanupStateSnapshot(schema), before);
}

async function expectDatabaseReject(promise, pattern) {
  await assert.rejects(
    promise,
    (error) => pattern.test(String(error?.parent?.sqlMessage || error?.message || error)),
  );
}

async function waitFor(predicate, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await predicate();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('Timed out waiting for async AuditLog writer');
}

test('Feature 8.2 migration and real two-Organization/two-Club AuditLog isolation', async () => {
  assert.ok(process.env.DB_USER, 'DB_USER is required for DB-backed tenant tests');
  const database = databaseName();
  const previous = Object.fromEntries([
    ...CAPABILITY_ENV,
    'AUDIT_LOG_TEST_DB_NAME',
    'DB_NAME',
    'NODE_ENV',
    'TENANT_AUDIT_LOG_MIGRATION_FAIL_STEP',
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
  try {
    schema = await createSchemaBeforeFeature(database);
    const queryInterface = schema.getQueryInterface();
    const migration = require(`../../migrations/${FEATURE_MIGRATION_FILE}`);
    assert.equal((await migration.__testing.classifyState(queryInterface)).state, 'legacy');

    await schema.query(`
      INSERT INTO AuditLogs
        (accountId,role,action,entityType,entityId,method,path,statusCode,summary,metadata,createdAt,updatedAt)
      VALUES
        (NULL,NULL,'legacy','system',NULL,'POST','/api/legacy',200,'legacy row','{}',NOW(),NOW())
    `);
    const legacyChecksum = await selectOne(schema, `
      SELECT COUNT(*) AS count,
             SHA2(GROUP_CONCAT(CONCAT(id, ':', action, ':', path) ORDER BY id), 256) AS checksum
      FROM AuditLogs
    `);

    await queryInterface.addColumn('AuditLogs', 'organizationId', {
      allowNull: true,
      type: SequelizePackage.STRING,
    });
    await assert.rejects(migration.up(queryInterface, SequelizePackage), /refused partial schema/);
    assert.equal(
      Number((await selectOne(schema, `
        SELECT COUNT(*) AS count FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA=DATABASE()
          AND TABLE_NAME='AuditLogs' AND COLUMN_NAME='clubId'
      `)).count),
      0,
    );
    assert.deepEqual(await selectOne(schema, `
      SELECT COUNT(*) AS count,
             SHA2(GROUP_CONCAT(CONCAT(id, ':', action, ':', path) ORDER BY id), 256) AS checksum
      FROM AuditLogs
    `), legacyChecksum);
    await queryInterface.removeColumn('AuditLogs', 'organizationId');

    for (const stage of [
      'after_columns',
      'after_backfill',
      'after_account_fk',
      'after_constraints',
      'after_triggers',
    ]) {
      process.env.TENANT_AUDIT_LOG_MIGRATION_FAIL_STEP = stage;
      await assert.rejects(
        migration.up(queryInterface, SequelizePackage),
        (error) => error.code === 'TENANT_AUDIT_LOG_FORCED_FAILURE',
      );
      delete process.env.TENANT_AUDIT_LOG_MIGRATION_FAIL_STEP;
      assert.equal((await migration.__testing.classifyState(queryInterface)).state, 'legacy');
      assert.deepEqual(await selectOne(schema, `
        SELECT COUNT(*) AS count,
               SHA2(GROUP_CONCAT(CONCAT(id, ':', action, ':', path) ORDER BY id), 256) AS checksum
        FROM AuditLogs
      `), legacyChecksum);
    }

    async function captureAndRemoveLegacyAccountForeignKey() {
      const restoration = await migration.__testing
        .captureLegacyAccountForeignKeyRestoration(queryInterface);
      await queryInterface.removeConstraint('AuditLogs', restoration.constraintName);
      return {
        plan: emptyCleanupPlan(restoration),
        restoration,
      };
    }

    {
      const { plan, restoration } = await captureAndRemoveLegacyAccountForeignKey();
      await queryInterface.createTable('AuditCleanupCollision', {
        accountId: { allowNull: true, type: SequelizePackage.INTEGER },
        id: {
          allowNull: false,
          autoIncrement: true,
          primaryKey: true,
          type: SequelizePackage.INTEGER,
        },
      });
      await queryInterface.addConstraint('AuditCleanupCollision', {
        fields: ['accountId'],
        name: restoration.constraintName,
        onDelete: 'RESTRICT',
        onUpdate: 'RESTRICT',
        references: { field: 'id', table: 'Accounts' },
        type: 'foreign key',
      });
      await assertMutationFreeCleanupRefusal(
        migration,
        queryInterface,
        schema,
        plan,
      );
      await queryInterface.removeConstraint(
        'AuditCleanupCollision',
        restoration.constraintName,
      );
      await queryInterface.dropTable('AuditCleanupCollision');
      await migration.__testing.cleanupInvocation(queryInterface, plan);
      assert.equal((await migration.__testing.classifyState(queryInterface)).state, 'legacy');
    }

    {
      const { plan } = await captureAndRemoveLegacyAccountForeignKey();
      await queryInterface.changeColumn('AuditLogs', 'accountId', {
        allowNull: true,
        type: SequelizePackage.BIGINT,
      });
      await assertMutationFreeCleanupRefusal(
        migration,
        queryInterface,
        schema,
        plan,
      );
      await queryInterface.changeColumn('AuditLogs', 'accountId', {
        allowNull: true,
        type: SequelizePackage.INTEGER,
      });
      await migration.__testing.cleanupInvocation(queryInterface, plan);
      assert.equal((await migration.__testing.classifyState(queryInterface)).state, 'legacy');
    }

    {
      const { plan, restoration } = await captureAndRemoveLegacyAccountForeignKey();
      await schema.query(`
        INSERT INTO AuditLogs
          (accountId,role,action,entityType,method,path,statusCode,createdAt,updatedAt)
        VALUES
          (2147483647,NULL,'orphan','system','POST','/api/orphan',200,NOW(),NOW())
      `);
      await assertMutationFreeCleanupRefusal(
        migration,
        queryInterface,
        schema,
        plan,
      );
      await schema.query("DELETE FROM AuditLogs WHERE action='orphan'");
      await migration.__testing.cleanupInvocation(queryInterface, plan);
      const restored = await migration.__testing.getForeignKey(
        queryInterface,
        restoration.constraintName,
      );
      assert.equal(
        migration.__testing.signature('foreignKey', restored),
        restoration.foreignKeySignature,
      );
    }

    {
      const { plan, restoration } = await captureAndRemoveLegacyAccountForeignKey();
      await queryInterface.addConstraint('AuditLogs', {
        fields: ['accountId'],
        name: restoration.constraintName,
        onDelete: 'RESTRICT',
        onUpdate: 'RESTRICT',
        references: { field: 'id', table: 'Accounts' },
        type: 'foreign key',
      });
      await assertMutationFreeCleanupRefusal(
        migration,
        queryInterface,
        schema,
        plan,
      );
      await queryInterface.removeConstraint('AuditLogs', restoration.constraintName);
      await migration.__testing.cleanupInvocation(queryInterface, plan);
      assert.equal((await migration.__testing.classifyState(queryInterface)).state, 'legacy');
    }

    {
      const { plan, restoration } = await captureAndRemoveLegacyAccountForeignKey();
      await migration.__testing.cleanupInvocation(queryInterface, plan);
      const restored = await migration.__testing.getForeignKey(
        queryInterface,
        restoration.constraintName,
      );
      assert.equal(
        migration.__testing.signature('foreignKey', restored),
        restoration.foreignKeySignature,
      );
      assert.equal((await migration.__testing.classifyState(queryInterface)).state, 'legacy');
    }

    await queryInterface.addColumn('AuditLogs', 'organizationId', {
      allowNull: true,
      type: SequelizePackage.INTEGER,
    });
    const tracked = { name: 'organizationId', table: 'AuditLogs' };
    const trackedRows = await migration.__testing.readArtifact(
      queryInterface,
      'column',
      tracked,
    );
    const cleanupPlan = {
      column: [{
        ...tracked,
        signature: migration.__testing.signature('column', trackedRows),
      }],
      foreignKey: [],
      index: [],
      removedAccountForeignKeys: [],
      trigger: [],
    };
    await queryInterface.changeColumn('AuditLogs', 'organizationId', {
      allowNull: true,
      type: SequelizePackage.BIGINT,
    });
    await assertMutationFreeCleanupRefusal(
      migration,
      queryInterface,
      schema,
      cleanupPlan,
    );
    assert.equal(
      (await queryInterface.describeTable('AuditLogs')).organizationId.type
        .toUpperCase().includes('BIGINT'),
      true,
    );
    await queryInterface.removeColumn('AuditLogs', 'organizationId');

    await migration.up(queryInterface, SequelizePackage);
    assert.equal((await migration.__testing.classifyState(queryInterface)).state, 'ready');
    await migration.up(queryInterface, SequelizePackage);
    const defaultOrganization = await selectOne(
      schema,
      'SELECT id FROM Organizations WHERE slug=:slug',
      { slug: DEFAULT_ORGANIZATION_SLUG },
    );
    const defaultClub = await selectOne(
      schema,
      'SELECT id FROM Clubs WHERE organizationId=:organizationId AND slug=:slug',
      { organizationId: defaultOrganization.id, slug: DEFAULT_CLUB_SLUG },
    );
    const migratedLegacy = await selectOne(
      schema,
      "SELECT organizationId,clubId FROM AuditLogs WHERE action='legacy'",
    );
    assert.equal(Number(migratedLegacy.organizationId), Number(defaultOrganization.id));
    assert.equal(migratedLegacy.clubId, null);

    await migration.down(queryInterface, SequelizePackage);
    assert.equal((await migration.__testing.classifyState(queryInterface)).state, 'legacy');
    assert.deepEqual(await selectOne(schema, `
      SELECT COUNT(*) AS count,
             SHA2(GROUP_CONCAT(CONCAT(id, ':', action, ':', path) ORDER BY id), 256) AS checksum
      FROM AuditLogs
    `), legacyChecksum);
    await migration.up(queryInterface, SequelizePackage);
    assert.equal((await migration.__testing.classifyState(queryInterface)).state, 'ready');

    const db = require('../../models');
    const auditService = require('../../src/services/audit.service');
    const authService = require('../../src/services/auth.service');
    const clientsService = require('../../src/services/clients.service');
    const tenantContextService = require('../../src/services/tenant-context.service');

    const orgA = await db.Organization.findByPk(defaultOrganization.id);
    const clubA = await db.Club.findByPk(defaultClub.id);
    const siblingClub = await db.Club.create({
      name: 'Feature 8.2 sibling',
      organizationId: orgA.id,
      slug: `feature-8-2-sibling-${Date.now()}`,
      status: 'active',
      timezone: 'Europe/Moscow',
    });
    const orgB = await db.Organization.create({
      name: 'Feature 8.2 Organization B',
      slug: `feature-8-2-org-b-${Date.now()}`,
      status: 'active',
    });
    const clubB = await db.Club.create({
      name: 'Feature 8.2 Club B',
      organizationId: orgB.id,
      slug: `feature-8-2-club-b-${Date.now()}`,
      status: 'active',
      timezone: 'Europe/Moscow',
    });

    async function createAccount(organization, suffix, role, password = null) {
      const account = await db.Account.create({
        email: `feature-8-2-${suffix}-${Date.now()}@example.test`,
        passwordHash: password
          ? authService.hashPassword(password)
          : 'test-only',
        role,
        status: 'active',
      });
      const membership = await db.Membership.create({
        accountId: account.id,
        organizationId: organization.id,
        role,
        status: 'active',
      });
      return { account, membership };
    }

    const ownerA = await createAccount(orgA, 'owner-a', 'owner', 'AuditDemo123!');
    const ownerB = await createAccount(orgB, 'owner-b', 'owner');
    const managerA = await createAccount(orgA, 'manager-a', 'manager');
    const managerAccess = await db.MembershipClubAccess.create({
      clubId: clubA.id,
      membershipId: managerA.membership.id,
      organizationId: orgA.id,
      roleOverride: 'admin',
      status: 'active',
    });
    await db.MembershipClubAccess.create({
      clubId: siblingClub.id,
      membershipId: managerA.membership.id,
      organizationId: orgA.id,
      status: 'active',
    });

    const actorOwnerA = { id: ownerA.account.id, role: 'owner' };
    const actorOwnerB = { id: ownerB.account.id, role: 'owner' };
    const actorManagerA = { id: managerA.account.id, role: 'manager' };
    const orgTenantA = await tenantContextService.resolveTenantContext({
      accountId: ownerA.account.id,
      organizationId: orgA.id,
      scope: 'organization',
    });
    const orgTenantB = await tenantContextService.resolveTenantContext({
      accountId: ownerB.account.id,
      organizationId: orgB.id,
      scope: 'organization',
    });
    const managerOrgTenant = await tenantContextService.resolveTenantContext({
      accountId: managerA.account.id,
      organizationId: orgA.id,
      scope: 'organization',
    });
    const managerClubTenant = await tenantContextService.resolveTenantContext({
      accountId: managerA.account.id,
      clubId: clubA.id,
      organizationId: orgA.id,
      scope: 'club',
    });

    const organizationWrite = await auditService.record({
      account: actorManagerA,
      method: 'PATCH',
      path: '/api/accounts/1',
      statusCode: 200,
      tenant: managerOrgTenant,
      tenantScope: 'organization',
    });
    const clubWrite = await auditService.record({
      account: actorManagerA,
      method: 'POST',
      path: '/api/bookings',
      statusCode: 201,
      tenant: managerClubTenant,
      tenantScope: 'club',
    });
    assert.equal(organizationWrite.recorded, true);
    assert.equal(clubWrite.recorded, true);
    const storedOrganizationWrite = await db.AuditLog.findByPk(organizationWrite.auditLogId);
    const storedClubWrite = await db.AuditLog.findByPk(clubWrite.auditLogId);
    assert.equal(Number(storedOrganizationWrite.organizationId), Number(orgA.id));
    assert.equal(storedOrganizationWrite.clubId, null);
    assert.equal(storedOrganizationWrite.role, 'manager');
    assert.equal(Number(storedClubWrite.organizationId), Number(orgA.id));
    assert.equal(Number(storedClubWrite.clubId), Number(clubA.id));
    assert.equal(storedClubWrite.role, 'admin');

    for (let index = 0; index < 11; index += 1) {
      const result = await auditService.record({
        account: actorOwnerA,
        action: index % 2 === 0 ? 'create' : 'update',
        entityId: String(index + 1),
        entityType: 'fixture',
        method: 'POST',
        path: `/api/fixtures/${index + 1}`,
        statusCode: 200,
        tenant: orgTenantA,
        tenantScope: 'organization',
      });
      assert.equal(result.recorded, true);
    }
    const orgBWrite = await auditService.record({
      account: actorOwnerB,
      action: 'create',
      entityType: 'fixture',
      method: 'POST',
      path: '/api/fixtures/b',
      statusCode: 200,
      tenant: orgTenantB,
      tenantScope: 'organization',
    });
    assert.equal(orgBWrite.recorded, true);

    const sharedClientId = '424242';
    const clientAuditA = await auditService.record({
      account: actorOwnerA,
      action: 'update',
      entityId: sharedClientId,
      entityType: 'client',
      method: 'PATCH',
      path: `/api/clients/${sharedClientId}`,
      statusCode: 200,
      tenant: orgTenantA,
      tenantScope: 'organization',
    });
    const clientAuditB = await auditService.record({
      account: actorOwnerB,
      action: 'update',
      entityId: sharedClientId,
      entityType: 'client',
      method: 'PATCH',
      path: `/api/clients/${sharedClientId}`,
      statusCode: 200,
      tenant: orgTenantB,
      tenantScope: 'organization',
    });
    const clientTimelineA = await clientsService.__testing.listClientAuditTimeline(
      sharedClientId,
      actorOwnerA,
      { organizationId: orgA.id },
    );
    assert.equal(
      clientTimelineA.some((item) => item.id === `audit-${clientAuditA.auditLogId}`),
      true,
    );
    assert.equal(
      clientTimelineA.some((item) => item.id === `audit-${clientAuditB.auditLogId}`),
      false,
    );

    const pageA = await auditService.list(
      { page: 1, pageSize: 10 },
      actorOwnerA,
      orgTenantA,
    );
    const pageB = await auditService.list(
      { action: 'create', page: 1, pageSize: 10 },
      actorOwnerB,
      orgTenantB,
    );
    assert.equal(pageA.pageSize, 10);
    assert.equal(pageA.items.length, 10);
    assert.ok(pageA.total >= 13);
    assert.equal(pageA.items.some((item) => item.id === orgBWrite.auditLogId), false);
    assert.equal(pageB.total, 1);
    assert.equal(pageB.items[0].id, orgBWrite.auditLogId);

    const beforeForged = await db.AuditLog.count();
    const forged = await auditService.record({
      account: actorOwnerA,
      method: 'POST',
      path: '/api/forged',
      statusCode: 200,
      tenant: Object.freeze({ ...orgTenantA }),
      tenantScope: 'organization',
    });
    assert.equal(forged.recorded, false);
    assert.equal(await db.AuditLog.count(), beforeForged);

    await managerA.membership.update({ status: 'archived' });
    const staleWriter = await auditService.record({
      account: actorManagerA,
      method: 'POST',
      path: '/api/stale',
      statusCode: 200,
      tenant: managerClubTenant,
      tenantScope: 'club',
    });
    assert.equal(staleWriter.recorded, false);
    await assert.rejects(
      auditService.list({ page: 1, pageSize: 10 }, actorManagerA, managerOrgTenant),
      (error) => error.code === 'TENANT_CONTEXT_NOT_FOUND',
    );
    await managerA.membership.update({ status: 'active' });

    await expectDatabaseReject(
      storedClubWrite.update({ role: 'owner' }),
      /immutable/,
    );
    await expectDatabaseReject(
      db.AuditLog.update(
        { summary: 'bulk mutation' },
        { where: { id: storedClubWrite.id } },
      ),
      /immutable|attribution is required/,
    );
    await expectDatabaseReject(
      schema.query('UPDATE AuditLogs SET summary="raw mutation" WHERE id=:id', {
        replacements: { id: storedClubWrite.id },
      }),
      /immutable/,
    );
    await expectDatabaseReject(
      schema.query('DELETE FROM AuditLogs WHERE id=:id', {
        replacements: { id: storedClubWrite.id },
      }),
      /immutable/,
    );
    await expectDatabaseReject(
      schema.query(`
        INSERT INTO AuditLogs
          (organizationId,clubId,accountId,role,action,entityType,method,path,statusCode,createdAt,updatedAt)
        VALUES
          (:organizationId,:clubId,:accountId,'owner','create','fixture','POST','/api/raw',200,NOW(),NOW())
      `, {
        replacements: {
          accountId: ownerA.account.id,
          clubId: clubB.id,
          organizationId: orgA.id,
        },
      }),
      /club provenance is invalid/,
    );
    await expectDatabaseReject(
      schema.query(`
        INSERT INTO AuditLogs
          (organizationId,clubId,accountId,role,action,entityType,method,path,statusCode,createdAt,updatedAt)
        VALUES
          (:organizationId,NULL,:accountId,'manager','create','fixture','POST','/api/raw-role',200,NOW(),NOW())
      `, {
        replacements: {
          accountId: ownerA.account.id,
          organizationId: orgA.id,
        },
      }),
      /actor tenant authority mismatch/,
    );

    const lifecycleActor = await createAccount(orgA, 'lifecycle', 'admin');
    const lifecycleAccess = await db.MembershipClubAccess.create({
      clubId: clubA.id,
      membershipId: lifecycleActor.membership.id,
      organizationId: orgA.id,
      status: 'active',
    });
    const lifecycleTenant = await tenantContextService.resolveTenantContext({
      accountId: lifecycleActor.account.id,
      clubId: clubA.id,
      organizationId: orgA.id,
      scope: 'club',
    });
    const lifecycleWrite = await auditService.record({
      account: { id: lifecycleActor.account.id, role: 'admin' },
      method: 'POST',
      path: '/api/lifecycle',
      statusCode: 200,
      tenant: lifecycleTenant,
      tenantScope: 'club',
    });
    assert.equal(lifecycleWrite.recorded, true);
    await lifecycleAccess.destroy();
    await lifecycleActor.membership.destroy();
    await lifecycleActor.account.destroy();
    const preservedLifecycleLog = await db.AuditLog.findByPk(lifecycleWrite.auditLogId);
    assert.equal(Number(preservedLifecycleLog.accountId), Number(lifecycleActor.account.id));
    assert.equal(preservedLifecycleLog.role, 'admin');

    const { auditMutations } = require('../../src/middleware/audit');
    const failedResponse = new EventEmitter();
    failedResponse.statusCode = 400;
    let middlewareContinued = false;
    auditMutations({
      account: actorOwnerA,
      app: { get: () => undefined },
      body: {},
      method: 'POST',
      originalUrl: '/api/accounts',
      params: {},
      query: {},
      tenant: orgTenantA,
      tenantRoute: { classification: 'organization' },
      url: '/api/accounts',
    }, failedResponse, () => {
      middlewareContinued = true;
    });
    assert.equal(middlewareContinued, true);
    failedResponse.emit('finish');
    const failedLog = await waitFor(() => db.AuditLog.findOne({
      where: {
        accountId: ownerA.account.id,
        action: 'post.failed',
        path: '/api/accounts',
        statusCode: 400,
      },
    }));
    assert.equal(Number(failedLog.organizationId), Number(orgA.id));
    assert.equal(failedLog.clubId, null);

    process.env.TENANT_AUDIT_LOG_ENABLED = 'false';
    const flagOffWrite = await auditService.record({
      account: actorOwnerA,
      action: 'flag_off_parity',
      entityType: 'fixture',
      method: 'POST',
      path: '/api/flag-off-parity',
      statusCode: 200,
    });
    assert.equal(flagOffWrite.recorded, true);
    const flagOffStored = await db.AuditLog.findByPk(flagOffWrite.auditLogId);
    assert.equal(Number(flagOffStored.organizationId), Number(orgA.id));
    assert.equal(flagOffStored.clubId, null);
    const flagOffList = await auditService.list(
      { action: 'flag_off_parity', page: 1, pageSize: 10 },
      actorOwnerA,
    );
    assert.equal(flagOffList.total, 1);
    assert.equal('organizationId' in flagOffList.items[0], false);
    assert.equal('clubId' in flagOffList.items[0], false);
    process.env.TENANT_AUDIT_LOG_ENABLED = 'true';

    const beforeRollbackState = await migration.__testing.classifyState(queryInterface);
    await assert.rejects(
      migration.down(queryInterface, SequelizePackage),
      (error) => error.code === 'TENANT_AUDIT_LOG_ROLLBACK_SECOND_ORGANIZATION',
    );
    assert.deepEqual(
      await migration.__testing.classifyState(queryInterface),
      beforeRollbackState,
    );

    assert.equal(Number(managerAccess.clubId), Number(clubA.id));
  } finally {
    if (schema) await schema.close();
    restoreEnv(previous);
    await admin.query(`DROP DATABASE IF EXISTS \`${database}\``);
    await admin.end();
  }
});
