'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  auditRepository,
  auditSource,
} = require('../../scripts/audit-audit-log-writes');

test('AuditLog AST audit accepts the canonical service writer', () => {
  assert.deepEqual(auditSource(
    'await db.AuditLog.create({ action: "create" });',
    'src/services/audit.service.js',
  ), []);
});

test('AuditLog AST audit rejects ORM, bulk and raw SQL bypasses', () => {
  const source = `
    await db.AuditLog.update({ role: 'owner' }, { where: { id: 1 } });
    await AuditLog.bulkCreate([]);
    await sequelize.query('DELETE FROM AuditLogs WHERE id = 1');
  `;
  const findings = auditSource(source, 'src/services/rogue.js');
  assert.deepEqual(
    findings.map((finding) => finding.type),
    ['model-write', 'model-write', 'raw-sql-write'],
  );
});

test('repository has no unauthorized AuditLog writers', () => {
  assert.deepEqual(auditRepository(), []);
});
