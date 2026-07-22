'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { test } = require('node:test');
const SequelizePackage = require('sequelize');
const {
  connect,
  createDisposableDatabase,
  dropDisposableDatabase,
} = require('../helpers/final-tenant-rc-fixture');

const migration = require('../../migrations/20260722100000-create-normal-user-sessions');

const STEP_TIMEOUT_MS = 15_000;

function bounded(label, promise, timeoutMs = STEP_TIMEOUT_MS) {
  let timeout;
  return Promise.race([
    Promise.resolve(promise),
    new Promise((_, reject) => {
      timeout = setTimeout(() => reject(new Error(`${label} timed out`)), timeoutMs);
      timeout.unref?.();
    }),
  ]).finally(() => clearTimeout(timeout));
}

async function createDependencies(queryInterface) {
  await queryInterface.createTable('Staffs', {
    id: {
      autoIncrement: true,
      primaryKey: true,
      type: SequelizePackage.INTEGER,
    },
    status: {
      allowNull: false,
      defaultValue: 'active',
      type: SequelizePackage.STRING(20),
    },
  });
  await queryInterface.createTable('Accounts', {
    id: {
      autoIncrement: true,
      primaryKey: true,
      type: SequelizePackage.INTEGER,
    },
    role: {
      allowNull: false,
      defaultValue: 'viewer',
      type: SequelizePackage.STRING(20),
    },
    staffId: {
      allowNull: true,
      type: SequelizePackage.INTEGER,
    },
    status: {
      allowNull: false,
      defaultValue: 'active',
      type: SequelizePackage.STRING(20),
    },
  });
}

async function insertSession(schema, accountId, digest = crypto.randomBytes(32).toString('hex')) {
  const id = crypto.randomUUID();
  await schema.query(
    `INSERT INTO NormalUserSessions
       (id,accountId,tokenDigest,expiresAt,revokedAt,revokedReason,createdAt,updatedAt)
     VALUES (:id,:accountId,:digest,DATE_ADD(CURRENT_TIMESTAMP, INTERVAL 1 HOUR),NULL,NULL,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
    { replacements: { accountId, digest, id } },
  );
  return { digest, id };
}

test('SEC-A5 migration closes after exact empty up/down/up and constraint proof', {
  timeout: 60_000,
}, async () => {
  assert.ok(process.env.DB_USER, 'DB_USER is required for opaque-session migration tests');
  const database = `setly_f9_rc_opaque_migration_${process.pid}_${Date.now()}`;
  let schema;
  try {
    await bounded('create disposable database', createDisposableDatabase(database));
    schema = connect(database);
    const queryInterface = schema.getQueryInterface();
    await bounded('create dependency tables', createDependencies(queryInterface));

    await bounded('first migration up', migration.up(queryInterface, SequelizePackage));
    assert.equal((await migration.__testing.classifyState(queryInterface)).state, 'ready');
    await bounded('migration down', migration.down(queryInterface));
    assert.equal((await migration.__testing.classifyState(queryInterface)).state, 'absent');
    await bounded('second migration up', migration.up(queryInterface, SequelizePackage));
    assert.equal((await migration.__testing.classifyState(queryInterface)).state, 'ready');

    await schema.query("INSERT INTO Staffs (status) VALUES ('active')");
    await schema.query("INSERT INTO Accounts (role,staffId,status) VALUES ('admin',1,'active')");
    const first = await insertSession(schema, 1);

    await assert.rejects(
      schema.query(
        'UPDATE NormalUserSessions SET tokenDigest=:digest WHERE id=:id',
        { replacements: { digest: 'b'.repeat(64), id: first.id } },
      ),
    );
    await assert.rejects(
      schema.query(
        'UPDATE NormalUserSessions SET revokedAt=CURRENT_TIMESTAMP, revokedReason=NULL WHERE id=:id',
        { replacements: { id: first.id } },
      ),
    );
    await assert.rejects(
      schema.query('DELETE FROM NormalUserSessions WHERE id=:id', {
        replacements: { id: first.id },
      }),
    );
    await assert.rejects(
      insertSession(schema, 99),
    );

    await schema.query("UPDATE Accounts SET role='viewer' WHERE id=1");
    const [roleRows] = await schema.query(
      'SELECT revokedReason FROM NormalUserSessions WHERE id=:id',
      { replacements: { id: first.id } },
    );
    assert.equal(roleRows[0].revokedReason, 'security_context_changed');

    const second = await insertSession(schema, 1);
    await schema.query("UPDATE Staffs SET status='inactive' WHERE id=1");
    const [staffRows] = await schema.query(
      'SELECT revokedReason FROM NormalUserSessions WHERE id=:id',
      { replacements: { id: second.id } },
    );
    assert.equal(staffRows[0].revokedReason, 'staff_disabled');

    await assert.rejects(
      migration.down(queryInterface),
      (error) => error.code === 'NORMAL_USER_SESSIONS_ROLLBACK_HISTORY_PRESENT',
    );
  } finally {
    if (schema) await bounded('close migration schema', schema.close());
    await bounded('drop disposable database', dropDisposableDatabase(database));
  }
});
