const assert = require('node:assert/strict');
const { afterEach, test } = require('node:test');
const db = require('../../models');
const subscriptionsService = require('../../src/services/subscriptions.service');

const originalModels = {
  ClientSubscription: db.ClientSubscription,
  ClientSubscriptionRedemption: db.ClientSubscriptionRedemption,
  EvotorSaleSetting: db.EvotorSaleSetting,
  PendingSale: db.PendingSale,
  SubscriptionType: db.SubscriptionType,
  User: db.User,
  sequelize: db.sequelize,
};
const DAY_MS = 24 * 60 * 60 * 1000;
const STATUS_TEST_NOW = new Date('2026-06-15T00:00:00.000Z');

function dateFromStatusTestNow(days) {
  return new Date(STATUS_TEST_NOW.getTime() + days * DAY_MS);
}

function dateInputFromStatusTestNow(days) {
  return dateFromStatusTestNow(days).toISOString().slice(0, 10);
}

function freezeStatusTestClock(t) {
  t.mock.timers.enable({ apis: ['Date'], now: STATUS_TEST_NOW });
}

afterEach(() => {
  Object.assign(db, originalModels);
});

test('client subscription status and remaining sessions are calculated safely', () => {
  assert.equal(
    subscriptionsService.calculateStatus({
      expiresAt: dateFromStatusTestNow(16),
      isUnlimited: false,
      sessionsTotal: 4,
      sessionsUsed: 2,
      status: 'active',
    }, STATUS_TEST_NOW),
    'active',
  );
  assert.equal(
    subscriptionsService.calculateRemaining({
      isUnlimited: false,
      sessionsTotal: 4,
      sessionsUsed: 9,
    }),
    0,
  );
  assert.equal(
    subscriptionsService.calculateRemaining({
      isUnlimited: true,
      sessionsTotal: null,
      sessionsUsed: 99,
    }),
    null,
  );
  assert.equal(
    subscriptionsService.calculateStatus({
      expiresAt: dateFromStatusTestNow(-14),
      isUnlimited: false,
      sessionsTotal: 4,
      sessionsUsed: 0,
      status: 'active',
    }, STATUS_TEST_NOW),
    'expired',
  );
  assert.equal(
    subscriptionsService.calculateStatus({
      expiresAt: dateFromStatusTestNow(16),
      isUnlimited: false,
      sessionsTotal: 4,
      sessionsUsed: 4,
      status: 'active',
    }, STATUS_TEST_NOW),
    'used',
  );
  assert.equal(
    subscriptionsService.calculateStatus({
      isUnlimited: true,
      status: 'canceled',
    }),
    'canceled',
  );
});

test('redeemClientSubscription creates ledger row and marks final session used', async (t) => {
  freezeStatusTestClock(t);
  const createdRedemptions = [];
  const updates = [];
  const subscription = {
    id: 91,
    clientId: 20,
    expiresAt: dateFromStatusTestNow(30),
    isUnlimited: false,
    sessionsTotal: 4,
    sessionsUsed: 3,
    serviceType: 'training',
    status: 'active',
    trainingKind: 'group',
    typeName: 'Групповые 4 занятия',
    async update(payload) {
      updates.push(payload);
      Object.assign(this, payload);
      return this;
    },
    toJSON() {
      return { ...this };
    },
  };

  db.sequelize = {
    async transaction(callback) {
      return callback({ LOCK: { UPDATE: 'UPDATE' } });
    },
  };
  db.ClientSubscription = {
    async findByPk(id) {
      assert.equal(Number(id), subscription.id);
      return subscription;
    },
  };
  db.ClientSubscriptionRedemption = {
    async create(payload) {
      createdRedemptions.push(payload);
      return { id: 501, ...payload };
    },
    async findByPk(id) {
      assert.equal(Number(id), 501);
      return {
        id,
        ...createdRedemptions[0],
        redeemedBy: { email: 'admin@example.com', id: 7, role: 'admin' },
      };
    },
  };

  const result = await subscriptionsService.redeemClientSubscription(
    subscription.id,
    {
      comment: 'Групповая тренировка',
      redeemedAt: dateInputFromStatusTestNow(-1),
      trainingKind: 'group',
    },
    { id: 7, role: 'admin' },
  );

  assert.equal(createdRedemptions.length, 1);
  assert.equal(createdRedemptions[0].quantity, 1);
  assert.equal(createdRedemptions[0].redeemedByAccountId, 7);
  assert.equal(updates[0].sessionsUsed, 4);
  assert.equal(updates[0].status, 'used');
  assert.equal(result.subscription.remainingSessions, 0);
  assert.equal(result.subscription.status, 'used');
  assert.equal(result.redemption.status, 'active');
});

