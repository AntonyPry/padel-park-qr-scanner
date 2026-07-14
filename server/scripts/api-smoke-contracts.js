const REQUIRED_OPENAPI_OPERATIONS = Object.freeze([
  Object.freeze({
    method: 'patch',
    name: 'access.correctKey',
    path: '/key',
  }),
]);

function findMissingOpenApiOperations(
  document,
  requirements = REQUIRED_OPENAPI_OPERATIONS,
) {
  return requirements.filter(({ method, path }) => {
    const operation = document?.paths?.[path]?.[method.toLowerCase()];
    return !operation;
  });
}

module.exports = {
  REQUIRED_OPENAPI_OPERATIONS,
  findMissingOpenApiOperations,
};
