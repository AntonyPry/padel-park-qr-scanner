const crypto = require('crypto');
const db = require('../../models');
const accountLifecycle = require('./account-lifecycle.service');
const accountMetadata = require('./account-metadata.service');
const normalUserSessions = require('./normal-user-session.service');
const passwordHashing = require('./password-hashing.service');
const {
  assertTenantFoundationOperational,
} = require('./tenant-foundation.service');
const {
  TENANT_FOUNDATION_STATES,
} = require('../tenant-foundation/constants');
const { tenantContextCapability } = require('../middleware/tenant-context');
const {
  hashPassword,
  passwordHashInfo,
  validatePasswordHashingConfiguration,
  verifyPassword,
} = passwordHashing;
const {
  hashArgon2idPassword,
  passwordHashingConfiguration,
} = passwordHashing._private;

const LEGACY_TOKEN_MAX_ACCEPT_SECONDS = 12 * 60 * 60;
const LEGACY_TOKEN_MODES = new Set(['accept', 'off']);

function getAuthSecret(env = process.env) {
  const secret = env.AUTH_SECRET || env.JWT_SECRET;

  if (!secret && env.NODE_ENV === 'production') {
    throw new Error('AUTH_SECRET is required in production');
  }

  return secret || 'padel-park-development-auth-secret';
}

function base64url(input) {
  return Buffer.from(input).toString('base64url');
}

function legacyTokenConfiguration(env = process.env, now = new Date()) {
  const mode = String(env.AUTH_LEGACY_TOKEN_MODE || 'off').trim().toLowerCase();
  if (!LEGACY_TOKEN_MODES.has(mode)) {
    throw new Error('AUTH_LEGACY_TOKEN_MODE must be accept or off');
  }
  if (mode === 'off') return Object.freeze({ acceptUntil: null, mode });

  const rawCutoff = String(env.AUTH_LEGACY_TOKEN_ACCEPT_UNTIL || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(rawCutoff)) {
    throw new Error('AUTH_LEGACY_TOKEN_ACCEPT_UNTIL must be an absolute UTC timestamp');
  }
  const acceptUntil = new Date(rawCutoff);
  const clock = now instanceof Date ? now : new Date(now);
  if (!Number.isFinite(acceptUntil.getTime()) || !Number.isFinite(clock.getTime())) {
    throw new Error('Legacy token compatibility clock is invalid');
  }
  if (
    acceptUntil.getTime() >
    clock.getTime() + LEGACY_TOKEN_MAX_ACCEPT_SECONDS * 1000
  ) {
    throw new Error('Legacy token compatibility window cannot exceed 12 hours');
  }
  if (env.NODE_ENV === 'production') getAuthSecret(env);
  return Object.freeze({ acceptUntil, mode });
}

function validateAuthSessionConfiguration(env = process.env, now = new Date()) {
  return legacyTokenConfiguration(env, now);
}

function signLegacyToken(payload, options = {}) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const nowSeconds = Math.floor((options.now || Date.now()) / 1000);
  const body = {
    ...payload,
    exp: options.exp || nowSeconds + LEGACY_TOKEN_MAX_ACCEPT_SECONDS,
  };
  const encodedHeader = base64url(JSON.stringify(header));
  const encodedBody = base64url(JSON.stringify(body));
  const signature = crypto
    .createHmac('sha256', getAuthSecret(options.env))
    .update(`${encodedHeader}.${encodedBody}`)
    .digest('base64url');

  return `${encodedHeader}.${encodedBody}.${signature}`;
}

