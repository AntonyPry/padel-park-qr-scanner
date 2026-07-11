const assert = require('node:assert/strict');
const { afterEach, test } = require('node:test');
const db = require('../../models');
const service = require('../../src/services/visits-analytics.service');

const originalQuery = db.sequelize.query;
afterEach(() => { db.sequelize.query = originalQuery; });

test('period comparison uses the immediately preceding period of equal length', () => {
  const period = service.resolvePeriod('2026-01-11', '2026-01-20');
  assert.equal(period.previousFrom.toLocaleDateString('sv-SE'), '2026-01-01');
  assert.equal(period.previousTo.toLocaleDateString('sv-SE'), '2026-01-10');
});

test('empty metrics have stable zero values and no artificial percentages', () => {
  assert.deepEqual(service.metricFromRow({}), {
    totalVisits: 0, uniqueGuests: 0, newGuests: 0, returningGuests: 0,
    repeatVisits: 0, averageVisitsPerGuest: 0, repeatRate30: 0,
    repeatRate30EligibleGuests: 0, repeatRate30RepeatedGuests: 0,
  });
  assert.equal(service.calculateChanges({ totalVisits: 4 }, { totalVisits: 0 }).totalVisits.percent, null);
});

test('analytics SQL uses scannedAt fallback, full history, canonical clients and excludes technical rows', async () => {
  const calls = [];
  db.sequelize.query = async (sql) => {
    calls.push(sql);
    if (sql.includes('ORDER BY visitedAt DESC')) return [];
    return [{ totalVisits: 0 }];
  };
  await service.getVisitsAnalytics('2026-01-01', '2026-01-31');
  const sql = calls.join('\n');
  assert.match(sql, /COALESCE\(v\.scannedAt, v\.createdAt\)/);
  assert.match(sql, /COALESCE\(u\.mergedIntoUserId, v\.userId\)/);
  assert.match(sql, /v\.duplicateOfVisitId IS NULL/);
  assert.match(sql, /COALESCE\(v\.isTraining, 0\) = 0/);
  assert.match(sql, /MIN\(visitedAt\) OVER/);
  assert.match(sql, /DATE_ADD\(ch\.firstVisitAt, INTERVAL 30 DAY\)/);
});

test('metrics preserve new, returning, repeat and exact 30-day cohort results', async () => {
  let metricCall = 0;
  db.sequelize.query = async (sql) => {
    if (sql.includes('ORDER BY visitedAt DESC')) return [];
    metricCall += 1;
    return [metricCall === 1 ? {
      totalVisits: 5, uniqueGuests: 3, newGuests: 2, returningGuests: 1,
      repeatRate30: 50, repeatRate30EligibleGuests: 2, repeatRate30RepeatedGuests: 1,
    } : { totalVisits: 2, uniqueGuests: 2, newGuests: 1, returningGuests: 1 }];
  };
  const result = await service.getVisitsAnalytics('2026-01-01', '2026-01-31');
  assert.equal(result.repeatVisits, 2);
  assert.equal(result.averageVisitsPerGuest, 5 / 3);
  assert.equal(result.repeatRate30, 50);
  assert.equal(result.changes.totalVisits.absolute, 3);
});
