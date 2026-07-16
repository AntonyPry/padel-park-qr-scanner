'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  ALLOWLISTS,
  auditRepository,
  auditSource,
} = require('../../scripts/audit-client-reference-writes');

test('User/client reference repository audit passes exact writer allowlists', () => {
  assert.deepEqual([...ALLOWLISTS.User].sort(), [
    'seeders/20260511120000-demo-crm-data.js',
    'src/services/account-lifecycle.service.js',
    'src/services/account-seeder-adapter.js',
    'src/services/bookings.service.js',
    'src/services/clients.service.js',
    'src/services/telephony.service.js',
  ]);
  assert.deepEqual([...ALLOWLISTS.ClientSource].sort(), [
    'src/services/account-lifecycle.service.js',
    'src/services/account-seeder-adapter.js',
    'src/services/references.service.js',
  ]);
  assert.deepEqual([...ALLOWLISTS.VisitCategory].sort(), [
    'src/services/account-lifecycle.service.js',
    'src/services/account-seeder-adapter.js',
    'src/services/references.service.js',
  ]);
  assert.deepEqual(auditRepository(), []);
});

test('User/client reference audit detects model, instance, QueryInterface and SQL writes', () => {
  const source = `
    const client = await db.User.findByPk(1);
    await client.update({ status: 'archived' });
    await db.ClientSource.create({ name: 'Unsafe' });
    await queryInterface.bulkInsert('VisitCategories', rows);
    await sequelize.query('UPDATE Users SET sourceId = 1');
  `;
  const findings = auditSource(source, 'bypass.js');
  assert.ok(findings.some((finding) => finding.type === 'User instance write'));
  assert.ok(findings.some((finding) => finding.type === 'ClientSource static write'));
  assert.ok(
    findings.some(
      (finding) => finding.type === 'VisitCategories query-interface write',
    ),
  );
  assert.ok(findings.some((finding) => finding.type === 'Users raw SQL write'));
});
