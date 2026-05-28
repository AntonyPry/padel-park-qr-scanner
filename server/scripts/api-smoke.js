#!/usr/bin/env node

const API_URL = process.env.API_SMOKE_URL || 'http://127.0.0.1:3004/api';
const EMAIL = process.env.API_SMOKE_EMAIL || 'owner@padelpark.demo';
const PASSWORD = process.env.API_SMOKE_PASSWORD || 'Demo1234!';

const PUBLIC_CHECKS = [
  ['system.health', '/health'],
  ['system.openapi', '/openapi.json'],
];

const CHECKS = [
  ['auth.me', '/auth/me'],
  ['bookings.schedule', `/bookings/schedule?date=${new Date().toISOString().slice(0, 10)}`],
  ['bookings.analytics', '/bookings/analytics'],
  ['clients.list', '/clients?limit=10'],
  ['clientBases.list', '/client-bases?status=active'],
  ['callTasks.list', '/call-tasks?status=active'],
  ['finance.list', '/finance'],
  ['visits.analytics', '/analytics/visits'],
  ['audit.list', '/audit-logs?limit=10'],
];

async function login() {
  const response = await fetch(`${API_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!response.ok) throw new Error(`Login failed: ${response.status}`);
  const data = await response.json();
  const token = data.token || data.data?.token;
  if (!token) throw new Error('Login response does not contain token');
  return token;
}

async function checkEndpoint(token, [name, url]) {
  const startedAt = Date.now();
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  const response = await fetch(`${API_URL}${url}`, {
    headers,
  });
  const text = await response.text();

  return {
    name,
    ms: Date.now() - startedAt,
    ok: response.ok,
    status: response.status,
    responseTimeHeader: response.headers.get('x-response-time-ms'),
    sample: response.ok ? undefined : text.slice(0, 300),
  };
}

async function main() {
  const token = await login();
  const results = [];

  for (const check of PUBLIC_CHECKS) {
    results.push(await checkEndpoint(null, check));
  }

  for (const check of CHECKS) {
    results.push(await checkEndpoint(token, check));
  }

  console.log(JSON.stringify({ apiUrl: API_URL, results }, null, 2));

  if (results.some((result) => !result.ok)) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
