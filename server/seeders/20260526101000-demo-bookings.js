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
      `SELECT id, status FROM Bookings WHERE ${tenant.predicate}comment LIKE 'Демо:%' ORDER BY id DESC LIMIT 2`,
      { replacements: tenant.replacements },
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
    await queryInterface.sequelize.query(
      `DELETE h FROM BookingChangeLogs AS h
        JOIN Bookings AS b ON b.id = h.bookingId
       WHERE ${tenant.insert.organizationId ? 'b.organizationId = :organizationId AND b.clubId = :clubId AND ' : ''}h.reason = 'Demo seed'`,
      { replacements: tenant.replacements },
    );
    await queryInterface.sequelize.query(
      `DELETE FROM Bookings WHERE ${tenant.predicate}comment LIKE 'Демо:%'`,
      { replacements: tenant.replacements },
    );
  },
};
