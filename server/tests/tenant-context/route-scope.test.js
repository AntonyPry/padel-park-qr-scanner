'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { endpointContracts, getOpenApiDocument } = require('../../src/contracts/openapi');
const {
  GLOBAL_ENDPOINT_IDS,
  PROVIDER_INGRESS_ENDPOINT_IDS,
  WORKER_ENDPOINT_IDS,
  auditEndpointScopeDeclarations,
  getEndpointTenantScope,
} = require('../../src/tenant-context/route-scope-declarations');
const { resolveRouteDeclaration } = require('../../src/tenant-context/route-registry');
const { resolveRequestTenant } = require('../../src/middleware/tenant-context');

function createResponse() {
  return {
    body: null,
    statusCode: null,
    json(payload) {
      this.body = payload;
      return this;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
  };
}

test('all OpenAPI endpoints have an audited tenant scope declaration', () => {
  const audit = auditEndpointScopeDeclarations(endpointContracts);
  assert.equal(audit.ok, true, JSON.stringify(audit));
  assert.equal(audit.undeclared.length, 0);
  assert.equal(audit.duplicateKeys.length, 0);

  for (const endpoint of endpointContracts) {
    assert.equal(endpoint.tenantScope, getEndpointTenantScope(endpoint.id));
    const authenticatedGlobal =
      endpoint.id === 'auth.me' || endpoint.id === 'auth.memberships';
    assert.equal(
      Boolean(endpoint.public),
      (GLOBAL_ENDPOINT_IDS.has(endpoint.id) && !authenticatedGlobal) ||
        PROVIDER_INGRESS_ENDPOINT_IDS.has(endpoint.id) ||
        WORKER_ENDPOINT_IDS.has(endpoint.id),
      endpoint.id,
    );
  }
});

test('public provider and worker endpoints are strict explicit exceptions', () => {
  assert.deepEqual(
    [...PROVIDER_INGRESS_ENDPOINT_IDS].sort(),
    [
      'telephony.beelineConnectionWebhook',
      'telephony.beelineWebhook',
      'webhooks.evotor',
      'webhooks.evotorConnection',
    ],
  );
  assert.equal(WORKER_ENDPOINT_IDS.size, 7);
  for (const id of PROVIDER_INGRESS_ENDPOINT_IDS) {
    assert.equal(getEndpointTenantScope(id), 'provider_ingress');
  }
  for (const id of WORKER_ENDPOINT_IDS) {
    assert.equal(getEndpointTenantScope(id), 'worker');
  }
});

test('route registry matches static and parameterized requests', () => {
  assert.equal(resolveRouteDeclaration('GET', '/api/auth/me/memberships').id, 'auth.memberships');
  assert.equal(resolveRouteDeclaration('PUT', '/api/accounts/42').id, 'accounts.update');
  assert.equal(
    resolveRouteDeclaration('POST', '/api/clients/7/training-notes').id,
    'trainingNotes.create',
  );
});

test('undeclared synthetic protected route is rejected before a controller', async () => {
  const previous = process.env.TENANT_CONTEXT_ENABLED;
  process.env.TENANT_CONTEXT_ENABLED = 'false';
  const req = {
    account: { id: 1, role: 'owner' },
    headers: {},
    method: 'GET',
    originalUrl: '/api/synthetic-undeclared',
    path: '/synthetic-undeclared',
    rawHeaders: [],
  };
  const res = createResponse();
  let nextCalled = false;
  await resolveRequestTenant(req, res, () => {
    nextCalled = true;
  });
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 500);
  assert.equal(res.body.code, 'TENANT_SCOPE_UNDECLARED');
  process.env.TENANT_CONTEXT_ENABLED = previous;
});

test('OpenAPI differentiates global, organization and club transports', () => {
  const document = getOpenApiDocument();
  const discovery = document.paths['/auth/me/memberships'].get;
  const accounts = document.paths['/accounts'].get;
  const bookings = document.paths['/bookings/schedule'].get;
  assert.equal(discovery['x-tenant-scope'], 'global');
  assert.equal(discovery.parameters, undefined);
  assert.deepEqual(
    accounts.parameters.filter((parameter) => parameter.in === 'header').map((parameter) => parameter.name),
    ['X-Organization-Id'],
  );
  assert.deepEqual(
    bookings.parameters.filter((parameter) => parameter.in === 'header').map((parameter) => parameter.name),
    ['X-Organization-Id', 'X-Club-Id'],
  );
});
