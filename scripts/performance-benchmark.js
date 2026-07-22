#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_BASE_URL = 'http://127.0.0.1:3004';

const ENDPOINTS = [
  {
    name: 'auth.me',
    path: '/api/auth/me',
  },
  {
    name: 'clients.list',
    path: '/api/clients?page=1&pageSize=10&status=active',
  },
  {
    name: 'clients.search',
    path: '/api/clients?page=1&pageSize=10&status=active&q=%D0%B0',
  },
  {
    name: 'clients.duplicates',
    path: '/api/clients/duplicates',
  },
  {
    name: 'clientBases.list',
    path: '/api/client-bases?status=active',
  },
  {
    name: 'callTasks.list',
    path: '/api/call-tasks?status=active',
  },
  {
    name: 'callTasks.report',
    path: '/api/call-tasks/report?status=active',
  },
  {
    name: 'finance.pnl',
    path: '/api/finance?from=2026-05-01&to=2026-05-31',
  },
  {
    name: 'finance.payroll',
    path: '/api/finance/payroll?from=2026-05-01&to=2026-05-31',
  },
  {
    name: 'access.visits',
    path: '/api/visits',
  },
  {
    name: 'scanner.events',
    path: '/api/scanner-events?limit=30',
  },
  {
    name: 'motivation.currentSales',
    path: '/api/motivation/current-sales',
  },
  {
    name: 'analytics.visits',
    path: '/api/analytics/visits?from=2026-05-01&to=2026-05-31',
  },
  {
    name: 'audit.list',
    path: '/api/audit-logs?page=1&pageSize=25',
  },
];

function parseArgs(argv) {
  const options = {
    baseUrl: process.env.PERF_BASE_URL || DEFAULT_BASE_URL,
    email: process.env.PERF_EMAIL || 'owner@padelpark.demo',
    password: process.env.PERF_PASSWORD || 'Demo1234!',
    label: process.env.PERF_LABEL || 'baseline',
    samples: Number(process.env.PERF_SAMPLES || 15),
    timeoutMs: Number(process.env.PERF_ENDPOINT_TIMEOUT_MS || 30000),
    warmup: Number(process.env.PERF_WARMUP || 3),
  };

  argv.forEach((arg) => {
    const [key, value] = arg.replace(/^--/, '').split('=');
    if (!key || value === undefined) return;
    if (key === 'base-url') options.baseUrl = value;
    if (key === 'email') options.email = value;
    if (key === 'password') options.password = value;
    if (key === 'label') options.label = value;
    if (key === 'samples') options.samples = Number(value);
    if (key === 'timeout-ms') options.timeoutMs = Number(value);
    if (key === 'warmup') options.warmup = Number(value);
  });

  options.samples = Math.max(1, Math.min(100, options.samples || 15));
  options.timeoutMs = Math.max(1000, Math.min(120000, options.timeoutMs || 30000));
  options.warmup = Math.max(0, Math.min(20, options.warmup || 3));
  return options;
}

function percentile(values, percent) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((percent / 100) * sorted.length) - 1),
  );
  return sorted[index];
}

function roundMs(value) {
  return Math.round(value * 10) / 10;
}

