const { createClient } = require('redis');
const {
  isTenantCacheRealtimeEnabled,
} = require('../tenant-context/capabilities');

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

type TenantCacheScope = 'global' | 'membership' | 'organization' | 'club';

interface ImmutableTenantContext {
  clubId: number | null;
  membershipId: number | null;
  organizationId: number | null;
  scope: TenantCacheScope;
}

interface TenantCacheTarget {
  domain: string;
  scope: TenantCacheScope;
  suffix?: string;
  tenant?: ImmutableTenantContext | null;
}

const DEFAULT_TTL_SECONDS = Number(process.env.REDIS_CACHE_TTL_SECONDS || 300);
const ERROR_BACKOFF_MS = Number(process.env.REDIS_CACHE_ERROR_BACKOFF_MS || 30000);
const CONNECT_TIMEOUT_MS = Number(process.env.REDIS_CACHE_CONNECT_TIMEOUT_MS || 500);
const LEGACY_KEY_PREFIX = process.env.REDIS_CACHE_PREFIX || 'padel-crm';
const CACHE_NAMESPACE =
  process.env.REDIS_CACHE_NAMESPACE ||
  `boot:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`;
const GLOBAL_CACHE_DOMAIN_ALLOWLIST = new Set(['platform']);

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

function getTenantDeploymentNamespace() {
  const value =
    process.env.REDIS_CACHE_DEPLOYMENT ||
    process.env.DEPLOYMENT_ENV ||
    process.env.NODE_ENV ||
    'development';
  return String(value).trim().replace(/[^a-zA-Z0-9._-]/g, '-') || 'development';
}

function getTenantKeyPrefix() {
  const configured = String(process.env.REDIS_CACHE_PREFIX || 'setly').trim();
  return configured === 'padel-crm' ? 'setly' : configured || 'setly';
}

function isTenantLogicalKey(key: string) {
  return key.startsWith(
    `${getTenantKeyPrefix()}:${getTenantDeploymentNamespace()}:`,
  );
}

function namespacedKey(key: string) {
  if (isTenantCacheRealtimeEnabled() && isTenantLogicalKey(key)) {
    return `${key}:v${getScopeVersion(key)}:${CACHE_NAMESPACE}`;
  }
  return `${LEGACY_KEY_PREFIX}:${CACHE_NAMESPACE}:v${getScopeVersion(key)}:${key}`;
}

