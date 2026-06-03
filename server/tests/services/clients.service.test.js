const assert = require('node:assert/strict');
const test = require('node:test');
const {
  __testing,
} = require('../../src/services/clients.service');

const SENSITIVE_CLIENT_KEYS = [
  'phone',
  'phoneNormalized',
  'telegramId',
  'vkId',
  'webId',
];
const OPERATIONAL_DETAIL_KEYS = [
  'activeCallTasks',
  'bookings',
  'bookingSeries',
  'telephonyCalls',
  'timeline',
  'visits',
];

function clientFixture(overrides = {}) {
  return {
    createdAt: '2026-06-02T10:00:00.000Z',
    id: 12,
    mergedByAccountId: 99,
    mergedIntoUserId: null,
    name: 'Клиент',
    note: 'Внутренняя заметка',
    phone: '+7 999 111-22-33',
    phoneNormalized: '9991112233',
    segment: 'regular',
    source: 'Сайт',
    status: 'active',
    statusLabel: 'Активен',
    stats: { visitCount: 3 },
    telegramId: 'tg-1',
    updatedAt: '2026-06-02T10:00:00.000Z',
    vkId: 'vk-1',
    webId: 'web-1',
    ...overrides,
  };
}

test('trainer client sanitizer removes sensitive identity keys', () => {
  const result = __testing.sanitizeClientForAccount(
    clientFixture(),
    { id: 7, role: 'trainer' },
  );

  for (const key of SENSITIVE_CLIENT_KEYS) {
    assert.equal(Object.hasOwn(result, key), false);
  }
  assert.equal(result.note, null);
  assert.equal(result.mergedByAccountId, null);
});

test('trainer client details response omits operational containers', () => {
  const response = __testing.buildTrainerClientDetailsResponse({
    client: clientFixture(),
    mergedInto: clientFixture({ id: 20 }),
    skillMap: [{ skillId: 1 }],
    trainingNotes: [{ id: 5 }],
  });

  for (const key of OPERATIONAL_DETAIL_KEYS) {
    assert.equal(Object.hasOwn(response, key), false);
  }
  for (const key of SENSITIVE_CLIENT_KEYS) {
    assert.equal(Object.hasOwn(response.client, key), false);
    assert.equal(Object.hasOwn(response.mergedInto, key), false);
  }
  assert.deepEqual(response.skillMap, [{ skillId: 1 }]);
  assert.deepEqual(response.trainingNotes, [{ id: 5 }]);
});
