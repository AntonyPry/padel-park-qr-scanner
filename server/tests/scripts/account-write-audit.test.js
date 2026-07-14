'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  auditRepository,
  auditSource,
} = require('../../scripts/audit-account-writes');

test('Account direct-write repository audit passes current allowlist', () => {
  assert.deepEqual(auditRepository(), []);
});

test('Account direct-write audit rejects static, inferred instance and bulk writes', () => {
  const source = `
    const target = await db.Account.findByPk(1);
    await target.update({ role: 'manager' });
    await db.Account.create({ email: 'bad@example.com' });
    await queryInterface.bulkDelete('Accounts', {});
  `;
  const findings = auditSource(source, 'synthetic.js');
  assert.equal(findings.length, 3, JSON.stringify(findings));
  assert.deepEqual(
    new Set(findings.map((finding) => finding.type)),
    new Set([
      'Account inferred instance write',
      'Account static write',
      'Accounts bulk write',
    ]),
  );
});
