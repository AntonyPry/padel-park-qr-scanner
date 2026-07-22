const assert = require('node:assert/strict');
const { test } = require('node:test');
const db = require('../../models');
const { getCohortsLifecycle, getSourceQuality, getVisitsAnalytics } = require('../../src/services/visits-analytics.service');
const { getDefaultTenantIds } = require('../helpers/tenant-fixtures');

test('DB-backed production fixture keeps dashboard aggregated and bounded', async () => {
  await db.sequelize.authenticate();
  const { clubId, organizationId } = await getDefaultTenantIds(db);
  const suffix = `${Date.now()}`;
  const users = [];
  try {
    for (let index = 0; index < 100; index += 1) {
      users.push(await db.User.create({ organizationId, name: `perf-${index}-${suffix}`, phone: `${suffix}${index}`.slice(-15), source: `Source ${index % 5}` }));
    }
    const visits = Array.from({ length: 5000 }, (_, index) => ({
      clubId,
      organizationId,
      userId: users[index % users.length].id,
      scannedAt: new Date(Date.UTC(2093, 2, 1 + (index % 28), index % 24, index % 60)),
      category: `Category ${index % 8}`,
    }));
    await db.Visit.bulkCreate(visits, { validate: false });
    const startedAt = Date.now();
    const result = await getVisitsAnalytics('2093-03-01', '2093-03-31', { now: '2093-05-01T00:00:00Z' });
    const elapsedMs = Date.now() - startedAt;
    assert.equal(result.totalVisits, 5000);
    assert.equal(result.uniqueGuests, 100);
    assert.equal(result.topGuests.length, 10);
    assert.equal(result.sources.length, 5);
    assert.ok(elapsedMs < 5000, `dashboard query took ${elapsedMs}ms`);
    const qualityStartedAt = Date.now();
    const quality = await getSourceQuality('2093-03-01', '2093-03-31', { now: '2093-07-01T00:00:00Z' });
    const qualityElapsedMs = Date.now() - qualityStartedAt;
    assert.equal(quality.sources.reduce((sum, row) => sum + row.newClients, 0), 100);
    assert.ok(qualityElapsedMs < 5000, `source quality query took ${qualityElapsedMs}ms`);
    const cohortsStartedAt = Date.now();
    const cohorts = await getCohortsLifecycle('2093-03-01', '2093-03-31');
    const cohortsElapsedMs = Date.now() - cohortsStartedAt;
    assert.equal(cohorts.cohorts.reduce((sum, row) => sum + row.cohortSize, 0), 100);
    assert.equal(cohorts.lifecycle.totalClassified >= 100, true);
    assert.ok(cohortsElapsedMs < 5000, `cohorts/lifecycle queries took ${cohortsElapsedMs}ms`);
  } finally {
    if (users.length) {
      await db.Visit.destroy({ where: { userId: users.map((user) => user.id) } });
      await db.User.destroy({ force: true, where: { id: users.map((user) => user.id) } });
    }
  }
});
