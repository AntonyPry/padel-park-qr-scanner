'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');

const {
  SURFACES,
  createAuthRateLimiter,
  validateAuthRateLimitConfiguration,
  _private,
} = require('../../src/services/auth-rate-limit.service');

function activeEnv(overrides = {}) {
  return {
    AUTH_RATE_LIMIT_MODE: 'enforce',
    AUTH_RATE_LIMIT_SECRET: 'test-secret-material-that-is-at-least-thirty-two-bytes',
    AUTH_RATE_LIMIT_SECRET_ID: 'test-v1',
    AUTH_RATE_LIMIT_STORE: 'local',
    AUTH_RATE_LIMIT_VERSION: 'v1',
    ...overrides,
  };
}

function request(body, {
  headers = {},
  remoteAddress = '127.0.0.1',
} = {}) {
  return { body, headers, socket: { remoteAddress } };
}

function loginPolicy({ accountLimit, accountWindow = 5, classLimit = 1000, peerLimit = 1000 }) {
  return JSON.stringify({
    [SURFACES.AUTH_LOGIN]: {
      account: { limit: accountLimit, windowSeconds: accountWindow },
      credential_class: { limit: classLimit, windowSeconds: accountWindow },
      peer: { limit: peerLimit, windowSeconds: accountWindow },
    },
  });
}

test('off is the exact default and requires no secret, version or store', async () => {
  assert.doesNotThrow(() => validateAuthRateLimitConfiguration({}));
  assert.doesNotThrow(() => validateAuthRateLimitConfiguration({
    AUTH_RATE_LIMIT_MODE: 'off',
    AUTH_RATE_LIMIT_POLICY_JSON: '{ignored while off',
    AUTH_RATE_LIMIT_SECRET: 'short',
    AUTH_RATE_LIMIT_STORE: 'not-a-store',
  }));
  const events = [];
  const limiter = createAuthRateLimiter({ env: {}, logger: (event) => events.push(event) });
  const decision = await limiter.consumeRequest(
    SURFACES.AUTH_LOGIN,
    request({ email: 'off@example.test', password: 'not-observed' }),
  );
  assert.deepEqual(decision, {
    blocked: false,
    mode: 'off',
    retryAfterSeconds: 0,
  });
  assert.deepEqual(limiter.getStats(), { mode: 'off' });
  assert.deepEqual(events, []);
});

test('every active-mode field and policy override is strictly validated', () => {
  for (const env of [
    { AUTH_RATE_LIMIT_MODE: 'yes' },
    activeEnv({ AUTH_RATE_LIMIT_VERSION: 'v2' }),
    activeEnv({ AUTH_RATE_LIMIT_SECRET: 'too-short' }),
    activeEnv({ AUTH_RATE_LIMIT_SECRET_ID: '../unsafe' }),
    activeEnv({ AUTH_RATE_LIMIT_STORE: 'cache' }),
    activeEnv({ AUTH_RATE_LIMIT_LOCAL_MAX_KEYS: '015' }),
    activeEnv({ AUTH_RATE_LIMIT_SHARDS: '63' }),
    activeEnv({ AUTH_RATE_LIMIT_POLICY_JSON: '{invalid' }),
    activeEnv({
      AUTH_RATE_LIMIT_POLICY_JSON: JSON.stringify({ unknown_surface: {} }),
    }),
    activeEnv({
      AUTH_RATE_LIMIT_POLICY_JSON: JSON.stringify({
        [SURFACES.AUTH_LOGIN]: { account: { limit: 0 } },
      }),
    }),
    activeEnv({ AUTH_RATE_LIMIT_STORE: 'redis' }),
    activeEnv({
      AUTH_RATE_LIMIT_REDIS_URL: 'https://redis.invalid',
      AUTH_RATE_LIMIT_STORE: 'redis',
    }),
  ]) {
    assert.throws(
      () => validateAuthRateLimitConfiguration(env),
      { code: 'AUTH_RATE_LIMIT_CONFIGURATION_INVALID' },
    );
  }
});

