'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const db = require('../../models');
const authService = require('../../src/services/auth.service');
const {
  ACCESS_SOCKET_ROOM,
  createRealtimeEvent,
  getLegacyRealtimeRoomsForRole,
  getRealtimeDomainRoom,
  getRealtimeRoomsForRole,
  getTenantDomainRoom,
  publishGlobalSystemEvent,
  publishRealtimeChange,
  revalidateSocket,
} = require('../../src/realtime');
const { mockExactSingletonDefault } = require('../helpers/tenant-fixtures');

function restore(name, value) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

function tenant({ clubId = null, membershipId = 21, organizationId, scope }) {
  return Object.freeze({
    accountId: 7,
    clubId,
    effectiveRole: 'manager',
    membershipId,
    membershipRole: 'manager',
    organizationId,
    scope,
  });
}

function fakeIo() {
  const emitted = [];
  return {
    emitted,
    to(room) {
      return {
        emit(eventName, payload) {
          emitted.push({ eventName, payload, room });
        },
      };
    },
  };
}

function routedFakeIo(sockets) {
  const emitted = [];
  return {
    emitted,
    in(room) {
      return {
        async fetchSockets() {
          return sockets.filter((socket) => socket.rooms.has(room));
        },
      };
    },
    to(room) {
      return {
        emit(eventName, payload) {
          emitted.push({ eventName, payload, room });
          for (const socket of sockets) {
            if (socket.rooms.has(room)) socket.received.push({ eventName, payload });
          }
        },
      };
    },
  };
}

test('flag off preserves the legacy event shape and role/domain room', async () => {
  const previousContext = process.env.TENANT_CONTEXT_ENABLED;
  const previousIsolation = process.env.TENANT_CACHE_REALTIME_ENABLED;
  const restoreSingleton = mockExactSingletonDefault(db);
  try {
    process.env.TENANT_CONTEXT_ENABLED = 'true';
    process.env.TENANT_CACHE_REALTIME_ENABLED = 'false';
    const io = fakeIo();
    const event = await publishRealtimeChange(
      io,
      { action: 'updated', domain: 'clients', entity: 'client', entityId: 42 },
      { id: 7, role: 'manager' },
    );
    assert.equal(io.emitted[0].room, 'crm:domain:clients');
    assert.equal('organizationId' in event, false);
    assert.equal(event.entityId, '42');
  } finally {
    restoreSingleton();
    restore('TENANT_CONTEXT_ENABLED', previousContext);
    restore('TENANT_CACHE_REALTIME_ENABLED', previousIsolation);
  }
});

test('flag-off account refresh replaces stale privileged rooms after role downgrade', async () => {
  const previousContext = process.env.TENANT_CONTEXT_ENABLED;
  const previousIsolation = process.env.TENANT_CACHE_REALTIME_ENABLED;
  const restoreSingleton = mockExactSingletonDefault(db);
  const originalRevalidateAuthentication = authService.revalidateAuthentication;
  try {
    process.env.TENANT_CONTEXT_ENABLED = 'true';
    process.env.TENANT_CACHE_REALTIME_ENABLED = 'false';
    authService.revalidateAuthentication = async (authentication) => ({
      account: { id: authentication.accountId, role: 'viewer', status: 'active' },
      authentication,
    });

    const socketRoom = 'socket-account-7';
    const socket = {
      data: {
        account: { id: 7, role: 'owner', status: 'active' },
        authentication: { accountId: 7, kind: 'legacy' },
      },
      join(room) {
        this.rooms.add(room);
      },
      leave(room) {
        this.rooms.delete(room);
      },
      received: [],
      rooms: new Set([socketRoom, ...getLegacyRealtimeRoomsForRole('owner')]),
    };
    const io = routedFakeIo([socket]);

    assert.equal(await revalidateSocket(socket), true);
    assert.equal(socket.data.account.role, 'viewer');
    assert.equal(socket.rooms.has(socketRoom), true);
    assert.equal(socket.rooms.has(ACCESS_SOCKET_ROOM), false);
    assert.equal(socket.rooms.has(getRealtimeDomainRoom('access')), false);
    assert.deepEqual(
      getRealtimeRoomsForRole('viewer').filter((room) => !socket.rooms.has(room)),
      [],
    );

    await publishRealtimeChange(
      io,
      { action: 'updated', domain: 'access', entity: 'visit', entityId: 42 },
      { id: 9, role: 'manager' },
    );
    io.to(ACCESS_SOCKET_ROOM).emit('scan_result', { success: true });
    assert.equal(socket.received.length, 0);

    await publishRealtimeChange(
      io,
      { action: 'updated', domain: 'onboarding', entity: 'progress', entityId: 7 },
      { id: 9, role: 'manager' },
    );
    assert.equal(socket.received.length, 1);
    assert.equal(socket.received[0].payload.domain, 'onboarding');
  } finally {
    authService.revalidateAuthentication = originalRevalidateAuthentication;
    restoreSingleton();
    restore('TENANT_CONTEXT_ENABLED', previousContext);
    restore('TENANT_CACHE_REALTIME_ENABLED', previousIsolation);
  }
});

