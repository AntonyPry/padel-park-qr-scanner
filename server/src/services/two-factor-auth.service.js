'use strict';

const crypto = require('node:crypto');
const db = require('../../models');
const {
  AUTH_DATA_PURPOSES,
  authDataEnvelopeKeyVersion,
  decryptAuthData,
  encryptAuthData,
} = require('../security/auth-data-envelope');
const totp = require('../security/totp');
const normalUserSessions = require('./normal-user-session.service');
const operatorAuth = require('./installation-operator-auth.service');
const operatorDirectory = require('./installation-operator-directory.service');

const CHALLENGE_BYTES = 32;
const CHALLENGE_PREFIX = 'setly_2fc1_';
const CHALLENGE_PATTERN = /^setly_2fc1_[A-Za-z0-9_-]{43}$/u;
const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const ENROLLMENT_TTL_MS = 15 * 60 * 1000;
const RECENT_CONFIRMATION_MS = 10 * 60 * 1000;

function publicError(code, statusCode, message) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function unavailableError() {
  return publicError(
    'TWO_FACTOR_UNAVAILABLE',
    503,
    'Двухфакторная аутентификация временно недоступна',
  );
}

function verificationError() {
  return publicError(
    'TWO_FACTOR_VERIFICATION_FAILED',
    401,
    'Не удалось подтвердить вход',
  );
}

function recentConfirmationError() {
  return publicError(
    'TWO_FACTOR_RECENT_CONFIRMATION_REQUIRED',
    403,
    'Сначала подтвердите вход с помощью двухфакторной аутентификации',
  );
}

function digestChallenge(token) {
  return crypto.createHash('sha256').update(String(token), 'utf8').digest('hex');
}

function createChallengeToken() {
  return `${CHALLENGE_PREFIX}${crypto.randomBytes(CHALLENGE_BYTES).toString('base64url')}`;
}

function accountIdentity(accountId) {
  return {
    accountId: Number(accountId),
    purpose: AUTH_DATA_PURPOSES.ACCOUNT_TWO_FACTOR,
  };
}

function operatorIdentity(operatorId) {
  return {
    operatorId: String(operatorId || ''),
    purpose: AUTH_DATA_PURPOSES.INSTALLATION_OPERATOR_TWO_FACTOR,
  };
}

function asCounter(value) {
  if (value === null || value === undefined) return null;
  try {
    return BigInt(value);
  } catch {
    throw unavailableError();
  }
}

function factorModel(subjectKind) {
  return subjectKind === 'account'
    ? db.AccountTwoFactor
    : db.InstallationOperatorTwoFactor;
}

function factorIdentity(subjectKind, subjectId) {
  return subjectKind === 'account'
    ? accountIdentity(subjectId)
    : operatorIdentity(subjectId);
}

function factorWhere(subjectKind, subjectId) {
  return subjectKind === 'account'
    ? { accountId: Number(subjectId) }
    : { operatorId: String(subjectId || '') };
}

function codeOwnerFields(subjectKind, factorId) {
  return subjectKind === 'account'
    ? { accountTwoFactorId: factorId, installationOperatorTwoFactorId: null }
    : { accountTwoFactorId: null, installationOperatorTwoFactorId: factorId };
}

async function activeFactor(subjectKind, subjectId, options = {}) {
  return factorModel(subjectKind).unscoped().findOne({
    lock: options.lock,
    transaction: options.transaction,
    where: { ...factorWhere(subjectKind, subjectId), status: 'active' },
  });
}

async function isFactorActive(subjectKind, subjectId) {
  return Boolean(await activeFactor(subjectKind, subjectId));
}

async function issueChallenge(subjectKind, subject, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  const token = createChallengeToken();
  const expiresAt = new Date(now.getTime() + CHALLENGE_TTL_MS);
  const values = {
    accountId: null,
    consumedAt: null,
    expiresAt,
    operatorAuthMode: null,
    operatorCredentialVersion: null,
    operatorId: null,
    purpose: 'login',
    subjectKind,
    tokenDigest: digestChallenge(token),
  };
  if (subjectKind === 'account') {
    values.accountId = Number(subject.accountId);
  } else {
    values.operatorAuthMode = subject.authMode;
    values.operatorCredentialVersion = subject.credentialVersion;
    values.operatorId = subject.operatorId;
  }
  await db.AuthLoginChallenge.create(values, { transaction: options.transaction });
  return {
    challengeExpiresAt: expiresAt.toISOString(),
    challengeToken: token,
    requiresTwoFactor: true,
  };
}

