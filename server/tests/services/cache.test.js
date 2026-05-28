const assert = require('node:assert/strict');
const test = require('node:test');
const {
  cacheKey,
  getStats,
  rememberJson,
  stableStringify,
} = require('../../src/services/cache.service');

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
