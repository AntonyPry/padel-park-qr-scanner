const assert = require('node:assert/strict');
const { test } = require('node:test');
const XLSX = require('xlsx');
const db = require('../../models');
const { createVisitsExportBuffer, getRevenueLtv } = require('../../src/services/visits-analytics.service');
const { getDefaultTenantIds } = require('../helpers/tenant-fixtures');

test('DB-backed revenue LTV deduplicates receipt links, signs PAYBACK and excludes unsafe sources', async () => {
  await db.sequelize.authenticate();
  const { clubId, organizationId } = await getDefaultTenantIds(db);
  const suffix = String(Date.now());
  const records = {
    bookings: [], certificates: [], items: [], pendingSales: [], receipts: [], subscriptions: [], users: [], visits: [],
  };
  let secondarySource;
  let source;
  try {
    source = await db.ClientSource.create({ organizationId, name: `Revenue QA ${suffix}`, status: 'active' });
    secondarySource = await db.ClientSource.create({ organizationId, name: `Revenue QA other ${suffix}`, status: 'active' });
    const makeUser = async (name, extra = {}) => {
      const user = await db.User.create({
        organizationId,
        name: `${name}-${suffix}`,
        phone: `7${suffix}${records.users.length}`.slice(-15),
        source: 'Revenue QA legacy fallback',
        sourceId: source.id,
        ...extra,
      });
      records.users.push(user);
      return user;
    };
    const root = await makeUser('revenue-root');
    const leaf = await makeUser('revenue-leaf', { status: 'archived', mergedIntoUserId: root.id, mergedAt: new Date() });
    const training = await makeUser('revenue-training', { isTraining: true });
    const otherSourceClient = await makeUser('revenue-other-source', { sourceId: secondarySource.id });
    const firstVisit = await db.Visit.create({ organizationId, clubId, userId: leaf.id, scannedAt: '2088-01-01T10:00:00Z' });
    records.visits.push(firstVisit);
    records.visits.push(await db.Visit.create({ organizationId, clubId, userId: root.id, scannedAt: '2088-01-02T10:00:00Z', duplicateOfVisitId: firstVisit.id }));
    records.visits.push(await db.Visit.create({ organizationId, clubId, userId: training.id, scannedAt: '2088-01-01T11:00:00Z', isTraining: true }));
    records.visits.push(await db.Visit.create({ organizationId, clubId, userId: otherSourceClient.id, scannedAt: '2088-01-01T12:00:00Z' }));

    const createReceiptItem = async ({ amount, clientId, dateTime, type }) => {
      const receipt = await db.Receipt.create({
        organizationId,
        clubId,
        evotorId: `revenue-${type}-${suffix}-${records.receipts.length}`,
        dateTime,
        type,
        totalAmount: type === 'PAYBACK' ? -Math.abs(amount) : Math.abs(amount),
        cash: 0,
        cashless: type === 'PAYBACK' ? -Math.abs(amount) : Math.abs(amount),
      });
      records.receipts.push(receipt);
      const item = await db.ReceiptItem.create({
        receiptId: receipt.id,
        name: `Revenue item ${suffix}`,
        quantity: type === 'PAYBACK' ? -1 : 1,
        price: Math.abs(amount),
        sum: type === 'PAYBACK' ? -Math.abs(amount) : Math.abs(amount),
        sumPrice: type === 'PAYBACK' ? -Math.abs(amount) : Math.abs(amount),
      });
      records.items.push(item);
      const pendingSale = await db.PendingSale.create({
        organizationId,
        clubId,
        receiptId: receipt.id,
        receiptItemId: item.id,
        itemName: item.name,
        saleIntent: 'certificate',
        status: 'linked',
        clientId,
        linkedAt: new Date(dateTime),
      });
      records.pendingSales.push(pendingSale);
      return { item, pendingSale, receipt };
    };

    const sell = await createReceiptItem({ amount: 100, clientId: leaf.id, dateTime: '2088-01-02T10:00:00Z', type: 'SELL' });
    await createReceiptItem({ amount: 20, clientId: root.id, dateTime: '2088-01-03T10:00:00Z', type: 'PAYBACK' });
    const unlinkedPayback = await db.Receipt.create({
      organizationId,
      clubId,
      evotorId: `revenue-unlinked-payback-${suffix}`,
      dateTime: '2088-01-03T11:00:00Z',
      type: 'PAYBACK',
      totalAmount: -10,
      cash: 0,
      cashless: -10,
    });
    records.receipts.push(unlinkedPayback);
    records.items.push(await db.ReceiptItem.create({
      receiptId: unlinkedPayback.id,
      name: `Unlinked PAYBACK ${suffix}`,
      quantity: -1,
      price: 10,
      sum: -10,
      sumPrice: -10,
    }));

    records.subscriptions.push(await db.ClientSubscription.create({
      organizationId,
      clubId,
      clientId: leaf.id,
      pendingSaleId: sell.pendingSale.id,
      sourceReceiptId: sell.receipt.id,
      sourceReceiptItemId: sell.item.id,
      source: 'evotor_pending_sale',
      typeName: `Receipt subscription ${suffix}`,
      startsAt: '2088-01-02T10:00:00Z',
      saleAmount: 100,
      pricePaid: 100,
      status: 'active',
    }));
    records.certificates.push(await db.Certificate.create({
      organizationId,
      clubId,
      clientId: leaf.id,
      pendingSaleId: sell.pendingSale.id,
      sourceReceiptId: sell.receipt.id,
      sourceReceiptItemId: sell.item.id,
      source: 'evotor_pending_sale',
      code: `RCPT-${suffix}`,
      title: 'Receipt certificate',
      startsAt: '2088-01-02T10:00:00Z',
      saleAmount: 100,
      status: 'active',
    }));
    records.subscriptions.push(await db.ClientSubscription.create({
      organizationId,
      clubId,
      clientId: leaf.id,
      source: 'manual',
      typeName: `Manual subscription ${suffix}`,
      startsAt: '2088-01-05T10:00:00Z',
      saleAmount: 70,
      pricePaid: 70,
      status: 'active',
    }));
    records.certificates.push(await db.Certificate.create({
      organizationId,
      clubId,
      clientId: root.id,
      source: 'manual',
      code: `MAN-${suffix}`,
      title: 'Manual certificate',
      startsAt: '2088-01-04T10:00:00Z',
      saleAmount: 50,
      status: 'active',
    }));
    records.certificates.push(await db.Certificate.create({
      organizationId,
      clubId,
      clientId: root.id,
      source: 'legacy_stn_google_sheet',
      code: `LEGACY-${suffix}`,
      title: 'Legacy certificate',
      startsAt: '2088-01-04T10:00:00Z',
      saleAmount: 999,
      status: 'active',
    }));
    records.certificates.push(await db.Certificate.create({
      organizationId,
      clubId,
      clientId: root.id,
      source: 'manual',
      code: `CANCELED-${suffix}`,
      title: 'Canceled certificate',
      startsAt: '2088-01-04T10:00:00Z',
      saleAmount: 888,
      status: 'canceled',
      canceledAt: new Date('2088-01-04T12:00:00Z'),
    }));
    records.certificates.push(await db.Certificate.create({
      organizationId,
      clubId,
      clientId: training.id,
      source: 'manual',
      code: `TRAINING-${suffix}`,
      title: 'Training certificate',
      startsAt: '2088-01-04T10:00:00Z',
      saleAmount: 777,
      status: 'active',
    }));
    records.certificates.push(await db.Certificate.create({
      organizationId,
      clubId,
      clientId: otherSourceClient.id,
      source: 'manual',
      code: `OTHER-SOURCE-${suffix}`,
      title: 'Other source certificate',
      startsAt: '2088-01-04T10:00:00Z',
      saleAmount: 333,
      status: 'active',
    }));
    records.bookings.push(await db.Booking.create({
      organizationId,
      clubId,
      courtId: (await db.Court.findOne({ where: { organizationId, clubId } })).id,
      userId: root.id,
      clientName: root.name,
      clientPhone: root.phone,
      startsAt: '2088-01-06T10:00:00Z',
      endsAt: '2088-01-06T11:00:00Z',
      durationMinutes: 60,
      status: 'confirmed',
      price: 100,
      paidAmount: 100,
      paymentStatus: 'paid',
      paymentMethod: 'cashless',
    }));

    const sourceKey = `id:${source.id}`;
    const result = await getRevenueLtv('2088-01-01', '2088-01-31', { sourceKeys: [sourceKey] });
    assert.equal(result.summary.acquiredClients, 1, JSON.stringify(result));
    assert.equal(result.summary.payingClients, 1);
    assert.equal(result.summary.attributedRevenue, 200);
    assert.equal(result.summary.cohortAttributedRevenue, 200);
    assert.equal(result.summary.ltv30.value, 200);
    assert.equal(result.summary.ltv60.value, null);
    assert.equal(result.sources.length, 1);
    assert.equal(result.sources[0].sourceKey, sourceKey);
    assert.equal(result.sources[0].attributedRevenue, 200);
    assert.equal(result.coverage.cashNetRevenue, 70);
    assert.equal(result.coverage.cashMovementAmount, 130);
    assert.equal(result.coverage.attributedCashRevenue, 80);
    assert.ok(Math.abs(result.coverage.coveragePercent - (120 / 130 * 100)) < 0.001);
    assert.equal(result.coverage.paybackCount, 2);
    assert.equal(result.coverage.unlinkedPaybackCount, 1);
    assert.equal(result.coverage.unlinkedPaybackAmount, 10);
    assert.equal(result.coverage.unknownClientAmount, 10);
    assert.equal(result.coverage.unlinkedCashRevenue, -10);
    assert.equal(result.coverage.receiptItemReconciliationDifference, 0);
    assert.equal(result.coverage.bookingPaymentsReference, 100);
    assert.equal(result.coverage.legacySales.amount >= 999, true);
    assert.equal(result.cohorts.rows[0].values[0].value, 200);

    const workbook = XLSX.read(await createVisitsExportBuffer('2088-01-01', '2088-01-31', { sourceKeys: [sourceKey] }));
    assert.ok(workbook.Sheets['Выручка и LTV']);
    assert.ok(workbook.Sheets['LTV по источникам']);
    assert.ok(workbook.Sheets['LTV по когортам']);
    assert.ok(workbook.Sheets['Покрытие данных']);
    const sourceRows = XLSX.utils.sheet_to_json(workbook.Sheets['LTV по источникам']);
    assert.equal(sourceRows[0]['Stable source key'], sourceKey);
    assert.equal(sourceRows[0]['Атрибутированная выручка'], result.sources[0].attributedRevenue);
  } finally {
    if (records.bookings.length) await db.Booking.destroy({ where: { id: records.bookings.map((row) => row.id) } });
    if (records.certificates.length) await db.Certificate.destroy({ force: true, where: { id: records.certificates.map((row) => row.id) } });
    if (records.subscriptions.length) await db.ClientSubscription.destroy({ force: true, where: { id: records.subscriptions.map((row) => row.id) } });
    if (records.pendingSales.length) await db.PendingSale.destroy({ force: true, where: { id: records.pendingSales.map((row) => row.id) } });
    if (records.items.length) await db.ReceiptItem.destroy({ force: true, where: { id: records.items.map((row) => row.id) } });
    if (records.receipts.length) await db.Receipt.destroy({ force: true, where: { id: records.receipts.map((row) => row.id) } });
    if (records.visits.length) {
      await db.Visit.destroy({ where: { id: records.visits.filter((row) => row.duplicateOfVisitId).map((row) => row.id) } });
      await db.Visit.destroy({ where: { id: records.visits.map((row) => row.id) } });
    }
    if (records.users.length) {
      await db.User.update({ mergedIntoUserId: null }, { where: { id: records.users.map((row) => row.id) } });
      await db.User.destroy({ force: true, where: { id: records.users.map((row) => row.id) } });
    }
    if (source) await source.destroy();
    if (secondarySource) await secondarySource.destroy();
  }
});

