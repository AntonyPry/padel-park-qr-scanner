'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');

const migration = require(
  '../../migrations/20260724100000-add-two-factor-authentication',
);

test('SEC-A7 migration has only the bounded factor/challenge schema', () => {
  assert.deepEqual(migration.__testing.TABLES, [
    'AccountTwoFactors',
    'InstallationOperatorTwoFactors',
    'TwoFactorRecoveryCodes',
    'AuthLoginChallenges',
  ]);
  assert.deepEqual(migration.__testing.SESSION_COLUMNS, [
    ['NormalUserSessions', 'twoFactorVerifiedAt'],
    ['InstallationOperatorSessions', 'operatorId'],
    ['InstallationOperatorSessions', 'authMode'],
    ['InstallationOperatorSessions', 'credentialVersion'],
    ['InstallationOperatorSessions', 'twoFactorVerifiedAt'],
  ]);
  const triggerNames = migration.__testing.TRIGGERS.map(({ name }) => name);
  assert.equal(new Set(triggerNames).size, triggerNames.length);
  assert.ok(triggerNames.includes('trg_account_two_factors_bu'));
  assert.ok(triggerNames.includes('trg_two_factor_recovery_codes_bu'));
  assert.ok(triggerNames.includes('trg_auth_login_challenges_bu'));
  assert.ok(triggerNames.includes('trg_operator_sessions_two_factor_bi'));
  assert.ok(triggerNames.includes('trg_operator_sessions_two_factor_bu'));
});