test('redeemClientSubscription blocks used subscriptions before ledger write', async (t) => {
  freezeStatusTestClock(t);
  let createCalled = false;
  const subscription = {
    id: 92,
    clientId: 20,
    expiresAt: dateFromStatusTestNow(30),
    isUnlimited: false,
    sessionsTotal: 1,
    sessionsUsed: 1,
    serviceType: 'training',
    status: 'active',
    typeName: 'Персональная разовая',
    toJSON() {
      return { ...this };
    },
  };

  db.sequelize = {
    async transaction(callback) {
      return callback({ LOCK: { UPDATE: 'UPDATE' } });
    },
  };
  db.ClientSubscription = {
    async findByPk(id) {
      assert.equal(Number(id), subscription.id);
      return subscription;
    },
  };
  db.ClientSubscriptionRedemption = {
    async create() {
      createCalled = true;
    },
  };

  await assert.rejects(
    () => subscriptionsService.redeemClientSubscription(subscription.id, {}, { id: 7 }),
    /Списывать можно только активный абонемент/,
  );
  assert.equal(createCalled, false);
});

test('reverseClientSubscriptionRedemption restores remaining sessions and audit trail', async (t) => {
  freezeStatusTestClock(t);
  const subscriptionUpdates = [];
  const redemptionUpdates = [];
  const subscription = {
    id: 93,
    clientId: 20,
    expiresAt: dateFromStatusTestNow(30),
    isUnlimited: false,
    sessionsTotal: 4,
    sessionsUsed: 4,
    serviceType: 'training',
    status: 'used',
    typeName: 'Групповые 4 занятия',
    async update(payload) {
      subscriptionUpdates.push(payload);
      Object.assign(this, payload);
      return this;
    },
    toJSON() {
      return { ...this };
    },
  };
  const redemption = {
    id: 601,
    clientId: 20,
    clientSubscriptionId: subscription.id,
    quantity: 1,
    redeemedAt: dateFromStatusTestNow(-1),
    serviceType: 'training',
    status: 'active',
    async update(payload) {
      redemptionUpdates.push(payload);
      Object.assign(this, payload);
      return this;
    },
    toJSON() {
      return { ...this };
    },
  };

  db.sequelize = {
    async transaction(callback) {
      return callback({ LOCK: { UPDATE: 'UPDATE' } });
    },
  };
  db.ClientSubscription = {
    async findByPk(id) {
      assert.equal(Number(id), subscription.id);
      return subscription;
    },
  };
  db.ClientSubscriptionRedemption = {
    async findOne({ where }) {
      assert.equal(Number(where.id), redemption.id);
      assert.equal(Number(where.clientSubscriptionId), subscription.id);
      return redemption;
    },
    async findByPk(id) {
      assert.equal(Number(id), redemption.id);
      return {
        ...redemption,
        reversedBy: { email: 'manager@example.com', id: 8, role: 'manager' },
      };
    },
  };

  const result = await subscriptionsService.reverseClientSubscriptionRedemption(
    subscription.id,
    redemption.id,
    { reason: 'Ошибочное списание' },
    { id: 8, role: 'manager' },
  );

  assert.equal(subscriptionUpdates[0].sessionsUsed, 3);
  assert.equal(subscriptionUpdates[0].status, 'active');
  assert.equal(redemptionUpdates[0].status, 'reversed');
  assert.equal(redemptionUpdates[0].reversedByAccountId, 8);
  assert.equal(result.subscription.remainingSessions, 1);
  assert.equal(result.subscription.status, 'active');
  assert.equal(result.redemption.status, 'reversed');
});

