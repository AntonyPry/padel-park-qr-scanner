const assert = require('node:assert/strict');
const { afterEach, beforeEach, test } = require('node:test');
const xlsx = require('xlsx');
const db = require('../../models');
const corporateClientsService = require('../../src/services/corporate-clients.service');
const onboardingService = require('../../src/services/onboarding.service');
const originalGetTrainingDataMarker = onboardingService.getTrainingDataMarker;
const originalRecordEventSafe = onboardingService.recordEventSafe;

const originalModels = {
  Category: db.Category,
  CorporateClient: db.CorporateClient,
  CorporateLedgerEntry: db.CorporateLedgerEntry,
  Finance: db.Finance,
  FinanceChangeLog: db.FinanceChangeLog,
  OnboardingEvent: db.OnboardingEvent,
  OnboardingProgress: db.OnboardingProgress,
  OnboardingTrainingMode: db.OnboardingTrainingMode,
  PayrollPeriod: db.PayrollPeriod,
  sequelize: db.sequelize,
};

afterEach(() => {
  Object.assign(db, originalModels);
  onboardingService.getTrainingDataMarker = originalGetTrainingDataMarker;
  onboardingService.recordEventSafe = originalRecordEventSafe;
});

beforeEach(() => {
  onboardingService.getTrainingDataMarker = async () => ({
    isTraining: false,
    trainingAccountId: null,
    trainingRole: null,
    trainingSessionId: null,
  });
  onboardingService.recordEventSafe = async () => null;
});

function makeClient(overrides = {}) {
  return {
    id: 10,
    name: 'ООО Ракетка',
    status: 'active',
    isTraining: false,
    toJSON() {
      return { ...this };
    },
    ...overrides,
  };
}

function makeFinance(overrides = {}) {
  return {
    amount: 15000,
    category: 'Корпоративные пополнения',
    comment: 'Оплата счета',
    date: '2026-06-05',
    id: 50,
    isTraining: false,
    type: 'income',
    async destroy() {
      this.destroyed = true;
    },
    toJSON() {
      return { ...this };
    },
    ...overrides,
  };
}

function matchesWhereValue(actual, expected) {
  if (expected && typeof expected === 'object') {
    const symbols = Object.getOwnPropertySymbols(expected);
    if (symbols.length > 0) {
      const value = expected[symbols[0]];
      return Array.isArray(value) ? value.includes(actual) : actual === value;
    }
  }
  return actual === expected;
}

test('corporate balance uses active ledger entries only', () => {
  assert.equal(
    corporateClientsService.calculateBalance([
      { amount: 15000, status: 'active', type: 'deposit' },
      { amount: 3000, status: 'active', type: 'spending' },
      { amount: 5000, status: 'canceled', type: 'deposit' },
    ]),
    12000,
  );
});

test('createDeposit links existing manual income and creates ledger entry once', async () => {
  const client = makeClient();
  const finance = makeFinance();
  const createdLedgerRows = [];
  const financeChangeLogs = [];
  const transaction = { LOCK: { UPDATE: 'UPDATE' } };

  db.sequelize = {
    async transaction(callback) {
      return callback(transaction);
    },
  };
  db.PayrollPeriod = {
    async findOne() {
      return null;
    },
  };
  db.FinanceChangeLog = {
    async create(payload, options) {
      financeChangeLogs.push({ options, payload });
    },
  };
  db.CorporateClient = {
    async findByPk(id, options = {}) {
      assert.equal(Number(id), client.id);
      if (options.include?.some((item) => item.as === 'ledgerEntries')) {
        return {
          ...client,
          ledgerEntries: createdLedgerRows.map((row, index) => ({
            id: index + 70,
            ...row,
            finance,
            toJSON() {
              return { ...this };
            },
          })),
          toJSON() {
            return { ...this };
          },
        };
      }
      return client;
    },
  };
  db.Finance = {
    async findByPk(id) {
      assert.equal(Number(id), finance.id);
      return finance;
    },
  };
  db.CorporateLedgerEntry = {
    async findOne({ where }) {
      assert.equal(where.financeId, finance.id);
      assert.equal(where.status, 'active');
      return null;
    },
    async create(payload) {
      createdLedgerRows.push(payload);
      return {
        id: 70,
        ...payload,
        toJSON() {
          return { ...this };
        },
      };
    },
    async findByPk(id) {
      assert.equal(Number(id), 70);
      return {
        id,
        ...createdLedgerRows[0],
        finance,
        toJSON() {
          return { ...this };
        },
      };
    },
    async findAll() {
      return createdLedgerRows.map((row, index) => ({
        id: index + 70,
        ...row,
        toJSON() {
          return { ...this };
        },
      }));
    },
  };

  const result = await corporateClientsService.createDeposit(
    client.id,
    { comment: 'Закрепили оплату', financeId: finance.id },
    null,
  );

  assert.equal(createdLedgerRows.length, 1);
  assert.equal(createdLedgerRows[0].financeId, finance.id);
  assert.equal(createdLedgerRows[0].financeCreatedByLedger, false);
  assert.equal(createdLedgerRows[0].amount, 15000);
  assert.equal(createdLedgerRows[0].type, 'deposit');
  assert.equal(result.corporateClient.balance, 15000);
  assert.equal(result.ledgerEntry.finance.id, finance.id);
  assert.equal(financeChangeLogs.length, 1);
  assert.equal(financeChangeLogs[0].payload.action, 'corporate_deposit.link');
  assert.equal(financeChangeLogs[0].options.transaction, transaction);
});

