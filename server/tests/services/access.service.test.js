const assert = require('node:assert/strict');
const test = require('node:test');

const db = require('../../models');
const accessService = require('../../src/services/access.service');
const scannerEventsService = require('../../src/services/scanner-events.service');

async function withAccessMocks(visit, run) {
  const originalTransaction = db.sequelize.transaction;
  const originalFindByPk = db.Visit.findByPk;
  const originalRecordEvent = scannerEventsService.recordEvent;
  const transaction = { LOCK: { UPDATE: Symbol('UPDATE') } };
  const calls = {
    events: [],
    findOptions: [],
    transactionCount: 0,
  };

  db.sequelize.transaction = async (callback) => {
    calls.transactionCount += 1;
    return callback(transaction);
  };
  db.Visit.findByPk = async (_id, options) => {
    calls.findOptions.push(options);
    return visit;
  };
  scannerEventsService.recordEvent = async (event) => {
    calls.events.push(event);
    return { id: calls.events.length };
  };

  try {
    await run(calls, transaction);
  } finally {
    db.sequelize.transaction = originalTransaction;
    db.Visit.findByPk = originalFindByPk;
    scannerEventsService.recordEvent = originalRecordEvent;
  }
}

function visitFixture(overrides = {}) {
  const updates = [];
  const visit = {
    id: 91,
    keyIssuedAt: new Date('2026-06-01T08:00:00.000Z'),
    keyIssuedByAccountId: 3,
    keyNumber: '17',
    userId: 44,
    async update(values, options) {
      updates.push({ options, values });
      this.keyNumber = values.keyNumber;
      return this;
    },
    ...overrides,
  };
  return { updates, visit };
}

test('initial key issue keeps the existing one-time contract', async () => {
  const { updates, visit } = visitFixture({
    keyIssuedAt: null,
    keyIssuedByAccountId: null,
    keyNumber: null,
  });

  await withAccessMocks(visit, async (calls) => {
    await accessService.issueKey(visit.id, 'A-42', { id: 7, role: 'admin' });

    assert.equal(updates.length, 1);
    assert.equal(updates[0].values.keyNumber, '42');
    assert.equal(updates[0].values.keyIssuedByAccountId, 7);
    assert.ok(updates[0].values.keyIssuedAt instanceof Date);
    assert.equal(calls.events[0].eventType, 'key_issued');
  });
});

test('initial key issue still rejects an accidental repeat', async () => {
  const { updates, visit } = visitFixture();

  await withAccessMocks(visit, async (calls) => {
    await assert.rejects(
      accessService.issueKey(visit.id, '18', { id: 7, role: 'admin' }),
      (error) => error.statusCode === 409 && error.code === 'KEY_ALREADY_ISSUED',
    );
    assert.equal(updates.length, 0);
    assert.equal(calls.events.length, 0);
  });
});

test('key correction locks the visit, preserves issue metadata and records old/new values atomically', async () => {
  const { updates, visit } = visitFixture();
  const originalIssuedAt = visit.keyIssuedAt;
  const originalIssuedBy = visit.keyIssuedByAccountId;

  await withAccessMocks(visit, async (calls, transaction) => {
    const result = await accessService.correctKey(
      visit.id,
      '204',
      { id: 12, role: 'manager' },
    );

    assert.equal(calls.transactionCount, 1);
    assert.equal(calls.findOptions[0].transaction, transaction);
    assert.equal(calls.findOptions[0].lock, transaction.LOCK.UPDATE);
    assert.deepEqual(updates[0].values, { keyNumber: '204' });
    assert.equal(visit.keyIssuedAt, originalIssuedAt);
    assert.equal(visit.keyIssuedByAccountId, originalIssuedBy);
    assert.equal(result.oldKeyNumber, '17');
    assert.equal(result.keyNumber, '204');

    const [event] = calls.events;
    assert.equal(event.eventType, 'key_changed');
    assert.equal(event.visitId, visit.id);
    assert.equal(event.userId, visit.userId);
    assert.equal(event.account.id, 12);
    assert.equal(event.transaction, transaction);
    assert.equal(event.throwOnError, true);
    assert.deepEqual(event.metadata, {
      changedByAccountId: 12,
      changedByRole: 'manager',
      newKeyNumber: '204',
      oldKeyNumber: '17',
      visitId: visit.id,
    });
  });
});

test('key correction rejects empty and non-digit values before opening a transaction', async () => {
  const { visit } = visitFixture();

  await withAccessMocks(visit, async (calls) => {
    for (const value of ['', '   ', '12a', '№12']) {
      await assert.rejects(
        accessService.correctKey(visit.id, value, { id: 12, role: 'manager' }),
        (error) => error.statusCode === 400 && error.code === 'INVALID_KEY_NUMBER',
      );
    }
    assert.equal(calls.transactionCount, 0);
    assert.equal(calls.events.length, 0);
  });
});

test('key correction rejects a missing visit', async () => {
  await withAccessMocks(null, async (calls) => {
    await assert.rejects(
      accessService.correctKey(999999, '12', { id: 7, role: 'admin' }),
      (error) => error.statusCode === 404,
    );
    assert.equal(calls.events.length, 0);
  });
});

test('key correction rejects visits without an issued key and unchanged values', async () => {
  const missingKey = visitFixture({ keyNumber: null }).visit;
  await withAccessMocks(missingKey, async (calls) => {
    await assert.rejects(
      accessService.correctKey(missingKey.id, '12', { id: 7, role: 'admin' }),
      (error) => error.statusCode === 409 && error.code === 'KEY_NOT_ISSUED',
    );
    assert.equal(calls.events.length, 0);
  });

  const unchanged = visitFixture().visit;
  await withAccessMocks(unchanged, async (calls) => {
    await assert.rejects(
      accessService.correctKey(unchanged.id, '17', { id: 7, role: 'admin' }),
      (error) => error.statusCode === 409 && error.code === 'KEY_UNCHANGED',
    );
    assert.equal(calls.events.length, 0);
  });
});
