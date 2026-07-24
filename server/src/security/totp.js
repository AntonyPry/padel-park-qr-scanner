'use strict';

const crypto = require('node:crypto');

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const CODE_DIGITS = 6;
const CODE_PATTERN = /^\d{6}$/u;
const RECOVERY_CODE_BYTES = 16;
const RECOVERY_CODE_COUNT = 10;
const RECOVERY_CODE_PATTERN = /^[A-Z2-7]{26}$/u;
const SECRET_BYTES = 20;
const SECRET_PATTERN = /^[A-Z2-7]{32}$/u;
const STEP_SECONDS = 30;

function securityInputError(message) {
  const error = new TypeError(message);
  error.code = 'TWO_FACTOR_INPUT_INVALID';
  return error;
}

function encodeBase32(value) {
  const input = Buffer.from(value);
  let bits = 0;
  let accumulator = 0;
  let output = '';

  for (const byte of input) {
    accumulator = (accumulator << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(accumulator >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) {
    output += BASE32_ALPHABET[(accumulator << (5 - bits)) & 31];
  }
  return output;
}

function decodeBase32(value, pattern = SECRET_PATTERN) {
  const canonical = String(value || '').toUpperCase();
  if (!pattern.test(canonical)) {
    throw securityInputError('Two-factor secret has an invalid format');
  }

  let bits = 0;
  let accumulator = 0;
  const output = [];
  for (const character of canonical) {
    const index = BASE32_ALPHABET.indexOf(character);
    if (index < 0) throw securityInputError('Two-factor secret has an invalid format');
    accumulator = (accumulator << 5) | index;
    bits += 5;
    if (bits >= 8) {
      output.push((accumulator >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(output);
}

function generateSecret() {
  return encodeBase32(crypto.randomBytes(SECRET_BYTES));
}

function normalizeCounter(counter) {
  const value = Number(counter);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw securityInputError('Two-factor counter is invalid');
  }
  return value;
}

function counterBuffer(counter) {
  const value = normalizeCounter(counter);
  const output = Buffer.alloc(8);
  output.writeBigUInt64BE(BigInt(value));
  return output;
}

function hotp(secret, counter) {
  const digest = crypto
    .createHmac('sha1', decodeBase32(secret))
    .update(counterBuffer(counter))
    .digest();
  const offset = digest[digest.length - 1] & 15;
  const binary = (
    ((digest[offset] & 127) << 24) |
    ((digest[offset + 1] & 255) << 16) |
    ((digest[offset + 2] & 255) << 8) |
    (digest[offset + 3] & 255)
  );
  return String(binary % (10 ** CODE_DIGITS)).padStart(CODE_DIGITS, '0');
}

function counterAt(now = Date.now()) {
  const timestamp = now instanceof Date ? now.getTime() : Number(now);
  if (!Number.isFinite(timestamp) || timestamp < 0) {
    throw securityInputError('Two-factor clock is invalid');
  }
  return Math.floor(timestamp / 1000 / STEP_SECONDS);
}

function safeCodeEqual(left, right) {
  if (!CODE_PATTERN.test(String(left)) || !CODE_PATTERN.test(String(right))) {
    return false;
  }
  return crypto.timingSafeEqual(
    Buffer.from(String(left), 'ascii'),
    Buffer.from(String(right), 'ascii'),
  );
}

function verifyTotp(secret, code, options = {}) {
  if (!CODE_PATTERN.test(String(code || ''))) return null;
  const window = options.window ?? 1;
  if (!Number.isSafeInteger(window) || window < 0 || window > 2) {
    throw securityInputError('Two-factor verification window is invalid');
  }
  const currentCounter = counterAt(options.now);
  for (let offset = -window; offset <= window; offset += 1) {
    const candidateCounter = currentCounter + offset;
    if (candidateCounter < 0) continue;
    if (safeCodeEqual(code, hotp(secret, candidateCounter))) {
      return candidateCounter;
    }
  }
  return null;
}

function buildOtpAuthUri({ accountName, issuer = 'Setly', secret }) {
  if (!SECRET_PATTERN.test(String(secret || ''))) {
    throw securityInputError('Two-factor secret has an invalid format');
  }
  const normalizedIssuer = String(issuer || '').trim();
  const normalizedAccount = String(accountName || '').trim();
  if (
    !normalizedIssuer ||
    normalizedIssuer.length > 80 ||
    !normalizedAccount ||
    normalizedAccount.length > 254
  ) {
    throw securityInputError('Two-factor authenticator label is invalid');
  }
  const label = `${normalizedIssuer}:${normalizedAccount}`;
  const query = new URLSearchParams({
    algorithm: 'SHA1',
    digits: String(CODE_DIGITS),
    issuer: normalizedIssuer,
    period: String(STEP_SECONDS),
    secret,
  });
  return `otpauth://totp/${encodeURIComponent(label)}?${query.toString()}`;
}

function normalizeRecoveryCode(value) {
  const canonical = String(value || '')
    .toUpperCase()
    .replace(/[\s-]/gu, '');
  return RECOVERY_CODE_PATTERN.test(canonical) ? canonical : null;
}

function formatRecoveryCode(canonical) {
  if (!RECOVERY_CODE_PATTERN.test(String(canonical || ''))) {
    throw securityInputError('Recovery code has an invalid format');
  }
  return String(canonical).match(/.{1,4}/gu).join('-');
}

function generateRecoveryCode() {
  return formatRecoveryCode(encodeBase32(crypto.randomBytes(RECOVERY_CODE_BYTES)));
}

function generateRecoveryCodes(count = RECOVERY_CODE_COUNT) {
  if (!Number.isSafeInteger(count) || count < 1 || count > 20) {
    throw securityInputError('Recovery code count is invalid');
  }
  const codes = new Set();
  while (codes.size < count) codes.add(generateRecoveryCode());
  return [...codes];
}

function digestRecoveryCode(value) {
  const canonical = normalizeRecoveryCode(value);
  if (!canonical) return null;
  return crypto
    .createHash('sha256')
    .update('setly:two-factor-recovery-code:v1\0', 'utf8')
    .update(canonical, 'ascii')
    .digest('hex');
}

module.exports = {
  CODE_PATTERN,
  RECOVERY_CODE_COUNT,
  RECOVERY_CODE_PATTERN,
  SECRET_PATTERN,
  STEP_SECONDS,
  buildOtpAuthUri,
  counterAt,
  digestRecoveryCode,
  generateRecoveryCode,
  generateRecoveryCodes,
  generateSecret,
  hotp,
  normalizeRecoveryCode,
  verifyTotp,
  _private: {
    BASE32_ALPHABET,
    CODE_DIGITS,
    RECOVERY_CODE_BYTES,
    SECRET_BYTES,
    counterBuffer,
    decodeBase32,
    encodeBase32,
    formatRecoveryCode,
    safeCodeEqual,
  },
};
