'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const db = require('../../models');
const {
  createRealtimeEvent,
  getTenantDomainRoom,
  publishGlobalSystemEvent,
  publishRealtimeChange,
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
