'use strict';

const crypto = require('crypto');

const AUTH_COOKIE_NAME = 'setly_session';
const CSRF_COOKIE_NAME = 'setly_csrf';
const CSRF_HEADER_NAME = 'X-CSRF-Token';
const SESSION_COOKIE_MAX_AGE_SECONDS = 12 * 60 * 60;
const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function parseCookies(header) {
  if (typeof header !== 'string' || !header) return Object.freeze({});
  const cookies = Object.create(null);
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator <= 0) continue;
    const name = part.slice(0, separator).trim();
    if (!name || Object.prototype.hasOwnProperty.call(cookies, name)) continue;
    const value = part.slice(separator + 1).trim();
    try {
      cookies[name] = decodeURIComponent(value);
    } catch {
      cookies[name] = value;
    }
  }
  return Object.freeze(cookies);
}

function getCookie(request, name) {
  return parseCookies(request?.headers?.cookie)[name] || '';
}

function isBrowserRequest(request) {
  return Boolean(
    request?.get?.('Origin') ||
      request?.get?.('Sec-Fetch-Site') ||
      request?.get?.('Sec-Fetch-Mode') ||
      request?.get?.('Sec-Fetch-Dest'),
  );
}

function shouldExposeBearerResponse(request) {
  // Existing CLI/API callers without browser fetch metadata retain the A5
  // bearer compatibility window. Browser responses never echo the opaque token.
  return !isBrowserRequest(request);
}

function newCsrfToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function serializeCookie(name, value, { maxAge, httpOnly, secure, sameSite = 'Lax', path = '/' } = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${path}`, `SameSite=${sameSite}`];
  if (Number.isFinite(maxAge)) parts.push(`Max-Age=${Math.max(0, Math.floor(maxAge))}`);
  if (httpOnly) parts.push('HttpOnly');
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

function appendSetCookie(response, value) {
  const existing = response.getHeader('Set-Cookie');
  const values = existing == null ? [] : Array.isArray(existing) ? existing : [existing];
  response.setHeader('Set-Cookie', [...values, value]);
}

function useSecureCookies(environment = process.env) {
  return environment.NODE_ENV === 'production';
}

function setBrowserSessionCookies(response, token, environment = process.env) {
  const secure = useSecureCookies(environment);
  appendSetCookie(
    response,
    serializeCookie(AUTH_COOKIE_NAME, token, {
      httpOnly: true,
      maxAge: SESSION_COOKIE_MAX_AGE_SECONDS,
      secure,
    }),
  );
  appendSetCookie(
    response,
    serializeCookie(CSRF_COOKIE_NAME, newCsrfToken(), {
      maxAge: SESSION_COOKIE_MAX_AGE_SECONDS,
      secure,
    }),
  );
}

function clearBrowserSessionCookies(response, environment = process.env) {
  const secure = useSecureCookies(environment);
  appendSetCookie(
    response,
    serializeCookie(AUTH_COOKIE_NAME, '', { httpOnly: true, maxAge: 0, secure }),
  );
  appendSetCookie(
    response,
    serializeCookie(CSRF_COOKIE_NAME, '', { maxAge: 0, secure }),
  );
}

function constantTimeEqual(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string' || !left || !right) return false;
  const leftBuffer = Buffer.from(left, 'utf8');
  const rightBuffer = Buffer.from(right, 'utf8');
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

module.exports = {
  AUTH_COOKIE_NAME,
  CSRF_COOKIE_NAME,
  CSRF_HEADER_NAME,
  SESSION_COOKIE_MAX_AGE_SECONDS,
  UNSAFE_METHODS,
  clearBrowserSessionCookies,
  constantTimeEqual,
  getCookie,
  isBrowserRequest,
  newCsrfToken,
  parseCookies,
  serializeCookie,
  setBrowserSessionCookies,
  shouldExposeBearerResponse,
  useSecureCookies,
};
