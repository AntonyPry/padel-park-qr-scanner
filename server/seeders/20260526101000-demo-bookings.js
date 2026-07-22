'use strict';

const {
  DEFAULT_CLUB_SLUG,
  DEFAULT_ORGANIZATION_SLUG,
} = require('../src/tenant-foundation/constants');

function atTime(date, hour, minute = 0) {
  const value = new Date(date);
  value.setHours(hour, minute, 0, 0);
  return value;
}

const DEMO_BOOKING_IDENTITIES = [
  ['Демо: бронь по телефону, оплатили безналом.', 'confirmed', 90, 4500, 4500],
  ['Демо: клиент попросил перезвонить за час.', 'new', 60, 3000, 0],
];

function ownershipLost(identity) {
  const error = new Error(`Demo booking fixture ownership lost for ${identity}`);
  error.code = 'TENANT_SEEDER_ARTIFACT_OWNERSHIP_LOST';
  return error;
}

async function inventoryDemoBookings(queryInterface, tenant) {
  const [rows] = await queryInterface.sequelize.query(
    `SELECT booking.id,booking.comment,booking.status,booking.durationMinutes,
            booking.price,booking.paidAmount,booking.organizationId,booking.clubId,
            booking.courtId,booking.userId,court.organizationId courtOrganizationId,
            court.clubId courtClubId,user.organizationId userOrganizationId
       FROM Bookings booking
       LEFT JOIN Courts court ON court.id=booking.courtId
       LEFT JOIN Users user ON user.id=booking.userId
      WHERE ${tenant.insert.organizationId ? 'booking.organizationId=:organizationId AND booking.clubId=:clubId AND ' : ''}
            booking.comment LIKE 'Демо:%'`,
    { replacements: tenant.replacements },
  );
  const expectedByComment = new Map(DEMO_BOOKING_IDENTITIES.map((row) => [row[0], row]));
  for (const row of rows) {
    const expected = expectedByComment.get(row.comment);
    if (!expected || row.status !== expected[1] || Number(row.durationMinutes) !== expected[2] ||
      Number(row.price) !== expected[3] || Number(row.paidAmount) !== expected[4] ||
      Number(row.organizationId) !== Number(tenant.insert.organizationId) ||
      Number(row.clubId) !== Number(tenant.insert.clubId) ||
      Number(row.courtOrganizationId) !== Number(tenant.insert.organizationId) ||
      Number(row.courtClubId) !== Number(tenant.insert.clubId) ||
      Number(row.userOrganizationId) !== Number(tenant.insert.organizationId)) {
      throw ownershipLost(row.id);
    }
  }
  if (rows.length > 0) {
    const ids = rows.map((row) => row.id);
    const [logs] = await queryInterface.sequelize.query(
      `SELECT id,bookingId,action,reason FROM BookingChangeLogs WHERE bookingId IN (:ids)`,
      { replacements: { ids } },
    );
    for (const log of logs) {
      if (log.action !== 'created' || log.reason !== 'Demo seed') throw ownershipLost(`log-${log.id}`);
    }
  }
  return rows.map((row) => row.id);
}

async function resolveTenantScope(queryInterface) {
  const [columns] = await queryInterface.sequelize.query(
    `SELECT COLUMN_NAME AS columnName
       FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'Bookings'
        AND COLUMN_NAME IN ('organizationId', 'clubId')`,
  );
  if (columns.length !== 2) {
    return { insert: {}, predicate: '', replacements: {} };
  }
  const [rows] = await queryInterface.sequelize.query(
    `SELECT organization.id AS organizationId, club.id AS clubId
       FROM Organizations organization
       JOIN Clubs club ON club.organizationId = organization.id
      WHERE organization.slug = :organizationSlug
        AND organization.status = 'active'
        AND club.slug = :clubSlug
        AND club.status = 'active'`,
    {
      replacements: {
        clubSlug: DEFAULT_CLUB_SLUG,
        organizationSlug: DEFAULT_ORGANIZATION_SLUG,
      },
    },
  );
  const [[counts]] = await queryInterface.sequelize.query(
    'SELECT (SELECT COUNT(*) FROM Organizations) organizations,(SELECT COUNT(*) FROM Clubs) clubs',
  );
  if (
    rows.length !== 1 ||
    Number(counts.organizations) !== 1 ||
    Number(counts.clubs) !== 1
  ) {
    const error = new Error('Demo bookings require the exact default tenant');
    error.code = 'TENANT_SEEDER_DEFAULT_ONLY';
    throw error;
  }
  return {
    insert: rows[0],
    predicate: 'organizationId = :organizationId AND clubId = :clubId AND ',
    replacements: rows[0],
  };
}

