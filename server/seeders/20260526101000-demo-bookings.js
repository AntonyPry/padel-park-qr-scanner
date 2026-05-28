'use strict';

function atTime(date, hour, minute = 0) {
  const value = new Date(date);
  value.setHours(hour, minute, 0, 0);
  return value;
}

module.exports = {
  async up(queryInterface) {
    const [existing] = await queryInterface.sequelize.query(
      'SELECT COUNT(*) AS count FROM Bookings',
    );
    if (Number(existing[0]?.count || 0) > 0) return;

    const [courts] = await queryInterface.sequelize.query(
      'SELECT id, name FROM Courts WHERE isActive = 1 ORDER BY sortOrder ASC LIMIT 6',
    );
    const [clients] = await queryInterface.sequelize.query(
      "SELECT id, name, phone FROM Users WHERE status = 'active' ORDER BY id ASC LIMIT 6",
    );
    const [accounts] = await queryInterface.sequelize.query(
      "SELECT id FROM Accounts WHERE status = 'active' ORDER BY id ASC LIMIT 1",
    );
    if (courts.length < 2 || clients.length < 2) return;

    const today = new Date();
    const accountId = accounts[0]?.id || null;
    const now = new Date();
    const rows = [
      {
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
      'SELECT id, status FROM Bookings ORDER BY id DESC LIMIT 2',
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
    await queryInterface.sequelize.query(
      "DELETE FROM BookingChangeLogs WHERE reason = 'Demo seed'",
    );
    await queryInterface.sequelize.query(
      "DELETE FROM Bookings WHERE comment LIKE 'Демо:%'",
    );
  },
};
