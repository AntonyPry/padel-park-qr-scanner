'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const mysql = require('mysql2/promise');
const SequelizePackage = require('sequelize');
const XLSX = require('xlsx');

const SERVER_ROOT = path.resolve(__dirname, '../..');
const FEATURE_MIGRATION_FILE = '20260716180000-add-tenant-visits-scanner.js';
const CAPABILITY_ENV = [
  'TENANT_CONTEXT_ENABLED',
  'TENANT_CACHE_REALTIME_ENABLED',
  'TENANT_FILES_WORKERS_ENABLED',
  'TENANT_PROVIDER_INTEGRATIONS_ENABLED',
  'TENANT_STAFF_ACCESS_ENABLED',
  'TENANT_CLIENTS_REFERENCES_ENABLED',
  'TENANT_VISITS_SCANNER_ENABLED',
];

function databaseName() {
  return process.env.VISITS_SCANNER_TEST_DB_NAME
    || `setly_visits_scanner_f5_3_${process.pid}_${Date.now()}`;
}

async function createSchema(database) {
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
    .filter((file) => file.endsWith('.js') && file <= FEATURE_MIGRATION_FILE)
    .sort();
  for (const file of migrations) {
    const migration = require(path.join(SERVER_ROOT, 'migrations', file));
    await migration.up(queryInterface, SequelizePackage);
    await queryInterface.bulkInsert('SequelizeMeta', [{ name: file }]);
  }
  return sequelize;
}

function tenantFor(account, membership, organizationId, clubId) {
  return Object.freeze({
    accountId: Number(account.id),
    clubId: Number(clubId),
    effectiveRole: membership.role,
    membershipId: Number(membership.id),
    membershipRole: membership.role,
    organizationId: Number(organizationId),
    scope: 'club',
  });
}

function databaseErrorCode(error) {
  return error?.original?.code || error?.parent?.code || error?.code;
}

async function snapshotVisitGraph(sequelize) {
  const [visits, scannerEvents, assignments] = await Promise.all([
    sequelize.query(
      `SELECT id, organizationId, clubId, userId, scannedAt, category,
              entrySource, duplicateOfVisitId, clientEventId, isTraining
         FROM Visits ORDER BY id`,
      { type: SequelizePackage.QueryTypes.SELECT },
    ),
    sequelize.query(
      `SELECT id, organizationId, clubId, eventType, visitId, userId,
              clientEventId, severity, status
         FROM ScannerEvents ORDER BY id`,
      { type: SequelizePackage.QueryTypes.SELECT },
    ),
    sequelize.query(
      `SELECT organizationId, clubId, visitId, visitCategoryId
         FROM VisitCategoryAssignments ORDER BY visitId, visitCategoryId`,
      { type: SequelizePackage.QueryTypes.SELECT },
    ),
  ]);
  const rows = { assignments, scannerEvents, visits };
  return {
    checksum: crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex'),
    counts: {
      assignments: assignments.length,
      scannerEvents: scannerEvents.length,
      visits: visits.length,
    },
    rows,
  };
}

function clientRow(organizationId, suffix) {
  return {
    organizationId,
    isTraining: false,
    name: `Tenant client ${suffix}`,
    phone: `+79991${String(suffix).padStart(6, '0')}`,
    source: 'Reception',
    status: 'active',
    webId: `web_tenant_visit_${suffix}`,
  };
}

