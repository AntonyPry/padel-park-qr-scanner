const assert = require('node:assert/strict');
const { afterEach, test } = require('node:test');
const db = require('../../models');
const financeService = require('../../src/services/finance.service');
const onboardingService = require('../../src/services/onboarding.service');
const payrollService = require('../../src/services/payroll.service');
const shiftCashService = require('../../src/services/shift-cash.service');
const attachmentStorage = require('../../src/services/shift-cash-attachments');
const { buildTenantStorageKey, checksumBuffer } = require('../../src/storage/tenant-storage');
const migration = require('../../migrations/20260714100000-create-shift-cash');

const originalModels = {
  Category: db.Category,
  Finance: db.Finance,
  FinanceChangeLog: db.FinanceChangeLog,
  PayrollPeriod: db.PayrollPeriod,
  Receipt: db.Receipt,
  ShiftCashExpense: db.ShiftCashExpense,
};
const originalFunctions = {
  deleteAttachmentFile: attachmentStorage.deleteAttachmentFile,
  getTrainingDataMarker: onboardingService.getTrainingDataMarker,
  recordChange: payrollService.recordChange,
  recordEventSafe: onboardingService.recordEventSafe,
  storeAttachment: attachmentStorage.storeAttachment,
};

afterEach(() => {
  Object.assign(db, originalModels);
  attachmentStorage.deleteAttachmentFile = originalFunctions.deleteAttachmentFile;
  attachmentStorage.storeAttachment = originalFunctions.storeAttachment;
  onboardingService.getTrainingDataMarker = originalFunctions.getTrainingDataMarker;
  onboardingService.recordEventSafe = originalFunctions.recordEventSafe;
  payrollService.recordChange = originalFunctions.recordChange;
});

function mockAttachmentUpload({ storeError = null, updateError = null } = {}) {
  const attachment = {
    id: 'attachment-1',
    mimeType: 'image/png',
    originalName: 'receipt.png',
    relativePath: 'shift-cash/91/attachment-1.png',
    size: 123,
  };
  const deleted = [];
  const events = [];
  const history = [];
  const shift = {
    date: '2026-07-15',
    id: 12,
    status: 'active',
  };
  const expense = {
    amount: 900,
    attachments: [],
    createdByAccountId: 7,
    description: 'Фото чека',
    financeId: 55,
    id: 91,
    isTraining: false,
    shift,
    shiftId: shift.id,
    status: 'active',
    async update(data) {
      if (updateError) throw updateError;
      this.attachments = data.attachments;
      return this;
    },
    toJSON() {
      return {
        amount: this.amount,
        attachments: this.attachments,
        createdByAccountId: this.createdByAccountId,
        description: this.description,
        financeId: this.financeId,
        id: this.id,
        isTraining: this.isTraining,
        shiftId: this.shiftId,
        status: this.status,
      };
    },
  };

  db.ShiftCashExpense = {
    async findByPk() {
      return expense;
    },
  };
  attachmentStorage.storeAttachment = async () => {
    if (storeError) throw storeError;
    return attachment;
  };
  attachmentStorage.deleteAttachmentFile = async (value) => {
    deleted.push(value);
  };
  onboardingService.getTrainingDataMarker = async () => ({
    isTraining: false,
    trainingAccountId: null,
    trainingRole: null,
  });
  onboardingService.recordEventSafe = async (actor, eventKey, options) => {
    events.push({ actor, eventKey, options });
  };
  payrollService.recordChange = async (payload) => {
    history.push(payload);
  };

  return { attachment, deleted, events, expense, history };
}

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
      trainingSessionId: 'session-17-admin',
    }),
    'training:session-17-admin',
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
      category: shiftCashService.SHIFT_CASH_EXPENSE_CATEGORY,
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
  assert.equal(
    created[0].payload.category,
    shiftCashService.SHIFT_CASH_EXPENSE_CATEGORY,
  );
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

