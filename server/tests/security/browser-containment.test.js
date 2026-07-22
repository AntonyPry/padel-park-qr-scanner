'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const express = require('express');
const createApp = require('../../src/app');
const {
  CORS_METHODS,
  CORS_ORIGIN_DENIED,
  CSP_REPORT_MAX_BYTES,
  CSP_REPORT_PATH,
  STRICT_TRANSPORT_SECURITY,
  createSecurityHeadersMiddleware,
  resolveHstsEnabled,
} = require('../../src/middleware/browser-security');
const {
  LOCAL_BROWSER_ORIGINS,
  createBrowserOriginPolicy,
  isSameOriginHostRequest,
} = require('../../src/security/browser-origin-policy');
const {
  createSocketCorsOptions,
  createSocketServer,
} = require('../../src/sockets');

const PRODUCT_ORIGINS = 'https://setly.tech,https://www.setly.tech';
const PRODUCT_POLICY = createBrowserOriginPolicy({
  CLIENT_ORIGIN: PRODUCT_ORIGINS,
  CORS_ORIGIN: 'https://www.setly.tech,https://setly.tech',
  NODE_ENV: 'production',
});
const SECURITY_HEADERS = Object.freeze({
  'content-security-policy-report-only': /default-src 'self'/u,
  'permissions-policy': /camera=\(\)/u,
  'referrer-policy': /^no-referrer$/u,
  'x-content-type-options': /^nosniff$/u,
  'x-frame-options': /^DENY$/u,
});

function listen(server) {
  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => resolve(server));
    server.once('error', reject);
  });
}

function closeServer(server) {
  if (!server?.listening) return Promise.resolve();
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function serverUrl(server, pathname) {
  return `http://127.0.0.1:${server.address().port}${pathname}`;
}

function rawHttpRequest(server, { headers, method = 'GET', pathname }) {
  return new Promise((resolve, reject) => {
    const request = http.request({
      headers,
      host: '127.0.0.1',
      method,
      path: pathname,
      port: server.address().port,
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve({
        body: Buffer.concat(chunks).toString('utf8'),
        headers: {
          get(name) {
            const value = response.headers[name.toLowerCase()];
            return Array.isArray(value) ? value.join(', ') : value ?? null;
          },
        },
        status: response.statusCode,
      }));
    });
    request.once('error', reject);
    request.end();
  });
}

function assertSecurityHeaders(response, { hsts = false } = {}) {
  for (const [name, pattern] of Object.entries(SECURITY_HEADERS)) {
    assert.match(response.headers.get(name) || '', pattern, name);
  }
  assert.equal(
    response.headers.get('strict-transport-security'),
    hsts ? STRICT_TRANSPORT_SECURITY : null,
  );

  const csp = response.headers.get('content-security-policy-report-only');
  assert.match(csp, /frame-ancestors 'none'/u);
  assert.match(csp, /connect-src[^;]*https:\/\/setly\.tech/u);
  assert.match(csp, /connect-src[^;]*wss:\/\/setly\.tech/u);
  assert.match(csp, new RegExp(`report-uri ${CSP_REPORT_PATH}$`, 'u'));
  assert.doesNotMatch(csp, /report-to/u);
}

function assertOriginConfigurationError(environment, reason) {
  assert.throws(
    () => createBrowserOriginPolicy(environment),
    (error) => error.code === 'BROWSER_ORIGIN_CONFIGURATION_INVALID'
      && error.reason === reason,
  );
}

