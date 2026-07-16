'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  ALLOWLISTS,
  auditRepository,
  auditSource,
} = require('../../scripts/audit-visit-scanner-writes');

test('Visit/scanner repository audit passes exact writer allowlists', () => {
  assert.deepEqual([...ALLOWLISTS.Visit].sort(), [
    'seeders/20260511120000-demo-crm-data.js',
    'src/services/access.service.js',
    'src/services/clients.service.js',
    'src/services/onboarding.service.js',
  ]);
  assert.deepEqual([...ALLOWLISTS.ScannerEvent].sort(), [
    'seeders/20260511120000-demo-crm-data.js',
    'src/services/onboarding.service.js',
    'src/services/scanner-events.service.js',
  ]);
  assert.deepEqual([...ALLOWLISTS.VisitCategoryAssignment].sort(), [
    'src/services/access.service.js',
    'src/services/onboarding.service.js',
  ]);
  assert.deepEqual(auditRepository(), []);
});

test('Visit/scanner audit detects model, aliases, instance, bulk and raw SQL writes', () => {
  const source = `
    const VisitModel = db.Visit;
    const createVisit = VisitModel.create.bind(VisitModel);
    await createVisit({ userId: 1 });
    const event = await db.ScannerEvent.findByPk(1);
    const saveEvent = event.save.bind(event);
    await saveEvent();
    await queryInterface.bulkInsert('VisitCategoryAssignments', rows);
    const sql = 'UPDATE Visits SET clubId = 99';
    const query = db.sequelize.query.bind(db.sequelize);
    await query(sql);
  `;
  const findings = auditSource(source, 'bypass.js');
  assert.ok(findings.some((finding) => finding.type === 'Visit static write alias'));
  assert.ok(findings.some((finding) => finding.type === 'ScannerEvent instance write alias'));
  assert.ok(findings.some((finding) => finding.type === 'VisitCategoryAssignments query-interface write'));
  assert.ok(findings.some((finding) => finding.type === 'Visits raw SQL write'));
});
