'use strict';

const {
  decodeBase64UrlKey,
  decryptVersionedSecretEnvelope,
  encryptVersionedSecretEnvelope,
  secretEnvelopeError,
  versionedEnvelopeKeyVersion,
} = require('./secret-envelope');

const AUTH_DATA_PURPOSES = Object.freeze({
  ACCOUNT_TWO_FACTOR: 'account_two_factor',
  INSTALLATION_OPERATOR_TWO_FACTOR: 'installation_operator_two_factor',
});
const PURPOSE_SET = new Set(Object.values(AUTH_DATA_PURPOSES));
const MAX_KEY_RING_BYTES = 8 * 1024;
const MAX_KEY_VERSIONS = 16;
const KEY_VERSION_PATTERN = /^[1-9]\d{0,8}$/u;
const OPERATOR_ID_PATTERN = /^op_[A-Za-z0-9_-]{16,64}$/u;

function authDataError(code = 'AUTH_DATA_ENCRYPTION_CONFIGURATION_INVALID') {
  const error = secretEnvelopeError(code);
  error.message = 'Authentication data encryption configuration is invalid';
  return error;
}

function parseKeyVersion(value) {
  if (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value > 0
  ) {
    return value;
  }
  const canonical = String(value ?? '');
  if (!KEY_VERSION_PATTERN.test(canonical)) throw authDataError();
  const parsed = Number(canonical);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw authDataError();
  return parsed;
}

function rejectDuplicateJsonKeys(serialized, parsed) {
  const rawKeys = [...serialized.matchAll(/"([^"\\]*)"\s*:/gu)].map((match) => match[1]);
  const parsedKeys = Object.keys(parsed);
  if (
    rawKeys.length !== parsedKeys.length ||
    new Set(rawKeys).size !== rawKeys.length ||
    rawKeys.some((key) => !parsedKeys.includes(key))
  ) {
    throw authDataError();
  }
}

function authDataEncryptionConfiguration(env = process.env) {
  const serialized = String(env.AUTH_DATA_ENCRYPTION_KEY_RING || '');
  if (!serialized || Buffer.byteLength(serialized, 'utf8') > MAX_KEY_RING_BYTES) {
    throw authDataError();
  }
  let parsed;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    throw authDataError();
  }
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
    throw authDataError();
  }
  rejectDuplicateJsonKeys(serialized, parsed);
  const entries = Object.entries(parsed);
  if (entries.length < 1 || entries.length > MAX_KEY_VERSIONS) {
    throw authDataError();
  }
  const keys = new Map();
  for (const [rawVersion, encodedKey] of entries) {
    const version = parseKeyVersion(rawVersion);
    if (keys.has(version) || typeof encodedKey !== 'string') throw authDataError();
    try {
      keys.set(
        version,
        decodeBase64UrlKey(
          encodedKey,
          'AUTH_DATA_ENCRYPTION_CONFIGURATION_INVALID',
        ),
      );
    } catch {
      throw authDataError();
    }
  }
  const currentVersion = parseKeyVersion(
    env.AUTH_DATA_ENCRYPTION_CURRENT_KEY_VERSION,
  );
  if (!keys.has(currentVersion)) throw authDataError();
  return Object.freeze({ currentVersion, keys });
}

function buildAuthDataAad(identity) {
  const purpose = String(identity?.purpose || '');
  if (!PURPOSE_SET.has(purpose)) {
    throw authDataError('AUTH_DATA_ENCRYPTION_IDENTITY_INVALID');
  }
  let entityIdentity;
  if (purpose === AUTH_DATA_PURPOSES.INSTALLATION_OPERATOR_TWO_FACTOR) {
    const operatorId = String(identity?.operatorId || '');
    if (!OPERATOR_ID_PATTERN.test(operatorId)) {
      throw authDataError('AUTH_DATA_ENCRYPTION_IDENTITY_INVALID');
    }
    entityIdentity = `operator:${operatorId}`;
  } else {
    const accountId = Number(identity?.accountId);
    if (!Number.isSafeInteger(accountId) || accountId <= 0) {
      throw authDataError('AUTH_DATA_ENCRYPTION_IDENTITY_INVALID');
    }
    entityIdentity = `account:${accountId}`;
  }
  return Buffer.from(
    `setly:auth-data-envelope:1:${purpose}:${entityIdentity}`,
    'utf8',
  );
}

function encryptAuthData(plaintext, identity, env = process.env) {
  const configuration = authDataEncryptionConfiguration(env);
  return encryptVersionedSecretEnvelope(plaintext, {
    aad: buildAuthDataAad(identity),
    key: configuration.keys.get(configuration.currentVersion),
    keyVersion: configuration.currentVersion,
  });
}

function decryptAuthData(serialized, identity, env = process.env) {
  const configuration = authDataEncryptionConfiguration(env);
  try {
    return decryptVersionedSecretEnvelope(serialized, {
      aad: buildAuthDataAad(identity),
      resolveKey(version) {
        const key = configuration.keys.get(parseKeyVersion(version));
        if (!key) {
          throw authDataError('AUTH_DATA_ENCRYPTION_KEY_VERSION_UNAVAILABLE');
        }
        return key;
      },
      validateKeyVersion(version) {
        return Number.isSafeInteger(version) && version > 0;
      },
    }).toString('utf8');
  } catch (error) {
    if (error?.code === 'AUTH_DATA_ENCRYPTION_KEY_VERSION_UNAVAILABLE') throw error;
    throw authDataError('AUTH_DATA_ENCRYPTION_DECRYPTION_FAILED');
  }
}

function authDataEnvelopeKeyVersion(serialized) {
  try {
    return parseKeyVersion(
      versionedEnvelopeKeyVersion(
        serialized,
        (value) => Number.isSafeInteger(value) && value > 0,
      ),
    );
  } catch {
    throw authDataError('AUTH_DATA_ENCRYPTION_ENVELOPE_INVALID');
  }
}

function rewrapAuthData(serialized, identity, env = process.env) {
  const configuration = authDataEncryptionConfiguration(env);
  const fromVersion = authDataEnvelopeKeyVersion(serialized);
  if (fromVersion === configuration.currentVersion) {
    decryptAuthData(serialized, identity, env);
    return Object.freeze({
      ciphertext: serialized,
      fromVersion,
      rewrapped: false,
      toVersion: configuration.currentVersion,
    });
  }
  const plaintext = decryptAuthData(serialized, identity, env);
  return Object.freeze({
    ciphertext: encryptAuthData(plaintext, identity, env),
    fromVersion,
    rewrapped: true,
    toVersion: configuration.currentVersion,
  });
}

module.exports = {
  AUTH_DATA_PURPOSES,
  authDataEncryptionConfiguration,
  authDataEnvelopeKeyVersion,
  buildAuthDataAad,
  decryptAuthData,
  encryptAuthData,
  rewrapAuthData,
  _private: {
    KEY_VERSION_PATTERN,
    MAX_KEY_RING_BYTES,
    MAX_KEY_VERSIONS,
    OPERATOR_ID_PATTERN,
    parseKeyVersion,
    rejectDuplicateJsonKeys,
  },
};
