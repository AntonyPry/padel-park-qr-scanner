'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const SequelizePackage = require('sequelize');
const {
  connect,
  createDisposableDatabase,
  dropDisposableDatabase,
} = require('../helpers/final-tenant-rc-fixture');

test('password rehash CAS has at most one DB winner and preserves a complete hash', async () => {
  assert.ok(process.env.DB_USER, 'DB_USER is required for password CAS DB test');
  const database = `setly_f9_rc_auth_cas_${process.pid}_${Date.now()}`;
  const previousDbName = process.env.DB_NAME;
  let appDb;
  let schema;

  await createDisposableDatabase(database);
  process.env.DB_NAME = database;
  try {
    schema = connect(database);
    await schema.getQueryInterface().createTable('Accounts', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: SequelizePackage.INTEGER,
      },
      passwordHash: {
        allowNull: false,
        type: SequelizePackage.STRING,
      },
      updatedAt: {
        allowNull: false,
        type: SequelizePackage.DATE,
      },
    });
    const legacyHash =
      'pbkdf2$120000$AAECAwQFBgcICQoLDA0ODw$VXl65HUq0o8w8pFFjW09h-3S2SVBCvCLCzzhy3hRGRM';
    await schema.query(
      'INSERT INTO Accounts (passwordHash, updatedAt) VALUES (:passwordHash, NOW())',
      { replacements: { passwordHash: legacyHash } },
    );

    appDb = require('../../models');
    const accountMetadata = require('../../src/services/account-metadata.service');
    const authService = require('../../src/services/auth.service');
    const env = {
      AUTH_ARGON2_ENABLED: 'true',
      AUTH_ARGON2_MEMORY_KIB: '19456',
      AUTH_ARGON2_PARALLELISM: '1',
      AUTH_ARGON2_TIME_COST: '2',
    };
    const candidates = await Promise.all([
      authService.hashPassword('ConcurrentCandidateOne123!', env),
      authService.hashPassword('ConcurrentCandidateTwo123!', env),
    ]);
    const results = await Promise.all(
      candidates.map((candidate) =>
        accountMetadata.compareAndSwapPasswordHash(1, legacyHash, candidate),
      ),
    );
    assert.deepEqual(results.sort(), [false, true]);
    const [rows] = await schema.query(
      'SELECT passwordHash FROM Accounts WHERE id=1',
    );
    assert.equal(rows.length, 1);
    assert.equal(candidates.includes(rows[0].passwordHash), true);
    assert.equal(await authService.verifyPassword(
      rows[0].passwordHash === candidates[0]
        ? 'ConcurrentCandidateOne123!'
        : 'ConcurrentCandidateTwo123!',
      rows[0].passwordHash,
    ), true);
  } finally {
    if (appDb) await appDb.sequelize.close();
    if (schema) await schema.close();
    if (previousDbName === undefined) delete process.env.DB_NAME;
    else process.env.DB_NAME = previousDbName;
    await dropDisposableDatabase(database);
  }
});
