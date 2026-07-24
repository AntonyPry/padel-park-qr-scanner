'use strict';

const crypto = require('node:crypto');
const { isProviderCredentialKey } = require('./credential-keys');
const {
  decodeBase64Key,
  decryptSecretEnvelope,
  encryptSecretEnvelope,
} = require('../security/secret-envelope');

function integrationSecretError(code = 'INTEGRATION_SECRET_CONFIGURATION_INVALID') {
  const error = new Error('Integration secret configuration is invalid');
  error.code = code;
  error.statusCode = 503;
  return error;
}

function getMasterKey() {
  const encoded = String(process.env.INTEGRATION_SECRETS_MASTER_KEY || '').trim();
  if (!encoded) throw integrationSecretError();
  try {
    return decodeBase64Key(encoded, 'INTEGRATION_SECRET_CONFIGURATION_INVALID');
  } catch {
    throw integrationSecretError();
  }
}

function getIntegrationFingerprintKey() {
  return crypto
    .createHmac('sha256', getMasterKey())
    .update('setly:integration-fingerprint:v1')
    .digest();
}

function assertIntegrationSecretConfiguration({ requireExplicitVersion = false } = {}) {
  getMasterKey();
  const keyVersion = String(process.env.INTEGRATION_SECRETS_KEY_VERSION || '').trim();
  if (
    (requireExplicitVersion && !keyVersion) ||
    (keyVersion && !/^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/u.test(keyVersion))
  ) {
    throw integrationSecretError();
  }
  return Object.freeze({ keyVersion: keyVersion || 'v1' });
}

function normalizeSecretBundle(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw integrationSecretError('INTEGRATION_SECRET_PAYLOAD_INVALID');
  }
  const normalized = {};
  for (const [key, raw] of Object.entries(value)) {
    if (
      !/^[a-z][A-Za-z0-9]{1,63}$/u.test(key) ||
      (!isProviderCredentialKey(key) && key !== 'proxyUrl')
    ) {
      throw integrationSecretError('INTEGRATION_SECRET_PAYLOAD_INVALID');
    }
    const secret = String(raw || '').trim();
    if (!secret || secret.length > 8192) {
      throw integrationSecretError('INTEGRATION_SECRET_PAYLOAD_INVALID');
    }
    normalized[key] = secret;
  }
  if (Object.keys(normalized).length === 0) {
    throw integrationSecretError('INTEGRATION_SECRET_PAYLOAD_INVALID');
  }
  return normalized;
}

function buildAad({ provider, publicId }) {
  return Buffer.from(`setly:integration-connection:${provider}:${publicId}`, 'utf8');
}

function encryptSecretBundle(value, identity) {
  const secrets = normalizeSecretBundle(value);
  return encryptSecretEnvelope(JSON.stringify(secrets), {
    aad: buildAad(identity),
    key: getMasterKey(),
    keyVersion: String(process.env.INTEGRATION_SECRETS_KEY_VERSION || 'v1'),
  });
}

function decryptSecretBundle(serialized, identity) {
  try {
    const plaintext = decryptSecretEnvelope(serialized, {
      aad: buildAad(identity),
      resolveKey: () => getMasterKey(),
    }).toString('utf8');
    return Object.freeze(normalizeSecretBundle(JSON.parse(plaintext)));
  } catch (error) {
    if (error?.code?.startsWith?.('INTEGRATION_SECRET_')) throw error;
    throw integrationSecretError('INTEGRATION_SECRET_DECRYPTION_FAILED');
  }
}

module.exports = {
  assertIntegrationSecretConfiguration,
  decryptSecretBundle,
  encryptSecretBundle,
  getIntegrationFingerprintKey,
  integrationSecretError,
  normalizeSecretBundle,
};
