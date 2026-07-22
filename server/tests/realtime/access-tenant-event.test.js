'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  getTenantDomainRoom,
  publishTenantSocketEvent,
} = require('../../src/realtime');

function tenant(clubId) {
  return Object.freeze({
    accountId: 7,
    clubId,
    effectiveRole: 'admin',
    membershipId: clubId + 100,
    membershipRole: 'admin',
    organizationId: 11,
    scope: 'club',
  });
}

function ioFixture() {
  const emissions = [];
  const inspectedRooms = [];
  return {
    emissions,
    inspectedRooms,
    in(room) {
      inspectedRooms.push(room);
      return { fetchSockets: async () => [] };
    },
    to(room) {
      return {
        emit(eventName, payload) {
          emissions.push({ eventName, payload, room });
        },
      };
    },
  };
}

test('access scan events are emitted only to the authoritative club room', async () => {
  const previous = process.env.TENANT_CACHE_REALTIME_ENABLED;
  process.env.TENANT_CACHE_REALTIME_ENABLED = 'true';
  try {
    const io = ioFixture();
    const firstTenant = tenant(21);
    const secondTenant = tenant(22);
    const payload = { clientEventId: 'scan-1', visitId: 91 };
    const envelope = await publishTenantSocketEvent(
      io,
      'scan_result',
      'access',
      payload,
      firstTenant,
    );

    const firstRoom = getTenantDomainRoom('club', firstTenant, 'access');
    const secondRoom = getTenantDomainRoom('club', secondTenant, 'access');
    assert.deepEqual(io.inspectedRooms, [firstRoom]);
    assert.equal(io.emissions.length, 1);
    assert.equal(io.emissions[0].room, firstRoom);
    assert.notEqual(io.emissions[0].room, secondRoom);
    assert.equal(io.emissions[0].eventName, 'scan_result');
    assert.deepEqual(envelope, {
      clubId: firstTenant.clubId,
      data: payload,
      domain: 'access',
      event: 'scan_result',
      membershipId: firstTenant.membershipId,
      organizationId: firstTenant.organizationId,
      tenantScope: 'club',
    });
  } finally {
    if (previous === undefined) delete process.env.TENANT_CACHE_REALTIME_ENABLED;
    else process.env.TENANT_CACHE_REALTIME_ENABLED = previous;
  }
});
