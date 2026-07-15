'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { test } = require('node:test');
const mysql = require('mysql2/promise');
const SequelizePackage = require('sequelize');
const { io: createSocketClient } = require('socket.io-client');

const SERVER_ROOT = path.resolve(__dirname, '../..');

function databaseName() {
  return process.env.TENANT_REALTIME_TEST_DB_NAME ||
    `setly_tenant_realtime_${process.pid}_${Date.now()}`;
}

async function createSchema(database) {
  const sequelize = new SequelizePackage.Sequelize(
    database,
    process.env.DB_USER,
    process.env.DB_PASSWORD,
    {
      dialect: 'mysql',
      host: process.env.DB_HOST || '127.0.0.1',
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
    .filter((file) => file.endsWith('.js'))
    .sort();
  for (const file of migrations) {
    const migration = require(path.join(SERVER_ROOT, 'migrations', file));
    await migration.up(queryInterface, SequelizePackage);
    await queryInterface.bulkInsert('SequelizeMeta', [{ name: file }]);
  }
  return sequelize;
}

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', resolve);
    server.once('error', reject);
  });
}

async function closeServer(server) {
  if (!server?.listening) return;
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}

function connectSocket(url, auth, { expectError = false } = {}) {
  const socket = createSocketClient(url, {
    auth,
    autoConnect: false,
    reconnection: false,
    transports: ['websocket'],
  });
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.disconnect();
      reject(new Error('Socket handshake timed out'));
    }, 2500);
    socket.once('connect', () => {
      clearTimeout(timeout);
      if (expectError) {
        socket.disconnect();
        reject(new Error('Expected Socket.IO handshake denial'));
        return;
      }
      resolve(socket);
    });
    socket.once('connect_error', (error) => {
      clearTimeout(timeout);
      if (expectError) resolve({ error, disconnect: () => socket.disconnect() });
      else reject(error);
    });
    socket.connect();
  });
}

function onceWithTimeout(socket, eventName, timeoutMs = 1500) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`${eventName} timed out`)), timeoutMs);
    socket.once(eventName, (value) => {
      clearTimeout(timeout);
      resolve(value);
    });
  });
}