async function issueAccountLoginChallenge(accountId, options = {}) {
  if (!(await activeFactor('account', accountId, options))) throw unavailableError();
  return issueChallenge('account', { accountId }, options);
}

async function issueOperatorLoginChallenge(identity, options = {}) {
  if (!identity?.operatorId || identity.authMode !== 'static-directory') {
    throw unavailableError();
  }
  if (!(await activeFactor('installation_operator', identity.operatorId, options))) {
    throw unavailableError();
  }
  return issueChallenge('installation_operator', identity, options);
}

async function verifyFactorLocked({
  code,
  factor,
  identity,
  now = new Date(),
  subjectKind,
  transaction,
}) {
  const secret = decryptAuthData(factor.secretCiphertext, identity);
  const matchedCounter = totp.verifyTotp(secret, code, { now });
  if (matchedCounter !== null) {
    const previous = asCounter(factor.lastUsedCounter);
    if (previous !== null && BigInt(matchedCounter) <= previous) throw verificationError();
    await factor.update({ lastUsedCounter: matchedCounter }, { transaction });
    return Object.freeze({ method: 'authenticator', verifiedAt: now });
  }

  const codeDigest = totp.digestRecoveryCode(code);
  if (!codeDigest) throw verificationError();
  const recoveryCode = await db.TwoFactorRecoveryCode.unscoped().findOne({
    lock: transaction.LOCK.UPDATE,
    transaction,
    where: {
      ...codeOwnerFields(subjectKind, factor.id),
      codeDigest,
      consumedAt: null,
      generation: factor.recoveryGeneration,
      revokedAt: null,
    },
  });
  if (!recoveryCode) throw verificationError();
  await recoveryCode.update({ consumedAt: now }, { transaction });
  return Object.freeze({ method: 'recovery_code', verifiedAt: now });
}

async function verifyActiveFactor(subjectKind, subjectId, code, options = {}) {
  const run = async (transaction) => {
    const factor = await activeFactor(subjectKind, subjectId, {
      lock: transaction.LOCK.UPDATE,
      transaction,
    });
    if (!factor) throw verificationError();
    return verifyFactorLocked({
      code,
      factor,
      identity: factorIdentity(subjectKind, subjectId),
      now: options.now instanceof Date ? options.now : new Date(options.now || Date.now()),
      subjectKind,
      transaction,
    });
  };
  if (options.transaction) return run(options.transaction);
  return db.sequelize.transaction(run);
}

async function consumeChallenge(token, expectedKind, code, options = {}) {
  if (!CHALLENGE_PATTERN.test(String(token || ''))) throw verificationError();
  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  return db.sequelize.transaction(async (transaction) => {
    const challenge = await db.AuthLoginChallenge.unscoped().findOne({
      lock: transaction.LOCK.UPDATE,
      transaction,
      where: { tokenDigest: digestChallenge(token) },
    });
    if (
      !challenge ||
      challenge.subjectKind !== expectedKind ||
      challenge.consumedAt ||
      new Date(challenge.expiresAt).getTime() <= now.getTime()
    ) {
      throw verificationError();
    }
    const subjectId = expectedKind === 'account'
      ? challenge.accountId
      : challenge.operatorId;
    const factor = await activeFactor(expectedKind, subjectId, {
      lock: transaction.LOCK.UPDATE,
      transaction,
    });
    if (!factor) throw verificationError();
    await verifyFactorLocked({
      code,
      factor,
      identity: factorIdentity(expectedKind, subjectId),
      now,
      subjectKind: expectedKind,
      transaction,
    });

    let result;
    if (expectedKind === 'account') {
      result = await normalUserSessions.issue(challenge.accountId, {
        now,
        transaction,
        twoFactorVerifiedAt: now,
      });
    } else {
      const currentIdentity = operatorDirectory.revalidateIdentity({
        authMode: challenge.operatorAuthMode,
        credentialVersion: challenge.operatorCredentialVersion,
        operatorId: challenge.operatorId,
      });
      if (!currentIdentity) throw verificationError();
      result = await operatorAuth.issueSession(currentIdentity, {
        now,
        transaction,
        twoFactorVerifiedAt: now,
      });
    }
    await challenge.update({ consumedAt: now }, { transaction });
    return result;
  });
}

