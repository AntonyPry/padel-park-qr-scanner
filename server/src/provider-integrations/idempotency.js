'use strict';

const crypto = require('node:crypto');

function normalizeIdentityPart(value, label) {
  const normalized = String(value ?? '').trim();
  if (!normalized) {
    const error = new Error(`Provider idempotency ${label} is required`);
    error.code = 'PROVIDER_IDEMPOTENCY_CONTEXT_INVALID';
    error.statusCode = 500;
    throw error;
  }
  return normalized;
}

function hashParts(parts) {
  return crypto.createHash('sha256').update(parts.join('\u001f')).digest('hex');
}

function buildProviderNamespace(context) {
  if (!context) return hashParts(['legacy', 'single-default']);
  return hashParts([
    normalizeIdentityPart(context.provider, 'provider'),
    normalizeIdentityPart(context.connectionId, 'connection'),
    normalizeIdentityPart(context.organizationId, 'organization'),
    normalizeIdentityPart(context.clubId, 'club'),
  ]);
}

function buildProviderIdempotencyKey(context, externalId) {
  return hashParts([
    buildProviderNamespace(context),
    normalizeIdentityPart(externalId, 'external ID'),
  ]);
}

module.exports = {
  buildProviderIdempotencyKey,
  buildProviderNamespace,
  hashParts,
};
