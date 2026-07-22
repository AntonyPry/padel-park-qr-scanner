'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  ALLOWLISTS,
  auditRepository,
  auditSource,
} = require('../../scripts/audit-client-base-call-task-writes');

test('client-base/call-task repository audit passes exact writer allowlists', () => {
  assert.deepEqual([...ALLOWLISTS.ClientBase].sort(), [
    'seeders/20260511120000-demo-crm-data.js',
    'src/services/call-tasks.service.js',
    'src/services/client-bases.service.js',
    'src/services/onboarding.service.js',
  ]);
  assert.deepEqual([...ALLOWLISTS.ClientSavedView].sort(), [
    'seeders/20260511120000-demo-crm-data.js',
    'src/services/clients.service.js',
    'src/services/onboarding.service.js',
  ]);
  assert.deepEqual(auditRepository(), []);
});

test('client-base/call-task audit detects model, alias, instance, bulk and SQL writes', () => {
  const source = `
    const TaskModel = db.CallTask;
    const createTask = TaskModel.create.bind(TaskModel);
    await createTask({ organizationId: 99 });
    const base = await db.ClientBase.findByPk(1);
    const saveBase = base.save.bind(base);
    await saveBase();
    await queryInterface.bulkInsert('CallTaskClients', rows);
    await sequelize.query('UPDATE ClientSavedViews SET clubId = 9');
    await db.CallTaskAttempt.bulkCreate(attempts);
  `;
  const findings = auditSource(source, 'bypass.js');
  assert.ok(findings.some((finding) => finding.type === 'CallTask static write alias'));
  assert.ok(findings.some((finding) => finding.type === 'ClientBase instance write alias'));
  assert.ok(findings.some((finding) => finding.type === 'CallTaskClients query-interface write'));
  assert.ok(findings.some((finding) => finding.type === 'ClientSavedViews raw SQL write'));
  assert.ok(findings.some((finding) => finding.type === 'CallTaskAttempt static write'));
});
