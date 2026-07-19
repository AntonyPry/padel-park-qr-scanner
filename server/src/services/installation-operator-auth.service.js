'use strict';

const crypto = require('crypto');

const SESSION_TTL_SECONDS = 60 * 30;
const TOKEN_KIND = 'installation-operator';

function isEnabled() {
  return ['1', 'true', 'yes', 'on'].includes(
    String(process.env.INSTALLATION_PROVISIONING_ENABLED || '')
      .trim()
      .toLowerCase(),
  );
}

function configuration() {
  if (!isEnabled()) {
    const error = new Error('Installation provisioning is disabled');
    error.code = 'INSTALLATION_PROVISIONING_DISABLED';
    error.statusCode = 404;
    throw error;
  }

  const username = String(process.env.INSTALLATION_OPERATOR_USERNAME || '').trim();
  const password = String(process.env.INSTALLATION_OPERATOR_PASSWORD || '');
  const secret = String(process.env.INSTALLATION_OPERATOR_SECRET || '');
  if (!username || !password || secret.length < 32) {
    const error = new Error('Installation operator credentials are not configured');
    error.code = 'INSTALLATION_OPERATOR_CONFIGURATION_INVALID';
    error.statusCode = 503;
    throw error;
  }
  return { password, secret, username };
}

function safeEqual(left, right) {
  const leftDigest = crypto.createHash('sha256').update(String(left)).digest();
  const rightDigest = crypto.createHash('sha256').update(String(right)).digest();
  return crypto.timingSafeEqual(leftDigest, rightDigest);
}

function encode(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function signSession(username, secret) {
  const now = Math.floor(Date.now() / 1000);
  const header = encode({ alg: 'HS256', typ: 'JWT' });
  const body = encode({
    exp: now + SESSION_TTL_SECONDS,
    iat: now,
    kind: TOKEN_KIND,
    username,
  });
  const signature = crypto
    .createHmac('sha256', secret)
    .update(`${header}.${body}`)
    .digest('base64url');
  return `${header}.${body}.${signature}`;
}

function createSession({ password, username }) {
  const configured = configuration();
  if (
    !safeEqual(String(username || '').trim(), configured.username) ||
    !safeEqual(String(password || ''), configured.password)
  ) {
    const error = new Error('Неверный логин или пароль оператора');
    error.code = 'INSTALLATION_OPERATOR_CREDENTIALS_INVALID';
    error.statusCode = 401;
    throw error;
  }
  return { token: signSession(configured.username, configured.secret) };
}

function verifySession(token) {
  const configured = configuration();
  const [header, body, signature] = String(token || '').split('.');
  if (!header || !body || !signature) return null;
  const expected = crypto
    .createHmac('sha256', configured.secret)
    .update(`${header}.${body}`)
    .digest('base64url');
  if (!safeEqual(signature, expected)) return null;

  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (
      payload.kind !== TOKEN_KIND ||
      payload.username !== configured.username ||
      !Number.isFinite(payload.exp) ||
      payload.exp <= Math.floor(Date.now() / 1000)
    ) {
      return null;
    }
    return true;
  } catch {
    return null;
  }
}

function getPublicStatus() {
  if (!isEnabled()) return { enabled: false };
  try {
    configuration();
    return { enabled: true };
  } catch (error) {
    if (error.code === 'INSTALLATION_OPERATOR_CONFIGURATION_INVALID') {
      return { enabled: false };
    }
    throw error;
  }
}

module.exports = {
  createSession,
  getPublicStatus,
  isEnabled,
  verifySession,
};
