'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { apiSchemas } = require('../../src/contracts/api-schemas');
const {
  endpointContracts,
  getOpenApiDocument,
} = require('../../src/contracts/openapi');
const { resolveRouteDeclaration } = require('../../src/tenant-context/route-registry');

test('POST /auth/logout is the only new public normal-session route contract', () => {
  const endpoint = endpointContracts.find((item) => item.id === 'auth.logout');
  assert.deepEqual(
    {
      method: endpoint?.method,
      path: endpoint?.path,
      public: endpoint?.public,
      tenantScope: endpoint?.tenantScope,
    },
    {
      method: 'post',
      path: '/auth/logout',
      public: true,
      tenantScope: 'global',
    },
  );
  assert.deepEqual(apiSchemas.auth.logoutResponse.parse({ success: true }), {
    success: true,
  });

  const route = resolveRouteDeclaration('POST', '/api/auth/logout');
  assert.deepEqual(
    {
      classification: route?.classification,
      id: route?.id,
      public: route?.public,
    },
    { classification: 'global', id: 'auth.logout', public: true },
  );

  const operation = getOpenApiDocument().paths['/auth/logout']?.post;
  assert.equal(operation.operationId, 'auth.logout');
  assert.equal(operation.responses['200'].content['application/json'].schema.type, 'object');
  assert.deepEqual(operation.security, []);

  const repositoryRoot = path.resolve(__dirname, '../../..');
  const generatedOpenApi = JSON.parse(
    fs.readFileSync(path.join(repositoryRoot, 'docs/openapi.json'), 'utf8'),
  );
  assert.deepEqual(generatedOpenApi, getOpenApiDocument());
  const generatedClient = fs.readFileSync(
    path.join(repositoryRoot, 'client/src/api/generated.ts'),
    'utf8',
  );
  assert.match(
    generatedClient,
    /"auth\.logout": \{ method: "POST", path: "\/auth\/logout", responseType: "json", tenantScope: "global" \}/u,
  );
  assert.match(generatedClient, /"auth\.logout": AuthLogoutResponse;/u);
});
