'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
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
const FEATURE_MIGRATION_FILE = '20260719160000-add-tenant-shifts-reports.js';
const CAPABILITY_ENV = ACCEPTED_TENANT_CAPABILITY_ENV;

function databaseName() {
  return process.env.SHIFTS_REPORTS_TEST_DB_NAME ||
    `setly_shifts_f8_1_${process.pid}_${Date.now()}`;
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

async function expectDatabaseReject(promise, pattern) {
  await assert.rejects(
    promise,
    (error) => pattern.test(String(error?.parent?.sqlMessage || error?.message || error)),
  );
}

test('Feature 8.1 migration and two-Organization/two-Club shift isolation', async () => {
  assert.ok(process.env.DB_USER, 'DB_USER is required for DB-backed tenant tests');
  const database = databaseName();
  const previous = Object.fromEntries([
    ...CAPABILITY_ENV,
    'DB_NAME',
    'NODE_ENV',
    'SETLY_STORAGE_ROOT',
    'TENANT_SHIFTS_REPORTS_MIGRATION_FAIL_STEP',
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
  const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'setly-shifts-f81-'));
  process.env.SETLY_STORAGE_ROOT = storageRoot;
  for (const name of CAPABILITY_ENV) process.env[name] = 'true';

  let schema;
  let db;
  try {
    schema = await createSchemaBeforeFeature(database);
    const queryInterface = schema.getQueryInterface();
    const migration = require(`../../migrations/${FEATURE_MIGRATION_FILE}`);
    assert.notEqual(
      migration.__testing.normalizeSql("SET NEW.comment = 'shift-ready'"),
      migration.__testing.normalizeSql("SET NEW.comment = 'SHIFT-READY'"),
    );
    assert.equal((await migration.__testing.classifyState(queryInterface)).state, 'legacy');

    await queryInterface.addIndex('Shifts', ['date'], {
      name: 'lookalike_shifts_club_date_idx',
    });
    assert.equal((await migration.__testing.classifyState(queryInterface)).state, 'legacy');
    await queryInterface.removeIndex('Shifts', 'lookalike_shifts_club_date_idx');

    await queryInterface.addColumn('Shifts', 'clubId', {
      allowNull: true,
      type: SequelizePackage.STRING,
    });
    await assert.rejects(migration.up(queryInterface, SequelizePackage), /refused partial schema/);
    assert.equal(
      Number((await selectOne(schema, `
        SELECT COUNT(*) AS count FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA=DATABASE()
          AND TABLE_NAME='ShiftReports' AND COLUMN_NAME='clubId'
      `)).count),
      0,
    );
    await queryInterface.removeColumn('Shifts', 'clubId');

    for (const stage of [
      'after_columns',
      'after_backfill',
      'after_constraints',
      'after_triggers',
    ]) {
      process.env.TENANT_SHIFTS_REPORTS_MIGRATION_FAIL_STEP = stage;
      await assert.rejects(
        migration.up(queryInterface, SequelizePackage),
        (error) => error.code === 'TENANT_SHIFTS_REPORTS_FORCED_FAILURE',
      );
      delete process.env.TENANT_SHIFTS_REPORTS_MIGRATION_FAIL_STEP;
      assert.equal((await migration.__testing.classifyState(queryInterface)).state, 'legacy');
    }

    const tracked = { name: 'clubId', table: 'Shifts' };
    await queryInterface.addColumn(tracked.table, tracked.name, {
      allowNull: true,
      type: SequelizePackage.INTEGER,
    });
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
      trigger: [],
    };
    await queryInterface.changeColumn(tracked.table, tracked.name, {
      allowNull: true,
      type: SequelizePackage.BIGINT,
    });
    await assert.rejects(
      migration.__testing.cleanupInvocation(queryInterface, cleanupPlan),
      (error) => error.code === 'TENANT_SHIFTS_REPORTS_CLEANUP_OWNERSHIP_LOST',
    );
    assert.equal(
      (await queryInterface.describeTable('Shifts')).clubId.type
        .toUpperCase().includes('BIGINT'),
      true,
    );
    await queryInterface.removeColumn(tracked.table, tracked.name);

    await queryInterface.createTable('FeatureF81CleanupParents', {
      id: { autoIncrement: true, primaryKey: true, type: SequelizePackage.INTEGER },
    });
    await queryInterface.createTable('FeatureF81CleanupChildren', {
      id: { autoIncrement: true, primaryKey: true, type: SequelizePackage.INTEGER },
      parentAId: { allowNull: true, type: SequelizePackage.INTEGER },
      parentBId: { allowNull: true, type: SequelizePackage.INTEGER },
    });
    await queryInterface.addIndex('FeatureF81CleanupChildren', ['parentAId'], {
      name: 'feature_f81_cleanup_parent_a_idx',
    });
    await queryInterface.addIndex('FeatureF81CleanupChildren', ['parentBId'], {
      name: 'feature_f81_cleanup_parent_b_idx',
    });
    const ownershipCases = [
      {
        kind: 'index',
        item: { name: 'feature_f81_cleanup_idx', table: 'Shifts' },
        async createOriginal() {
          await queryInterface.addIndex('Shifts', ['date'], {
            name: 'feature_f81_cleanup_idx',
          });
        },
        async replaceWithLookalike() {
          await queryInterface.removeIndex('Shifts', 'feature_f81_cleanup_idx');
          await queryInterface.addIndex('Shifts', ['status', 'date'], {
            name: 'feature_f81_cleanup_idx',
          });
        },
        async remove() {
          await queryInterface.removeIndex('Shifts', 'feature_f81_cleanup_idx');
        },
      },
      {
        kind: 'foreignKey',
        item: { name: 'feature_f81_cleanup_fk', table: 'FeatureF81CleanupChildren' },
        async createOriginal() {
          await queryInterface.addConstraint('FeatureF81CleanupChildren', {
            fields: ['parentAId'],
            name: 'feature_f81_cleanup_fk',
            onDelete: 'SET NULL',
            onUpdate: 'CASCADE',
            references: { field: 'id', table: 'FeatureF81CleanupParents' },
            type: 'foreign key',
          });
        },
        async replaceWithLookalike() {
          await queryInterface.removeConstraint(
            'FeatureF81CleanupChildren',
            'feature_f81_cleanup_fk',
          );
          await queryInterface.addConstraint('FeatureF81CleanupChildren', {
            fields: ['parentBId'],
            name: 'feature_f81_cleanup_fk',
            onDelete: 'SET NULL',
            onUpdate: 'CASCADE',
            references: { field: 'id', table: 'FeatureF81CleanupParents' },
            type: 'foreign key',
          });
        },
        async remove() {
          await queryInterface.removeConstraint(
            'FeatureF81CleanupChildren',
            'feature_f81_cleanup_fk',
          );
        },
      },
      {
        kind: 'trigger',
        item: { name: 'feature_f81_cleanup_bu', table: 'Shifts' },
        async createOriginal() {
          await schema.query(`
            CREATE TRIGGER feature_f81_cleanup_bu BEFORE UPDATE ON Shifts
            FOR EACH ROW SET NEW.comment = 'shift-ready'
          `);
        },
        async replaceWithLookalike() {
          await schema.query('DROP TRIGGER feature_f81_cleanup_bu');
          await schema.query(`
            CREATE TRIGGER feature_f81_cleanup_bu BEFORE UPDATE ON Shifts
            FOR EACH ROW SET NEW.comment = 'SHIFT-READY'
          `);
        },
        async remove() {
          await schema.query('DROP TRIGGER feature_f81_cleanup_bu');
        },
      },
    ];
    for (const ownershipCase of ownershipCases) {
      await ownershipCase.createOriginal();
      const originalRows = await migration.__testing.readArtifact(
        queryInterface,
        ownershipCase.kind,
        ownershipCase.item,
      );
      const plan = { column: [], foreignKey: [], index: [], trigger: [] };
      plan[ownershipCase.kind].push({
        ...ownershipCase.item,
        signature: migration.__testing.signature(
          ownershipCase.kind,
          originalRows,
        ),
      });
      await ownershipCase.replaceWithLookalike();
      await assert.rejects(
        migration.__testing.cleanupInvocation(queryInterface, plan),
        (error) => error.code === 'TENANT_SHIFTS_REPORTS_CLEANUP_OWNERSHIP_LOST',
      );
      assert.notEqual(
        migration.__testing.signature(
          ownershipCase.kind,
          await migration.__testing.readArtifact(
            queryInterface,
            ownershipCase.kind,
            ownershipCase.item,
          ),
        ),
        plan[ownershipCase.kind][0].signature,
      );
      await ownershipCase.remove();
    }
    await queryInterface.dropTable('FeatureF81CleanupChildren');
    await queryInterface.dropTable('FeatureF81CleanupParents');

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
    await schema.query(`
      INSERT INTO ShiftReportTemplates
        (clubId,name,status,scheduleType,scheduleConfig,gracePeriodMinutes,version,sortOrder,createdAt,updatedAt)
      VALUES
        (:clubId,'Feature 8.1 down-up','active','shift_end','{}',30,1,0,NOW(),NOW())
    `, { replacements: { clubId: defaultClub.id } });
    await migration.down(queryInterface, SequelizePackage);
    assert.equal((await migration.__testing.classifyState(queryInterface)).state, 'legacy');
    await migration.up(queryInterface, SequelizePackage);
    assert.equal((await migration.__testing.classifyState(queryInterface)).state, 'ready');
    assert.equal(
      Number((await selectOne(
        schema,
        "SELECT COUNT(*) AS count FROM ShiftReportTemplates WHERE name='Feature 8.1 down-up'",
      )).count),
      1,
    );

    await applyAcceptedTenantMigrations(queryInterface, {
      afterFile: FEATURE_MIGRATION_FILE,
    });

    db = require('../../models');
    const tenantContextService = require('../../src/services/tenant-context.service');
    const shiftsService = require('../../src/services/shifts.service');
    const reportsService = require('../../src/services/shift-reports.service');
    const motivationService = require('../../src/services/motivation.service');
    const payrollService = require('../../src/services/payroll.service');

    const orgA = await db.Organization.findByPk(defaultOrganization.id);
    const clubA = await db.Club.findByPk(defaultClub.id);
    const siblingClub = await db.Club.create({
      name: 'Feature 8.1 sibling',
      organizationId: orgA.id,
      slug: `feature-8-1-sibling-${Date.now()}`,
      status: 'active',
      timezone: 'Europe/Moscow',
    });
    const orgB = await db.Organization.create({
      name: 'Feature 8.1 Organization B',
      slug: `feature-8-1-org-b-${Date.now()}`,
      status: 'active',
    });
    const clubB = await db.Club.create({
      name: 'Feature 8.1 Club B',
      organizationId: orgB.id,
      slug: `feature-8-1-club-b-${Date.now()}`,
      status: 'active',
      timezone: 'Europe/Moscow',
    });

    async function createOwner(organization, suffix) {
      const account = await db.Account.create({
        email: `feature-8-1-owner-${suffix}-${Date.now()}@example.test`,
        passwordHash: 'test-only',
        role: 'owner',
        status: 'active',
      });
      await db.Membership.create({
        accountId: account.id,
        organizationId: organization.id,
        role: 'owner',
        status: 'active',
      });
      return account;
    }
    async function createStaff(organization, club, suffix) {
      const staff = await db.Staff.create({
        name: `Feature 8.1 Staff ${suffix}`,
        organizationId: organization.id,
        role: 'Администратор',
        status: 'active',
      });
      const account = await db.Account.create({
        email: `feature-8-1-staff-${suffix}-${Date.now()}@example.test`,
        passwordHash: 'test-only',
        role: 'admin',
        staffId: staff.id,
        status: 'active',
      });
      const membership = await db.Membership.create({
        accountId: account.id,
        organizationId: organization.id,
        role: 'admin',
        staffId: staff.id,
        status: 'active',
      });
      const clubAccess = await db.MembershipClubAccess.create({
        clubId: club.id,
        membershipId: membership.id,
        organizationId: organization.id,
        status: 'active',
      });
      return { account, clubAccess, membership, staff };
    }

    const ownerA = await createOwner(orgA, 'a');
    const ownerB = await createOwner(orgB, 'b');
    const staffA = await createStaff(orgA, clubA, 'a');
    const staffSibling = await createStaff(orgA, siblingClub, 'sibling');
    const staffB = await createStaff(orgB, clubB, 'b');
    const actorA = { id: ownerA.id, role: 'owner' };
    const actorB = { id: ownerB.id, role: 'owner' };
    const tenantA = await tenantContextService.resolveTenantContext({
      accountId: ownerA.id,
      clubId: clubA.id,
      organizationId: orgA.id,
      scope: 'club',
    });
    const tenantSibling = await tenantContextService.resolveTenantContext({
      accountId: ownerA.id,
      clubId: siblingClub.id,
      organizationId: orgA.id,
      scope: 'club',
    });
    const tenantB = await tenantContextService.resolveTenantContext({
      accountId: ownerB.id,
      clubId: clubB.id,
      organizationId: orgB.id,
      scope: 'club',
    });
    const organizationTenantA = await tenantContextService.resolveTenantContext({
      accountId: ownerA.id,
      organizationId: orgA.id,
      scope: 'organization',
    });
    const organizationTenantB = await tenantContextService.resolveTenantContext({
      accountId: ownerB.id,
      organizationId: orgB.id,
      scope: 'organization',
    });

    const templatePayload = {
      name: 'Ежедневный отчет',
      scheduleConfig: { time: '18:00', times: ['18:00'] },
      scheduleType: 'once_daily',
      status: 'active',
    };
    const templateA = await reportsService.createTemplate(templatePayload, actorA, tenantA);
    await reportsService.createTemplateItem(templateA.id, {
      itemType: 'text',
      label: 'Комментарий',
      photoRequired: true,
      required: true,
      status: 'active',
    }, actorA, tenantA);
    const templateSibling = await reportsService.createTemplate(
      templatePayload,
      actorA,
      tenantSibling,
    );
    const siblingItem = await db.ShiftReportTemplateItem.create({
      itemType: 'text',
      label: 'Sibling',
      photoRequired: false,
      required: false,
      sortOrder: 0,
      status: 'active',
      templateId: templateSibling.id,
    });
    const templateB = await reportsService.createTemplate(templatePayload, actorB, tenantB);

    const shiftA = await shiftsService.create({
      adminName: staffA.staff.name,
      date: '2099-08-01',
      hours: 8,
      staffId: staffA.staff.id,
      status: 'closed',
    }, actorA, tenantA);
    const shiftSibling = await shiftsService.create({
      adminName: staffSibling.staff.name,
      date: '2099-08-01',
      hours: 8,
      staffId: staffSibling.staff.id,
      status: 'closed',
    }, actorA, tenantSibling);
    const shiftB = await shiftsService.create({
      adminName: staffB.staff.name,
      date: '2099-08-01',
      hours: 8,
      staffId: staffB.staff.id,
      status: 'closed',
    }, actorB, tenantB);

    const activeStartedAt = new Date('2099-08-01T10:00:00.000Z');
    const activeShiftA = await db.Shift.create({
      adminName: staffA.staff.name,
      clubId: clubA.id,
      date: '2099-08-01',
      hours: 0,
      staffId: staffA.staff.id,
      startedAt: activeStartedAt,
      status: 'active',
    });
    const activeShiftB = await db.Shift.create({
      adminName: staffB.staff.name,
      clubId: clubB.id,
      date: '2099-08-01',
      hours: 0,
      staffId: staffB.staff.id,
      startedAt: activeStartedAt,
      status: 'active',
    });
    await Promise.all([
      reportsService.ensureReportsForShift(activeShiftA, tenantA),
      reportsService.ensureReportsForShift(activeShiftA, tenantA),
    ]);
    assert.equal(
      await db.ShiftReport.count({
        where: { shiftId: activeShiftA.id, templateId: templateA.id },
      }),
      1,
    );
    async function createReceipt(organization, club, suffix, amount) {
      const receipt = await db.Receipt.create({
        cash: amount,
        cashless: 0,
        clubId: club.id,
        dateTime: new Date('2099-08-01T11:00:00.000Z'),
        evotorId: `feature-8-1-${suffix}-${Date.now()}`,
        organizationId: organization.id,
        totalAmount: amount,
        type: 'SELL',
      });
      await db.ReceiptItem.create({
        name: 'Feature 8.1 sale',
        price: amount,
        quantity: 1,
        receiptId: receipt.id,
        sum: amount,
        sumPrice: amount,
      });
      return receipt;
    }
    await createReceipt(orgA, clubA, 'a', 100);
    await createReceipt(orgB, clubB, 'b', 900);
    const currentSalesA = await motivationService.getCurrentShiftSales(
      { includePaymentSummary: true },
      actorA,
      tenantA,
    );
    assert.equal(currentSalesA.paymentSummary.total, 100);
    const payrollA = await payrollService.buildPayrollSnapshot(
      '2099-08-01',
      '2099-08-01',
      actorA,
      organizationTenantA,
    );
    assert.equal(
      payrollA.shifts.some((row) => Number(row.id) === Number(shiftB.id)),
      false,
    );
    assert.equal(
      payrollA.shifts.some((row) => Number(row.id) === Number(activeShiftB.id)),
      false,
    );
    assert.equal(
      payrollA.shifts.some((row) => Number(row.id) === Number(activeShiftA.id)),
      true,
    );
    const reviewedPeriodA = await db.PayrollPeriod.create({
      fromDate: '2099-08-01',
      reviewedAt: new Date(),
      reviewedByAccountId: ownerA.id,
      snapshot: payrollA,
      status: 'reviewed',
      toDate: '2099-08-01',
    });
    const savedPayrollA = await payrollService.calculatePayroll(
      '2099-08-01',
      '2099-08-01',
      actorA,
      organizationTenantA,
    );
    assert.equal(savedPayrollA.source, 'snapshot');
    assert.equal(savedPayrollA.tenantProvenance, undefined);
    await assert.rejects(
      payrollService.calculatePayroll(
        '2099-08-01',
        '2099-08-01',
        actorB,
        organizationTenantB,
      ),
      (error) => error.code === 'TENANT_PAYROLL_SNAPSHOT_NOT_FOUND',
    );
    await assert.rejects(
      payrollService.calculatePayroll('2099-08-01', '2099-08-01'),
      (error) => error.code === 'TENANT_CONTEXT_NOT_FOUND',
    );
    await assert.rejects(
      payrollService.calculatePayroll(
        '2099-08-01',
        '2099-08-01',
        actorB,
        organizationTenantA,
      ),
      (error) => error.code === 'TENANT_CONTEXT_NOT_FOUND',
    );
    await assert.rejects(
      payrollService.calculatePayroll(
        '2099-08-01',
        '2099-08-01',
        actorA,
        { ...organizationTenantA },
      ),
      (error) => error.code === 'TENANT_CONTEXT_NOT_FOUND',
    );
    assert.equal(
      (await payrollService.listPeriods({}, actorA, organizationTenantA))
        .some((period) => Number(period.id) === Number(reviewedPeriodA.id)),
      true,
    );
    assert.equal(
      (await payrollService.listPeriods({}, actorB, organizationTenantB))
        .some((period) => Number(period.id) === Number(reviewedPeriodA.id)),
      false,
    );
    assert.ok(
      (await payrollService.exportPayroll(
        { periodId: reviewedPeriodA.id },
        actorA,
        organizationTenantA,
      )).buffer.length > 0,
    );
    await assert.rejects(
      payrollService.exportPayroll(
        { periodId: reviewedPeriodA.id },
        actorB,
        organizationTenantB,
      ),
      (error) => error.code === 'TENANT_PAYROLL_SNAPSHOT_NOT_FOUND',
    );
    await assert.rejects(
      payrollService.transitionPeriod(
        reviewedPeriodA.id,
        { status: 'approved' },
        actorB,
        organizationTenantB,
      ),
      (error) => error.code === 'TENANT_PAYROLL_SNAPSHOT_NOT_FOUND',
    );
    await payrollService.transitionPeriod(
      reviewedPeriodA.id,
      { status: 'approved' },
      actorA,
      organizationTenantA,
    );
    assert.equal((await reviewedPeriodA.reload()).status, 'approved');
    const draftSnapshotA = await payrollService.buildPayrollSnapshot(
      '2099-08-02',
      '2099-08-02',
      actorA,
      organizationTenantA,
    );
    const draftPeriodA = await db.PayrollPeriod.create({
      fromDate: '2099-08-02',
      snapshot: draftSnapshotA,
      status: 'draft',
      toDate: '2099-08-02',
    });
    await assert.rejects(
      payrollService.recalculatePeriod(
        draftPeriodA.id,
        actorB,
        'cross organization',
        organizationTenantB,
      ),
      (error) => error.code === 'TENANT_PAYROLL_SNAPSHOT_NOT_FOUND',
    );
    await payrollService.recalculatePeriod(
      draftPeriodA.id,
      actorA,
      'same organization',
      organizationTenantA,
    );

    const templatesA = await reportsService.listTemplates({}, actorA, tenantA);
    assert.equal(templatesA.some((row) => Number(row.id) === Number(templateA.id)), true);
    assert.equal(
      templatesA.some((row) => Number(row.id) === Number(templateSibling.id)),
      false,
    );
    assert.deepEqual(
      (await reportsService.listTemplates({}, actorA, tenantSibling)).map((row) => row.id),
      [templateSibling.id],
    );
    assert.deepEqual(
      (await reportsService.listTemplates({}, actorB, tenantB)).map((row) => row.id),
      [templateB.id],
    );
    await assert.rejects(
      reportsService.getTemplate(templateA.id, actorA, tenantSibling),
      /Шаблон отчета не найден/,
    );
    const reportsA = await reportsService.listReports({}, actorA, tenantA);
    assert.equal((await reportsService.listReports({}, actorA, tenantSibling)).length, 1);
    assert.equal((await reportsService.listReports({}, actorB, tenantB)).length, 0);
    assert.ok(shiftA.id && shiftSibling.id && shiftB.id);

    const reportA = await db.ShiftReport.findOne({
      where: { shiftId: shiftA.id, templateId: templateA.id },
    });
    const siblingReport = await db.ShiftReport.findOne({
      where: { shiftId: shiftSibling.id, templateId: templateSibling.id },
    });
    assert.ok(siblingReport);
    assert.equal(reportsA.some((row) => Number(row.id) === Number(reportA.id)), true);
    await assert.rejects(
      reportsService.getReport(reportA.id, actorA, tenantSibling),
      /Отчет смены не найден/,
    );
    await assert.rejects(
      reportsService.getReport(reportA.id, { id: ownerB.id, role: 'owner' }, tenantA),
      (error) => error.code === 'TENANT_CONTEXT_NOT_FOUND',
    );
    await assert.rejects(
      reportsService.listReports({}, actorA, { ...tenantA }),
      (error) => error.code === 'TENANT_CONTEXT_NOT_FOUND',
    );
    const ownerMembershipA = await db.Membership.findOne({
      where: { accountId: ownerA.id, organizationId: orgA.id },
    });
    await ownerMembershipA.update({ role: 'viewer' });
    await assert.rejects(
      reportsService.listReports({}, actorA, tenantA),
      (error) => error.code === 'TENANT_CONTEXT_NOT_FOUND',
    );
    await assert.rejects(
      payrollService.calculatePayroll(
        '2099-08-01',
        '2099-08-01',
        actorA,
        organizationTenantA,
      ),
      (error) => error.code === 'TENANT_CONTEXT_NOT_FOUND' || error.statusCode === 403,
    );
    await ownerMembershipA.update({ role: 'owner' });
    const staffTenantA = await tenantContextService.resolveTenantContext({
      accountId: staffA.account.id,
      clubId: clubA.id,
      organizationId: orgA.id,
      scope: 'club',
    });
    await reportsService.listReports(
      {},
      { id: staffA.account.id, role: 'admin' },
      staffTenantA,
    );
    await staffA.clubAccess.update({ roleOverride: 'viewer' });
    await assert.rejects(
      reportsService.listReports(
        {},
        { id: staffA.account.id, role: 'admin' },
        staffTenantA,
      ),
      (error) => error.statusCode === 403,
    );
    await staffA.clubAccess.update({ roleOverride: null });

    const answerA = await db.ShiftReportAnswer.findOne({
      where: { reportId: reportA.id },
    });
    const uploaded = await reportsService.uploadAttachment(
      reportA.id,
      answerA.id,
      {
        data: 'data:image/png;base64,aGVsbG8=',
        fileName: 'feature-8-1.png',
      },
      actorA,
      tenantA,
    );
    const attachment = uploaded.attachments[0];
    await answerA.reload();
    const storedAttachments = typeof answerA.attachments === 'string'
      ? JSON.parse(answerA.attachments)
      : answerA.attachments;
    const storedAttachment = storedAttachments[0];
    assert.equal(Number(storedAttachment.clubId), Number(clubA.id));
    assert.equal(Number(storedAttachment.organizationId), Number(orgA.id));
    const storedFile = await reportsService.getAttachment(
      reportA.id,
      answerA.id,
      attachment.id,
      actorA,
      tenantA,
    );
    assert.equal(
      fs.existsSync(storedFile.absolutePath),
      true,
    );
    const templateItemA = await db.ShiftReportTemplateItem.findByPk(
      answerA.templateItemId,
    );
    await expectDatabaseReject(
      templateItemA.update({ templateId: templateSibling.id }),
      /template item parent is immutable/i,
    );
    await templateItemA.reload();
    assert.equal(Number(templateItemA.templateId), Number(templateA.id));
    await expectDatabaseReject(
      db.sequelize.query(
        'UPDATE ShiftReportTemplateItems SET templateId=:templateId WHERE id=:id',
        { replacements: { id: templateItemA.id, templateId: templateSibling.id } },
      ),
      /template item parent is immutable/i,
    );
    const attachmentMetadataBefore = JSON.stringify(storedAttachments);
    await expectDatabaseReject(
      answerA.update({
        reportId: siblingReport.id,
        templateItemId: siblingItem.id,
      }),
      /answer parent is immutable/i,
    );
    await answerA.reload();
    assert.equal(Number(answerA.reportId), Number(reportA.id));
    assert.equal(
      JSON.stringify(
        typeof answerA.attachments === 'string'
          ? JSON.parse(answerA.attachments)
          : answerA.attachments,
      ),
      attachmentMetadataBefore,
    );
    await expectDatabaseReject(
      db.sequelize.query(`
        UPDATE ShiftReportAnswers
        SET reportId=:reportId, templateItemId=:templateItemId
        WHERE id=:id
      `, {
        replacements: {
          id: answerA.id,
          reportId: siblingReport.id,
          templateItemId: siblingItem.id,
        },
      }),
      /answer parent is immutable/i,
    );
    await answerA.reload();
    assert.equal(Number(answerA.reportId), Number(reportA.id));
    assert.equal(fs.existsSync(storedFile.absolutePath), true);
    assert.equal(
      JSON.stringify(
        typeof answerA.attachments === 'string'
          ? JSON.parse(answerA.attachments)
          : answerA.attachments,
      ),
      attachmentMetadataBefore,
    );
    await assert.rejects(
      reportsService.getAttachment(
        reportA.id,
        answerA.id,
        attachment.id,
        actorA,
        tenantSibling,
      ),
      /Отчет смены не найден/,
    );
    await reportsService.removeAttachment(
      reportA.id,
      answerA.id,
      attachment.id,
      actorA,
      tenantA,
    );

    await expectDatabaseReject(
      db.sequelize.query(
        'UPDATE Shifts SET clubId=:clubId WHERE id=:id',
        { replacements: { clubId: siblingClub.id, id: shiftA.id } },
      ),
      /clubId is immutable/,
    );
    await expectDatabaseReject(
      db.ShiftReport.create({
        clubId: siblingClub.id,
        itemsSnapshot: [],
        scheduledAt: new Date(),
        scheduledSlotKey: `cross-${Date.now()}`,
        shiftId: shiftA.id,
        status: 'pending',
        templateId: templateSibling.id,
        templateSnapshot: {},
        templateVersion: 1,
      }),
      /report shift club mismatch/i,
    );
    await expectDatabaseReject(
      answerA.update({ templateItemId: siblingItem.id }),
      /answer template item mismatch/i,
    );
    const cashSessionA = await db.ShiftCashSession.create({
      contextKey: 'feature-8-1-a',
      shiftId: shiftA.id,
      status: 'open',
    });
    const cashSessionSibling = await db.ShiftCashSession.create({
      contextKey: 'feature-8-1-sibling',
      shiftId: shiftSibling.id,
      status: 'open',
    });
    const cashExpenseAttachments = [{
      id: 'feature-8-1-cash-attachment',
      path: 'tenant/feature-8-1-cash-attachment.png',
    }];
    const cashExpenseA = await db.ShiftCashExpense.create({
      amount: 100,
      attachments: cashExpenseAttachments,
      cashSessionId: cashSessionA.id,
      description: 'Feature 8.1 expense',
      shiftId: shiftA.id,
      spentAt: new Date('2099-08-01T12:00:00.000Z'),
      status: 'active',
    });
    await expectDatabaseReject(
      cashSessionA.update({ shiftId: shiftSibling.id }),
      /cash session parent is immutable/i,
    );
    await cashSessionA.reload();
    assert.equal(Number(cashSessionA.shiftId), Number(shiftA.id));
    await expectDatabaseReject(
      db.sequelize.query(
        'UPDATE ShiftCashSessions SET shiftId=:shiftId WHERE id=:id',
        { replacements: { id: cashSessionA.id, shiftId: shiftSibling.id } },
      ),
      /cash session parent is immutable/i,
    );
    await expectDatabaseReject(
      cashExpenseA.update({ shiftId: shiftSibling.id }),
      /cash expense shift parent is immutable/i,
    );
    await cashExpenseA.reload();
    await expectDatabaseReject(
      cashExpenseA.update({ cashSessionId: cashSessionSibling.id }),
      /cash expense session parent is immutable/i,
    );
    await cashExpenseA.reload();
    await expectDatabaseReject(
      db.sequelize.query(`
        UPDATE ShiftCashExpenses
        SET shiftId=:shiftId, cashSessionId=:cashSessionId
        WHERE id=:id
      `, {
        replacements: {
          cashSessionId: cashSessionSibling.id,
          id: cashExpenseA.id,
          shiftId: shiftSibling.id,
        },
      }),
      /cash expense shift parent is immutable/i,
    );
    await expectDatabaseReject(
      db.ShiftCashExpense.create({
        amount: 50,
        attachments: [],
        cashSessionId: cashSessionSibling.id,
        description: 'Inconsistent parents',
        shiftId: shiftA.id,
        spentAt: new Date('2099-08-01T13:00:00.000Z'),
        status: 'active',
      }),
      /cash expense session mismatch/i,
    );
    await expectDatabaseReject(
      db.sequelize.query(`
        INSERT INTO ShiftCashExpenses
          (shiftId,cashSessionId,amount,description,spentAt,status,attachments,isTraining,createdAt,updatedAt)
        VALUES
          (:shiftId,:cashSessionId,50,'Raw inconsistent parents',NOW(),'active','[]',0,NOW(),NOW())
      `, {
        replacements: {
          cashSessionId: cashSessionSibling.id,
          shiftId: shiftA.id,
        },
      }),
      /cash expense session mismatch/i,
    );
    await cashExpenseA.reload();
    assert.equal(Number(cashExpenseA.shiftId), Number(shiftA.id));
    assert.equal(Number(cashExpenseA.cashSessionId), Number(cashSessionA.id));
    assert.equal(
      JSON.stringify(
        typeof cashExpenseA.attachments === 'string'
          ? JSON.parse(cashExpenseA.attachments)
          : cashExpenseA.attachments,
      ),
      JSON.stringify(cashExpenseAttachments),
    );
    await cashSessionA.update({ openingComment: 'Valid lifecycle update' });
    await cashExpenseA.update({ description: 'Valid lifecycle update' });
    await expectDatabaseReject(
      db.Shift.create({
        adminName: staffA.staff.name,
        clubId: siblingClub.id,
        date: '2099-08-02',
        hours: 8,
        staffId: staffA.staff.id,
        status: 'closed',
      }),
      /staff club authority mismatch/i,
    );

    process.env.TENANT_SHIFTS_REPORTS_ENABLED = 'false';
    await assert.rejects(
      db.Shift.create({
        adminName: 'Legacy bridge must fail closed',
        date: '2099-08-03',
        hours: 8,
        status: 'closed',
      }),
      (error) => error.code === 'TENANT_SINGLE_DEFAULT_REQUIRED',
    );
    process.env.TENANT_SHIFTS_REPORTS_ENABLED = 'true';

    await assert.rejects(
      migration.down(queryInterface, SequelizePackage),
      (error) => error.code === 'TENANT_SHIFTS_REPORTS_ROLLBACK_SECOND_ORGANIZATION',
    );
    assert.equal((await migration.__testing.classifyState(queryInterface)).state, 'ready');
  } finally {
    if (db) await db.sequelize.close().catch(() => {});
    if (schema) await schema.close().catch(() => {});
    await admin.query(`DROP DATABASE IF EXISTS \`${database}\``).catch(() => {});
    await admin.end().catch(() => {});
    fs.rmSync(storageRoot, { force: true, recursive: true });
    restoreEnv(previous);
  }
});
