'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { test } = require('node:test');

const previous = {
  key: process.env.INTEGRATION_SECRETS_MASTER_KEY,
  version: process.env.INTEGRATION_SECRETS_KEY_VERSION,
};
process.env.INTEGRATION_SECRETS_MASTER_KEY = Buffer.alloc(32, 7).toString('base64');
process.env.INTEGRATION_SECRETS_KEY_VERSION = 'fingerprint-v1';

const {
  credentialFingerprint,
  providerIdentityFingerprint,
} = require('../../src/provider-integrations/fingerprints');

test.after(() => {
  if (previous.key === undefined) delete process.env.INTEGRATION_SECRETS_MASTER_KEY;
  else process.env.INTEGRATION_SECRETS_MASTER_KEY = previous.key;
  if (previous.version === undefined) delete process.env.INTEGRATION_SECRETS_KEY_VERSION;
  else process.env.INTEGRATION_SECRETS_KEY_VERSION = previous.version;
});

test('credential identity is keyed, provider-scoped and separated from safe provider identity', () => {
  const token = 'same-provider-secret';
  const telegram = credentialFingerprint('telegram', token);
  assert.match(telegram, /^[a-f0-9]{64}$/u);
  assert.notEqual(telegram, crypto.createHash('sha256').update(token).digest('hex'));
  assert.notEqual(telegram, credentialFingerprint('vk', token));
  assert.notEqual(telegram, providerIdentityFingerprint('telegram', token));
  assert.equal(telegram, credentialFingerprint('telegram', `  ${token}  `));
  process.env.INTEGRATION_SECRETS_KEY_VERSION = 'fingerprint-v2';
  assert.equal(telegram, credentialFingerprint('telegram', token));
});