test('createDeposit rejects create mode without income category', async () => {
  const client = makeClient();
  const transaction = { LOCK: { UPDATE: 'UPDATE' } };
  let categoryLookupCalled = false;
  let financeCreateCalled = false;

  db.sequelize = {
    async transaction(callback) {
      return callback(transaction);
    },
  };
  db.OnboardingTrainingMode = {
    async findOne() {
      return null;
    },
  };
  db.CorporateClient = {
    async findByPk(id) {
      assert.equal(Number(id), client.id);
      return client;
    },
  };
  db.Category = {
    async findOne() {
      categoryLookupCalled = true;
      return null;
    },
  };
  db.Finance = {
    async create() {
      financeCreateCalled = true;
      return null;
    },
  };

  await assert.rejects(
    () =>
      corporateClientsService.createDeposit(
        client.id,
        {
          amount: 12000,
          date: '2026-06-06',
        },
        { id: 1, role: 'owner' },
      ),
    (error) => {
      assert.equal(error.message, 'Выберите категорию дохода');
      assert.equal(error.statusCode, 400);
      return true;
    },
  );
  assert.equal(categoryLookupCalled, false);
  assert.equal(financeCreateCalled, false);
});

test('createDeposit creates manual Finance income and records history in active transaction', async () => {
  const client = makeClient();
  const finance = makeFinance({ id: 88, amount: 22000, comment: 'Аванс' });
  const createdFinanceRows = [];
  const createdLedgerRows = [];
  const financeChangeLogs = [];
  const onboardingEvents = [];
  const account = { id: 1, role: 'owner' };
  const transaction = { LOCK: { UPDATE: 'UPDATE' } };
  let transactionCommitted = false;
  let transactionOpen = false;

  db.sequelize = {
    async transaction(callback) {
      transactionOpen = true;
      const value = await callback(transaction);
      transactionOpen = false;
      transactionCommitted = true;
      return value;
    },
  };
  db.PayrollPeriod = {
    async findOne() {
      return null;
    },
  };
  db.FinanceChangeLog = {
    async create(payload, options) {
      financeChangeLogs.push({ options, payload });
    },
  };
  db.OnboardingTrainingMode = {
    async findOne() {
      return null;
    },
  };
  db.OnboardingProgress = {
    async create() {
      assert.equal(transactionOpen, false);
      assert.equal(transactionCommitted, true);
    },
    async findOne() {
      assert.equal(transactionOpen, false);
      assert.equal(transactionCommitted, true);
      return null;
    },
  };
  onboardingService.recordEventSafe = async (_actor, eventKey, options) => {
    onboardingEvents.push({
      options: undefined,
      payload: { eventKey, ...options },
      transactionCommitted,
      transactionOpen,
    });
  };
  db.Category = {
    async findOne({ where }) {
      assert.equal(where.name, 'Корпоративные пополнения');
      assert.equal(where.type, 'income');
      return { id: 1, name: where.name, type: 'income' };
    },
  };
  db.Finance = {
    async create(payload) {
      createdFinanceRows.push(payload);
      return {
        ...finance,
        ...payload,
        id: finance.id,
        toJSON() {
          return { ...this };
        },
      };
    },
  };
  db.CorporateClient = {
    async findByPk(id, options = {}) {
      assert.equal(Number(id), client.id);
      if (options.include?.some((item) => item.as === 'ledgerEntries')) {
        return {
          ...client,
          ledgerEntries: createdLedgerRows.map((row) => ({
            ...row,
            finance,
            toJSON() {
              return { ...this };
            },
          })),
          toJSON() {
            return { ...this };
          },
        };
      }
      return client;
    },
  };
  db.CorporateLedgerEntry = {
    async create(payload) {
      createdLedgerRows.push(payload);
      return {
        id: 90,
        ...payload,
        toJSON() {
          return { ...this };
        },
      };
    },
    async findByPk(id) {
      assert.equal(Number(id), 90);
      return {
        id,
        ...createdLedgerRows[0],
        finance,
        toJSON() {
          return { ...this };
        },
      };
    },
    async findAll() {
      return createdLedgerRows.map((row) => ({
        ...row,
        toJSON() {
          return { ...this };
        },
      }));
    },
  };

  const result = await corporateClientsService.createDeposit(
    client.id,
    {
      amount: 22000,
      category: 'Корпоративные пополнения',
      comment: 'Аванс',
      date: '2026-06-06',
    },
    account,
  );

  assert.equal(createdFinanceRows.length, 1);
  assert.equal(createdFinanceRows[0].type, 'income');
  assert.equal(createdFinanceRows[0].amount, 22000);
  assert.equal(createdLedgerRows[0].financeId, finance.id);
  assert.equal(createdLedgerRows[0].financeCreatedByLedger, true);
  assert.equal(result.corporateClient.balance, 22000);
  assert.deepEqual(
    financeChangeLogs.map((log) => log.payload.action),
    ['corporate_deposit.finance_created', 'corporate_deposit.create'],
  );
  assert.equal(financeChangeLogs.length, 2);
  assert.ok(financeChangeLogs.every((log) => log.options.transaction === transaction));
  assert.equal(onboardingEvents.length, 1);
  assert.equal(onboardingEvents[0].payload.eventKey, 'finance.record_created');
  assert.equal(onboardingEvents[0].payload.entityId, finance.id);
  assert.equal(onboardingEvents[0].transactionOpen, false);
  assert.equal(onboardingEvents[0].transactionCommitted, true);
  assert.equal(onboardingEvents[0].options, undefined);
});

