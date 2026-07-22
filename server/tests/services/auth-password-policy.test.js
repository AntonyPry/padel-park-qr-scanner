'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const argon2 = require('argon2');
const db = require('../../models');
const accountMetadata = require('../../src/services/account-metadata.service');
const authService = require('../../src/services/auth.service');

const LEGACY_PASSWORD = 'LegacyExact123!';
// Frozen from exact base 8c3ea880 using pbkdf2Sync(password, base64urlSaltText,
// 120000, 32, 'sha256'). It intentionally does not call the new hash helper.
const LEGACY_HASH =
  'pbkdf2$120000$AAECAwQFBgcICQoLDA0ODw$VXl65HUq0o8w8pFFjW09h-3S2SVBCvCLCzzhy3hRGRM';

function argonEnv(overrides = {}) {
  return {
    AUTH_ARGON2_ENABLED: 'true',
    AUTH_ARGON2_MEMORY_KIB: '19456',
    AUTH_ARGON2_PARALLELISM: '1',
    AUTH_ARGON2_TIME_COST: '2',
    ...overrides,
  };
}

function installProcessEnv(t, overrides) {
  const names = [
    'AUTH_ARGON2_ENABLED',
    'AUTH_ARGON2_MEMORY_KIB',
    'AUTH_ARGON2_PARALLELISM',
    'AUTH_ARGON2_TIME_COST',
  ];
  const before = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  for (const name of names) delete process.env[name];
  Object.assign(process.env, overrides);
  t.after(() => {
    for (const name of names) {
      if (before[name] === undefined) delete process.env[name];
      else process.env[name] = before[name];
    }
  });
}

function fakeAccount(overrides = {}) {
  const account = {
    Staff: { status: 'active' },
    email: 'ordinary-user@example.test',
    id: 71,
    passwordHash: LEGACY_HASH,
    role: 'admin',
    staffId: 31,
    status: 'active',
    ...overrides,
  };
  account.toJSON = () => ({ ...account, toJSON: undefined });
  return account;
}

function installLoginPersistence(t, account, { cas } = {}) {
  t.mock.method(db.Account, 'findOne', async () => account);
  t.mock.method(db.Account, 'findByPk', async () => account);
  t.mock.method(accountMetadata, 'updateAccountMetadata', async () => account);
  t.mock.method(
    authService._private.normalUserSessions,
    'issue',
    async () => ({
      account,
      token: `setly_s1_${'A'.repeat(43)}`,
    }),
  );
  t.mock.method(
    accountMetadata,
    'compareAndSwapPasswordHash',
    cas || (async () => true),
  );
}

test('legacy exact-base fixture verifies original text-salt semantics', async () => {
  assert.equal(await authService.verifyPassword(LEGACY_PASSWORD, LEGACY_HASH), true);
  assert.equal(await authService.verifyPassword('wrong-password', LEGACY_HASH), false);
  assert.deepEqual(authService.passwordHashInfo(LEGACY_HASH), {
    needsRehash: true,
    scheme: 'pbkdf2',
  });
});

test('legacy recognizer rejects malformed, unsupported and noncanonical inputs', async () => {
  const cases = [
    '',
    'scrypt$120000$AAECAwQFBgcICQoLDA0ODw$VXl65HUq0o8w8pFFjW09h-3S2SVBCvCLCzzhy3hRGRM',
    LEGACY_HASH.replace('$120000$', '$0120000$'),
    LEGACY_HASH.replace('$120000$', '$1$'),
    LEGACY_HASH.replace('$120000$', '$999999999$'),
    `${LEGACY_HASH}$extra`,
    LEGACY_HASH.replace('AAECAwQFBgcICQoLDA0ODw', 'AAECAwQFBgcICQoLDA0ODw='),
    LEGACY_HASH.slice(0, -1),
    `${LEGACY_HASH}A`,
  ];
  for (const value of cases) {
    assert.equal(authService._private.parseLegacyPasswordHash(value), null);
    assert.equal(await authService.verifyPassword(LEGACY_PASSWORD, value), false);
  }
});

