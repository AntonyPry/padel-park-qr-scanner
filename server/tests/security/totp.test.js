'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const totp = require('../../src/security/totp');

test('RFC 4226 HOTP vectors remain authenticator-compatible', () => {
  const secret = totp._private.encodeBase32(
    Buffer.from('12345678901234567890', 'ascii'),
  );
  const expected = [
    '755224',
    '287082',
    '359152',
    '969429',
    '338314',
    '254676',
    '287922',
    '162583',
    '399871',
    '520489',
  ];
  assert.deepEqual(
    expected.map((_code, counter) => totp.hotp(secret, counter)),
    expected,
  );
});

test('TOTP verification returns the accepted counter for atomic replay checks', () => {
  const secret = totp.generateSecret();
  const now = Date.UTC(2026, 6, 24, 12, 0, 0);
  const currentCounter = totp.counterAt(now);

  assert.equal(
    totp.verifyTotp(secret, totp.hotp(secret, currentCounter), { now }),
    currentCounter,
  );
  assert.equal(
    totp.verifyTotp(secret, totp.hotp(secret, currentCounter - 1), { now }),
    currentCounter - 1,
  );
  assert.equal(
    totp.verifyTotp(secret, totp.hotp(secret, currentCounter + 1), { now }),
    currentCounter + 1,
  );
  assert.equal(
    totp.verifyTotp(secret, totp.hotp(secret, currentCounter + 2), { now }),
    null,
  );
  assert.equal(totp.verifyTotp(secret, ' 123456', { now }), null);
  assert.equal(totp.verifyTotp(secret, '123456 ', { now }), null);
});

test('authenticator URI contains only the one-time enrollment material', () => {
  const secret = totp.generateSecret();
  assert.match(secret, totp.SECRET_PATTERN);
  const uri = new URL(totp.buildOtpAuthUri({
    accountName: 'owner@setly.test',
    secret,
  }));
  assert.equal(uri.protocol, 'otpauth:');
  assert.equal(uri.hostname, 'totp');
  assert.equal(decodeURIComponent(uri.pathname), '/Setly:owner@setly.test');
  assert.equal(uri.searchParams.get('algorithm'), 'SHA1');
  assert.equal(uri.searchParams.get('digits'), '6');
  assert.equal(uri.searchParams.get('issuer'), 'Setly');
  assert.equal(uri.searchParams.get('period'), '30');
  assert.equal(uri.searchParams.get('secret'), secret);
});

test('recovery codes carry 128 random bits and persist only as digests', () => {
  const codes = totp.generateRecoveryCodes();
  assert.equal(codes.length, totp.RECOVERY_CODE_COUNT);
  assert.equal(new Set(codes).size, codes.length);
  for (const code of codes) {
    const canonical = totp.normalizeRecoveryCode(code);
    assert.match(canonical, totp.RECOVERY_CODE_PATTERN);
    assert.equal(canonical.length, 26);
    const digest = totp.digestRecoveryCode(code);
    assert.match(digest, /^[a-f0-9]{64}$/u);
    assert.equal(digest.includes(canonical), false);
    assert.equal(
      totp.digestRecoveryCode(code.toLowerCase().replaceAll('-', ' ')),
      digest,
    );
  }
  assert.equal(totp.digestRecoveryCode('not-a-recovery-code'), null);
});
