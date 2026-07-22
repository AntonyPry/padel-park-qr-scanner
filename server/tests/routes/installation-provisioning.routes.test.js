'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const express = require('express');
const db = require('../../models');
const passwordAuth = require('../../src/services/auth.service');

const ENV_KEYS = [
  'INSTALLATION_MANAGEMENT_ENABLED',
  'INSTALLATION_OPERATOR_PASSWORD',
  'INSTALLATION_OPERATOR_PASSWORD_HASH',
  'INSTALLATION_OPERATOR_SECRET',
  'INSTALLATION_OPERATOR_USERNAME',
  'INSTALLATION_PROVISIONING_ENABLED',
];

async function listen(app) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1');
    server.once('listening', () => resolve(server));
    server.once('error', reject);
  });
}

async function close(server) {
  if (!server?.listening) return;
  await new Promise((resolve, reject) =>
    server.close((error) => (
      error && error.code !== 'ERR_SERVER_NOT_RUNNING' ? reject(error) : resolve()
    )));
}

test('installation provisioning routes remain isolated behind operator authority', async () => {
  const previous = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  for (const key of ENV_KEYS) delete process.env[key];
  const operatorPassword = 'route-test-password';
  const operatorPasswordHash = await passwordAuth.hashPassword(operatorPassword, {
    AUTH_ARGON2_ENABLED: 'true',
  });
  Object.assign(process.env, {
    INSTALLATION_OPERATOR_PASSWORD_HASH: operatorPasswordHash,
    INSTALLATION_OPERATOR_SECRET: 'route-test-secret-longer-than-thirty-two-characters',
    INSTALLATION_OPERATOR_USERNAME: 'route-test-operator',
    INSTALLATION_MANAGEMENT_ENABLED: 'true',
    INSTALLATION_PROVISIONING_ENABLED: 'true',
  });
  let server;
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
  db.InstallationOperatorSession.findOne = async ({ where }) => sessions.get(where.sessionId) || null;
  db.sequelize.transaction = async (callback) => callback({ LOCK: { UPDATE: 'UPDATE' } });
  try {
    const routes = require('../../src/routes/installation-provisioning');
    const app = express();
    app.use(express.json());
    app.use('/api/installation/provisioning', routes);
    server = await listen(app);
    const api = (path, options = {}) => fetch(
      `http://127.0.0.1:${server.address().port}/api${path}`,
      options,
    );

    const status = await api('/installation/provisioning/status');
    assert.equal(status.status, 200);
    assert.deepEqual(await status.json(), {
      enabled: true,
      managementEnabled: true,
      provisioningEnabled: true,
    });

    const session = await api('/installation/provisioning/session', {
      body: JSON.stringify({
        password: operatorPassword,
        username: 'route-test-operator',
      }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });
    assert.equal(session.status, 200);
    const operatorToken = (await session.json()).token;
    assert.match(operatorToken, /^[^.]+\.[^.]+\.[^.]+$/u);

    process.env.INSTALLATION_PROVISIONING_ENABLED = 'false';
    const managementOnlyStatus = await api('/installation/provisioning/status');
    assert.deepEqual(await managementOnlyStatus.json(), {
      enabled: true,
      managementEnabled: true,
      provisioningEnabled: false,
    });
    const provisioningDisabled = await api('/installation/provisioning/organizations', {
      body: JSON.stringify({}),
      headers: {
        Authorization: `Bearer ${operatorToken}`,
        'Content-Type': 'application/json',
      },
      method: 'POST',
    });
    assert.equal(provisioningDisabled.status, 404);
    assert.equal((await provisioningDisabled.json()).error, 'Создание организаций отключено');
    process.env.INSTALLATION_PROVISIONING_ENABLED = 'true';

    const legacyPlaintext = 'legacy-value-must-not-verify';
    process.env.INSTALLATION_OPERATOR_PASSWORD_HASH = '$argon2id$malformed';
    process.env.INSTALLATION_OPERATOR_PASSWORD = legacyPlaintext;
    const unavailableLoginStatus = await api('/installation/provisioning/status');
    assert.deepEqual(await unavailableLoginStatus.json(), {
      enabled: false,
      managementEnabled: false,
      provisioningEnabled: false,
    });
    const unavailableLogin = await api('/installation/provisioning/session', {
      body: JSON.stringify({
        password: legacyPlaintext,
        username: 'route-test-operator',
      }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });
    assert.equal(unavailableLogin.status, 503);
    const unavailableBody = await unavailableLogin.json();
    assert.equal(unavailableBody.error, 'Не удалось войти как оператор');
    assert.equal(JSON.stringify(unavailableBody).includes(operatorPasswordHash), false);
    assert.equal(JSON.stringify(unavailableBody).includes(legacyPlaintext), false);

    for (const request of [
      ['/installation/provisioning/snapshot', { method: 'GET' }],
      ['/installation/provisioning/organizations/1', { method: 'GET' }],
      ['/installation/provisioning/organizations', {
        body: JSON.stringify({}),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      }],
      ['/installation/provisioning/organizations/1/activation/reissue', {
        method: 'POST',
      }],
    ]) {
      const response = await api(request[0], request[1]);
      assert.equal(response.status, 401, request[0]);
      assert.equal((await response.json()).error, 'Требуется вход оператора');
    }

    const revoked = await api('/installation/provisioning/session/revoke', {
      headers: { Authorization: `Bearer ${operatorToken}` },
      method: 'POST',
    });
    assert.equal(revoked.status, 200);
    assert.deepEqual(await revoked.json(), { success: true });
    const stale = await api('/installation/provisioning/snapshot', {
      headers: { Authorization: `Bearer ${operatorToken}` },
      method: 'GET',
    });
    assert.equal(stale.status, 401);
    assert.equal((await stale.json()).error, 'Сессия оператора недействительна');
  } finally {
    db.InstallationOperatorSession.create = originalCreate;
    db.InstallationOperatorSession.findOne = originalFindOne;
    db.sequelize.transaction = originalTransaction;
    await close(server);
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
