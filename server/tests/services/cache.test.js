const assert = require('node:assert/strict');
const test = require('node:test');
const {
  __testing,
  buildTenantCachePrefix,
  cacheKey,
  deleteTenantByPrefix,
  getStats,
  rememberTenantJson,
  rememberJson,
  stableStringify,
  tenantCacheKey,
} = require('../../src/services/cache.service');

function tenantContext({ clubId = null, membershipId = 21, organizationId, scope }) {
  return Object.freeze({ clubId, membershipId, organizationId, scope });
}

function createMemoryRedis() {
  const values = new Map();
  const messages = [];
  return {
    messages,
    values,
    async get(key) {
      return values.get(key) || null;
    },
    async set(key, value) {
      values.set(key, value);
    },
    async del(keys) {
      let removed = 0;
      for (const key of keys) removed += values.delete(key) ? 1 : 0;
      return removed;
    },
    async *scanIterator({ MATCH }) {
      const prefix = MATCH.replace(/\*+$/, '');
      for (const key of values.keys()) {
        if (key.startsWith(prefix)) yield key;
      }
    },
    async publish(channel, message) {
      messages.push({ channel, message: JSON.parse(message) });
      return 1;
    },
  };
}

test('builds stable cache keys for equivalent query objects', () => {
  assert.equal(
    stableStringify({ status: 'active', page: 1 }),
    stableStringify({ page: 1, status: 'active' }),
  );
  assert.equal(
    cacheKey('references:client-sources:list', { status: 'active' }),
    'references:client-sources:list:{"status":"active"}',
  );
});

test('falls back to loader when Redis is not configured', async () => {
  const previousUrl = process.env.REDIS_URL;
  const previousEnabled = process.env.REDIS_CACHE_ENABLED;
  delete process.env.REDIS_URL;
  process.env.REDIS_CACHE_ENABLED = 'false';

  const before = getStats();
  const value = await rememberJson('test:fallback', async () => ({ ok: true }));
  const after = getStats();

  if (previousUrl === undefined) delete process.env.REDIS_URL;
  else process.env.REDIS_URL = previousUrl;
  if (previousEnabled === undefined) delete process.env.REDIS_CACHE_ENABLED;
  else process.env.REDIS_CACHE_ENABLED = previousEnabled;

  assert.deepEqual(value, { ok: true });
  assert.equal(after.bypass, before.bypass + 1);
});

test('falls back quickly when configured Redis is unavailable', { timeout: 1500 }, async () => {
  const previousUrl = process.env.REDIS_URL;
  const previousEnabled = process.env.REDIS_CACHE_ENABLED;
  const previousTimeout = process.env.REDIS_CACHE_CONNECT_TIMEOUT_MS;
  process.env.REDIS_URL = 'redis://127.0.0.1:6390';
  process.env.REDIS_CACHE_ENABLED = 'true';
  process.env.REDIS_CACHE_CONNECT_TIMEOUT_MS = '100';

  const startedAt = Date.now();
  const value = await rememberJson('test:unavailable', async () => ({ ok: true }));
  const elapsedMs = Date.now() - startedAt;

  if (previousUrl === undefined) delete process.env.REDIS_URL;
  else process.env.REDIS_URL = previousUrl;
  if (previousEnabled === undefined) delete process.env.REDIS_CACHE_ENABLED;
  else process.env.REDIS_CACHE_ENABLED = previousEnabled;
  if (previousTimeout === undefined) delete process.env.REDIS_CACHE_CONNECT_TIMEOUT_MS;
  else process.env.REDIS_CACHE_CONNECT_TIMEOUT_MS = previousTimeout;

  assert.deepEqual(value, { ok: true });
  assert.equal(elapsedMs < 1000, true);
});

