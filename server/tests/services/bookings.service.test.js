const assert = require('node:assert/strict');
const test = require('node:test');
const { __testing } = require('../../src/services/bookings.service');
const bookingRulesService = require('../../src/services/booking-rules.service');

test('group training participants include primary client once', () => {
  assert.deepEqual(
    __testing.normalizeGroupParticipantIds(
      { groupParticipantIds: ['7', 8, '7'] },
      '5',
      'group_training',
    ),
    [5, 7, 8],
  );
});

test('ordinary booking types ignore group participant payload', () => {
  assert.deepEqual(
    __testing.normalizeGroupParticipantIds(
      { groupParticipantIds: ['7', 8] },
      '5',
      'game',
    ),
    [],
  );
});

test('group training participant list enforces max size', () => {
  assert.throws(
    () =>
      __testing.normalizeGroupParticipantIds(
        { groupParticipantIds: Array.from({ length: 12 }, (_, index) => index + 2) },
        1,
        'group_training',
      ),
    /до 12 участников/,
  );
});

test('administrator manual price is ignored while manager price is preserved', () => {
  assert.deepEqual(
    __testing.withoutAdminManualPrice(
      { courtId: 4, price: 1, startsAt: '2026-07-21T10:00:00.000Z' },
      { role: 'admin' },
    ),
    { courtId: 4, startsAt: '2026-07-21T10:00:00.000Z' },
  );
  assert.deepEqual(
    __testing.withoutAdminManualPrice({ courtId: 4, price: 1 }, { role: 'manager' }),
    { courtId: 4, price: 1 },
  );
});

test('automatic pricing reuses the active booking transaction', async () => {
  const originalCalculateQuote = bookingRulesService.calculateQuote;
  const transaction = { id: 'booking-transaction' };
  let receivedOptions = null;
  bookingRulesService.calculateQuote = async (_payload, _authority, options) => {
    receivedOptions = options;
    return { price: 3000 };
  };

  try {
    const result = await __testing.applyAutomaticPrice(
      { courtId: 1 },
      1,
      { durationMinutes: 60, startsAt: new Date('2026-07-21T11:00:00.000Z') },
      null,
      { authority: 'legacy-default' },
      { role: 'admin' },
      transaction,
    );

    assert.equal(receivedOptions.transaction, transaction);
    assert.equal(result.price, 3000);
  } finally {
    bookingRulesService.calculateQuote = originalCalculateQuote;
  }
});
