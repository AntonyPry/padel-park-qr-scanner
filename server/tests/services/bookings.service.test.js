const assert = require('node:assert/strict');
const test = require('node:test');
const { __testing } = require('../../src/services/bookings.service');

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
