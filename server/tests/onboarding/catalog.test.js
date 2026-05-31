const assert = require('node:assert/strict');
const test = require('node:test');
const { ACCOUNT_ROLE_VALUES } = require('../../src/constants/account-roles');
const {
  findOnboardingTask,
  getOnboardingPath,
  validateOnboardingCatalog,
} = require('../../src/onboarding/catalog');

test('onboarding catalog has a valid path for every account role', () => {
  assert.deepEqual(validateOnboardingCatalog(), []);

  for (const role of ACCOUNT_ROLE_VALUES) {
    const path = getOnboardingPath(role);
    assert.equal(path.role, role);
    assert.equal(Boolean(path.levelLabel), true);
    assert.equal(Boolean(path.completionBadge), true);
    assert.equal(path.missions.length > 0, true);
  }
});

test('onboarding task keys are role-prefixed and discoverable', () => {
  const match = findOnboardingTask('admin', 'admin.booking.create-phone');

  assert.equal(match.task.route, '/admin/bookings');
  assert.equal(match.task.checkpoint.event, 'booking.created');
  assert.deepEqual(match.task.skills, ['Бронирования', 'Телефон']);
  assert.equal(match.task.badge, 'Телефонная бронь');
  assert.equal(match.path.role, 'admin');
  assert.equal(match.mission.key, 'admin.bookings');
});
