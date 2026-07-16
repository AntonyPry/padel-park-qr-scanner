'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  MEMBERSHIP_ALLOWLIST,
  STAFF_ALLOWLIST,
  auditRepository,
  auditSource,
} = require('../../scripts/audit-staff-membership-writes');

test('Staff/Membership repository audit passes exact writer allowlists', () => {
  assert.deepEqual([...STAFF_ALLOWLIST].sort(), [
    'seeders/20260511120000-demo-crm-data.js',
    'src/services/account-lifecycle.service.js',
    'src/services/account-seeder-adapter.js',
    'src/services/staff.service.js',
  ]);
  assert.deepEqual([...MEMBERSHIP_ALLOWLIST].sort(), [
    'src/services/account-lifecycle.service.js',
    'src/services/account-seeder-adapter.js',
  ]);
  assert.deepEqual(auditRepository(), []);
});

test('Staff/Membership audit detects model, QueryInterface and raw SQL writes', () => {
  const source = `
    const staff = await db.Staff.findByPk(1);
    await staff.update({ status: 'archived' });
    await db.Membership.create({ accountId: 1 });
    await queryInterface.bulkInsert('Staffs', rows);
    await sequelize.query('UPDATE Memberships SET staffId = 1');
  `;
  const findings = auditSource(source, 'bypass.js');
  assert.ok(findings.some((finding) => finding.type === 'Staff instance write'));
  assert.ok(findings.some((finding) => finding.type === 'Membership static write'));
  assert.ok(findings.some((finding) => finding.type === 'Staffs query-interface write'));
  assert.ok(findings.some((finding) => finding.type === 'Memberships raw SQL write'));
});
