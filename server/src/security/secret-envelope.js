'use strict';

const crypto = require('node:crypto');

const ALGORITHM = 'aes-256-gcm';
const ENVELOPE_VERSION = 1;
const VERSIONED_ALGORITHM = 'A256GCM';
const VERSIONED_SCHEMA_VERSION = 1;
const IV_BYTES = 12;
const TAG_BYTES = 16;

function secretEnvelopeError(code = 'SECRET_ENVELOPE_INVALID') {
  const error = new Error('Secret envelope operation failed');
  error.code = code;
  error.statusCode = 503;
  return error;
}

function decodeBase64Key(encoded, errorCode = 'SECRET_KEY_INVALID') {
  const value = String(encoded || '').trim();
  if (!value || value.length > 64 || !/^[A-Za-z0-9+/]+={0,2}$/u.test(value)) {
    throw secretEnvelopeError(errorCode);
  }
  let key;
  try {
    key = Buffer.from(value, 'base64');
  } catch {
    throw secretEnvelopeError(errorCode);
  }
  if (
    key.length !== 32 ||
    key.toString('base64').replace(/=+$/u, '') !== value.replace(/=+$/u, '')
  ) {
    throw secretEnvelopeError(errorCode);
  }
  return key;
}

function decodeBase64UrlKey(encoded, errorCode = 'SECRET_KEY_INVALID') {
  const value = String(encoded || '');
  if (!/^[A-Za-z0-9_-]{43}$/u.test(value)) {
    throw secretEnvelopeError(errorCode);
  }
  let key;
  try {
    key = Buffer.from(value, 'base64url');
  } catch {
    throw secretEnvelopeError(errorCode);
  }
  if (key.length !== 32 || key.toString('base64url') !== value) {
    throw secretEnvelopeError(errorCode);
  }
  return key;
}

function normalizeAad(aad) {
  const value = Buffer.isBuffer(aad) ? aad : Buffer.from(String(aad || ''), 'utf8');
  if (value.length < 1 || value.length > 1024) {
    throw secretEnvelopeError('SECRET_ENVELOPE_AAD_INVALID');
  }
  return value;
}

function normalizeKey(key) {
  const value = Buffer.from(key || []);
  if (value.length !== 32) throw secretEnvelopeError('SECRET_KEY_INVALID');
  return value;
}

function parseEnvelope(serialized, validateKeyVersion = () => true) {
  try {
    const envelope = JSON.parse(String(serialized || ''));
    if (
      !envelope ||
      Array.isArray(envelope) ||
      envelope.version !== ENVELOPE_VERSION ||
      envelope.algorithm !== ALGORITHM ||
      typeof envelope.ciphertext !== 'string' ||
      envelope.ciphertext.length < 1 ||
      envelope.ciphertext.length > 32_768 ||
      typeof envelope.iv !== 'string' ||
      typeof envelope.tag !== 'string' ||
      !validateKeyVersion(envelope.keyVersion)
    ) {
      throw new Error('invalid envelope');
    }
    const iv = Buffer.from(envelope.iv, 'base64');
    const tag = Buffer.from(envelope.tag, 'base64');
    const ciphertext = Buffer.from(envelope.ciphertext, 'base64');
    if (
      iv.length !== IV_BYTES ||
      tag.length !== TAG_BYTES ||
      ciphertext.length < 1 ||
      iv.toString('base64') !== envelope.iv ||
      tag.toString('base64') !== envelope.tag ||
      ciphertext.toString('base64') !== envelope.ciphertext
    ) {
      throw new Error('invalid envelope encoding');
    }
    return Object.freeze({ ...envelope, ciphertext, iv, tag });
  } catch (error) {
    if (error?.code?.startsWith?.('SECRET_')) throw error;
    throw secretEnvelopeError();
  }
}

function encryptSecretEnvelope(plaintext, { aad, key, keyVersion }) {
  const value = Buffer.isBuffer(plaintext)
    ? Buffer.from(plaintext)
    : Buffer.from(String(plaintext || ''), 'utf8');
  if (value.length < 1 || value.length > 16_384) {
    throw secretEnvelopeError('SECRET_ENVELOPE_PAYLOAD_INVALID');
  }
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, normalizeKey(key), iv);
  cipher.setAAD(normalizeAad(aad));
  const ciphertext = Buffer.concat([cipher.update(value), cipher.final()]);
  return JSON.stringify({
    algorithm: ALGORITHM,
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    keyVersion,
    tag: cipher.getAuthTag().toString('base64'),
    version: ENVELOPE_VERSION,
  });
}

function decryptSecretEnvelope(
  serialized,
  { aad, resolveKey, validateKeyVersion = () => true },
) {
  try {
    const envelope = parseEnvelope(serialized, validateKeyVersion);
    const key = normalizeKey(resolveKey(envelope.keyVersion));
    const decipher = crypto.createDecipheriv(ALGORITHM, key, envelope.iv);
    decipher.setAAD(normalizeAad(aad));
    decipher.setAuthTag(envelope.tag);
    return Buffer.concat([
      decipher.update(envelope.ciphertext),
      decipher.final(),
    ]);
  } catch (error) {
    if (error?.code === 'SECRET_ENVELOPE_INVALID') {
      throw secretEnvelopeError('SECRET_ENVELOPE_DECRYPTION_FAILED');
    }
    if (error?.code?.startsWith?.('SECRET_')) throw error;
    throw secretEnvelopeError('SECRET_ENVELOPE_DECRYPTION_FAILED');
  }
}