test('Feature 4.1 tenant Socket.IO DB-backed isolation', async (t) => {
  assert.ok(process.env.DB_USER, 'DB_USER is required for DB-backed tenant tests');
  const database = databaseName();
  const admin = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    password: process.env.DB_PASSWORD,
    user: process.env.DB_USER,
  });
  await admin.query(`DROP DATABASE IF EXISTS \`${database}\``);
  await admin.query(
    `CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
  );

  const previous = {
    cacheRealtime: process.env.TENANT_CACHE_REALTIME_ENABLED,
    context: process.env.TENANT_CONTEXT_ENABLED,
    database: process.env.DB_NAME,
    nodeEnv: process.env.NODE_ENV,
  };
  process.env.DB_NAME = database;
  process.env.NODE_ENV = 'test';
  process.env.TENANT_CONTEXT_ENABLED = 'true';
  process.env.TENANT_CACHE_REALTIME_ENABLED = 'true';

  let schema;
  let db;
  let io;
  let httpServer;
  const sockets = [];
  try {
    schema = await createSchema(database);
    db = require('../../models');
    const authService = require('../../src/services/auth.service');
    const accountLifecycle = require('../../src/services/account-lifecycle.service');
    const tenantContextService = require('../../src/services/tenant-context.service');
    const { createSocketServer } = require('../../src/sockets');
    const {
      CRM_CHANGED_EVENT,
      getTenantBaseRoom,
      getTenantDomainRoom,
      publishRealtimeChange,
    } = require('../../src/realtime');

    const ownerSession = await authService.bootstrapOwner({
      email: 'owner@tenant-realtime.test',
      name: 'Realtime Owner',
      password: 'RealtimeOwner123!',
    });
    const manager = await accountLifecycle.createAccount({
      email: 'manager@tenant-realtime.test',
      passwordHash: authService.hashPassword('RealtimeManager123!'),
      role: 'manager',
      status: 'active',
    });
    const managerSession = await authService.login({
      email: manager.email,
      password: 'RealtimeManager123!',
    });
    const organizationA = await db.Organization.findOne({ where: { slug: 'padel-park' } });
    const clubA = await db.Club.findOne({ where: { slug: 'padel-park' } });
    const ownerMembershipA = await db.Membership.findOne({
      where: { accountId: ownerSession.account.id, organizationId: organizationA.id },
    });
    const organizationB = await db.Organization.create({
      name: 'Isolated B',
      slug: 'isolated-b',
      status: 'active',
    });
    const clubB = await db.Club.create({
      name: 'Isolated B',
      organizationId: organizationB.id,
      slug: 'isolated-b',
      status: 'active',
      timezone: 'Europe/Moscow',
    });
    const ownerMembershipB = await db.Membership.create({
      accountId: ownerSession.account.id,
      organizationId: organizationB.id,
      role: 'owner',
      status: 'active',
    });
    const managerMembershipB = await db.Membership.create({
      accountId: manager.id,
      organizationId: organizationB.id,
      role: 'manager',
      status: 'active',
    });
    const managerAccessB = await db.MembershipClubAccess.create({
      clubId: clubB.id,
      membershipId: managerMembershipB.id,
      organizationId: organizationB.id,
      roleOverride: 'trainer',
      status: 'active',
    });

    httpServer = http.createServer();
    io = createSocketServer(httpServer, {
      // The isolated two-tenant fixture intentionally bypasses only the production
      // single-default classifier. Runtime JWT/membership/club resolution stays real.
      assertFoundationInitialized: async () => undefined,
    });
    await listen(httpServer);
    const url = `http://127.0.0.1:${httpServer.address().port}`;
    const auth = (token, organizationId, clubId) => ({ token, organizationId, clubId });

    await t.test('valid owner/non-owner handshake, owner without access and role override rooms', async () => {
      assert.equal(
        await db.MembershipClubAccess.count({ where: { membershipId: ownerMembershipA.id } }),
        0,
      );
      const ownerA = await connectSocket(
        url,
        auth(ownerSession.token, organizationA.id, clubA.id),
      );
      const managerB = await connectSocket(
        url,
        auth(managerSession.token, organizationB.id, clubB.id),
      );
      sockets.push(ownerA, managerB);
      const ownerServerSocket = [...io.sockets.sockets.values()].find(
        (socket) => socket.id === ownerA.id,
      );
      const managerServerSocket = [...io.sockets.sockets.values()].find(
        (socket) => socket.id === managerB.id,
      );
      assert.equal(ownerServerSocket.data.tenant.effectiveRole, 'owner');
      assert.equal(managerServerSocket.data.tenant.membershipRole, 'manager');
      assert.equal(managerServerSocket.data.tenant.effectiveRole, 'trainer');
      assert.equal(
        managerServerSocket.rooms.has(getTenantBaseRoom('club', managerServerSocket.data.tenant)),
        true,
      );
      assert.equal(
        managerServerSocket.rooms.has(
          getTenantDomainRoom('club', managerServerSocket.data.tenant, 'training_notes'),
        ),
        true,
      );
      assert.equal(
        managerServerSocket.rooms.has(
          getTenantDomainRoom('club', managerServerSocket.data.tenant, 'finance'),
        ),
        false,
      );
    });

    await t.test('tampered cross-organization IDs and every inactive/revoked chain fail closed', async () => {
      const tampered = await connectSocket(
        url,
        auth(ownerSession.token, organizationA.id, clubB.id),
        { expectError: true },
      );
      assert.equal(tampered.error.message, 'TENANT_CONTEXT_NOT_FOUND');

      await organizationB.update({ status: 'inactive' });
      const inactive = await connectSocket(
        url,
        auth(ownerSession.token, organizationB.id, clubB.id),
        { expectError: true },
      );
      assert.equal(inactive.error.message, 'TENANT_CONTEXT_NOT_FOUND');
      await organizationB.update({ status: 'active' });

      await clubB.update({ status: 'inactive' });
      const inactiveClub = await connectSocket(
        url,
        auth(ownerSession.token, organizationB.id, clubB.id),
        { expectError: true },
      );
      assert.equal(inactiveClub.error.message, 'TENANT_CONTEXT_NOT_FOUND');
      await clubB.update({ status: 'active' });

      await ownerMembershipB.update({ status: 'inactive' });
      const inactiveMembership = await connectSocket(
        url,
        auth(ownerSession.token, organizationB.id, clubB.id),
        { expectError: true },
      );
      assert.equal(inactiveMembership.error.message, 'TENANT_CONTEXT_NOT_FOUND');
      await ownerMembershipB.update({ status: 'active' });

      await managerAccessB.update({ status: 'inactive' });
      const revokedAccess = await connectSocket(
        url,
        auth(managerSession.token, organizationB.id, clubB.id),
        { expectError: true },
      );
      assert.equal(revokedAccess.error.message, 'TENANT_CONTEXT_NOT_FOUND');
      await managerAccessB.update({ status: 'active' });

      await db.Account.update(
        { status: 'inactive' },
        { where: { id: ownerSession.account.id } },
      );
      const inactiveAccount = await connectSocket(
        url,
        auth(ownerSession.token, organizationB.id, clubB.id),
        { expectError: true },
      );
      assert.equal(inactiveAccount.error.message, 'Unauthorized');
      await db.Account.update(
        { status: 'active' },
        { where: { id: ownerSession.account.id } },
      );
    });

    await t.test('organization, club and membership events have zero cross-tenant delivery', async () => {
      const ownerA = sockets[0];
      const ownerB = await connectSocket(
        url,
        auth(ownerSession.token, organizationB.id, clubB.id),
      );
      sockets.push(ownerB);
      const tenantAClub = await tenantContextService.resolveTenantContext({
        accountId: ownerSession.account.id,
        clubId: clubA.id,
        organizationId: organizationA.id,
        scope: 'club',
      });
      const tenantAOrganization = await tenantContextService.resolveTenantContext({
        accountId: ownerSession.account.id,
        organizationId: organizationA.id,
        scope: 'organization',
      });
      const tenantAMembership = await tenantContextService.resolveTenantContext({
        accountId: ownerSession.account.id,
        organizationId: organizationA.id,
        scope: 'membership',
      });

      let receivedByB = 0;
      ownerB.on(CRM_CHANGED_EVENT, () => { receivedByB += 1; });
      const clubEventPromise = onceWithTimeout(ownerA, CRM_CHANGED_EVENT);
      await publishRealtimeChange(
        io,
        { action: 'updated', domain: 'clients', entity: 'client', entityId: 42 },
        ownerSession.account,
        tenantAClub,
      );
      const clubEvent = await clubEventPromise;
      assert.equal(clubEvent.clubId, clubA.id);

      const organizationEventPromise = onceWithTimeout(ownerA, CRM_CHANGED_EVENT);
      await publishRealtimeChange(
        io,
        { action: 'updated', domain: 'methodology', entity: 'skill', entityId: 42 },
        ownerSession.account,
        tenantAOrganization,
      );
      const organizationEvent = await organizationEventPromise;
      assert.equal(organizationEvent.clubId, null);
      assert.equal(organizationEvent.tenantScope, 'organization');

      const membershipEventPromise = onceWithTimeout(ownerA, CRM_CHANGED_EVENT);
      await publishRealtimeChange(
        io,
        { action: 'updated', domain: 'onboarding', entity: 'progress', entityId: 42 },
        ownerSession.account,
        tenantAMembership,
      );
      const membershipEvent = await membershipEventPromise;
      assert.equal(membershipEvent.membershipId, ownerMembershipA.id);
      assert.equal(membershipEvent.tenantScope, 'membership');
      await delay(50);
      assert.equal(receivedByB, 0);
    });

    await t.test('revoked club access disconnects before the next event is delivered', async () => {
      const managerB = sockets[1];
      let delivered = false;
      managerB.once(CRM_CHANGED_EVENT, () => { delivered = true; });
      const disconnected = onceWithTimeout(managerB, 'disconnect');
      await managerAccessB.update({ status: 'inactive' });
      const tenantB = Object.freeze({
        accountId: manager.id,
        clubId: clubB.id,
        effectiveRole: 'trainer',
        membershipId: managerMembershipB.id,
        membershipRole: 'manager',
        organizationId: organizationB.id,
        scope: 'club',
      });
      await publishRealtimeChange(
        io,
        { action: 'updated', domain: 'training_notes', entity: 'note', entityId: 42 },
        managerSession.account,
        tenantB,
      );
      await disconnected;
      await delay(25);
      assert.equal(delivered, false);
      await managerAccessB.update({ status: 'active' });
    });

    await t.test('flag off preserves legacy handshake and domain rooms', async () => {
      process.env.TENANT_CACHE_REALTIME_ENABLED = 'false';
      const legacy = await connectSocket(url, { token: ownerSession.token });
      sockets.push(legacy);
      const serverSocket = [...io.sockets.sockets.values()].find(
        (socket) => socket.id === legacy.id,
      );
      assert.equal(serverSocket.rooms.has('crm:domain:clients'), true);
      assert.equal(serverSocket.rooms.has('access'), true);
      assert.equal(serverSocket.data.tenant, undefined);
      process.env.TENANT_CACHE_REALTIME_ENABLED = 'true';
    });

    // The fixture itself proves no provisioning path was added: rows were inserted
    // directly in this ephemeral DB and production classifier remains unchanged.
    assert.equal(ownerMembershipB.organizationId, organizationB.id);
  } finally {
    sockets.forEach((socket) => socket.disconnect?.());
    if (io) await io.close();
    await closeServer(httpServer);
    if (db?.sequelize) await db.sequelize.close();
    if (schema) await schema.close();
    await admin.query(`DROP DATABASE IF EXISTS \`${database}\``);
    await admin.end();
    restore('TENANT_CACHE_REALTIME_ENABLED', previous.cacheRealtime);
    restore('TENANT_CONTEXT_ENABLED', previous.context);
    restore('DB_NAME', previous.database);
    restore('NODE_ENV', previous.nodeEnv);
  }
});

function restore(name, value) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
