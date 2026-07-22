const assert = require('node:assert/strict');
const { test } = require('node:test');
const db = require('../../models');
const { getRevenueLtv } = require('../../src/services/visits-analytics.service');
const { getDefaultTenantIds } = require('../helpers/tenant-fixtures');

test('DB-backed production-size revenue fixture stays aggregated and bounded', async () => {
  await db.sequelize.authenticate();
  const { clubId, organizationId } = await getDefaultTenantIds(db);
  const suffix = String(Date.now());
  let source;
  let users = [];
  let visits = [];
  let receipts = [];
  let items = [];
  let pendingSales = [];
  try {
    source = await db.ClientSource.create({ organizationId, name: `Revenue perf ${suffix}`, status: 'active' });
    users = await db.User.bulkCreate(Array.from({ length: 100 }, (_, index) => ({
      organizationId,
      name: `revenue-perf-${index}-${suffix}`,
      phone: `7${suffix}${index}`.slice(-15),
      source: 'Revenue perf fallback',
      sourceId: source.id,
    })));
    visits = await db.Visit.bulkCreate(users.map((user, index) => ({
      clubId,
      organizationId,
      userId: user.id,
      scannedAt: new Date(Date.UTC(2086, 0, 1 + (index % 10), 10, 0)),
    })));
    receipts = await db.Receipt.bulkCreate(Array.from({ length: 1000 }, (_, index) => ({
      organizationId,
      clubId,
      evotorId: `revenue-perf-${suffix}-${index}`,
      dateTime: new Date(Date.UTC(2086, 0, 11 + (index % 10), 10, 0)),
      type: 'SELL',
      totalAmount: 10,
      cashless: 10,
      cash: 0,
    })));
    items = await db.ReceiptItem.bulkCreate(receipts.map((receipt, index) => ({
      receiptId: receipt.id,
      name: `Revenue perf item ${index % 10}`,
      quantity: 1,
      price: 10,
      sum: 10,
      sumPrice: 10,
    })));
    pendingSales = await db.PendingSale.bulkCreate(items.map((item, index) => ({
      organizationId,
      clubId,
      receiptId: receipts[index].id,
      receiptItemId: item.id,
      itemName: item.name,
      saleIntent: 'subscription',
      status: 'linked',
      clientId: users[index % users.length].id,
      linkedAt: receipts[index].dateTime,
    })));
    const startedAt = Date.now();
    const result = await getRevenueLtv('2086-01-01', '2086-01-31', { sourceKeys: [`id:${source.id}`] });
    const elapsedMs = Date.now() - startedAt;
    assert.equal(result.summary.acquiredClients, 100);
    assert.equal(result.summary.payingClients, 100);
    assert.equal(result.summary.attributedRevenue, 10000);
    assert.ok(elapsedMs < 5000, `revenue LTV queries took ${elapsedMs}ms`);
  } finally {
    if (pendingSales.length) await db.PendingSale.destroy({ force: true, where: { id: pendingSales.map((row) => row.id) } });
    if (items.length) await db.ReceiptItem.destroy({ force: true, where: { id: items.map((row) => row.id) } });
    if (receipts.length) await db.Receipt.destroy({ force: true, where: { id: receipts.map((row) => row.id) } });
    if (visits.length) await db.Visit.destroy({ where: { id: visits.map((row) => row.id) } });
    if (users.length) await db.User.destroy({ force: true, where: { id: users.map((row) => row.id) } });
    if (source) await source.destroy();
  }
});
