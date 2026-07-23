'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const test = require('node:test');
const db = require('../../models');
const authService = require('../../src/services/auth.service');
const operatorAuth = require('../../src/services/installation-operator-auth.service');
const passwordHashing = require('../../src/services/password-hashing.service');
const authRoutes = require('../../src/routes/auth');
const { attachRouteDeclaration } = require('../../src/middleware/tenant-context');

const ENV_KEYS = [
  'AUTH_LEGACY_TOKEN_MODE',
  'AUTH_RATE_LIMIT_MODE',
  'INSTALLATION_OPERATOR_PASSWORD',
  'INSTALLATION_OPERATOR_PASSWORD_HASH',
  'INSTALLATION_OPERATOR_SECRET',
  'INSTALLATION_OPERATOR_USERNAME',
];

function listen(server) {
  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', resolve);
    server.once('error', reject);
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

test('ordinary POST /api/auth/login never authenticates installation operator credentials', async (t) => {
  const previous = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  t.after(() => {
    for (const key of ENV_KEYS) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  });
  const password = 'operator-only-password';
  const passwordHash = await passwordHashing.hashPassword(password, {
    AUTH_ARGON2_ENABLED: 'true',
    AUTH_ARGON2_MEMORY_KIB: '19456',
    AUTH_ARGON2_PARALLELISM: '1',
    AUTH_ARGON2_TIME_COST: '2',
  });
  Object.assign(process.env, {
    AUTH_LEGACY_TOKEN_MODE: 'off',
    AUTH_RATE_LIMIT_MODE: 'off',
    INSTALLATION_OPERATOR_PASSWORD_HASH: passwordHash,
    INSTALLATION_OPERATOR_SECRET: 'ordinary-login-isolation-secret-that-is-long-enough',
    INSTALLATION_OPERATOR_USERNAME: 'operator@setly.test',
  });

  let normalSessionIssues = 0;
  let operatorSessionIssues = 0;
  const app = express();
  app.use(express.json());
  app.use(attachRouteDeclaration);
  app.use('/api/auth', authRoutes);
  const server = http.createServer(app);
  await listen(server);

  t.mock.method(db.Account, 'findOne', async () => null);
  t.mock.method(authService._private.normalUserSessions, 'issue', async () => {
    normalSessionIssues += 1;
    throw new Error('normal session must not be issued');
  });
  t.mock.method(operatorAuth, 'createSession', async () => {
    operatorSessionIssues += 1;
    throw new Error('operator session must not be issued through ordinary login');
  });

  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/auth/login`, {
      body: JSON.stringify({ email: 'operator@setly.test', password }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), {
      error: 'Неверный email или пароль',
      status: 401,
    });
    assert.equal(response.headers.get('set-cookie'), null);
    assert.equal(normalSessionIssues, 0);
    assert.equal(operatorSessionIssues, 0);
  } finally {
    await close(server);
  }
});
