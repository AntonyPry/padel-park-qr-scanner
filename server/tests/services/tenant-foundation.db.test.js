'use strict';

const assert = require('node:assert/strict');
const fs = require('fs');
const http = require('node:http');
const path = require('path');
const { test } = require('node:test');
const mysql = require('mysql2/promise');
const SequelizePackage = require('sequelize');
const { io: createSocketClient } = require('socket.io-client');

const SERVER_ROOT = path.resolve(__dirname, '../..');
const FEATURE_MIGRATION_FILE = '20260714120000-create-tenant-foundation.js';

function databaseName() {
  return (
    process.env.TENANT_TEST_DB_NAME ||
    `setly_tenant_f2_${process.pid}_${Date.now()}`
  );
}

async function createBaseSchema(database) {
  const sequelize = new SequelizePackage.Sequelize(
    database,
    process.env.DB_USER,
    process.env.DB_PASSWORD,
    {
      dialect: 'mysql',
      host: '127.0.0.1',
      logging: false,
    },
  );
  const queryInterface = sequelize.getQueryInterface();
  await queryInterface.createTable('SequelizeMeta', {
    name: {
      allowNull: false,
      primaryKey: true,
      type: SequelizePackage.STRING,
      unique: true,
    },
  });

  const migrations = fs
    .readdirSync(path.join(SERVER_ROOT, 'migrations'))
    .filter(
      (file) =>
        file.endsWith('.js') && file.localeCompare(FEATURE_MIGRATION_FILE) < 0,
    )
    .sort();
  for (const file of migrations) {
    const migration = require(path.join(SERVER_ROOT, 'migrations', file));
    await migration.up(queryInterface, SequelizePackage);
    await queryInterface.bulkInsert('SequelizeMeta', [{ name: file }]);
  }
  return sequelize;
}

async function listen(app) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
    server.once('error', reject);
  });
}

async function closeServer(server) {
  if (!server) return;
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}

async function socketHandshake(server, token) {
  return new Promise((resolve, reject) => {
    const socket = createSocketClient(
      `http://127.0.0.1:${server.address().port}`,
      {
        auth: token ? { token } : {},
        forceNew: true,
        reconnection: false,
        timeout: 3000,
        transports: ['websocket'],
      },
    );
    const timeout = setTimeout(() => {
      socket.close();
      reject(new Error('Socket handshake timed out'));
    }, 5000);
    socket.once('connect', () => {
      clearTimeout(timeout);
      resolve({ socket });
    });
    socket.once('connect_error', (error) => {
      clearTimeout(timeout);
      socket.close();
      resolve({ error });
    });
  });
}

function apiUrl(server, route) {
  return `http://127.0.0.1:${server.address().port}/api${route}`;
}

