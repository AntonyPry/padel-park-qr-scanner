'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');

const authData = require('../../src/security/auth-data-envelope');
const providerSecrets = require('../../src/provider-integrations/secrets');
const secretEnvelope = require('../../src/security/secret-envelope');

function encodedKey(fill) {
  return Buffer.alloc(32, fill).toString('base64url');
}

function authEnv(currentVersion = 2) {
  return {
    AUTH_DATA_ENCRYPTION_CURRENT_KEY_VERSION: String(currentVersion),
    AUTH_DATA_ENCRYPTION_KEY_RING: JSON.stringify({
      1: encodedKey(17),
      2: encodedKey(29),
    }),
  };
}

test('AUTH envelope is purpose/identity-bound and selects its versioned read key', () => {
  const identity = {
    accountId: 42,
    purpose: authData.AUTH_DATA_PURPOSES.ACCOUNT_TWO_FACTOR,
  };
  const ciphertext = authData.encryptAuthData(
    'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP',
    identity,
    authEnv(1),
  );
  assert.equal(ciphertext.includes('JBSWY3DPEHPK3PXP'), false);
  assert.equal(authData.authDataEnvelopeKeyVersion(ciphertext), 1);
  assert.deepEqual(Object.keys(JSON.parse(ciphertext)).sort(), [
    'algorithm',
    'ciphertext',
    'keyVersion',
    'nonce',
    'schemaVersion',
    'tag',
  ]);
  assert.equal(JSON.parse(ciphertext).algorithm, 'A256GCM');
  assert.equal(
    authData.decryptAuthData(ciphertext, identity, authEnv(2)),
    'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP',
  );
  assert.throws(
    () => authData.decryptAuthData(ciphertext, {
      accountId: 43,
      purpose: authData.AUTH_DATA_PURPOSES.ACCOUNT_TWO_FACTOR,
    }, authEnv(2)),
    (error) => error.code === 'AUTH_DATA_ENCRYPTION_DECRYPTION_FAILED',
  );
  assert.throws(
    () => authData.decryptAuthData(ciphertext, {
      accountId: 42,
      purpose: authData.AUTH_DATA_PURPOSES.OWNER_RECOVERY_CONTACT,
    }, authEnv(2)),
    (error) => error.code === 'AUTH_DATA_ENCRYPTION_DECRYPTION_FAILED',
  );
});

test('AUTH key-ring configuration is bounded, strict and fail closed', () => {
  const invalid = [
    {},
    {
      AUTH_DATA_ENCRYPTION_CURRENT_KEY_VERSION: '1',
      AUTH_DATA_ENCRYPTION_KEY_RING: '{}',
    },
    {
      AUTH_DATA_ENCRYPTION_CURRENT_KEY_VERSION: '2',
      AUTH_DATA_ENCRYPTION_KEY_RING: JSON.stringify({ 1: encodedKey(1) }),
    },
    {
      AUTH_DATA_ENCRYPTION_CURRENT_KEY_VERSION: '1',
      AUTH_DATA_ENCRYPTION_KEY_RING: JSON.stringify({ 1: Buffer.alloc(31).toString('base64url') }),
    },
    {
      AUTH_DATA_ENCRYPTION_CURRENT_KEY_VERSION: '01',
      AUTH_DATA_ENCRYPTION_KEY_RING: JSON.stringify({ 1: encodedKey(1) }),
    },
    {
      AUTH_DATA_ENCRYPTION_CURRENT_KEY_VERSION: '1',
      AUTH_DATA_ENCRYPTION_KEY_RING: `{"1":"${encodedKey(1)}","1":"${encodedKey(2)}"}`,
    },
  ];
  for (const environment of invalid) {
    assert.throws(
      () => authData.authDataEncryptionConfiguration(environment),
      (error) => error.code === 'AUTH_DATA_ENCRYPTION_CONFIGURATION_INVALID',
    );
  }
});

test('AUTH rewrap is explicit old-to-current and preserves current ciphertext', () => {
  const identity = {
    operatorId: 'op_0123456789abcdef',
    purpose: authData.AUTH_DATA_PURPOSES.INSTALLATION_OPERATOR_TWO_FACTOR,
  };
  const oldCiphertext = authData.encryptAuthData(
    'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP',
    identity,
    authEnv(1),
  );
  const rewrapped = authData.rewrapAuthData(oldCiphertext, identity, authEnv(2));
  assert.equal(rewrapped.fromVersion, 1);
  assert.equal(rewrapped.toVersion, 2);
  assert.equal(rewrapped.rewrapped, true);
  assert.equal(authData.authDataEnvelopeKeyVersion(rewrapped.ciphertext), 2);

  const unchanged = authData.rewrapAuthData(
    rewrapped.ciphertext,
    identity,
    authEnv(2),
  );
  assert.equal(unchanged.rewrapped, false);
  assert.equal(unchanged.ciphertext, rewrapped.ciphertext);
});

test('provider envelopes retain their accepted AAD and ciphertext contract', () => {
  const previousKey = process.env.INTEGRATION_SECRETS_MASTER_KEY;
  const previousVersion = process.env.INTEGRATION_SECRETS_KEY_VERSION;
  process.env.INTEGRATION_SECRETS_MASTER_KEY = crypto.randomBytes(32).toString('base64');
  process.env.INTEGRATION_SECRETS_KEY_VERSION = 'provider-v4';
  try {
    const identity = {
      provider: 'beeline',
      publicId: 'ic_0123456789abcdef0123456789abcdef',
    };
    const ciphertext = providerSecrets.encryptSecretBundle(
      { accessToken: 'provider-secret' },
      identity,
    );
    assert.equal(ciphertext.includes('provider-secret'), false);
    assert.deepEqual(
      providerSecrets.decryptSecretBundle(ciphertext, identity),
      { accessToken: 'provider-secret' },
    );
    assert.throws(
      () => providerSecrets.decryptSecretBundle(ciphertext, {
        ...identity,
        publicId: 'ic_fedcba9876543210fedcba9876543210',
      }),
      (error) => error.code === 'INTEGRATION_SECRET_DECRYPTION_FAILED',
    );
  } finally {
    if (previousKey === undefined) delete process.env.INTEGRATION_SECRETS_MASTER_KEY;
    else process.env.INTEGRATION_SECRETS_MASTER_KEY = previousKey;
    if (previousVersion === undefined) delete process.env.INTEGRATION_SECRETS_KEY_VERSION;
    else process.env.INTEGRATION_SECRETS_KEY_VERSION = previousVersion;
  }
});

test('auth-data versioned envelopes retain the strict 16 KiB payload limit', () => {
  assert.throws(
    () => secretEnvelope.encryptVersionedSecretEnvelope(
      Buffer.alloc(secretEnvelope.DEFAULT_PAYLOAD_BYTES + 1, 1),
      {
        aad: 'setly:test:auth-data-limit',
        key: Buffer.alloc(32, 1),
        keyVersion: 1,
      },
    ),
    (error) => error.code === 'SECRET_ENVELOPE_PAYLOAD_INVALID',
  );
});
