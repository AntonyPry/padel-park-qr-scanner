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
const {
  DEFAULT_CLUB_SLUG,
  DEFAULT_ORGANIZATION_SLUG,
} = require('../../src/tenant-foundation/constants');

const SERVER_ROOT = path.resolve(__dirname, '../..');
const FEATURE_MIGRATION_FILE =
  '20260718120000-add-tenant-bookings-courts.js';
const CAPABILITY_ENV = ACCEPTED_TENANT_CAPABILITY_ENV;

function databaseName() {
  return process.env.BOOKINGS_COURTS_TEST_DB_NAME ||
    `setly_bookings_courts_f5_5_${process.pid}_${Date.now()}`;
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

async function touchedRowsSnapshot(sequelize) {
  const snapshot = {};
  for (const table of [
    'Courts',
    'BookingSettings',
    'BookingPriceRules',
    'BookingScheduleExceptions',
    'BookingSeries',
    'Bookings',
    'Utilizations',
    'CourtBlocks',
    'BookingParticipants',
    'BookingChangeLogs',
  ]) {
    snapshot[table] = await sequelize.query(
      `SELECT * FROM \`${table}\` ORDER BY id`,
      { type: SequelizePackage.QueryTypes.SELECT },
    );
  }
  return JSON.stringify(snapshot);
}

async function tenantFor(account, membership, organizationId, clubId) {
  const tenantContextService = require('../../src/services/tenant-context.service');
  return tenantContextService.resolveTenantContext({
    accountId: Number(account.id),
    clubId: Number(clubId),
    organizationId: Number(organizationId),
    scope: 'club',
  });
}

function bookingBody(courtId, userId, startsAt, extra = {}) {
  return {
    bookingType: 'game',
    clientName: 'ignored authoritative client snapshot',
    clientPhone: '+79990000000',
    courtId,
    durationMinutes: 60,
    paidAmount: 0,
    paymentMethod: 'unknown',
    paymentStatus: 'unpaid',
    price: 1000,
    source: 'admin',
    startsAt,
    status: 'confirmed',
    userId,
    ...extra,
  };
}

function restoreEnv(previous) {
  for (const [name, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

test('Feature 5.5 migration, tenant isolation, races and idempotency', async () => {
  assert.ok(process.env.DB_USER, 'DB_USER is required for DB-backed tenant tests');
  const database = databaseName();
  const previous = Object.fromEntries([
    ...CAPABILITY_ENV,
    'DB_NAME',
    'NODE_ENV',
    'TENANT_BOOKINGS_COURTS_MIGRATION_FAIL_STEP',
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
    const defaultOrganization = await selectOne(
      schema,
      'SELECT id FROM Organizations WHERE slug=:slug',
      { slug: DEFAULT_ORGANIZATION_SLUG },
    );
    const defaultClub = await selectOne(
      schema,
      'SELECT id FROM Clubs WHERE slug=:slug',
      { slug: DEFAULT_CLUB_SLUG },
    );
    const legacyNow = new Date();
    const legacyCourt = await selectOne(
      schema,
      'SELECT id FROM Courts ORDER BY id LIMIT 1',
    );
    await queryInterface.bulkInsert('Users', [{
      createdAt: legacyNow,
      isTraining: false,
      name: 'Feature 5.5 legacy client',
      organizationId: defaultOrganization.id,
      phone: '+79995550001',
      phoneNormalized: '9995550001',
      source: 'Feature 5.5 legacy fixture',
      status: 'active',
      updatedAt: legacyNow,
      webId: `feature-5-5-legacy-${Date.now()}`,
    }]);
    const legacyClient = await selectOne(
      schema,
      'SELECT id FROM Users WHERE phoneNormalized=:phoneNormalized',
      { phoneNormalized: '9995550001' },
    );
    await queryInterface.bulkInsert('BookingSeries', [{
      bookingType: 'game',
      clientName: 'Feature 5.5 legacy client',
      clientPhone: '+7 (999) 555-00-01',
      courtId: legacyCourt.id,
      createdAt: legacyNow,
      durationMinutes: 60,
      endsOn: '2098-01-31',
      isTraining: false,
      name: 'Feature 5.5 legacy series',
      paymentMethod: 'unknown',
      paymentStatus: 'unpaid',
      source: 'admin',
      startTime: '10:00',
      startsOn: '2098-01-01',
      status: 'active',
      updatedAt: legacyNow,
      userId: legacyClient.id,
      weekday: 3,
    }]);
    const legacySeries = await selectOne(
      schema,
      'SELECT id FROM BookingSeries WHERE name=:name',
      { name: 'Feature 5.5 legacy series' },
    );
    await queryInterface.bulkInsert('Bookings', [{
      bookingSeriesId: legacySeries.id,
      bookingType: 'game',
      clientName: 'Feature 5.5 legacy client',
      clientPhone: '+7 (999) 555-00-01',
      courtId: legacyCourt.id,
      createdAt: legacyNow,
      durationMinutes: 60,
      endsAt: new Date('2098-01-07T11:00:00.000Z'),
      isTraining: false,
      paidAmount: 0,
      paymentMethod: 'unknown',
      paymentStatus: 'unpaid',
      price: 1000,
      source: 'admin',
      startsAt: new Date('2098-01-07T10:00:00.000Z'),
      status: 'confirmed',
      updatedAt: legacyNow,
      userId: legacyClient.id,
    }]);
    const legacyBooking = await selectOne(
      schema,
      'SELECT id FROM Bookings WHERE bookingSeriesId=:bookingSeriesId',
      { bookingSeriesId: legacySeries.id },
    );
    await queryInterface.bulkInsert('BookingParticipants', [{
      bookingId: legacyBooking.id,
      createdAt: legacyNow,
      updatedAt: legacyNow,
      userId: legacyClient.id,
    }]);
    await queryInterface.bulkInsert('BookingChangeLogs', [{
      action: 'created',
      bookingId: legacyBooking.id,
      createdAt: legacyNow,
      updatedAt: legacyNow,
    }]);
    await queryInterface.bulkInsert('CourtBlocks', [{
      courtId: legacyCourt.id,
      createdAt: legacyNow,
      endsAt: new Date('2098-02-01T11:00:00.000Z'),
      reason: 'Feature 5.5 legacy maintenance',
      startsAt: new Date('2098-02-01T10:00:00.000Z'),
      status: 'active',
      updatedAt: legacyNow,
    }]);
    await queryInterface.bulkInsert('BookingScheduleExceptions', [{
      createdAt: legacyNow,
      date: '2098-02-02',
      isClosed: true,
      reason: 'Feature 5.5 legacy exception',
      status: 'active',
      updatedAt: legacyNow,
    }]);
    await queryInterface.bulkInsert('Utilizations', [{
      booked1: 1,
      booked2: 2,
      createdAt: legacyNow,
      date: '2098-01-07',
      sessions1: 3,
      sessions2: 4,
      updatedAt: legacyNow,
    }]);
    const legacyCounts = Object.fromEntries(await Promise.all([
      'Courts',
      'BookingSettings',
      'BookingPriceRules',
      'BookingScheduleExceptions',
      'BookingSeries',
      'Bookings',
      'Utilizations',
      'CourtBlocks',
      'BookingParticipants',
      'BookingChangeLogs',
    ].map(async (table) => [
      table,
      Number((await selectOne(schema, `SELECT COUNT(*) AS count FROM ${table}`)).count),
    ])));

    await queryInterface.addColumn('Courts', 'organizationId', {
      allowNull: true,
      type: SequelizePackage.INTEGER,
    });
    await assert.rejects(
      () => migration.up(queryInterface, SequelizePackage),
      (error) => error.code === 'TENANT_BOOKINGS_COURTS_PARTIAL_SCHEMA',
    );
    await queryInterface.removeColumn('Courts', 'organizationId');

    process.env.TENANT_BOOKINGS_COURTS_MIGRATION_FAIL_STEP = 'triggers';
    await assert.rejects(
      () => migration.up(queryInterface, SequelizePackage),
      (error) =>
        error.code === 'TENANT_BOOKINGS_COURTS_MIGRATION_FORCED_FAILURE',
    );
    delete process.env.TENANT_BOOKINGS_COURTS_MIGRATION_FAIL_STEP;
    assert.equal(
      Boolean((await queryInterface.describeTable('Bookings')).organizationId),
      false,
    );
    for (const [table, field] of [
      ['Courts', 'name'],
      ['BookingScheduleExceptions', 'date'],
      ['Utilizations', 'date'],
    ]) {
      const indexes = await queryInterface.showIndex(table);
      assert.ok(indexes.some((index) =>
        index.unique && index.fields.length === 1 &&
        index.fields[0].attribute === field));
    }

    await migration.up(queryInterface, SequelizePackage);
    await migration.up(queryInterface, SequelizePackage);
    const backfilledCourt = await selectOne(
      schema,
      'SELECT organizationId,clubId FROM Courts ORDER BY id LIMIT 1',
    );
    assert.deepEqual(
      [Number(backfilledCourt.organizationId), Number(backfilledCourt.clubId)],
      [Number(defaultOrganization.id), Number(defaultClub.id)],
    );
    const backfilledRoots = await Promise.all([
      ['BookingSeries', legacySeries.id],
      ['Bookings', legacyBooking.id],
      ['BookingScheduleExceptions', null],
      ['Utilizations', null],
    ].map(([table, id]) => selectOne(
      schema,
      `SELECT organizationId,clubId FROM ${table}${id ? ' WHERE id=:id' : ''} ORDER BY id LIMIT 1`,
      id ? { id } : {},
    )));
    assert.ok(backfilledRoots.every((row) =>
      Number(row.organizationId) === Number(defaultOrganization.id) &&
      Number(row.clubId) === Number(defaultClub.id)));
    const inheritedChildren = await selectOne(schema, `SELECT
      (SELECT COUNT(*) FROM BookingParticipants item JOIN Bookings booking ON booking.id=item.bookingId
        WHERE booking.id=:bookingId AND booking.organizationId=:organizationId AND booking.clubId=:clubId) AS participants,
      (SELECT COUNT(*) FROM BookingChangeLogs item JOIN Bookings booking ON booking.id=item.bookingId
        WHERE booking.id=:bookingId AND booking.organizationId=:organizationId AND booking.clubId=:clubId) AS history,
      (SELECT COUNT(*) FROM CourtBlocks item JOIN Courts court ON court.id=item.courtId
        WHERE court.id=:courtId AND court.organizationId=:organizationId AND court.clubId=:clubId) AS blocks`, {
      bookingId: legacyBooking.id,
      clubId: defaultClub.id,
      courtId: legacyCourt.id,
      organizationId: defaultOrganization.id,
    });
    assert.deepEqual(
      [Number(inheritedChildren.participants), Number(inheritedChildren.history)],
      [1, 1],
    );
    assert.ok(Number(inheritedChildren.blocks) >= 1);
    await migration.down(queryInterface);
    assert.equal(
      Boolean((await queryInterface.describeTable('Bookings')).organizationId),
      false,
    );
    await migration.up(queryInterface, SequelizePackage);
    const reappliedCounts = Object.fromEntries(await Promise.all(
      Object.keys(legacyCounts).map(async (table) => [
        table,
        Number((await selectOne(schema, `SELECT COUNT(*) AS count FROM ${table}`)).count),
      ]),
    ));
    assert.deepEqual(reappliedCounts, legacyCounts);

    await applyAcceptedTenantMigrations(queryInterface, {
      afterFile: FEATURE_MIGRATION_FILE,
    });

    db = require('../../models');
    await db.sequelize.authenticate();
    const bookingsService = require('../../src/services/bookings.service');
    const bookingRulesService = require('../../src/services/booking-rules.service');
    const utilizationService = require('../../src/services/utilization.service');

    const owner = await db.Account.create({
      email: `feature-5-5-owner-${Date.now()}@example.test`,
      passwordHash: 'test-only',
      role: 'owner',
      status: 'active',
    });
    const ownerMembership = await db.Membership.create({
      accountId: owner.id,
      organizationId: defaultOrganization.id,
      role: 'owner',
      staffId: null,
      status: 'active',
    });
    const secondClub = await db.Club.create({
      name: 'Feature 5.5 second club',
      organizationId: defaultOrganization.id,
      slug: `feature-5-5-second-${Date.now()}`,
      status: 'active',
      timezone: 'Europe/Moscow',
    });
    const foreignOrganization = await db.Organization.create({
      name: 'Feature 5.5 foreign organization',
      slug: `feature-5-5-foreign-${Date.now()}`,
      status: 'active',
    });
    const foreignClub = await db.Club.create({
      name: 'Feature 5.5 foreign club',
      organizationId: foreignOrganization.id,
      slug: `feature-5-5-foreign-club-${Date.now()}`,
      status: 'active',
      timezone: 'Europe/Moscow',
    });
    const foreignMembership = await db.Membership.create({
      accountId: owner.id,
      organizationId: foreignOrganization.id,
      role: 'owner',
      staffId: null,
      status: 'active',
    });
    const foreignOnlyActor = await db.Account.create({
      email: `feature-5-5-foreign-actor-${Date.now()}@example.test`,
      passwordHash: 'test-only',
      role: 'manager',
      status: 'active',
    });
    await db.Membership.create({
      accountId: foreignOnlyActor.id,
      organizationId: foreignOrganization.id,
      role: 'manager',
      staffId: null,
      status: 'active',
    });
    const defaultTenant = await tenantFor(
      owner,
      ownerMembership,
      defaultOrganization.id,
      defaultClub.id,
    );
    const secondTenant = await tenantFor(
      owner,
      ownerMembership,
      defaultOrganization.id,
      secondClub.id,
    );
    const foreignTenant = await tenantFor(
      owner,
      foreignMembership,
      foreignOrganization.id,
      foreignClub.id,
    );

    const sharedClient = await db.User.create({
      isTraining: false,
      name: 'Feature 5.5 shared client',
      organizationId: defaultOrganization.id,
      phone: '+79995550055',
      phoneNormalized: '9995550055',
      source: 'Feature 5.5 test',
      status: 'active',
    });
    const foreignClient = await db.User.create({
      isTraining: false,
      name: 'Feature 5.5 foreign client',
      organizationId: foreignOrganization.id,
      phone: '+79995550056',
      phoneNormalized: '9995550056',
      source: 'Feature 5.5 test',
      status: 'active',
    });

    const defaultCourt = await bookingsService.createBookingResource(
      { clubId: foreignClub.id, name: 'Одинаковый корт', organizationId: foreignOrganization.id },
      defaultTenant,
    );
    const secondCourt = await bookingsService.createBookingResource(
      { name: 'Одинаковый корт' },
      secondTenant,
    );
    const foreignCourt = await bookingsService.createBookingResource(
      { name: 'Одинаковый корт' },
      foreignTenant,
    );
    assert.equal((await bookingsService.listBookingResources({}, defaultTenant)).length >= 1, true);
    assert.equal(
      (await bookingsService.listBookingResources({}, defaultTenant))
        .some((court) => court.id === secondCourt.id || court.id === foreignCourt.id),
      false,
    );

    const first = await bookingsService.createBooking(
      bookingBody(defaultCourt.id, sharedClient.id, '2099-01-05T10:00:00.000Z', {
        clubId: secondClub.id,
        organizationId: foreignOrganization.id,
      }),
      owner,
      defaultTenant,
    );
    assert.equal(Number((await db.Booking.findByPk(first.id)).clubId), Number(defaultClub.id));
    await assert.rejects(
      () => bookingsService.getBooking(first.id, secondTenant),
      (error) => error.statusCode === 404,
    );
    await assert.rejects(
      () => bookingsService.createBooking(
        bookingBody(secondCourt.id, sharedClient.id, '2099-01-05T11:00:00.000Z'),
        owner,
        defaultTenant,
      ),
      (error) => error.statusCode === 404,
    );
    await assert.rejects(
      () => bookingsService.createBooking(
        bookingBody(defaultCourt.id, foreignClient.id, '2099-01-05T11:00:00.000Z'),
        owner,
        defaultTenant,
      ),
      (error) => error.statusCode === 404,
    );
    await assert.rejects(
      () => bookingsService.createBooking(
        bookingBody(defaultCourt.id, sharedClient.id, '2099-01-05T11:00:00.000Z', {
          bookingType: 'group_training',
          groupParticipantIds: [foreignClient.id],
        }),
        owner,
        defaultTenant,
      ),
      (error) => error.statusCode === 404,
    );

    const crossClubSameTime = await bookingsService.createBooking(
      bookingBody(secondCourt.id, sharedClient.id, '2099-01-05T10:00:00.000Z'),
      owner,
      secondTenant,
    );
    assert.ok(crossClubSameTime.id);
    const race = await Promise.allSettled([
      bookingsService.createBooking(
        bookingBody(defaultCourt.id, sharedClient.id, '2099-01-05T12:00:00.000Z'),
        owner,
        defaultTenant,
      ),
      bookingsService.createBooking(
        bookingBody(defaultCourt.id, sharedClient.id, '2099-01-05T12:00:00.000Z'),
        owner,
        defaultTenant,
      ),
    ]);
    assert.equal(race.filter((result) => result.status === 'fulfilled').length, 1);
    assert.equal(race.filter((result) => result.status === 'rejected').length, 1);

    const retryBody = bookingBody(
      defaultCourt.id,
      sharedClient.id,
      '2099-01-05T14:00:00.000Z',
    );
    const retryResults = await Promise.all([
      bookingsService.createBooking(retryBody, owner, defaultTenant, {
        idempotencyKey: 'feature-5-5-create-retry',
      }),
      bookingsService.createBooking(retryBody, owner, defaultTenant, {
        idempotencyKey: 'feature-5-5-create-retry',
      }),
    ]);
    assert.equal(retryResults[0].id, retryResults[1].id);
    assert.equal(await db.Booking.count({
      where: {
        clubId: defaultClub.id,
        creationKeyHash: db.sequelize.fn(
          'SHA2',
          'feature-5-5-create-retry',
          256,
        ),
      },
    }), 1);
    await assert.rejects(
      () => bookingsService.createBooking(
        { ...retryBody, startsAt: '2099-01-05T15:00:00.000Z' },
        owner,
        defaultTenant,
        { idempotencyKey: 'feature-5-5-create-retry' },
      ),
      (error) => error.code === 'IDEMPOTENCY_KEY_REUSED',
    );

    const seriesBody = {
      bookingType: 'game',
      courtId: defaultCourt.id,
      durationMinutes: 60,
      endsOn: '2099-03-08',
      name: 'Feature 5.5 series',
      paymentMethod: 'unknown',
      paymentStatus: 'unpaid',
      price: 1000,
      source: 'admin',
      startsOn: '2099-03-01',
      startTime: '16:00',
      status: 'confirmed',
      userId: sharedClient.id,
      weekday: 1,
    };
    const createdSeries = await bookingsService.createBookingSeries(
      seriesBody,
      owner,
      defaultTenant,
      { idempotencyKey: 'feature-5-5-series-retry' },
    );
    const retriedSeries = await bookingsService.createBookingSeries(
      seriesBody,
      owner,
      defaultTenant,
      { idempotencyKey: 'feature-5-5-series-retry' },
    );
    assert.equal(createdSeries.series.id, retriedSeries.series.id);
    assert.equal(
      await db.BookingSeries.count({ where: { name: 'Feature 5.5 series' } }),
      1,
    );

    const inaccessibleStaff = await db.Staff.create({
      name: 'Feature 5.5 inaccessible trainer',
      organizationId: defaultOrganization.id,
      role: 'Тренер',
      status: 'active',
    });
    const trainerAccount = await db.Account.create({
      email: `feature-5-5-trainer-${Date.now()}@example.test`,
      passwordHash: 'test-only',
      role: 'trainer',
      staffId: inaccessibleStaff.id,
      status: 'active',
    });
    const trainerMembership = await db.Membership.create({
      accountId: trainerAccount.id,
      organizationId: defaultOrganization.id,
      role: 'trainer',
      staffId: inaccessibleStaff.id,
      status: 'active',
    });
    await db.MembershipClubAccess.create({
      clubId: secondClub.id,
      membershipId: trainerMembership.id,
      organizationId: defaultOrganization.id,
      roleOverride: null,
      status: 'active',
    });
    await assert.rejects(
      () => bookingsService.createBooking(
        bookingBody(defaultCourt.id, sharedClient.id, '2099-01-05T18:00:00.000Z', {
          responsibleStaffId: inaccessibleStaff.id,
        }),
        owner,
        defaultTenant,
      ),
      (error) => error.statusCode === 404,
    );
    await assert.rejects(
      () => db.sequelize.query(
        'UPDATE Bookings SET responsibleStaffId=:staffId WHERE id=:id',
        { replacements: { id: first.id, staffId: inaccessibleStaff.id } },
      ),
    );

    await utilizationService.upsertMany(
      [{ date: '2099-01-05', booked1: 1, booked2: 2, sessions1: 3, sessions2: 4 }],
      defaultTenant,
    );
    await utilizationService.upsertMany(
      [{ date: '2099-01-05', booked1: 9, booked2: 8, sessions1: 7, sessions2: 6 }],
      secondTenant,
    );
    assert.deepEqual(
      (await utilizationService.getAll(defaultTenant)).find((row) => row.date === '2099-01-05'),
      { date: '2099-01-05', booked1: 1, booked2: 2, sessions1: 3, sessions2: 4 },
    );

    const tenantPriceRule = await bookingRulesService.createPriceRule({
      courtType: 'all',
      endTime: '24:00',
      name: 'Feature 5.5 tenant rule',
      pricePerHour: 1000,
      priority: 500,
      startTime: '08:00',
      weekdays: [1, 2, 3, 4, 5, 6, 7],
    }, defaultTenant);
    const tenantBlock = await bookingRulesService.createBlock({
      courtId: defaultCourt.id,
      endsAt: '2099-04-01T11:00:00.000Z',
      reason: 'Feature 5.5 context boundary',
      startsAt: '2099-04-01T10:00:00.000Z',
    }, owner, defaultTenant);
    const tenantException = await bookingRulesService.upsertException({
      date: '2099-04-02',
      isClosed: true,
      reason: 'Feature 5.5 context boundary',
    }, defaultTenant);
    await bookingRulesService.getSettings(defaultTenant);

    const invalidContexts = [
      Object.freeze({
        clubId: Number(defaultClub.id),
        organizationId: Number(defaultOrganization.id),
        readScoped: true,
      }),
      Object.freeze({ ...defaultTenant }),
    ];
    const touchedBeforeForgedCalls = await touchedRowsSnapshot(db.sequelize);
    for (const invalidContext of invalidContexts) {
      const rejectedCalls = [
        () => bookingsService.listBookingResources({}, invalidContext),
        () => bookingsService.listBookings({ date: '2099-01-05' }, invalidContext),
        () => bookingsService.getSchedule({ date: '2099-01-05' }, invalidContext),
        () => bookingsService.getBookingAnalytics(
          { from: '2099-01-05', to: '2099-01-05' },
          invalidContext,
        ),
        () => bookingsService.listResponsibleStaff(invalidContext),
        () => bookingsService.getBooking(first.id, invalidContext),
        () => bookingsService.createBookingResource({ name: 'Forged resource' }, invalidContext),
        () => bookingsService.updateBookingResource(defaultCourt.id, { name: 'Forged update' }, invalidContext),
        () => bookingsService.archiveBookingResource(defaultCourt.id, invalidContext),
        () => bookingsService.createBooking(
          bookingBody(defaultCourt.id, sharedClient.id, '2099-05-01T10:00:00.000Z'),
          owner,
          invalidContext,
        ),
        () => bookingsService.updateBooking(first.id, { comment: 'Forged update' }, owner, invalidContext),
        () => bookingsService.listBookingHistory(first.id, invalidContext),
        () => bookingsService.listBookingSeries({}, invalidContext),
        () => bookingsService.previewBookingSeries(seriesBody, invalidContext),
        () => bookingsService.createBookingSeries(
          { ...seriesBody, name: 'Forged series', startsOn: '2099-06-01', endsOn: '2099-06-08' },
          owner,
          invalidContext,
        ),
        () => bookingsService.archiveBookingSeries(
          createdSeries.series.id,
          { reason: 'Forged archive' },
          owner,
          invalidContext,
        ),
        () => bookingRulesService.getSettings(invalidContext),
        () => bookingRulesService.calculateQuote({
          courtId: defaultCourt.id,
          durationMinutes: 60,
          startsAt: '2099-05-01T10:00:00.000Z',
        }, invalidContext),
        () => bookingRulesService.updateSettings({ slotStepMinutes: 30 }, invalidContext),
        () => bookingRulesService.listPriceRules('all', invalidContext),
        () => bookingRulesService.createPriceRule({
          name: 'Forged rule',
          pricePerHour: 1,
        }, invalidContext),
        () => bookingRulesService.updatePriceRule(
          tenantPriceRule.id,
          { name: 'Forged rule update' },
          invalidContext,
        ),
        () => bookingRulesService.archivePriceRule(tenantPriceRule.id, invalidContext),
        () => bookingRulesService.listBlocks({}, invalidContext),
        () => bookingRulesService.createBlock({
          courtId: defaultCourt.id,
          endsAt: '2099-05-02T11:00:00.000Z',
          reason: 'Forged block',
          startsAt: '2099-05-02T10:00:00.000Z',
        }, owner, invalidContext),
        () => bookingRulesService.updateBlock(
          tenantBlock.id,
          { reason: 'Forged block update' },
          owner,
          invalidContext,
        ),
        () => bookingRulesService.archiveBlock(tenantBlock.id, owner, invalidContext),
        () => bookingRulesService.listExceptions('all', invalidContext),
        () => bookingRulesService.upsertException({
          date: '2099-05-03',
          isClosed: true,
        }, invalidContext),
        () => bookingRulesService.updateException(
          tenantException.id,
          { reason: 'Forged exception update' },
          invalidContext,
        ),
        () => bookingRulesService.archiveException(tenantException.id, invalidContext),
        () => utilizationService.getAll(invalidContext),
        () => utilizationService.upsertMany([{
          booked1: 99,
          booked2: 99,
          date: '2099-05-04',
          sessions1: 99,
          sessions2: 99,
        }], invalidContext),
      ];
      for (const rejectedCall of rejectedCalls) {
        await assert.rejects(
          rejectedCall,
          (error) => error.code === 'TENANT_CONTEXT_NOT_FOUND' && error.statusCode === 404,
        );
      }
    }
    assert.equal(await touchedRowsSnapshot(db.sequelize), touchedBeforeForgedCalls);

    const managerAccount = await db.Account.create({
      email: `feature-5-5-manager-${Date.now()}@example.test`,
      passwordHash: 'test-only',
      role: 'manager',
      status: 'active',
    });
    const managerMembership = await db.Membership.create({
      accountId: managerAccount.id,
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
    const managerTenant = await tenantFor(
      managerAccount,
      managerMembership,
      defaultOrganization.id,
      defaultClub.id,
    );
    assert.ok((await bookingsService.listBookingResources({}, managerTenant)).length > 0);

    await managerAccess.update({ status: 'inactive' });
    await assert.rejects(
      () => bookingsService.listBookingResources({}, managerTenant),
      (error) => error.code === 'TENANT_CONTEXT_NOT_FOUND',
    );
    await managerAccess.update({ status: 'active' });

    await managerAccount.update({ status: 'inactive' });
    await assert.rejects(
      () => bookingRulesService.getSettings(managerTenant),
      (error) => error.code === 'TENANT_CONTEXT_NOT_FOUND',
    );
    await managerAccount.update({ status: 'active' });

    await managerMembership.update({ status: 'inactive' });
    await assert.rejects(
      () => utilizationService.getAll(managerTenant),
      (error) => error.code === 'TENANT_CONTEXT_NOT_FOUND',
    );
    await managerMembership.update({ status: 'active' });

    await db.Club.update(
      { status: 'inactive' },
      { where: { id: defaultClub.id } },
    );
    await assert.rejects(
      () => bookingsService.getBooking(first.id, defaultTenant),
      (error) => error.code === 'TENANT_CONTEXT_NOT_FOUND',
    );
    await db.Club.update(
      { status: 'active' },
      { where: { id: defaultClub.id } },
    );

    await db.Organization.update(
      { status: 'inactive' },
      { where: { id: defaultOrganization.id } },
    );
    await assert.rejects(
      () => bookingsService.getSchedule({ date: '2099-01-05' }, defaultTenant),
      (error) => error.code === 'TENANT_CONTEXT_NOT_FOUND',
    );
    await db.Organization.update(
      { status: 'active' },
      { where: { id: defaultOrganization.id } },
    );

    const row = await db.Booking.findByPk(first.id);
    await assert.rejects(
      () => row.update({ clubId: secondClub.id }),
      (error) => error.code === 'BOOKING_TENANT_IMMUTABLE',
    );
    await assert.rejects(
      () => db.sequelize.query(
        'UPDATE Bookings SET clubId=:clubId WHERE id=:id',
        { replacements: { clubId: secondClub.id, id: first.id } },
      ),
    );
    await assert.rejects(
      () => db.BookingParticipant.create({
        bookingId: first.id,
        userId: foreignClient.id,
      }),
    );
    await assert.rejects(
      () => db.sequelize.query(
        'UPDATE Bookings SET updatedByAccountId=:accountId WHERE id=:id',
        { replacements: { accountId: foreignOnlyActor.id, id: first.id } },
      ),
    );
    await assert.rejects(
      () => db.BookingChangeLog.create({
        action: 'updated',
        actorAccountId: foreignOnlyActor.id,
        bookingId: first.id,
      }),
    );

    const historyBefore = await bookingsService.listBookingHistory(
      first.id,
      defaultTenant,
    );
    await bookingsService.changeBookingStatus(
      first.id,
      { reason: 'Feature 5.5 cancellation', status: 'canceled' },
      owner,
      defaultTenant,
      { idempotencyKey: 'feature-5-5-cancel' },
    );
    await bookingsService.changeBookingStatus(
      first.id,
      { reason: 'Feature 5.5 cancellation', status: 'canceled' },
      owner,
      defaultTenant,
      { idempotencyKey: 'feature-5-5-cancel' },
    );
    assert.equal(
      (await bookingsService.listBookingHistory(first.id, defaultTenant)).length,
      historyBefore.length + 1,
    );
    await assert.rejects(
      () => bookingsService.listBookingHistory(first.id, secondTenant),
      (error) => error.statusCode === 404,
    );

    process.env.TENANT_BOOKINGS_COURTS_ENABLED = 'false';
    await assert.rejects(
      bookingsService.createBookingResource({
        clubId: foreignClub.id,
        name: 'Flag-off must not default after second tenant',
        organizationId: foreignOrganization.id,
      }),
      (error) => error.code === 'TENANT_SINGLE_DEFAULT_REQUIRED',
    );
    process.env.TENANT_BOOKINGS_COURTS_ENABLED = 'true';

    await secondClub.update({ status: 'inactive' });
    await assert.rejects(
      () => bookingsService.listBookingResources({}, secondTenant),
      (error) => error.statusCode === 404,
    );
    await secondClub.update({ status: 'active' });

    const analyticsDefault = await bookingsService.getBookingAnalytics(
      { from: '2099-01-05', to: '2099-01-05' },
      defaultTenant,
    );
    const analyticsSecond = await bookingsService.getBookingAnalytics(
      { from: '2099-01-05', to: '2099-01-05' },
      secondTenant,
    );
    assert.notEqual(analyticsDefault.total.totalCount, 0);
    assert.equal(analyticsSecond.total.totalCount, 1);

    const beforeRollbackState = await migration.__testing.classifySchema(queryInterface);
    await assert.rejects(
      () => migration.down(queryInterface),
      (error) => error.code === 'TENANT_SINGLE_DEFAULT_REQUIRED',
    );
    assert.equal(beforeRollbackState, 'ready');
    assert.equal(await migration.__testing.classifySchema(queryInterface), 'ready');
    void bookingRulesService;
  } finally {
    if (db?.sequelize) await db.sequelize.close();
    if (schema) await schema.close();
    await admin.query(`DROP DATABASE IF EXISTS \`${database}\``);
    await admin.end();
    restoreEnv(previous);
  }
});
