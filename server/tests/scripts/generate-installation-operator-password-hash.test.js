'use strict';

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const passwordAuth = require('../../src/services/password-hashing.service');
const generator = require('../../scripts/generate-installation-operator-password-hash');

const SCRIPT = path.resolve(
  __dirname,
  '../../scripts/generate-installation-operator-password-hash.js',
);
const SERVER_ROOT = path.resolve(__dirname, '../..');

function runGenerator({ argv = [], input = '' } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SCRIPT, ...argv], {
      env: {
        ...process.env,
        AUTH_ARGON2_MEMORY_KIB: '19456',
        AUTH_ARGON2_PARALLELISM: '1',
        AUTH_ARGON2_TIME_COST: '2',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal, stderr, stdout }));
    child.stdin.end(input);
  });
}

function walkFiles(root) {
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(root, entry.name);
    return entry.isDirectory() ? walkFiles(absolute) : [absolute];
  });
}

test('offline generator emits only a canonical self-verified Argon2id PHC', async () => {
  const password = 'Offline-operator-password-123!';
  const result = await runGenerator({ input: `${password}\n` });
  assert.equal(result.code, 0);
  assert.equal(result.signal, null);
  assert.equal(result.stderr, '');
  assert.match(
    result.stdout,
    /^\$argon2id\$v=19\$m=19456,t=2,p=1\$[A-Za-z0-9+/]{22}\$[A-Za-z0-9+/]{43}\n$/u,
  );
  const passwordHash = result.stdout.trim();
  assert.equal(await passwordAuth.verifyPassword(password, passwordHash), true);
  assert.equal(await passwordAuth.verifyPassword('wrong-password', passwordHash), false);
  assert.deepEqual(passwordAuth.passwordHashInfo(passwordHash, {
    AUTH_ARGON2_ENABLED: 'true',
    AUTH_ARGON2_MEMORY_KIB: '19456',
    AUTH_ARGON2_PARALLELISM: '1',
    AUTH_ARGON2_TIME_COST: '2',
  }), {
    needsRehash: false,
    parameters: {
      memoryCost: 19456,
      parallelism: 1,
      timeCost: 2,
      version: 19,
    },
    scheme: 'argon2id',
  });
  assert.equal(result.stdout.includes(password), false);
});

test('generator rejects empty, bounded-control and argv input without echoing it', async () => {
  const unsafeArgv = 'plaintext-must-not-be-accepted';
  const cases = [
    ['empty', await runGenerator()],
    ['embedded newline', await runGenerator({ input: 'first\nsecond\n' })],
    ['leading whitespace', await runGenerator({ input: ' hidden\n' })],
    ['argv', await runGenerator({ argv: [unsafeArgv] })],
  ];
  for (const [label, result] of cases) {
    assert.equal(result.code, 1, label);
    assert.equal(result.stdout, '', label);
    assert.ok(result.stderr.length > 0, label);
    assert.equal(result.stderr.includes(unsafeArgv), false, label);
  }
});

test('generator reuses the A2 writer, recognizer and verifier contract', async () => {
  const password = 'Direct-preflight-password-123!';
  const passwordHash = await generator.generateAndPreflight(password, {
    AUTH_ARGON2_MEMORY_KIB: '19456',
    AUTH_ARGON2_PARALLELISM: '1',
    AUTH_ARGON2_TIME_COST: '2',
  });
  assert.equal(passwordAuth.passwordHashInfo(passwordHash, {
    AUTH_ARGON2_ENABLED: 'true',
  }).scheme, 'argon2id');
  assert.equal(await passwordAuth.verifyPassword(password, passwordHash), true);
  assert.throws(
    () => generator.validatePasswordInput('contains\u0000control'),
    { code: 'INSTALLATION_OPERATOR_PASSWORD_INPUT_INVALID' },
  );
});

test('runtime source has no plaintext operator-password value read or verifier fallback', () => {
  const runtimeFiles = walkFiles(path.join(SERVER_ROOT, 'src'))
    .filter((file) => /\.(?:js|ts)$/u.test(file));
  const mentions = runtimeFiles.flatMap((file) => {
    const source = fs.readFileSync(file, 'utf8');
    return source.includes('INSTALLATION_OPERATOR_PASSWORD')
      ? [[path.relative(SERVER_ROOT, file), source]]
      : [];
  });
  assert.deepEqual(mentions.map(([file]) => file), [
    'src/services/installation-operator-auth.service.js',
  ]);
  const service = mentions[0][1];
  assert.doesNotMatch(
    service,
    /process\.env(?:\.INSTALLATION_OPERATOR_PASSWORD(?!_HASH)|\[['"]INSTALLATION_OPERATOR_PASSWORD['"]\])/u,
  );
  assert.match(
    service,
    /hasOwnProperty\.call\(process\.env, LEGACY_PASSWORD_ENV\)/u,
  );
  assert.match(service, /passwordAuth\.verifyPassword/u);
  assert.doesNotMatch(service, /safeEqual\(String\(password/u);

  const example = fs.readFileSync(path.join(SERVER_ROOT, '.env.example'), 'utf8');
  assert.doesNotMatch(example, /^INSTALLATION_OPERATOR_PASSWORD=/mu);
  assert.match(example, /^INSTALLATION_OPERATOR_PASSWORD_HASH=$/mu);

  const generatorSource = fs.readFileSync(SCRIPT, 'utf8');
  const hashingSource = fs.readFileSync(
    path.join(SERVER_ROOT, 'src/services/password-hashing.service.js'),
    'utf8',
  );
  assert.doesNotMatch(generatorSource, /auth\.service|dotenv|require\(['"][^'"]*models/u);
  assert.doesNotMatch(hashingSource, /require\(['"][^'"]*models|dotenv/u);
});
