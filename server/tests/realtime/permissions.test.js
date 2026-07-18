const assert = require('node:assert/strict');
const test = require('node:test');
const {
  canReceiveDomain,
  getRealtimeDomainRoom,
  getRealtimeRoomsForRole,
  getRolesForDomain,
  getTenantBaseRoom,
  getTenantDomainRoom,
  getTenantRoomsForContext,
} = require('../../src/realtime');

test('realtime domain rooms follow access matrix visibility', () => {
  assert.equal(canReceiveDomain('trainer', 'clients'), true);
  assert.equal(canReceiveDomain('trainer', 'training_notes'), true);
  assert.equal(canReceiveDomain('trainer', 'methodology'), true);

  assert.equal(canReceiveDomain('trainer', 'finance'), false);
  assert.equal(canReceiveDomain('trainer', 'call_tasks'), false);
  assert.equal(canReceiveDomain('trainer', 'access'), false);
});

test('realtime finance and catalog rooms do not leak to admins or trainers', () => {
  assert.equal(canReceiveDomain('accountant', 'finance'), true);
  assert.equal(canReceiveDomain('accountant', 'catalog'), true);
  assert.equal(canReceiveDomain('accountant', 'corporate_clients'), true);

  assert.equal(canReceiveDomain('admin', 'finance'), false);
  assert.equal(canReceiveDomain('admin', 'catalog'), false);
  assert.equal(canReceiveDomain('trainer', 'catalog'), false);
});

test('access scan room stays separate from generic crm domains', () => {
  const adminRooms = getRealtimeRoomsForRole('admin');
  assert.equal(adminRooms.includes(getRealtimeDomainRoom('access')), true);
  assert.equal(adminRooms.includes(getRealtimeDomainRoom('bookings')), true);
  assert.equal(adminRooms.includes(getRealtimeDomainRoom('finance')), false);
});

test('onboarding realtime is available for every active role', () => {
  assert.deepEqual(getRolesForDomain('onboarding'), [
    'owner',
    'manager',
    'admin',
    'accountant',
    'viewer',
    'trainer',
  ]);
});

test('audit realtime follows the existing audit visibility matrix', () => {
  assert.deepEqual(getRolesForDomain('audit'), ['owner', 'manager']);
  assert.equal(canReceiveDomain('owner', 'audit'), true);
  assert.equal(canReceiveDomain('manager', 'audit'), true);
  assert.equal(canReceiveDomain('admin', 'audit'), false);
});

test('tenant rooms include validated org, club, membership and role-specific domains', () => {
  const tenant = Object.freeze({
    clubId: 12,
    effectiveRole: 'trainer',
    membershipId: 21,
    membershipRole: 'manager',
    organizationId: 11,
    scope: 'club',
  });
  const rooms = getTenantRoomsForContext(tenant);
  assert.equal(rooms.includes(getTenantBaseRoom('organization', tenant)), true);
  assert.equal(rooms.includes(getTenantBaseRoom('club', tenant)), true);
  assert.equal(rooms.includes(getTenantBaseRoom('membership', tenant)), true);
  assert.equal(rooms.includes(getTenantDomainRoom('organization', tenant, 'finance')), true);
  assert.equal(rooms.includes(getTenantDomainRoom('club', tenant, 'training_notes')), true);
  assert.equal(rooms.includes(getTenantDomainRoom('club', tenant, 'finance')), false);
});
