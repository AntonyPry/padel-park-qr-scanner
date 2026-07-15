'use strict';

const crypto = require('node:crypto');
const { timingSafeEqual } = crypto;
const { requireDefaultTenantContext } = require('../files-workers/tenant-context');

function secretMatches(provided, expected) {
  const left = Buffer.from(String(provided || ''), 'utf8');
  const right = Buffer.from(String(expected || ''), 'utf8');
  return left.length > 0 && left.length === right.length && timingSafeEqual(left, right);
}

function requireConnectionSecret(context, key) {
  const value = context?.secrets?.[key];
  if (!value) {
    const error = new Error('Provider connection is not configured');
    error.code = 'PROVIDER_CONNECTION_CONFIGURATION_INVALID';
    error.statusCode = 503;
    throw error;
  }
  return value;
}

function assertIngressSecret(context, provided, key = 'webhookSecret') {
  const expected = requireConnectionSecret(context, key);
  if (!secretMatches(provided, expected)) {
    const error = new Error('Provider connection was not found');
    error.code = 'PROVIDER_CONNECTION_REJECTED';
    error.statusCode = 404;
    throw error;
  }
}

async function assertLegacyDownstreamReady(context) {
  return requireDefaultTenantContext(context);
}

module.exports = {
  assertIngressSecret,
  assertLegacyDownstreamReady,
  requireConnectionSecret,
  secretMatches,
};
