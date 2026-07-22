import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const require = createRequire(import.meta.url);
const {
  createBrowserOriginPolicy,
} = require('../../server/src/security/browser-origin-policy');
const {
  buildContentSecurityPolicyReportOnly,
} = require('../../server/src/middleware/browser-security');

const SCRIPT_REPORT_DIRECTIVE = /^script-src(?:-elem|-attr)?(?:\s|$)/u;
const SCRIPT_TAG_PATTERN = /<script\b([^>]*)>([\s\S]*?)<\/script>/giu;
const REPORT_WAIT_MS = 3_000;
const REPORT_BODY_LIMIT = 64 * 1024;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_DIR = path.resolve(__dirname, '..', 'dist');
const BUILT_INDEX_PATH = path.join(DIST_DIR, 'index.html');
const THEME_BOOTSTRAP_PATH = path.join(
  DIST_DIR,
  'assets',
  'theme-bootstrap.js',
);

const MIME_TYPES = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.ico', 'image/x-icon'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.woff2', 'font/woff2'],
]);

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitFor(predicate, timeoutMs = REPORT_WAIT_MS) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await delay(25);
  }
  assert.fail('Timed out waiting for the expected CSP report');
}

function reportDetails(report) {
  if (!report || typeof report !== 'object') return {};
  const body = report['csp-report'];
  return body && typeof body === 'object' ? body : report;
}

function scriptReports(reports) {
  return reports
    .map(reportDetails)
    .filter((report) => SCRIPT_REPORT_DIRECTIVE.test(String(
      report['effective-directive'] || report['violated-directive'] || '',
    )));
}

async function readReportBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > REPORT_BODY_LIMIT) return null;
    chunks.push(chunk);
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return null;
  }
}

function resolveStaticPath(pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  const filePath = path.resolve(DIST_DIR, decoded.replace(/^\/+/, ''));
  if (!filePath.startsWith(`${DIST_DIR}${path.sep}`)) return null;
  return filePath;
}

function sendStatic(response, filePath, csp) {
  if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    response.writeHead(404).end('Not found');
    return;
  }
  response.setHeader('Content-Security-Policy-Report-Only', csp);
  response.setHeader(
    'Content-Type',
    MIME_TYPES.get(path.extname(filePath)) || 'application/octet-stream',
  );
  response.end(fs.readFileSync(filePath));
}

async function launchBrowser() {
  const attempts = [
    { label: 'playwright chromium', options: {} },
    { label: 'system chrome', options: { channel: 'chrome' } },
  ];
  const errors = [];
  for (const attempt of attempts) {
    try {
      const browser = await chromium.launch({
        ...attempt.options,
        args: ['--disable-background-networking'],
        headless: true,
      });
      return { browser, label: attempt.label };
    } catch (error) {
      errors.push(`${attempt.label}: ${error.message}`);
    }
  }
  throw new Error(`Unable to launch Chromium. ${errors.join(' | ')}`);
}

assert.ok(fs.existsSync(BUILT_INDEX_PATH), 'client/dist/index.html is required');
assert.ok(
  fs.existsSync(THEME_BOOTSTRAP_PATH),
  'the built same-origin theme bootstrap asset is required',
);

const builtIndex = fs.readFileSync(BUILT_INDEX_PATH, 'utf8');
assert.match(
  builtIndex,
  /<script\s+src="\/assets\/theme-bootstrap\.js"><\/script>/u,
);
for (const [, attributes, body] of builtIndex.matchAll(SCRIPT_TAG_PATTERN)) {
  assert.ok(
    attributes.includes('src=') || body.trim() === '',
    'built index.html must not contain an app-owned inline script',
  );
}

let csp = '';
let foreignInlineIndex = '';
const receivedReports = [];
const server = http.createServer(async (request, response) => {
  const requestUrl = new URL(request.url, 'http://127.0.0.1');

  if (request.method === 'POST' && requestUrl.pathname === '/__csp-report') {
    const report = await readReportBody(request);
    if (report) receivedReports.push(report);
    response.writeHead(report ? 204 : 400).end();
    return;
  }

  if (requestUrl.pathname === '/__theme-seed') {
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.end('<!doctype html><title>Theme seed</title>');
    return;
  }

  if (requestUrl.pathname === '/foreign-inline') {
    response.setHeader('Content-Security-Policy-Report-Only', csp);
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.end(foreignInlineIndex);
    return;
  }

  if (requestUrl.pathname === '/') {
    sendStatic(response, BUILT_INDEX_PATH, csp);
    return;
  }

  if (
    requestUrl.pathname.startsWith('/api/')
    || requestUrl.pathname.startsWith('/socket.io/')
  ) {
    response.writeHead(404).end('Not found');
    return;
  }

  sendStatic(response, resolveStaticPath(requestUrl.pathname), csp);
});

let browser;
try {
  await listen(server);
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const originPolicy = createBrowserOriginPolicy({
    CLIENT_ORIGIN: baseUrl,
    NODE_ENV: 'test',
  });
  csp = buildContentSecurityPolicyReportOnly(originPolicy);
  foreignInlineIndex = builtIndex.replace(
    '</head>',
    '<script>window.__setlyForeignInlineProbe = true;</script></head>',
  );

  const launched = await launchBrowser();
  browser = launched.browser;
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto(`${baseUrl}/__theme-seed`, { waitUntil: 'load' });
  await page.evaluate(() => localStorage.setItem('crm-theme', 'dark'));

  const bootstrapResponsePromise = page.waitForResponse((candidate) => (
    new URL(candidate.url()).pathname === '/assets/theme-bootstrap.js'
  ));
  const appResponse = await page.goto(baseUrl, { waitUntil: 'load' });
  const bootstrapResponse = await bootstrapResponsePromise;
  assert.equal(appResponse?.headers()['content-security-policy-report-only'], csp);
  assert.equal(bootstrapResponse.status(), 200);
  assert.equal(
    await page.evaluate(() => document.documentElement.classList.contains('dark')),
    true,
  );
  await delay(500);
  assert.deepEqual(
    scriptReports(receivedReports),
    [],
    'the real built app must create no app-owned script-src report',
  );

  receivedReports.length = 0;
  await page.goto(`${baseUrl}/foreign-inline`, { waitUntil: 'load' });
  await waitFor(() => scriptReports(receivedReports).length > 0);
  const foreignReports = scriptReports(receivedReports);
  assert.equal(foreignReports.length, 1);
  assert.equal(foreignReports[0]['blocked-uri'], 'inline');
  assert.equal(
    await page.evaluate(() => window.__setlyForeignInlineProbe),
    true,
    'report-only CSP must report without changing current execution semantics',
  );

  process.stdout.write(`${JSON.stringify({
    appOwnedScriptReports: 0,
    browser: launched.label,
    foreignInlineBlockedUri: foreignReports[0]['blocked-uri'],
    foreignInlineDirective:
      foreignReports[0]['effective-directive']
      || foreignReports[0]['violated-directive'],
  })}\n`);
} finally {
  if (browser) await browser.close();
  if (server.listening) await close(server);
}
