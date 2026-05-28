import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');

const BASE_URL = process.env.UI_SMOKE_BASE_URL || 'http://127.0.0.1:4173';
const API_URL = process.env.UI_SMOKE_API_URL || 'http://127.0.0.1:3004/api';
const EMAIL = process.env.UI_SMOKE_EMAIL || 'owner@padelpark.demo';
const PASSWORD = process.env.UI_SMOKE_PASSWORD || 'Demo1234!';
const OUTPUT_DIR =
  process.env.UI_SMOKE_OUTPUT ||
  path.join(ROOT, 'outputs', 'qa', new Date().toISOString().slice(0, 10), 'ui-smoke');

const ROUTES = [
  '/admin',
  '/admin/bookings',
  '/admin/clients',
  '/admin/trainer',
  '/admin/client-bases',
  '/admin/call-tasks',
  '/admin/staff',
  '/admin/finances',
  '/admin/users',
  '/admin/visits-analytics',
  '/admin/utilization',
  '/admin/catalog',
  '/admin/references',
  '/admin/motivation',
  '/admin/audit',
];

function screenshotName(route) {
  return `${route.replace(/^\/admin$/, 'admin').replace(/^\/admin\//, 'admin_').replaceAll('/', '_')}.png`;
}

async function login() {
  const response = await fetch(`${API_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });

  if (!response.ok) {
    throw new Error(`Login failed: ${response.status}`);
  }

  const data = await response.json();
  const token = data.token || data.data?.token;
  if (!token) throw new Error('Login response does not contain token');
  return token;
}

async function main() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const token = await login();
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: [
      '--disable-background-networking',
      '--disable-component-extensions-with-background-pages',
      '--disable-extensions',
    ],
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const messages = [];

  page.on('console', (message) => {
    if (['warning', 'error'].includes(message.type())) {
      messages.push(`${message.type()}: ${message.text()}`);
    }
  });
  page.on('pageerror', (error) => {
    messages.push(`pageerror: ${error.message}`);
  });

  await page.addInitScript((authToken) => {
    localStorage.setItem('padel_park_auth_token', authToken);
    Object.defineProperty(navigator, 'serial', {
      configurable: true,
      value: {
        getPorts: async () => [],
        requestPort: async () => ({
          close: async () => {},
          open: async () => {},
          readable: null,
          writable: null,
        }),
      },
    });
  }, token);

  const results = [];
  for (const route of ROUTES) {
    const startedAt = Date.now();
    await page.goto(`${BASE_URL}${route}`, {
      timeout: 15_000,
      waitUntil: 'domcontentloaded',
    });
    await page.waitForSelector('h1', { timeout: 10_000 });
    await page.waitForTimeout(500);
    const h1 = await page.locator('h1').first().innerText();
    await page.screenshot({
      fullPage: true,
      path: path.join(OUTPUT_DIR, screenshotName(route)),
    });
    results.push({ h1, ms: Date.now() - startedAt, route });
  }

  await browser.close();
  const report = { messages, outputDir: OUTPUT_DIR, results };
  fs.writeFileSync(path.join(OUTPUT_DIR, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));

  if (messages.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
