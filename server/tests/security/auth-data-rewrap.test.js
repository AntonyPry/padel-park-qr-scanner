'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { test } = require('node:test');

const authEnvelope = require('../../src/security/auth-data-envelope');

function fakeModel(rows) {
  let delivered = false;
  return {
    unscoped() {
      return this;
    },
    async findAll() {
      if (delivered) return [];
      delivered = true;
      return rows.map((row) => ({ ...row }));
    },
    async update(values, options) {
      const row = rows.find((candidate) =>
        candidate.id === options.where.id &&
        Object.entries(options.where).every(([field, value]) =>
          field === 'id' || candidate[field] === value
        ),
      );
      if (!row) return [0];
      Object.assign(row, values);
      return [1];
    },
  };
}

function fakeModels(accountRows) {
  return {
    AccountTwoFactor: fakeModel(accountRows),
    InstallationOperatorTwoFactor: fakeModel([]),
  };
}

test('auth envelope rewrap is dry-run first, CAS-safe and idempotent', async () => {
  const previousRing = process.env.AUTH_DATA_ENCRYPTION_KEY_RING;
  const previousCurrent =
    process.env.AUTH_DATA_ENCRYPTION_CURRENT_KEY_VERSION;
  const firstKey = crypto.randomBytes(32).toString('base64url');
  const secondKey = crypto.randomBytes(32).toString('base64url');
  try {
    process.env.AUTH_DATA_ENCRYPTION_KEY_RING = JSON.stringify({ 1: firstKey });
    process.env.AUTH_DATA_ENCRYPTION_CURRENT_KEY_VERSION = '1';
    const identity = {
      accountId: 17,
      purpose: authEnvelope.AUTH_DATA_PURPOSES.ACCOUNT_TWO_FACTOR,
    };
    const ciphertext = authEnvelope.encryptAuthData(
      'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP',
      identity,
    );
    const row = {
      accountId: 17,
      id: '00000000-0000-4000-8000-000000000017',
      keyVersion: 1,
      pendingKeyVersion: null,
      pendingSecretCiphertext: null,
      secretCiphertext: ciphertext,
    };
    process.env.AUTH_DATA_ENCRYPTION_KEY_RING = JSON.stringify({
      1: firstKey,
      2: secondKey,
    });
    process.env.AUTH_DATA_ENCRYPTION_CURRENT_KEY_VERSION = '2';
    const service = require('../../src/services/auth-data-rewrap.service');

    const dryRun = await service.checkAndRewrapAuthData({
      maxRefs: 10,
      models: fakeModels([row]),
    });
    assert.equal(dryRun.mode, 'dry-run');
    assert.equal(dryRun.totals.decryptable, 1);
    assert.equal(dryRun.totals.wouldRewrap, 1);
    assert.equal(dryRun.totals.rewrapped, 0);
    assert.equal(row.keyVersion, 1);
    assert.equal(row.secretCiphertext, ciphertext);

    const applied = await service.checkAndRewrapAuthData({
      apply: true,
      maxRefs: 10,
      models: fakeModels([row]),
    });
    assert.equal(applied.mode, 'apply');
    assert.equal(applied.totals.rewrapped, 1);
    assert.equal(row.keyVersion, 2);
    assert.notEqual(row.secretCiphertext, ciphertext);
    assert.equal(authEnvelope.decryptAuthData(row.secretCiphertext, identity),
      'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP');

    const repeated = await service.checkAndRewrapAuthData({
      apply: true,
      maxRefs: 10,
      models: fakeModels([row]),
    });
    assert.equal(repeated.totals.rewrapped, 0);
    assert.equal(repeated.totals.skipped, 1);
  } finally {
    if (previousRing === undefined) {
      delete process.env.AUTH_DATA_ENCRYPTION_KEY_RING;
    } else {
      process.env.AUTH_DATA_ENCRYPTION_KEY_RING = previousRing;
    }
    if (previousCurrent === undefined) {
      delete process.env.AUTH_DATA_ENCRYPTION_CURRENT_KEY_VERSION;
    } else {
      process.env.AUTH_DATA_ENCRYPTION_CURRENT_KEY_VERSION = previousCurrent;
    }
  }
});
