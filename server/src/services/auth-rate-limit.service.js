'use strict';

const crypto = require('crypto');
const { createClient } = require('redis');

const CONTRACT_VERSION = 'v1';
const MODES = new Set(['off', 'report', 'enforce']);
const STORES = new Set(['local', 'redis']);
const REDIS_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
local ttl = redis.call('PTTL', KEYS[1])
if count == 1 or ttl < 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
return { count, ttl }
`;

const SURFACES = Object.freeze({
  ACTIVATION_CONSUME: 'installation_activation_consume',
  ACTIVATION_STATUS: 'installation_activation_status',
  AUTH_BOOTSTRAP: 'auth_bootstrap',
  AUTH_LOGIN: 'auth_login',
  AUTH_RECOVERY_ISSUE: 'auth_recovery_issue',
  AUTH_RECOVERY_USE: 'auth_recovery_use',
  INSTALLATION_OPERATOR_SESSION: 'installation_operator_session',
  PROVIDER_BEELINE_CAPABILITY: 'provider_beeline_capability',
  PROVIDER_BEELINE_CONNECTION: 'provider_beeline_connection',
  PROVIDER_BEELINE_LEGACY: 'provider_beeline_legacy',
  PROVIDER_EVOTOR_CONNECTION: 'provider_evotor_connection',
  PROVIDER_EVOTOR_LEGACY: 'provider_evotor_legacy',
  WORKER_AUDIO_REFERENCE: 'worker_transcription_audio_reference',
  WORKER_CLAIM: 'worker_transcription_claim',
  WORKER_FAIL: 'worker_transcription_fail',
  WORKER_PROGRESS: 'worker_transcription_progress',
  WORKER_QUEUE: 'worker_transcription_queue',
  WORKER_RESULT: 'worker_transcription_result',
  WORKER_RETRY: 'worker_transcription_retry',
});

const DEFAULT_POLICIES = Object.freeze({
  [SURFACES.AUTH_LOGIN]: Object.freeze({
    account: Object.freeze({ limit: 8, windowSeconds: 300 }),
    credential_class: Object.freeze({ limit: 600, windowSeconds: 300 }),
    peer: Object.freeze({ limit: 120, windowSeconds: 300 }),
  }),
  [SURFACES.AUTH_BOOTSTRAP]: Object.freeze({
    account: Object.freeze({ limit: 3, windowSeconds: 900 }),
    credential_class: Object.freeze({ limit: 30, windowSeconds: 900 }),
    peer: Object.freeze({ limit: 12, windowSeconds: 900 }),
  }),
  [SURFACES.AUTH_RECOVERY_ISSUE]: Object.freeze({
    credential_class: Object.freeze({ limit: 20, windowSeconds: 300 }),
    peer: Object.freeze({ limit: 60, windowSeconds: 300 }),
  }),
  [SURFACES.AUTH_RECOVERY_USE]: Object.freeze({
    credential_class: Object.freeze({ limit: 30, windowSeconds: 300 }),
    peer: Object.freeze({ limit: 60, windowSeconds: 300 }),
    token: Object.freeze({ limit: 8, windowSeconds: 600 }),
  }),
  [SURFACES.INSTALLATION_OPERATOR_SESSION]: Object.freeze({
    account: Object.freeze({ limit: 6, windowSeconds: 600 }),
    credential_class: Object.freeze({ limit: 60, windowSeconds: 600 }),
    peer: Object.freeze({ limit: 30, windowSeconds: 600 }),
  }),
  [SURFACES.ACTIVATION_STATUS]: Object.freeze({
    credential_class: Object.freeze({ limit: 300, windowSeconds: 300 }),
    peer: Object.freeze({ limit: 120, windowSeconds: 300 }),
    token: Object.freeze({ limit: 12, windowSeconds: 300 }),
  }),
  [SURFACES.ACTIVATION_CONSUME]: Object.freeze({
    credential_class: Object.freeze({ limit: 60, windowSeconds: 600 }),
    peer: Object.freeze({ limit: 30, windowSeconds: 600 }),
    token: Object.freeze({ limit: 5, windowSeconds: 600 }),
  }),
  [SURFACES.PROVIDER_EVOTOR_LEGACY]: Object.freeze({
    credential: Object.freeze({ limit: 300, windowSeconds: 60 }),
    credential_class: Object.freeze({ limit: 600, windowSeconds: 60 }),
    peer: Object.freeze({ limit: 600, windowSeconds: 60 }),
    route: Object.freeze({ limit: 600, windowSeconds: 60 }),
  }),
  [SURFACES.PROVIDER_EVOTOR_CONNECTION]: Object.freeze({
    connection: Object.freeze({ limit: 600, windowSeconds: 60 }),
    credential: Object.freeze({ limit: 600, windowSeconds: 60 }),
    credential_class: Object.freeze({ limit: 1_800, windowSeconds: 60 }),
    peer: Object.freeze({ limit: 1_200, windowSeconds: 60 }),
    route: Object.freeze({ limit: 1_800, windowSeconds: 60 }),
  }),
  [SURFACES.PROVIDER_BEELINE_LEGACY]: Object.freeze({
    credential_class: Object.freeze({ limit: 120, windowSeconds: 60 }),
    peer: Object.freeze({ limit: 120, windowSeconds: 60 }),
    route: Object.freeze({ limit: 120, windowSeconds: 60 }),
  }),
  [SURFACES.PROVIDER_BEELINE_CONNECTION]: Object.freeze({
    connection: Object.freeze({ limit: 1_200, windowSeconds: 60 }),
    credential: Object.freeze({ limit: 1_200, windowSeconds: 60 }),
    credential_class: Object.freeze({ limit: 3_600, windowSeconds: 60 }),
    peer: Object.freeze({ limit: 2_400, windowSeconds: 60 }),
    route: Object.freeze({ limit: 3_600, windowSeconds: 60 }),
  }),
  [SURFACES.PROVIDER_BEELINE_CAPABILITY]: Object.freeze({
    connection: Object.freeze({ limit: 1_200, windowSeconds: 60 }),
    credential: Object.freeze({ limit: 1_200, windowSeconds: 60 }),
    credential_class: Object.freeze({ limit: 3_600, windowSeconds: 60 }),
    peer: Object.freeze({ limit: 2_400, windowSeconds: 60 }),
    route: Object.freeze({ limit: 3_600, windowSeconds: 60 }),
  }),
  [SURFACES.WORKER_QUEUE]: Object.freeze({
    credential: Object.freeze({ limit: 600, windowSeconds: 60 }),
    credential_class: Object.freeze({ limit: 1_200, windowSeconds: 60 }),
    peer: Object.freeze({ limit: 600, windowSeconds: 60 }),
    route: Object.freeze({ limit: 1_200, windowSeconds: 60 }),
  }),
  [SURFACES.WORKER_CLAIM]: Object.freeze({
    credential: Object.freeze({ limit: 600, windowSeconds: 60 }),
    credential_class: Object.freeze({ limit: 1_200, windowSeconds: 60 }),
    peer: Object.freeze({ limit: 600, windowSeconds: 60 }),
    route: Object.freeze({ limit: 1_200, windowSeconds: 60 }),
  }),
  [SURFACES.WORKER_AUDIO_REFERENCE]: Object.freeze({
    credential: Object.freeze({ limit: 600, windowSeconds: 60 }),
    credential_class: Object.freeze({ limit: 1_200, windowSeconds: 60 }),
    peer: Object.freeze({ limit: 600, windowSeconds: 60 }),
    route: Object.freeze({ limit: 1_200, windowSeconds: 60 }),
  }),
  [SURFACES.WORKER_PROGRESS]: Object.freeze({
    credential: Object.freeze({ limit: 3_000, windowSeconds: 60 }),
    credential_class: Object.freeze({ limit: 6_000, windowSeconds: 60 }),
    peer: Object.freeze({ limit: 3_000, windowSeconds: 60 }),
    route: Object.freeze({ limit: 6_000, windowSeconds: 60 }),
  }),
  [SURFACES.WORKER_RESULT]: Object.freeze({
    credential: Object.freeze({ limit: 300, windowSeconds: 60 }),
    credential_class: Object.freeze({ limit: 600, windowSeconds: 60 }),
    peer: Object.freeze({ limit: 300, windowSeconds: 60 }),
    route: Object.freeze({ limit: 600, windowSeconds: 60 }),
  }),
  [SURFACES.WORKER_FAIL]: Object.freeze({
    credential: Object.freeze({ limit: 300, windowSeconds: 60 }),
    credential_class: Object.freeze({ limit: 600, windowSeconds: 60 }),
    peer: Object.freeze({ limit: 300, windowSeconds: 60 }),
    route: Object.freeze({ limit: 600, windowSeconds: 60 }),
  }),
  [SURFACES.WORKER_RETRY]: Object.freeze({
    credential: Object.freeze({ limit: 300, windowSeconds: 60 }),
    credential_class: Object.freeze({ limit: 600, windowSeconds: 60 }),
    peer: Object.freeze({ limit: 300, windowSeconds: 60 }),
    route: Object.freeze({ limit: 600, windowSeconds: 60 }),
  }),
});

const SURFACE_INPUTS = Object.freeze({
  [SURFACES.AUTH_LOGIN]: Object.freeze({
    account: ['email'],
    credential_class: ['fixed', 'ordinary_login'],
    peer: ['peer'],
  }),
  [SURFACES.AUTH_BOOTSTRAP]: Object.freeze({
    account: ['email'],
    credential_class: ['fixed', 'owner_bootstrap'],
    peer: ['peer'],
  }),
  [SURFACES.AUTH_RECOVERY_ISSUE]: Object.freeze({
    credential_class: ['fixed', 'account_recovery_issue'],
    peer: ['peer'],
  }),
  [SURFACES.AUTH_RECOVERY_USE]: Object.freeze({
    credential_class: ['fixed', 'account_recovery_use'],
    peer: ['peer'],
    token: ['token'],
  }),
  [SURFACES.INSTALLATION_OPERATOR_SESSION]: Object.freeze({
    account: ['username'],
    credential_class: ['fixed', 'installation_operator'],
    peer: ['peer'],
  }),
  [SURFACES.ACTIVATION_STATUS]: Object.freeze({
    credential_class: ['fixed', 'owner_activation_status'],
    peer: ['peer'],
    token: ['token'],
  }),
  [SURFACES.ACTIVATION_CONSUME]: Object.freeze({
    credential_class: ['fixed', 'owner_activation_consume'],
    peer: ['peer'],
    token: ['token'],
  }),
  [SURFACES.PROVIDER_EVOTOR_LEGACY]: Object.freeze({
    credential: ['evotor_credential'],
    credential_class: ['fixed', 'provider_evotor'],
    peer: ['peer'],
    route: ['fixed', 'provider_evotor_legacy'],
  }),
  [SURFACES.PROVIDER_EVOTOR_CONNECTION]: Object.freeze({
    connection: ['connection_public_id'],
    credential: ['evotor_credential'],
    credential_class: ['fixed', 'provider_evotor'],
    peer: ['peer'],
    route: ['fixed', 'provider_evotor_connection'],
  }),
  [SURFACES.PROVIDER_BEELINE_LEGACY]: Object.freeze({
    credential_class: ['fixed', 'provider_beeline'],
    peer: ['peer'],
    route: ['fixed', 'provider_beeline_legacy'],
  }),
  [SURFACES.PROVIDER_BEELINE_CONNECTION]: Object.freeze({
    connection: ['connection_public_id'],
    credential: ['beeline_credential'],
    credential_class: ['fixed', 'provider_beeline'],
    peer: ['peer'],
    route: ['fixed', 'provider_beeline_connection'],
  }),
  [SURFACES.PROVIDER_BEELINE_CAPABILITY]: Object.freeze({
    connection: ['connection_public_id'],
    credential: ['callback_token'],
    credential_class: ['fixed', 'provider_beeline'],
    peer: ['peer'],
    route: ['fixed', 'provider_beeline_capability'],
  }),
  [SURFACES.WORKER_QUEUE]: Object.freeze({
    credential: ['worker_credential'],
    credential_class: ['fixed', 'transcription_worker'],
    peer: ['peer'],
    route: ['fixed', 'worker_transcription_queue'],
  }),
  [SURFACES.WORKER_CLAIM]: Object.freeze({
    credential: ['worker_credential'],
    credential_class: ['fixed', 'transcription_worker'],
    peer: ['peer'],
    route: ['fixed', 'worker_transcription_claim'],
  }),
  [SURFACES.WORKER_AUDIO_REFERENCE]: Object.freeze({
    credential: ['worker_credential'],
    credential_class: ['fixed', 'transcription_worker'],
    peer: ['peer'],
    route: ['fixed', 'worker_transcription_audio_reference'],
  }),
  [SURFACES.WORKER_PROGRESS]: Object.freeze({
    credential: ['worker_credential'],
    credential_class: ['fixed', 'transcription_worker'],
    peer: ['peer'],
    route: ['fixed', 'worker_transcription_progress'],
  }),
  [SURFACES.WORKER_RESULT]: Object.freeze({
    credential: ['worker_credential'],
    credential_class: ['fixed', 'transcription_worker'],
    peer: ['peer'],
    route: ['fixed', 'worker_transcription_result'],
  }),
  [SURFACES.WORKER_FAIL]: Object.freeze({
    credential: ['worker_credential'],
    credential_class: ['fixed', 'transcription_worker'],
    peer: ['peer'],
    route: ['fixed', 'worker_transcription_fail'],
  }),
  [SURFACES.WORKER_RETRY]: Object.freeze({
    credential: ['worker_credential'],
    credential_class: ['fixed', 'transcription_worker'],
    peer: ['peer'],
    route: ['fixed', 'worker_transcription_retry'],
  }),
});

// A valid canonical value cannot have more UTF-16 code units than its existing
// UTF-8 byte/format bound. These roughly 2x raw caps preserve bounded trimming
// whitespace while value.length rejects attacker-scale input without scanning it.
const RAW_CANONICAL_CODE_UNIT_LIMITS = Object.freeze({
  callback_token: 128,
  connection_public_id: 128,
  credential: 2048,
  email: 512,
  peer: 256,
  token: 128,
  username: 256,
});
const RECOVERY_TOKEN_RAW_LENGTH = 'setly_r1_'.length + 43;
const RECOVERY_TOKEN_PATTERN = /^setly_r1_[A-Za-z0-9_-]{43}$/u;

function configurationError(field) {
  const error = new Error(`Invalid authentication rate-limit configuration: ${field}`);
  error.code = 'AUTH_RATE_LIMIT_CONFIGURATION_INVALID';
  return error;
}

function parseInteger(env, name, fallback, minimum, maximum) {
  if (env[name] === undefined || env[name] === '') return fallback;
  const raw = String(env[name]);
  if (!/^(0|[1-9]\d*)$/u.test(raw)) throw configurationError(name);
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw configurationError(name);
  }
  return parsed;
}

function copyDefaultPolicies() {
  return Object.fromEntries(
    Object.entries(DEFAULT_POLICIES).map(([surface, dimensions]) => [
      surface,
      Object.fromEntries(
        Object.entries(dimensions).map(([dimension, policy]) => [
          dimension,
          { ...policy },
        ]),
      ),
    ]),
  );
}

function parsePolicyOverrides(raw) {
  const policies = copyDefaultPolicies();
  if (raw === undefined || raw === '') return policies;
  let parsed;
  try {
    parsed = JSON.parse(String(raw));
  } catch (_error) {
    throw configurationError('AUTH_RATE_LIMIT_POLICY_JSON');
  }
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
    throw configurationError('AUTH_RATE_LIMIT_POLICY_JSON');
  }
  for (const [surface, dimensions] of Object.entries(parsed)) {
    if (!Object.hasOwn(policies, surface)) {
      throw configurationError(`AUTH_RATE_LIMIT_POLICY_JSON.${surface}`);
    }
    if (!dimensions || Array.isArray(dimensions) || typeof dimensions !== 'object') {
      throw configurationError(`AUTH_RATE_LIMIT_POLICY_JSON.${surface}`);
    }
    for (const [dimension, policy] of Object.entries(dimensions)) {
      if (!Object.hasOwn(policies[surface], dimension)) {
        throw configurationError(`AUTH_RATE_LIMIT_POLICY_JSON.${surface}.${dimension}`);
      }
      if (
        !policy || Array.isArray(policy) || typeof policy !== 'object' ||
        Object.keys(policy).some((key) => !['limit', 'windowSeconds'].includes(key))
      ) {
        throw configurationError(`AUTH_RATE_LIMIT_POLICY_JSON.${surface}.${dimension}`);
      }
      const limit = policy.limit ?? policies[surface][dimension].limit;
      const windowSeconds =
        policy.windowSeconds ?? policies[surface][dimension].windowSeconds;
      if (!Number.isInteger(limit) || limit < 1 || limit > 1_000_000) {
        throw configurationError(
          `AUTH_RATE_LIMIT_POLICY_JSON.${surface}.${dimension}.limit`,
        );
      }
      if (!Number.isInteger(windowSeconds) || windowSeconds < 1 || windowSeconds > 86_400) {
        throw configurationError(
          `AUTH_RATE_LIMIT_POLICY_JSON.${surface}.${dimension}.windowSeconds`,
        );
      }
      policies[surface][dimension] = { limit, windowSeconds };
    }
  }
  return policies;
}

function validateRedisUrl(value) {
  try {
    const parsed = new URL(value);
    if (!['redis:', 'rediss:'].includes(parsed.protocol) || parsed.hash) {
      throw configurationError('AUTH_RATE_LIMIT_REDIS_URL');
    }
    return parsed.toString();
  } catch (error) {
    if (error?.code === 'AUTH_RATE_LIMIT_CONFIGURATION_INVALID') throw error;
    throw configurationError('AUTH_RATE_LIMIT_REDIS_URL');
  }
}

function authRateLimitConfiguration(env = process.env) {
  const mode = env.AUTH_RATE_LIMIT_MODE === undefined
    ? 'off'
    : String(env.AUTH_RATE_LIMIT_MODE);
  if (!MODES.has(mode)) throw configurationError('AUTH_RATE_LIMIT_MODE');
  if (mode === 'off') {
    return Object.freeze({ mode, version: CONTRACT_VERSION });
  }

  if (env.AUTH_RATE_LIMIT_VERSION !== CONTRACT_VERSION) {
    throw configurationError('AUTH_RATE_LIMIT_VERSION');
  }
  const secret = String(env.AUTH_RATE_LIMIT_SECRET || '');
  const secretBytes = Buffer.byteLength(secret, 'utf8');
  if (secretBytes < 32 || secretBytes > 1024) {
    throw configurationError('AUTH_RATE_LIMIT_SECRET');
  }
  const secretId = String(env.AUTH_RATE_LIMIT_SECRET_ID || '');
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/u.test(secretId)) {
    throw configurationError('AUTH_RATE_LIMIT_SECRET_ID');
  }
  const store = String(env.AUTH_RATE_LIMIT_STORE || '');
  if (!STORES.has(store)) throw configurationError('AUTH_RATE_LIMIT_STORE');
  const redisUrlValue = env.AUTH_RATE_LIMIT_REDIS_URL || env.REDIS_URL;
  const redisUrl = store === 'redis'
    ? validateRedisUrl(String(redisUrlValue || ''))
    : null;

  return Object.freeze({
    localMaxKeys: parseInteger(
      env,
      'AUTH_RATE_LIMIT_LOCAL_MAX_KEYS',
      4096,
      16,
      100_000,
    ),
    mode,
    policies: parsePolicyOverrides(env.AUTH_RATE_LIMIT_POLICY_JSON),
    redisBackoffMs: parseInteger(
      env,
      'AUTH_RATE_LIMIT_REDIS_BACKOFF_MS',
      30_000,
      100,
      300_000,
    ),
    redisTimeoutMs: parseInteger(
      env,
      'AUTH_RATE_LIMIT_REDIS_TIMEOUT_MS',
      500,
      25,
      10_000,
    ),
    redisUrl,
    secret,
    secretId,
    shards: parseInteger(env, 'AUTH_RATE_LIMIT_SHARDS', 1024, 64, 65_536),
    store,
    version: CONTRACT_VERSION,
  });
}

function validateAuthRateLimitConfiguration(env = process.env) {
  authRateLimitConfiguration(env);
}

class LocalFixedWindowStore {
  constructor({ clock = Date.now, maxKeys = 4096 } = {}) {
    this.clock = clock;
    this.maxKeys = maxKeys;
    this.entries = new Map();
    this.operations = 0;
    this.overflowKey = `${CONTRACT_VERSION}:overflow`;
  }

  cleanup(now = this.clock()) {
    for (const [key, entry] of this.entries) {
      if (entry.expiresAtMs <= now) this.entries.delete(key);
    }
  }

  async consume(key, windowMs) {
    const now = this.clock();
    this.operations += 1;
    if (this.operations % 128 === 0) this.cleanup(now);
    let effectiveKey = key;
    let entry = this.entries.get(effectiveKey);
    if (entry?.expiresAtMs <= now) {
      this.entries.delete(effectiveKey);
      entry = null;
    }
    if (!entry && effectiveKey !== this.overflowKey && this.entries.size >= this.maxKeys - 1) {
      this.cleanup(now);
      if (this.entries.size >= this.maxKeys - 1) {
        effectiveKey = this.overflowKey;
        entry = this.entries.get(effectiveKey);
        if (entry?.expiresAtMs <= now) {
          this.entries.delete(effectiveKey);
          entry = null;
        }
      }
    }
    if (!entry) {
      entry = { count: 0, expiresAtMs: now + windowMs };
      this.entries.set(effectiveKey, entry);
    }
    entry.count = Math.min(Number.MAX_SAFE_INTEGER, entry.count + 1);
    return {
      count: entry.count,
      overflow: effectiveKey === this.overflowKey,
      ttlMs: Math.max(1, entry.expiresAtMs - now),
    };
  }

  getStats() {
    return { keys: this.entries.size, maxKeys: this.maxKeys };
  }
}

function withTimeout(promise, timeoutMs) {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error('rate-limit store timeout')), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId));
}

async function destroyRedisClient(client) {
  try {
    if (typeof client?.destroy === 'function') await client.destroy();
    else if (typeof client?.disconnect === 'function') await client.disconnect();
  } catch (_error) {
    // The bounded local degraded store remains authoritative until retry.
  }
}

class RedisFixedWindowStore {
  constructor({
    backoffMs,
    clientFactory = createClient,
    clock = Date.now,
    timeoutMs,
    url,
  }) {
    this.backoffMs = backoffMs;
    this.clientFactory = clientFactory;
    this.clock = clock;
    this.timeoutMs = timeoutMs;
    this.url = url;
    this.clientPromise = null;
    this.disabledUntil = 0;
  }

  async client() {
    if (this.clock() < this.disabledUntil) throw new Error('rate-limit store backoff');
    if (!this.clientPromise) {
      const client = this.clientFactory({
        socket: { connectTimeout: this.timeoutMs, reconnectStrategy: false },
        url: this.url,
      });
      client.on('error', () => {});
      this.clientPromise = withTimeout(client.connect(), this.timeoutMs)
        .then(() => client)
        .catch(async (error) => {
          this.clientPromise = null;
          this.disabledUntil = this.clock() + this.backoffMs;
          await destroyRedisClient(client);
          throw error;
        });
    }
    return this.clientPromise;
  }

  async consume(key, windowMs) {
    try {
      const client = await this.client();
      const result = await withTimeout(
        client.eval(REDIS_SCRIPT, {
          arguments: [String(windowMs)],
          keys: [key],
        }),
        this.timeoutMs,
      );
      const count = Number(result?.[0]);
      const ttlMs = Number(result?.[1]);
      if (!Number.isSafeInteger(count) || count < 1 || !Number.isFinite(ttlMs) || ttlMs < 0) {
        throw new Error('rate-limit store returned invalid data');
      }
      return { count, overflow: false, ttlMs: Math.max(1, ttlMs) };
    } catch (error) {
      const pending = this.clientPromise;
      this.clientPromise = null;
      this.disabledUntil = this.clock() + this.backoffMs;
      if (pending) {
        Promise.resolve(pending).then(destroyRedisClient, () => {});
      }
      throw error;
    }
  }

  async close() {
    if (!this.clientPromise) return;
    try {
      await destroyRedisClient(await this.clientPromise);
    } catch (_error) {
      // Nothing else to close.
    } finally {
      this.clientPromise = null;
    }
  }
}

function boundedCanonical(value, { kind }) {
  if (typeof value !== 'string') return `${kind}:invalid`;
  const rawCodeUnitLimit = RAW_CANONICAL_CODE_UNIT_LIMITS[kind];
  if (!rawCodeUnitLimit || value.length > rawCodeUnitLimit) {
    return `${kind}:invalid`;
  }
  let canonical;
  try {
    canonical = value.trim().normalize('NFKC');
  } catch (_error) {
    return `${kind}:invalid`;
  }
  if (!canonical || /[\u0000-\u001f\u007f]/u.test(canonical)) {
    return `${kind}:invalid`;
  }
  if (kind === 'email') {
    canonical = canonical.toLowerCase();
    if (
      Buffer.byteLength(canonical, 'utf8') > 254 ||
      !/^[^\s@]{1,64}@[^\s@]{1,189}$/u.test(canonical)
    ) {
      return 'email:invalid';
    }
  } else if (kind === 'username') {
    if (Buffer.byteLength(canonical, 'utf8') > 128) return 'username:invalid';
  } else if (kind === 'token') {
    if (!/^[A-Za-z0-9_-]{43}$/u.test(canonical)) return 'token:invalid';
  } else if (kind === 'callback_token') {
    canonical = canonical.toLowerCase();
    if (!/^[a-f0-9]{64}$/u.test(canonical)) return 'callback_token:invalid';
  } else if (kind === 'connection_public_id') {
    canonical = canonical.toLowerCase();
    if (!/^ic_[a-f0-9]{32}$/u.test(canonical)) {
      return 'connection_public_id:invalid';
    }
  } else if (kind === 'credential') {
    if (Buffer.byteLength(canonical, 'utf8') > 1024) return 'credential:invalid';
  } else if (kind === 'peer') {
    canonical = canonical.toLowerCase();
    if (
      Buffer.byteLength(canonical, 'utf8') > 128 ||
      !/^[0-9a-f:.%]+$/u.test(canonical)
    ) {
      return 'peer:invalid';
    }
  }
  return `${kind}:valid:${canonical}`;
}

function recoveryTokenCanonical(value) {
  if (typeof value !== 'string' || value.length !== RECOVERY_TOKEN_RAW_LENGTH) {
    return 'recovery_token:invalid';
  }
  if (!RECOVERY_TOKEN_PATTERN.test(value)) return 'recovery_token:invalid';
  return `recovery_token:valid:${crypto.createHash('sha256').update(value, 'utf8').digest('hex')}`;
}

function rawSingletonHeader(request, name) {
  const value = request?.headers?.[name];
  return typeof value === 'string' ? value : null;
}

function bearerCredential(value) {
  if (
    typeof value !== 'string' ||
    value.length > RAW_CANONICAL_CODE_UNIT_LIMITS.credential
  ) {
    return null;
  }
  return value.replace(/^Bearer\s+/iu, '');
}

function evotorCredential(request) {
  const direct = rawSingletonHeader(request, 'x-evotor-token');
  return direct
    ? direct
    : bearerCredential(rawSingletonHeader(request, 'authorization'));
}

function beelineCredential(request) {
  for (const name of [
    'x-beeline-webhook-secret',
    'x-webhook-secret',
    'x-integration-secret',
  ]) {
    const value = rawSingletonHeader(request, name);
    if (value) return value;
  }
  return null;
}

function workerCredential(request) {
  const authorization = rawSingletonHeader(request, 'authorization');
  if (authorization !== null) {
    const bearer = bearerCredential(authorization);
    if (bearer !== null && bearer.trim()) return bearer;
  }
  return rawSingletonHeader(request, 'x-worker-token');
}

function canonicalSubject(input, request) {
  const [kind, fixed] = input;
  if (kind === 'fixed') return `class:valid:${fixed}`;
  if (kind === 'peer') {
    return boundedCanonical(request?.socket?.remoteAddress, { kind: 'peer' });
  }
  if (kind === 'callback_token') {
    return boundedCanonical(request?.params?.callbackToken, { kind });
  }
  if (kind === 'connection_public_id') {
    return boundedCanonical(request?.params?.connectionPublicId, { kind });
  }
  if (kind === 'evotor_credential') {
    return boundedCanonical(evotorCredential(request), { kind: 'credential' });
  }
  if (kind === 'beeline_credential') {
    return boundedCanonical(beelineCredential(request), { kind: 'credential' });
  }
  if (kind === 'worker_credential') {
    return boundedCanonical(workerCredential(request), { kind: 'credential' });
  }
  return boundedCanonical(request?.body?.[kind], { kind });
}

function subjectBucket(config, surface, dimension, canonical) {
  const digest = crypto
    .createHmac('sha256', config.secret)
    .update(`${config.version}\0${surface}\0${dimension}\0${canonical}`)
    .digest();
  return digest.readUInt32BE(0) % config.shards;
}

function storageKey(config, surface, dimension, bucket) {
  return [
    'setly',
    'security',
    'auth-rate-limit',
    config.version,
    config.secretId,
    surface,
    dimension,
    bucket,
  ].join(':');
}

function defaultDecisionLogger(event) {
  console.info('AUTH_RATE_LIMIT_DECISION', event);
}

function createAuthRateLimiter({
  clock = Date.now,
  env = process.env,
  logger = defaultDecisionLogger,
  redisClientFactory = createClient,
} = {}) {
  const config = authRateLimitConfiguration(env);
  if (config.mode === 'off') {
    return Object.freeze({
      async close() {},
      getStats: () => Object.freeze({ mode: 'off' }),
      mode: 'off',
      async consumeRequest() {
        return Object.freeze({ blocked: false, mode: 'off', retryAfterSeconds: 0 });
      },
    });
  }

  const localStore = new LocalFixedWindowStore({
    clock,
    maxKeys: config.localMaxKeys,
  });
  const redisStore = config.store === 'redis'
    ? new RedisFixedWindowStore({
      backoffMs: config.redisBackoffMs,
      clientFactory: redisClientFactory,
      clock,
      timeoutMs: config.redisTimeoutMs,
      url: config.redisUrl,
    })
    : null;
  const stats = {
    allowed: 0,
    degraded: 0,
    denied: 0,
    reportWouldBlock: 0,
    requests: 0,
  };

  async function consumeDimension(surface, dimension, request) {
    const policy = config.policies[surface][dimension];
    const canonical = surface === SURFACES.AUTH_RECOVERY_USE && dimension === 'token'
      ? recoveryTokenCanonical(request?.body?.token)
      : canonicalSubject(SURFACE_INPUTS[surface][dimension], request);
    const bucket = subjectBucket(config, surface, dimension, canonical);
    const key = storageKey(config, surface, dimension, bucket);
    const windowMs = policy.windowSeconds * 1000;
    let result;
    let store = 'local';
    let degraded = false;
    if (redisStore) {
      try {
        result = await redisStore.consume(key, windowMs);
        store = 'redis';
      } catch (_error) {
        result = await localStore.consume(key, windowMs);
        store = 'local_degraded';
        degraded = true;
      }
    } else {
      result = await localStore.consume(key, windowMs);
    }
    return {
      bucket: `${config.version}.${bucket.toString(36)}`,
      count: result.count,
      degraded,
      dimension,
      exceeded: result.count > policy.limit,
      limit: policy.limit,
      overflow: result.overflow,
      retryAfterSeconds: Math.max(1, Math.ceil(result.ttlMs / 1000)),
      store,
      windowSeconds: policy.windowSeconds,
    };
  }

  async function consumeRequest(surface, request) {
    if (!Object.hasOwn(config.policies, surface)) {
      throw new TypeError(`Unknown authentication rate-limit surface: ${surface}`);
    }
    const dimensions = await Promise.all(
      Object.keys(config.policies[surface]).map((dimension) =>
        consumeDimension(surface, dimension, request)),
    );
    const exceeded = dimensions.filter((dimension) => dimension.exceeded);
    const wouldBlock = exceeded.length > 0;
    const blocked = config.mode === 'enforce' && wouldBlock;
    const degraded = dimensions.some((dimension) => dimension.degraded);
    const retryAfterSeconds = wouldBlock
      ? Math.max(...exceeded.map((dimension) => dimension.retryAfterSeconds))
      : 0;
    stats.requests += 1;
    if (degraded) stats.degraded += 1;
    if (blocked) stats.denied += 1;
    else if (config.mode === 'report' && wouldBlock) stats.reportWouldBlock += 1;
    else stats.allowed += 1;
    const event = Object.freeze({
      degraded,
      dimensions: dimensions.map((dimension) => Object.freeze({ ...dimension })),
      event: 'security.auth_rate_limit.decision',
      mode: config.mode,
      outcome: blocked ? 'deny' : wouldBlock ? 'would_deny' : 'allow',
      retryAfterSeconds,
      surface,
      version: config.version,
    });
    logger(event);
    return Object.freeze({
      blocked,
      degraded,
      mode: config.mode,
      retryAfterSeconds,
      wouldBlock,
    });
  }

  return Object.freeze({
    async close() {
      if (redisStore) await redisStore.close();
    },
    getStats() {
      return Object.freeze({
        ...stats,
        local: localStore.getStats(),
        mode: config.mode,
        store: config.store,
        version: config.version,
      });
    },
    mode: config.mode,
    consumeRequest,
  });
}

module.exports = {
  SURFACES,
  createAuthRateLimiter,
  validateAuthRateLimitConfiguration,
  _private: {
    CONTRACT_VERSION,
    DEFAULT_POLICIES,
    LocalFixedWindowStore,
    RAW_CANONICAL_CODE_UNIT_LIMITS,
    RECOVERY_TOKEN_PATTERN,
    RECOVERY_TOKEN_RAW_LENGTH,
    REDIS_SCRIPT,
    RedisFixedWindowStore,
    SURFACE_INPUTS,
    authRateLimitConfiguration,
    boundedCanonical,
    canonicalSubject,
    recoveryTokenCanonical,
    storageKey,
    subjectBucket,
  },
};