async function completeAccountLogin(challengeToken, code, options = {}) {
  return consumeChallenge(challengeToken, 'account', code, options);
}

async function completeOperatorLogin(challengeToken, code, options = {}) {
  return consumeChallenge(challengeToken, 'installation_operator', code, options);
}

function isRecent(value, now = new Date()) {
  const verifiedAt = value ? new Date(value) : null;
  return Boolean(
    verifiedAt &&
      Number.isFinite(verifiedAt.getTime()) &&
      verifiedAt.getTime() >= now.getTime() - RECENT_CONFIRMATION_MS &&
      verifiedAt.getTime() <= now.getTime() + 30_000
  );
}

async function assertRecentAccountConfirmation(authentication, options = {}) {
  if (authentication?.kind !== 'opaque' || !authentication.sessionId) {
    throw recentConfirmationError();
  }
  const session = await db.NormalUserSession.findByPk(authentication.sessionId, {
    transaction: options.transaction,
  });
  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  if (
    !session ||
    session.accountId !== Number(authentication.accountId) ||
    session.revokedAt ||
    !isRecent(session.twoFactorVerifiedAt, now)
  ) {
    throw recentConfirmationError();
  }
  return session;
}

async function assertRecentOperatorConfirmation(operator, options = {}) {
  const authority = options.transaction
    ? await operatorAuth.lockSessionAuthority(operator, options.transaction)
    : await operatorAuth.revalidateSessionAuthority(operator);
  const session = await db.InstallationOperatorSession.findOne({
    transaction: options.transaction,
    where: { sessionId: authority.sessionId },
  });
  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  if (!session || !isRecent(session.twoFactorVerifiedAt, now)) {
    throw recentConfirmationError();
  }
  return authority;
}

async function beginEnrollment(subjectKind, subjectId, accountName, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  const canonicalStartedAt = new Date(Math.floor(now.getTime() / 1000) * 1000);
  const identity = factorIdentity(subjectKind, subjectId);
  let secret;
  let startedAt = canonicalStartedAt;
  await db.sequelize.transaction(async (transaction) => {
    let factor = await factorModel(subjectKind).unscoped().findOne({
      lock: transaction.LOCK.UPDATE,
      transaction,
      where: factorWhere(subjectKind, subjectId),
    });
    if (factor?.status === 'active') {
      if (subjectKind === 'account') {
        await assertRecentAccountConfirmation(options.authentication, {
          now,
          transaction,
        });
      } else {
        throw publicError(
          'INSTALLATION_OPERATOR_SELF_RECOVERY_FORBIDDEN',
          403,
          'Замена двухфакторной аутентификации оператора через кабинет недоступна',
        );
      }
    }
    const pendingStartedAt = factor?.pendingStartedAt
      ? new Date(factor.pendingStartedAt)
      : null;
    if (
      factor?.pendingSecretCiphertext &&
      pendingStartedAt &&
      Number.isFinite(pendingStartedAt.getTime()) &&
      pendingStartedAt.getTime() >= now.getTime() - ENROLLMENT_TTL_MS &&
      pendingStartedAt.getTime() <= now.getTime() + 30_000
    ) {
      try {
        secret = decryptAuthData(factor.pendingSecretCiphertext, identity);
      } catch {
        throw unavailableError();
      }
      if (!totp.SECRET_PATTERN.test(String(secret || ''))) {
        throw unavailableError();
      }
      startedAt = canonicalStartedAt;
      await factor.update(
        { pendingStartedAt: canonicalStartedAt },
        { transaction },
      );
      return;
    }
    secret = totp.generateSecret();
    let ciphertext;
    try {
      ciphertext = encryptAuthData(secret, identity);
    } catch {
      throw unavailableError();
    }
    const keyVersion = authDataEnvelopeKeyVersion(ciphertext);
    const values = {
      disabledAt: null,
      pendingKeyVersion: keyVersion,
      pendingSecretCiphertext: ciphertext,
      pendingStartedAt: canonicalStartedAt,
    };
    if (factor && factor.status !== 'active') values.status = 'pending';
    if (!factor) {
      factor = await factorModel(subjectKind).create(
        {
          ...factorWhere(subjectKind, subjectId),
          ...values,
          status: 'pending',
        },
        { transaction },
      );
    } else {
      await factor.update(values, { transaction });
    }
  });
  return {
    expiresAt: new Date(startedAt.getTime() + ENROLLMENT_TTL_MS).toISOString(),
    manualKey: secret,
    otpAuthUri: totp.buildOtpAuthUri({ accountName, secret }),
  };
}

