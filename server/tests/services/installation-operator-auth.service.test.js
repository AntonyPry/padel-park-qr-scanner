'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const auth = require('../../src/services/installation-operator-auth.service');

const ENV_KEYS = [
  'AUTH_SECRET',
  'INSTALLATION_OPERATOR_PASSWORD',
  'INSTALLATION_OPERATOR_SECRET',
  'INSTALLATION_OPERATOR_USERNAME',
  'INSTALLATION_PROVISIONING_ENABLED',
  'JWT_SECRET',
];

function withEnvironment(values, callback) {
  const previous = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  for (const key of ENV_KEYS) delete process.env[key];
  Object.assign(process.env, values);
  return Promise.resolve()
    .then(callback)
    .finally(() => {
      for (const key of ENV_KEYS) {
        if (previous[key] === undefined) delete process.env[key];
        else process.env[key] = previous[key];
      }
    });
}

test('installation operator sessions are separately enabled, signed and expiring', async () => {
  await withEnvironment(
    {
      INSTALLATION_OPERATOR_PASSWORD: 'correct-horse-battery-staple',
      INSTALLATION_OPERATOR_SECRET: 'preview-secret-that-is-longer-than-thirty-two-characters',
      INSTALLATION_OPERATOR_USERNAME: 'setly-operator',
      INSTALLATION_PROVISIONING_ENABLED: 'true',
    },
    () => {
      assert.deepEqual(auth.getPublicStatus(), { enabled: true });
      assert.throws(
        () => auth.createSession({ password: 'wrong', username: 'setly-operator' }),
        (error) => error.code === 'INSTALLATION_OPERATOR_CREDENTIALS_INVALID',
      );

      const session = auth.createSession({
        password: 'correct-horse-battery-staple',
        username: 'setly-operator',
      });
      assert.match(session.token, /^[^.]+\.[^.]+\.[^.]+$/u);
      assert.deepEqual(auth.verifySession(session.token), {
        username: 'setly-operator',
      });
      assert.equal(auth.verifySession(`${session.token}tampered`), null);
    },
  );
});

test('installation provisioning stays unavailable without explicit complete configuration', async () => {
  await withEnvironment({}, () => {
    assert.deepEqual(auth.getPublicStatus(), { enabled: false });
    assert.throws(
      () => auth.createSession({ password: 'x', username: 'x' }),
      (error) => error.code === 'INSTALLATION_PROVISIONING_DISABLED',
    );
  });

  await withEnvironment(
    { INSTALLATION_PROVISIONING_ENABLED: 'true' },
    () => assert.deepEqual(auth.getPublicStatus(), { enabled: false }),
  );
});