test('cancelDeposit cancels ledger and deletes corporate-created Finance income', async () => {
  const client = makeClient();
  const finance = makeFinance({ id: 77 });
  const entry = {
    amount: 15000,
    corporateClientId: client.id,
    date: '2026-06-05',
    financeCreatedByLedger: true,
    financeId: finance.id,
    id: 99,
    status: 'active',
    type: 'deposit',
    async update(payload) {
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
  db.PayrollPeriod = {
    async findOne() {
      return null;
    },
  };
  db.FinanceChangeLog = {
    async create() {},
  };
  db.CorporateClient = {
    async findByPk(id) {
      assert.equal(Number(id), client.id);
      return client;
    },
  };
  db.CorporateLedgerEntry = {
    async findOne({ where }) {
      assert.equal(Number(where.id), entry.id);
      assert.equal(Number(where.corporateClientId), client.id);
      return entry;
    },
    async findByPk(id) {
      assert.equal(Number(id), entry.id);
      return {
        ...entry,
        finance: null,
        toJSON() {
          return { ...this };
        },
      };
    },
    async findAll() {
      return [entry];
    },
  };
  db.Finance = {
    async findByPk(id) {
      assert.equal(Number(id), finance.id);
      return finance;
    },
  };

  const result = await corporateClientsService.cancelDeposit(
    client.id,
    entry.id,
    { reason: 'Ошибочное пополнение' },
    null,
  );

  assert.equal(entry.status, 'canceled');
  assert.equal(entry.cancelReason, 'Ошибочное пополнение');
  assert.equal(finance.destroyed, true);
  assert.equal(result.corporateClient.balance, 0);
});

test('createSpending creates spending ledger entry and blocks negative balance', async () => {
  const client = makeClient();
  const createdLedgerRows = [
    {
      amount: 10000,
      corporateClientId: client.id,
      date: '2026-06-05',
      status: 'active',
      type: 'deposit',
    },
  ];

  db.sequelize = {
    async transaction(callback) {
      return callback({ LOCK: { UPDATE: 'UPDATE' } });
    },
  };
  db.PayrollPeriod = {
    async findOne() {
      return null;
    },
  };
  db.FinanceChangeLog = {
    async create() {},
  };
  db.CorporateClient = {
    async findByPk(id, options = {}) {
      assert.equal(Number(id), client.id);
      if (options.include?.some((item) => item.as === 'ledgerEntries')) {
        return {
          ...client,
          ledgerEntries: createdLedgerRows.map((row, index) => ({
            id: index + 1,
            ...row,
            toJSON() {
              return { ...this };
            },
          })),
          toJSON() {
            return { ...this };
          },
        };
      }
      return client;
    },
  };
  db.CorporateLedgerEntry = {
    async create(payload) {
      const row = {
        id: createdLedgerRows.length + 1,
        ...payload,
        toJSON() {
          return { ...this };
        },
      };
      createdLedgerRows.push(row);
      return row;
    },
    async findByPk(id) {
      const row = createdLedgerRows.find((entry) => Number(entry.id) === Number(id));
      return {
        ...row,
        toJSON() {
          return { ...this };
        },
      };
    },
    async findAll({ where }) {
      return createdLedgerRows
        .filter((row) => {
          if (
            where.corporateClientId &&
            !matchesWhereValue(row.corporateClientId, where.corporateClientId)
          ) {
            return false;
          }
          if (where.status && row.status !== where.status) return false;
          return true;
        })
        .map((row) => ({
          ...row,
          toJSON() {
            return { ...this };
          },
        }));
    },
  };

  const result = await corporateClientsService.createSpending(
    client.id,
    {
      amount: 3500,
      comment: 'Групповая тренировка',
      date: '2026-06-06',
      participantName: 'Иван',
      service: 'Групповая тренировка',
    },
    null,
  );

  assert.equal(result.ledgerEntry.type, 'spending');
  assert.equal(result.ledgerEntry.service, 'Групповая тренировка');
  assert.equal(result.ledgerEntry.participantName, 'Иван');
  assert.equal(result.corporateClient.balance, 6500);

  await assert.rejects(
    () =>
      corporateClientsService.createSpending(
        client.id,
        {
          amount: 7000,
          date: '2026-06-06',
          service: 'Персональная тренировка',
        },
        null,
      ),
    /Недостаточно средств/,
  );
});

test('reverseSpending cancels spending and restores corporate balance', async () => {
  const client = makeClient();
  const entry = {
    amount: 2500,
    category: 'Корпоративная тренировка',
    corporateClientId: client.id,
    date: '2026-06-06',
    id: 44,
    metadata: {
      participantName: 'Иван',
      service: 'Корпоративная тренировка',
    },
    status: 'active',
    type: 'spending',
    async update(payload) {
      Object.assign(this, payload);
      return this;
    },
    toJSON() {
      return { ...this };
    },
  };
  const deposit = {
    amount: 8000,
    corporateClientId: client.id,
    date: '2026-06-05',
    id: 43,
    status: 'active',
    type: 'deposit',
    toJSON() {
      return { ...this };
    },
  };

  db.sequelize = {
    async transaction(callback) {
      return callback({ LOCK: { UPDATE: 'UPDATE' } });
    },
  };
  db.PayrollPeriod = {
    async findOne() {
      return null;
    },
  };
  db.FinanceChangeLog = {
    async create() {},
  };
  db.CorporateClient = {
    async findByPk(id, options = {}) {
      assert.equal(Number(id), client.id);
      if (options.include?.some((item) => item.as === 'ledgerEntries')) {
        return {
          ...client,
          ledgerEntries: [deposit, entry],
          toJSON() {
            return { ...this };
          },
        };
      }
      return client;
    },
  };
  db.CorporateLedgerEntry = {
    async findOne({ where }) {
      assert.equal(Number(where.id), entry.id);
      assert.equal(where.type, 'spending');
      return entry;
    },
    async findByPk(id) {
      assert.equal(Number(id), entry.id);
      return entry;
    },
    async findAll({ where }) {
      return [deposit, entry]
        .filter((row) =>
          matchesWhereValue(row.corporateClientId, where.corporateClientId),
        )
        .filter((row) => !where.status || row.status === where.status);
    },
  };

  const result = await corporateClientsService.reverseSpending(
    client.id,
    entry.id,
    { reason: 'Ошибка' },
    null,
  );

  assert.equal(entry.status, 'canceled');
  assert.equal(entry.cancelReason, 'Ошибка');
  assert.equal(result.corporateClient.balance, 8000);
  assert.equal(result.ledgerEntry.status, 'canceled');
});

test('getLedgerDetails filters by service and participant with actual running balance', async () => {
  const client = makeClient({ name: 'ООО Фильтр' });
  const ledgerRows = [
    {
      amount: 10000,
      corporateClientId: client.id,
      date: '2026-06-01',
      id: 1,
      status: 'active',
      type: 'deposit',
      toJSON() {
        return { ...this };
      },
    },
    {
      amount: 3000,
      category: 'Групповая тренировка',
      corporateClientId: client.id,
      date: '2026-06-02',
      id: 2,
      metadata: {
        participantName: 'Иван',
        service: 'Групповая тренировка',
      },
      status: 'active',
      type: 'spending',
      toJSON() {
        return { ...this };
      },
    },
    {
      amount: 2000,
      category: 'Персональная тренировка',
      corporateClientId: client.id,
      date: '2026-06-03',
      id: 3,
      metadata: {
        participantName: 'Петр',
        service: 'Персональная тренировка',
      },
      status: 'active',
      type: 'spending',
      toJSON() {
        return { ...this };
      },
    },
  ];

  db.CorporateClient = {
    async findByPk(id, options = {}) {
      assert.equal(Number(id), client.id);
      if (options.include?.some((item) => item.as === 'ledgerEntries')) {
        return {
          ...client,
          ledgerEntries: ledgerRows,
          toJSON() {
            return { ...this };
          },
        };
      }
      return client;
    },
  };
  db.CorporateLedgerEntry = {
    async findAll({ where, order }) {
      const rows = ledgerRows.filter((row) => {
        if (!matchesWhereValue(row.corporateClientId, where.corporateClientId)) {
          return false;
        }
        if (where.status && row.status !== where.status) return false;
        if (where.type && row.type !== where.type) return false;
        return true;
      });
      if (order?.[0]?.[1] === 'DESC') return [...rows].reverse();
      return rows;
    },
  };

  const report = await corporateClientsService.getLedgerDetails(
    client.id,
    {
      participant: 'иван',
      service: 'групповая',
      status: 'active',
    },
    null,
  );

  assert.equal(report.entries.length, 1);
  assert.equal(report.entries[0].id, 2);
  assert.equal(report.entries[0].runningBalance, 7000);
  assert.equal(report.summary.spendingsTotal, 3000);
  assert.equal(report.summary.periodDelta, -3000);
});

test('exportLedgerDetails returns xlsx with corporate details and running balance', async () => {
  const client = makeClient({ name: 'ООО Экспорт' });
  const ledgerRows = [
    {
      amount: 10000,
      corporateClientId: client.id,
      date: '2026-06-01',
      id: 1,
      status: 'active',
      type: 'deposit',
      toJSON() {
        return { ...this };
      },
    },
    {
      amount: 3000,
      category: 'Групповая тренировка',
      comment: 'Утро',
      corporateClientId: client.id,
      date: '2026-06-02',
      id: 2,
      metadata: {
        participantName: 'Иван',
        service: 'Групповая тренировка',
      },
      status: 'active',
      type: 'spending',
      toJSON() {
        return { ...this };
      },
    },
  ];

  db.CorporateClient = {
    async findByPk(id, options = {}) {
      assert.equal(Number(id), client.id);
      if (options.include?.some((item) => item.as === 'ledgerEntries')) {
        return {
          ...client,
          ledgerEntries: ledgerRows,
          toJSON() {
            return { ...this };
          },
        };
      }
      return client;
    },
  };
  db.CorporateLedgerEntry = {
    async findAll({ where, order }) {
      const rows = ledgerRows.filter((row) => {
        if (!matchesWhereValue(row.corporateClientId, where.corporateClientId)) {
          return false;
        }
        if (where.status && row.status !== where.status) return false;
        return true;
      });
      if (order?.[0]?.[1] === 'DESC') return [...rows].reverse();
      return rows;
    },
  };
  db.FinanceChangeLog = {
    async create() {},
  };

  const file = await corporateClientsService.exportLedgerDetails(
    client.id,
    { from: '2026-06-01', to: '2026-06-30' },
    null,
  );

  assert.equal(file.filename, 'corporate-10-2026-06-01-2026-06-30.xlsx');
  assert.ok(Buffer.isBuffer(file.buffer));
  const workbook = xlsx.read(file.buffer, { type: 'buffer' });
  const summaryRows = xlsx.utils.sheet_to_json(workbook.Sheets['Итоги']);
  const rows = xlsx.utils.sheet_to_json(workbook.Sheets['Детализация']);
  assert.equal(summaryRows.some((row) => row.Показатель === 'Сверка баланса'), true);
  assert.equal(rows.length, 2);
  assert.equal(rows[1]['Услуга'], 'Групповая тренировка');
  assert.equal(rows[1]['Участник'], 'Иван');
  assert.equal(rows[1]['Сумма'], -3000);
  assert.equal(rows[1]['Остаток'], 7000);
  assert.equal(Object.hasOwn(rows[1], 'ID операции'), false);
});