test('Feature 5.3 Visits/scanner DB isolation, migrations and compatibility', async (t) => {
  assert.ok(process.env.DB_USER, 'DB_USER is required for DB-backed tenant tests');
  const database = databaseName();
  const previousCapabilities = Object.fromEntries(
    CAPABILITY_ENV.map((name) => [name, process.env[name]]),
  );
  const previousFailureFlag =
    process.env.TENANT_VISITS_SCANNER_MIGRATION_FAIL_AFTER_BACKFILL;
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
    schema = await createSchema(database);
    db = require('../../models');
    const accessService = require('../../src/services/access.service');
    const authService = require('../../src/services/auth.service');
    const referencesService = require('../../src/services/references.service');
    const scannerEventsService = require('../../src/services/scanner-events.service');
    const analyticsService = require('../../src/services/visits-analytics.service');
    const migration = require(`../../migrations/${FEATURE_MIGRATION_FILE}`);
    const queryInterface = schema.getQueryInterface();

    const ownerSession = await authService.bootstrapOwner({
      email: 'owner@visits-scanner.test',
      name: 'Visits Scanner Owner',
      password: 'VisitsScanner123!',
    });
    const owner = await db.Account.findByPk(ownerSession.account.id);
    const defaultOrganization = await db.Organization.findOne({
      where: { slug: 'padel-park' },
    });
    const defaultClub = await db.Club.findOne({
      where: { organizationId: defaultOrganization.id, slug: 'padel-park' },
    });
    const defaultMembership = await db.Membership.findOne({
      where: { accountId: owner.id, organizationId: defaultOrganization.id },
    });
    const defaultContext = tenantFor(
      owner,
      defaultMembership,
      defaultOrganization.id,
      defaultClub.id,
    );
    const legacyClient = await db.User.create(clientRow(defaultOrganization.id, 1));
    const legacyCategory = await referencesService.create(
      'visit-categories',
      { name: 'Migration purpose' },
      defaultContext,
    );

    await t.test('production-shaped backfill cleans a forced failure and is deterministic down/up', async () => {
      await migration.down(queryInterface, SequelizePackage);
      for (const tableName of ['Visits', 'ScannerEvents', 'VisitCategoryAssignments']) {
        const description = await queryInterface.describeTable(tableName);
        assert.equal(description.organizationId, undefined);
        assert.equal(description.clubId, undefined);
      }

      const now = new Date('2089-01-15T09:00:00.000Z');
      await queryInterface.bulkInsert('Visits', [{
        clientEventId: 'legacy-visit-event',
        createdAt: now,
        entrySource: 'manual',
        isTraining: false,
        scannedAt: now,
        updatedAt: now,
        userId: legacyClient.id,
      }]);
      const [legacyVisits] = await schema.query(
        'SELECT id FROM Visits WHERE clientEventId = :clientEventId',
        { replacements: { clientEventId: 'legacy-visit-event' } },
      );
      const legacyVisitId = legacyVisits[0].id;
      await queryInterface.bulkInsert('ScannerEvents', [{
        clientEventId: 'legacy-scanner-event',
        createdAt: now,
        eventType: 'manual_success',
        severity: 'info',
        status: 'created',
        updatedAt: now,
        userId: legacyClient.id,
        visitId: legacyVisitId,
      }]);
      await queryInterface.bulkInsert('VisitCategoryAssignments', [{
        visitCategoryId: legacyCategory.id,
        visitId: legacyVisitId,
      }]);

      process.env.TENANT_VISITS_SCANNER_MIGRATION_FAIL_AFTER_BACKFILL = 'true';
      let forcedError;
      await assert.rejects(
        migration.up(queryInterface, SequelizePackage),
        (error) => {
          forcedError = error;
          return /forced failure after backfill/.test(error.message);
        },
      );
      assert.equal(forcedError.cleanupError, undefined, forcedError.cleanupError?.stack);
      assert.equal((await queryInterface.describeTable('Visits')).organizationId, undefined);
      assert.equal(
        Number((await schema.query('SELECT COUNT(*) count FROM Visits', {
          type: SequelizePackage.QueryTypes.SELECT,
        }))[0].count),
        1,
      );

      delete process.env.TENANT_VISITS_SCANNER_MIGRATION_FAIL_AFTER_BACKFILL;
      await migration.up(queryInterface, SequelizePackage);
      const first = await snapshotVisitGraph(schema);
      assert.deepEqual(first.counts, { assignments: 1, scannerEvents: 1, visits: 1 });
      for (const rows of Object.values(first.rows)) {
        for (const row of rows) {
          assert.equal(Number(row.organizationId), defaultOrganization.id);
          assert.equal(Number(row.clubId), defaultClub.id);
        }
      }

      await migration.down(queryInterface, SequelizePackage);
      await migration.up(queryInterface, SequelizePackage);
      const reapplied = await snapshotVisitGraph(schema);
      assert.equal(reapplied.checksum, first.checksum);
      assert.deepEqual(reapplied.counts, first.counts);
    });

    const secondClub = await db.Club.create({
      name: 'Second club in default organization',
      organizationId: defaultOrganization.id,
      slug: 'second-default-club',
      status: 'active',
    });
    const secondClubContext = tenantFor(
      owner,
      defaultMembership,
      defaultOrganization.id,
      secondClub.id,
    );
    const foreignOrganization = await db.Organization.create({
      name: 'Foreign Visits Organization',
      slug: 'foreign-visits-organization',
      status: 'active',
    });
    const foreignClub = await db.Club.create({
      name: 'Foreign Visits Club',
      organizationId: foreignOrganization.id,
      slug: 'foreign-visits-club',
      status: 'active',
    });
    const foreignMembership = await db.Membership.create({
      accountId: owner.id,
      organizationId: foreignOrganization.id,
      role: 'owner',
      staffId: null,
      status: 'active',
    });
    const foreignContext = tenantFor(
      owner,
      foreignMembership,
      foreignOrganization.id,
      foreignClub.id,
    );

    const [defaultClient, secondClubClient, foreignClient, concurrentClient, deviceClient] =
      await Promise.all([
        db.User.create(clientRow(defaultOrganization.id, 10)),
        db.User.create(clientRow(defaultOrganization.id, 11)),
        db.User.create(clientRow(foreignOrganization.id, 12)),
        db.User.create(clientRow(defaultOrganization.id, 13)),
        db.User.create(clientRow(defaultOrganization.id, 14)),
      ]);
    const defaultCategory = await referencesService.create(
      'visit-categories',
      { name: 'Default organization purpose' },
      defaultContext,
    );
    const foreignCategory = await referencesService.create(
      'visit-categories',
      { name: 'Foreign organization purpose' },
      foreignContext,
    );

    const defaultVisit = await accessService.createManualVisit(defaultClient.id, {
      account: owner,
      clientEventId: 'default-club-visit',
      clubId: foreignClub.id,
      organizationId: foreignOrganization.id,
      tenant: defaultContext,
    });
    const secondClubVisit = await accessService.createManualVisit(secondClubClient.id, {
      account: owner,
      clientEventId: 'second-club-visit',
      tenant: secondClubContext,
    });
    const foreignVisit = await accessService.createManualVisit(foreignClient.id, {
      account: owner,
      clientEventId: 'foreign-club-visit',
      tenant: foreignContext,
    });

    await t.test('authoritative context ignores forged body/device labels and supports same-org multi-club', async () => {
      const storedDefault = await db.Visit.findByPk(defaultVisit.visitId);
      assert.equal(storedDefault.organizationId, defaultOrganization.id);
      assert.equal(storedDefault.clubId, defaultClub.id);

      const deviceScan = await accessService.scanQr(deviceClient.webId, {
        account: owner,
        clientEventId: 'forged-device-scan',
        deviceLabel: 'foreign-club-device',
        metadata: {
          clubId: foreignClub.id,
          deviceLabel: 'foreign-club-device',
          organizationId: foreignOrganization.id,
        },
        source: 'web_serial',
        tenant: defaultContext,
      });
      assert.equal(deviceScan.found, true);
      const storedDeviceScan = await db.Visit.findByPk(deviceScan.event.visitId);
      assert.equal(storedDeviceScan.organizationId, defaultOrganization.id);
      assert.equal(storedDeviceScan.clubId, defaultClub.id);

      const defaultCards = await accessService.getRecentVisitCards(100, defaultContext);
      const secondClubCards = await accessService.getRecentVisitCards(100, secondClubContext);
      assert.ok(defaultCards.some((row) => row.visitId === defaultVisit.visitId));
      assert.equal(defaultCards.some((row) => row.visitId === secondClubVisit.visitId), false);
      assert.ok(secondClubCards.some((row) => row.visitId === secondClubVisit.visitId));
      assert.equal(secondClubCards.some((row) => row.visitId === defaultVisit.visitId), false);

      await accessService.updateVisitCategory(
        secondClubVisit.visitId,
        '',
        [defaultCategory.id],
        owner,
        secondClubContext,
      );
      const assignment = await db.VisitCategoryAssignment.findOne({
        where: { visitId: secondClubVisit.visitId },
      });
      assert.equal(assignment.organizationId, defaultOrganization.id);
      assert.equal(assignment.clubId, secondClub.id);
    });

    await t.test('cross-Organization, cross-Club, client and category IDOR fail closed', async () => {
      for (const operation of [
        () => accessService.issueKey(secondClubVisit.visitId, '12', owner, defaultContext),
        () => accessService.correctKey(foreignVisit.visitId, '13', owner, defaultContext),
        () => accessService.updateVisitCategory(
          foreignVisit.visitId,
          '',
          [defaultCategory.id],
          owner,
          defaultContext,
        ),
        () => accessService.updateVisitCategory(
          defaultVisit.visitId,
          '',
          [foreignCategory.id],
          owner,
          defaultContext,
        ),
      ]) {
        await assert.rejects(operation(), (error) => [404, 409].includes(error.statusCode));
      }

      await assert.rejects(
        db.Visit.create({
          clubId: defaultClub.id,
          entrySource: 'manual',
          organizationId: defaultOrganization.id,
          userId: foreignClient.id,
        }),
        (error) => databaseErrorCode(error) === 'ER_NO_REFERENCED_ROW_2',
      );
      await assert.rejects(
        db.Visit.create({
          clubId: defaultClub.id,
          duplicateOfVisitId: secondClubVisit.visitId,
          entrySource: 'manual',
          organizationId: defaultOrganization.id,
          userId: defaultClient.id,
        }),
        (error) => databaseErrorCode(error) === 'ER_SIGNAL_EXCEPTION',
      );
      await assert.rejects(
        db.VisitCategoryAssignment.create({
          clubId: defaultClub.id,
          organizationId: defaultOrganization.id,
          visitCategoryId: foreignCategory.id,
          visitId: defaultVisit.visitId,
        }),
        (error) => databaseErrorCode(error) === 'ER_NO_REFERENCED_ROW_2',
      );
      await assert.rejects(
        scannerEventsService.recordEvent({
          eventType: 'forged_scanner_authority',
          throwOnError: true,
          tenant: defaultContext,
          userId: foreignClient.id,
          visitId: foreignVisit.visitId,
        }),
        (error) => error.statusCode === 404,
      );
    });

    await t.test('concurrent scan retries are tenant-idempotent', async () => {
      const results = await Promise.all([
        accessService.createManualVisit(concurrentClient.id, {
          account: owner,
          clientEventId: 'concurrent-visit-event',
          tenant: defaultContext,
        }),
        accessService.createManualVisit(concurrentClient.id, {
          account: owner,
          clientEventId: 'concurrent-visit-event',
          tenant: defaultContext,
        }),
      ]);
      assert.equal(new Set(results.map((row) => row.visitId)).size, 1);
      assert.equal(results.filter((row) => row.isRepeated).length, 1);
      assert.equal(await db.Visit.count({
        where: {
          clientEventId: 'concurrent-visit-event',
          clubId: defaultClub.id,
          organizationId: defaultOrganization.id,
        },
      }), 1);

      const [defaultEvent, foreignEvent] = await Promise.all([
        scannerEventsService.recordEvent({
          clientEventId: 'shared-scanner-event',
          eventType: 'device_status',
          tenant: defaultContext,
          throwOnError: true,
        }),
        scannerEventsService.recordEvent({
          clientEventId: 'shared-scanner-event',
          eventType: 'device_status',
          tenant: foreignContext,
          throwOnError: true,
        }),
      ]);
      assert.notEqual(defaultEvent.id, foreignEvent.id);
    });

    await t.test('stale Membership, revoked club access and forged context are rejected', async () => {
      const manager = await db.Account.create({
        email: 'manager@visits-scanner.test',
        passwordHash: 'test-only',
        role: 'manager',
        status: 'active',
      });
      const managerMembership = await db.Membership.create({
        accountId: manager.id,
        organizationId: defaultOrganization.id,
        role: 'manager',
        staffId: null,
        status: 'active',
      });
      const managerAccess = await db.MembershipClubAccess.create({
        clubId: defaultClub.id,
        membershipId: managerMembership.id,
        organizationId: defaultOrganization.id,
        roleOverride: null,
        status: 'active',
      });
      const managerContext = tenantFor(
        manager,
        managerMembership,
        defaultOrganization.id,
        defaultClub.id,
      );
      assert.ok((await accessService.getRecentVisitCards(10, managerContext)).length > 0);

      await managerAccess.update({ status: 'inactive' });
      await assert.rejects(
        accessService.getRecentVisitCards(10, managerContext),
        (error) => error.statusCode === 404,
      );
      await managerAccess.update({ status: 'active' });
      await managerMembership.update({ status: 'inactive' });
      await assert.rejects(
        scannerEventsService.listEvents({}, managerContext),
        (error) => error.statusCode === 404,
      );
      await managerMembership.update({ status: 'active' });

      const forged = Object.freeze({
        ...defaultContext,
        clubId: foreignClub.id,
      });
      await assert.rejects(
        analyticsService.getVisitsAnalytics('2000-01-01', '2100-01-01', {
          tenant: forged,
        }),
        (error) => error.statusCode === 404,
      );
    });

    await t.test('ORM and raw SQL cannot mutate tenant attribution', async () => {
      const visit = await db.Visit.findByPk(defaultVisit.visitId);
      await assert.rejects(
        visit.update({ clubId: secondClub.id }),
        (error) => error.code === 'VISIT_TENANT_IMMUTABLE',
      );
      await assert.rejects(
        db.Visit.update(
          { organizationId: foreignOrganization.id },
          { where: { id: defaultVisit.visitId } },
        ),
        (error) => error.code === 'VISIT_TENANT_IMMUTABLE',
      );
      await assert.rejects(
        schema.query(
          'UPDATE Visits SET clubId = :clubId WHERE id = :id',
          { replacements: { clubId: secondClub.id, id: defaultVisit.visitId } },
        ),
        (error) => databaseErrorCode(error) === 'ER_SIGNAL_EXCEPTION',
      );
      await assert.rejects(
        schema.query(
          'UPDATE Visits SET duplicateOfVisitId = :duplicateOfVisitId WHERE id = :id',
          {
            replacements: {
              duplicateOfVisitId: secondClubVisit.visitId,
              id: defaultVisit.visitId,
            },
          },
        ),
        (error) => databaseErrorCode(error) === 'ER_SIGNAL_EXCEPTION',
      );
      const stored = await db.Visit.findByPk(defaultVisit.visitId);
      assert.equal(stored.clubId, defaultClub.id);
      assert.equal(stored.organizationId, defaultOrganization.id);

      const scannerEvent = await db.ScannerEvent.findOne({
        where: { visitId: defaultVisit.visitId },
      });
      await assert.rejects(
        scannerEvent.update({ clubId: secondClub.id }),
        (error) => error.code === 'SCANNER_EVENT_TENANT_IMMUTABLE',
      );
      const assignment = await db.VisitCategoryAssignment.findOne({
        where: { visitId: secondClubVisit.visitId },
      });
      await assert.rejects(
        assignment.update({ clubId: defaultClub.id }),
        (error) => error.code === 'VISIT_CATEGORY_ASSIGNMENT_TENANT_IMMUTABLE',
      );
      await assert.rejects(
        schema.query(
          'UPDATE ScannerEvents SET organizationId = :organizationId WHERE id = :id',
          {
            replacements: {
              id: scannerEvent.id,
              organizationId: foreignOrganization.id,
            },
          },
        ),
        (error) => databaseErrorCode(error) === 'ER_SIGNAL_EXCEPTION',
      );
    });

    await t.test('deleting a duplicate parent preserves legacy SET NULL behavior', async () => {
      const parent = await db.Visit.create({
        clubId: defaultClub.id,
        entrySource: 'manual',
        organizationId: defaultOrganization.id,
        userId: defaultClient.id,
      });
      const duplicate = await db.Visit.create({
        clubId: defaultClub.id,
        duplicateOfVisitId: parent.id,
        entrySource: 'manual',
        organizationId: defaultOrganization.id,
        userId: defaultClient.id,
      });

      await parent.destroy();
      await duplicate.reload();
      assert.equal(duplicate.duplicateOfVisitId, null);
      await duplicate.destroy();
    });

    await t.test('analytics, export, scanner history and training separation are club scoped', async () => {
      const trainingVisit = await db.Visit.create({
        clubId: defaultClub.id,
        entrySource: 'manual',
        isTraining: true,
        organizationId: defaultOrganization.id,
        userId: defaultClient.id,
      });
      const analytics = await analyticsService.getVisitsAnalytics(
        '2000-01-01',
        '2100-01-01',
        { tenant: defaultContext },
      );
      const expectedVisits = await db.Visit.count({
        where: {
          clubId: defaultClub.id,
          duplicateOfVisitId: null,
          isTraining: false,
          organizationId: defaultOrganization.id,
        },
      });
      assert.equal(analytics.totalVisits, expectedVisits);

      const workbook = XLSX.read(await analyticsService.createVisitsExportBuffer(
        '2000-01-01',
        '2100-01-01',
        { tenant: defaultContext },
      ));
      const visitRows = XLSX.utils.sheet_to_json(workbook.Sheets['Визиты']);
      const exportedIds = new Set(visitRows.map((row) => Number(row['ID визита'])));
      assert.ok(exportedIds.has(defaultVisit.visitId));
      assert.equal(exportedIds.has(secondClubVisit.visitId), false);
      assert.equal(exportedIds.has(foreignVisit.visitId), false);
      assert.equal(exportedIds.has(trainingVisit.id), false);

      const defaultEvents = await scannerEventsService.listEvents(
        { limit: 100 },
        defaultContext,
      );
      assert.ok(defaultEvents.some((event) => event.visitId === defaultVisit.visitId));
      assert.equal(defaultEvents.some((event) => event.visitId === foreignVisit.visitId), false);
      assert.equal(defaultEvents.some((event) => event.visitId === secondClubVisit.visitId), false);
    });

    await t.test('flag-off keeps the single-default bridge and flag-on restores club isolation', async () => {
      process.env.TENANT_VISITS_SCANNER_ENABLED = 'false';
      const legacyCards = await accessService.getRecentVisitCards(200);
      assert.ok(legacyCards.some((row) => row.visitId === defaultVisit.visitId));
      assert.ok(legacyCards.some((row) => row.visitId === foreignVisit.visitId));
      const legacyWrite = await accessService.createManualVisit(defaultClient.id, {
        account: owner,
        clientEventId: 'flag-off-default-write',
        tenant: defaultContext,
      });
      const stored = await db.Visit.findByPk(legacyWrite.visitId);
      assert.equal(stored.organizationId, defaultOrganization.id);
      assert.equal(stored.clubId, defaultClub.id);

      process.env.TENANT_VISITS_SCANNER_ENABLED = 'true';
      const isolatedCards = await accessService.getRecentVisitCards(200, defaultContext);
      assert.equal(isolatedCards.some((row) => row.visitId === foreignVisit.visitId), false);
    });

    await t.test('rollback guard refuses a second production tenant without partial schema loss', async () => {
      await assert.rejects(
        migration.down(queryInterface, SequelizePackage),
        /exactly one active default Organization/,
      );
      for (const tableName of ['Visits', 'ScannerEvents', 'VisitCategoryAssignments']) {
        const description = await queryInterface.describeTable(tableName);
        assert.ok(description.organizationId);
        assert.ok(description.clubId);
      }
    });
  } finally {
    for (const name of CAPABILITY_ENV) {
      if (previousCapabilities[name] === undefined) delete process.env[name];
      else process.env[name] = previousCapabilities[name];
    }
    if (previousFailureFlag === undefined) {
      delete process.env.TENANT_VISITS_SCANNER_MIGRATION_FAIL_AFTER_BACKFILL;
    } else {
      process.env.TENANT_VISITS_SCANNER_MIGRATION_FAIL_AFTER_BACKFILL =
        previousFailureFlag;
    }
    if (db?.sequelize) await db.sequelize.close().catch(() => {});
    if (schema) await schema.close().catch(() => {});
    if (process.env.KEEP_VISITS_SCANNER_TEST_DB === 'true') {
      console.log(`[tenant-visits-scanner] kept QA database ${database}`);
    } else {
      await admin.query(`DROP DATABASE IF EXISTS \`${database}\``).catch(() => {});
    }
    await admin.end();
  }
});
