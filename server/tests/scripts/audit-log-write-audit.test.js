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
  assert.equal(
    auditSource(
      'await db.AuditLog.update({ role: "owner" });',
      'src/services/audit.service.js',
    ).length,
    1,
  );
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
    ['AuditLog static write', 'AuditLog static write', 'AuditLogs raw SQL write'],
  );
});

test('AuditLog AST audit follows model, method and derived-instance aliases', () => {
  const source = `
    const Log = db.AuditLog;
    const { update: mutate } = Log;
    await mutate({ summary: 'bad' }, { where: { id: 1 } });
    const auditLog = await Log.findByPk(1);
    const saveAudit = auditLog.save.bind(auditLog);
    await auditLog.update({ summary: 'bad' });
    await auditLog.destroy();
    await saveAudit();
    const [created] = await Log.findOrCreate({ where: { id: 1 } });
    await created.restore();
    const { findOne: findAudit } = Log;
    const foundViaAlias = await findAudit({ where: { id: 1 } });
    await foundViaAlias.destroy();
  `;
  const findings = auditSource(source, 'src/services/rogue-alias.js');
  assert.equal(findings.length, 7);
  assert.equal(findings.some((finding) => finding.type === 'AuditLog static write'), true);
  assert.equal(findings.filter((finding) =>
    finding.type.startsWith('AuditLog instance write')).length, 5);
});

test('AuditLog AST audit rejects queryInterface writes with static table aliases', () => {
  const source = `
    const table = 'AuditLogs';
    queryInterface.bulkInsert(table, []);
    queryInterface.bulkUpdate('AuditLogs', {}, {});
    queryInterface.bulkDelete('AuditLogs', {});
    queryInterface.insert(null, table, {});
    queryInterface.update(null, 'AuditLogs', {}, {});
    queryInterface.delete(null, table, {});
    queryInterface.upsert('AuditLogs', {}, {}, {});
    queryInterface.truncate(table);
    const { bulkInsert: insertMany } = queryInterface;
    insertMany(table, []);
  `;
  const findings = auditSource(source, 'src/services/rogue-query-interface.js');
  assert.equal(findings.length, 9);
  assert.equal(findings.every((finding) =>
    finding.type === 'AuditLogs query-interface write'), true);
});

test('AuditLog AST audit resolves raw SQL aliases, concatenation and templates', () => {
  const source = `
    const table = 'AuditLogs';
    const insert = \`INSERT INTO \${table} (action) VALUES ('bad')\`;
    const update = 'UPDATE ' + table + ' SET action="bad"';
    const { query: rawQuery } = sequelize;
    await sequelize.query(insert);
    await rawQuery(update);
    await sequelize.query(\`TRUNCATE TABLE \${table}\`);
  `;
  const findings = auditSource(source, 'src/services/rogue-raw.js');
  assert.equal(findings.length, 3);
  assert.equal(findings.every((finding) =>
    finding.type === 'AuditLogs raw SQL write'), true);
});

test('repository has no unauthorized AuditLog writers', () => {
  assert.deepEqual(auditRepository(), []);
});