test('flag off writes legacy while the dual reader keeps Argon2id compatible', async () => {
  const legacy = await authService.hashPassword('FlagOff123!', {
    AUTH_ARGON2_ENABLED: 'false',
  });
  const encoded = await authService.hashPassword('FlagOn123!', argonEnv());
  assert.match(legacy, /^pbkdf2\$120000\$/u);
  assert.match(encoded, /^\$argon2id\$v=19\$m=19456,t=2,p=1\$/u);
  assert.equal(await authService.verifyPassword('FlagOff123!', legacy), true);
  assert.equal(await authService.verifyPassword('FlagOn123!', encoded), true);
  assert.equal(await authService.verifyPassword('wrong', encoded), false);
});

test('Argon2id recognizer rejects wrong variant/version and extreme PHC before verify', async (t) => {
  const encoded = await authService.hashPassword('Bounded123!', argonEnv());
  const verify = t.mock.method(argon2, 'verify', async () => {
    throw new Error('verify must not be called');
  });
  const cases = [
    encoded.replace('$argon2id$', '$argon2i$'),
    encoded.replace('$v=19$', '$v=16$'),
    encoded.replace('m=19456', 'm=999999'),
    encoded.replace('m=19456', 'm=019456'),
    encoded.replace('t=2', 't=99'),
    encoded.replace('t=2', 't=02'),
    encoded.replace('p=1', 'p=99'),
    encoded.replace('p=1', 'p=01'),
    `${encoded}$extra`,
  ];
  for (const value of cases) {
    assert.equal(authService._private.parseArgon2idPasswordHash(value), null);
    assert.equal(await authService.verifyPassword('Bounded123!', value), false);
  }
  assert.equal(verify.mock.callCount(), 0);
});

test('supported stale Argon2id parameters are recognized as needs-rehash', async () => {
  const stale = await argon2.hash('Stale123!', {
    hashLength: 32,
    memoryCost: 19456,
    parallelism: 1,
    salt: Buffer.alloc(16, 7),
    timeCost: 3,
    type: argon2.argon2id,
    version: 0x13,
  });
  assert.equal(await authService.verifyPassword('Stale123!', stale), true);
  assert.equal(authService.passwordHashInfo(stale, argonEnv()).needsRehash, true);
  assert.equal(
    authService.passwordHashInfo(
      stale,
      argonEnv({ AUTH_ARGON2_TIME_COST: '3' }),
    ).needsRehash,
    false,
  );
});

test('configuration is strict, bounded and defaults writes to off', () => {
  assert.equal(
    authService._private.passwordHashingConfiguration({}).argon2Enabled,
    false,
  );
  for (const env of [
    { AUTH_ARGON2_ENABLED: 'yes' },
    argonEnv({ AUTH_ARGON2_MEMORY_KIB: '19455' }),
    argonEnv({ AUTH_ARGON2_MEMORY_KIB: '262145' }),
    argonEnv({ AUTH_ARGON2_TIME_COST: '1' }),
    argonEnv({ AUTH_ARGON2_PARALLELISM: '0' }),
    argonEnv({ AUTH_ARGON2_PARALLELISM: '1.5' }),
    argonEnv({ AUTH_ARGON2_TIME_COST: '02' }),
    argonEnv({ AUTH_ARGON2_TIME_COST: ' 2' }),
  ]) {
    assert.throws(
      () => authService.validatePasswordHashingConfiguration(env),
      { code: 'PASSWORD_HASH_CONFIGURATION_INVALID' },
    );
  }
});

test('fully successful active legacy login performs one Argon2id CAS rehash', async (t) => {
  installProcessEnv(t, argonEnv());
  const account = fakeAccount();
  const calls = [];
  installLoginPersistence(t, account, {
    cas: async (accountId, previousHash, nextHash) => {
      calls.push({ accountId, nextHash, previousHash });
      return true;
    },
  });

  const session = await authService.login({
    email: account.email,
    password: LEGACY_PASSWORD,
  });
  assert.equal(session.account.id, account.id);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].accountId, account.id);
  assert.equal(calls[0].previousHash, LEGACY_HASH);
  assert.match(calls[0].nextHash, /^\$argon2id\$/u);
});

