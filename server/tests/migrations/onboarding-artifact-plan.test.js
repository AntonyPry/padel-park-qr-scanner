'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  canonicalSql,
  cleanupOwnershipError,
  same,
} = require('../../src/onboarding/migration-artifact-plan');

test('trigger SQL normalization canonicalizes syntax outside quoted literals only', () => {
  assert.equal(
    canonicalSql("BEGIN IF NEW.role = 'Admin Role' THEN SIGNAL SQLSTATE '45000'; END IF; END"),
    canonicalSql(" begin if new.role='Admin Role' then signal sqlstate '45000';end if;end "),
  );
  assert.notEqual(
    canonicalSql("SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Tenant Lost'"),
    canonicalSql("signal sqlstate '45000' set message_text='tenant lost'"),
  );
  assert.notEqual(
    canonicalSql('CREATE TRIGGER x BEFORE INSERT ON t FOR EACH ROW SET @x=1'),
    canonicalSql('CREATE TRIGGER x AFTER INSERT ON t FOR EACH ROW SET @x=1'),
  );
});

test('artifact signatures compare nested index/FK/trigger fields exactly', () => {
  const signature = {
    ACTION_TIMING: 'BEFORE',
    fields: [{ COLLATION: 'A', COLUMN_NAME: 'membershipId', SEQ_IN_INDEX: 1 }],
    rule: { DELETE_RULE: 'CASCADE', UPDATE_RULE: 'RESTRICT' },
  };
  assert.equal(same(signature, JSON.parse(JSON.stringify(signature))), true);
  assert.equal(same(signature, {
    ...signature,
    ACTION_TIMING: 'AFTER',
  }), false);
});

test('cleanup ownership error carries the operator repair contract', () => {
  const error = cleanupOwnershipError('lost');
  assert.equal(error.code, 'TENANT_ONBOARDING_CLEANUP_OWNERSHIP_LOST');
  assert.equal(error.operatorRepair, true);
});