test('Feature 2 tenant foundation DB-backed lifecycle and rollback gate', async (t) => {
  assert.ok(process.env.DB_USER, 'DB_USER is required for DB-backed tenant tests');
  const database = databaseName();
  const admin = await mysql.createConnection({
    host: '127.0.0.1',
    password: process.env.DB_PASSWORD,
    user: process.env.DB_USER,
  });
  await admin.query(`DROP DATABASE IF EXISTS \`${database}\``);
  await admin.query(
    `CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
  );

  process.env.DB_NAME = database;
  process.env.NODE_ENV = 'test';
  let schemaSequelize;
  let db;
  let server;
  let socketHttpServer;
  let socketIo;
  try {
    schemaSequelize = await createBaseSchema(database);
    db = require('../../models');
    const migration = require('../../migrations/20260714120000-create-tenant-foundation');
    const tenantFoundation = require('../../src/services/tenant-foundation.service');
    const accountLifecycle = require('../../src/services/account-lifecycle.service');
    const accountMetadata = require('../../src/services/account-metadata.service');
    const accountsService = require('../../src/services/accounts.service');
    const authService = require('../../src/services/auth.service');
    const accountSeeder = require('../../src/services/account-seeder-adapter');
    const demoSeeder = require('../../seeders/20260511120000-demo-crm-data');
    const { runDemoAccountSeed } = require('../../scripts/seed-demo-accounts');
    const createApp = require('../../src/app');
    const { createSocketServer } = require('../../src/sockets');
    const queryInterface = schemaSequelize.getQueryInterface();

    const assertInitialized = async () => {
      const state = await tenantFoundation.assertTenantFoundationInitialized();
      assert.equal(state.state, 'initialized', JSON.stringify(state.diagnostics));
      return state;
    };

    await t.test('forced migration failure removes partial DDL', async () => {
      const originalCreateTable = queryInterface.createTable.bind(queryInterface);
      queryInterface.createTable = async (table, ...args) => {
        if (table === 'Clubs') throw new Error('forced migration DDL failure');
        return originalCreateTable(table, ...args);
      };
      await assert.rejects(
        migration.up(queryInterface, SequelizePackage),
        /forced migration DDL failure/,
      );
      queryInterface.createTable = originalCreateTable;
      const tables = await queryInterface.showAllTables();
      for (const table of [
        'Organizations',
        'Clubs',
        'Memberships',
        'MembershipClubAccesses',
      ]) {
        assert.equal(tables.includes(table), false, table);
      }
    });

    await t.test('empty migration is pending and repeat application is deterministic', async () => {
      await migration.up(queryInterface, SequelizePackage);
      const first = await tenantFoundation.classifyTenantFoundation();
      assert.equal(first.state, 'bootstrap-pending');
      assert.deepEqual(first.counts, {
        accesses: 0,
        accounts: 0,
        clubs: 1,
        memberships: 0,
        organizations: 1,
      });
      await migration.up(queryInterface, SequelizePackage);
      const repeated = await tenantFoundation.classifyTenantFoundation();
      assert.equal(repeated.state, 'bootstrap-pending');
      assert.equal(repeated.checksum, first.checksum);
      await migration.down(queryInterface, SequelizePackage);
      assert.equal((await queryInterface.showAllTables()).includes('Organizations'), false);
      await migration.up(queryInterface, SequelizePackage);
      const reapplied = await tenantFoundation.classifyTenantFoundation();
      assert.equal(reapplied.state, 'bootstrap-pending');
    });

    await t.test('pending API allowlist blocks all business and ingress routes', async () => {
      server = await listen(createApp());
      const health = await fetch(apiUrl(server, '/health'));
      assert.equal(health.status, 200);
      assert.equal((await health.json()).bootstrapPending, true);
      const status = await fetch(apiUrl(server, '/auth/status'));
      assert.equal(status.status, 200);
      assert.deepEqual(await status.json(), {
        bootstrapPending: true,
        setupRequired: true,
        tenantFoundationState: 'bootstrap-pending',
      });
      for (const [method, route] of [
        ['GET', '/openapi.json'],
        ['POST', '/auth/login'],
        ['GET', '/clients'],
        ['POST', '/webhooks/evotor'],
        ['POST', '/integrations/beeline/events'],
        ['GET', '/telephony/transcription-jobs/worker-queue'],
      ]) {
        const response = await fetch(apiUrl(server, route), { method });
        assert.equal(response.status, 503, `${method} ${route}`);
        assert.equal((await response.json()).code, 'BOOTSTRAP_REQUIRED');
      }
    });

    await t.test('bootstrap-pending rejects Socket.IO before authentication', async () => {
      socketHttpServer = http.createServer();
      socketIo = createSocketServer(socketHttpServer);
      await listen(socketHttpServer);
      const result = await socketHandshake(socketHttpServer, null);
      assert.equal(result.socket, undefined);
      assert.equal(result.error?.message, 'BOOTSTRAP_REQUIRED');
      assert.equal(result.error?.data?.code, 'BOOTSTRAP_REQUIRED');
      assert.equal(result.error?.data?.status, 503);
    });

    await t.test('forced bootstrap failures roll back Staff, Account and Membership', async () => {
      for (const failAfter of ['staff', 'account', 'membership']) {
        await assert.rejects(
          authService.bootstrapOwner(
            {
              email: `${failAfter}@bootstrap.test`,
              name: `Bootstrap ${failAfter}`,
              password: 'Bootstrap123!',
              phone: null,
            },
            { failAfter },
          ),
          /Forced bootstrap failure/,
        );
        assert.equal(await db.Staff.count(), 0);
        assert.equal(await db.Account.count(), 0);
        assert.equal(await db.Membership.count(), 0);
        assert.equal(
          (await tenantFoundation.classifyTenantFoundation()).state,
          'bootstrap-pending',
        );
      }
    });

    let initialOwner;
    let initialSession;
    await t.test('concurrent bootstrap yields one owner and one 409', async () => {
      const payloads = [
        {
          email: 'initial-a@setly.test',
          name: 'Initial A',
          password: 'Initial123!',
        },
        {
          email: 'initial-b@setly.test',
          name: 'Initial B',
          password: 'Initial123!',
        },
      ];
      const responses = await Promise.all(
        payloads.map((body) =>
          fetch(apiUrl(server, '/auth/bootstrap'), {
            body: JSON.stringify(body),
            headers: { 'Content-Type': 'application/json' },
            method: 'POST',
          }),
        ),
      );
      const results = await Promise.all(
        responses.map(async (response) => ({
          body: await response.json(),
          status: response.status,
        })),
      );
      assert.deepEqual(
        results.map((result) => result.status).sort(),
        [200, 409],
      );
      const conflict = results.find((result) => result.status === 409);
      assert.equal(conflict.body.code, 'ALREADY_BOOTSTRAPPED');
      initialSession = results.find((result) => result.status === 200).body;
      assert.ok(initialSession.token);
      assert.equal(await db.Account.count(), 1);
      assert.equal(await db.Membership.count(), 1);
      assert.equal(await db.MembershipClubAccess.count(), 0);
      initialOwner = await db.Account.findOne({ where: { role: 'owner' } });
      assert.ok(initialOwner);
      await assertInitialized();
      assert.equal((await fetch(apiUrl(server, '/openapi.json'))).status, 200);
    });

    await t.test('initialized Socket.IO preserves authenticated connection contract', async () => {
      const result = await socketHandshake(socketHttpServer, initialSession.token);
      assert.equal(result.error, undefined, result.error?.message);
      assert.equal(result.socket.connected, true);
      const serverSocket = [...socketIo.sockets.sockets.values()].find(
        (socket) => socket.id === result.socket.id,
      );
      assert.ok(serverSocket);
      assert.equal(serverSocket.data.account.id, initialSession.account.id);
      assert.equal(serverSocket.rooms.has('access'), true);
      result.socket.close();
    });

    await t.test('rollback initialized and backfill existing Accounts preserves parity', async () => {
      await migration.down(queryInterface, SequelizePackage);
      assert.equal(await db.Account.count(), 1);
      const passwordHash = authService.hashPassword('Compat123!');
      await db.Account.bulkCreate([
        {
          email: 'manager-existing@setly.test',
          passwordHash,
          role: 'manager',
          status: 'active',
        },
        {
          email: 'admin-inactive@setly.test',
          passwordHash,
          role: 'admin',
          status: 'inactive',
        },
        {
          email: 'trainer-archived@setly.test',
          passwordHash,
          role: 'trainer',
          status: 'archived',
        },
      ]);
      await migration.up(queryInterface, SequelizePackage);
      const state = await assertInitialized();
      assert.equal(state.counts.accounts, 4);
      assert.equal(state.counts.memberships, 4);
      assert.equal(state.counts.accesses, 3);
    });

    await t.test('existing Accounts without active owner abort migration and retain Accounts', async () => {
      await migration.down(queryInterface, SequelizePackage);
      await db.Account.update({ status: 'inactive' }, { where: {} });
      await assert.rejects(
        migration.up(queryInterface, SequelizePackage),
        /at least one active owner/,
      );
      const tables = await queryInterface.showAllTables();
      assert.equal(tables.includes('Organizations'), false);
      assert.equal(await db.Account.count(), 4);
      await db.Account.update(
        { status: 'active' },
        { where: { id: initialOwner.id } },
      );
      await migration.up(queryInterface, SequelizePackage);
      await assertInitialized();
    });

    const created = {};
    await t.test('owner/non-owner creation covers every status and atomic failures', async () => {
      for (const role of ['owner', 'manager']) {
        for (const status of ['active', 'inactive', 'archived']) {
          const account = await accountLifecycle.createAccount({
            email: `${role}-${status}@lifecycle.test`,
            passwordHash: authService.hashPassword('Lifecycle123!'),
            role,
            status,
          });
          created[`${role}-${status}`] = account;
          const membership = await db.Membership.findOne({
            where: { accountId: account.id },
          });
          const accesses = await db.MembershipClubAccess.findAll({
            where: { membershipId: membership.id },
          });
          assert.equal(membership.role, role);
          assert.equal(membership.status, status);
          assert.equal(accesses.length, role === 'owner' ? 0 : 1);
          if (role !== 'owner') assert.equal(accesses[0].status, status);
          await assertInitialized();
        }
      }
      await assert.rejects(
        accountLifecycle.createAccount(
          {
            email: 'forced-create@lifecycle.test',
            passwordHash: authService.hashPassword('Lifecycle123!'),
            role: 'admin',
            status: 'active',
          },
          { failAfter: 'membership' },
        ),
        /Forced Membership lifecycle failure/,
      );
      assert.equal(
        await db.Account.count({ where: { email: 'forced-create@lifecycle.test' } }),
        0,
      );
      await assertInitialized();
    });

    await t.test('classifier uses one snapshot across concurrent graph create/update/delete commits', async () => {
      const runAcrossCommit = async (label, mutate) => {
        let releaseRead;
        let signalAccountsRead;
        let paused = false;
        const accountsRead = new Promise((resolve) => {
          signalAccountsRead = resolve;
        });
        const resumeRead = new Promise((resolve) => {
          releaseRead = resolve;
        });
        const classificationPromise = tenantFoundation.classifyTenantFoundation({
          afterRead: async ({ table, transaction }) => {
            assert.ok(transaction, `${label} classifier must own a transaction`);
            if (table === 'Accounts' && !paused) {
              paused = true;
              signalAccountsRead();
              await resumeRead;
            }
          },
        });

        await accountsRead;
        let mutationResult;
        try {
          mutationResult = await mutate();
          const apiResponse = await fetch(apiUrl(server, '/openapi.json'));
          assert.equal(apiResponse.status, 200, `${label} returned false 503`);
        } finally {
          releaseRead();
        }

        const during = await classificationPromise;
        assert.equal(
          during.state,
          'initialized',
          `${label}: ${JSON.stringify(during.diagnostics)}`,
        );
        await assertInitialized();
        return mutationResult;
      };

      const racedAccount = await runAcrossCommit('create', () =>
        accountLifecycle.createAccount({
          email: 'snapshot-race@lifecycle.test',
          passwordHash: authService.hashPassword('Snapshot123!'),
          role: 'viewer',
          status: 'active',
        }),
      );
      await runAcrossCommit('update', () =>
        accountLifecycle.updateAccount(racedAccount.id, {
          role: 'trainer',
          status: 'inactive',
        }),
      );
      await runAcrossCommit('delete', () =>
        accountLifecycle.permanentDeleteAccount(racedAccount.id),
      );

      await db.sequelize.transaction(async (transaction) => {
        let observedTransaction = null;
        const state = await tenantFoundation.classifyTenantFoundation({
          afterRead: ({ transaction: snapshotTransaction }) => {
            observedTransaction = snapshotTransaction;
          },
          transaction,
        });
        assert.equal(state.state, 'initialized');
        assert.equal(observedTransaction, transaction);
      });
    });

    await t.test('role/status transitions, mixed dispatch, archive and restore stay atomic', async () => {
      const owner = created['owner-active'];
      await accountLifecycle.updateAccount(owner.id, {
        role: 'admin',
        status: 'inactive',
      });
      let membership = await db.Membership.findOne({ where: { accountId: owner.id } });
      let access = await db.MembershipClubAccess.findOne({
        where: { membershipId: membership.id },
      });
      assert.equal(access.status, 'inactive');

      const manager = created['manager-active'];
      await accountLifecycle.updateAccount(manager.id, { role: 'owner' });
      membership = await db.Membership.findOne({ where: { accountId: manager.id } });
      assert.equal(
        await db.MembershipClubAccess.count({ where: { membershipId: membership.id } }),
        0,
      );

      initialOwner = await db.Account.findByPk(initialOwner.id);
      const mixedTarget = created['manager-inactive'];
      await accountsService.update(initialOwner, mixedTarget.id, {
        email: 'mixed-update@lifecycle.test',
        role: 'trainer',
        status: 'active',
      });
      await accountsService.remove(initialOwner, mixedTarget.id);
      await accountsService.restore(initialOwner, mixedTarget.id);
      const mixedMembership = await db.Membership.findOne({
        where: { accountId: mixedTarget.id },
      });
      const mixedAccount = await db.Account.findByPk(mixedTarget.id);
      assert.equal(mixedAccount.email, 'mixed-update@lifecycle.test');
      assert.equal(mixedAccount.role, mixedMembership.role);
      assert.equal(mixedAccount.status, 'active');
      await assertInitialized();
    });

    await t.test('metadata allowlist and login update do not change parity or take Organization lock', async () => {
      await assert.rejects(
        accountMetadata.updateAccountMetadata(initialOwner.id, { role: 'manager' }),
        (error) => error.code === 'ACCOUNT_LIFECYCLE_REQUIRED',
      );
      const before = await assertInitialized();
      const metadataStaff = await db.Staff.create({
        name: 'Metadata QA',
        phone: `+7777${Date.now()}`.slice(0, 16),
        role: 'QA',
        status: 'active',
      });
      await accountMetadata.updateAccountMetadata(created['manager-archived'].id, {
        email: 'metadata-allowlist@lifecycle.test',
        passwordHash: authService.hashPassword('Metadata123!'),
        staffId: metadataStaff.id,
      });
      const organization = await db.Organization.findOne();
      const lockTransaction = await db.sequelize.transaction();
      await db.Organization.findByPk(organization.id, {
        lock: lockTransaction.LOCK.UPDATE,
        transaction: lockTransaction,
      });
      await Promise.race([
        accountMetadata.updateAccountMetadata(created['manager-archived'].id, {
          lastLoginAt: new Date(),
        }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('metadata writer waited for Organization lock')), 1500),
        ),
      ]);
      await lockTransaction.rollback();
      const winnerEmail = initialOwner.email;
      await authService.login({ email: winnerEmail, password: 'Initial123!' });
      const refreshed = await db.Account.findByPk(initialOwner.id);
      assert.ok(refreshed.lastLoginAt);
      const after = await assertInitialized();
      assert.equal(after.counts.memberships, before.counts.memberships);
      assert.equal(after.counts.accesses, before.counts.accesses);
    });

    await t.test('sequential and concurrent last-owner guard leaves one active owner', async () => {
      const activeOwners = await db.Account.findAll({
        order: [['id', 'ASC']],
        where: { role: 'owner', status: 'active' },
      });
      assert.ok(activeOwners.length >= 2);
      for (const account of activeOwners.slice(2)) {
        await accountLifecycle.updateAccount(account.id, { role: 'manager' });
      }
      const contenders = await db.Account.findAll({
        order: [['id', 'ASC']],
        where: { role: 'owner', status: 'active' },
      });
      assert.equal(contenders.length, 2);
      const results = await Promise.allSettled(
        contenders.map((account) =>
          accountLifecycle.updateAccount(account.id, { status: 'inactive' }),
        ),
      );
      assert.deepEqual(
        results.map((result) => result.status).sort(),
        ['fulfilled', 'rejected'],
      );
      const lastOwner = await db.Account.findOne({
        where: { role: 'owner', status: 'active' },
      });
      await assert.rejects(
        accountLifecycle.updateAccount(lastOwner.id, { role: 'manager' }),
        (error) => error.code === 'LAST_ACTIVE_OWNER',
      );
      initialOwner = lastOwner;
      await assertInitialized();
    });

    await t.test('permanent delete preserves dependency checks and rolls back partial order', async () => {
      const account = await accountLifecycle.createAccount({
        email: 'delete-me@lifecycle.test',
        passwordHash: authService.hashPassword('Delete123!'),
        role: 'viewer',
        status: 'archived',
      });
      await assert.rejects(
        accountLifecycle.permanentDeleteAccount(account.id, {
          failAfter: 'membership',
        }),
        /Forced permanent-delete failure/,
      );
      assert.equal(await db.Account.count({ where: { id: account.id } }), 1);
      assert.equal(await db.Membership.count({ where: { accountId: account.id } }), 1);
      assert.equal(
        await db.MembershipClubAccess.count({
          where: {
            membershipId: (
              await db.Membership.findOne({ where: { accountId: account.id } })
            ).id,
          },
        }),
        1,
      );

      const dependency = await db.User.create({
        mergedByAccountId: account.id,
        name: 'Dependency QA',
        phone: `+7999${Date.now()}`.slice(0, 16),
        source: 'QA',
      });
      await assert.rejects(
        accountsService.removeArchived(initialOwner, account.id),
        /связанные действия/,
      );
      await dependency.destroy();
      await accountsService.removeArchived(initialOwner, account.id);
      assert.equal(await db.Account.count({ where: { id: account.id } }), 0);
      assert.equal(await db.Membership.count({ where: { accountId: account.id } }), 0);
      await assertInitialized();
    });

    await t.test('DB composite FKs reject cross-organization access rows', async () => {
      await assert.rejects(
        db.sequelize.transaction(async (transaction) => {
          const otherOrganization = await db.Organization.create(
            { name: 'Other', slug: 'other-test', status: 'active' },
            { transaction },
          );
          const otherClub = await db.Club.create(
            {
              name: 'Other',
              organizationId: otherOrganization.id,
              slug: 'other-test',
              status: 'active',
              timezone: 'Europe/Moscow',
            },
            { transaction },
          );
          const membership = await db.Membership.create(
            {
              accountId: created['manager-archived'].id,
              organizationId: otherOrganization.id,
              role: 'manager',
              status: 'archived',
            },
            { transaction },
          );
          const defaultClub = await db.Club.findOne({
            where: { slug: 'padel-park' },
            transaction,
          });
          assert.ok(otherClub);
          await db.MembershipClubAccess.create(
            {
              clubId: defaultClub.id,
              membershipId: membership.id,
              organizationId: defaultClub.organizationId,
              roleOverride: null,
              status: 'archived',
            },
            { transaction },
          );
        }),
        /foreign key constraint/i,
      );
      const nonOwnerMembership = await db.Membership.findOne({
        where: { role: { [db.Sequelize.Op.ne]: 'owner' } },
      });
      const defaultClub = await db.Club.findOne();
      await assert.rejects(
        db.sequelize.query(
          `UPDATE MembershipClubAccesses
              SET roleOverride = 'owner'
            WHERE membershipId = :membershipId AND clubId = :clubId`,
          {
            replacements: {
              clubId: defaultClub.id,
              membershipId: nonOwnerMembership.id,
            },
          },
        ),
        /Data truncated|Incorrect enum|invalid/i,
      );
      await assertInitialized();
    });

    await t.test('seed-demo-accounts and demo-crm-data maintain batch parity', async () => {
      await runDemoAccountSeed();
      await assertInitialized();
      assert.equal(
        await db.Account.count({ where: { email: 'owner@padelpark.demo' } }),
        1,
      );

      await demoSeeder.up(queryInterface, SequelizePackage);
      await assertInitialized();
      const nonDemoOwner = await db.Account.findByPk(initialOwner.id);
      await accountLifecycle.updateAccount(nonDemoOwner.id, { role: 'manager' });
      await demoSeeder.up(queryInterface, SequelizePackage);
      await assertInitialized();
      await assert.rejects(
        demoSeeder.down(queryInterface, SequelizePackage),
        /active owner/i,
      );
      assert.equal(
        await db.Account.count({ where: { email: 'owner@padelpark.demo' } }),
        1,
      );
      const demoOwner = await db.Account.findOne({
        where: { email: 'owner@padelpark.demo' },
      });
      await accountLifecycle.updateAccount(nonDemoOwner.id, {
        role: 'owner',
        status: 'active',
      });
      assert.ok(demoOwner);
      await demoSeeder.down(queryInterface, SequelizePackage);
      assert.equal(
        await db.Account.count({ where: { email: 'owner@padelpark.demo' } }),
        0,
      );
      initialOwner = nonDemoOwner;
      await assertInitialized();
    });

    await t.test('seeder forced failure rolls back all writes', async () => {
      const marker = `+7888${Date.now()}`.slice(0, 16);
      await assert.rejects(
        accountSeeder.runInitializedSeederBatch(
          queryInterface,
          async (scopedQueryInterface) => {
            await scopedQueryInterface.bulkInsert('Staffs', [
              {
                createdAt: new Date(),
                name: 'Forced Seeder QA',
                phone: marker,
                role: 'QA',
                status: 'active',
                updatedAt: new Date(),
              },
            ]);
          },
          { failAfter: 'batch' },
        ),
        /Forced seeder batch failure/,
      );
      assert.equal(await db.Staff.count({ where: { phone: marker } }), 0);
      await assertInitialized();
    });

    await t.test('invalid state is fail-closed for classifier, auth and API', async () => {
      const membership = await db.Membership.findOne({
        where: { accountId: created['manager-archived'].id },
      });
      await membership.update({ status: 'inactive' });
      tenantFoundation.invalidateTenantFoundationGateCache();
      const invalid = await tenantFoundation.classifyTenantFoundation();
      assert.equal(invalid.state, 'invalid');
      const socketResult = await socketHandshake(socketHttpServer, null);
      assert.equal(socketResult.socket, undefined);
      assert.equal(socketResult.error?.message, 'TENANT_FOUNDATION_INVALID');
      assert.equal(
        socketResult.error?.data?.code,
        'TENANT_FOUNDATION_INVALID',
      );
      assert.equal(socketResult.error?.data?.status, 503);
      await assert.rejects(
        authService.isSetupRequired(),
        (error) => error.code === 'TENANT_FOUNDATION_INVALID',
      );
      const response = await fetch(apiUrl(server, '/clients'));
      assert.equal(response.status, 503);
      assert.equal((await response.json()).code, 'TENANT_FOUNDATION_INVALID');
      const account = await db.Account.findByPk(membership.accountId);
      await membership.update({ status: account.status });
      tenantFoundation.invalidateTenantFoundationGateCache();
      await assertInitialized();
    });

    await t.test('rollback refuses later tenant columns before first DROP', async () => {
      const laterMigration =
        '20260715120000-add-tenant-context-plumbing.js';
      await queryInterface.bulkInsert('SequelizeMeta', [{ name: laterMigration }]);
      await assert.rejects(
        migration.down(queryInterface, SequelizePackage),
        /later tenant migrations/,
      );
      assert.ok((await queryInterface.showAllTables()).includes('Organizations'));
      await queryInterface.bulkDelete('SequelizeMeta', { name: laterMigration });
      await queryInterface.createTable('LaterTenantWave', {
        id: {
          autoIncrement: true,
          primaryKey: true,
          type: SequelizePackage.INTEGER,
        },
        organizationId: {
          allowNull: false,
          references: { key: 'id', model: 'Organizations' },
          type: SequelizePackage.INTEGER,
        },
      });
      await assert.rejects(
        migration.down(queryInterface, SequelizePackage),
        /external FKs|later tenant columns/,
      );
      assert.ok((await queryInterface.showAllTables()).includes('Organizations'));
      await queryInterface.dropTable('LaterTenantWave');
      await assertInitialized();
    });

    await t.test('initialized rollback/reapply restores identical checksum', async () => {
      const before = await assertInitialized();
      await migration.down(queryInterface, SequelizePackage);
      assert.equal(await db.Account.count(), before.counts.accounts);
      await migration.up(queryInterface, SequelizePackage);
      const after = await assertInitialized();
      assert.equal(after.checksum, before.checksum);
    });
  } finally {
    await closeServer(server).catch(() => {});
    if (socketIo) {
      await new Promise((resolve) => socketIo.close(resolve)).catch(() => {});
    }
    await closeServer(socketHttpServer).catch(() => {});
    if (db?.sequelize) await db.sequelize.close().catch(() => {});
    if (schemaSequelize) await schemaSequelize.close().catch(() => {});
    if (process.env.KEEP_TENANT_TEST_DB === 'true') {
      console.log(`[tenant-foundation] kept QA database ${database}`);
    } else {
      await admin.query(`DROP DATABASE IF EXISTS \`${database}\``).catch(() => {});
    }
    await admin.end();
  }
});
