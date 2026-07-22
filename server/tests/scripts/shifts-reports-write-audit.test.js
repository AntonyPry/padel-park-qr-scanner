'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  auditRepository,
  auditSource,
} = require('../../scripts/audit-shifts-reports-writes');

test('shifts/reports write audit covers ORM, bulk and raw SQL bypasses', () => {
  const findings = auditSource(`
    db.Shift.create(payload);
    ShiftReportTemplate.bulkCreate(rows);
    answer.update({ reportId: 9 });
    queryInterface.bulkInsert('ShiftReports', rows);
    sequelize.query('UPDATE ShiftReportAnswers SET reportId = 2');
  `);
  assert.ok(findings.some((finding) => finding.match.includes('Shift.create')));
  assert.ok(findings.some((finding) => finding.match.includes('ShiftReportTemplate.bulkCreate')));
  assert.ok(findings.some((finding) => finding.match.includes('ShiftReports')));
  assert.ok(findings.some((finding) => finding.match.includes('ShiftReportAnswers')));
});

test('repository has no unauthorized shifts/reports direct writers', () => {
  assert.deepEqual(auditRepository(), []);
});