async function beginAccountEnrollment(account, authentication, options = {}) {
  return beginEnrollment('account', account.id, account.email, {
    ...options,
    authentication,
  });
}

async function beginOperatorEnrollment(operator, options = {}) {
  const identity = operatorDirectory.revalidateIdentity(operator);
  if (!identity?.operatorId || identity.authMode !== 'static-directory') {
    throw unavailableError();
  }
  return beginEnrollment(
    'installation_operator',
    identity.operatorId,
    identity.username,
    { ...options, operator },
  );
}

async function confirmEnrollment(subjectKind, subjectId, code, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  const recoveryCodes = totp.generateRecoveryCodes();
  await db.sequelize.transaction(async (transaction) => {
    const factor = await factorModel(subjectKind).unscoped().findOne({
      lock: transaction.LOCK.UPDATE,
      transaction,
      where: factorWhere(subjectKind, subjectId),
    });
    if (
      !factor?.pendingSecretCiphertext ||
      !factor.pendingStartedAt ||
      new Date(factor.pendingStartedAt).getTime() < now.getTime() - ENROLLMENT_TTL_MS
    ) {
      throw verificationError();
    }
    const secret = decryptAuthData(
      factor.pendingSecretCiphertext,
      factorIdentity(subjectKind, subjectId),
    );
    const matchedCounter = totp.verifyTotp(secret, code, { now });
    if (matchedCounter === null) throw verificationError();
    const nextGeneration = Number(factor.recoveryGeneration || 0) + 1;
    await db.TwoFactorRecoveryCode.update(
      { revokedAt: now },
      {
        transaction,
        where: {
          ...codeOwnerFields(subjectKind, factor.id),
          consumedAt: null,
          revokedAt: null,
        },
      },
    );
    await db.TwoFactorRecoveryCode.bulkCreate(
      recoveryCodes.map((rawCode) => ({
        ...codeOwnerFields(subjectKind, factor.id),
        codeDigest: totp.digestRecoveryCode(rawCode),
        generation: nextGeneration,
      })),
      { transaction },
    );
    await factor.update(
      {
        disabledAt: null,
        enrolledAt: now,
        factorVersion: factor.enrolledAt
          ? Number(factor.factorVersion) + 1
          : Number(factor.factorVersion),
        keyVersion: factor.pendingKeyVersion,
        lastUsedCounter: matchedCounter,
        pendingKeyVersion: null,
        pendingSecretCiphertext: null,
        pendingStartedAt: null,
        recoveryGeneration: nextGeneration,
        secretCiphertext: factor.pendingSecretCiphertext,
        status: 'active',
      },
      { transaction },
    );
    if (subjectKind === 'account') {
      const preserveSessionId = String(options.authentication?.sessionId || '');
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(preserveSessionId)) {
        throw verificationError();
      }
      await normalUserSessions.revokeAllForAccount(
        subjectId,
        normalUserSessions.REVOCATION_REASONS.SECURITY_CONTEXT_CHANGED,
        { now, preserveSessionId, transaction },
      );
      const confirmedAt = await normalUserSessions.confirmTwoFactor(
        preserveSessionId,
        { accountId: subjectId, now, transaction },
      );
      if (!confirmedAt) throw verificationError();
    } else {
      await db.InstallationOperatorSession.update(
        { revokedAt: now },
        { transaction, where: { operatorId: subjectId, revokedAt: null } },
      );
    }
  });
  return { recoveryCodes };
}

