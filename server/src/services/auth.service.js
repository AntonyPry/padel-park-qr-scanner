const crypto = require('crypto');
const argon2 = require('argon2');
const { promisify } = require('util');
const db = require('../../models');
const accountLifecycle = require('./account-lifecycle.service');
const accountMetadata = require('./account-metadata.service');
const {
  assertTenantFoundationOperational,
} = require('./tenant-foundation.service');
const {
  TENANT_FOUNDATION_STATES,
} = require('../tenant-foundation/constants');
const { tenantContextCapability } = require('../middleware/tenant-context');

const TOKEN_TTL_SECONDS = 60 * 60 * 12;
const PASSWORD_ITERATIONS = 120000;
const PASSWORD_KEY_LENGTH = 32;
const PASSWORD_DIGEST = 'sha256';
const PASSWORD_HASH_COLUMN_LIMIT = 255;
const PASSWORD_HASH_WRITES_ENV = 'AUTH_ARGON2_ENABLED';
const ARGON2_VERSION = 0x13;
const ARGON2_HASH_LENGTH = 32;
const ARGON2_SALT_LENGTH = 16;
const ARGON2_DEFAULTS = Object.freeze({
  memoryCost: 19456,
  parallelism: 1,
  timeCost: 2,
});
const ARGON2_WRITE_BOUNDS = Object.freeze({
  memoryCost: Object.freeze({ min: 19456, max: 262144 }),
  parallelism: Object.freeze({ min: 1, max: 4 }),
  timeCost: Object.freeze({ min: 2, max: 10 }),
});
const ARGON2_VERIFY_BOUNDS = Object.freeze({
  memoryCost: Object.freeze({ min: 7168, max: 262144 }),
  parallelism: Object.freeze({ min: 1, max: 4 }),
  timeCost: Object.freeze({ min: 1, max: 10 }),
});
const LEGACY_HASH_LENGTH = 7 + String(PASSWORD_ITERATIONS).length + 1 + 22 + 1 + 43;
const MAX_SUPPORTED_ARGON2_HASH_LENGTH = 100;
const pbkdf2 = promisify(crypto.pbkdf2);

function getAuthSecret() {
  const secret = process.env.AUTH_SECRET || process.env.JWT_SECRET;

  if (!secret && process.env.NODE_ENV === 'production') {
    throw new Error('AUTH_SECRET is required in production');
  }

  return secret || 'padel-park-development-auth-secret';
}

function base64url(input) {
  return Buffer.from(input).toString('base64url');
}

function configurationError(message) {
  const error = new Error(message);
  error.code = 'PASSWORD_HASH_CONFIGURATION_INVALID';
  return error;
}

function readBooleanEnv(name, fallback = false, env = process.env) {
  const value = env[name];
  if (value === undefined || value === '') return fallback;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw configurationError(`${name} must be exactly true or false`);
}

function readBoundedInteger(name, fallback, bounds, env = process.env) {
  const raw = env[name];
  if (raw !== undefined && raw !== '' && !/^[1-9]\d*$/u.test(raw)) {
    throw configurationError(
      `${name} must be an integer between ${bounds.min} and ${bounds.max}`,
    );
  }
  const value = raw === undefined || raw === '' ? fallback : Number(raw);
  if (
    !Number.isSafeInteger(value) ||
    value < bounds.min ||
    value > bounds.max
  ) {
    throw configurationError(
      `${name} must be an integer between ${bounds.min} and ${bounds.max}`,
    );
  }
  return value;
}

