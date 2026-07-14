const assert = require('node:assert/strict');
const { afterEach, test } = require('node:test');
const db = require('../../models');
const financeService = require('../../src/services/finance.service');
const shiftCashService = require('../../src/services/shift-cash.service');
const attachmentStorage = require('../../src/services/shift-cash-attachments');
const migration = require('../../migrations/20260714100000-create-shift-cash');

const originalModels = {
  Category: db.Category,
  Finance: db.Finance,
  FinanceChangeLog: db.FinanceChangeLog,
  PayrollPeriod: db.PayrollPeriod,
  Receipt: db.Receipt,
};

afterEach(() => {
  Object.assign(db, originalModels);
});

test('cash reconciliation uses cash sales only and subtracts active expenses', () => {
  assert.deepEqual(
    shiftCashService.calculateCashReconciliation({
      cashSales: 12500,
      closingBanknotes: 45100,
      closingCoins: 350,
      expenses: 900,
      openingBanknotes: 33000,
      openingCoins: 850,
    }),
    {
      closingTotal: 45450,
      expectedClosingCash: 45450,
      openingTotal: 33850,
      variance: 0,
    },
  );
});

test('cash closing requires a comment when fact differs from expectation', () => {
  assert.throws(
    () => shiftCashService.assertVarianceComment(-500, ''),
    /При расхождении укажите комментарий/,
  );
  assert.doesNotThrow(() =>
    shiftCashService.assertVarianceComment(-500, 'Недостача передана менеджеру'),
  );
  assert.doesNotThrow(() => shiftCashService.assertVarianceComment(0, ''));
});

test('expense correction permissions keep financeManage separate from shift cash', () => {
  const activeShift = { status: 'active' };
  const closedShift = { status: 'closed' };
  const expense = { createdByAccountId: 7 };

  assert.equal(
    shiftCashService.canWriteExpense(expense, activeShift, { id: 7, role: 'admin' }),
    true,
  );
  assert.equal(
    shiftCashService.canWriteExpense(expense, activeShift, { id: 8, role: 'admin' }),
    false,
  );
  assert.equal(
    shiftCashService.canWriteExpense(expense, closedShift, { id: 7, role: 'admin' }),
    false,
  );
  assert.equal(
    shiftCashService.canWriteExpense(expense, closedShift, { id: 8, role: 'manager' }),
    true,
  );
  assert.equal(
    shiftCashService.canWriteExpense(expense, activeShift, { id: 8, role: 'accountant' }),
    false,
  );
});

test('training cash contexts are isolated per account and role', () => {
  assert.equal(
    shiftCashService.contextKeyForMarker({ isTraining: false }),
    'production',
  );
  assert.equal(
    shiftCashService.contextKeyForMarker({
      isTraining: true,
      trainingAccountId: 17,
      trainingRole: 'admin',
    }),
    'training:17:admin',
  );
});

test('account includes use independent nested Staff aliases', () => {
  const opening = shiftCashService.accountInclude('openingRecordedBy');
  const closing = shiftCashService.accountInclude('closingRecordedBy');

  assert.notEqual(opening, closing);
  assert.notEqual(opening.include, closing.include);
  assert.notEqual(opening.include[0], closing.include[0]);
  assert.equal(opening.as, 'openingRecordedBy');
  assert.equal(closing.as, 'closingRecordedBy');
});

test('Evotor cash calculation excludes cashless payments and keeps cash refunds negative', async () => {
  db.Receipt = {
    async findAll() {
      return [
        { cash: 500, cashless: 700, totalAmount: 1200, type: 'SELL' },
        { cash: 0, cashless: 300, paymentSource: 'CARD', totalAmount: 300, type: 'SELL' },
        { cash: 200, cashless: 0, totalAmount: 200, type: 'PAYBACK' },
      ];
    },
  };

  assert.equal(
    await shiftCashService.getCashSalesForShift({ startedAt: new Date(), endedAt: null }),
    300,
  );
});