test('report records safe would-deny decisions without enforcement or raw inputs', async () => {
  const events = [];
  const secret = 'report-secret-material-that-is-at-least-thirty-two-bytes';
  const limiter = createAuthRateLimiter({
    env: activeEnv({
      AUTH_RATE_LIMIT_MODE: 'report',
      AUTH_RATE_LIMIT_POLICY_JSON: loginPolicy({ accountLimit: 1 }),
      AUTH_RATE_LIMIT_SECRET: secret,
    }),
    logger: (event) => events.push(event),
  });
  const body = { email: 'Person+private@example.test', password: 'raw-password' };
  const first = await limiter.consumeRequest(SURFACES.AUTH_LOGIN, request(body, {
    headers: { 'x-forwarded-for': '203.0.113.51' },
  }));
  const second = await limiter.consumeRequest(SURFACES.AUTH_LOGIN, request(body, {
    headers: { 'x-forwarded-for': '198.51.100.19' },
  }));
  assert.equal(first.wouldBlock, false);
  assert.equal(second.wouldBlock, true);
  assert.equal(second.blocked, false);
  assert.equal(events.at(-1).outcome, 'would_deny');
  const evidence = JSON.stringify(events);
  for (const forbidden of [
    body.email,
    body.password,
    secret,
    '203.0.113.51',
    '198.51.100.19',
  ]) {
    assert.equal(evidence.includes(forbidden), false, forbidden);
  }
  assert.match(events[0].dimensions[0].bucket, /^v1\.[0-9a-z]+$/u);
});

test('enforce has an exact fixed-window boundary and stable Retry-After', async () => {
  let now = 1_000;
  const limiter = createAuthRateLimiter({
    clock: () => now,
    env: activeEnv({
      AUTH_RATE_LIMIT_POLICY_JSON: loginPolicy({ accountLimit: 2 }),
    }),
    logger: () => {},
  });
  const input = request({ email: 'clock@example.test', password: 'ignored' });
  assert.equal((await limiter.consumeRequest(SURFACES.AUTH_LOGIN, input)).blocked, false);
  assert.equal((await limiter.consumeRequest(SURFACES.AUTH_LOGIN, input)).blocked, false);
  const denied = await limiter.consumeRequest(SURFACES.AUTH_LOGIN, input);
  assert.equal(denied.blocked, true);
  assert.equal(denied.retryAfterSeconds, 5);
  now = 5_999;
  const boundaryMinusOne = await limiter.consumeRequest(SURFACES.AUTH_LOGIN, input);
  assert.equal(boundaryMinusOne.blocked, true);
  assert.equal(boundaryMinusOne.retryAfterSeconds, 1);
  now = 6_000;
  assert.equal((await limiter.consumeRequest(SURFACES.AUTH_LOGIN, input)).blocked, false);
});

test('concurrent local attempts cannot exceed the documented atomic budget', async () => {
  const limiter = createAuthRateLimiter({
    env: activeEnv({
      AUTH_RATE_LIMIT_POLICY_JSON: loginPolicy({ accountLimit: 5 }),
    }),
    logger: () => {},
  });
  const input = request({ email: 'concurrent@example.test', password: 'ignored' });
  const decisions = await Promise.all(
    Array.from({ length: 20 }, () =>
      limiter.consumeRequest(SURFACES.AUTH_LOGIN, input)),
  );
  assert.equal(decisions.filter((decision) => !decision.blocked).length, 5);
  assert.equal(decisions.filter((decision) => decision.blocked).length, 15);
});

test('canonicalization, sharded keys and local overflow keep attacker cardinality bounded', async () => {
  assert.equal(
    _private.boundedCanonical('not-an-email', { kind: 'email' }),
    _private.boundedCanonical('x'.repeat(10_000), { kind: 'email' }),
  );
  const config = _private.authRateLimitConfiguration(activeEnv());
  const canonical = _private.boundedCanonical('private@example.test', { kind: 'email' });
  const bucket = _private.subjectBucket(
    config,
    SURFACES.AUTH_LOGIN,
    'account',
    canonical,
  );
  const key = _private.storageKey(config, SURFACES.AUTH_LOGIN, 'account', bucket);
  assert.equal(key.includes('private@example.test'), false);
  assert.equal(key.includes(config.secret), false);
  assert.match(key, /:auth_login:account:\d+$/u);

  let now = 0;
  const store = new _private.LocalFixedWindowStore({ clock: () => now, maxKeys: 16 });
  for (let index = 0; index < 1000; index += 1) {
    await store.consume(`synthetic:${index}`, 1000);
  }
  assert.equal(store.getStats().keys <= 16, true);
  now = 1000;
  store.cleanup();
  assert.equal(store.getStats().keys, 0);
});

