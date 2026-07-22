'use strict';

const crypto = require('node:crypto');
const { secretMatches } = require('./runtime');

const BEELINE_WEBHOOK_AUTH_MODES = Object.freeze({
  CAPABILITY_URI: 'capability_uri',
  SHARED_SECRET_HEADER: 'shared_secret_header',
});
const CALLBACK_TOKEN_PATTERN = /^[a-f0-9]{64}$/u;
const CAPABILITY_PATH_PATTERN = /\/api\/integrations\/beeline\/events\/ic_[a-f0-9]{32}\/[^/?\s]+/gu;
const CALLBACK_QUERY_SECRET_PATTERN = /([?&](?:callbackToken|access[-_]?key|signingKey|secret)=)[^&#\s]*/giu;
const REDACTED_CAPABILITY_PATH = '/api/integrations/beeline/events/[redacted]';

function callbackError(code = 'PROVIDER_CONNECTION_REJECTED') {
  const error = new Error('Provider connection was not found');
  error.code = code;
  error.statusCode = 404;
  return error;
}

function generateCallbackToken() {
  return crypto.randomBytes(32).toString('hex');
}

function assertCallbackToken(value) {
  const token = String(value || '').trim();
  if (!CALLBACK_TOKEN_PATTERN.test(token)) {
    throw callbackError('BEELINE_CALLBACK_CAPABILITY_INVALID');
  }
  return token;
}

function assertCapabilityConnection(connection, suppliedToken) {
  if (connection?.config?.webhookAuthMode !== BEELINE_WEBHOOK_AUTH_MODES.CAPABILITY_URI) {
    throw callbackError('BEELINE_CALLBACK_AUTH_MODE_MISMATCH');
  }
  const expected = assertCallbackToken(connection?.secrets?.callbackToken);
  const supplied = String(suppliedToken || '').trim();
  if (!CALLBACK_TOKEN_PATTERN.test(supplied) || !secretMatches(supplied, expected)) {
    throw callbackError('BEELINE_CALLBACK_CAPABILITY_MISMATCH');
  }
  return connection;
}

function assertSharedHeaderConnection(connection, suppliedSecret) {
  if (
    connection?.config?.webhookAuthMode !==
      BEELINE_WEBHOOK_AUTH_MODES.SHARED_SECRET_HEADER ||
    !secretMatches(suppliedSecret, connection?.secrets?.webhookSecret)
  ) {
    throw callbackError('BEELINE_CALLBACK_SHARED_SECRET_MISMATCH');
  }
  return connection;
}

function callbackBaseUrl(connection) {
  const value = String(connection?.config?.callbackBaseUrl || '').trim().replace(/\/+$/u, '');
  if (!value || /[?#]/u.test(value)) {
    const error = new Error('Beeline callback base URL is invalid');
    error.code = 'BEELINE_CALLBACK_CONFIGURATION_INVALID';
    error.statusCode = 409;
    throw error;
  }
  return value;
}

function buildCapabilityCallbackUrl(connection) {
  const publicId = String(connection?.publicId || '').trim();
  const token = assertCallbackToken(connection?.secrets?.callbackToken);
  if (!/^ic_[a-f0-9]{32}$/u.test(publicId)) {
    const error = new Error('Beeline connection identity is invalid');
    error.code = 'BEELINE_CALLBACK_CONFIGURATION_INVALID';
    error.statusCode = 409;
    throw error;
  }
  return `${callbackBaseUrl(connection)}/${publicId}/${token}`;
}

function redactCapabilityValue(value, callbackToken = null) {
  if (typeof value === 'string') {
    const pathRedacted = value
      .replace(CAPABILITY_PATH_PATTERN, REDACTED_CAPABILITY_PATH)
      .replace(CALLBACK_QUERY_SECRET_PATTERN, '$1[redacted]');
    return CALLBACK_TOKEN_PATTERN.test(String(callbackToken || ''))
      ? pathRedacted.replaceAll(callbackToken, '[redacted]')
      : pathRedacted;
  }
  if (Array.isArray(value)) {
    return value.map((child) => redactCapabilityValue(child, callbackToken));
  }
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [
      key,
      redactCapabilityValue(child, callbackToken),
    ]),
  );
}

function redactRequestTarget(value) {
  return redactCapabilityValue(String(value || ''));
}

module.exports = {
  BEELINE_WEBHOOK_AUTH_MODES,
  CALLBACK_TOKEN_PATTERN,
  REDACTED_CAPABILITY_PATH,
  assertCallbackToken,
  assertCapabilityConnection,
  assertSharedHeaderConnection,
  buildCapabilityCallbackUrl,
  generateCallbackToken,
  redactCapabilityValue,
  redactRequestTarget,
};
