const assert = require('node:assert/strict');
const { afterEach, test } = require('node:test');
const db = require('../../models');
const pendingSaleService = require('../../src/services/pending-sale.service');

const originalModels = {
  CatalogRule: db.CatalogRule,
  Certificate: db.Certificate,
  EvotorSaleSetting: db.EvotorSaleSetting,
  PendingSale: db.PendingSale,
  PendingSaleHistory: db.PendingSaleHistory,
  Receipt: db.Receipt,
  User: db.User,
  sequelize: db.sequelize,
};

afterEach(() => {
  Object.assign(db, originalModels);
});

test('pending sale intent only creates queue rows for positive Evotor sales', () => {
  const { shouldCreatePendingSale } = pendingSaleService.__testing;
  const setting = { saleIntent: 'subscription' };
  const receipt = { type: 'SELL' };

  assert.equal(
    shouldCreatePendingSale(receipt, { sum: 5200 }, setting),
    true,
  );
  assert.equal(
    shouldCreatePendingSale(receipt, { sum: 5200 }, { saleIntent: 'normal' }),
    false,
  );
  assert.equal(
    shouldCreatePendingSale({ type: 'PAYBACK' }, { sum: 5200 }, setting),
    false,
  );
  assert.equal(shouldCreatePendingSale(receipt, { sum: -5200 }, setting), false);
});

test('createPendingSalesForReceipt is idempotent by receipt item', async () => {
  const receipt = {
    id: 10,
    evotorId: 'receipt-1',
    dateTime: new Date('2026-06-05T12:00:00.000Z'),
    type: 'SELL',
    items: [
      {
        id: 20,
        name: 'Абонемент 4 занятия',
        price: 5200,
        quantity: 1,
        sum: 5200,
      },
    ],
  };
  let alreadyCreated = false;
  const historyRows = [];

  db.Receipt = {
    async findByPk(id) {
      assert.equal(id, receipt.id);
      return receipt;
    },
  };
  db.EvotorSaleSetting = {
    async findAll() {
      return [
        {
          id: 30,
          itemName: 'Абонемент 4 занятия',
          saleIntent: 'subscription',
          saleSettings: null,
        },
      ];
    },
  };
  db.CatalogRule = {
    async findAll() {
      return [
        {
          id: 40,
          itemName: 'Абонемент 4 занятия',
          category: 'Абонементы',
        },
      ];
    },
  };
  db.PendingSale = {
    async findOrCreate({ defaults, where }) {
      assert.deepEqual(where, { receiptItemId: receipt.items[0].id });
      assert.equal(defaults.saleIntent, 'subscription');
      assert.equal(defaults.catalogRuleId, 40);
      if (alreadyCreated) {
        return [{ id: 50, receiptItemId: receipt.items[0].id }, false];
      }
      alreadyCreated = true;
      return [{ id: 50, receiptItemId: receipt.items[0].id }, true];
    },
  };
  db.PendingSaleHistory = {
    async create(row) {
      historyRows.push(row);
    },
  };

  const first = await pendingSaleService.createPendingSalesForReceipt(receipt.id);
  const second = await pendingSaleService.createPendingSalesForReceipt(receipt.id);

  assert.equal(first.created, 1);
  assert.equal(second.created, 0);
  assert.equal(historyRows.length, 1);
  assert.equal(historyRows[0].action, 'pending_sale.created');
});

test('linkPendingSale moves pending row to linked and records history', async () => {
  const updates = [];
  const historyRows = [];
  const certificateRows = [];
  const pendingSale = {
    id: 77,
    receiptId: 10,
    receiptItemId: 20,
    itemName: 'Сертификат',
    saleIntent: 'certificate',
    status: 'pending',
    toJSON() {
      return {
        id: this.id,
        clientId: this.clientId || null,
        status: this.status,
      };
    },
    async update(payload) {
      updates.push(payload);
      Object.assign(this, payload);
      return this;
    },
  };

  db.sequelize = {
    async transaction(callback) {
      return callback({ LOCK: { UPDATE: 'UPDATE' } });
    },
  };
  db.PendingSale = {
    async findByPk(id, options) {
      assert.equal(Number(id), pendingSale.id);
      if (options?.include) {
        return {
          ...pendingSale,
          history: [],
          receipt: null,
          receiptItem: null,
          toJSON() {
            return { ...pendingSale, history: [] };
          },
        };
      }
      return pendingSale;
    },
  };
  db.User = {
    async findOne({ where }) {
      assert.equal(where.id, 123);
      return { id: 123, name: 'Клиент', phone: '+7', status: 'active' };
    },
  };
  db.PendingSaleHistory = {
    async create(row) {
      historyRows.push(row);
    },
  };
  db.Certificate = {
    async create(payload) {
      certificateRows.push(payload);
      return { id: 88, ...payload };
    },
    async findByPk(id) {
      assert.equal(Number(id), 88);
      return {
        id,
        ...certificateRows[0],
      };
    },
    async findOne() {
      return null;
    },
  };

  const result = await pendingSaleService.linkPendingSale(
    77,
    {
      certificate: {
        amountTotal: 1500,
        code: 'gift-123',
        validityDays: 90,
      },
      clientId: 123,
      comment: 'Оплата у стойки',
    },
    { id: 5, role: 'manager' },
  );

  assert.equal(updates[0].status, 'linked');
  assert.equal(updates[0].clientId, 123);
  assert.equal(historyRows[0].action, 'pending_sale.linked');
  assert.equal(historyRows[0].fromStatus, 'pending');
  assert.equal(historyRows[0].toStatus, 'linked');
  assert.equal(historyRows[0].accountId, 5);
  assert.equal(historyRows[1].action, 'certificate.created');
  assert.equal(certificateRows[0].code, 'GIFT-123');
  assert.equal(certificateRows[0].clientId, 123);
  assert.equal(result.status, 'linked');
  assert.equal(result.certificate.code, 'GIFT-123');
});