test('createFromPendingSale creates a snapshot subscription once', async (t) => {
  freezeStatusTestClock(t);
  const pendingSale = {
    id: 10,
    clientId: 20,
    itemName: 'Evotor: групповая 4',
    linkedAt: dateFromStatusTestNow(-5),
    linkedByAccountId: 7,
    metadata: {
      amount: 6000,
      saleSettings: { subscriptionTypeId: 30 },
    },
    receipt: {
      dateTime: dateFromStatusTestNow(-5),
      evotorId: 'receipt-1',
      id: 40,
      type: 'SELL',
    },
    receiptId: 40,
    receiptItem: {
      id: 50,
      name: 'Evotor: групповая 4',
      quantity: 1,
      sum: 6000,
    },
    receiptItemId: 50,
    saleIntent: 'subscription',
    saleSetting: {
      saleSettings: { subscriptionTypeId: 30 },
    },
    status: 'linked',
    toJSON() {
      return {
        id: this.id,
        clientId: this.clientId,
        itemName: this.itemName,
        linkedAt: this.linkedAt,
        linkedByAccountId: this.linkedByAccountId,
        metadata: this.metadata,
        receipt: this.receipt,
        receiptId: this.receiptId,
        receiptItem: this.receiptItem,
        receiptItemId: this.receiptItemId,
        saleIntent: this.saleIntent,
        saleSetting: this.saleSetting,
        status: this.status,
      };
    },
  };
  const type = {
    id: 30,
    name: 'Групповые 4 занятия день/вечер/выходные',
    serviceType: 'training',
    trainingKind: 'group',
    timeSegment: 'standard',
    sessionsTotal: 4,
    isUnlimited: false,
    validityDays: 30,
    price: 6000,
    bonusPersonalSessions: 0,
    status: 'active',
  };
  const createdRows = [];

  db.PendingSale = {
    async findByPk(id) {
      assert.equal(Number(id), pendingSale.id);
      return pendingSale;
    },
  };
  db.SubscriptionType = {
    async findByPk(id) {
      assert.equal(Number(id), type.id);
      return type;
    },
    async findOne() {
      throw new Error('Exact name fallback should not be used');
    },
  };
  db.ClientSubscription = {
    async create(payload) {
      createdRows.push(payload);
      return { id: 99, ...payload };
    },
    async findByPk(id) {
      assert.equal(id, 99);
      return {
        id,
        ...createdRows[0],
        subscriptionType: type,
      };
    },
    async findOne() {
      return null;
    },
  };

  const result = await subscriptionsService.createFromPendingSale(
    pendingSale,
    { account: { id: 7, role: 'manager' } },
  );

  assert.equal(result.created, true);
  assert.equal(result.subscription.clientId, 20);
  assert.equal(result.subscription.typeName, type.name);
  assert.equal(result.subscription.remainingSessions, 4);
  assert.equal(result.subscription.status, 'active');
  assert.equal(createdRows.length, 1);
  assert.equal(createdRows[0].pendingSaleId, pendingSale.id);
  assert.equal(createdRows[0].sourceReceiptItemId, pendingSale.receiptItemId);
});

test('createFromPendingSale returns existing subscription by pending sale id', async () => {
  const pendingSale = {
    id: 10,
    clientId: 20,
    itemName: 'Evotor: безлимит',
    receiptItemId: 50,
    saleIntent: 'subscription',
    status: 'linked',
  };
  const existing = {
    id: 99,
    clientId: 20,
    isUnlimited: true,
    pendingSaleId: 10,
    sessionsTotal: null,
    sessionsUsed: 12,
    source: 'evotor_pending_sale',
    status: 'active',
    typeName: 'Безлимитные групповые',
  };
  let createCalled = false;

  db.PendingSale = {
    async findByPk(id) {
      assert.equal(Number(id), pendingSale.id);
      return pendingSale;
    },
  };
  db.ClientSubscription = {
    async create() {
      createCalled = true;
      return null;
    },
    async findOne({ where }) {
      assert.equal(where[db.Sequelize.Op.or][0].pendingSaleId, pendingSale.id);
      return existing;
    },
  };

  const result = await subscriptionsService.createFromPendingSale(pendingSale);

  assert.equal(createCalled, false);
  assert.equal(result.created, false);
  assert.equal(result.subscription.id, existing.id);
  assert.equal(result.subscription.remainingSessions, null);
});

test('removeArchivedSubscriptionType blocks deleting types used by Evotor sale settings', async () => {
  let destroyCalled = false;

  db.SubscriptionType = {
    async findByPk(id) {
      assert.equal(Number(id), 30);
      return {
        id: 30,
        name: 'Групповые 4 занятия',
        status: 'archived',
        async destroy() {
          destroyCalled = true;
        },
      };
    },
  };
  db.ClientSubscription = {
    async count({ where }) {
      assert.equal(where.subscriptionTypeId, 30);
      return 0;
    },
  };
  db.EvotorSaleSetting = {
    async findAll({ where }) {
      assert.deepEqual(where, { saleIntent: 'subscription' });
      return [
        {
          id: 10,
          itemName: 'Evotor: групповая 4',
          saleIntent: 'subscription',
          saleSettings: { subscriptionTypeId: 30 },
        },
      ];
    },
  };

  await assert.rejects(
    () => subscriptionsService.removeArchivedSubscriptionType(30),
    /он выбран в настройке продажи Эвотора/,
  );
  assert.equal(destroyCalled, false);
});
