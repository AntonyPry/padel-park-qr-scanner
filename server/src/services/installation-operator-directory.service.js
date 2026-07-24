'use strict';

const passwordAuth = require('./password-hashing.service');
const {
  _private: { OPERATOR_ID_PATTERN },
} = require('../security/auth-data-envelope');

const AUTH_MODES = new Set(['legacy', 'static-directory']);
const DIRECTORY_MAX_BYTES = 64 * 1024;
const DIRECTORY_MAX_ENTRIES = 64;
const USERNAME_PATTERN = /^[a-z0-9][a-z0-9._-]{0,119}$/u;

function directoryError() {
  const error = new Error('Installation operator login is unavailable');
  error.code = 'INSTALLATION_OPERATOR_CONFIGURATION_INVALID';
  error.statusCode = 503;
  return error;
}

function authMode(env = process.env) {
  const mode = String(env.INSTALLATION_OPERATOR_AUTH_MODE || 'legacy');
  if (!AUTH_MODES.has(mode)) throw directoryError();
  return mode;
}

function canonicalUsername(value) {
  const username = String(value || '').trim().toLowerCase();
  if (!USERNAME_PATTERN.test(username)) throw directoryError();
  return username;
}

function inspectArgon2idHash(passwordHash) {
  try {
    const info = passwordAuth.passwordHashInfo(passwordHash, {
      AUTH_ARGON2_ENABLED: 'false',
    });
    if (info?.scheme !== 'argon2id') throw directoryError();
  } catch {
    throw directoryError();
  }
}

function positiveVersion(value) {
  if (!Number.isSafeInteger(value) || value <= 0) throw directoryError();
  return value;
}

function staticDirectory(env = process.env) {
  const raw = String(env.INSTALLATION_OPERATOR_DIRECTORY_JSON || '');
  if (!raw || Buffer.byteLength(raw, 'utf8') > DIRECTORY_MAX_BYTES) {
    throw directoryError();
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw directoryError();
  }
  if (!Array.isArray(parsed) || parsed.length < 1 || parsed.length > DIRECTORY_MAX_ENTRIES) {
    throw directoryError();
  }
  const operatorIds = new Set();
  const usernames = new Set();
  const entries = parsed.map((rawEntry) => {
    if (
      !rawEntry ||
      Array.isArray(rawEntry) ||
      typeof rawEntry !== 'object' ||
      Object.keys(rawEntry).sort().join(',') !==
        'credentialVersion,enabled,operatorId,passwordHash,username'
    ) {
      throw directoryError();
    }
    const operatorId = String(rawEntry.operatorId || '');
    const username = canonicalUsername(rawEntry.username);
    const passwordHash = String(rawEntry.passwordHash || '');
    const credentialVersion = positiveVersion(rawEntry.credentialVersion);
    if (
      !OPERATOR_ID_PATTERN.test(operatorId) ||
      typeof rawEntry.enabled !== 'boolean' ||
      operatorIds.has(operatorId) ||
      usernames.has(username)
    ) {
      throw directoryError();
    }
    inspectArgon2idHash(passwordHash);
    operatorIds.add(operatorId);
    usernames.add(username);
    return Object.freeze({
      credentialVersion,
      enabled: rawEntry.enabled,
      operatorId,
      passwordHash,
      username,
    });
  });
  return Object.freeze(entries);
}

function legacyIdentity(env = process.env) {
  if (Object.prototype.hasOwnProperty.call(env, 'INSTALLATION_OPERATOR_PASSWORD')) {
    throw directoryError();
  }
  const username = canonicalUsername(env.INSTALLATION_OPERATOR_USERNAME);
  const passwordHash = String(env.INSTALLATION_OPERATOR_PASSWORD_HASH || '');
  inspectArgon2idHash(passwordHash);
  return Object.freeze({
    authMode: 'legacy',
    credentialVersion: 1,
    enabled: true,
    operatorId: null,
    passwordHash,
    username,
  });
}

function directoryConfiguration(env = process.env) {
  const mode = authMode(env);
  if (mode === 'legacy') {
    return Object.freeze({ entries: [legacyIdentity(env)], mode });
  }
  return Object.freeze({ entries: staticDirectory(env), mode });
}

async function authenticateCredentials({ password, username }, env = process.env) {
  const configuration = directoryConfiguration(env);
  let canonical;
  try {
    canonical = canonicalUsername(username);
  } catch {
    canonical = '';
  }
  const selected = configuration.entries.find((entry) => entry.username === canonical);
  const comparisonEntry = selected || configuration.entries[0];
  let passwordMatches = false;
  try {
    passwordMatches = await passwordAuth.verifyPassword(
      String(password || ''),
      comparisonEntry.passwordHash,
    );
  } catch {
    passwordMatches = false;
  }
  if (!selected || !selected.enabled || !passwordMatches) return null;
  return Object.freeze({
    authMode: configuration.mode,
    credentialVersion: selected.credentialVersion,
    operatorId: selected.operatorId,
    username: selected.username,
  });
}

function revalidateIdentity(identity, env = process.env) {
  const mode = authMode(env);
  if (mode !== identity?.authMode) return null;
  if (mode === 'legacy') {
    let username;
    try {
      username = canonicalUsername(env.INSTALLATION_OPERATOR_USERNAME);
    } catch {
      return null;
    }
    if (
      identity.operatorId !== null ||
      identity.credentialVersion !== 1 ||
      identity.username !== username
    ) {
      return null;
    }
    return Object.freeze({
      authMode: 'legacy',
      credentialVersion: 1,
      operatorId: null,
      username,
    });
  }
  const configuration = directoryConfiguration(env);
  const current = configuration.entries.find(
    (entry) => entry.operatorId === identity?.operatorId,
  );
  if (
    !current?.enabled ||
    current.credentialVersion !== identity?.credentialVersion
  ) {
    return null;
  }
  return Object.freeze({
    authMode: 'static-directory',
    credentialVersion: current.credentialVersion,
    operatorId: current.operatorId,
    username: current.username,
  });
}

module.exports = {
  authMode,
  authenticateCredentials,
  canonicalUsername,
  directoryConfiguration,
  revalidateIdentity,
  _private: {
    AUTH_MODES,
    DIRECTORY_MAX_BYTES,
    DIRECTORY_MAX_ENTRIES,
    USERNAME_PATTERN,
    directoryError,
    legacyIdentity,
    staticDirectory,
  },
};
