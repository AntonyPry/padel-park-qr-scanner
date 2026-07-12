const assert = require('node:assert/strict');
const test = require('node:test');
const { apiSchemas } = require('../../src/contracts/api-schemas');
const { endpointContracts } = require('../../src/contracts/openapi');

test('visits analytics segment preview and ClientBase filter stay in the generated API contract', () => {
  const preview = apiSchemas.visitsAnalytics.clientBasePreviewBody.safeParse({
    asOf: '2026-07-12T20:59:59.999Z',
    from: '2026-06-12',
    kind: 'lifecycle',
    lifecycleStatus: 'atRisk',
    sourceKeys: ['id:7', 'unspecified'],
    to: '2026-07-12',
  });
  assert.equal(preview.success, true);

  const base = apiSchemas.clientBases.body.safeParse({
    filters: {
      status: 'active',
      visitsAnalytics: {
        algorithmVersion: 'visits_analytics_segment_v1',
        asOf: '2026-07-12T20:59:59.999Z',
        canonicalClientRule: 'recursive_merged_root_v1',
        clientStatus: 'active',
        excludeDuplicateVisits: true,
        excludeTraining: true,
        lifecycleStatus: 'atRisk',
        sourceKeys: ['id:7'],
        timeZone: 'Europe/Moscow',
      },
    },
    name: 'Под риском · 2026-07-12',
    origin: 'visits_analytics',
    originMetadata: { algorithmVersion: 'visits_analytics_segment_v1' },
  });
  assert.equal(base.success, true);

  assert.ok(endpointContracts.some((endpoint) => (
    endpoint.id === 'visitsAnalytics.clientBasePreview'
      && endpoint.method === 'post'
      && endpoint.path === '/analytics/visits/client-base-preview'
  )));
});