function envelopeKeyVersion(serialized, validateKeyVersion = () => true) {
  return parseEnvelope(serialized, validateKeyVersion).keyVersion;
}

function parseVersionedEnvelope(serialized, validateKeyVersion = () => true) {
  try {
    const envelope = JSON.parse(String(serialized || ''));
    if (
      !envelope ||
      Array.isArray(envelope) ||
      Object.keys(envelope).sort().join(',') !==
        'algorithm,ciphertext,keyVersion,nonce,schemaVersion,tag' ||
      envelope.schemaVersion !== VERSIONED_SCHEMA_VERSION ||
      envelope.algorithm !== VERSIONED_ALGORITHM ||
      typeof envelope.ciphertext !== 'string' ||
      envelope.ciphertext.length < 1 ||
      envelope.ciphertext.length > 32_768 ||
      typeof envelope.nonce !== 'string' ||
      typeof envelope.tag !== 'string' ||
      !validateKeyVersion(envelope.keyVersion)
    ) {
      throw new Error('invalid versioned envelope');
    }
    const nonce = Buffer.from(envelope.nonce, 'base64url');
    const tag = Buffer.from(envelope.tag, 'base64url');
    const ciphertext = Buffer.from(envelope.ciphertext, 'base64url');
    if (
      nonce.length !== IV_BYTES ||
      tag.length !== TAG_BYTES ||
      ciphertext.length < 1 ||
      nonce.toString('base64url') !== envelope.nonce ||
      tag.toString('base64url') !== envelope.tag ||
      ciphertext.toString('base64url') !== envelope.ciphertext
    ) {
      throw new Error('invalid versioned envelope encoding');
    }
    return Object.freeze({ ...envelope, ciphertext, nonce, tag });
  } catch (error) {
    if (error?.code?.startsWith?.('SECRET_')) throw error;
    throw secretEnvelopeError();
  }
}

function encryptVersionedSecretEnvelope(plaintext, { aad, key, keyVersion }) {
  const value = Buffer.isBuffer(plaintext)
    ? Buffer.from(plaintext)
    : Buffer.from(String(plaintext || ''), 'utf8');
  if (value.length < 1 || value.length > 16_384) {
    throw secretEnvelopeError('SECRET_ENVELOPE_PAYLOAD_INVALID');
  }
  if (!Number.isSafeInteger(keyVersion) || keyVersion <= 0) {
    throw secretEnvelopeError('SECRET_KEY_VERSION_INVALID');
  }
  const nonce = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, normalizeKey(key), nonce);
  cipher.setAAD(normalizeAad(aad));
  const ciphertext = Buffer.concat([cipher.update(value), cipher.final()]);
  return JSON.stringify({
    algorithm: VERSIONED_ALGORITHM,
    ciphertext: ciphertext.toString('base64url'),
    keyVersion,
    nonce: nonce.toString('base64url'),
    schemaVersion: VERSIONED_SCHEMA_VERSION,
    tag: cipher.getAuthTag().toString('base64url'),
  });
}

function decryptVersionedSecretEnvelope(
  serialized,
  { aad, resolveKey, validateKeyVersion = () => true },
) {
  try {
    const envelope = parseVersionedEnvelope(serialized, validateKeyVersion);
    const key = normalizeKey(resolveKey(envelope.keyVersion));
    const decipher = crypto.createDecipheriv(ALGORITHM, key, envelope.nonce);
    decipher.setAAD(normalizeAad(aad));
    decipher.setAuthTag(envelope.tag);
    return Buffer.concat([
      decipher.update(envelope.ciphertext),
      decipher.final(),
    ]);
  } catch (error) {
    if (error?.code === 'SECRET_ENVELOPE_INVALID') {
      throw secretEnvelopeError('SECRET_ENVELOPE_DECRYPTION_FAILED');
    }
    if (error?.code?.startsWith?.('SECRET_')) throw error;
    throw secretEnvelopeError('SECRET_ENVELOPE_DECRYPTION_FAILED');
  }
}

function versionedEnvelopeKeyVersion(serialized, validateKeyVersion = () => true) {
  return parseVersionedEnvelope(serialized, validateKeyVersion).keyVersion;
}

module.exports = {
  ALGORITHM,
  ENVELOPE_VERSION,
  VERSIONED_ALGORITHM,
  VERSIONED_SCHEMA_VERSION,
  decodeBase64Key,
  decodeBase64UrlKey,
  decryptSecretEnvelope,
  decryptVersionedSecretEnvelope,
  encryptSecretEnvelope,
  encryptVersionedSecretEnvelope,
  envelopeKeyVersion,
  secretEnvelopeError,
  versionedEnvelopeKeyVersion,
};
