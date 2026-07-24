'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { test } = require('node:test');
const {
  connect,
  createDisposableDatabase,
  dropDisposableDatabase,
  migrateAll,
  seedTwoTenantFixture,
} = require('../helpers/final-tenant-rc-fixture');

function authenticationFor(accountId, session) {
  return Object.freeze({
    accountId: Number(accountId),
    expiresAt: new Date(session.expiresAt).getTime(),
    kind: 'opaque',
    sessionId: session.id,
    twoFactorVerifiedAt: session.twoFactorVerifiedAt
      ? new Date(session.twoFactorVerifiedAt).getTime()
      : null,
  });
}

test('SEC-A7 two-factor lifecycle is session-bound, replay-safe and actor-scoped', async (t) => {
  assert.ok(process.env.DB_USER, 'DB_USER is required for two-factor DB test');
  const database = process.env.TWO_FACTOR_AUTH_TEST_DB_NAME ||
    `setly_f9_rc_two_factor_${process.pid}_${Date.now()}`;
  const previous = {
    AUTH_DATA_ENCRYPTION_CURRENT_KEY_VERSION:
      process.env.AUTH_DATA_ENCRYPTION_CURRENT_KEY_VERSION,
    AUTH_DATA_ENCRYPTION_KEY_RING:
      process.env.AUTH_DATA_ENCRYPTION_KEY_RING,
    DB_NAME: process.env.DB_NAME,
    INSTALLATION_MANAGEMENT_ENABLED:
      process.env.INSTALLATION_MANAGEMENT_ENABLED,
    INSTALLATION_OPERATOR_AUTH_MODE:
      process.env.INSTALLATION_OPERATOR_AUTH_MODE,
    INSTALLATION_OPERATOR_DIRECTORY_JSON:
      process.env.INSTALLATION_OPERATOR_DIRECTORY_JSON,
    INSTALLATION_OPERATOR_SECRET:
      process.env.INSTALLATION_OPERATOR_SECRET,
  };
  let schema;
  let db;

  process.env.AUTH_DATA_ENCRYPTION_KEY_RING = JSON.stringify({
    1: crypto.randomBytes(32).toString('base64url'),
  });
  process.env.AUTH_DATA_ENCRYPTION_CURRENT_KEY_VERSION = '1';
  process.env.INSTALLATION_MANAGEMENT_ENABLED = 'true';
  process.env.INSTALLATION_OPERATOR_AUTH_MODE = 'static-directory';
  process.env.INSTALLATION_OPERATOR_SECRET =
    crypto.randomBytes(32).toString('base64url');

  await createDisposableDatabase(database);
  process.env.DB_NAME = database;
  try {
    schema = connect(database);
    await migrateAll(schema);
    const fixture = await seedTwoTenantFixture(schema);
    db = require('../../models');
    const authService = require('../../src/services/auth.service');
    const passwordHashing = require('../../src/services/password-hashing.service');
    const accountRecovery = require('../../src/services/account-recovery.service');
    const normalSessions = require('../../src/services/normal-user-session.service');
    const operatorAuth = require('../../src/services/installation-operator-auth.service');
    const totp = require('../../src/security/totp');
    const twoFactor = require('../../src/services/two-factor-auth.service');

    const operatorPasswordHash =
      await passwordHashing._private.hashArgon2idPassword('OperatorTest123!');
    const operatorIdentity = Object.freeze({
      authMode: 'static-directory',
      credentialVersion: 1,
      operatorId: 'op_0123456789abcdef',
      username: 'operator.alpha',
    });
    process.env.INSTALLATION_OPERATOR_DIRECTORY_JSON = JSON.stringify([{
      credentialVersion: operatorIdentity.credentialVersion,
      enabled: true,
      operatorId: operatorIdentity.operatorId,
      passwordHash: operatorPasswordHash,
      username: operatorIdentity.username,
    }]);

    const organizationA = fixture.organizations.A;
    const clubA = fixture.clubs.A[0];
    const organizationB = fixture.organizations.B;
    const clubB = fixture.clubs.B[0];
    const ownerA = fixture.identities.A.owner;
    const managerA = fixture.identities.A.manager;
    const managerB = fixture.identities.B.manager;

    async function enrollAccount(accountId, now = new Date(Date.now() - 60_000)) {
      const current = await normalSessions.issue(accountId, { now });
      const other = await normalSessions.issue(accountId, { now });
      const authentication = authenticationFor(accountId, current.session);
      const enrollment = await twoFactor.beginAccountEnrollment(
        { email: `account-${accountId}@example.test`, id: accountId },
        authentication,
        { now },
      );
      const code = totp.hotp(enrollment.manualKey, totp.counterAt(now));
      const confirmed = await twoFactor.confirmAccountEnrollment(
        accountId,
        code,
        { authentication, now },
      );
      return {
        authentication,
        current,
        enrollment,
        other,
        recoveryCodes: confirmed.recoveryCodes,
      };
    }

    await t.test('an active enrollment retry keeps its secret and extends the expiry', async () => {
      const startedAt = new Date(Date.now() - 2 * 60_000);
      const session = await normalSessions.issue(managerB.accountId, {
        now: startedAt,
      });
      const authentication = authenticationFor(
        managerB.accountId,
        session.session,
      );
      const account = {
        email: managerB.email,
        id: managerB.accountId,
      };
      const first = await twoFactor.beginAccountEnrollment(
        account,
        authentication,
        { now: startedAt },
      );
      const retried = await twoFactor.beginAccountEnrollment(
        account,
        authentication,
        { now: new Date(startedAt.getTime() + 60_000) },
      );
      assert.equal(retried.manualKey, first.manualKey);
      assert.equal(retried.otpAuthUri, first.otpAuthUri);
      assert.notEqual(retried.expiresAt, first.expiresAt);

      const renewed = await twoFactor.beginAccountEnrollment(
        account,
        authentication,
        { now: new Date(startedAt.getTime() + 17 * 60_000) },
      );
      assert.notEqual(renewed.manualKey, first.manualKey);
      assert.notEqual(renewed.otpAuthUri, first.otpAuthUri);
      assert.notEqual(renewed.expiresAt, first.expiresAt);
    });

    await t.test('enrollment preserves only the current UUID session and stores no raw material', async () => {
      const enrolled = await enrollAccount(ownerA.accountId);
      assert.equal(enrolled.recoveryCodes.length, 10);

      const currentRow = await db.NormalUserSession.findByPk(
        enrolled.current.session.id,
      );
      const otherRow = await db.NormalUserSession.findByPk(
        enrolled.other.session.id,
      );
      assert.equal(currentRow.revokedAt, null);
      assert.ok(currentRow.twoFactorVerifiedAt);
      assert.ok(otherRow.revokedAt);

      const factor = await db.AccountTwoFactor.unscoped().findOne({
        where: { accountId: ownerA.accountId },
      });
      assert.equal(factor.status, 'active');
      assert.equal(factor.pendingSecretCiphertext, null);
      assert.equal(factor.secretCiphertext.includes(enrolled.enrollment.manualKey), false);

      const persistedCodes = await db.TwoFactorRecoveryCode.unscoped().findAll({
        where: { accountTwoFactorId: factor.id },
      });
      assert.equal(persistedCodes.length, enrolled.recoveryCodes.length);
      const persisted = JSON.stringify(persistedCodes.map((row) => row.toJSON()));
      for (const rawCode of enrolled.recoveryCodes) {
        assert.equal(persisted.includes(rawCode), false);
      }
    });

    await t.test('password login creates only a challenge, then TOTP login is one-use', async () => {
      const password = 'TwoFactorLogin123!';
      await db.Account.update(
        { passwordHash: await passwordHashing.hashPassword(password) },
        { where: { id: ownerA.accountId } },
      );
      const sessionsBefore = await db.NormalUserSession.count({
        where: { accountId: ownerA.accountId },
      });
      const challenge = await authService.login({
        email: ownerA.email,
        password,
      });
      assert.equal(challenge.requiresTwoFactor, true);
      assert.match(challenge.challengeToken, /^setly_2fc1_[A-Za-z0-9_-]{43}$/u);
      assert.equal(challenge.token, undefined);
      assert.equal(
        await db.NormalUserSession.count({ where: { accountId: ownerA.accountId } }),
        sessionsBefore,
      );

      const factor = await db.AccountTwoFactor.unscoped().findOne({
        where: { accountId: ownerA.accountId },
      });
      const secret = require('../../src/security/auth-data-envelope')
        .decryptAuthData(
          factor.secretCiphertext,
          twoFactor._private.accountIdentity(ownerA.accountId),
        );
      const now = new Date();
      const code = totp.hotp(secret, totp.counterAt(now));
      const completed = await twoFactor.completeAccountLogin(
        challenge.challengeToken,
        code,
        { now },
      );
      assert.match(completed.token, /^setly_s1_[A-Za-z0-9_-]{43}$/u);
      await assert.rejects(
        () => twoFactor.completeAccountLogin(
          challenge.challengeToken,
          code,
          { now },
        ),
        (error) => error.code === 'TWO_FACTOR_VERIFICATION_FAILED',
      );

      const secondChallenge = await twoFactor.issueAccountLoginChallenge(
        ownerA.accountId,
        { now },
      );
      await assert.rejects(
        () => twoFactor.completeAccountLogin(
          secondChallenge.challengeToken,
          code,
          { now },
        ),
        (error) => error.code === 'TWO_FACTOR_VERIFICATION_FAILED',
      );
    });

    await t.test('a recovery code has exactly one winner under concurrent use', async () => {
      const regenerated = await twoFactor.regenerateAccountRecoveryCodes(
        ownerA.accountId,
        authenticationFor(
          ownerA.accountId,
          await db.NormalUserSession.findOne({
            order: [['twoFactorVerifiedAt', 'DESC']],
            where: {
              accountId: ownerA.accountId,
              revokedAt: null,
            },
          }),
        ),
      );
      const challengeA = await twoFactor.issueAccountLoginChallenge(ownerA.accountId);
      const challengeB = await twoFactor.issueAccountLoginChallenge(ownerA.accountId);
      const outcomes = await Promise.allSettled([
        twoFactor.completeAccountLogin(
          challengeA.challengeToken,
          regenerated.recoveryCodes[0],
        ),
        twoFactor.completeAccountLogin(
          challengeB.challengeToken,
          regenerated.recoveryCodes[0],
        ),
      ]);
      assert.equal(
        outcomes.filter((outcome) => outcome.status === 'fulfilled').length,
        1,
      );
      assert.equal(
        outcomes.filter((outcome) => outcome.status === 'rejected').length,
        1,
      );
    });

    await t.test('delayed operator factor completion issues one valid session', async () => {
      const enrollmentNow = new Date(Date.now() - 90_000);
      const enrollmentSession = await operatorAuth.issueSession(
        operatorIdentity,
        { now: enrollmentNow },
      );
      const enrollmentOperator = await operatorAuth.verifySession(
        enrollmentSession.token,
      );
      assert.ok(enrollmentOperator);
      const enrollment = await twoFactor.beginOperatorEnrollment(
        enrollmentOperator,
        { now: enrollmentNow },
      );
      await twoFactor.confirmOperatorEnrollment(
        enrollmentOperator,
        totp.hotp(enrollment.manualKey, totp.counterAt(enrollmentNow)),
        { now: enrollmentNow },
      );

      const delayedNow = new Date(Date.now() - 2_100);
      const challenge = await twoFactor.issueOperatorLoginChallenge(
        operatorIdentity,
        { now: delayedNow },
      );
      const completed = await twoFactor.completeOperatorLogin(
        challenge.challengeToken,
        totp.hotp(enrollment.manualKey, totp.counterAt(delayedNow)),
        { now: delayedNow },
      );
      const verified = await operatorAuth.verifySession(completed.token);
      assert.equal(verified.operatorId, operatorIdentity.operatorId);
      assert.equal(verified.sessionId.length, 32);

      await assert.rejects(
        () => twoFactor.completeOperatorLogin(
          challenge.challengeToken,
          totp.hotp(enrollment.manualKey, totp.counterAt(delayedNow)),
          { now: delayedNow },
        ),
        (error) => error.code === 'TWO_FACTOR_VERIFICATION_FAILED',
      );
    });

    await t.test('owner resets same-club employee; operator resets owners only', async () => {
      const managerEnrollment = await enrollAccount(managerA.accountId);
      const ownerSession = await db.NormalUserSession.findOne({
        order: [['twoFactorVerifiedAt', 'DESC']],
        where: {
          accountId: ownerA.accountId,
          revokedAt: null,
        },
      });
      const ownerAuthentication = authenticationFor(
        ownerA.accountId,
        ownerSession,
      );
      await accountRecovery.resetTwoFactor(
        managerA.accountId,
        organizationA,
        clubA,
        { accountId: ownerA.accountId, type: 'owner' },
        ownerAuthentication,
      );
      assert.equal(
        (await db.AccountTwoFactor.unscoped().findOne({
          where: { accountId: managerA.accountId },
        })).status,
        'disabled',
      );
      assert.ok(
        (await db.NormalUserSession.findByPk(managerEnrollment.current.session.id))
          .revokedAt,
      );
      await assert.rejects(
        () => accountRecovery.resetTwoFactor(
          managerB.accountId,
          organizationB,
          clubB,
          { accountId: ownerA.accountId, type: 'owner' },
          ownerAuthentication,
        ),
        (error) => error.code === 'ACCOUNT_RECOVERY_OWNER_REQUIRED',
      );

      const operatorSession = await operatorAuth.issueSession(operatorIdentity);
      const operator = await operatorAuth.verifySession(operatorSession.token);
      assert.ok(operator);
      await assert.rejects(
        () => accountRecovery.resetTwoFactor(
          managerA.accountId,
          organizationA,
          clubA,
          {
            operator,
            operatorId: operator.operatorId,
            type: 'operator',
            username: operator.username,
          },
        ),
        (error) => error.code === 'TWO_FACTOR_RECOVERY_OPERATOR_OWNER_ONLY',
      );
      await accountRecovery.resetTwoFactor(
        ownerA.accountId,
        organizationA,
        clubA,
        {
          operator,
          operatorId: operator.operatorId,
          type: 'operator',
          username: operator.username,
        },
      );
      assert.equal(
        (await db.AccountTwoFactor.unscoped().findOne({
          where: { accountId: ownerA.accountId },
        })).status,
        'disabled',
      );
      assert.equal(
        await db.NormalUserSession.count({
          where: { accountId: ownerA.accountId, revokedAt: null },
        }),
        0,
      );
    });
  } finally {
    if (db?.sequelize) await db.sequelize.close();
    if (schema) await schema.close();
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    await dropDisposableDatabase(database);
  }
});