test('oversized raw subjects are rejected before normalization or UTF-8 byte scans', (t) => {
  const originalNormalize = String.prototype.normalize;
  const originalByteLength = Buffer.byteLength;
  let normalizeCalls = 0;
  let byteLengthCalls = 0;
  t.mock.method(String.prototype, 'normalize', function normalize(...args) {
    normalizeCalls += 1;
    return originalNormalize.call(this, ...args);
  });
  t.mock.method(Buffer, 'byteLength', (...args) => {
    byteLengthCalls += 1;
    return originalByteLength(...args);
  });

  const asciiSixMb = 'A'.repeat(6_000_000);
  for (const kind of ['email', 'username', 'token', 'peer']) {
    assert.equal(
      _private.boundedCanonical(asciiSixMb, { kind }),
      `${kind}:invalid`,
    );
  }
  assert.equal(
    _private.boundedCanonical('Ａ'.repeat(2_000_000), { kind: 'email' }),
    'email:invalid',
  );
  assert.equal(normalizeCalls, 0);
  assert.equal(byteLengthCalls, 0);
});

test('raw pre-bounds preserve adjacent valid and invalid canonical cases', () => {
  const token = 'A'.repeat(43);
  assert.equal(
    _private.boundedCanonical(' Ａ@example.test ', { kind: 'email' }),
    'email:valid:a@example.test',
  );
  assert.equal(
    _private.boundedCanonical(' Ｏperator ', { kind: 'username' }),
    'username:valid:Operator',
  );
  assert.equal(
    _private.boundedCanonical(`${' '.repeat(85)}${token}`, { kind: 'token' }),
    `token:valid:${token}`,
  );
  assert.equal(
    _private.boundedCanonical(`${' '.repeat(86)}${token}`, { kind: 'token' }),
    'token:invalid',
  );
  assert.equal(
    _private.boundedCanonical(' ::FFFF:127.0.0.1 ', { kind: 'peer' }),
    'peer:valid:::ffff:127.0.0.1',
  );
  assert.equal(
    _private.boundedCanonical('not-an-email', { kind: 'email' }),
    'email:invalid',
  );
  assert.equal(
    _private.boundedCanonical('operator\u0000name', { kind: 'username' }),
    'username:invalid',
  );
  assert.equal(
    _private.boundedCanonical(token.slice(1), { kind: 'token' }),
    'token:invalid',
  );
  assert.equal(
    _private.boundedCanonical('not-a-peer', { kind: 'peer' }),
    'peer:invalid',
  );
});

test('Redis outage degrades to bounded local enforcement instead of unlimited access', async () => {
  const events = [];
  const clients = [];
  const limiter = createAuthRateLimiter({
    env: activeEnv({
      AUTH_RATE_LIMIT_POLICY_JSON: loginPolicy({ accountLimit: 1 }),
      AUTH_RATE_LIMIT_REDIS_BACKOFF_MS: '100',
      AUTH_RATE_LIMIT_REDIS_TIMEOUT_MS: '25',
      AUTH_RATE_LIMIT_REDIS_URL: 'redis://127.0.0.1:6390',
      AUTH_RATE_LIMIT_STORE: 'redis',
    }),
    logger: (event) => events.push(event),
    redisClientFactory: () => {
      const client = {
        async connect() {},
        async destroy() {},
        async eval() {
          throw new Error('simulated secret-free Redis outage');
        },
        on() {},
      };
      clients.push(client);
      return client;
    },
  });
  const input = request({ email: 'degraded@example.test', password: 'ignored' });
  assert.equal((await limiter.consumeRequest(SURFACES.AUTH_LOGIN, input)).blocked, false);
  const denied = await limiter.consumeRequest(SURFACES.AUTH_LOGIN, input);
  assert.equal(denied.blocked, true);
  assert.equal(denied.degraded, true);
  assert.equal(events.every((event) => event.degraded), true);
  assert.equal(
    events.flatMap((event) => event.dimensions).every(
      (dimension) => dimension.store === 'local_degraded',
    ),
    true,
  );
  assert.equal(clients.length >= 1, true);
  await limiter.close();
});

