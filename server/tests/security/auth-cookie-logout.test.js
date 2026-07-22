'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const test = require('node:test');
const authController = require('../../src/controllers/auth.controller');
const authService = require('../../src/services/auth.service');

function request(server) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      method: 'POST',
      path: '/api/auth/logout',
      port: server.address().port,
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({
        body: Buffer.concat(chunks).toString('utf8'),
        headers: res.headers,
        status: res.statusCode,
      }));
    });
    req.once('error', reject);
    req.end();
  });
}

function assertExpiredCookies(response, { secure }) {
  const cookies = response.headers['set-cookie'] || [];
  assert.equal(cookies.length, 2);
  const authCookie = cookies.find((cookie) => cookie.startsWith('setly_session='));
  const csrfCookie = cookies.find((cookie) => cookie.startsWith('setly_csrf='));
  assert.ok(authCookie);
  assert.ok(csrfCookie);
  for (const cookie of [authCookie, csrfCookie]) {
    assert.match(cookie, /Path=\//u);
    assert.match(cookie, /SameSite=Lax/u);
    assert.match(cookie, /Max-Age=0/u);
    if (secure) assert.match(cookie, /Secure/u);
  }
  assert.match(authCookie, /HttpOnly/u);
  assert.doesNotMatch(csrfCookie, /HttpOnly/u);
}

test('logout clears browser cookies on revoke failure without leaking error details and on success', async (t) => {
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  let mode = 'failure';
  t.mock.method(authService, 'revokeCurrentSession', async () => {
    if (mode === 'failure') throw new Error('opaque-session-private-detail');
    return null;
  });

  const app = express();
  app.post('/api/auth/logout', (req, res) => authController.logout(req, res));
  const server = await new Promise((resolve, reject) => {
    const value = http.createServer(app);
    value.listen(0, '127.0.0.1', () => resolve(value));
    value.once('error', reject);
  });

  try {
    const failure = await request(server);
    assert.equal(failure.status, 503);
    assert.deepEqual(JSON.parse(failure.body), {
      error: 'Не удалось завершить сессию',
      status: 503,
    });
    assert.doesNotMatch(failure.body, /opaque-session-private-detail/u);
    assertExpiredCookies(failure, { secure: true });

    mode = 'success';
    const success = await request(server);
    assert.equal(success.status, 200);
    assert.deepEqual(JSON.parse(success.body), { success: true });
    assertExpiredCookies(success, { secure: true });
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
  }
});
