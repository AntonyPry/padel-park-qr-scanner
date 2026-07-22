'use strict';

function immutableAuthorityError(message) {
  const error = new Error(message);
  error.code = 'TENANT_AUTHORITY_IMMUTABLE';
  return error;
}

function assertBulkAuthorityFieldsAreMutable(options, immutableFields, message) {
  const updatedFields = new Set([
    ...Object.keys(options?.attributes || {}),
    ...(options?.fields || []),
  ]);
  if (immutableFields.some((field) => updatedFields.has(field))) {
    throw immutableAuthorityError(message);
  }
}

function assertInstanceAuthorityFieldsAreMutable(instance, immutableFields, message) {
  if (immutableFields.some((field) => instance.changed(field))) {
    throw immutableAuthorityError(message);
  }
}

module.exports = {
  assertBulkAuthorityFieldsAreMutable,
  assertInstanceAuthorityFieldsAreMutable,
  immutableAuthorityError,
};
