'use strict';

const crypto = require('node:crypto');
const db = require('../../models');
const { INTEGRATION_PROVIDERS } = require('./constants');
const { decryptSecretBundle, getIntegrationFingerprintKey } = require('./secrets');

const PRIMARY_SECRET_KEY = Object.freeze({
  beeline: 'apiToken',
  evotor: 'webhookSecret',
  telegram: 'botToken',
  vk: 'botToken',
});

function fingerprintError(message) {
  const error = new Error(message);
  error.code = 'INTEGRATION_CREDENTIAL_DUPLICATE';
  error.statusCode = 409;
  return error;
}

function assertProvider(provider) {
  if (!INTEGRATION_PROVIDERS.includes(provider)) {
    const error = new Error('Integration provider is invalid');
    error.code = 'INTEGRATION_CONNECTION_TYPE_INVALID';
    error.statusCode = 400;
    throw error;
  }
}

function fingerprint(kind, provider, value) {
  assertProvider(provider);
  const canonical = String(value || '').trim();
  if (!canonical) return null;
  return crypto
    .createHmac('sha256', getIntegrationFingerprintKey())
    .update(`${kind}\u001f${provider}\u001f${canonical}`)
    .digest('hex');
}

function credentialFingerprint(provider, value) {
  return fingerprint('credential', provider, value);
}

function providerIdentityFingerprint(provider, value) {
  return fingerprint('provider-identity', provider, value);
}

function currentFingerprintKeyVersion() {
  return String(process.env.INTEGRATION_SECRETS_KEY_VERSION || 'v1');
}

function rowCredentialFingerprint(row) {
  if (
    row.credentialFingerprint &&
    row.fingerprintKeyVersion === currentFingerprintKeyVersion()
  ) {
    return row.credentialFingerprint;
  }
  const secrets = decryptSecretBundle(row.secretCiphertext, {
    provider: row.provider,
    publicId: row.publicId,
  });
  return credentialFingerprint(row.provider, secrets[PRIMARY_SECRET_KEY[row.provider]]);
}

async function assertUniqueFingerprints({
  credential,
  excludeConnectionId = null,
  identity = null,
  provider,
  transaction,
}) {
  const candidateCredential = credentialFingerprint(provider, credential);
  const candidateIdentity = providerIdentityFingerprint(provider, identity);
  const rows = await db.IntegrationConnection.unscoped().findAll({
    lock: transaction ? transaction.LOCK.UPDATE : undefined,
    transaction,
    where: { provider },
  });
  for (const row of rows) {
    if (Number(row.id) === Number(excludeConnectionId)) continue;
    if (candidateCredential && rowCredentialFingerprint(row) === candidateCredential) {
      throw fingerprintError('Эти учётные данные уже используются другим подключением');
    }
    if (
      candidateIdentity &&
      row.providerIdentityFingerprint &&
      row.providerIdentityFingerprint === candidateIdentity
    ) {
      throw fingerprintError('Этот аккаунт провайдера уже подключён к другому клубу');
    }
  }
  return Object.freeze({
    credentialFingerprint: candidateCredential,
    fingerprintKeyVersion: currentFingerprintKeyVersion(),
    providerIdentityFingerprint: candidateIdentity,
  });
}

module.exports = {
  PRIMARY_SECRET_KEY,
  assertUniqueFingerprints,
  credentialFingerprint,
  currentFingerprintKeyVersion,
  providerIdentityFingerprint,
  rowCredentialFingerprint,
};
