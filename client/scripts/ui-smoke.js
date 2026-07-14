import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const CLIENT_DIR = path.resolve(__dirname, '..');

function loadLocalEnv() {
  const envPath = path.join(CLIENT_DIR, '.env');
  if (!fs.existsSync(envPath)) return;

  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex === -1) continue;

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();
    if (key && process.env[key] === undefined) {
      process.env[key] = value.replace(/^["']|["']$/g, '');
    }
  }
}

loadLocalEnv();

function trimTrailingSlash(value) {
  return String(value || '').replace(/\/+$/, '');
}

function getDefaultBaseUrl() {
  const port =
    process.env.VITE_DEV_PORT ||
    process.env.VITE_PREVIEW_PORT ||
    '4173';

  return `http://127.0.0.1:${port}`;
}

function getDefaultApiUrl() {
  const baseUrl = trimTrailingSlash(
    process.env.VITE_API_URL || 'http://127.0.0.1:3004',
  );

  return baseUrl.endsWith('/api') ? baseUrl : `${baseUrl}/api`;
}

const BASE_URL = process.env.UI_SMOKE_BASE_URL || getDefaultBaseUrl();
const API_URL = process.env.UI_SMOKE_API_URL || getDefaultApiUrl();
const EMAIL = process.env.UI_SMOKE_EMAIL || 'owner@padelpark.demo';
const PASSWORD = process.env.UI_SMOKE_PASSWORD || 'Demo1234!';
const BROWSER_CHANNEL = String(process.env.UI_SMOKE_BROWSER_CHANNEL || '').trim();
const OUTPUT_DIR =
  process.env.UI_SMOKE_OUTPUT ||
  path.join(ROOT, 'outputs', 'qa', new Date().toISOString().slice(0, 10), 'ui-smoke');
const LAUNCH_ARGS = [
  '--disable-background-networking',
  '--disable-component-extensions-with-background-pages',
  '--disable-extensions',
];

const ROUTE_CHECKS = [
  { route: '/admin' },
  { route: '/admin/bookings' },
  { route: '/admin/clients' },
  { route: '/admin/trainer' },
  { route: '/admin/methodology' },
  {
    navRoute: '/admin/methodology',
    route: '/admin/methodology-analytics',
  },
  { route: '/admin/client-bases' },
  { route: '/admin/call-tasks' },
  {
    route: '/admin/prepayments',
    sentinel: '[data-testid="prepayments-metric-card"]',
    sentinelCount: 5,
  },
  { route: '/admin/telephony' },
  { route: '/admin/staff' },
  { route: '/admin/finances' },
  { route: '/admin/onboarding' },
  { route: '/admin/users' },
  { route: '/admin/visits-analytics' },
  { route: '/admin/utilization' },
  { route: '/admin/catalog' },
  { route: '/admin/references' },
  { route: '/admin/motivation' },
  { route: '/admin/audit' },
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

async function launchSmokeBrowser() {
  const attempts = [];
  if (BROWSER_CHANNEL) {
    attempts.push({
      label: `system ${BROWSER_CHANNEL}`,
      options: { channel: BROWSER_CHANNEL },
    });
  }
  attempts.push({ label: 'playwright chromium', options: {} });
  if (!BROWSER_CHANNEL) {
    attempts.push({
      label: 'system chrome',
      options: { channel: 'chrome' },
    });
  }

  const errors = [];
  for (const attempt of attempts) {
    try {
      const browser = await chromium.launch({
        ...attempt.options,
        args: LAUNCH_ARGS,
        headless: true,
      });
      return { browser, label: attempt.label };
    } catch (error) {
      errors.push(`${attempt.label}: ${error.message}`);
    }
  }

  throw new Error(
    [
      'Unable to launch a browser for UI smoke.',
      'Install Playwright Chromium with: npx playwright install chromium',
      ...errors,
    ].join('\n'),
  );
}

async function main() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const token = await login();
  const { browser, label: browserLabel } = await launchSmokeBrowser();
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
  for (const {
    route,
    navRoute = route,
    sentinel,
    sentinelCount = 1,
  } of ROUTE_CHECKS) {
    const startedAt = Date.now();
    await page.goto(`${BASE_URL}${route}`, {
      timeout: 15_000,
      waitUntil: 'domcontentloaded',
    });
    const mainContent = page.locator('main[data-slot="sidebar-inset"]');
    await mainContent.waitFor({ state: 'visible', timeout: 10_000 });
    await page.locator(
      `[data-sidebar-nav-item="true"][data-active="true"][href="${navRoute}"]`,
    ).waitFor({ state: 'visible', timeout: 10_000 });
    await page.waitForFunction(
      (main) => Boolean(main?.innerText?.trim()),
      await mainContent.elementHandle(),
      { timeout: 10_000 },
    );

    if (sentinel) {
      await page.locator(sentinel).first().waitFor({
        state: 'visible',
        timeout: 10_000,
      });
      const count = await page.locator(sentinel).count();
      if (count < sentinelCount) {
        throw new Error(
          `${route} expected at least ${sentinelCount} elements matching ${sentinel}, found ${count}`,
        );
      }
    }

    await page.waitForTimeout(500);
    await page.screenshot({
      fullPage: true,
      path: path.join(OUTPUT_DIR, screenshotName(route)),
    });
    results.push({
      mainContentReady: true,
      ms: Date.now() - startedAt,
      route,
      sentinel: sentinel || 'active sidebar route + non-empty main content',
    });
  }

  await browser.close();
  const report = { browser: browserLabel, messages, outputDir: OUTPUT_DIR, results };
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