test('shift cash attachment metadata is immutable across tenant and parent identity', () => {
  const expenseId = 91;
  const fileId = '8da05cba-94a5-4d77-b673-80f0a84918dc';
  const tenant = { clubId: 20, organizationId: 10 };
  const attachment = {
    checksumSha256: checksumBuffer(Buffer.from('receipt')),
    clubId: tenant.clubId,
    domain: attachmentStorage.ATTACHMENT_STORAGE_DOMAIN,
    id: fileId,
    mimeType: 'image/png',
    organizationId: tenant.organizationId,
    record: { expenseId, fileId },
    storageKey: buildTenantStorageKey({
      clubId: tenant.clubId,
      domain: attachmentStorage.ATTACHMENT_STORAGE_DOMAIN,
      fileId,
      organizationId: tenant.organizationId,
      recordId: `expense:${expenseId}`,
    }),
    storageSchemaVersion: attachmentStorage.ATTACHMENT_STORAGE_SCHEMA_VERSION,
  };

  assert.doesNotThrow(() =>
    attachmentStorage.assertTenantAttachmentMetadata(attachment, expenseId, tenant),
  );
  assert.throws(
    () => attachmentStorage.assertTenantAttachmentMetadata(attachment, expenseId, {
      clubId: 21,
      organizationId: 10,
    }),
    /Фото не найдено/,
  );
  assert.throws(
    () => attachmentStorage.assertTenantAttachmentMetadata(attachment, expenseId + 1, tenant),
    /Фото не найдено/,
  );
});

test('failed attachment store does not emit onboarding checkpoint', async () => {
  const storeError = new Error('storage unavailable');
  const fixture = mockAttachmentUpload({ storeError });

  await assert.rejects(
    () => shiftCashService.uploadAttachment(91, {}, { id: 7, role: 'admin' }),
    storeError,
  );
  assert.equal(fixture.events.length, 0);
  assert.equal(fixture.history.length, 0);
  assert.deepEqual(fixture.deleted, []);
});

test('failed attachment model update removes stored file and does not emit checkpoint', async () => {
  const updateError = new Error('database update failed');
  const fixture = mockAttachmentUpload({ updateError });

  await assert.rejects(
    () => shiftCashService.uploadAttachment(91, {}, { id: 7, role: 'admin' }),
    updateError,
  );
  assert.equal(fixture.events.length, 0);
  assert.equal(fixture.history.length, 0);
  assert.deepEqual(fixture.deleted, [fixture.attachment]);
});

test('successful attachment upload emits exactly one backend onboarding checkpoint', async () => {
  const fixture = mockAttachmentUpload();
  const account = { id: 7, role: 'admin' };

  const result = await shiftCashService.uploadAttachment(91, {}, account);

  assert.equal(result.attachments.length, 1);
  assert.equal(fixture.history.length, 1);
  assert.deepEqual(fixture.events, [
    {
      actor: account,
      eventKey: 'shift_cash.attachment_uploaded',
      options: {
        entityId: 'attachment-1',
        entityType: 'shift_cash_attachment',
        tenant: null,
        payload: {
          attachmentId: 'attachment-1',
          expenseId: 91,
          shiftId: 12,
        },
      },
    },
  ]);
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
  const expenseTable = operations.find(
    (item) => item[0] === 'create' && item[1] === 'ShiftCashExpenses',
  );
  assert.ok(expenseTable);
  assert.equal(expenseTable[2].categoryId, undefined);
  assert.equal(expenseTable[2].categoryName, undefined);
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
  assert.equal(expenseAttributes.categoryId, undefined);
  assert.equal(expenseAttributes.categoryName, undefined);
  assert.ok(sessionAttributes.openingBanknotes);
  assert.ok(sessionAttributes.closingBanknotes);
  assert.ok(sessionAttributes.expectedClosingCash);
  assert.ok(sessionAttributes.variance);
});
