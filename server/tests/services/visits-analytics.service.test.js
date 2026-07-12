const assert = require('node:assert/strict');
const { afterEach, test } = require('node:test');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const db = require('../../models');
const service = require('../../src/services/visits-analytics.service');

const originalQuery = db.sequelize.query;
afterEach(() => { db.sequelize.query = originalQuery; });

test('club period and previous period are invariant across process timezone', () => {
  const utc = service.resolvePeriod('2026-01-11', '2026-01-20', new Date('2026-01-20T12:00:00Z'));
  assert.equal(utc.from.toISOString(), '2026-01-10T21:00:00.000Z');
  assert.equal(utc.to.toISOString(), '2026-01-20T20:59:59.999Z');
  assert.equal(utc.previousFrom.toISOString(), '2025-12-31T21:00:00.000Z');
  assert.equal(utc.previousTo.toISOString(), '2026-01-10T20:59:59.999Z');
  assert.equal(service.CLUB_TIME_ZONE, 'Europe/Moscow');
});

test('TZ=UTC and TZ=Europe/Moscow produce identical analytics boundaries and Excel text', () => {
  const servicePath = path.resolve(__dirname, '../../src/services/visits-analytics.service.js');
  const script = `const s=require(${JSON.stringify(servicePath)});const p=s.resolvePeriod('2026-01-11','2026-01-20',new Date('2026-01-20T12:00:00Z'));console.log(JSON.stringify({from:p.from.toISOString(),to:p.to.toISOString(),previousFrom:p.previousFrom.toISOString(),previousTo:p.previousTo.toISOString(),excel:s.formatClubDateTime('2026-01-01T21:30:00Z')}));process.exit(0)`;
  const run = (TZ) => execFileSync(process.execPath, ['-e', script], { encoding: 'utf8', env: { ...process.env, TZ } }).trim().split('\n').at(-1);
  assert.equal(run('UTC'), run('Europe/Moscow'));
});

test('Excel date formatting is pinned to Europe/Moscow', () => {
  assert.match(service.formatClubDateTime('2026-01-01T21:30:00Z'), /02\.01\.2026/);
  assert.match(service.formatClubDateTime('2026-01-01T21:30:00Z'), /00:30:00/);
});

test('empty metrics have stable zero values and no artificial percentages', () => {
  assert.deepEqual(service.metricFromRow({}), {
    totalVisits: 0, uniqueGuests: 0, newGuests: 0, returningGuests: 0,
    repeatVisits: 0, averageVisitsPerGuest: 0, repeatRate30: 0,
    repeatRate30EligibleGuests: 0, repeatRate30RepeatedGuests: 0,
  });
  assert.equal(service.calculateChanges({ totalVisits: 4 }, { totalVisits: 0 }).totalVisits.percent, null);
});

test('dashboard SQL is indexed, aggregated, recursive and cycle-safe without window materialization', async () => {
  const calls = [];
  db.sequelize.query = async (sql) => {
    calls.push(sql);
    if (sql.includes('period_counts')) return [];
    return [];
  };
  await service.getVisitsAnalytics('2026-01-01', '2026-01-31');
  const sql = calls.join('\n');
  assert.match(sql, /WITH RECURSIVE client_chain/);
  assert.match(sql, /LOCATE\(CONCAT\(',', parent\.id, ','\), chain\.path\) = 0/);
  assert.match(sql, /depth < 63/);
  assert.match(sql, /FORCE INDEX \(idx_visits_visited_at\)/);
  assert.match(sql, /v\.visitedAt BETWEEN :from AND :to/);
  assert.match(sql, /CONVERT_TZ\(v\.visitedAt,'\+00:00','\+03:00'\)/);
  assert.doesNotMatch(sql, /ROW_NUMBER|OVER \(/);
  assert.doesNotMatch(sql, /SELECT \* FROM Visits/);
});

test('metrics combine current and previous aggregates', async () => {
  db.sequelize.query = async (sql) => {
    if (sql.includes('period_counts')) return [
      { periodKey: 'current', totalVisits: 5, uniqueGuests: 3, newGuests: 2, returningGuests: 1, repeatRate30EligibleGuests: 2, repeatRate30RepeatedGuests: 1 },
      { periodKey: 'previous', totalVisits: 2, uniqueGuests: 2, newGuests: 1, returningGuests: 1 },
    ];
    return [];
  };
  const result = await service.getVisitsAnalytics('2026-01-01', '2026-01-31');
  assert.equal(result.repeatVisits, 2);
  assert.equal(result.averageVisitsPerGuest, 5 / 3);
  assert.equal(result.repeatRate30, 50);
  assert.equal(result.changes.totalVisits.absolute, 3);
});