test('origin parser is exact, production fail-closed and locally bounded', () => {
  assert.deepEqual(PRODUCT_POLICY.allowedOrigins, [
    'https://setly.tech',
    'https://www.setly.tech',
  ]);
  assert.equal(PRODUCT_POLICY.isAllowed('https://setly.tech'), true);
  assert.equal(PRODUCT_POLICY.isAllowed('https://www.setly.tech'), true);
  assert.equal(PRODUCT_POLICY.isAllowed('https://attacker.test'), false);
  assert.equal(PRODUCT_POLICY.isAllowed('*'), false);
  assert.equal(PRODUCT_POLICY.isAllowed(undefined), false);

  assertOriginConfigurationError(
    { NODE_ENV: 'production' },
    'production_origin_list_required',
  );
  assertOriginConfigurationError(
    { CLIENT_ORIGIN: '*', NODE_ENV: 'production' },
    'origin_url_invalid',
  );
  assertOriginConfigurationError(
    {
      CLIENT_ORIGIN: 'https://setly.tech,https://setly.tech',
      NODE_ENV: 'production',
    },
    'origin_list_contains_duplicate',
  );
  assertOriginConfigurationError(
    { CLIENT_ORIGIN: 'https://setly.tech,', NODE_ENV: 'production' },
    'origin_list_contains_empty_entry',
  );
  assertOriginConfigurationError(
    { CLIENT_ORIGIN: 'http://setly.tech', NODE_ENV: 'production' },
    'production_origin_requires_https',
  );
  assertOriginConfigurationError(
    { CLIENT_ORIGIN: 'https://ops.setly.tech', NODE_ENV: 'production' },
    'operator_origin_is_not_product_origin',
  );
  assertOriginConfigurationError(
    { CLIENT_ORIGIN: 'http://ops.setly.tech:8080', NODE_ENV: 'test' },
    'operator_origin_is_not_product_origin',
  );
  assertOriginConfigurationError(
    {
      CLIENT_ORIGIN: 'https://setly.tech',
      CORS_ORIGIN: 'https://www.setly.tech',
      NODE_ENV: 'production',
    },
    'client_and_cors_origins_differ',
  );

  const sensitiveInvalidOrigin =
    'https://setly.tech/callback/value?token=not-a-real-token';
  assert.throws(
    () => createBrowserOriginPolicy({
      CLIENT_ORIGIN: sensitiveInvalidOrigin,
      NODE_ENV: 'production',
    }),
    (error) => error.code === 'BROWSER_ORIGIN_CONFIGURATION_INVALID'
      && !error.message.includes(sensitiveInvalidOrigin)
      && !JSON.stringify(error).includes(sensitiveInvalidOrigin),
  );

  const localPolicy = createBrowserOriginPolicy({ NODE_ENV: 'test' });
  assert.equal(localPolicy.source, 'bounded_local_default');
  assert.deepEqual(localPolicy.allowedOrigins, [...LOCAL_BROWSER_ORIGINS]);
  assert.equal(localPolicy.isAllowed('http://127.0.0.1:5173'), true);
  assert.equal(localPolicy.isAllowed('http://127.0.0.1:7777'), false);
});

test('same-origin operator requests stay outside the product CORS allowlist', () => {
  assert.equal(PRODUCT_POLICY.isAllowed('https://ops.setly.tech'), false);
  assert.equal(
    isSameOriginHostRequest('https://ops.setly.tech', 'ops.setly.tech'),
    true,
  );
  assert.equal(
    isSameOriginHostRequest('https://ops.setly.tech', 'ops.setly.tech:443'),
    true,
  );
  assert.equal(
    isSameOriginHostRequest('http://ops.setly.tech', 'ops.setly.tech'),
    true,
  );
  assert.equal(
    isSameOriginHostRequest('https://attacker.test', 'setly.tech'),
    false,
  );
  assert.equal(isSameOriginHostRequest('null', 'ops.setly.tech'), false);
});

