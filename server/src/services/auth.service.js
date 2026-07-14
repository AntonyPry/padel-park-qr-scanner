const crypto = require('crypto');
const db = require('../../models');
const accountLifecycle = require('./account-lifecycle.service');
const accountMetadata = require('./account-metadata.service');
const {
  assertTenantFoundationOperational,
} = require('./tenant-foundation.service');
const {
  TENANT_FOUNDATION_STATES,
} = require('../tenant-foundation/constants');

const TOKEN_TTL_SECONDS = 60 * 60 * 12;
const PASSWORD_ITERATIONS = 120000;
const PASSWORD_KEY_LENGTH = 32;
const PASSWORD_DIGEST = 'sha256';

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

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('base64url');
  const hash = crypto
    .pbkdf2Sync(
      password,
      salt,
      PASSWORD_ITERATIONS,
      PASSWORD_KEY_LENGTH,
      PASSWORD_DIGEST,
    )
    .toString('base64url');

  return `pbkdf2$${PASSWORD_ITERATIONS}$${salt}$${hash}`;
}

function verifyPassword(password, storedHash) {
  const [scheme, iterationsRaw, salt, expectedHash] = String(storedHash).split(
    '$',
  );

  if (scheme !== 'pbkdf2' || !iterationsRaw || !salt || !expectedHash) {
    return false;
  }

  const actualHash = crypto
    .pbkdf2Sync(
      password,
      salt,
      Number(iterationsRaw),
      PASSWORD_KEY_LENGTH,
      PASSWORD_DIGEST,
    )
    .toString('base64url');

  const actualBuffer = Buffer.from(actualHash);
  const expectedBuffer = Buffer.from(expectedHash);

  if (actualBuffer.length !== expectedBuffer.length) return false;

  return crypto.timingSafeEqual(actualBuffer, expectedBuffer);
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
    setupRequired: bootstrapPending,
    tenantFoundationState: classification.state,
  };
}

async function bootstrapOwner({ name, phone, email, password }, options = {}) {
  const accountId = await accountLifecycle.bootstrapInitialOwner(
    {
      account: {
        email: String(email).trim().toLowerCase(),
        passwordHash: hashPassword(password),
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

  if (
    !account ||
    account.status !== 'active' ||
    (account.Staff && account.Staff.status !== 'active') ||
    !verifyPassword(password, account.passwordHash)
  ) {
    const error = new Error('Неверный email или пароль');
    error.statusCode = 401;
    throw error;
  }

  await accountMetadata.updateAccountMetadata(account.id, {
    lastLoginAt: new Date(),
  });
  return createSession(account.id);
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
  sanitizeAccount,
  verifyToken,
};
