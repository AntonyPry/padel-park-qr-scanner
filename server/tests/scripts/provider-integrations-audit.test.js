'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  auditTenantProviderIntegrations,
} = require('../../scripts/audit-tenant-provider-integrations');

test('provider audit covers ingress, secrets, locks and authoritative reconciliation identity', () => {
  const result = auditTenantProviderIntegrations();
  assert.equal(result.ok, true, JSON.stringify(result.failures, null, 2));
});