function namespacedPrefix(prefix: string) {
  if (isTenantCacheRealtimeEnabled() && isTenantLogicalKey(prefix)) {
    return prefix;
  }
  return `${LEGACY_KEY_PREFIX}:${CACHE_NAMESPACE}:v*:${prefix}`;
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

function tenantCacheError(message: string, code: string) {
  const error = new Error(message) as Error & { code?: string };
  error.code = code;
  return error;
}

function assertPositiveId(value: unknown, label: string) {
  const normalized = Number(value);
  if (!Number.isSafeInteger(normalized) || normalized <= 0) {
    throw tenantCacheError(
      `Validated tenant ${label} is required for cache scope`,
      'TENANT_CACHE_CONTEXT_REQUIRED',
    );
  }
  return normalized;
}

function buildTenantCachePrefix(target: TenantCacheTarget) {
  const domain = String(target.domain || '').trim();
  if (!domain || !/^[a-z][a-z0-9_-]*$/i.test(domain)) {
    throw tenantCacheError('Tenant cache domain is invalid', 'TENANT_CACHE_DOMAIN_INVALID');
  }

  const root = `${getTenantKeyPrefix()}:${getTenantDeploymentNamespace()}`;
  if (target.scope === 'global') {
    if (!GLOBAL_CACHE_DOMAIN_ALLOWLIST.has(domain)) {
      throw tenantCacheError(
        `Global cache domain is not allowlisted: ${domain}`,
        'TENANT_CACHE_GLOBAL_NOT_ALLOWLISTED',
      );
    }
    return `${root}:global:global:${domain}`;
  }

  const tenant = target.tenant;
  if (!tenant || !Object.isFrozen(tenant)) {
    throw tenantCacheError(
      'Validated immutable tenant context is required for cache scope',
      'TENANT_CACHE_CONTEXT_REQUIRED',
    );
  }
  const organizationId = assertPositiveId(tenant.organizationId, 'organizationId');
  if (target.scope === 'organization') {
    return `${root}:${organizationId}:org:${domain}`;
  }
  if (target.scope === 'membership') {
    const membershipId = assertPositiveId(tenant.membershipId, 'membershipId');
    return `${root}:${organizationId}:membership:${membershipId}:${domain}`;
  }
  if (target.scope === 'club') {
    if (tenant.scope !== 'club') {
      throw tenantCacheError(
        'Club cache requires a validated club tenant context',
        'TENANT_CACHE_CONTEXT_REQUIRED',
      );
    }
    const clubId = assertPositiveId(tenant.clubId, 'clubId');
    return `${root}:${organizationId}:${clubId}:${domain}`;
  }
  throw tenantCacheError(
    `Unsupported tenant cache scope: ${target.scope}`,
    'TENANT_CACHE_SCOPE_INVALID',
  );
}

function tenantCacheKey(
  target: TenantCacheTarget,
  parts: Record<string, unknown> = {},
) {
  const prefix = buildTenantCachePrefix(target);
  const suffix = String(target.suffix || '').trim().replace(/^:+|:+$/g, '');
  return `${prefix}${suffix ? `:${suffix}` : ''}:${stableStringify(parts)}`;
}

function tenantCacheInvalidationPrefix(target: TenantCacheTarget) {
  const prefix = buildTenantCachePrefix(target);
  const suffix = String(target.suffix || '').trim().replace(/^:+|:+$/g, '');
  return `${prefix}${suffix ? `:${suffix}` : ''}:`;
}

function deriveClubCacheContext(
  tenant: ImmutableTenantContext,
  clubId: number,
) {
  if (!tenant || !Object.isFrozen(tenant)) {
    throw tenantCacheError(
      'Validated immutable tenant context is required for derived cache context',
      'TENANT_CACHE_CONTEXT_REQUIRED',
    );
  }
  return Object.freeze({
    ...tenant,
    clubId: assertPositiveId(clubId, 'clubId'),
    organizationId: assertPositiveId(tenant.organizationId, 'organizationId'),
    scope: 'club' as const,
  });
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

async function rememberTenantJson<T>(
  target: TenantCacheTarget,
  parts: Record<string, unknown>,
  loader: Loader<T>,
  options: CacheOptions = {},
): Promise<T> {
  if (!isTenantCacheRealtimeEnabled()) {
    throw tenantCacheError(
      'Tenant cache API requires TENANT_CACHE_REALTIME_ENABLED',
      'TENANT_CACHE_CAPABILITY_DISABLED',
    );
  }
  return rememberJson(tenantCacheKey(target, parts), loader, options);
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

function createTenantInvalidationEnvelope(target: TenantCacheTarget) {
  const prefix = tenantCacheInvalidationPrefix(target);
  const tenant = target.tenant || null;
  return Object.freeze({
    clubId: target.scope === 'club' ? tenant?.clubId || null : null,
    domain: target.domain,
    membershipId: target.scope === 'membership' ? tenant?.membershipId || null : null,
    organizationId: target.scope === 'global' ? null : tenant?.organizationId || null,
    prefix,
    scope: target.scope,
  });
}

async function publishTenantInvalidation(
  envelope: ReturnType<typeof createTenantInvalidationEnvelope>,
) {
  const client = await getClient();
  if (!client || typeof (client as { publish?: unknown }).publish !== 'function') return;
  const channel = `${getTenantKeyPrefix()}:${getTenantDeploymentNamespace()}:cache-invalidation`;
  try {
    await (client as { publish: (channel: string, message: string) => Promise<unknown> })
      .publish(channel, JSON.stringify(envelope));
  } catch (error) {
    markRedisError(error, channel);
  }
}

async function deleteTenantByPrefix(target: TenantCacheTarget) {
  if (!isTenantCacheRealtimeEnabled()) {
    throw tenantCacheError(
      'Tenant cache API requires TENANT_CACHE_REALTIME_ENABLED',
      'TENANT_CACHE_CAPABILITY_DISABLED',
    );
  }
  const envelope = createTenantInvalidationEnvelope(target);
  await deleteByPrefix(envelope.prefix);
  await publishTenantInvalidation(envelope);
  return envelope;
}

function getStats() {
  return { ...stats };
}

function setClientForTests(client: unknown) {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error('Cache test client can only be installed in NODE_ENV=test');
  }
  clientPromise = Promise.resolve(client);
  disabledUntil = 0;
  scopeVersions.clear();
}

function resetForTests() {
  if (process.env.NODE_ENV !== 'test') return;
  clientPromise = null;
  disabledUntil = 0;
  scopeVersions.clear();
}

module.exports = {
  __testing: { resetForTests, setClientForTests },
  GLOBAL_CACHE_DOMAIN_ALLOWLIST,
  buildTenantCachePrefix,
  cacheKey,
  createTenantInvalidationEnvelope,
  deriveClubCacheContext,
  deleteByPrefix,
  deleteKeys,
  deleteTenantByPrefix,
  getJson,
  getStats,
  getTenantDeploymentNamespace,
  getTenantKeyPrefix,
  isConfigured,
  isTenantIsolationEnabled: isTenantCacheRealtimeEnabled,
  rememberJson,
  rememberTenantJson,
  setJson,
  stableStringify,
  tenantCacheInvalidationPrefix,
  tenantCacheKey,
};
