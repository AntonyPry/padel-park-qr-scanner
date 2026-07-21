'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const migration = require(
  '../../migrations/20260721220000-allow-expired-onboarding-mode-disable'
);

const {
  CURRENT_BODY,
  STRICT_BODY,
  exactTrigger,
} = migration.__testing;

function trigger(body) {
  return {
    body,
    event: 'UPDATE',
    table: 'OnboardingTrainingModes',
    timing: 'BEFORE',
  };
}

function fakeQueryInterface(initialBody) {
  const operations = [];
  let body = initialBody;
  return {
    get body() {
      return body;
    },
    operations,
    sequelize: {
      async query(sql) {
        if (sql.includes('information_schema.TRIGGERS')) {
          return [body ? [{
            ACTION_STATEMENT: body,
            ACTION_TIMING: 'BEFORE',
            EVENT_MANIPULATION: 'UPDATE',
            EVENT_OBJECT_TABLE: 'OnboardingTrainingModes',
          }] : []];
        }
        if (sql.startsWith('DROP TRIGGER')) {
          operations.push('drop');
          body = null;
          return [[], undefined];
        }
        if (sql.startsWith('CREATE TRIGGER')) {
          operations.push('create');
          body = sql.slice(sql.indexOf(' FOR EACH ROW ') + ' FOR EACH ROW '.length);
          return [[], undefined];
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      },
    },
  };
}

test('onboarding trigger classifier accepts only the exact semantic body', () => {
  assert.equal(exactTrigger(trigger(CURRENT_BODY), CURRENT_BODY), true);
  assert.equal(exactTrigger(trigger(STRICT_BODY), STRICT_BODY), true);
  assert.equal(
    exactTrigger(
      trigger(CURRENT_BODY.replace("'45000'", "'45001'")),
      CURRENT_BODY,
    ),
    false,
  );
  assert.equal(
    exactTrigger(
      trigger(CURRENT_BODY.replace(
        "'OnboardingTrainingMode tenant authority mismatch'",
        "'onboardingtrainingmode tenant authority mismatch'",
      )),
      CURRENT_BODY,
    ),
    false,
  );
  assert.equal(
    exactTrigger(
      trigger(CURRENT_BODY.replace(
        'OLD.expiresAt<=NEW.disabledAt',
        'OLD.expiresAt<NEW.disabledAt',
      )),
      CURRENT_BODY,
    ),
    false,
  );
});

test('onboarding trigger migration is idempotent and refuses lookalikes before DDL', async () => {
  const strict = fakeQueryInterface(STRICT_BODY);
  await migration.down(strict);
  assert.deepEqual(strict.operations, []);
  await migration.up(strict);
  assert.deepEqual(strict.operations, ['drop', 'create']);
  await migration.up(strict);
  assert.deepEqual(strict.operations, ['drop', 'create']);
  await migration.down(strict);
  assert.deepEqual(strict.operations, ['drop', 'create', 'drop', 'create']);

  for (const body of [
    null,
    STRICT_BODY.replace("m.role='owner'", "m.role='OWNER'"),
    STRICT_BODY.replace(
      "'OnboardingTrainingMode tenant authority mismatch'",
      "'OnboardingTrainingMode tenant authority Mismatch'",
    ),
    STRICT_BODY.replace("m.status='active'", "m.status='archived'"),
  ]) {
    const candidate = fakeQueryInterface(body);
    await assert.rejects(
      migration.up(candidate),
      (error) => error?.code ===
        'ONBOARDING_TRAINING_MODE_TRIGGER_MIGRATION_BLOCKED',
    );
    assert.deepEqual(candidate.operations, []);
    assert.equal(candidate.body, body);
  }
});

test('onboarding trigger migration restores the prior exact guard after create failure', async () => {
  const candidate = fakeQueryInterface(STRICT_BODY);
  migration.__testing.failNextCreate();
  await assert.rejects(
    migration.up(candidate),
    (error) => error?.code === 'ONBOARDING_TRIGGER_CREATE_FORCED_FAILURE',
  );
  assert.equal(exactTrigger(trigger(candidate.body), STRICT_BODY), true);
  await migration.up(candidate);
  assert.equal(exactTrigger(trigger(candidate.body), CURRENT_BODY), true);

  migration.__testing.failNextCreate();
  await assert.rejects(
    migration.down(candidate),
    (error) => error?.code === 'ONBOARDING_TRIGGER_CREATE_FORCED_FAILURE',
  );
  assert.equal(exactTrigger(trigger(candidate.body), CURRENT_BODY), true);
  await migration.down(candidate);
  assert.equal(exactTrigger(trigger(candidate.body), STRICT_BODY), true);
});