function passwordHashingConfiguration(env = process.env) {
  const configuration = Object.freeze({
    argon2Enabled: readBooleanEnv(PASSWORD_HASH_WRITES_ENV, false, env),
    memoryCost: readBoundedInteger(
      'AUTH_ARGON2_MEMORY_KIB',
      ARGON2_DEFAULTS.memoryCost,
      ARGON2_WRITE_BOUNDS.memoryCost,
      env,
    ),
    parallelism: readBoundedInteger(
      'AUTH_ARGON2_PARALLELISM',
      ARGON2_DEFAULTS.parallelism,
      ARGON2_WRITE_BOUNDS.parallelism,
      env,
    ),
    timeCost: readBoundedInteger(
      'AUTH_ARGON2_TIME_COST',
      ARGON2_DEFAULTS.timeCost,
      ARGON2_WRITE_BOUNDS.timeCost,
      env,
    ),
  });

  if (
    LEGACY_HASH_LENGTH > PASSWORD_HASH_COLUMN_LIMIT ||
    MAX_SUPPORTED_ARGON2_HASH_LENGTH > PASSWORD_HASH_COLUMN_LIMIT
  ) {
    throw configurationError('Supported password hashes exceed Account.passwordHash capacity');
  }
  return configuration;
}

function validatePasswordHashingConfiguration(env = process.env) {
  return passwordHashingConfiguration(env);
}

function decodeCanonicalBase64Url(value, expectedLength) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null;
  const decoded = Buffer.from(value, 'base64url');
  if (
    decoded.length !== expectedLength ||
    decoded.toString('base64url') !== value
  ) {
    return null;
  }
  return decoded;
}

function decodeCanonicalPhcBase64(value, expectedLength) {
  if (!/^[A-Za-z0-9+/]+$/.test(value)) return null;
  const decoded = Buffer.from(value, 'base64');
  if (
    decoded.length !== expectedLength ||
    decoded.toString('base64').replace(/=+$/u, '') !== value
  ) {
    return null;
  }
  return decoded;
}

function parseLegacyPasswordHash(storedHash) {
  if (typeof storedHash !== 'string' || storedHash.length !== LEGACY_HASH_LENGTH) {
    return null;
  }
  const parts = storedHash.split('$');
  if (
    parts.length !== 4 ||
    parts[0] !== 'pbkdf2' ||
    parts[1] !== String(PASSWORD_ITERATIONS)
  ) {
    return null;
  }
  const decodedSalt = decodeCanonicalBase64Url(parts[2], ARGON2_SALT_LENGTH);
  const expectedHash = decodeCanonicalBase64Url(parts[3], PASSWORD_KEY_LENGTH);
  if (!decodedSalt || !expectedHash) return null;
  return Object.freeze({
    expectedHash,
    iterations: PASSWORD_ITERATIONS,
    // Compatibility invariant: the exact-base implementation passed the
    // canonical base64url text itself to PBKDF2, not the decoded salt bytes.
    salt: parts[2],
    scheme: 'pbkdf2',
  });
}

function withinBounds(value, bounds) {
  return Number.isSafeInteger(value) && value >= bounds.min && value <= bounds.max;
}

function parseArgon2idPasswordHash(storedHash) {
  if (
    typeof storedHash !== 'string' ||
    storedHash.length > MAX_SUPPORTED_ARGON2_HASH_LENGTH
  ) {
    return null;
  }
  const match = /^\$argon2id\$v=(19)\$m=([1-9]\d{0,5}),t=([1-9]\d?),p=([1-9]\d?)\$([A-Za-z0-9+/]{22})\$([A-Za-z0-9+/]{43})$/u.exec(
    storedHash,
  );
  if (!match) return null;
  const version = Number(match[1]);
  const memoryCost = Number(match[2]);
  const timeCost = Number(match[3]);
  const parallelism = Number(match[4]);
  if (
    version !== ARGON2_VERSION ||
    !withinBounds(memoryCost, ARGON2_VERIFY_BOUNDS.memoryCost) ||
    !withinBounds(timeCost, ARGON2_VERIFY_BOUNDS.timeCost) ||
    !withinBounds(parallelism, ARGON2_VERIFY_BOUNDS.parallelism) ||
    !decodeCanonicalPhcBase64(match[5], ARGON2_SALT_LENGTH) ||
    !decodeCanonicalPhcBase64(match[6], ARGON2_HASH_LENGTH)
  ) {
    return null;
  }
  return Object.freeze({
    memoryCost,
    parallelism,
    scheme: 'argon2id',
    timeCost,
    version,
  });
}

