const assert = require('node:assert/strict');
const test = require('node:test');
const { apiSchemas } = require('../../src/contracts/api-schemas');
const { endpointContracts } = require('../../src/contracts/openapi');

test('revenue LTV endpoint reuses the stable date/source filter contract', () => {
  const query = apiSchemas.visitsAnalytics.filteredDateRangeQuery.safeParse({
    from: '2026-01-01',
    to: '2026-06-30',
    sources: 'id:7,unspecified',
  });
  assert.equal(query.success, true);
  assert.equal(apiSchemas.visitsAnalytics.filteredDateRangeQuery.safeParse({
    from: '2026-01-01',
    to: '2026-06-30',
    sources: 'unsafe-key',
  }).success, false);
  assert.ok(endpointContracts.some((endpoint) => (
    endpoint.id === 'visitsAnalytics.revenueLtv'
      && endpoint.method === 'get'
      && endpoint.path === '/analytics/visits/revenue-ltv'
      && endpoint.query === apiSchemas.visitsAnalytics.filteredDateRangeQuery
  )));
});
