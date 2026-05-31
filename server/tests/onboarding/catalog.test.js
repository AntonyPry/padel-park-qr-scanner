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

test('manager and owner have knowledge guides for every CRM section', () => {
  const expectedKnowledgeRoutes = [
    '/admin',
    '/admin/audit',
    '/admin/bookings',
    '/admin/call-tasks',
    '/admin/catalog',
    '/admin/client-bases',
    '/admin/clients',
    '/admin/finances',
    '/admin/motivation',
    '/admin/onboarding',
    '/admin/references',
    '/admin/staff',
    '/admin/telephony',
    '/admin/trainer',
    '/admin/users',
    '/admin/utilization',
    '/admin/visits-analytics',
  ];

  for (const role of ['manager', 'owner']) {
    const path = getOnboardingPath(role);
    const knowledgeTasks = path.missions
      .filter((mission) => mission.key.startsWith(`${role}.knowledge-`))
      .flatMap((mission) => mission.tasks);

    assert.equal(knowledgeTasks.length, 17);
    assert.deepEqual(
      knowledgeTasks.map((task) => task.route).sort(),
      expectedKnowledgeRoutes,
    );

    for (const task of knowledgeTasks) {
      assert.equal(task.kind, 'review');
      assert.equal(task.trainingMode.recommended, false);
      assert.equal(task.lesson.screenshots.length, 0);
      assert.equal(
        task.lesson.blocks.every((block) => block.type === 'paragraph'),
        true,
      );
    }
  }

  const telephony = findOnboardingTask('owner', 'owner.knowledge.telephony');
  assert.equal(telephony.task.route, '/admin/telephony');
  assert.equal(telephony.task.lesson.blocks.length, 6);
});