function passwordHashInfo(storedHash, env = process.env) {
  const legacy = parseLegacyPasswordHash(storedHash);
  if (legacy) {
    return Object.freeze({ needsRehash: true, scheme: legacy.scheme });
  }
  const encoded = parseArgon2idPasswordHash(storedHash);
  if (!encoded) return null;
  const configured = passwordHashingConfiguration(env);
  return Object.freeze({
    needsRehash:
      encoded.memoryCost !== configured.memoryCost ||
      encoded.timeCost !== configured.timeCost ||
      encoded.parallelism !== configured.parallelism,
    parameters: Object.freeze({
      memoryCost: encoded.memoryCost,
      parallelism: encoded.parallelism,
      timeCost: encoded.timeCost,
      version: encoded.version,
    }),
    scheme: encoded.scheme,
  });
}

function assertPasswordInput(password) {
  if (typeof password !== 'string' && !Buffer.isBuffer(password)) {
    throw new TypeError('Password must be a string or Buffer');
  }
}

async function hashLegacyPassword(password) {
  assertPasswordInput(password);
  const salt = crypto.randomBytes(16).toString('base64url');
  const hash = (
    await pbkdf2(
      password,
      salt,
      PASSWORD_ITERATIONS,
      PASSWORD_KEY_LENGTH,
      PASSWORD_DIGEST,
    )
  ).toString('base64url');

  return `pbkdf2$${PASSWORD_ITERATIONS}$${salt}$${hash}`;
}

async function hashArgon2idPassword(password, env = process.env) {
  assertPasswordInput(password);
  const configured = passwordHashingConfiguration(env);
  const encoded = await argon2.hash(password, {
    hashLength: ARGON2_HASH_LENGTH,
    memoryCost: configured.memoryCost,
    parallelism: configured.parallelism,
    salt: crypto.randomBytes(ARGON2_SALT_LENGTH),
    timeCost: configured.timeCost,
    type: argon2.argon2id,
    version: ARGON2_VERSION,
  });
  const parsed = parseArgon2idPasswordHash(encoded);
  if (!parsed || encoded.length > PASSWORD_HASH_COLUMN_LIMIT) {
    throw configurationError('Argon2id produced an unsupported password hash');
  }
  return encoded;
}

async function hashPassword(password, env = process.env) {
  const configured = passwordHashingConfiguration(env);
  return configured.argon2Enabled
    ? hashArgon2idPassword(password, env)
    : hashLegacyPassword(password);
}

async function verifyPassword(password, storedHash) {
  if (typeof password !== 'string' && !Buffer.isBuffer(password)) return false;
  const legacy = parseLegacyPasswordHash(storedHash);
  if (legacy) {
    const actualHash = await pbkdf2(
      password,
      legacy.salt,
      legacy.iterations,
      PASSWORD_KEY_LENGTH,
      PASSWORD_DIGEST,
    );
    return crypto.timingSafeEqual(actualHash, legacy.expectedHash);
  }
  if (!parseArgon2idPasswordHash(storedHash)) return false;
  try {
    return await argon2.verify(storedHash, password);
  } catch (_error) {
    return false;
  }
}

function signToken(payload) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const body = {
    ...payload,
    exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS,
  };
  const encodedHeader = base64url(JSON.stringify(header));
  const encodedBody = base64url(JSON.stringify(body));
  const signature = crypto
    .createHmac('sha256', getAuthSecret())
    .update(`${encodedHeader}.${encodedBody}`)
    .digest('base64url');

  return `${encodedHeader}.${encodedBody}.${signature}`;
}

function verifyToken(token) {
  const [encodedHeader, encodedBody, signature] = String(token).split('.');
  if (!encodedHeader || !encodedBody || !signature) return null;

  const expectedSignature = crypto
    .createHmac('sha256', getAuthSecret())
    .update(`${encodedHeader}.${encodedBody}`)
    .digest('base64url');

  const signatureBuffer = Buffer.from(signature);
  const expectedSignatureBuffer = Buffer.from(expectedSignature);

  if (signatureBuffer.length !== expectedSignatureBuffer.length) return null;

  if (!crypto.timingSafeEqual(signatureBuffer, expectedSignatureBuffer)) {
    return null;
  }

  const payload = JSON.parse(Buffer.from(encodedBody, 'base64url').toString());
  if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;

  return payload;
}

