const assert = require('node:assert/strict');
const test = require('node:test');

const {
  findMissingOpenApiOperations,
  REQUIRED_OPENAPI_OPERATIONS,
} = require('../../scripts/api-smoke-contracts');

test('required OpenAPI smoke contract includes visit key correction', () => {
  assert.deepEqual(REQUIRED_OPENAPI_OPERATIONS, [
    {
      method: 'patch',
      name: 'access.correctKey',
      path: '/key',
    },
  ]);
});

test('reports the missing visit key correction route', () => {
  const missing = findMissingOpenApiOperations({
    paths: {
      '/key': {
        post: { operationId: 'access.issueKey' },
      },
    },
  });

  assert.deepEqual(missing, REQUIRED_OPENAPI_OPERATIONS);
});

test('accepts the visit key correction route regardless of other operations', () => {
  const missing = findMissingOpenApiOperations({
    paths: {
      '/key': {
        patch: { operationId: 'access.correctKey' },
      },
    },
  });

  assert.deepEqual(missing, []);
});