test('linked shift cash expense creates an expense Finance record for P&L', async () => {
  const created = [];
  const history = [];
  const transaction = { id: 'shift-cash-finance' };
  db.PayrollPeriod = { async findOne() { return null; } };
  db.Category = {
    async findOne() {
      return { id: 9, name: 'Хозяйственные расходы', type: 'expense' };
    },
  };
  db.Finance = {
    async create(payload, options) {
      created.push({ options, payload });
      return {
        id: 55,
        ...payload,
        toJSON() { return { ...this }; },
      };
    },
  };
  db.FinanceChangeLog = {
    async create(payload, options) {
      history.push({ options, payload });
    },
  };

  const result = await financeService.createLinkedExpenseRecord(
    {
      amount: 900,
      categoryId: 9,
      comment: 'Касса смены #12: сборка подставки',
      date: '2026-07-14',
    },
    { id: 7, role: 'admin' },
    {
      trainingMarker: {
        isTraining: false,
        trainingAccountId: null,
        trainingRole: null,
      },
      transaction,
    },
  );

  assert.equal(result.record.id, 55);
  assert.equal(created[0].payload.type, 'expense');
  assert.equal(created[0].payload.amount, 900);
  assert.equal(created[0].payload.category, 'Хозяйственные расходы');
  assert.equal(created[0].options.transaction, transaction);
  assert.equal(history[0].payload.action, 'shift_cash_expense.finance_created');
});

test('attachment storage rejects unsupported files before writing', async () => {
  await assert.rejects(
    () =>
      attachmentStorage.storeAttachment(
        1,
        {
          data: Buffer.from('not-an-image').toString('base64'),
          fileName: 'receipt.pdf',
          mimeType: 'application/pdf',
        },
        { id: 7 },
      ),
    /только JPEG, PNG, WEBP, GIF или HEIC/,
  );
});

test('shift cash migration creates indexed session and expense tables and rolls back', async () => {
  const operations = [];
  const queryInterface = {
    async addIndex(table, fields, options) {
      operations.push(['index', table, fields, options]);
    },
    async createTable(table, attributes) {
      operations.push(['create', table, attributes]);
    },
    async dropTable(table) {
      operations.push(['drop', table]);
    },
  };
  const Sequelize = {
    BOOLEAN: 'BOOLEAN',
    DATE: 'DATE',
    DECIMAL: () => 'DECIMAL',
    INTEGER: 'INTEGER',
    JSON: 'JSON',
    STRING: () => 'STRING',
    TEXT: 'TEXT',
  };

  await migration.up(queryInterface, Sequelize);
  assert.equal(operations[0][1], 'ShiftCashSessions');
  assert.equal(operations.some((item) => item[1] === 'ShiftCashExpenses'), true);
  assert.equal(
    operations.some((item) => item[3]?.name === 'shift_cash_expenses_finance_idx'),
    true,
  );

  operations.length = 0;
  await migration.down(queryInterface);
  assert.deepEqual(operations, [
    ['drop', 'ShiftCashExpenses'],
    ['drop', 'ShiftCashSessions'],
  ]);
});

test('shift cash models expose required links and soft-cancel fields', () => {
  const expenseAttributes = db.ShiftCashExpense.rawAttributes;
  const sessionAttributes = db.ShiftCashSession.rawAttributes;

  assert.ok(expenseAttributes.shiftId);
  assert.ok(expenseAttributes.financeId);
  assert.ok(expenseAttributes.status);
  assert.ok(expenseAttributes.cancelReason);
  assert.ok(expenseAttributes.attachments);
  assert.ok(sessionAttributes.openingBanknotes);
  assert.ok(sessionAttributes.closingBanknotes);
  assert.ok(sessionAttributes.expectedClosingCash);
  assert.ok(sessionAttributes.variance);
});
