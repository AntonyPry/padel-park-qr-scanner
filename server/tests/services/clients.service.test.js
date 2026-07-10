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

test('client list SQL ignores blank numeric filters', () => {
  const query = __testing.buildClientListSql(
    {
      lastVisitDaysFrom: null,
      lastVisitDaysTo: undefined,
      segment: 'all',
      status: 'active',
      visitCountMax: '   ',
      visitCountMin: '',
    },
    { limit: 10, offset: 0 },
  );

  assert.equal(Object.hasOwn(query.replacements, 'visitCountMin'), false);
  assert.equal(Object.hasOwn(query.replacements, 'visitCountMax'), false);
  assert.equal(Object.hasOwn(query.replacements, 'lastVisitDaysFrom'), false);
  assert.equal(Object.hasOwn(query.replacements, 'lastVisitDaysTo'), false);
  assert.equal(query.sql.includes('visitCount <= :visitCountMax'), false);
});

test('client list SQL keeps explicit zero visit count max filter', () => {
  const query = __testing.buildClientListSql(
    {
      segment: 'all',
      status: 'active',
      visitCountMax: '0',
    },
    { limit: 10, offset: 0 },
  );

  assert.equal(query.replacements.visitCountMax, 0);
  assert.equal(query.sql.includes('visitCount <= :visitCountMax'), true);
});

test('client list always hides merged tombstones and searches their aliases', () => {
  const query = __testing.buildClientListSql(
    { q: '+7 999 111-22-33', status: 'all', includeMerged: 'true' },
    { limit: 10, offset: 0 },
  );

  assert.equal(query.sql.includes('u.mergedIntoUserId IS NULL'), true);
  assert.equal(query.sql.includes('merged_alias.mergedIntoUserId = u.id'), true);
  assert.equal(query.sql.includes('merged_alias.phoneNormalized LIKE :phoneQ'), true);
  assert.equal(query.replacements.phoneQ, '%9991112233%');
});

test('trainer alias search stays name-only', () => {
  const query = __testing.buildClientListSql(
    { q: 'Иван', status: 'active' },
    { limit: 10, offset: 0 },
    false,
    { includePhoneSearch: false },
  );

  assert.equal(query.sql.includes('merged_alias.name LIKE :q'), true);
  assert.equal(query.sql.includes('merged_alias.phone LIKE :q'), false);
  assert.equal(Object.hasOwn(query.replacements, 'phoneQ'), false);
});

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

test('client prepayment summary reports active balances and blocking statuses', () => {
  const summary = __testing.buildClientPrepaymentSummary({
    certificates: [
      { code: 'CERT-1', id: 1, status: 'active' },
      { code: 'CERT-2', id: 2, status: 'redeemed' },
    ],
    subscriptions: [
      {
        id: 10,
        remainingSessions: 3,
        sessionsTotal: 4,
        status: 'active',
        typeName: '4 групповые',
      },
      {
        id: 11,
        remainingSessions: 0,
        sessionsTotal: 4,
        status: 'used',
        typeName: '4 персональные',
      },
    ],
  });

  assert.equal(summary.hasActiveSubscription, true);
  assert.equal(summary.hasActiveCertificate, true);
  assert.equal(summary.activeSubscriptionsCount, 1);
  assert.equal(summary.activeCertificatesCount, 1);
  assert.equal(summary.subscriptionWarnings.some((item) => item.type === 'used'), true);
  assert.equal(summary.certificateWarnings.some((item) => item.type === 'redeemed'), true);
});

test('client prepayment timeline includes sale, link, redemption and reversal events', () => {
  const items = __testing.listClientPrepaymentTimeline({
    certificates: [
      {
        certificateType: 'money',
        code: 'GIFT-1',
        createdAt: '2026-06-05T12:00:00.000Z',
        id: 30,
        redemptions: [
          {
            amount: 1000,
            id: 40,
            redeemedAt: '2026-06-06T12:00:00.000Z',
            reversedAt: '2026-06-06T13:00:00.000Z',
            status: 'reversed',
          },
        ],
        startsAt: '2026-06-05T10:00:00.000Z',
        status: 'active',
      },
    ],
    subscriptions: [
      {
        createdAt: '2026-06-05T11:00:00.000Z',
        id: 20,
        isUnlimited: false,
        redemptions: [
          {
            id: 21,
            quantity: 1,
            redeemedAt: '2026-06-06T10:00:00.000Z',
            status: 'active',
          },
        ],
        remainingSessions: 3,
        sessionsTotal: 4,
        startsAt: '2026-06-05T09:00:00.000Z',
        status: 'active',
        typeName: '4 групповые',
      },
    ],
  });
  const types = items.map((item) => item.type);

  assert.equal(types.includes('prepayment_sale'), true);
  assert.equal(types.includes('prepayment_link'), true);
  assert.equal(types.includes('prepayment_redemption'), true);
  assert.equal(types.includes('prepayment_reversal'), true);
});
