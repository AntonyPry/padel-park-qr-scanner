'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  runAudit,
} = require('../../scripts/audit-tenant-files-workers');

test('tenant files/workers audit classifies every runtime file I/O and enforces lease/storage primitives', () => {
  const result = runAudit();
  assert.deepEqual(result.findings, []);
  assert.equal(result.ok, true);
  assert.ok(result.inventory.length >= 10);
});
