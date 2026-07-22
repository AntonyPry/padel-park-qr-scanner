'use strict';

const CREDENTIAL_KEY_MARKERS = Object.freeze([
  'accesstoken',
  'accesskey',
  'apikey',
  'authentication',
  'authkey',
  'authorization',
  'authtoken',
  'clientsecret',
  'cookie',
  'credential',
  'password',
  'passwd',
  'privatekey',
  'secret',
  'signingkey',
  'token',
  'webhookkey',
]);

function normalizeCredentialKey(key) {
  return String(key || '').toLowerCase().replace(/[^a-z0-9]/gu, '');
}

function isProviderCredentialKey(key) {
  const normalized = normalizeCredentialKey(key);
  if (!normalized) return false;
  if (/^(?:basic|bearer|proxy|x)?auth$/u.test(normalized)) return true;
  return CREDENTIAL_KEY_MARKERS.some((marker) => normalized.includes(marker));
}

module.exports = {
  isProviderCredentialKey,
  normalizeCredentialKey,
};
