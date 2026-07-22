'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  ALLOWLISTS,
  auditRepository,
  auditSource,
} = require('../../scripts/audit-client-money-writes');

test('client-money repository audit passes exact writer allowlists', () => {
  assert.deepEqual([...ALLOWLISTS.PendingSale], [
    'src/services/pending-sale.service.js',
  ]);
  assert.deepEqual([...ALLOWLISTS.CertificateRedemption], [
    'src/services/certificates.service.js',
  ]);
  assert.deepEqual(auditRepository(), []);
});

test('client-money audit detects model, instance, bulk and SQL writes', () => {
  const source = `
    await db.Certificate.create({ organizationId: 2, clubId: 4 });
    const subscription = await db.ClientSubscription.findByPk(1);
    await subscription.update({ clubId: 9 });
    await db.PendingSale.bulkCreate(rows);
    await queryInterface.bulkUpdate('CorporateLedgerEntries', values, where);
    await sequelize.query('DELETE FROM CertificateRedemptions WHERE id=1');
  `;
  const findings = auditSource(source, 'bypass.js');
  assert.ok(findings.some((finding) =>
    finding.type === 'Certificate static write'));
  assert.ok(findings.some((finding) =>
    finding.type === 'ClientSubscription instance write'));
  assert.ok(findings.some((finding) =>
    finding.type === 'PendingSale static write'));
  assert.ok(findings.some((finding) =>
    finding.type === 'CorporateLedgerEntries query-interface write'));
  assert.ok(findings.some((finding) =>
    finding.type === 'CertificateRedemptions raw SQL write'));
});
