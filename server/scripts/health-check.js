#!/usr/bin/env node

const API_URL = process.env.API_HEALTH_URL || 'http://127.0.0.1:3004/api';

async function main() {
  const response = await fetch(`${API_URL}/health`, {
    headers: { Accept: 'application/json' },
  });
  const data = await response.json().catch(() => null);

  console.log(JSON.stringify({ apiUrl: API_URL, data, status: response.status }, null, 2));

  if (!response.ok || data?.status !== 'ok') {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
