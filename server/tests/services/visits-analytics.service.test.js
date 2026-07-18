const assert = require('node:assert/strict');
const { afterEach, beforeEach, test } = require('node:test');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const db = require('../../models');
const service = require('../../src/services/visits-analytics.service');
const { mockExactSingletonDefault } = require('../helpers/tenant-fixtures');

const originalQuery = db.sequelize.query;
let restoreSingleton;
beforeEach(() => { restoreSingleton = mockExactSingletonDefault(db); });
afterEach(() => {
  db.sequelize.query = originalQuery;
  restoreSingleton();
});

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

test('source-quality preserves null for immature cohorts and flags small samples', () => {
  const immature = service.sourceQualityFromRow({ source: 'Radio', newClients: 4, eligible30: 0, repeat30: 0, eligible60: 0, eligible90: 0 });
  assert.equal(immature.repeat30.rate, null);
  assert.equal(immature.repeat30.lowSample, false);
  assert.equal(immature.averageVisits90, null);

  const mixed = service.sourceQualityFromRow({ source: 'Radio', eligible30: 20, repeat30: 4, eligible60: 12, repeat60: 3, eligible90: 5, repeat90: 2, visits90Total: 8 });
  assert.equal(mixed.repeat30.lowSample, false);
  assert.equal(mixed.repeat60.lowSample, false);
  assert.equal(mixed.repeat90.lowSample, true);
  assert.equal(mixed.threePlus90.lowSample, true);
  assert.equal(mixed.averageVisits90EligibleCount, 5);
});

test('source keys round-trip dictionary, legacy and unspecified filters', () => {
  const legacyKey = service.sourceKeyFromRow({ sourceName: 'Радио' });
  assert.match(legacyKey, /^legacy:/);
  assert.deepEqual(service.parseSourceKeys(['id:42', legacyKey, 'unspecified']), {
    sourceIds: [42], legacySources: ['Радио'], includeUnspecified: true,
  });
});

test('source-quality SQL uses canonical source, database aggregation and per-window eligibility', async () => {
  let sql = '';
  db.sequelize.query = async (value) => { sql = value; return []; };
  await service.getSourceQuality('2026-01-01', '2026-01-31', { now: '2026-05-01T00:00:00Z' });
  assert.match(sql, /canonical_clients/);
  assert.match(sql, /LEFT JOIN ClientSources cs ON cs.id=root.sourceId/);
  assert.match(sql, /eligible30/);
  assert.match(sql, /eligible60/);
  assert.match(sql, /eligible90/);
  assert.match(sql, /GROUP BY sourceId,sourceName/);
  assert.doesNotMatch(sql, /SELECT \* FROM Visits/);
});

test('retention distinguishes zero retention from an immature calendar month', () => {
  const immature = service.retentionMetric(0, 8, '2026-01', 1, '2026-02-15');
  assert.equal(immature.rate, null);
  assert.equal(immature.count, null);
  assert.equal(immature.eligibleCount, 0);
  assert.equal(immature.isMature, false);
  assert.equal(immature.windowEnd, '2026-02-28');

  const matureZero = service.retentionMetric(0, 8, '2026-01', 1, '2026-02-28');
  assert.equal(matureZero.rate, 0);
  assert.equal(matureZero.count, 0);
  assert.equal(matureZero.eligibleCount, 8);
  assert.equal(matureZero.isMature, true);

  const leapYear = service.retentionMetric(2, 8, '2028-01', 1, '2028-02-29');
  assert.equal(leapYear.windowEnd, '2028-02-29');
  assert.equal(leapYear.rate, 25);
});

test('retention horizon includes the asOf month only when its final day is selected', () => {
  assert.equal(service.retentionMonthCountForAsOf('2026-01', '2026-07-30'), 5);
  assert.equal(service.retentionMonthCountForAsOf('2026-01', '2026-07-31'), 6);
  assert.equal(service.retentionMetric(3, 8, '2026-01', 6, '2026-07-30').isMature, false);
  assert.equal(service.retentionMetric(3, 8, '2026-01', 6, '2026-07-31').isMature, true);
});

test('lifecycle boundaries are mutually exclusive at 30, 60 and 90 days', () => {
  const asOf = new Date('2026-05-01T00:00:00.000Z');
  const daysAgo = (days) => new Date(asOf.getTime() - days * 86400000).toISOString();
  assert.equal(service.classifyLifecycleFacts({ firstVisitAt: daysAgo(30), lastVisitAt: daysAgo(30), visitCount: 1 }, asOf), 'new');
  assert.equal(service.classifyLifecycleFacts({ firstVisitAt: daysAgo(120), lastVisitAt: daysAgo(30), visitCount: 3 }, asOf), 'developing');
  assert.equal(service.classifyLifecycleFacts({ firstVisitAt: daysAgo(120), lastVisitAt: daysAgo(30), visitCount: 4 }, asOf), 'regular');
  assert.equal(service.classifyLifecycleFacts({ firstVisitAt: daysAgo(120), lastVisitAt: daysAgo(60), visitCount: 2 }, asOf), 'atRisk');
  assert.equal(service.classifyLifecycleFacts({ firstVisitAt: daysAgo(120), lastVisitAt: daysAgo(90), visitCount: 2 }, asOf), 'sleeping');
  assert.equal(service.classifyLifecycleFacts({ firstVisitAt: daysAgo(120), lastVisitAt: daysAgo(91), visitCount: 2 }, asOf), 'lost');
});

