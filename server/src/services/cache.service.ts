const { createClient } = require('redis');

type Loader<T> = () => Promise<T>;

interface CacheOptions {
  ttlSeconds?: number;
}

interface CacheStats {
  bypass: number;
  error: number;
  hit: number;
  invalidate: number;
  miss: number;
  write: number;
}

const DEFAULT_TTL_SECONDS = Number(process.env.REDIS_CACHE_TTL_SECONDS || 300);
const ERROR_BACKOFF_MS = Number(process.env.REDIS_CACHE_ERROR_BACKOFF_MS || 30000);
const CONNECT_TIMEOUT_MS = Number(process.env.REDIS_CACHE_CONNECT_TIMEOUT_MS || 500);
const KEY_PREFIX = process.env.REDIS_CACHE_PREFIX || 'padel-crm';
const CACHE_NAMESPACE =
  process.env.REDIS_CACHE_NAMESPACE ||
  `boot:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`;

let clientPromise: Promise<unknown> | null = null;
let disabledUntil = 0;
const scopeVersions = new Map<string, number>();
const stats: CacheStats = {
  bypass: 0,
  error: 0,
  hit: 0,
  invalidate: 0,
  miss: 0,
  write: 0,
};

function isDebugEnabled() {
  return ['1', 'true', 'yes'].includes(
    String(process.env.REDIS_CACHE_DEBUG || '').toLowerCase(),
  );
}

function debug(message: string, meta: Record<string, unknown> = {}) {
  if (!isDebugEnabled()) return;
  console.debug(`[cache] ${message}`, meta);
}

function getRedisUrl() {
  if (process.env.REDIS_URL) return process.env.REDIS_URL;
  if (['1', 'true', 'yes'].includes(
    String(process.env.REDIS_CACHE_ENABLED || '').toLowerCase(),
  )) {
    return 'redis://127.0.0.1:6379';
  }
  return null;
}

function isConfigured() {
  return Boolean(getRedisUrl());
}

function getScopeVersion(key: string) {
  let version = 0;
  scopeVersions.forEach((scopeVersion, prefix) => {
    if (key.startsWith(prefix)) {
      version = Math.max(version, scopeVersion);
    }
  });
  return version;
}

function bumpScopeVersion(prefix: string) {
  scopeVersions.set(prefix, (scopeVersions.get(prefix) || 0) + 1);
  debug('bump-scope', { prefix, version: scopeVersions.get(prefix) });
}

function namespacedKey(key: string) {
  return `${KEY_PREFIX}:${CACHE_NAMESPACE}:v${getScopeVersion(key)}:${key}`;
}

function namespacedPrefix(prefix: string) {
  return `${KEY_PREFIX}:${CACHE_NAMESPACE}:v*:${prefix}`;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;

  return `{${Object.keys(value as Record<string, unknown>)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`)
    .join(',')}}`;
}

function cacheKey(scope: string, parts: Record<string, unknown> = {}) {
  return `${scope}:${stableStringify(parts)}`;
}

function markRedisError(error: unknown, key = '') {
  stats.error += 1;
  disabledUntil = Date.now() + ERROR_BACKOFF_MS;
  const message = error instanceof Error ? error.message : String(error);
  debug('error', { key, message });
}

function timeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(message)), ms);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeoutId) clearTimeout(timeoutId);
  });
}

async function destroyClient(client: unknown) {
  try {
    const maybeClient = client as {
      destroy?: () => Promise<void> | void;
      disconnect?: () => Promise<void> | void;
    };
    if (typeof maybeClient.destroy === 'function') {
      await maybeClient.destroy();
      return;
    }
    if (typeof maybeClient.disconnect === 'function') {
      await maybeClient.disconnect();
    }
  } catch {
    // A failed fallback cleanup must not block the DB path.
  }
}

async function getClient() {
  const url = getRedisUrl();
  if (!url) return null;
  if (Date.now() < disabledUntil) return null;

  if (!clientPromise) {
    const client = createClient({
      socket: {
        connectTimeout: CONNECT_TIMEOUT_MS,
        reconnectStrategy: false,
      },
      url,
    });
    client.on('error', (error: Error) => markRedisError(error));
    clientPromise = (async () => {
      try {
        await timeout(
          client.connect(),
          CONNECT_TIMEOUT_MS,
          `Redis connect timeout after ${CONNECT_TIMEOUT_MS}ms`,
        );
        debug('connected');
        return client;
      } catch (error) {
        clientPromise = null;
        markRedisError(error);
        await destroyClient(client);
        return null;
      }
    })();
  }

  return clientPromise;
}

async function getJson<T>(key: string): Promise<T | null> {
  const client = await getClient();
  if (!client) {
    stats.bypass += 1;
    return null;
  }

  const fullKey = namespacedKey(key);
  try {
    const cached = await (client as { get: (key: string) => Promise<string | null> }).get(fullKey);
    if (cached === null) {
      stats.miss += 1;
      debug('miss', { key });
      return null;
    }

    stats.hit += 1;
    debug('hit', { key });
    return JSON.parse(cached) as T;
  } catch (error) {
    markRedisError(error, key);
    return null;
  }
}

async function setJson<T>(
  key: string,
  value: T,
  options: CacheOptions = {},
): Promise<void> {
  const client = await getClient();
  if (!client) return;

  const ttlSeconds = options.ttlSeconds ?? DEFAULT_TTL_SECONDS;
  try {
    await (client as {
      set: (key: string, value: string, options: { EX: number }) => Promise<unknown>;
    }).set(namespacedKey(key), JSON.stringify(value), { EX: ttlSeconds });
    stats.write += 1;
    debug('write', { key, ttlSeconds });
  } catch (error) {
    markRedisError(error, key);
  }
}

async function rememberJson<T>(
  key: string,
  loader: Loader<T>,
  options: CacheOptions = {},
): Promise<T> {
  const cached = await getJson<T>(key);
  if (cached !== null) return cached;

  const value = await loader();
  await setJson(key, value, options);
  return value;
}

async function deleteKeys(keys: string[]) {
  const client = await getClient();
  if (keys.length === 0) return;
  if (!client) {
    keys.forEach(bumpScopeVersion);
    return;
  }

  try {
    await (client as { del: (keys: string[]) => Promise<number> }).del(
      keys.map(namespacedKey),
    );
    stats.invalidate += keys.length;
    debug('delete', { keys });
  } catch (error) {
    markRedisError(error);
    keys.forEach(bumpScopeVersion);
  }
}

async function deleteByPrefix(prefix: string) {
  const client = await getClient();
  if (!client) {
    bumpScopeVersion(prefix);
    return;
  }

  const fullPrefix = namespacedPrefix(prefix);
  const keys: string[] = [];
  try {
    for await (const key of (client as {
      scanIterator: (
        options: { COUNT: number; MATCH: string },
      ) => AsyncIterable<string | string[]>;
    }).scanIterator({ COUNT: 100, MATCH: `${fullPrefix}*` })) {
      if (Array.isArray(key)) keys.push(...key);
      else keys.push(key);
    }
    if (keys.length > 0) {
      await (client as { del: (keys: string[]) => Promise<number> }).del(keys);
      stats.invalidate += keys.length;
    }
    debug('delete-prefix', { count: keys.length, prefix });
  } catch (error) {
    markRedisError(error, prefix);
    bumpScopeVersion(prefix);
  }
}

function getStats() {
  return { ...stats };
}

module.exports = {
  cacheKey,
  deleteByPrefix,
  deleteKeys,
  getJson,
  getStats,
  isConfigured,
  rememberJson,
  setJson,
  stableStringify,
};
