'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const auth = require('../../src/services/installation-operator-auth.service');
const db = require('../../models');

const ENV_KEYS = [
  'AUTH_SECRET',
  'INSTALLATION_MANAGEMENT_ENABLED',
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
  const sessions = new Map();
  const originalCreate = db.InstallationOperatorSession.create;
  const originalFindOne = db.InstallationOperatorSession.findOne;
  const originalUpdate = db.InstallationOperatorSession.update;
  db.InstallationOperatorSession.create = async (payload) => {
    const row = { ...payload, revokedAt: null };
    sessions.set(payload.sessionId, row);
    return row;
  };
  db.InstallationOperatorSession.findOne = async ({ where }) => sessions.get(where.sessionId) || null;
  db.InstallationOperatorSession.update = async (updates, { where }) => {
    const row = sessions.get(where.sessionId);
    if (!row || row.revokedAt) return [0];
    Object.assign(row, updates);
    return [1];
  };
  await withEnvironment(
    {
      INSTALLATION_OPERATOR_PASSWORD: 'correct-horse-battery-staple',
      INSTALLATION_OPERATOR_SECRET: 'preview-secret-that-is-longer-than-thirty-two-characters',
      INSTALLATION_OPERATOR_USERNAME: 'setly-operator',
      INSTALLATION_PROVISIONING_ENABLED: 'true',
    },
    async () => {
      assert.deepEqual(auth.getPublicStatus(), {
        enabled: true,
        managementEnabled: false,
        provisioningEnabled: true,
      });
      await assert.rejects(
        auth.createSession({ password: 'wrong', username: 'setly-operator' }),
        (error) => error.code === 'INSTALLATION_OPERATOR_CREDENTIALS_INVALID',
      );

      const session = await auth.createSession({
        password: 'correct-horse-battery-staple',
        username: 'setly-operator',
      });
      assert.match(session.token, /^[^.]+\.[^.]+\.[^.]+$/u);
      const verified = await auth.verifySession(session.token);
      assert.equal(verified.username, 'setly-operator');
      assert.match(verified.sessionId, /^[a-f0-9]{32}$/u);
      assert.equal(await auth.verifySession(`${session.token}tampered`), null);
      assert.equal(await auth.revokeSession(verified), true);
      assert.equal(await auth.verifySession(session.token), null);
    },
  ).finally(() => {
    db.InstallationOperatorSession.create = originalCreate;
    db.InstallationOperatorSession.findOne = originalFindOne;
    db.InstallationOperatorSession.update = originalUpdate;
  });
});

test('installation provisioning stays unavailable without explicit complete configuration', async () => {
  await withEnvironment({}, async () => {
    assert.deepEqual(auth.getPublicStatus(), {
      enabled: false,
      managementEnabled: false,
      provisioningEnabled: false,
    });
    await assert.rejects(
      auth.createSession({ password: 'x', username: 'x' }),
      (error) => error.code === 'INSTALLATION_PROVISIONING_DISABLED',
    );
  });

  await withEnvironment(
    { INSTALLATION_PROVISIONING_ENABLED: 'true' },
    () => assert.deepEqual(auth.getPublicStatus(), {
      enabled: false,
      managementEnabled: false,
      provisioningEnabled: false,
    }),
  );
});

test('installation management is independently enabled while provisioning stays off', async () => {
  await withEnvironment(
    {
      INSTALLATION_MANAGEMENT_ENABLED: 'true',
      INSTALLATION_OPERATOR_PASSWORD: 'management-password',
      INSTALLATION_OPERATOR_SECRET: 'management-secret-that-is-longer-than-thirty-two-characters',
      INSTALLATION_OPERATOR_USERNAME: 'management-operator',
    },
    async () => {
      assert.deepEqual(auth.getPublicStatus(), {
        enabled: true,
        managementEnabled: true,
        provisioningEnabled: false,
      });
      assert.doesNotThrow(() => auth.assertManagementEnabled());
      assert.throws(
        () => auth.assertProvisioningEnabled(),
        (error) => error.code === 'INSTALLATION_PROVISIONING_DISABLED',
      );
    },
  );
});
