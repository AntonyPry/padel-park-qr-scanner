const assert = require('node:assert/strict');
const { afterEach, beforeEach, test } = require('node:test');
const db = require('../../models');
const auditService = require('../../src/services/audit.service');
const { mockExactSingletonDefault } = require('../helpers/tenant-fixtures');

const originalModels = {
  AuditLog: db.AuditLog,
};
let restoreSingleton;

beforeEach(() => {
  restoreSingleton = mockExactSingletonDefault(db);
});

afterEach(() => {
  Object.assign(db, originalModels);
  restoreSingleton();
});

test('audit logs corporate deposit create on corporate client id', async () => {
  const rows = [];
  db.AuditLog = {
    async create(row) {
      rows.push(row);
    },
  };

  await auditService.record({
    account: { id: 7, role: 'accountant' },
    method: 'POST',
    path: '/api/corporate-clients/12/deposits',
    statusCode: 201,
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].entityType, 'corporate_client');
  assert.equal(rows[0].entityId, '12');
});

test('audit logs corporate deposit cancel on ledger entry id', async () => {
  const rows = [];
  db.AuditLog = {
    async create(row) {
      rows.push(row);
    },
  };

  await auditService.record({
    account: { id: 7, role: 'accountant' },
    method: 'POST',
    path: '/api/corporate-clients/12/deposits/34/cancel',
    statusCode: 200,
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].entityType, 'corporate_ledger_entry');
  assert.equal(rows[0].entityId, '34');
});

test('audit logs corporate spending create on corporate client id', async () => {
  const rows = [];
  db.AuditLog = {
    async create(row) {
      rows.push(row);
    },
  };

  await auditService.record({
    account: { id: 7, role: 'accountant' },
    method: 'POST',
    path: '/api/corporate-clients/12/spendings',
    statusCode: 201,
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].entityType, 'corporate_client');
  assert.equal(rows[0].entityId, '12');
});

test('audit logs corporate spending reverse on ledger entry id', async () => {
  const rows = [];
  db.AuditLog = {
    async create(row) {
      rows.push(row);
    },
  };

  await auditService.record({
    account: { id: 7, role: 'accountant' },
    method: 'POST',
    path: '/api/corporate-clients/12/spendings/56/reverse',
    statusCode: 200,
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].action, 'reverse');
  assert.equal(rows[0].entityType, 'corporate_ledger_entry');
  assert.equal(rows[0].entityId, '56');
});