function verifyToken(token, options = {}) {
  let configuration;
  try {
    configuration = legacyTokenConfiguration(options.env, options.now);
  } catch {
    return null;
  }
  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  if (
    configuration.mode !== 'accept' ||
    configuration.acceptUntil.getTime() <= now.getTime()
  ) {
    return null;
  }

  const segments = String(token).split('.');
  if (segments.length !== 3) return null;
  const [encodedHeader, encodedBody, signature] = segments;
  if (
    !encodedHeader ||
    !encodedBody ||
    !signature ||
    !/^[A-Za-z0-9_-]+$/u.test(encodedHeader) ||
    !/^[A-Za-z0-9_-]+$/u.test(encodedBody) ||
    !/^[A-Za-z0-9_-]+$/u.test(signature)
  ) {
    return null;
  }

  let header;
  let payload;
  try {
    header = JSON.parse(Buffer.from(encodedHeader, 'base64url').toString('utf8'));
    payload = JSON.parse(Buffer.from(encodedBody, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (
    !header ||
    header.alg !== 'HS256' ||
    header.typ !== 'JWT' ||
    !payload ||
    !Number.isSafeInteger(payload.accountId) ||
    payload.accountId <= 0 ||
    !Number.isSafeInteger(payload.exp)
  ) {
    return null;
  }

  const expectedSignature = crypto
    .createHmac('sha256', getAuthSecret(options.env))
    .update(`${encodedHeader}.${encodedBody}`)
    .digest('base64url');

  const signatureBuffer = Buffer.from(signature, 'base64url');
  const expectedSignatureBuffer = Buffer.from(expectedSignature, 'base64url');

  if (signatureBuffer.length !== expectedSignatureBuffer.length) return null;

  if (!crypto.timingSafeEqual(signatureBuffer, expectedSignatureBuffer)) {
    return null;
  }

  if (payload.exp * 1000 <= now.getTime()) return null;

  return payload;
}

function extractBearerToken(input) {
  const header = typeof input === 'string'
    ? input
    : input?.headers?.authorization || '';
  const match = /^Bearer\s+(\S+)\s*$/iu.exec(String(header));
  return match && match[1].length <= 4096 ? match[1] : '';
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
  const { account, token } = await normalUserSessions.issue(accountId);

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

async function authenticateBearerToken(token, options = {}) {
  if (typeof token !== 'string' || token.length > 4096) return null;
  if (normalUserSessions.isOpaqueToken(token)) {
    return normalUserSessions.authenticate(token, options);
  }
  const payload = verifyToken(token, options);
  if (!payload) return null;
  const account = await getAccountById(payload.accountId);
  if (!normalUserSessions.isAccountActive(account)) return null;
  const configuration = legacyTokenConfiguration(options.env, options.now);
  return {
    account,
    authentication: Object.freeze({
      accountId: account.id,
      expiresAt: Math.min(payload.exp * 1000, configuration.acceptUntil.getTime()),
      kind: 'legacy',
    }),
  };
}

async function revalidateAuthentication(authentication, options = {}) {
  if (authentication?.kind === 'opaque') {
    return normalUserSessions.revalidate(authentication, options);
  }
  if (authentication?.kind !== 'legacy') return null;
  let configuration;
  try {
    configuration = legacyTokenConfiguration(options.env, options.now);
  } catch {
    return null;
  }
  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  if (
    configuration.mode !== 'accept' ||
    configuration.acceptUntil.getTime() <= now.getTime() ||
    !Number.isFinite(authentication.expiresAt) ||
    authentication.expiresAt <= now.getTime()
  ) {
    return null;
  }
  const account = await getAccountById(authentication.accountId);
  if (!normalUserSessions.isAccountActive(account)) return null;
  return { account, authentication };
}

async function revokeCurrentSession(token, options = {}) {
  return normalUserSessions.revokeByToken(
    token,
    normalUserSessions.REVOCATION_REASONS.LOGOUT,
    options,
  );
}

module.exports = {
  authenticateBearerToken,
  bootstrapOwner,
  extractBearerToken,
  getSetupStatus,
  getAccountById,
  hashPassword,
  isSetupRequired,
  login,
  passwordHashInfo,
  sanitizeAccount,
  revalidateAuthentication,
  revokeCurrentSession,
  validateAuthSessionConfiguration,
  validatePasswordHashingConfiguration,
  verifyPassword,
  verifyToken,
  _private: {
    ...passwordHashing._private,
    LEGACY_TOKEN_MAX_ACCEPT_SECONDS,
    legacyTokenConfiguration,
    normalUserSessions,
    rehashPasswordAfterSuccessfulLogin,
    signLegacyToken,
  },
};
