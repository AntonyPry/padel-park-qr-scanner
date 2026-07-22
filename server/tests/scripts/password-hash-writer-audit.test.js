'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const SERVER_ROOT = path.resolve(__dirname, '../..');

function source(relativePath) {
  return fs.readFileSync(path.join(SERVER_ROOT, relativePath), 'utf8');
}

function occurrences(value, pattern) {
  return value.match(pattern)?.length || 0;
}

test('ordinary-user plaintext writers use the one async auth hash contract', () => {
  const inventory = [
    {
      calls: 1,
      file: 'src/services/auth.service.js',
      pattern: /passwordHash:\s+await hashPassword\(/gu,
    },
    {
      calls: 2,
      file: 'src/services/accounts.service.js',
      pattern: /await authService\.hashPassword\(/gu,
    },
    {
      calls: 2,
      file: 'src/services/installation-provisioning.service.js',
      pattern: /await authService\.hashPassword\(/gu,
    },
    {
      calls: 1,
      file: 'scripts/seed-demo-accounts.js',
      pattern: /await authService\.hashPassword\(/gu,
    },
    {
      calls: 1,
      file: 'seeders/20260511120000-demo-crm-data.js',
      pattern: /await authService\.hashPassword\(/gu,
    },
  ];
  for (const writer of inventory) {
    assert.equal(
      occurrences(source(writer.file), writer.pattern),
      writer.calls,
      writer.file,
    );
  }
});

test('no runtime or operational source keeps a parallel PBKDF2 implementation', () => {
  const files = [
    'src/services/accounts.service.js',
    'src/services/installation-provisioning.service.js',
    'scripts/seed-demo-accounts.js',
    'seeders/20260511120000-demo-crm-data.js',
    'src/services/account-seeder-adapter.js',
  ];
  for (const file of files) {
    assert.doesNotMatch(source(file), /pbkdf2(?:Sync)?\s*\(/u, file);
  }
});

test('hash-only adapters remain plaintext-agnostic persistence boundaries', () => {
  const seederAdapter = source('src/services/account-seeder-adapter.js');
  assert.match(seederAdapter, /passwordHash:\s+definition\.passwordHash/u);
  assert.doesNotMatch(seederAdapter, /definition\.password(?!Hash)/u);
  const lifecycle = source('src/services/account-lifecycle.service.js');
  assert.doesNotMatch(lifecycle, /hashPassword|verifyPassword|pbkdf2|argon2/u);
});
