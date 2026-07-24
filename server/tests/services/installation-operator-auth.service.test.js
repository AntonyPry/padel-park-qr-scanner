'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const passwordAuth = require('../../src/services/password-hashing.service');
const auth = require('../../src/services/installation-operator-auth.service');
const db = require('../../models');

const ENV_KEYS = [
  'AUTH_SECRET',
  'INSTALLATION_MANAGEMENT_ENABLED',
  'INSTALLATION_OPERATOR_PASSWORD',
  'INSTALLATION_OPERATOR_PASSWORD_HASH',
  'INSTALLATION_OPERATOR_SECRET',
  'INSTALLATION_OPERATOR_USERNAME',
  'INSTALLATION_PROVISIONING_ENABLED',
  'JWT_SECRET',
];
const ARGON_ENV = Object.freeze({
  AUTH_ARGON2_ENABLED: 'true',
  AUTH_ARGON2_MEMORY_KIB: '19456',
  AUTH_ARGON2_PARALLELISM: '1',
  AUTH_ARGON2_TIME_COST: '2',
});

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

async function operatorHash(password) {
  return passwordAuth.hashPassword(password, ARGON_ENV);
}

function installSessionPersistence() {
  const sessions = new Map();
  const originalCreate = db.InstallationOperatorSession.create;
  const originalFindOne = db.InstallationOperatorSession.findOne;
  const originalTransaction = db.sequelize.transaction;
  db.InstallationOperatorSession.create = async (payload) => {
    const row = {
      ...payload,
      revokedAt: null,
      update: async (updates) => Object.assign(row, updates),
    };
    sessions.set(payload.sessionId, row);
    return row;
  };
  db.InstallationOperatorSession.findOne = async ({ where }) =>
    sessions.get(where.sessionId) || null;
  db.sequelize.transaction = async (callback) =>
    callback({ LOCK: { UPDATE: 'UPDATE' } });
  return () => {
    db.InstallationOperatorSession.create = originalCreate;
    db.InstallationOperatorSession.findOne = originalFindOne;
    db.sequelize.transaction = originalTransaction;
  };
}

test('hash-only operator login creates the same signed revocable session', async () => {
  const password = 'correct-horse-battery-staple';
  const passwordHash = await operatorHash(password);
  const restorePersistence = installSessionPersistence();
  await withEnvironment(
    {
      INSTALLATION_OPERATOR_PASSWORD_HASH: passwordHash,
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
      for (const input of [
        { password: 'wrong', username: 'setly-operator' },
        { password, username: 'wrong-operator' },
      ]) {
        await assert.rejects(
          auth.createSession(input),
          (error) => (
            error.code === 'INSTALLATION_OPERATOR_CREDENTIALS_INVALID' &&
            error.message === 'Неверный логин или пароль оператора'
          ),
        );
      }

      const session = await auth.createSession({
        password,
        username: 'setly-operator',
      });
      assert.match(session.token, /^[^.]+\.[^.]+\.[^.]+$/u);
      const verified = await auth.verifySession(session.token);
      assert.equal(verified.username, 'setly-operator');
      assert.match(verified.sessionId, /^[a-f0-9]{32}$/u);
      assert.equal(Object.isFrozen(verified), true);

      const delayed = await auth.issueSession(
        {
          authMode: 'legacy',
          credentialVersion: 1,
          operatorId: null,
          username: 'setly-operator',
        },
        { now: new Date(Date.now() - 2_100) },
      );
      assert.ok(
        await auth.verifySession(delayed.token),
        'an injected clock older than the JWT/DB tolerance must still issue a valid session',
      );

      await assert.rejects(
        auth.lockSessionAuthority({ ...verified }, { LOCK: { UPDATE: 'UPDATE' } }),
        (error) => error.code === 'INSTALLATION_OPERATOR_SESSION_INVALID',
      );
      assert.equal(await auth.verifySession(`${session.token}tampered`), null);
      assert.equal(await auth.revokeSession(verified), true);
      assert.equal(await auth.verifySession(session.token), null);
    },
  ).finally(restorePersistence);
});