test('cohort and lifecycle SQL cap visits at asOf and reuse stable source filters', async () => {
  const calls = [];
  db.sequelize.query = async (sql) => {
    calls.push(sql);
    return [];
  };
  await service.getCohortsLifecycle('2026-01-01', '2026-03-31', { sourceKeys: ['id:7'] });
  const sql = calls.join('\n');
  assert.match(sql, /v\.visitedAt<=:asOf/);
  assert.match(sql, /root\.sourceId IN \(:sourceIds\)/);
  assert.match(sql, /WITH RECURSIVE client_chain/);
  assert.match(sql, /LOCATE\(CONCAT\(',', parent\.id, ','\), chain\.path\) = 0/);
  assert.match(sql, /PERIOD_DIFF/);
  assert.match(sql, /DATE_SUB\(:asOf,INTERVAL 90 DAY\)/);
  assert.doesNotMatch(sql, /SELECT \* FROM Visits/);
});

test('analytics segment filter is versioned and pins canonical, training and duplicate rules', () => {
  const filters = service.normalizeVisitAnalyticsSegmentFilters({
    asOf: '2026-05-31',
    firstVisitMonth: '2026-01',
    lifecycleStatus: 'lost',
    sourceKeys: ['id:7', 'id:7', 'unspecified'],
    visitCountMin: 2,
  });
  assert.deepEqual(filters.sourceKeys, ['id:7', 'unspecified']);
  assert.equal(filters.algorithmVersion, 'visits_analytics_segment_v1');
  assert.equal(filters.canonicalClientRule, 'recursive_merged_root_v1');
  assert.equal(filters.excludeTraining, true);
  assert.equal(filters.excludeDuplicateVisits, true);
  assert.equal(filters.clientStatus, 'active');
  assert.equal(filters.timeZone, 'Europe/Moscow');
  assert.equal(filters.firstVisitMonth, '2026-01');
  assert.equal(filters.lifecycleStatus, 'lost');
});

test('segment resolver reuses canonical SQL and applies source, asOf, lifecycle and active client rules', async () => {
  const calls = [];
  db.sequelize.query = async (sql) => {
    calls.push(sql);
    if (sql.includes('COUNT(*) total')) return [{ total: 1 }];
    return [{ id: 7, name: 'Root', phone: '79990000000', source: 'VK', visitCount: 4 }];
  };
  const result = await service.listVisitAnalyticsSegmentClients({
    asOf: '2026-05-31',
    lifecycleStatus: 'regular',
    sourceKeys: ['id:7'],
  });
  assert.equal(result.total, 1);
  assert.equal(result.items[0].id, 7);
  assert.equal(result.items[0].stats.visitCount, 4);
  const sql = calls.join('\n');
  assert.match(sql, /WITH RECURSIVE client_chain/);
  assert.match(sql, /v\.duplicateOfVisitId IS NULL/);
  assert.match(sql, /COALESCE\(origin\.isTraining, 0\) = 0/);
  assert.match(sql, /root\.status='active'/);
  assert.match(sql, /root\.sourceId IN \(:sourceIds\)/);
  assert.match(sql, /v\.visitedAt<=:asOf/);
  assert.match(sql, /DATE_SUB\(:asOf,INTERVAL 30 DAY\)/);
});

test('segment preview stores origin metadata and uses the same count resolver', async () => {
  db.sequelize.query = async (sql) => {
    if (sql.includes('sourceName')) return [{ sourceId: 7, sourceName: 'VK', clientCount: 3, actionableCount: 2 }];
    if (sql.includes('COUNT(*) total')) return [{ total: 2 }];
    return [];
  };
  const preview = await service.previewVisitAnalyticsSegment({
    asOf: '2026-05-31',
    from: '2026-01-01',
    kind: 'lifecycle',
    lifecycleStatus: 'atRisk',
    sourceKeys: ['id:7'],
    to: '2026-05-31',
  });
  assert.equal(preview.count, 2);
  assert.equal(preview.origin, 'visits_analytics');
  assert.equal(preview.filters.status, 'active');
  assert.equal(preview.filters.visitsAnalytics.lifecycleStatus, 'atRisk');
  assert.deepEqual(preview.originMetadata.sourceFilters, { keys: ['id:7'], labels: ['VK'] });
  assert.equal(preview.originMetadata.algorithmVersion, 'visits_analytics_segment_v1');
});
