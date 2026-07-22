'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const { setTimeout: delay } = require('node:timers/promises');
const { test } = require('node:test');
const SequelizePackage = require('sequelize');
const { io: createSocketClient } = require('socket.io-client');
const {
  createDisposableDatabase,
  dropDisposableDatabase,
} = require('../helpers/final-tenant-rc-fixture');
const {
  ACCEPTED_TENANT_CAPABILITY_ENV,
} = require('../helpers/accepted-tenant-schema');
const sessionMigration = require('../../migrations/20260722100000-create-normal-user-sessions');

function bounded(label, promise, timeoutMs) {
  let timeout;
  return Promise.race([
    Promise.resolve(promise),
    new Promise((_, reject) => {
      timeout = setTimeout(() => reject(new Error(`${label} timed out`)), timeoutMs);
      timeout.unref?.();
    }),
  ]).finally(() => clearTimeout(timeout));
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

async function startRuntime(createApp, createSocketServer, tenantEnabled) {
  process.env.TENANT_CONTEXT_ENABLED = tenantEnabled ? 'true' : 'false';
  process.env.TENANT_CACHE_REALTIME_ENABLED = tenantEnabled ? 'true' : 'false';
  const app = createApp();
  const server = http.createServer(app);
  const io = createSocketServer(server, { sessionRevalidateMs: 20 });
  app.set('io', io);
  await listen(server);
  return {
    app,
    io,
    server,
    url: `http://127.0.0.1:${server.address().port}`,
  };
}

async function stopRuntime(runtime) {
  if (!runtime) return;
  if (runtime.io) {
    await bounded(
      'Socket.IO close',
      new Promise((resolve) => runtime.io.close(resolve)),
      5_000,
    );
  }
  await bounded('HTTP server close', closeServer(runtime.server), 5_000);
}

async function api(runtime, path, { body, method = 'GET', token } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${runtime.url}/api${path}`, {
    body: body === undefined ? undefined : JSON.stringify(body),
    headers,
    method,
  });
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }
  return { headers: response.headers, payload, status: response.status };
}

function connectSocket(runtime, auth, transport, { expectError = false } = {}) {
  const socket = createSocketClient(runtime.url, {
    auth,
    autoConnect: false,
    reconnection: false,
    transports: [transport],
  });
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.disconnect();
      reject(new Error(`${transport} Socket.IO handshake timed out`));
    }, 3000);
    socket.once('connect', () => {
      clearTimeout(timeout);
      if (expectError) {
        socket.disconnect();
        reject(new Error(`Expected ${transport} Socket.IO handshake denial`));
        return;
      }
      resolve(socket);
    });
    socket.once('connect_error', (error) => {
      clearTimeout(timeout);
      if (expectError) resolve({ disconnect: () => socket.disconnect(), error });
      else reject(error);
    });
    socket.connect();
  });
}

function disconnected(socket, timeoutMs = 2500) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Socket disconnect timed out')), timeoutMs);
    socket.once('disconnect', (reason) => {
      clearTimeout(timeout);
      resolve(reason);
    });
  });
}

async function waitUntil(label, predicate, timeoutMs = 2500) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await delay(20);
  }
  throw new Error(`${label} timed out`);
}

function restoreEnvironment(previous) {
  for (const [name, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

async function createFocusedRuntimeSchema(db) {
  for (const modelName of [
    'Organization',
    'Club',
    'Staff',
    'Account',
    'Membership',
    'MembershipClubAccess',
  ]) {
    await db[modelName].sync();
  }
  await sessionMigration.up(db.sequelize.getQueryInterface(), SequelizePackage);
  const organization = await db.Organization.create({
    name: 'Padel Park',
    slug: 'padel-park',
    status: 'active',
  });
  await db.Club.create({
    name: 'Padel Park',
    organizationId: organization.id,
    slug: 'padel-park',
    status: 'active',
    timezone: 'Europe/Moscow',
  });
}

test('SEC-A5 opaque HTTP sessions, lifecycle revocation and Socket.IO boundary', {
  timeout: 300_000,
}, async (t) => {
  assert.ok(process.env.DB_USER, 'DB_USER is required for opaque-session DB tests');
  const database = `setly_f9_rc_opaque_sessions_${process.pid}_${Date.now()}`;
  const envKeys = [
    ...ACCEPTED_TENANT_CAPABILITY_ENV,
    'AUTH_ARGON2_ENABLED',
    'AUTH_LEGACY_TOKEN_ACCEPT_UNTIL',
    'AUTH_LEGACY_TOKEN_MODE',
    'AUTH_RATE_LIMIT_MODE',
    'AUTH_SECRET',
    'AUTH_SOCKET_REVALIDATE_MS',
    'DB_NAME',
    'NODE_ENV',
    'SECURITY_HSTS_ENABLED',
    'SECURITY_HSTS_TLS_READY',
    'SETLY_ROLLOUT_MAINTENANCE_MODE',
  ];
  const previous = Object.fromEntries(envKeys.map((name) => [name, process.env[name]]));
  let schema;
  let db;
  let runtime;
  await createDisposableDatabase(database);
  process.env.DB_NAME = database;
  process.env.NODE_ENV = 'test';
  process.env.AUTH_ARGON2_ENABLED = 'false';
  process.env.AUTH_LEGACY_TOKEN_MODE = 'off';
  delete process.env.AUTH_LEGACY_TOKEN_ACCEPT_UNTIL;
  process.env.AUTH_RATE_LIMIT_MODE = 'off';
  process.env.AUTH_SECRET = 'opaque-session-test-legacy-secret';
  process.env.AUTH_SOCKET_REVALIDATE_MS = '1000';
  process.env.SECURITY_HSTS_ENABLED = 'false';
  process.env.SECURITY_HSTS_TLS_READY = 'false';
  process.env.SETLY_ROLLOUT_MAINTENANCE_MODE = 'off';
  for (const name of ACCEPTED_TENANT_CAPABILITY_ENV) process.env[name] = 'false';

  try {
    db = require('../../models');
    schema = db.sequelize;
    await bounded('focused runtime schema', createFocusedRuntimeSchema(db), 30_000);
    t.diagnostic('focused runtime schema completed');
    const authService = require('../../src/services/auth.service');
    const accountLifecycle = require('../../src/services/account-lifecycle.service');
    const accountMetadata = require('../../src/services/account-metadata.service');
    const staffService = require('../../src/services/staff.service');
    const createApp = require('../../src/app');
    const { createSocketServer } = require('../../src/sockets');
    const {
      ACCESS_SOCKET_ROOM,
      CRM_CHANGED_EVENT,
      getRealtimeDomainRoom,
      getRealtimeRoomsForRole,
      publishRealtimeChange,
    } = require('../../src/realtime');
    const normalUserSessions = authService._private.normalUserSessions;

    runtime = await startRuntime(createApp, createSocketServer, false);
    const bootstrap = await api(runtime, '/auth/bootstrap', {
      body: {
        email: 'owner@opaque-session.test',
        name: 'Opaque Session Owner',
        password: 'OwnerOpaque123!',
      },
      method: 'POST',
    });
    assert.equal(bootstrap.status, 200);
    assert.match(bootstrap.payload.token, /^setly_s1_[A-Za-z0-9_-]{43}$/u);
    assert.equal(bootstrap.payload.account.passwordHash, undefined);

    const organization = await db.Organization.findOne({ where: { slug: 'padel-park' } });
    const club = await db.Club.findOne({ where: { slug: 'padel-park' } });
    const staff = await db.Staff.create({
      name: 'Opaque Session Manager',
      organizationId: organization.id,
      role: 'Администратор',
      status: 'active',
    });
    const manager = await accountLifecycle.createAccount(
      {
        email: 'manager@opaque-session.test',
        passwordHash: await authService.hashPassword('ManagerOpaque123!'),
        role: 'admin',
        staffId: staff.id,
        status: 'active',
      },
      { organizationId: organization.id },
    );

    await t.test('issuance persists only a digest', async () => {
      const [sessionRows] = await schema.query(
        `SELECT id, accountId, tokenDigest, expiresAt, revokedAt, revokedReason, createdAt
           FROM NormalUserSessions WHERE accountId=:accountId`,
        { replacements: { accountId: bootstrap.payload.account.id } },
      );
      assert.equal(sessionRows.length, 1);
      const row = sessionRows[0];
      assert.match(row.tokenDigest, /^[a-f0-9]{64}$/u);
      assert.equal(JSON.stringify(row).includes(bootstrap.payload.token), false);
      const modelView = await db.NormalUserSession.findByPk(row.id);
      assert.equal(Object.hasOwn(modelView.toJSON(), 'tokenDigest'), false);

    });

    await t.test('legacy compatibility is absolute, bounded, killable and role-fresh', async () => {
      process.env.AUTH_LEGACY_TOKEN_MODE = 'accept';
      process.env.AUTH_LEGACY_TOKEN_ACCEPT_UNTIL = new Date(Date.now() + 5 * 60 * 1000).toISOString();
      const legacyToken = authService._private.signLegacyToken({
        accountId: manager.id,
        role: 'owner',
        staffId: 999999,
      });
      const first = await api(runtime, '/auth/me', { token: legacyToken });
      assert.equal(first.status, 200);
      assert.equal(first.payload.account.role, 'admin');
      assert.notEqual(first.payload.account.staffId, 999999);

      const opaqueBeforeRoleChange = await authService.login({
        email: manager.email,
        password: 'ManagerOpaque123!',
      });

      await accountLifecycle.updateAccount(
        manager.id,
        { role: 'viewer' },
        { organizationId: organization.id },
      );
      assert.equal(
        (await api(runtime, '/auth/me', { token: opaqueBeforeRoleChange.token })).status,
        401,
      );
      const fresh = await api(runtime, '/auth/me', { token: legacyToken });
      assert.equal(fresh.status, 200);
      assert.equal(fresh.payload.account.role, 'viewer');

      process.env.AUTH_LEGACY_TOKEN_ACCEPT_UNTIL = new Date(Date.now() - 1000).toISOString();
      assert.equal((await api(runtime, '/auth/me', { token: legacyToken })).status, 401);
      process.env.AUTH_LEGACY_TOKEN_ACCEPT_UNTIL = new Date(Date.now() + 13 * 60 * 60 * 1000).toISOString();
      assert.throws(
        () => authService.validateAuthSessionConfiguration(),
        /cannot exceed 12 hours/u,
      );
      process.env.AUTH_LEGACY_TOKEN_MODE = 'off';
      assert.equal((await api(runtime, '/auth/me', { token: legacyToken })).status, 401);
      delete process.env.AUTH_LEGACY_TOKEN_ACCEPT_UNTIL;
    });

    await t.test('raw opaque credentials stay out of console output and auth errors', async () => {
      const captured = [];
      const originals = Object.fromEntries(
        ['error', 'info', 'log', 'warn'].map((method) => [method, console[method]]),
      );
      for (const method of Object.keys(originals)) {
        console[method] = (...values) => captured.push(
          values.map((value) =>
            typeof value === 'string' ? value : JSON.stringify(value)).join(' '),
        );
      }
      let token;
      let denial;
      try {
        const session = await authService.login({
          email: manager.email,
          password: 'ManagerOpaque123!',
        });
        token = session.token;
        denial = await api(runtime, '/auth/me', {
          token: `setly_s1_${'Z'.repeat(43)}`,
        });
        await api(runtime, '/auth/logout', { method: 'POST', token });
      } finally {
        for (const [method, implementation] of Object.entries(originals)) {
          console[method] = implementation;
        }
      }
      assert.equal(denial.status, 401);
      assert.equal(JSON.stringify(denial.payload).includes(token), false);
      assert.equal(captured.join('\n').includes(token), false);
    });

    await t.test('logout is self-only, generic, idempotent and leaves sibling session active', async () => {
      const first = await authService.login({
        email: manager.email,
        password: 'ManagerOpaque123!',
      });
      const second = await authService.login({
        email: manager.email,
        password: 'ManagerOpaque123!',
      });
      assert.notEqual(first.token, second.token);
      const concurrentLogouts = await Promise.all([
        api(runtime, '/auth/logout', { method: 'POST', token: first.token }),
        api(runtime, '/auth/logout', { method: 'POST', token: first.token }),
      ]);
      assert.deepEqual(
        concurrentLogouts.map(({ payload, status }) => ({ payload, status })),
        [
          { payload: { success: true }, status: 200 },
          { payload: { success: true }, status: 200 },
        ],
      );
      assert.deepEqual(
        (await api(runtime, '/auth/logout', { method: 'POST', token: first.token })).payload,
        { success: true },
      );
      const revoked = await api(runtime, '/auth/me', { token: first.token });
      const unknown = await api(runtime, '/auth/me', {
        token: `setly_s1_${'A'.repeat(43)}`,
      });
      assert.equal(revoked.status, 401);
      assert.deepEqual(revoked.payload, unknown.payload);
      assert.equal(JSON.stringify(revoked.payload).includes(first.token), false);
      assert.equal((await api(runtime, '/auth/me', { token: second.token })).status, 200);
    });

    await t.test('expiry, password change and account disable revoke without changing Argon CAS', async () => {
      const expiring = await normalUserSessions.issue(manager.id, { ttlSeconds: 1 });
      await delay(1100);
      assert.equal((await api(runtime, '/auth/me', { token: expiring.token })).status, 401);

      const casSession = await authService.login({
        email: manager.email,
        password: 'ManagerOpaque123!',
      });
      const beforeCas = await db.Account.findByPk(manager.id);
      const nextEquivalentHash = await authService.hashPassword('ManagerOpaque123!');
      assert.equal(
        await accountMetadata.compareAndSwapPasswordHash(
          manager.id,
          beforeCas.passwordHash,
          nextEquivalentHash,
        ),
        true,
      );
      assert.equal((await api(runtime, '/auth/me', { token: casSession.token })).status, 200);

      await accountMetadata.updateAccountMetadata(manager.id, {
        passwordHash: await authService.hashPassword('ManagerOpaque456!'),
      });
      assert.equal((await api(runtime, '/auth/me', { token: casSession.token })).status, 401);

      const disabledSession = await authService.login({
        email: manager.email,
        password: 'ManagerOpaque456!',
      });
      await accountLifecycle.updateAccount(
        manager.id,
        { status: 'inactive' },
        { organizationId: organization.id },
      );
      assert.equal((await api(runtime, '/auth/me', { token: disabledSession.token })).status, 401);
      const disabledRow = await db.NormalUserSession.unscoped().findOne({
        where: { tokenDigest: normalUserSessions._private.digestToken(disabledSession.token) },
      });
      assert.equal(disabledRow.revokedReason, 'account_disabled');
      await accountLifecycle.updateAccount(
        manager.id,
        { status: 'active' },
        { organizationId: organization.id },
      );
      assert.equal((await api(runtime, '/auth/me', { token: disabledSession.token })).status, 401);

      const staffLifecycleSession = await authService.login({
        email: manager.email,
        password: 'ManagerOpaque456!',
      });
      await staffService.update(staff.id, {
        name: staff.name,
        position: staff.role,
        status: 'inactive',
      });
      assert.equal(
        (await api(runtime, '/auth/me', { token: staffLifecycleSession.token })).status,
        401,
      );
      const staffLifecycleRow = await db.NormalUserSession.unscoped().findOne({
        where: {
          tokenDigest: normalUserSessions._private.digestToken(staffLifecycleSession.token),
        },
      });
      assert.equal(staffLifecycleRow.revokedReason, 'staff_disabled');
      await staffService.restore(staff.id);
    });

    await t.test('legacy flag-off role downgrade reconciles rooms before later delivery', async () => {
      await accountLifecycle.updateAccount(
        manager.id,
        { role: 'admin' },
        { organizationId: organization.id },
      );
      process.env.AUTH_LEGACY_TOKEN_MODE = 'accept';
      process.env.AUTH_LEGACY_TOKEN_ACCEPT_UNTIL = new Date(
        Date.now() + 60_000,
      ).toISOString();
      const socket = await connectSocket(
        runtime,
        {
          token: authService._private.signLegacyToken({
            accountId: manager.id,
            role: 'owner',
            staffId: 999999,
          }),
        },
        'websocket',
      );

      try {
        const serverSocket = runtime.io.sockets.sockets.get(socket.id);
        assert.ok(serverSocket);
        assert.equal(serverSocket.rooms.has(ACCESS_SOCKET_ROOM), true);
        assert.equal(serverSocket.rooms.has(getRealtimeDomainRoom('access')), true);

        await accountLifecycle.updateAccount(
          manager.id,
          { role: 'viewer' },
          { organizationId: organization.id },
        );
        const viewerRooms = new Set(getRealtimeRoomsForRole('viewer'));
        const removedAdminRooms = getRealtimeRoomsForRole('admin')
          .filter((room) => !viewerRooms.has(room));
        await waitUntil('legacy socket room reconciliation', () => (
          serverSocket.data.account.role === 'viewer' &&
          !serverSocket.rooms.has(ACCESS_SOCKET_ROOM) &&
          removedAdminRooms.every((room) => !serverSocket.rooms.has(room)) &&
          [...viewerRooms].every((room) => serverSocket.rooms.has(room))
        ));

        const deliveredDomains = [];
        let deliveredScanResults = 0;
        socket.on(CRM_CHANGED_EVENT, (event) => deliveredDomains.push(event.domain));
        socket.on('scan_result', () => {
          deliveredScanResults += 1;
        });
        await publishRealtimeChange(
          runtime.io,
          { action: 'updated', domain: 'access', entity: 'visit', entityId: 42 },
          bootstrap.payload.account,
        );
        runtime.io.to(ACCESS_SOCKET_ROOM).emit('scan_result', { success: true });
        await delay(100);
        assert.equal(deliveredDomains.includes('access'), false);
        assert.equal(deliveredScanResults, 0);

        await publishRealtimeChange(
          runtime.io,
          { action: 'updated', domain: 'onboarding', entity: 'progress', entityId: manager.id },
          bootstrap.payload.account,
        );
        await waitUntil(
          'current viewer room delivery',
          () => deliveredDomains.includes('onboarding'),
        );
      } finally {
        socket.disconnect();
        process.env.AUTH_LEGACY_TOKEN_MODE = 'off';
        delete process.env.AUTH_LEGACY_TOKEN_ACCEPT_UNTIL;
      }
    });

    async function exerciseSocketMode(tenantEnabled) {
      await stopRuntime(runtime);
      runtime = await startRuntime(createApp, createSocketServer, tenantEnabled);
      const socketAuth = (token) => ({
        token,
        ...(tenantEnabled
          ? { clubId: club.id, organizationId: organization.id }
          : {}),
      });

      for (const transport of ['polling', 'websocket']) {
        const validSession = await authService.login({
          email: manager.email,
          password: 'ManagerOpaque456!',
        });
        const valid = await connectSocket(
          runtime,
          socketAuth(validSession.token),
          transport,
        );
        valid.disconnect();

        const revokedSession = await authService.login({
          email: manager.email,
          password: 'ManagerOpaque456!',
        });
        await api(runtime, '/auth/logout', {
          method: 'POST',
          token: revokedSession.token,
        });
        const denied = await connectSocket(
          runtime,
          socketAuth(revokedSession.token),
          transport,
          { expectError: true },
        );
        assert.equal(denied.error.message, 'Unauthorized');
        denied.disconnect();

        const connectedSession = await authService.login({
          email: manager.email,
          password: 'ManagerOpaque456!',
        });
        const connected = await connectSocket(
          runtime,
          socketAuth(connectedSession.token),
          transport,
        );
        const revokedDisconnect = disconnected(connected);
        await api(runtime, '/auth/logout', {
          method: 'POST',
          token: connectedSession.token,
        });
        await revokedDisconnect;

        const expiring = await normalUserSessions.issue(manager.id, { ttlSeconds: 1 });
        const expiringSocket = await connectSocket(
          runtime,
          socketAuth(expiring.token),
          transport,
        );
        await disconnected(expiringSocket);

        const disableSession = await authService.login({
          email: manager.email,
          password: 'ManagerOpaque456!',
        });
        const disableSocket = await connectSocket(
          runtime,
          socketAuth(disableSession.token),
          transport,
        );
        const disabledDisconnect = disconnected(disableSocket);
        await db.Account.update(
          { status: 'inactive' },
          { where: { id: manager.id } },
        );
        await disabledDisconnect;
        await db.Account.update(
          { status: 'active' },
          { where: { id: manager.id } },
        );
        assert.equal((await api(runtime, '/auth/me', { token: disableSession.token })).status, 401);

        const staffDisableSession = await authService.login({
          email: manager.email,
          password: 'ManagerOpaque456!',
        });
        const staffDisableSocket = await connectSocket(
          runtime,
          socketAuth(staffDisableSession.token),
          transport,
        );
        const staffDisabledDisconnect = disconnected(staffDisableSocket);
        await db.Staff.update(
          { status: 'inactive' },
          { where: { id: staff.id } },
        );
        await staffDisabledDisconnect;
        await db.Staff.update(
          { status: 'active' },
          { where: { id: staff.id } },
        );
        const staffDisabledRow = await db.NormalUserSession.unscoped().findOne({
          where: {
            tokenDigest: normalUserSessions._private.digestToken(staffDisableSession.token),
          },
        });
        assert.equal(staffDisabledRow.revokedReason, 'staff_disabled');

        process.env.AUTH_LEGACY_TOKEN_MODE = 'accept';
        process.env.AUTH_LEGACY_TOKEN_ACCEPT_UNTIL = new Date(
          Date.now() + 60_000,
        ).toISOString();
        const legacySocket = await connectSocket(
          runtime,
          socketAuth(authService._private.signLegacyToken({
            accountId: manager.id,
            role: 'owner',
            staffId: 999999,
          })),
          transport,
        );
        const cutoffDisconnect = disconnected(legacySocket);
        process.env.AUTH_LEGACY_TOKEN_ACCEPT_UNTIL = new Date(
          Date.now() - 1_000,
        ).toISOString();
        await cutoffDisconnect;
        process.env.AUTH_LEGACY_TOKEN_MODE = 'off';
        delete process.env.AUTH_LEGACY_TOKEN_ACCEPT_UNTIL;
      }
    }

    await t.test('polling and WebSocket revoke/expire/account+staff disable/legacy cutoff in tenant flag off', async () => {
      await exerciseSocketMode(false);
    });
    await t.test('polling and WebSocket revoke/expire/account+staff disable/legacy cutoff in tenant flag on', async () => {
      await exerciseSocketMode(true);
    });

    const rawDatabaseDump = JSON.stringify(
      await schema.query(
        `SELECT id,accountId,tokenDigest,expiresAt,revokedAt,revokedReason
           FROM NormalUserSessions ORDER BY createdAt,id`,
      ),
    );
    assert.equal(rawDatabaseDump.includes(bootstrap.payload.token), false);
  } finally {
    await stopRuntime(runtime);
    if (db?.sequelize) await bounded('close model connection', db.sequelize.close(), 10_000);
    await bounded('drop disposable database', dropDisposableDatabase(database), 15_000);
    restoreEnvironment(previous);
  }
});