test('builds deployment + organization + explicit scope cache namespaces', () => {
  const previousDeployment = process.env.REDIS_CACHE_DEPLOYMENT;
  process.env.REDIS_CACHE_DEPLOYMENT = 'test-blue';
  try {
    const organization = tenantContext({ organizationId: 11, scope: 'organization' });
    const membership = tenantContext({ organizationId: 11, membershipId: 31, scope: 'membership' });
    const club = tenantContext({ clubId: 21, organizationId: 11, scope: 'club' });
    assert.equal(
      buildTenantCachePrefix({ domain: 'references', scope: 'organization', tenant: organization }),
      'setly:test-blue:11:org:references',
    );
    assert.equal(
      buildTenantCachePrefix({ domain: 'onboarding', scope: 'membership', tenant: membership }),
      'setly:test-blue:11:membership:31:onboarding',
    );
    assert.equal(
      tenantCacheKey({ domain: 'catalog', scope: 'club', suffix: 'rules:list', tenant: club }, { status: 'active' }),
      'setly:test-blue:11:21:catalog:rules:list:{"status":"active"}',
    );
  } finally {
    if (previousDeployment === undefined) delete process.env.REDIS_CACHE_DEPLOYMENT;
    else process.env.REDIS_CACHE_DEPLOYMENT = previousDeployment;
  }
});

test('allows only explicit global cache domains', () => {
  assert.equal(
    buildTenantCachePrefix({ domain: 'platform', scope: 'global' }).includes(':global:global:platform'),
    true,
  );
  assert.throws(
    () => buildTenantCachePrefix({ domain: 'clients', scope: 'global' }),
    (error) => error.code === 'TENANT_CACHE_GLOBAL_NOT_ALLOWLISTED',
  );
});

test('tenant Redis reads and invalidations never cross organization/club boundaries', async () => {
  const previous = {
    cache: process.env.TENANT_CACHE_REALTIME_ENABLED,
    context: process.env.TENANT_CONTEXT_ENABLED,
    deployment: process.env.REDIS_CACHE_DEPLOYMENT,
    nodeEnv: process.env.NODE_ENV,
    redisUrl: process.env.REDIS_URL,
  };
  process.env.NODE_ENV = 'test';
  process.env.TENANT_CONTEXT_ENABLED = 'true';
  process.env.TENANT_CACHE_REALTIME_ENABLED = 'true';
  process.env.REDIS_CACHE_DEPLOYMENT = 'isolation-test';
  process.env.REDIS_URL = 'redis://memory';
  const redis = createMemoryRedis();
  __testing.setClientForTests(redis);
  try {
    const tenantA = tenantContext({ clubId: 21, organizationId: 11, scope: 'club' });
    const tenantB = tenantContext({ clubId: 21, organizationId: 12, scope: 'club' });
    const targetA = { domain: 'catalog', scope: 'club', suffix: 'rules:list', tenant: tenantA };
    const targetB = { domain: 'catalog', scope: 'club', suffix: 'rules:list', tenant: tenantB };
    assert.deepEqual(
      await rememberTenantJson(targetA, { entityId: 42 }, async () => ({ tenant: 'a' })),
      { tenant: 'a' },
    );
    assert.deepEqual(
      await rememberTenantJson(targetB, { entityId: 42 }, async () => ({ tenant: 'b' })),
      { tenant: 'b' },
    );

    await deleteTenantByPrefix({
      domain: 'catalog',
      scope: 'club',
      suffix: 'rules',
      tenant: tenantA,
    });

    assert.deepEqual(
      await rememberTenantJson(targetA, { entityId: 42 }, async () => ({ tenant: 'a-new' })),
      { tenant: 'a-new' },
    );
    assert.deepEqual(
      await rememberTenantJson(targetB, { entityId: 42 }, async () => {
        throw new Error('tenant B cache should remain warm');
      }),
      { tenant: 'b' },
    );
    assert.equal(redis.messages.length, 1);
    assert.deepEqual(
      {
        clubId: redis.messages[0].message.clubId,
        organizationId: redis.messages[0].message.organizationId,
        scope: redis.messages[0].message.scope,
      },
      { clubId: 21, organizationId: 11, scope: 'club' },
    );
  } finally {
    __testing.resetForTests();
    for (const [key, value] of Object.entries(previous)) {
      const envName = {
        cache: 'TENANT_CACHE_REALTIME_ENABLED',
        context: 'TENANT_CONTEXT_ENABLED',
        deployment: 'REDIS_CACHE_DEPLOYMENT',
        nodeEnv: 'NODE_ENV',
        redisUrl: 'REDIS_URL',
      }[key];
      if (value === undefined) delete process.env[envName];
      else process.env[envName] = value;
    }
  }
});
