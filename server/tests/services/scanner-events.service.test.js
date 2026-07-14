const assert = require('node:assert/strict');
const test = require('node:test');

const {
  sanitizeMetadata,
} = require('../../src/services/scanner-events.service');

test('scanner metadata preserves false, zero and empty string values', () => {
  assert.deepEqual(
    sanitizeMetadata({
      hadSuccessfulRead: false,
      reconnectAttempt: 0,
      deviceLabel: '',
      samples: [false, 0, '', null, undefined],
    }),
    {
      hadSuccessfulRead: false,
      reconnectAttempt: 0,
      deviceLabel: '',
      samples: [false, 0, '', null, null],
    },
  );
});

test('scanner metadata still redacts sensitive values', () => {
  assert.deepEqual(
    sanitizeMetadata({
      authorization: 'Bearer secret',
      nested: { qrValue: 'ticket-123', reconnectAttempt: 0 },
    }),
    {
      authorization: '[redacted]',
      nested: { qrValue: '[redacted]', reconnectAttempt: 0 },
    },
  );
});
