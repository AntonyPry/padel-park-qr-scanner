'use strict';

const crypto = require('node:crypto');
const { isProviderCredentialKey } = require('./credential-keys');

const ALGORITHM = 'aes-256-gcm';
const ENVELOPE_VERSION = 1;

function integrationSecretError(code = 'INTEGRATION_SECRET_CONFIGURATION_INVALID') {
  const error = new Error('Integration secret configuration is invalid');
  error.code = code;
  error.statusCode = 503;
  return error;
}

function getMasterKey() {
  const encoded = String(process.env.INTEGRATION_SECRETS_MASTER_KEY || '').trim();
  if (!encoded) throw integrationSecretError();

  let key;
  try {
    key = Buffer.from(encoded, 'base64');
  } catch {
    throw integrationSecretError();
  }
  if (key.length !== 32 || key.toString('base64').replace(/=+$/u, '') !== encoded.replace(/=+$/u, '')) {
    throw integrationSecretError();
  }
  return key;
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
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, getMasterKey(), iv);
  cipher.setAAD(buildAad(identity));
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(secrets), 'utf8'),
    cipher.final(),
  ]);
  const envelope = {
    algorithm: ALGORITHM,
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    keyVersion: String(process.env.INTEGRATION_SECRETS_KEY_VERSION || 'v1'),
    tag: cipher.getAuthTag().toString('base64'),
    version: ENVELOPE_VERSION,
  };
  return JSON.stringify(envelope);
}

function decryptSecretBundle(serialized, identity) {
  try {
    const envelope = JSON.parse(String(serialized || ''));
    if (
      envelope.version !== ENVELOPE_VERSION ||
      envelope.algorithm !== ALGORITHM ||
      typeof envelope.ciphertext !== 'string' ||
      typeof envelope.iv !== 'string' ||
      typeof envelope.tag !== 'string'
    ) {
      throw new Error('invalid envelope');
    }
    const decipher = crypto.createDecipheriv(
      ALGORITHM,
      getMasterKey(),
      Buffer.from(envelope.iv, 'base64'),
    );
    decipher.setAAD(buildAad(identity));
    decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, 'base64')),
      decipher.final(),
    ]).toString('utf8');
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
  integrationSecretError,
  normalizeSecretBundle,
};