test('Express CORS and baseline headers cover API, static, denial, 404 and errors', async () => {
  const publicDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'setly-a8-static-'));
  fs.writeFileSync(path.join(publicDirectory, 'asset.txt'), 'static response');
  const previousHsts = process.env.SECURITY_HSTS_ENABLED;
  const previousTlsReady = process.env.SECURITY_HSTS_TLS_READY;
  const previousMaintenance = process.env.SETLY_ROLLOUT_MAINTENANCE_MODE;
  delete process.env.SECURITY_HSTS_ENABLED;
  delete process.env.SECURITY_HSTS_TLS_READY;
  process.env.SETLY_ROLLOUT_MAINTENANCE_MODE = 'off';

  const app = createApp({
    browserOriginPolicy: PRODUCT_POLICY,
    publicDirectory,
  });
  const server = await listen(http.createServer(app));

  try {
    for (const origin of ['https://setly.tech', 'https://www.setly.tech']) {
      const response = await fetch(serverUrl(server, '/api/openapi.json'), {
        headers: { Origin: origin },
      });
      assert.equal(response.status, 503);
      assert.equal(response.headers.get('access-control-allow-origin'), origin);
      assert.equal(response.headers.get('access-control-allow-credentials'), null);
      const exposed = new Set(
        (response.headers.get('access-control-expose-headers') || '')
          .split(',')
          .map((value) => value.trim().toLowerCase()),
      );
      assert.equal(exposed.has('x-onboarding-completed-task-keys'), true);
      assert.equal(exposed.has('x-onboarding-progressed-task-keys'), true);
      assertSecurityHeaders(response);
    }

    const preflight = await fetch(serverUrl(server, '/api/auth/login'), {
      headers: {
        'Access-Control-Request-Headers':
          'Authorization,Content-Type,X-Organization-Id,X-Onboarding-Quest-Task-Key',
        'Access-Control-Request-Method': 'POST',
        Origin: 'https://setly.tech',
      },
      method: 'OPTIONS',
    });
    assert.equal(preflight.status, 204);
    assert.equal(
      preflight.headers.get('access-control-allow-origin'),
      'https://setly.tech',
    );
    assert.deepEqual(
      new Set((preflight.headers.get('access-control-allow-methods') || '').split(',')),
      new Set(CORS_METHODS),
    );
    assert.equal(
      preflight.headers.get('access-control-allow-headers'),
      'Authorization,Content-Type,X-Organization-Id,X-Onboarding-Quest-Task-Key',
    );
    assert.equal(preflight.headers.get('access-control-allow-credentials'), null);
    assertSecurityHeaders(preflight);

    for (const deniedOrigin of ['https://attacker.test', 'null', '*']) {
      const denied = await fetch(serverUrl(
        server,
        '/api/openapi.json?capability=not-a-real-secret',
      ), { headers: { Origin: deniedOrigin } });
      assert.equal(denied.status, 403);
      assert.equal(denied.headers.get('access-control-allow-origin'), null);
      assert.deepEqual(await denied.json(), {
        code: CORS_ORIGIN_DENIED,
        error: 'Browser origin is not allowed',
        status: 403,
      });
      assertSecurityHeaders(denied);
    }

    const deniedPreflight = await fetch(serverUrl(server, '/api/auth/login'), {
      headers: {
        'Access-Control-Request-Headers': 'Authorization',
        'Access-Control-Request-Method': 'POST',
        Origin: 'https://attacker.test',
      },
      method: 'OPTIONS',
    });
    assert.equal(deniedPreflight.status, 403);
    assert.equal(deniedPreflight.headers.get('access-control-allow-origin'), null);
    assert.equal((await deniedPreflight.json()).code, CORS_ORIGIN_DENIED);

    const withoutOrigin = await fetch(serverUrl(server, '/api/openapi.json'));
    assert.equal(withoutOrigin.status, 503);
    assert.equal(withoutOrigin.headers.get('access-control-allow-origin'), null);
    assertSecurityHeaders(withoutOrigin);

    const operatorSameOrigin = await rawHttpRequest(server, {
      headers: {
        Host: 'ops.setly.tech',
        Origin: 'https://ops.setly.tech',
      },
      pathname: '/api/openapi.json',
    });
    assert.equal(operatorSameOrigin.status, 503);
    assert.equal(operatorSameOrigin.headers.get('access-control-allow-origin'), null);
    assertSecurityHeaders(operatorSameOrigin);

    const staticResponse = await fetch(serverUrl(server, '/asset.txt'), {
      headers: { Origin: 'https://setly.tech' },
    });
    assert.equal(staticResponse.status, 200);
    assert.equal(await staticResponse.text(), 'static response');
    assertSecurityHeaders(staticResponse);

    const notFound = await fetch(serverUrl(server, '/missing'));
    assert.equal(notFound.status, 404);
    assertSecurityHeaders(notFound);

    const originalParserConsoleError = console.error;
    console.error = () => {};
    let parserError;
    try {
      parserError = await fetch(serverUrl(server, '/invalid-json'), {
        body: '{',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'https://setly.tech',
        },
        method: 'POST',
      });
    } finally {
      console.error = originalParserConsoleError;
    }
    assert.equal(parserError.status, 400);
    assertSecurityHeaders(parserError);

    const capturedConsole = [];
    const originals = {
      error: console.error,
      log: console.log,
      warn: console.warn,
    };
    console.error = (...values) => capturedConsole.push(values);
    console.log = (...values) => capturedConsole.push(values);
    console.warn = (...values) => capturedConsole.push(values);
    try {
      const discardedReport = await fetch(serverUrl(
        server,
        `${CSP_REPORT_PATH}?capability=query-value`,
      ), {
        body: JSON.stringify({
          'csp-report': {
            'blocked-uri': 'https://blocked.example/not-a-real-token',
            'document-uri': 'https://setly.tech/private?person=example',
          },
        }),
        headers: {
          'Content-Type': 'application/csp-report',
          Origin: 'https://setly.tech',
        },
        method: 'POST',
      });
      assert.equal(discardedReport.status, 204);
      assert.equal(await discardedReport.text(), '');
      assertSecurityHeaders(discardedReport);

      const oversizedReport = await fetch(serverUrl(
        server,
        `${CSP_REPORT_PATH}?capability=another-query-value`,
      ), {
        body: 'x'.repeat(CSP_REPORT_MAX_BYTES + 1),
        headers: {
          'Content-Type': 'application/csp-report',
          Origin: 'https://setly.tech',
        },
        method: 'POST',
      });
      assert.equal(oversizedReport.status, 413);
      assert.deepEqual(await oversizedReport.json(), {
        code: 'CSP_REPORT_REJECTED',
        error: 'CSP report rejected',
        status: 413,
      });

      process.env.SETLY_ROLLOUT_MAINTENANCE_MODE = 'full-stop';
      const maintenanceReport = await fetch(serverUrl(server, CSP_REPORT_PATH), {
        body: JSON.stringify({
          'csp-report': { 'document-uri': 'https://setly.tech/private-value' },
        }),
        headers: {
          'Content-Type': 'application/csp-report',
          Origin: 'https://setly.tech',
        },
        method: 'POST',
      });
      assert.equal(maintenanceReport.status, 503);
      assert.equal((await maintenanceReport.json()).code, 'ROLLOUT_MAINTENANCE_ACTIVE');
      process.env.SETLY_ROLLOUT_MAINTENANCE_MODE = 'off';

      const rejectedSensitiveRequest = await fetch(serverUrl(
        server,
        '/api/integrations/beeline/events/public-id/callback-value?token=query-value',
      ), {
        body: JSON.stringify({ email: 'person@example.test' }),
        headers: {
          Authorization: 'Bearer not-a-real-session',
          'Content-Type': 'application/json',
          Origin: 'https://attacker.test',
        },
        method: 'POST',
      });
      const body = await rejectedSensitiveRequest.text();
      assert.equal(rejectedSensitiveRequest.status, 403);
      assert.equal(body.includes('callback-value'), false);
      assert.equal(body.includes('query-value'), false);
      assert.equal(body.includes('person@example.test'), false);
      assert.equal(body.includes('not-a-real-session'), false);
    } finally {
      console.error = originals.error;
      console.log = originals.log;
      console.warn = originals.warn;
    }
    assert.deepEqual(capturedConsole, []);
  } finally {
    await closeServer(server);
    fs.rmSync(publicDirectory, { force: true, recursive: true });
    if (previousHsts === undefined) delete process.env.SECURITY_HSTS_ENABLED;
    else process.env.SECURITY_HSTS_ENABLED = previousHsts;
    if (previousTlsReady === undefined) delete process.env.SECURITY_HSTS_TLS_READY;
    else process.env.SECURITY_HSTS_TLS_READY = previousTlsReady;
    if (previousMaintenance === undefined) {
      delete process.env.SETLY_ROLLOUT_MAINTENANCE_MODE;
    } else {
      process.env.SETLY_ROLLOUT_MAINTENANCE_MODE = previousMaintenance;
    }
  }
});