module.exports = {
  async up(queryInterface) {
    const tenant = await resolveTenantScope(queryInterface);
    await inventoryDemoBookings(queryInterface, tenant);
    const [existing] = await queryInterface.sequelize.query(
      `SELECT COUNT(*) AS count FROM Bookings WHERE ${tenant.predicate}1=1`,
      { replacements: tenant.replacements },
    );
    if (Number(existing[0]?.count || 0) > 0) return;

    const [courts] = await queryInterface.sequelize.query(
      `SELECT id, name FROM Courts WHERE ${tenant.predicate}isActive = 1 ORDER BY sortOrder ASC LIMIT 6`,
      { replacements: tenant.replacements },
    );
    const [clients] = await queryInterface.sequelize.query(
      `SELECT id, name, phone FROM Users WHERE ${tenant.insert.organizationId ? 'organizationId = :organizationId AND ' : ''}status = 'active' ORDER BY id ASC LIMIT 6`,
      { replacements: tenant.replacements },
    );
    const [accounts] = await queryInterface.sequelize.query(
      `SELECT account.id FROM Accounts account
       JOIN Memberships membership ON membership.accountId=account.id
       WHERE membership.organizationId=:organizationId
         AND membership.status='active' AND account.status='active'
       ORDER BY account.id ASC LIMIT 1`,
      { replacements: tenant.replacements },
    );
    if (courts.length < 2 || clients.length < 2) return;

    const today = new Date();
    const accountId = accounts[0]?.id || null;
    const now = new Date();
    const rows = [
      {
        ...tenant.insert,
        courtId: courts[0].id,
        userId: clients[0].id,
        clientName: clients[0].name,
        clientPhone: clients[0].phone,
        startsAt: atTime(today, 10),
        endsAt: atTime(today, 11, 30),
        durationMinutes: 90,
        status: 'confirmed',
        paymentStatus: 'paid',
        paymentMethod: 'cashless',
        price: 4500,
        paidAmount: 4500,
        source: 'phone',
        comment: 'Демо: бронь по телефону, оплатили безналом.',
        createdByAccountId: accountId,
        updatedByAccountId: accountId,
        createdAt: now,
        updatedAt: now,
      },
      {
        ...tenant.insert,
        courtId: courts[1].id,
        userId: clients[1].id,
        clientName: clients[1].name,
        clientPhone: clients[1].phone,
        startsAt: atTime(today, 12),
        endsAt: atTime(today, 13),
        durationMinutes: 60,
        status: 'new',
        paymentStatus: 'unpaid',
        paymentMethod: 'unknown',
        price: 3000,
        paidAmount: 0,
        source: 'phone',
        comment: 'Демо: клиент попросил перезвонить за час.',
        createdByAccountId: accountId,
        updatedByAccountId: accountId,
        createdAt: now,
        updatedAt: now,
      },
    ];

    await queryInterface.bulkInsert('Bookings', rows);
    const [bookings] = await queryInterface.sequelize.query(
      `SELECT id,status FROM Bookings WHERE ${tenant.predicate}comment IN (:comments) ORDER BY id DESC`,
      { replacements: {
        ...tenant.replacements,
        comments: DEMO_BOOKING_IDENTITIES.map((row) => row[0]),
      } },
    );
    await queryInterface.bulkInsert(
      'BookingChangeLogs',
      bookings.map((booking) => ({
        action: 'created',
        actorAccountId: accountId,
        bookingId: booking.id,
        fromStatus: null,
        toStatus: booking.status,
        reason: 'Demo seed',
        snapshot: JSON.stringify({ status: booking.status }),
        createdAt: now,
        updatedAt: now,
      })),
    );
  },

  async down(queryInterface) {
    const tenant = await resolveTenantScope(queryInterface);
    const bookingIds = await inventoryDemoBookings(queryInterface, tenant);
    if (bookingIds.length === 0) return;
    await queryInterface.sequelize.query(
      'DELETE FROM BookingChangeLogs WHERE bookingId IN (:bookingIds)',
      { replacements: { bookingIds } },
    );
    await queryInterface.bulkDelete('Bookings', { id: bookingIds });
  },
  _private: { inventoryDemoBookings },
};