function sanitizeAccount(account) {
  if (!account) return null;

  const raw = account.toJSON ? account.toJSON() : account;
  delete raw.passwordHash;
  return raw;
}

async function isSetupRequired() {
  return (await getSetupStatus()).setupRequired;
}

async function getSetupStatus() {
  const classification = await assertTenantFoundationOperational();
  const bootstrapPending =
    classification.state === TENANT_FOUNDATION_STATES.BOOTSTRAP_PENDING;
  return {
    bootstrapPending,
    capabilities: tenantContextCapability(),
    setupRequired: bootstrapPending,
    tenantFoundationState: classification.state,
  };
}

async function bootstrapOwner({ name, phone, email, password }, options = {}) {
  const accountId = await accountLifecycle.bootstrapInitialOwner(
    {
      account: {
        email: String(email).trim().toLowerCase(),
        passwordHash: await hashPassword(password),
      },
      staff: {
        name,
        phone: phone || null,
        role: 'Владелец',
        status: 'active',
      },
    },
    options,
  );

  return createSession(accountId);
}

async function login({ email, password }) {
  const account = await db.Account.findOne({
    where: { email: String(email).trim().toLowerCase() },
    include: [{ model: db.Staff }],
  });

  const active =
    account &&
    account.status === 'active' &&
    (!account.Staff || account.Staff.status === 'active');
  const verified = active
    ? await verifyPassword(password, account.passwordHash)
    : false;
  if (!verified) {
    const error = new Error('Неверный email или пароль');
    error.statusCode = 401;
    throw error;
  }

  await accountMetadata.updateAccountMetadata(account.id, {
    lastLoginAt: new Date(),
  });
  const session = await createSession(account.id);
  await rehashPasswordAfterSuccessfulLogin(account, password);
  return session;
}

async function rehashPasswordAfterSuccessfulLogin(account, password) {
  const configured = passwordHashingConfiguration();
  const info = passwordHashInfo(account.passwordHash);
  if (!configured.argon2Enabled || !info?.needsRehash) return false;
  try {
    const nextHash = await hashArgon2idPassword(password);
    return await accountMetadata.compareAndSwapPasswordHash(
      account.id,
      account.passwordHash,
      nextHash,
    );
  } catch (_error) {
    console.warn('Password rehash persistence failed', {
      event: 'auth.password_rehash.persistence_failed',
    });
    return false;
  }
}

async function createSession(accountId) {
  const account = await getAccountById(accountId);
  const token = signToken({
    accountId: account.id,
    role: account.role,
    staffId: account.staffId,
  });

  return {
    token,
    account: sanitizeAccount(account),
    capabilities: tenantContextCapability(),
  };
}

async function getAccountById(id) {
  return db.Account.findByPk(id, {
    include: [{ model: db.Staff }],
  });
}

module.exports = {
  bootstrapOwner,
  getSetupStatus,
  getAccountById,
  hashPassword,
  isSetupRequired,
  login,
  passwordHashInfo,
  sanitizeAccount,
  validatePasswordHashingConfiguration,
  verifyPassword,
  verifyToken,
  _private: {
    ARGON2_DEFAULTS,
    ARGON2_VERIFY_BOUNDS,
    ARGON2_WRITE_BOUNDS,
    LEGACY_HASH_LENGTH,
    MAX_SUPPORTED_ARGON2_HASH_LENGTH,
    PASSWORD_HASH_COLUMN_LIMIT,
    hashArgon2idPassword,
    hashLegacyPassword,
    parseArgon2idPasswordHash,
    parseLegacyPasswordHash,
    passwordHashingConfiguration,
    rehashPasswordAfterSuccessfulLogin,
  },
};
