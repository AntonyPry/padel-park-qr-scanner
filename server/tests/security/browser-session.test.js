'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const test = require('node:test');
const {
  AUTH_COOKIE_NAME,
  CSRF_COOKIE_NAME,
  CSRF_HEADER_NAME,
  clearBrowserSessionCookies,
  getCookie,
  setBrowserSessionCookies,
} = require('../../src/security/browser-session');
const {
  BROWSER_SESSION_PROTECTION_DENIED,
  createBrowserSessionProtection,
} = require('../../src/middleware/browser-session-protection');
const { createBrowserOriginPolicy } = require('../../src/security/browser-origin-policy');

const POLICY = createBrowserOriginPolicy({
  CLIENT_ORIGIN: 'https://setly.tech',
  CORS_ORIGIN: 'https://setly.tech',
  NODE_ENV: 'production',
});

function listen(server) {
  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => resolve(server));
    server.once('error', reject);
  });
}

function close(server) {
  return new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}

function url(server) {
  return `http://127.0.0.1:${server.address().port}/unsafe`;
}

test('browser session cookies are HttpOnly/Secure only for auth and expose no session token to JS', () => {
  const response = new http.ServerResponse({ method: 'GET' });
  setBrowserSessionCookies(response, 'setly_s1_test-token', { NODE_ENV: 'production' });
  const cookies = response.getHeader('Set-Cookie');
  assert.equal(Array.isArray(cookies), true);
  assert.equal(cookies.length, 2);
  const authCookie = cookies.find((value) => value.startsWith(`${AUTH_COOKIE_NAME}=`));
  const csrfCookie = cookies.find((value) => value.startsWith(`${CSRF_COOKIE_NAME}=`));
  assert.match(authCookie, /HttpOnly/u);
  assert.match(authCookie, /Secure/u);
  assert.match(authCookie, /SameSite=Lax/u);
  assert.match(authCookie, /Path=\//u);
  assert.doesNotMatch(csrfCookie, /HttpOnly/u);
  assert.match(csrfCookie, /Secure/u);
  assert.match(csrfCookie, /SameSite=Lax/u);
  assert.equal(getCookie({ headers: { cookie: authCookie.split(';', 1)[0] } }, AUTH_COOKIE_NAME), 'setly_s1_test-token');
  assert.equal(getCookie({ headers: { cookie: csrfCookie.split(';', 1)[0] } }, CSRF_COOKIE_NAME).length, 43);

  clearBrowserSessionCookies(response, { NODE_ENV: 'production' });
  const cleared = response.getHeader('Set-Cookie').slice(-2);
  assert.ok(cleared.every((value) => /Max-Age=0/u.test(value)));
});

test('cookie-auth unsafe requests require exact allowed Origin and double-submit CSRF token', async () => {
  const app = express();
  app.use(createBrowserSessionProtection(POLICY));
  app.post('/unsafe', (_req, res) => res.json({ ok: true }));
  app.post('/__csp-report', (_req, res) => res.status(204).end());
  const server = await listen(http.createServer(app));
  const csrf = 'csrf-test-token';
  const cookie = `${AUTH_COOKIE_NAME}=setly_s1_test-token; ${CSRF_COOKIE_NAME}=${csrf}`;
  try {
    const cases = [
      { name: 'same allowed origin', headers: { Cookie: cookie, Origin: 'https://setly.tech', [CSRF_HEADER_NAME]: csrf }, status: 200 },
      { name: 'foreign origin', headers: { Cookie: cookie, Origin: 'https://attacker.test', [CSRF_HEADER_NAME]: csrf }, status: 403 },
      { name: 'absent origin', headers: { Cookie: cookie, [CSRF_HEADER_NAME]: csrf }, status: 403 },
      { name: 'malformed origin', headers: { Cookie: cookie, Origin: 'not-an-origin', [CSRF_HEADER_NAME]: csrf }, status: 403 },
      { name: 'missing csrf', headers: { Cookie: cookie, Origin: 'https://setly.tech' }, status: 403 },
      { name: 'wrong csrf', headers: { Cookie: cookie, Origin: 'https://setly.tech', [CSRF_HEADER_NAME]: 'wrong' }, status: 403 },
    ];
    for (const item of cases) {
      const response = await fetch(url(server), { headers: item.headers, method: 'POST' });
      assert.equal(response.status, item.status, item.name);
      if (item.status === 403) {
        assert.deepEqual(await response.json(), {
          code: BROWSER_SESSION_PROTECTION_DENIED,
          error: 'Browser session protection failed',
          status: 403,
        });
      }
    }

    const safe = await fetch(url(server), { headers: { Cookie: cookie }, method: 'GET' });
    assert.notEqual(safe.status, 403);
    const report = await fetch(`${url(server).replace('/unsafe', '/__csp-report')}`, {
      headers: { Cookie: `${AUTH_COOKIE_NAME}=setly_s1_test-token` },
      method: 'POST',
    });
    assert.equal(report.status, 204);
  } finally {
    await close(server);
  }
});
