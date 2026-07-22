const assert = require('node:assert/strict');
const { afterEach, beforeEach, test } = require('node:test');
const XLSX = require('xlsx');
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

test('LTV maturity returns null instead of a synthetic zero and flags a small sample', () => {
  assert.deepEqual(service.ltvMetric(0, 0), {
    eligibleCount: 0,
    lowSample: false,
    revenue: 0,
    value: null,
  });
  assert.deepEqual(service.ltvMetric(900, 3), {
    eligibleCount: 3,
    lowSample: true,
    revenue: 900,
    value: 300,
  });
});

test('revenue cohort matrix is cumulative and keeps immature M1 null', () => {
  const result = service.buildRevenueCohorts([
    { cohortMonth: '2026-01', cohortSize: 2, revenueMonth: 0, revenue: 200 },
    { cohortMonth: '2026-01', cohortSize: 2, revenueMonth: 1, revenue: 100 },
    { cohortMonth: '2026-02', cohortSize: 1, revenueMonth: 0, revenue: 40 },
  ], '2026-02-15');
  const january = result.rows.find((row) => row.cohortMonth === '2026-01');
  const february = result.rows.find((row) => row.cohortMonth === '2026-02');
  assert.equal(january.values[0].value, 100);
  assert.equal(january.values[1].value, null);
  assert.equal(january.values[1].revenue, null);
  assert.equal(february.values[0].value, null);

  const mature = service.buildRevenueCohorts([
    { cohortMonth: '2026-01', cohortSize: 2, revenueMonth: 0, revenue: 200 },
    { cohortMonth: '2026-01', cohortSize: 2, revenueMonth: 1, revenue: 100 },
  ], '2026-02-28').rows[0];
  assert.equal(mature.values[1].revenue, 300);
  assert.equal(mature.values[1].value, 150);
});

test('revenue SQL aggregates in the database, deduplicates links and signs PAYBACK', async () => {
  const calls = [];
  db.sequelize.query = async (sql) => {
    calls.push(sql);
    if (sql.includes('client_revenue AS')) return [{
      sourceId: 7,
      sourceName: 'VK',
      acquiredClients: 2,
      payingClients: 1,
      attributedRevenue: 180,
      mature30: 2,
      revenue30: 180,
      mature60: 0,
      revenue60: 0,
      mature90: 0,
      revenue90: 0,
    }];
    if (sql.includes('cohort_sizes AS')) return [{ cohortMonth: '2026-01', cohortSize: 2, revenueMonth: 0, revenue: 180 }];
    if (sql.includes('cashNetRevenue')) return [{
      cashNetRevenue: 180,
      attributedCashRevenue: 180,
      periodAttributedRevenue: 180,
      paybackCount: 1,
    }];
    if (sql.includes('visited_clients AS')) return [{ sourceId: 7, sourceName: 'VK', clientCount: 2, actionableCount: 2 }];
    return [];
  };
  const result = await service.getRevenueLtv('2026-01-01', '2026-01-31', { sourceKeys: ['id:7'] });
  assert.equal(result.summary.attributedRevenue, 180);
  assert.equal(result.summary.ltv30.value, 90);
  assert.equal(result.summary.ltv60.value, null);
  assert.equal(result.sources[0].sourceKey, 'id:7');
  const sql = calls.join('\n');
  assert.match(sql, /COUNT\(DISTINCT canonicalUserId\) candidateCount/);
  assert.match(sql, /WHEN receipts\.type='PAYBACK' THEN -ABS/);
  assert.match(sql, /subscriptions\.sourceReceiptItemId IS NULL/);
  assert.match(sql, /certificates\.source<>'legacy_stn_google_sheet'/);
  assert.match(sql, /bookings\.paidAmount/);
  assert.match(sql, /root\.sourceId IN \(:sourceIds\)/);
  assert.doesNotMatch(sql, /SELECT \* FROM (?:Receipt|Visit|User)/);
});

test('revenue Excel sheets preserve API values and formula explanations', () => {
  const workbook = XLSX.utils.book_new();
  service.appendRevenueLtvSheets(workbook, {
    from: '2026-01-01T00:00:00Z',
    to: '2026-01-31T00:00:00Z',
    summary: {
      attributedRevenue: 180,
      acquiredClients: 2,
      payingClients: 1,
      payerConversion: 50,
      averageRevenuePerAcquiredClient: 90,
      averageRevenuePerPayingClient: 180,
      ltv30: { value: 90 }, ltv60: { value: null }, ltv90: { value: null },
      lifetimeLtv: { value: 90 }, coveragePercent: 75,
    },
    sources: [{
      source: 'VK', sourceKey: 'id:7', acquiredClients: 2, payingClients: 1,
      payerConversion: 50, attributedRevenue: 180,
      ltv30: { value: 90, eligibleCount: 2 }, ltv60: { value: null, eligibleCount: 0 },
      ltv90: { value: null, eligibleCount: 0 }, lifetimeLtv: { value: 90 },
      reliability: { label: 'Недостаточно времени' },
    }],
    cohorts: { rows: [{ cohortMonth: '2026-01', cohortSize: 2, values: [{ monthIndex: 0, value: 90, revenue: 180, isMature: true, windowEnd: '2026-01-31' }] }] },
    coverage: {
      cashNetRevenue: 240, cashMovementAmount: 280,
      attributedCashRevenue: 180, attributedCashMovementAmount: 220,
      allAttributedCashRevenue: 180, allAttributedCashMovementAmount: 220,
      unlinkedCashRevenue: 60, unlinkedCashMovementAmount: 60,
      outsideSelectedSourcesCashRevenue: 0,
      coveragePercent: 78.57, selectedCashSharePercent: 78.57,
      paybackCount: 1, unlinkedPaybackCount: 1, unlinkedPaybackAmount: 20,
      unknownClientAmount: 60,
      ambiguousClientAmount: 0, duplicateRiskAmount: 100,
      receiptItemReconciliationDifference: 0,
      legacySales: { amount: 500, count: 1 }, bookingPaymentsReference: 200,
      manualFinanceWithoutClient: 50, corporateLedgerExcludedAmount: 0,
    },
  });
  assert.deepEqual(workbook.SheetNames, ['Выручка и LTV', 'LTV по источникам', 'LTV по когортам', 'Покрытие данных']);
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets['Выручка и LTV'], { header: 1 });
  assert.equal(rows.find((row) => row[0] === 'LTV 30')[1], 90);
  assert.match(rows.find((row) => row[0] === 'LTV 30')[2], /mature30/);
  const coverageRows = XLSX.utils.sheet_to_json(workbook.Sheets['Покрытие данных'], { header: 1 });
  assert.equal(coverageRows.find((row) => row[0] === 'Непривязанный PAYBACK, сумма позиций')[1], 20);
});
