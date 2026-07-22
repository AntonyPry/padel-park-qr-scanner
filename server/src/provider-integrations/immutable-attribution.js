'use strict';

function immutableAttributionError(message) {
  const error = new Error(message);
  error.code = 'PROVIDER_ATTRIBUTION_IMMUTABLE';
  return error;
}

function assertBulkFieldsAreMutable(options, immutableFields, message) {
  const updatedFields = new Set([
    ...Object.keys(options?.attributes || {}),
    ...(options?.fields || []),
  ]);
  if (immutableFields.some((field) => updatedFields.has(field))) {
    throw immutableAttributionError(message);
  }
}

module.exports = {
  assertBulkFieldsAreMutable,
  immutableAttributionError,
};