function appendCacheBust(url, index) {
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}_perf=${Date.now()}_${index}`;
}

async function fetchJson(url, options = {}) {
  const timeoutMs = options.timeoutMs || 30000;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = performance.now();
  try {
    const { timeoutMs: _, ...fetchOptions } = options;
    const response = await fetch(url, {
      ...fetchOptions,
      signal: controller.signal,
    });
    const text = await response.text();
    const durationMs = performance.now() - startedAt;
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }

    return {
      data,
      durationMs,
      ok: response.ok,
      sizeBytes: Buffer.byteLength(text),
      status: response.status,
    };
  } catch (error) {
    return {
      data: null,
      durationMs: performance.now() - startedAt,
      error: error.name === 'AbortError' ? `timeout ${timeoutMs}ms` : error.message,
      ok: false,
      sizeBytes: 0,
      status: 0,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function login(options) {
  const response = await fetchJson(`${options.baseUrl}/api/auth/login`, {
    body: JSON.stringify({
      email: options.email,
      password: options.password,
    }),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  });

  if (!response.ok || !response.data?.token) {
    throw new Error(
      `Login failed with HTTP ${response.status}: ${JSON.stringify(response.data)}`,
    );
  }

  const token = response.data.token;
  const discovery = await fetchJson(
    `${options.baseUrl}/api/auth/me/memberships`,
    { headers: { authorization: `Bearer ${token}` }, timeoutMs: options.timeoutMs },
  );
  if (!discovery.ok || !discovery.data?.recommendedContext?.clubId) {
    throw new Error('Performance account has no exact recommended Organization/Club');
  }
  return { context: discovery.data.recommendedContext, token };
}

async function measureEndpoint({ endpoint, options, session }) {
  const samples = [];
  let error = null;
  let status = null;
  let sizeBytes = 0;

  for (let index = 0; index < options.warmup + options.samples; index += 1) {
    const response = await fetchJson(
      appendCacheBust(`${options.baseUrl}${endpoint.path}`, index),
      {
        headers: {
          authorization: `Bearer ${session.token}`,
          'x-organization-id': String(session.context.organizationId),
          'x-club-id': String(session.context.clubId),
        },
        timeoutMs: options.timeoutMs,
      },
    );

    if (!response.ok) {
      error =
        response.error ||
        `HTTP ${response.status}: ${JSON.stringify(response.data)}`;
      status = response.status;
      samples.push(response.durationMs);
      break;
    }

    if (index >= options.warmup) {
      samples.push(response.durationMs);
      status = response.status;
      sizeBytes = Math.max(sizeBytes, response.sizeBytes);
    }
  }

  return {
    error,
    maxMs: roundMs(Math.max(...samples)),
    meanMs: roundMs(samples.reduce((sum, value) => sum + value, 0) / samples.length),
    minMs: roundMs(Math.min(...samples)),
    name: endpoint.name,
    p50Ms: roundMs(percentile(samples, 50)),
    p95Ms: roundMs(percentile(samples, 95)),
    path: endpoint.path,
    samples: samples.map(roundMs),
    sizeBytes,
    status,
  };
}

function getBundleStats() {
  const distDir = path.join(ROOT, 'client', 'dist');
  if (!fs.existsSync(distDir)) {
    return {
      files: [],
      totalBytes: 0,
      totalGzipBytes: 0,
    };
  }

  const files = [];
  const walk = (dir) => {
    fs.readdirSync(dir, { withFileTypes: true }).forEach((entry) => {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
        return;
      }

      const buffer = fs.readFileSync(fullPath);
      files.push({
        gzipBytes: zlib.gzipSync(buffer).length,
        path: path.relative(distDir, fullPath),
        sizeBytes: buffer.length,
      });
    });
  };

  walk(distDir);
  files.sort((a, b) => b.sizeBytes - a.sizeBytes);

  return {
    files,
    totalBytes: files.reduce((sum, file) => sum + file.sizeBytes, 0),
    totalGzipBytes: files.reduce((sum, file) => sum + file.gzipBytes, 0),
  };
}

async function getDbCounts() {
  try {
    const db = require(path.join(ROOT, 'server', 'models'));
    const counts = {};
    const modelNames = [
      'User',
      'Visit',
      'Receipt',
      'ReceiptItem',
      'CallTask',
      'CallTaskClient',
      'ClientBase',
      'Finance',
      'Shift',
      'AuditLog',
    ];

    for (const modelName of modelNames) {
      if (!db[modelName]) continue;
      counts[modelName] = await db[modelName].count();
    }

    await db.sequelize.close();
    return counts;
  } catch (error) {
    return {
      error: error.message,
    };
  }
}

function bytesLabel(value) {
  if (value > 1024 * 1024) return `${(value / 1024 / 1024).toFixed(2)} MB`;
  if (value > 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${value} B`;
}

function renderMarkdown(report) {
  const endpointRows = report.endpoints
    .map(
      (item) =>
        `| ${item.name}${item.error ? ` (${item.error})` : ''} | ${item.p50Ms} | ${item.p95Ms} | ${item.meanMs} | ${bytesLabel(item.sizeBytes)} |`,
    )
    .join('\n');
  const bundleRows = report.bundle.files
    .slice(0, 8)
    .map(
      (item) =>
        `| ${item.path} | ${bytesLabel(item.sizeBytes)} | ${bytesLabel(item.gzipBytes)} |`,
    )
    .join('\n');

  return [
    `# Performance ${report.label}`,
    '',
    `Дата: ${report.createdAt}`,
    `Base URL: ${report.baseUrl}`,
    '',
    '## Данные',
    '',
    '```json',
    JSON.stringify(report.dbCounts, null, 2),
    '```',
    '',
    '## API',
    '',
    '| Endpoint | p50 ms | p95 ms | mean ms | max response |',
    '|---|---:|---:|---:|---:|',
    endpointRows,
    '',
    '## Frontend bundle',
    '',
    `Total: ${bytesLabel(report.bundle.totalBytes)} / gzip ${bytesLabel(report.bundle.totalGzipBytes)}`,
    '',
    '| File | Size | Gzip |',
    '|---|---:|---:|',
    bundleRows,
    '',
  ].join('\n');
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const outputDir = path.join(
    ROOT,
    'outputs',
    'performance',
    new Date().toISOString().slice(0, 10),
  );

  fs.mkdirSync(outputDir, { recursive: true });

  const session = await login(options);
  const endpoints = [];

  for (const endpoint of ENDPOINTS) {
    process.stdout.write(`Measuring ${endpoint.name}... `);
    const result = await measureEndpoint({ endpoint, options, session });
    endpoints.push(result);
    if (result.error) {
      process.stdout.write(`failed: ${result.error}, ${result.p95Ms}ms\n`);
    } else {
      process.stdout.write(`p50 ${result.p50Ms}ms, p95 ${result.p95Ms}ms\n`);
    }
  }

  const report = {
    baseUrl: options.baseUrl,
    bundle: getBundleStats(),
    createdAt: new Date().toISOString(),
    dbCounts: await getDbCounts(),
    endpoints,
    label: options.label,
    samples: options.samples,
    warmup: options.warmup,
  };
  const jsonPath = path.join(outputDir, `${options.label}.json`);
  const markdownPath = path.join(outputDir, `${options.label}.md`);

  fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(markdownPath, renderMarkdown(report));

  console.log(`Saved ${path.relative(ROOT, jsonPath)}`);
  console.log(`Saved ${path.relative(ROOT, markdownPath)}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
