const assert = require('node:assert/strict');
const test = require('node:test');

const db = require('../../models');
const {
  listEvents,
  recordEvent,
} = require('../../src/services/scanner-events.service');

test('DB-backed scanner event preserves false and zero metadata', async () => {
  await db.sequelize.authenticate();
  let event;
  const eventType = `scanner_metadata_regression_test_${Date.now()}`;

  try {
    event = await recordEvent({
      eventType,
      clientEventId: `scanner-metadata-${Date.now()}`,
      metadata: {
        hadSuccessfulRead: false,
        reconnectAttempt: 0,
      },
      throwOnError: true,
    });
    const storedEvents = await listEvents({ eventType, limit: 10 });
    const storedEvent = storedEvents.find((item) => item.id === event.id);

    assert.equal(storedEvent.metadata.hadSuccessfulRead, false);
    assert.equal(storedEvent.metadata.reconnectAttempt, 0);
  } finally {
    await event?.destroy();
  }
});
