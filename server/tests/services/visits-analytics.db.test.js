const assert = require('node:assert/strict');
const { test } = require('node:test');
const db = require('../../models');
const { getVisitsAnalytics } = require('../../src/services/visits-analytics.service');

test('DB-backed visit analytics handles history, 30-day boundary, training, duplicates, merge and scannedAt', async () => {
  await db.sequelize.authenticate();
  const suffix = `${Date.now()}`;
  const users = [];
  try {
    const makeUser = async (name, extra = {}) => {
      const user = await db.User.create({ name: `${name}-${suffix}`, phone: `${suffix}${users.length}`.slice(-15), source: 'DB QA', ...extra });
      users.push(user);
      return user;
    };
    const returning = await makeUser('returning');
    const exact30 = await makeUser('exact30');
    const late = await makeUser('late');
    const fresh = await makeUser('fresh');
    const primary = await makeUser('primary');
    const merged = await makeUser('merged', { status: 'archived', mergedIntoUserId: primary.id, mergedAt: new Date() });
    const training = await makeUser('training');
    const create = (userId, scannedAt, extra = {}) => db.Visit.create({ userId, scannedAt, ...extra });
    await create(returning.id, '2097-12-20T10:00:00Z');
    await create(returning.id, '2098-01-05T10:00:00Z');
    const firstExact = await create(exact30.id, '2098-01-01T10:00:00Z', { createdAt: '2098-02-01T10:00:00Z' });
    await create(exact30.id, '2098-01-31T10:00:00Z');
    await create(late.id, '2098-01-01T11:00:00Z');
    await create(late.id, '2098-02-01T11:00:01Z');
    await create(fresh.id, '2098-01-25T10:00:00Z');
    await create(merged.id, '2098-01-10T10:00:00Z');
    await create(training.id, '2098-01-12T10:00:00Z', { isTraining: true });
    await create(returning.id, '2098-01-05T10:01:00Z', { duplicateOfVisitId: firstExact.id });

    const result = await getVisitsAnalytics('2098-01-01', '2098-01-31', { now: '2098-02-10T12:00:00Z' });
    assert.equal(result.totalVisits, 6, JSON.stringify(result));
    assert.equal(result.uniqueGuests, 5);
    assert.equal(result.newGuests, 4);
    assert.equal(result.returningGuests, 1);
    assert.equal(result.repeatVisits, 1);
    assert.equal(result.repeatRate30EligibleGuests, 3);
    assert.equal(result.repeatRate30RepeatedGuests, 1);
    assert.equal(Math.round(result.repeatRate30 * 100) / 100, 33.33);
  } finally {
    if (users.length) {
      await db.Visit.destroy({ where: { userId: users.map((user) => user.id) } });
      await db.User.destroy({ force: true, where: { id: users.map((user) => user.id) } });
    }
  }
});