async function confirmAccountEnrollment(accountId, code, options = {}) {
  return confirmEnrollment('account', accountId, code, options);
}

async function confirmOperatorEnrollment(operator, code, options = {}) {
  const identity = operatorDirectory.revalidateIdentity(operator);
  if (!identity?.operatorId || identity.authMode !== 'static-directory') {
    throw unavailableError();
  }
  return confirmEnrollment(
    'installation_operator',
    identity.operatorId,
    code,
    options,
  );
}

async function regenerateRecoveryCodes(subjectKind, subjectId, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  const recoveryCodes = totp.generateRecoveryCodes();
  await db.sequelize.transaction(async (transaction) => {
    if (subjectKind === 'account') {
      await assertRecentAccountConfirmation(options.authentication, { now, transaction });
    } else {
      await assertRecentOperatorConfirmation(options.operator, { now, transaction });
    }
    const factor = await activeFactor(subjectKind, subjectId, {
      lock: transaction.LOCK.UPDATE,
      transaction,
    });
    if (!factor) throw recentConfirmationError();
    const generation = Number(factor.recoveryGeneration) + 1;
    await db.TwoFactorRecoveryCode.update(
      { revokedAt: now },
      {
        transaction,
        where: {
          ...codeOwnerFields(subjectKind, factor.id),
          consumedAt: null,
          revokedAt: null,
        },
      },
    );
    await db.TwoFactorRecoveryCode.bulkCreate(
      recoveryCodes.map((rawCode) => ({
        ...codeOwnerFields(subjectKind, factor.id),
        codeDigest: totp.digestRecoveryCode(rawCode),
        generation,
      })),
      { transaction },
    );
    await factor.update({ recoveryGeneration: generation }, { transaction });
    if (subjectKind === 'account') {
      const preserveSessionId = String(options.authentication?.sessionId || '');
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(preserveSessionId)) {
        throw verificationError();
      }
      await normalUserSessions.revokeAllForAccount(
        subjectId,
        normalUserSessions.REVOCATION_REASONS.SECURITY_CONTEXT_CHANGED,
        { now, preserveSessionId, transaction },
      );
      const confirmedAt = await normalUserSessions.confirmTwoFactor(
        preserveSessionId,
        { accountId: subjectId, now, transaction },
      );
      if (!confirmedAt) throw verificationError();
    } else {
      await db.InstallationOperatorSession.update(
        { revokedAt: now },
        { transaction, where: { operatorId: subjectId, revokedAt: null } },
      );
    }
  });
  return { recoveryCodes };
}

async function regenerateAccountRecoveryCodes(accountId, authentication, options = {}) {
  return regenerateRecoveryCodes('account', accountId, {
    ...options,
    authentication,
  });
}

async function regenerateOperatorRecoveryCodes(operator, options = {}) {
  if (!operator?.operatorId || operator.authMode !== 'static-directory') {
    throw unavailableError();
  }
  return regenerateRecoveryCodes(
    'installation_operator',
    operator.operatorId,
    { ...options, operator },
  );
}

async function resetAccountFactor(accountId, options = {}) {
  if (!options.transaction) {
    throw new TypeError('Two-factor recovery reset requires a transaction');
  }
  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  const factor = await db.AccountTwoFactor.unscoped().findOne({
    lock: options.transaction.LOCK.UPDATE,
    transaction: options.transaction,
    where: { accountId: Number(accountId) },
  });
  if (factor) {
    await db.TwoFactorRecoveryCode.update(
      { revokedAt: now },
      {
        transaction: options.transaction,
        where: {
          accountTwoFactorId: factor.id,
          consumedAt: null,
          revokedAt: null,
        },
      },
    );
    await factor.update(
      {
        disabledAt: now,
        keyVersion: null,
        lastUsedCounter: null,
        pendingKeyVersion: null,
        pendingSecretCiphertext: null,
        pendingStartedAt: null,
        secretCiphertext: null,
        status: 'disabled',
      },
      { transaction: options.transaction },
    );
  }
  await normalUserSessions.revokeAllForAccount(
    accountId,
    normalUserSessions.REVOCATION_REASONS.SECURITY_CONTEXT_CHANGED,
    { now, transaction: options.transaction },
  );
  return Boolean(factor);
}

