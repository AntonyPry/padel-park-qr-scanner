'use strict';

const BROWSER_ORIGIN_CONFIGURATION_ERROR =
  'BROWSER_ORIGIN_CONFIGURATION_INVALID';
const OPERATOR_HOST = 'ops.setly.tech';
const OPERATOR_ORIGIN = 'https://ops.setly.tech';
const LOCAL_BROWSER_ORIGINS = Object.freeze([
  'http://127.0.0.1:4173',
  'http://127.0.0.1:4174',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:5174',
  'http://localhost:4173',
  'http://localhost:4174',
  'http://localhost:5173',
  'http://localhost:5174',
]);

function configurationError(reason) {
  const error = new Error(`Browser origin configuration is invalid: ${reason}`);
  error.code = BROWSER_ORIGIN_CONFIGURATION_ERROR;
  error.reason = reason;
  return error;
}

function parseExactOrigin(value, { production }) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch (_error) {
    throw configurationError('origin_url_invalid');
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw configurationError('origin_scheme_invalid');
  }
  if (
    parsed.username ||
    parsed.password ||
    parsed.pathname !== '/' ||
    parsed.search ||
    parsed.hash ||
    value !== parsed.origin
  ) {
    throw configurationError('origin_not_canonical');
  }
  if (production && parsed.protocol !== 'https:') {
    throw configurationError('production_origin_requires_https');
  }
  if (parsed.hostname === OPERATOR_HOST) {
    throw configurationError('operator_origin_is_not_product_origin');
  }

  return parsed.origin;
}

function parseOriginList(value, options) {
  if (value == null || String(value).trim() === '') return null;

  const entries = String(value).split(',');
  if (entries.some((entry) => entry.trim() === '')) {
    throw configurationError('origin_list_contains_empty_entry');
  }

  const seen = new Set();
  const origins = entries.map((entry) => {
    const origin = parseExactOrigin(entry.trim(), options);
    if (seen.has(origin)) {
      throw configurationError('origin_list_contains_duplicate');
    }
    seen.add(origin);
    return origin;
  });

  return origins;
}

function sameOriginSet(left, right) {
  if (left.length !== right.length) return false;
  const rightSet = new Set(right);
  return left.every((origin) => rightSet.has(origin));
}

function createBrowserOriginPolicy(environment = process.env) {
  const production = environment.NODE_ENV === 'production';
  const options = { production };
  const clientOrigins = parseOriginList(environment.CLIENT_ORIGIN, options);
  const corsOrigins = parseOriginList(environment.CORS_ORIGIN, options);

  if (
    clientOrigins &&
    corsOrigins &&
    !sameOriginSet(clientOrigins, corsOrigins)
  ) {
    throw configurationError('client_and_cors_origins_differ');
  }

  let configuredOrigins = clientOrigins || corsOrigins;
  let source = 'configured';
  if (!configuredOrigins) {
    if (production) {
      throw configurationError('production_origin_list_required');
    }
    configuredOrigins = LOCAL_BROWSER_ORIGINS;
    source = 'bounded_local_default';
  }

  const allowedOrigins = Object.freeze([...configuredOrigins].sort());
  const allowedOriginSet = new Set(allowedOrigins);

  return Object.freeze({
    allowedOrigins,
    isAllowed(origin) {
      return typeof origin === 'string' && allowedOriginSet.has(origin);
    },
    production,
    source,
  });
}

function isSameOriginHostRequest(origin, hostHeader) {
  if (typeof origin !== 'string' || typeof hostHeader !== 'string') return false;
  if (!hostHeader || hostHeader.includes(',') || /[\s/]/u.test(hostHeader)) {
    return false;
  }

  try {
    const parsed = new URL(origin);
    if (!['http:', 'https:'].includes(parsed.protocol)) return false;
    if (origin !== parsed.origin) return false;
    const requestHost = new URL(`${parsed.protocol}//${hostHeader}`);
    if (
      requestHost.username ||
      requestHost.password ||
      requestHost.pathname !== '/' ||
      requestHost.search ||
      requestHost.hash
    ) {
      return false;
    }
    return parsed.host.toLowerCase() === requestHost.host.toLowerCase();
  } catch (_error) {
    return false;
  }
}

module.exports = {
  BROWSER_ORIGIN_CONFIGURATION_ERROR,
  LOCAL_BROWSER_ORIGINS,
  OPERATOR_HOST,
  OPERATOR_ORIGIN,
  createBrowserOriginPolicy,
  isSameOriginHostRequest,
};
