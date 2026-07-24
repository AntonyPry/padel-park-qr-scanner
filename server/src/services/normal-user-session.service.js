'use strict';

const crypto = require('crypto');
const db = require('../../models');

const SESSION_TTL_SECONDS = 12 * 60 * 60;
const TOKEN_BYTES = 32;
const TOKEN_PREFIX = 'setly_s1_';
const TOKEN_PATTERN = /^setly_s1_[A-Za-z0-9_-]{43}$/u;
const REVOCATION_REASONS = Object.freeze({
  ACCOUNT_DISABLED: 'account_disabled',
  LOGOUT: 'logout',
  PASSWORD_CHANGED: 'password_changed',
  SECURITY_CONTEXT_CHANGED: 'security_context_changed',
  STAFF_DISABLED: 'staff_disabled',
});

function digestToken(token) {
  return crypto.createHash('sha256').update(String(token), 'utf8').digest('hex');
}

function isOpaqueToken(token) {
  return TOKEN_PATTERN.test(String(token));
}

function isAccountActive(account) {
  return Boolean(
    account &&
      account.status === 'active' &&
      (!account.Staff || account.Staff.status === 'active'),
  );
}

function normalizeNow(now) {
  const value = now instanceof Date ? now : new Date(now || Date.now());
  if (!Number.isFinite(value.getTime())) throw new Error('Session clock is invalid');
  return value;
}

function activeSession(session, now) {
  return Boolean(
    session &&
      !session.revokedAt &&
      new Date(session.expiresAt).getTime() > normalizeNow(now).getTime(),
  );
}

function accountInclude() {
  return [{ model: db.Account, include: [{ model: db.Staff }] }];
}

async function issue(accountId, options = {}) {
  const now = normalizeNow(options.now);
  const ttlSeconds = options.ttlSeconds ?? SESSION_TTL_SECONDS;
  if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds <= 0 || ttlSeconds > SESSION_TTL_SECONDS) {
    throw new Error('Normal user session TTL is invalid');
  }

  const create = async (transaction) => {
    const account = await db.Account.findByPk(accountId, {
      include: [{ model: db.Staff }],
      lock: transaction.LOCK.UPDATE,
      transaction,
    });
    if (!isAccountActive(account)) {
      const error = new Error('Unauthorized');
      error.statusCode = 401;
      throw error;
    }

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const token = `${TOKEN_PREFIX}${crypto.randomBytes(TOKEN_BYTES).toString('base64url')}`;
      try {
        const session = await db.NormalUserSession.create(
          {
            accountId: account.id,
            expiresAt: new Date(now.getTime() + ttlSeconds * 1000),
            twoFactorVerifiedAt: options.twoFactorVerifiedAt || null,
            tokenDigest: digestToken(token),
          },
          { transaction },
        );
        return { account, session, token };
      } catch (error) {
        if (error?.name !== 'SequelizeUniqueConstraintError' || attempt === 2) throw error;
      }
    }
    throw new Error('Normal user session issuance failed');
  };

  if (options.transaction) return create(options.transaction);
  return db.sequelize.transaction(create);
}

async function authenticate(token, options = {}) {
  if (!isOpaqueToken(token)) return null;
  const session = await db.NormalUserSession.findOne({
    include: accountInclude(),
    where: { tokenDigest: digestToken(token) },
  });
  if (!activeSession(session, options.now) || !isAccountActive(session.Account)) {
    return null;
  }
  return {
    account: session.Account,
    authentication: Object.freeze({
      accountId: session.accountId,
      expiresAt: new Date(session.expiresAt).getTime(),
      kind: 'opaque',
      sessionId: session.id,
      twoFactorVerifiedAt: session.twoFactorVerifiedAt
        ? new Date(session.twoFactorVerifiedAt).getTime()
        : null,
    }),
  };
}

async function revalidate(authentication, options = {}) {
  if (authentication?.kind !== 'opaque' || !authentication.sessionId) return null;
  const session = await db.NormalUserSession.findByPk(authentication.sessionId, {
    include: accountInclude(),
  });
  if (
    !session ||
    session.accountId !== authentication.accountId ||
    !activeSession(session, options.now) ||
    !isAccountActive(session.Account)
  ) {
    return null;
  }
  return { account: session.Account, authentication };
}

async function confirmTwoFactor(sessionId, options = {}) {
  const now = normalizeNow(options.now);
  const where = { id: sessionId, revokedAt: null };
  if (options.accountId) where.accountId = Number(options.accountId);
  const [updated] = await db.NormalUserSession.update(
    { twoFactorVerifiedAt: now },
    {
      transaction: options.transaction,
      where,
    },
  );
  if (updated === 1) return now;
  const unchanged = await db.NormalUserSession.findOne({
    transaction: options.transaction,
    where,
  });
  const existing = unchanged?.twoFactorVerifiedAt
    ? new Date(unchanged.twoFactorVerifiedAt)
    : null;
  return existing &&
    Math.abs(existing.getTime() - now.getTime()) <= 1_000
    ? existing
    : null;
}

async function revokeByToken(token, reason = REVOCATION_REASONS.LOGOUT, options = {}) {
  if (!isOpaqueToken(token)) return null;
  const transaction = options.transaction;
  const session = await db.NormalUserSession.findOne({
    transaction,
    where: { tokenDigest: digestToken(token) },
  });
  if (!session) return null;
  if (!session.revokedAt) {
    await db.NormalUserSession.update(
      { revokedAt: normalizeNow(options.now), revokedReason: reason },
      { transaction, where: { id: session.id, revokedAt: null } },
    );
  }
  return { accountId: session.accountId, sessionId: session.id };
}

async function revokeAllForAccount(accountId, reason, options = {}) {
  const normalizedAccountId = Number(accountId);
  if (!Number.isSafeInteger(normalizedAccountId) || normalizedAccountId <= 0) {
    throw new Error('Normal user session Account is invalid');
  }
  const where = { accountId: normalizedAccountId, revokedAt: null };
  if (options.preserveSessionId) {
    where.id = { [db.Sequelize.Op.ne]: String(options.preserveSessionId) };
  }
  const [revoked] = await db.NormalUserSession.update(
    { revokedAt: normalizeNow(options.now), revokedReason: reason },
    {
      transaction: options.transaction,
      where,
    },
  );
  return revoked;
}

module.exports = {
  REVOCATION_REASONS,
  authenticate,
  confirmTwoFactor,
  issue,
  isAccountActive,
  isOpaqueToken,
  revalidate,
  revokeAllForAccount,
  revokeByToken,
  _private: {
    SESSION_TTL_SECONDS,
    TOKEN_BYTES,
    TOKEN_PATTERN,
    TOKEN_PREFIX,
    activeSession,
    digestToken,
  },
};
