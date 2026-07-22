'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const express = require('express');

const authController = require('../../src/controllers/auth.controller');
const installationController = require('../../src/controllers/installation-provisioning.controller');
const {
  SURFACES,
  createAuthRateLimiter,
} = require('../../src/services/auth-rate-limit.service');
const { getOpenApiDocument } = require('../../src/contracts/openapi');

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

function limiterEnvironment() {
  const policies = {
    [SURFACES.AUTH_LOGIN]: { account: { limit: 1, windowSeconds: 7 } },
    [SURFACES.AUTH_BOOTSTRAP]: { account: { limit: 1, windowSeconds: 7 } },
    [SURFACES.INSTALLATION_OPERATOR_SESSION]: {
      account: { limit: 1, windowSeconds: 7 },
    },
    [SURFACES.ACTIVATION_STATUS]: { token: { limit: 1, windowSeconds: 7 } },
    [SURFACES.ACTIVATION_CONSUME]: { token: { limit: 1, windowSeconds: 7 } },
  };
  return {
    AUTH_RATE_LIMIT_MODE: 'enforce',
    AUTH_RATE_LIMIT_POLICY_JSON: JSON.stringify(policies),
    AUTH_RATE_LIMIT_SECRET: 'route-secret-material-that-is-at-least-thirty-two-bytes',
    AUTH_RATE_LIMIT_SECRET_ID: 'routes-v1',
    AUTH_RATE_LIMIT_STORE: 'local',
    AUTH_RATE_LIMIT_VERSION: 'v1',
  };
}

test('all five current credential-entry routes share generic pre-handler 429 behavior', async (t) => {
  const calls = new Map();
  const respond = (name, payload) => async (_req, res) => {
    calls.set(name, (calls.get(name) || 0) + 1);
    res.json(payload);
  };
  t.mock.method(authController, 'login', respond('login', { route: 'login' }));
  t.mock.method(authController, 'bootstrap', respond('bootstrap', { route: 'bootstrap' }));
  t.mock.method(
    installationController,
    'session',
    respond('operator', { expiresAt: new Date().toISOString(), token: 'test-token' }),
  );
  t.mock.method(
    installationController,
    'activationStatus',
    respond('activation-status', { state: 'invalid' }),
  );
  t.mock.method(
    installationController,
    'activate',
    respond('activation-consume', { auditLogId: 1, email: 'owner@example.test', success: true }),
  );

  delete require.cache[require.resolve('../../src/routes/auth')];
  delete require.cache[require.resolve('../../src/routes/installation-provisioning')];
  const authRoutes = require('../../src/routes/auth');
  const installationRoutes = require('../../src/routes/installation-provisioning');
  const limiter = createAuthRateLimiter({
    env: limiterEnvironment(),
    logger: () => {},
  });
  const app = express();
  app.set('authRateLimiter', limiter);
  app.use(express.json());
  app.use('/api/auth', authRoutes);
  app.use('/api/installation/provisioning', installationRoutes);
  const server = await listen(app);
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const token = 'A'.repeat(43);
  const cases = [
    ['login', '/auth/login', { email: 'route-login@example.test', password: 'secret' }],
    ['bootstrap', '/auth/bootstrap', {
      email: 'route-bootstrap@example.test',
      name: 'Route Owner',
      password: 'secret1',
    }],
    ['operator', '/installation/provisioning/session', {
      password: 'operator-secret',
      username: 'route-operator',
    }],
    ['activation-status', '/installation/provisioning/activation/status', { token }],
    ['activation-consume', '/installation/provisioning/activation/consume', {
      password: 'activation-secret',
      token,
    }],
  ];

  try {
    for (const [name, path, body] of cases) {
      const options = {
        body: JSON.stringify(body),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      };
      const first = await fetch(`${base}${path}`, options);
      assert.equal(first.status, 200, `${name} initial shape`);
      const denied = await fetch(`${base}${path}`, options);
      assert.equal(denied.status, 429, name);
      assert.equal(denied.headers.get('retry-after'), '7', name);
      assert.deepEqual(await denied.json(), {
        code: 'AUTH_RATE_LIMITED',
        error: 'Слишком много попыток. Повторите позже',
        status: 429,
      }, name);
      assert.equal(calls.get(name), 1, `${name} handler must not run when throttled`);
    }
  } finally {
    await limiter.close();
    await close(server);
  }
});

test('OpenAPI declares the real 429 and Retry-After drift only on the five covered surfaces', () => {
  const document = getOpenApiDocument();
  const covered = new Set([
    '/auth/bootstrap',
    '/auth/login',
    '/installation/provisioning/session',
    '/installation/provisioning/activation/status',
    '/installation/provisioning/activation/consume',
  ]);
  const declared = [];
  for (const [path, pathItem] of Object.entries(document.paths)) {
    for (const operation of Object.values(pathItem)) {
      if (!operation.responses?.[429]) continue;
      declared.push(path);
      const response = operation.responses[429];
      assert.deepEqual(response.content['application/json'].schema.required.sort(), [
        'code',
        'error',
        'status',
      ]);
      assert.equal(response.headers['Retry-After'].required, true);
      assert.equal(response.headers['Retry-After'].schema.minimum, 1);
    }
  }
  assert.deepEqual(new Set(declared), covered);
});