test('DB-backed revenue LTV resolves a merge cycle to one canonical paying client', async () => {
  await db.sequelize.authenticate();
  const { clubId, organizationId } = await getDefaultTenantIds(db);
  const suffix = String(Date.now());
  let source;
  const users = [];
  const visits = [];
  let certificate;
  try {
    source = await db.ClientSource.create({ organizationId, name: `Revenue cycle ${suffix}`, status: 'active' });
    for (const label of ['a', 'b']) {
      users.push(await db.User.create({
        organizationId,
        name: `revenue-cycle-${label}-${suffix}`,
        phone: `7${suffix}${label === 'a' ? '1' : '2'}`.slice(-15),
        source: 'Cycle fallback',
        sourceId: source.id,
        status: 'archived',
      }));
    }
    await users[0].update({ mergedIntoUserId: users[1].id });
    await users[1].update({ mergedIntoUserId: users[0].id });
    visits.push(await db.Visit.create({ organizationId, clubId, userId: users[0].id, scannedAt: '2087-01-01T10:00:00Z' }));
    visits.push(await db.Visit.create({ organizationId, clubId, userId: users[1].id, scannedAt: '2087-01-02T10:00:00Z' }));
    certificate = await db.Certificate.create({
      organizationId,
      clubId,
      clientId: users[1].id,
      source: 'manual',
      code: `CYCLE-${suffix}`,
      title: 'Cycle revenue',
      startsAt: '2087-01-03T10:00:00Z',
      saleAmount: 60,
      status: 'active',
    });
    const result = await getRevenueLtv('2087-01-01', '2087-01-31', { sourceKeys: [`id:${source.id}`] });
    assert.equal(result.summary.acquiredClients, 1, JSON.stringify(result));
    assert.equal(result.summary.payingClients, 1);
    assert.equal(result.summary.cohortAttributedRevenue, 60);
  } finally {
    if (certificate) await certificate.destroy({ force: true });
    if (visits.length) await db.Visit.destroy({ where: { id: visits.map((row) => row.id) } });
    if (users.length) {
      await db.User.update({ mergedIntoUserId: null }, { where: { id: users.map((row) => row.id) } });
      await db.User.destroy({ force: true, where: { id: users.map((row) => row.id) } });
    }
    if (source) await source.destroy();
  }
});
