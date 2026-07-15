'use strict';

const SENSITIVE_KEY_PATTERN = /(authorization|cookie|credential|email|password|phone|secret|token)/i;
const PROVIDER_CREDENTIAL_KEY_PATTERN = /(authorization|cookie|credential|password|secret|token)/i;

function redactProviderCredentials(value, key = '', depth = 0) {
  if (PROVIDER_CREDENTIAL_KEY_PATTERN.test(String(key))) return '[redacted]';
  if (value === null || value === undefined) return value;
  if (depth >= 8) return Array.isArray(value) ? `[array:${value.length}]` : '[object]';
  if (Array.isArray(value)) {
    return value.map((item) => redactProviderCredentials(item, key, depth + 1));
  }
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([childKey, child]) => [
        childKey,
        redactProviderCredentials(child, childKey, depth + 1),
      ]),
    );
  }
  return value;
}

function redactProviderValue(value, key = '', depth = 0) {
  if (SENSITIVE_KEY_PATTERN.test(String(key))) return '[redacted]';
  if (value === null || value === undefined) return value;
  if (depth >= 4) return Array.isArray(value) ? `[array:${value.length}]` : '[object]';
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => redactProviderValue(item, key, depth + 1));
  }
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([childKey, child]) => [
        childKey,
        redactProviderValue(child, childKey, depth + 1),
      ]),
    );
  }
  if (typeof value === 'string') return value.length > 256 ? `${value.slice(0, 256)}…` : value;
  return value;
}

function safeProviderError(error, fallback = 'Provider request failed') {
  const result = new Error(fallback);
  result.code = error?.code && /^PROVIDER_|^INTEGRATION_/u.test(error.code)
    ? error.code
    : 'PROVIDER_REQUEST_FAILED';
  result.statusCode = Number(error?.statusCode) || 502;
  return result;
}

module.exports = {
  redactProviderCredentials,
  redactProviderValue,
  safeProviderError,
};