test('Redis uses one atomic Lua reservation per dimension and restart grants one fresh budget', async () => {
  function memoryRedisFactory(state, observed) {
    return () => ({
      async connect() {},
      async destroy() {},
      async eval(script, { arguments: [windowMs], keys: [key] }) {
        assert.equal(script, _private.REDIS_SCRIPT);
        observed.push(key);
        const count = (state.get(key) || 0) + 1;
        state.set(key, count);
        return [count, Number(windowMs)];
      },
      on() {},
    });
  }

  const env = activeEnv({
    AUTH_RATE_LIMIT_POLICY_JSON: loginPolicy({ accountLimit: 5 }),
    AUTH_RATE_LIMIT_REDIS_URL: 'redis://memory.test',
    AUTH_RATE_LIMIT_STORE: 'redis',
  });
  const observed = [];
  const state = new Map();
  const limiter = createAuthRateLimiter({
    env,
    logger: () => {},
    redisClientFactory: memoryRedisFactory(state, observed),
  });
  const input = request({ email: 'redis-private@example.test', password: 'ignored' });
  const decisions = await Promise.all(
    Array.from({ length: 20 }, () =>
      limiter.consumeRequest(SURFACES.AUTH_LOGIN, input)),
  );
  assert.equal(decisions.filter((decision) => !decision.blocked).length, 5);
  assert.equal(decisions.filter((decision) => decision.blocked).length, 15);
  assert.equal(observed.length, 60);
  assert.equal(observed.every((key) => key.startsWith(
    'setly:security:auth-rate-limit:v1:test-v1:',
  )), true);
  assert.equal(observed.some((key) => key.includes('redis-private@example.test')), false);
  await limiter.close();

  const restarted = createAuthRateLimiter({
    env,
    logger: () => {},
    redisClientFactory: memoryRedisFactory(new Map(), []),
  });
  assert.equal((await restarted.consumeRequest(SURFACES.AUTH_LOGIN, input)).blocked, false);
  await restarted.close();
});

test('local restart and multi-process limits are explicit and reproducible', async () => {
  const env = activeEnv({
    AUTH_RATE_LIMIT_POLICY_JSON: loginPolicy({ accountLimit: 1 }),
  });
  const input = request({ email: 'process@example.test', password: 'ignored' });
  const processA = createAuthRateLimiter({ env, logger: () => {} });
  const processB = createAuthRateLimiter({ env, logger: () => {} });
  assert.equal((await processA.consumeRequest(SURFACES.AUTH_LOGIN, input)).blocked, false);
  assert.equal((await processA.consumeRequest(SURFACES.AUTH_LOGIN, input)).blocked, true);
  assert.equal((await processB.consumeRequest(SURFACES.AUTH_LOGIN, input)).blocked, false);
  const restartedA = createAuthRateLimiter({ env, logger: () => {} });
  assert.equal((await restartedA.consumeRequest(SURFACES.AUTH_LOGIN, input)).blocked, false);
});

test('forwarding headers cannot choose the exact remote-peer bucket', async () => {
  const limiter = createAuthRateLimiter({
    env: activeEnv({
      AUTH_RATE_LIMIT_POLICY_JSON: loginPolicy({
        accountLimit: 1000,
        classLimit: 1000,
        peerLimit: 1,
      }),
    }),
    logger: () => {},
  });
  const first = request(
    { email: 'first@example.test', password: 'ignored' },
    { headers: { 'x-forwarded-for': '203.0.113.1', 'x-real-ip': '203.0.113.2' } },
  );
  const second = request(
    { email: 'second@example.test', password: 'ignored' },
    { headers: { 'x-forwarded-for': '198.51.100.1', 'x-real-ip': '198.51.100.2' } },
  );
  assert.equal((await limiter.consumeRequest(SURFACES.AUTH_LOGIN, first)).blocked, false);
  assert.equal((await limiter.consumeRequest(SURFACES.AUTH_LOGIN, second)).blocked, true);
});
