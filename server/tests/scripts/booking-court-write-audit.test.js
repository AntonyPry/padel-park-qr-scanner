'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  ALLOWLISTS,
  auditRepository,
  auditSource,
} = require('../../scripts/audit-booking-court-writes');

test('Booking/Court repository audit passes exact writer allowlists', () => {
  assert.deepEqual([...ALLOWLISTS.Booking].sort(), [
    'seeders/20260526101000-demo-bookings.js',
    'src/services/bookings.service.js',
    'src/services/clients.service.js',
    'src/services/onboarding.service.js',
  ]);
  assert.deepEqual([...ALLOWLISTS.Court].sort(), [
    'src/services/booking-rules.service.js',
    'src/services/bookings.service.js',
  ]);
  assert.deepEqual(auditRepository(), []);
});

test('Booking/Court audit detects aliases, save/update, bulk, QueryInterface and raw SQL', () => {
  const source = `
    const BookingModel = db.Booking;
    const createBooking = BookingModel.create.bind(BookingModel);
    await createBooking({ clubId: 99 });
    const court = await db.Court.findByPk(1);
    const saveCourt = court.save.bind(court);
    await saveCourt();
    const series = await db.BookingSeries.findOne({ where: { id: 1 } });
    await series.update({ organizationId: 9 });
    await db.BookingParticipant.bulkCreate(rows);
    await queryInterface.bulkUpdate('BookingChangeLogs', values, where);
    await sequelize.query('UPDATE BookingSettings SET clubId = 9');
    await db.Utilizations.upsert(values);
  `;
  const findings = auditSource(source, 'bypass.js');
  assert.ok(findings.some((finding) => finding.type === 'Booking static write alias'));
  assert.ok(findings.some((finding) => finding.type === 'Court instance write alias'));
  assert.ok(findings.some((finding) => finding.type === 'BookingSeries instance write'));
  assert.ok(findings.some((finding) => finding.type === 'BookingParticipant static write'));
  assert.ok(findings.some((finding) => finding.type === 'BookingChangeLogs query-interface write'));
  assert.ok(findings.some((finding) => finding.type === 'BookingSettings raw SQL write'));
  assert.ok(findings.some((finding) => finding.type === 'Utilizations static write'));
});
