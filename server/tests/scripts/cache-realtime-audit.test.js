'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  auditClientSource,
  auditRepository,
  auditServerSource,
} = require('../../scripts/audit-tenant-cache-realtime');

test('tenant cache/realtime repository audit passes current call sites', () => {
  assert.deepEqual(auditRepository(), []);
});

test('client audit rejects ad hoc query keys but accepts the central factory', () => {
  const findings = auditClientSource(
    `useQuery({ queryKey: ['clients', id], queryFn });`,
    'client/src/pages/Synthetic.tsx',
  );
  assert.equal(findings.some((item) => item.type.includes('Ad hoc')), true);
  assert.deepEqual(
    auditClientSource(
      `useQuery({ queryKey: queryKeys.clients.detail(id), queryFn });`,
      'client/src/pages/Synthetic.tsx',
    ),
    [],
  );
});

test('server audit rejects unscoped cache and realtime publishers', () => {
  const cacheFindings = auditServerSource(
    `cacheService.rememberJson('clients:list', loader);`,
    'server/src/services/clients.service.js',
  );
  assert.equal(cacheFindings.some((item) => item.type.includes('cache')), true);

  const realtimeFindings = auditServerSource(
    `publishRealtimeChange(io, change, account);`,
    'server/src/controllers/example.controller.js',
  );
  assert.equal(realtimeFindings.some((item) => item.type.includes('context')), true);
});