test('HSTS requires explicit production and verified-TLS gates', async () => {
  assert.equal(resolveHstsEnabled(PRODUCT_POLICY, {
    NODE_ENV: 'production',
    SECURITY_HSTS_ENABLED: 'false',
    SECURITY_HSTS_TLS_READY: 'false',
  }), false);
  assert.throws(
    () => resolveHstsEnabled(PRODUCT_POLICY, {
      NODE_ENV: 'production',
      SECURITY_HSTS_ENABLED: 'true',
      SECURITY_HSTS_TLS_READY: 'false',
    }),
    (error) => error.code === 'HTTP_SECURITY_CONFIGURATION_INVALID'
      && error.reason === 'hsts_requires_tls_ready',
  );
  assert.throws(
    () => resolveHstsEnabled(PRODUCT_POLICY, {
      NODE_ENV: 'test',
      SECURITY_HSTS_ENABLED: 'true',
      SECURITY_HSTS_TLS_READY: 'true',
    }),
    (error) => error.code === 'HTTP_SECURITY_CONFIGURATION_INVALID'
      && error.reason === 'hsts_requires_production',
  );

  const app = express();
  app.use(createSecurityHeadersMiddleware(PRODUCT_POLICY, {
    NODE_ENV: 'production',
    SECURITY_HSTS_ENABLED: 'true',
    SECURITY_HSTS_TLS_READY: 'true',
  }));
  app.get('/headers', (_req, res) => res.send('ok'));
  const server = await listen(http.createServer(app));
  try {
    const response = await fetch(serverUrl(server, '/headers'));
    assert.equal(response.status, 200);
    assertSecurityHeaders(response, { hsts: true });
  } finally {
    await closeServer(server);
  }
});