test('new login fails closed for every incomplete or legacy credential cutover', async () => {
  const password = 'cutover-password';
  const passwordHash = await operatorHash(password);
  const legacyHash = await passwordAuth.hashPassword(password, {
    AUTH_ARGON2_ENABLED: 'false',
  });
  const signing = {
    INSTALLATION_OPERATOR_SECRET: 'cutover-secret-that-is-longer-than-thirty-two-characters',
    INSTALLATION_OPERATOR_USERNAME: 'cutover-operator',
    INSTALLATION_PROVISIONING_ENABLED: 'true',
  };
  const cases = [
    ['missing hash', signing],
    ['malformed hash', {
      ...signing,
      INSTALLATION_OPERATOR_PASSWORD_HASH: '$argon2id$malformed',
    }],
    ['unsupported legacy hash', {
      ...signing,
      INSTALLATION_OPERATOR_PASSWORD_HASH: legacyHash,
    }],
    ['legacy plaintext only', {
      ...signing,
      INSTALLATION_OPERATOR_PASSWORD: password,
    }],
    ['legacy plaintext alongside valid hash', {
      ...signing,
      INSTALLATION_OPERATOR_PASSWORD: '',
      INSTALLATION_OPERATOR_PASSWORD_HASH: passwordHash,
    }],
    ['missing username', {
      INSTALLATION_OPERATOR_PASSWORD_HASH: passwordHash,
      INSTALLATION_OPERATOR_SECRET: signing.INSTALLATION_OPERATOR_SECRET,
      INSTALLATION_PROVISIONING_ENABLED: 'true',
    }],
    ['invalid signer secret', {
      INSTALLATION_OPERATOR_PASSWORD_HASH: passwordHash,
      INSTALLATION_OPERATOR_SECRET: 'too-short',
      INSTALLATION_OPERATOR_USERNAME: signing.INSTALLATION_OPERATOR_USERNAME,
      INSTALLATION_PROVISIONING_ENABLED: 'true',
    }],
  ];

  for (const [label, environment] of cases) {
    await withEnvironment(environment, async () => {
      assert.deepEqual(auth.getPublicStatus(), {
        enabled: false,
        managementEnabled: false,
        provisioningEnabled: false,
      }, label);
      await assert.rejects(
        auth.createSession({
          password,
          username: signing.INSTALLATION_OPERATOR_USERNAME,
        }),
        (error) => {
          const serialized = JSON.stringify({
            code: error.code,
            message: error.message,
            statusCode: error.statusCode,
          });
          return error.code === 'INSTALLATION_OPERATOR_CONFIGURATION_INVALID' &&
            error.statusCode === 503 &&
            !serialized.includes(password) &&
            !serialized.includes(passwordHash);
        },
        label,
      );
    });
  }
});

test('existing DB-backed sessions ignore invalid login credential cutover state', async () => {
  const password = 'continuity-password';
  const passwordHash = await operatorHash(password);
  const restorePersistence = installSessionPersistence();
  await withEnvironment(
    {
      INSTALLATION_MANAGEMENT_ENABLED: 'true',
      INSTALLATION_OPERATOR_PASSWORD_HASH: passwordHash,
      INSTALLATION_OPERATOR_SECRET: 'continuity-secret-that-is-longer-than-thirty-two-characters',
      INSTALLATION_OPERATOR_USERNAME: 'continuity-operator',
    },
    async () => {
      const first = await auth.createSession({
        password,
        username: 'continuity-operator',
      });
      const second = await auth.createSession({
        password,
        username: 'continuity-operator',
      });

      delete process.env.INSTALLATION_OPERATOR_PASSWORD_HASH;
      process.env.INSTALLATION_OPERATOR_PASSWORD = 'legacy-must-never-verify';
      assert.equal(auth.getPublicStatus().enabled, false);
      const firstAuthority = await auth.verifySession(first.token);
      assert.equal(firstAuthority.username, 'continuity-operator');
      assert.equal(
        await auth.revalidateSessionAuthority(firstAuthority),
        firstAuthority,
      );

      process.env.INSTALLATION_OPERATOR_PASSWORD_HASH = '$argon2id$malformed';
      const secondAuthority = await auth.verifySession(second.token);
      assert.equal(secondAuthority.username, 'continuity-operator');
      assert.equal(await auth.revokeSession(secondAuthority), true);
      assert.equal(await auth.verifySession(second.token), null);
      assert.equal(await auth.revokeSession(firstAuthority), true);
    },
  ).finally(restorePersistence);
});

test('password verifier failures remain generic and never emit credential material', async (t) => {
  const password = 'never-log-this-password';
  const passwordHash = await operatorHash(password);
  const emitted = [];
  t.mock.method(console, 'log', (...args) => emitted.push(args));
  t.mock.method(console, 'warn', (...args) => emitted.push(args));
  t.mock.method(console, 'error', (...args) => emitted.push(args));
  const verify = t.mock.method(passwordAuth, 'verifyPassword', async () => {
    throw new Error(`${password} ${passwordHash} verifier failure`);
  });

  await withEnvironment(
    {
      INSTALLATION_OPERATOR_PASSWORD_HASH: passwordHash,
      INSTALLATION_OPERATOR_SECRET: 'failure-secret-that-is-longer-than-thirty-two-characters',
      INSTALLATION_OPERATOR_USERNAME: 'failure-operator',
      INSTALLATION_PROVISIONING_ENABLED: 'true',
    },
    async () => {
      await assert.rejects(
        auth.createSession({ password, username: 'wrong-operator' }),
        (error) => {
          const serialized = JSON.stringify(error, Object.getOwnPropertyNames(error));
          return error.code === 'INSTALLATION_OPERATOR_CREDENTIALS_INVALID' &&
            !serialized.includes(password) &&
            !serialized.includes(passwordHash);
        },
      );
    },
  );
  assert.equal(verify.mock.callCount(), 1);
  assert.deepEqual(emitted, []);
});

test('installation features stay unavailable without an explicit enabled surface', async () => {
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
});

test('installation management is independently enabled while provisioning stays off', async () => {
  const passwordHash = await operatorHash('management-password');
  await withEnvironment(
    {
      INSTALLATION_MANAGEMENT_ENABLED: 'true',
      INSTALLATION_OPERATOR_PASSWORD_HASH: passwordHash,
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
