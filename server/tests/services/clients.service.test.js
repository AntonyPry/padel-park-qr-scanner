const assert = require('node:assert/strict');
const test = require('node:test');
const db = require('../../models');
const tenantContextService = require('../../src/services/tenant-context.service');
const {
  __testing,
  lookupByPhone,
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

test('client birth date accepts an optional real past date and rejects invalid values', () => {
  assert.equal(__testing.normalizeBirthDate(undefined), undefined);
  assert.equal(__testing.normalizeBirthDate(''), null);
  assert.equal(__testing.normalizeBirthDate('1991-02-28'), '1991-02-28');
  assert.throws(() => __testing.normalizeBirthDate('1991-02-29'), /корректную дату/);
  assert.throws(() => __testing.normalizeBirthDate('28.02.1991'), /YYYY-MM-DD/);
  assert.throws(() => __testing.normalizeBirthDate('2999-01-01'), /корректную дату/);
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

test('phone lookup keeps the verified tenant authority for prepayment summary', async (t) => {
  const previousCapabilities = {
    TENANT_CLIENTS_REFERENCES_ENABLED:
      process.env.TENANT_CLIENTS_REFERENCES_ENABLED,
    TENANT_CLIENT_MONEY_INSTRUMENTS_ENABLED:
      process.env.TENANT_CLIENT_MONEY_INSTRUMENTS_ENABLED,
  };
  process.env.TENANT_CLIENTS_REFERENCES_ENABLED = 'true';
  process.env.TENANT_CLIENT_MONEY_INSTRUMENTS_ENABLED = 'true';
  t.after(() => {
    for (const [name, value] of Object.entries(previousCapabilities)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });
  t.mock.method(db.Organization, 'findOne', async () => ({ id: 3 }));
  t.mock.method(db.Account, 'findOne', async () => ({
    id: 1,
    staffId: null,
    status: 'active',
  }));
  t.mock.method(db.Membership, 'findOne', async () => ({
    accountId: 1,
    id: 2,
    organizationId: 3,
    role: 'owner',
    staffId: null,
    status: 'active',
  }));
  t.mock.method(db.Club, 'findAll', async () => [{ id: 4 }]);
  t.mock.method(db.User, 'findOne', async () => ({
    id: 12,
    toJSON: () => clientFixture(),
  }));
  t.mock.method(db.Visit, 'findOne', async () => ({
    firstVisitAt: null,
    lastVisitAt: null,
    visitCount: 0,
  }));
  t.mock.method(db.ClientSubscription, 'findAll', async ({ where }) => {
    assert.equal(where.clientId, 12);
    assert.equal(where.organizationId, 3);
    assert.deepEqual(where.clubId[db.Sequelize.Op.in], [4]);
    return [{
      expiresAt: null,
      id: 10,
      isUnlimited: false,
      sessionsTotal: 4,
      sessionsUsed: 0,
      status: 'active',
      typeName: '4 занятия',
    }];
  });
  t.mock.method(db.Certificate, 'findAll', async ({ where }) => {
    assert.equal(where.clientId, 12);
    assert.equal(where.organizationId, 3);
    assert.deepEqual(where.clubId[db.Sequelize.Op.in], [4]);
    return [{
      amountTotal: 1000,
      amountUsed: 0,
      certificateType: 'money',
      code: 'CERT-1',
      expiresAt: null,
      id: 20,
      status: 'active',
      unitsTotal: null,
      unitsUsed: 0,
    }];
  });

  const tenant = await tenantContextService.resolveTenantContext({
    accountId: 1,
    organizationId: 3,
    scope: 'organization',
  });

  const result = await lookupByPhone(
    '+7 999 111-22-33',
    null,
    { id: 1, role: 'owner' },
    { includeArchived: true },
    tenant,
  );

  assert.equal(result.id, 12);
  assert.equal(result.prepaymentSummary.hasActiveSubscription, true);
  assert.equal(result.prepaymentSummary.hasActiveCertificate, true);
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