async function disableAccountFactor(accountId, authentication, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  await db.sequelize.transaction(async (transaction) => {
    await assertRecentAccountConfirmation(authentication, { now, transaction });
    const factor = await activeFactor('account', accountId, {
      lock: transaction.LOCK.UPDATE,
      transaction,
    });
    if (!factor) throw recentConfirmationError();
    await resetAccountFactor(accountId, { now, transaction });
  });
  return { signedOut: true, success: true };
}

async function status(subjectKind, subjectId) {
  const factor = await factorModel(subjectKind).findOne({
    where: factorWhere(subjectKind, subjectId),
  });
  if (!factor) {
    return {
      active: false,
      enrollmentPending: false,
      recoveryCodesRemaining: 0,
    };
  }
  const recoveryCodesRemaining = factor.status === 'active'
    ? await db.TwoFactorRecoveryCode.count({
      where: {
        ...codeOwnerFields(subjectKind, factor.id),
        consumedAt: null,
        generation: factor.recoveryGeneration,
        revokedAt: null,
      },
    })
    : 0;
  return {
    active: factor.status === 'active',
    enrollmentPending: Boolean(factor.pendingStartedAt),
    enrolledAt: factor.enrolledAt,
    recoveryCodesRemaining,
  };
}

async function accountStatus(accountId) {
  return status('account', accountId);
}

async function operatorStatus(operator) {
  if (operator.authMode !== 'static-directory' || !operator.operatorId) {
    return {
      active: false,
      available: false,
      enrollmentPending: false,
      recoveryCodesRemaining: 0,
    };
  }
  return { ...(await status('installation_operator', operator.operatorId)), available: true };
}

async function stepUpAccount(accountId, authentication, code, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  await verifyActiveFactor('account', accountId, code, { now });
  const confirmedAt = await normalUserSessions.confirmTwoFactor(
    authentication?.sessionId,
    { accountId, now },
  );
  if (!confirmedAt) throw verificationError();
  return { confirmedAt: confirmedAt.toISOString() };
}

async function stepUpOperator(operator, code, options = {}) {
  const identity = operatorDirectory.revalidateIdentity(operator);
  if (!identity?.operatorId) throw verificationError();
  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  await verifyActiveFactor('installation_operator', identity.operatorId, code, { now });
  const [updated] = await db.InstallationOperatorSession.update(
    { twoFactorVerifiedAt: now },
    { where: { sessionId: operator.sessionId, revokedAt: null } },
  );
  if (updated === 1) return { confirmedAt: now.toISOString() };
  const unchanged = await db.InstallationOperatorSession.findOne({
    where: { sessionId: operator.sessionId, revokedAt: null },
  });
  const existing = unchanged?.twoFactorVerifiedAt
    ? new Date(unchanged.twoFactorVerifiedAt)
    : null;
  if (!existing || Math.abs(existing.getTime() - now.getTime()) > 1_000) {
    throw verificationError();
  }
  return { confirmedAt: existing.toISOString() };
}

module.exports = {
  RECENT_CONFIRMATION_MS,
  accountStatus,
  assertRecentAccountConfirmation,
  assertRecentOperatorConfirmation,
  beginAccountEnrollment,
  beginOperatorEnrollment,
  completeAccountLogin,
  completeOperatorLogin,
  confirmAccountEnrollment,
  confirmOperatorEnrollment,
  disableAccountFactor,
  isFactorActive,
  issueAccountLoginChallenge,
  issueOperatorLoginChallenge,
  operatorStatus,
  regenerateAccountRecoveryCodes,
  regenerateOperatorRecoveryCodes,
  resetAccountFactor,
  stepUpAccount,
  stepUpOperator,
  verifyActiveFactor,
  _private: {
    CHALLENGE_PATTERN,
    CHALLENGE_TTL_MS,
    ENROLLMENT_TTL_MS,
    accountIdentity,
    codeOwnerFields,
    digestChallenge,
    factorIdentity,
    isRecent,
    operatorIdentity,
    verificationError,
  },
};