test('flag off allows the same legacy login without opportunistic write', async (t) => {
  installProcessEnv(t, { AUTH_ARGON2_ENABLED: 'false' });
  const account = fakeAccount();
  let casCalls = 0;
  installLoginPersistence(t, account, {
    cas: async () => {
      casCalls += 1;
      return true;
    },
  });
  const session = await authService.login({
    email: account.email,
    password: LEGACY_PASSWORD,
  });
  assert.equal(session.account.id, account.id);
  assert.equal(casCalls, 0);
  assert.equal(account.passwordHash, LEGACY_HASH);
});

test('unknown/failed/inactive Account or linked Staff never write a hash', async (t) => {
  installProcessEnv(t, argonEnv());
  for (const account of [
    null,
    fakeAccount(),
    fakeAccount({ status: 'inactive' }),
    fakeAccount({ Staff: { status: 'inactive' } }),
  ]) {
    let casCalls = 0;
    installLoginPersistence(t, account, {
      cas: async () => {
        casCalls += 1;
        return true;
      },
    });
    await assert.rejects(
      authService.login({
        email: account?.email || 'missing@example.test',
        password: account?.status === 'active' && account.Staff.status === 'active'
          ? 'wrong-password'
          : LEGACY_PASSWORD,
      }),
      { message: 'Неверный email или пароль', statusCode: 401 },
    );
    assert.equal(casCalls, 0);
    t.mock.restoreAll();
  }
});

test('rehash persistence failure preserves a valid login and emits fixed safe evidence', async (t) => {
  installProcessEnv(t, argonEnv());
  const account = fakeAccount();
  installLoginPersistence(t, account, {
    cas: async () => {
      throw new Error(`database rejected ${account.email} ${LEGACY_HASH}`);
    },
  });
  const warnings = [];
  t.mock.method(console, 'warn', (...args) => warnings.push(args));

  const session = await authService.login({
    email: account.email,
    password: LEGACY_PASSWORD,
  });
  assert.equal(session.account.id, account.id);
  assert.equal(account.passwordHash, LEGACY_HASH);
  assert.deepEqual(warnings, [[
    'Password rehash persistence failed',
    { event: 'auth.password_rehash.persistence_failed' },
  ]]);
  const evidence = JSON.stringify(warnings);
  assert.equal(evidence.includes(account.email), false);
  assert.equal(evidence.includes(LEGACY_HASH), false);
  assert.equal(evidence.includes(LEGACY_PASSWORD), false);
  assert.equal(evidence.includes(session.token), false);
});

test('password hash CAS is keyed by account id and exact previous hash', async (t) => {
  const state = { passwordHash: LEGACY_HASH };
  t.mock.method(db.Account, 'update', async (payload, options) => {
    if (
      options.where.id === 71 &&
      options.where.passwordHash === state.passwordHash
    ) {
      state.passwordHash = payload.passwordHash;
      return [1];
    }
    return [0];
  });
  const candidates = await Promise.all([
    authService.hashPassword('CandidateOne123!', argonEnv()),
    authService.hashPassword('CandidateTwo123!', argonEnv()),
  ]);
  const results = await Promise.all(
    candidates.map((candidate) =>
      accountMetadata.compareAndSwapPasswordHash(71, LEGACY_HASH, candidate),
    ),
  );
  assert.deepEqual(results.sort(), [false, true]);
  assert.equal(candidates.includes(state.passwordHash), true);
});

test('supported PHC formats fit the tracked VARCHAR(255) contract', async () => {
  const encoded = await authService.hashPassword('Capacity123!', argonEnv());
  assert.equal(LEGACY_HASH.length, authService._private.LEGACY_HASH_LENGTH);
  assert.ok(encoded.length <= authService._private.MAX_SUPPORTED_ARGON2_HASH_LENGTH);
  assert.ok(
    authService._private.MAX_SUPPORTED_ARGON2_HASH_LENGTH <=
      authService._private.PASSWORD_HASH_COLUMN_LIMIT,
  );
});
