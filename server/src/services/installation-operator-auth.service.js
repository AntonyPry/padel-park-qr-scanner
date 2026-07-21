'use strict';

const crypto = require('crypto');
const db = require('../../models');

const SESSION_TTL_SECONDS = 60 * 30;
const TOKEN_KIND = 'installation-operator';

function envEnabled(name) {
  return ['1', 'true', 'yes', 'on'].includes(
    String(process.env[name] || '')
      .trim()
      .toLowerCase(),
  );
}

function isManagementEnabled() {
  return envEnabled('INSTALLATION_MANAGEMENT_ENABLED');
}

function isProvisioningEnabled() {
  return envEnabled('INSTALLATION_PROVISIONING_ENABLED');
}

function isEnabled() {
  return isManagementEnabled() || isProvisioningEnabled();
}

function assertManagementEnabled() {
  if (isManagementEnabled()) return;
  const error = new Error('Управление организациями и клубами отключено');
  error.code = 'INSTALLATION_MANAGEMENT_DISABLED';
  error.statusCode = 404;
  throw error;
}

function assertProvisioningEnabled() {
  if (isProvisioningEnabled()) return;
  const error = new Error('Создание организаций отключено');
  error.code = 'INSTALLATION_PROVISIONING_DISABLED';
  error.statusCode = 404;
  throw error;
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

function signSession(username, sessionId, secret) {
  const now = Math.floor(Date.now() / 1000);
  const header = encode({ alg: 'HS256', typ: 'JWT' });
  const body = encode({
    exp: now + SESSION_TTL_SECONDS,
    iat: now,
    kind: TOKEN_KIND,
    sid: sessionId,
    username,
  });
  const signature = crypto
    .createHmac('sha256', secret)
    .update(`${header}.${body}`)
    .digest('base64url');
  return `${header}.${body}.${signature}`;
}

async function createSession({ password, username }) {
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
  const sessionId = crypto.randomBytes(16).toString('hex');
  const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000);
  await db.InstallationOperatorSession.create({
    expiresAt,
    sessionId,
    username: configured.username,
  });
  return {
    expiresAt,
    token: signSession(configured.username, sessionId, configured.secret),
  };
}

async function verifySession(token) {
  const configured = configuration();
  const [header, body, signature] = String(token || '').split('.');
  if (!header || !body || !signature) return null;
  const expected = crypto
    .createHmac('sha256', configured.secret)
    .update(`${header}.${body}`)
    .digest('base64url');
  if (!safeEqual(signature, expected)) return null;

  try {
    const parsedHeader = JSON.parse(Buffer.from(header, 'base64url').toString('utf8'));
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (
      parsedHeader.alg !== 'HS256' ||
      parsedHeader.typ !== 'JWT' ||
      payload.kind !== TOKEN_KIND ||
      payload.username !== configured.username ||
      !/^[a-f0-9]{32}$/u.test(String(payload.sid || '')) ||
      !Number.isFinite(payload.exp) ||
      payload.exp <= Math.floor(Date.now() / 1000)
    ) {
      return null;
    }
    const session = await db.InstallationOperatorSession.findOne({
      where: { sessionId: payload.sid, username: payload.username },
    });
    if (
      !session ||
      session.revokedAt ||
      new Date(session.expiresAt).getTime() <= Date.now() ||
      Math.abs(new Date(session.expiresAt).getTime() - payload.exp * 1000) > 1000
    ) {
      return null;
    }
    return Object.freeze({
      sessionId: payload.sid,
      username: payload.username,
    });
  } catch {
    return null;
  }
}

async function revokeSession(operator) {
  const sessionId = String(operator?.sessionId || '');
  if (!/^[a-f0-9]{32}$/u.test(sessionId)) return false;
  const [updated] = await db.InstallationOperatorSession.update(
    { revokedAt: new Date() },
    { where: { revokedAt: null, sessionId } },
  );
  return updated === 1;
}

function getPublicStatus() {
  if (!isEnabled()) {
    return { enabled: false, managementEnabled: false, provisioningEnabled: false };
  }
  try {
    configuration();
    return {
      enabled: true,
      managementEnabled: isManagementEnabled(),
      provisioningEnabled: isProvisioningEnabled(),
    };
  } catch (error) {
    if (error.code === 'INSTALLATION_OPERATOR_CONFIGURATION_INVALID') {
      return { enabled: false, managementEnabled: false, provisioningEnabled: false };
    }
    throw error;
  }
}

module.exports = {
  assertManagementEnabled,
  assertProvisioningEnabled,
  createSession,
  getPublicStatus,
  isEnabled,
  isManagementEnabled,
  isProvisioningEnabled,
  revokeSession,
  verifySession,
};