test('flag on requires immutable server context and emits a tenant envelope to one room', async () => {
  const previousContext = process.env.TENANT_CONTEXT_ENABLED;
  const previousIsolation = process.env.TENANT_CACHE_REALTIME_ENABLED;
  try {
    process.env.TENANT_CONTEXT_ENABLED = 'true';
    process.env.TENANT_CACHE_REALTIME_ENABLED = 'true';
    const io = fakeIo();
    const clubTenant = tenant({ clubId: 12, organizationId: 11, scope: 'club' });
    const event = await publishRealtimeChange(
      io,
      { action: 'updated', domain: 'clients', entity: 'client', entityId: 42 },
      { id: 7, role: 'manager' },
      clubTenant,
    );
    assert.equal(io.emitted[0].room, getTenantDomainRoom('club', clubTenant, 'clients'));
    assert.deepEqual(
      {
        clubId: event.clubId,
        event: event.event,
        membershipId: event.membershipId,
        organizationId: event.organizationId,
        tenantScope: event.tenantScope,
      },
      {
        clubId: 12,
        event: 'crm:changed',
        membershipId: 21,
        organizationId: 11,
        tenantScope: 'club',
      },
    );
    assert.throws(
      () => createRealtimeEvent(
        { domain: 'clients', entity: 'client' },
        null,
        { ...clubTenant },
      ),
      (error) => error.code === 'TENANT_REALTIME_CONTEXT_REQUIRED',
    );
  } finally {
    restore('TENANT_CONTEXT_ENABLED', previousContext);
    restore('TENANT_CACHE_REALTIME_ENABLED', previousIsolation);
  }
});

test('same IDs in different organizations resolve to different delivery rooms', () => {
  const first = tenant({ clubId: 12, organizationId: 11, scope: 'club' });
  const second = tenant({ clubId: 12, organizationId: 22, scope: 'club' });
  // Club IDs are globally unique in production, but organization remains in the envelope.
  assert.notDeepEqual(
    { organizationId: first.organizationId, room: getTenantDomainRoom('club', first, 'clients') },
    { organizationId: second.organizationId, room: getTenantDomainRoom('club', second, 'clients') },
  );
});

test('global system events are strictly allowlisted', () => {
  const io = fakeIo();
  assert.throws(
    () => publishGlobalSystemEvent(io, 'clients:changed', {}),
    (error) => error.code === 'GLOBAL_REALTIME_EVENT_NOT_ALLOWLISTED',
  );
  const event = publishGlobalSystemEvent(io, 'system:maintenance', { active: true });
  assert.equal(event.tenantScope, 'global');
  assert.equal(io.emitted[0].room, 'system:global');
});