test('Socket.IO uses the same exact product-origin decision independently', async () => {
  const options = createSocketCorsOptions(PRODUCT_POLICY);
  const decide = (origin) => new Promise((resolve) => {
    options.origin(origin, (error, allowed) => resolve({ allowed, error }));
  });

  for (const allowedOrigin of ['https://setly.tech', 'https://www.setly.tech']) {
    const decision = await decide(allowedOrigin);
    assert.equal(decision.error, null);
    assert.equal(decision.allowed, true);
  }
  const withoutOrigin = await decide(undefined);
  assert.equal(withoutOrigin.error, null);
  assert.equal(withoutOrigin.allowed, true);
  for (const deniedOrigin of ['https://attacker.test', 'https://ops.setly.tech', '*']) {
    const decision = await decide(deniedOrigin);
    assert.equal(decision.allowed, undefined);
    assert.equal(decision.error.code, 'SOCKET_ORIGIN_DENIED');
    assert.equal(decision.error.message.includes(deniedOrigin), false);
  }

  const httpServer = http.createServer();
  const io = createSocketServer(httpServer, {
    browserOriginPolicy: PRODUCT_POLICY,
  });
  await listen(httpServer);
  const endpoint = () => serverUrl(
    httpServer,
    `/socket.io/?EIO=4&transport=polling&t=${Date.now()}`,
  );
  try {
    const allowed = await fetch(endpoint(), {
      headers: { Origin: 'https://setly.tech' },
    });
    assert.equal(allowed.status, 200);
    assert.equal(
      allowed.headers.get('access-control-allow-origin'),
      'https://setly.tech',
    );
    await allowed.text();

    const missing = await fetch(endpoint());
    assert.equal(missing.status, 200);
    assert.equal(missing.headers.get('access-control-allow-origin'), null);
    await missing.text();

    for (const deniedOrigin of ['https://attacker.test', '*']) {
      const denied = await fetch(endpoint(), {
        headers: { Origin: deniedOrigin },
      });
      assert.notEqual(denied.status, 200);
      assert.equal(denied.headers.get('access-control-allow-origin'), null);
      const body = await denied.text();
      assert.equal(body.includes(deniedOrigin), false);
    }
  } finally {
    await io.close();
    await closeServer(httpServer);
  }
});
