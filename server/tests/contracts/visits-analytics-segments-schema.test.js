const assert = require('node:assert/strict');
const test = require('node:test');
const { apiSchemas } = require('../../src/contracts/api-schemas');
const { endpointContracts } = require('../../src/contracts/openapi');

test('visits analytics segment preview and server-owned create stay in the generated API contract', () => {
  const preview = apiSchemas.visitsAnalytics.clientBasePreviewBody.safeParse({
    asOf: '2026-07-12T20:59:59.999Z',
    from: '2026-06-12',
    kind: 'lifecycle',
    lifecycleStatus: 'atRisk',
    sourceKeys: ['id:7', 'unspecified'],
    to: '2026-07-12',
  });
  assert.equal(preview.success, true);

  const base = apiSchemas.visitsAnalytics.clientBaseCreateBody.safeParse({
    description: 'Сервер повторно рассчитает сегмент',
    name: 'Под риском · 2026-07-12',
    selection: preview.data,
  });
  assert.equal(base.success, true);

  assert.ok(endpointContracts.some((endpoint) => (
    endpoint.id === 'visitsAnalytics.clientBasePreview'
      && endpoint.method === 'post'
      && endpoint.path === '/analytics/visits/client-base-preview'
  )));
  assert.ok(endpointContracts.some((endpoint) => (
    endpoint.id === 'visitsAnalytics.createClientBase'
      && endpoint.method === 'post'
      && endpoint.path === '/analytics/visits/client-bases'
  )));
});
