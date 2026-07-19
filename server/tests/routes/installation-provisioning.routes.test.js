'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const express = require('express');

const ENV_KEYS = [
  'INSTALLATION_OPERATOR_PASSWORD',
  'INSTALLATION_OPERATOR_SECRET',
  'INSTALLATION_OPERATOR_USERNAME',
  'INSTALLATION_PROVISIONING_ENABLED',
];

async function listen(app) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
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
  Object.assign(process.env, {
    INSTALLATION_OPERATOR_PASSWORD: 'route-test-password',
    INSTALLATION_OPERATOR_SECRET: 'route-test-secret-longer-than-thirty-two-characters',
    INSTALLATION_OPERATOR_USERNAME: 'route-test-operator',
    INSTALLATION_PROVISIONING_ENABLED: 'true',
  });
  let server;
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
    assert.deepEqual(await status.json(), { enabled: true });

    const session = await api('/installation/provisioning/session', {
      body: JSON.stringify({
        password: 'route-test-password',
        username: 'route-test-operator',
      }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });
    assert.equal(session.status, 200);
    assert.match((await session.json()).token, /^[^.]+\.[^.]+\.[^.]+$/u);

    for (const request of [
      ['/installation/provisioning/snapshot', { method: 'GET' }],
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
  } finally {
    await close(server);
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
