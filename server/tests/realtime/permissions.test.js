const assert = require('node:assert/strict');
const test = require('node:test');
const {
  canReceiveDomain,
  getRealtimeDomainRoom,
  getRealtimeRoomsForRole,
  getRolesForDomain,
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
