'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const recovery = require('../../src/services/account-recovery.service');
const migration = require('../../migrations/20260722110000-create-account-recovery');
const { apiSchemas } = require('../../src/contracts/api-schemas');

test('recovery tokens are canonical, opaque and digest-only', () => {
  const raw = recovery._private.issueRawToken();
  assert.match(raw, recovery.TOKEN_PATTERN);
  assert.equal(recovery.digestToken(raw).length, 64);
  assert.notEqual(recovery.digestToken(raw), raw);
  assert.equal(recovery._private.issueRawToken().length, raw.length);
});

test('migration contains only request/token history and immutable token triggers', () => {
  assert.deepEqual(migration.__testing.TABLES, ['AccountRecoveryRequests', 'AccountRecoveryTokens']);
  assert.deepEqual(migration.__testing.TRIGGERS.map((trigger) => trigger.name), [
    'trg_account_recovery_tokens_bi',
    'trg_account_recovery_tokens_bu',
    'trg_account_recovery_tokens_bd',
  ]);
  assert.match(migration.__testing.TRIGGERS[0].body, /tokenDigest NOT REGEXP/u);
  assert.match(migration.__testing.TRIGGERS[1].body, /NEW\.issuedBy/u);
  assert.match(migration.__testing.TRIGGERS[2].body, /history is immutable/u);
});

test('public token inspection is neutral for malformed values', async () => {
  assert.deepEqual(await recovery.inspectToken('not-a-recovery-token'), { available: false });
});

test('synthetic fixture addresses are never exposed in operator serialization', () => {
  assert.equal(recovery._private.safeEmail({ email: 'o***@f9-rc.test', role: 'owner' }), 'owner@example.test');
  assert.equal(recovery._private.safeEmail({ email: 'owner@example.test', role: 'owner' }), 'owner@example.test');
});

test('public reset accepts only token and new password', async () => {
  await assert.rejects(
    () => recovery.resetPassword('not-a-recovery-token', 'password'),
    (error) => error.code === 'ACCOUNT_RECOVERY_TOKEN_INVALID',
  );
});

test('recovery API contracts reject user-entered reasons', () => {
  const token = 'setly_r1_' + 'A'.repeat(43);
  assert.equal(apiSchemas.auth.recoveryReset.body.safeParse({ token, password: 'password' }).success, true);
  assert.equal(apiSchemas.auth.recoveryReset.body.safeParse({ token, password: 'password', reason: 'legacy' }).success, false);
  assert.equal(apiSchemas.installationProvisioning.recoveryProfile.body.safeParse({ email: 'user@example.test', displayName: 'User' }).success, true);
  assert.equal(apiSchemas.installationProvisioning.recoveryProfile.body.safeParse({ email: 'user@example.test', displayName: 'User', reason: 'legacy' }).success, false);
  assert.equal(apiSchemas.installationProvisioning.recoveryIssue.body.safeParse({}).success, true);
  assert.equal(apiSchemas.installationProvisioning.recoveryIssue.body.safeParse({ reason: 'legacy' }).success, false);
});
