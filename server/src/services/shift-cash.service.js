'use strict';

const db = require('../../models');
const { resolveStoredReceiptPayments } = require('../utils/payments');
const financeService = require('./finance.service');
const onboardingService = require('./onboarding.service');
const payrollService = require('./payroll.service');
const attachmentStorage = require('./shift-cash-attachments');
const {
  isTenantShiftsReportsEnabled,
} = require('../tenant-context/capabilities');
const {
  bindShiftOperationsActor,
  resolveShiftOperationsAccessContext,
  shiftOperationsTenantWhere,
} = require('./shift-operations-access-context.service');

const { Op } = db.Sequelize;
const MANAGER_ROLES = new Set(['owner', 'manager']);
const SHIFT_CASH_EXPENSE_CATEGORY = 'Расходы из кассы';

function accountInclude(as) {
  return {
    as,
    model: db.Account,
    attributes: ['id', 'email', 'role', 'staffId'],
    include: [{ model: db.Staff, attributes: ['id', 'name'] }],
  };
}

const EXPENSE_INCLUDE = [
  accountInclude('createdBy'),
  accountInclude('canceledBy'),
  { as: 'finance', model: db.Finance, attributes: ['id', 'date', 'amount', 'type'] },
];
const SESSION_INCLUDE = [
  accountInclude('openingRecordedBy'),
  accountInclude('closingRecordedBy'),
];

function appError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function toPlain(row) {
  return row?.toJSON ? row.toJSON() : row;
}

function withoutTenantFields(row) {
  const plain = { ...(toPlain(row) || {}) };
  delete plain.clubId;
  delete plain.organizationId;
  return plain;
}

async function resolveBoundary(account, tenant, options = {}) {
  if (!isTenantShiftsReportsEnabled()) return { account, context: null };
  const context = await resolveShiftOperationsAccessContext(tenant, options);
  return { account: bindShiftOperationsActor(account, context), context };
}

function tenantWhere(context, values = {}) {
  return context ? shiftOperationsTenantWhere(context, values) : values;
}

function roundMoney(value) {
  return Number((Number(value) || 0).toFixed(2));
}

function calculateCashReconciliation({
  cashSales = 0,
  closingBanknotes = 0,
  closingCoins = 0,
  expenses = 0,
  manualAdjustments = 0,
  openingBanknotes = 0,
  openingCoins = 0,
}) {
  const openingTotal = roundMoney(openingBanknotes) + roundMoney(openingCoins);
  const closingTotal = roundMoney(closingBanknotes) + roundMoney(closingCoins);
  const expectedClosingCash = roundMoney(
    openingTotal + roundMoney(cashSales) - roundMoney(expenses) +
      roundMoney(manualAdjustments),
  );
  return {
    closingTotal: roundMoney(closingTotal),
    expectedClosingCash,
    openingTotal: roundMoney(openingTotal),
    variance: roundMoney(closingTotal - expectedClosingCash),
  };
}

function assertVarianceComment(variance, comment) {
  if (Math.abs(roundMoney(variance)) >= 0.01 && !String(comment || '').trim()) {
    throw appError('При расхождении укажите комментарий');
  }
}

function normalizeMoney(value, label) {
  const normalized = Number(String(value ?? '').replace(',', '.'));
  if (!Number.isFinite(normalized) || normalized < 0) {
    throw appError(`${label} должна быть неотрицательным числом`);
  }
  if (normalized > 9999999999.99) throw appError(`${label} слишком большая`);
  return roundMoney(normalized);
}

function normalizePositiveMoney(value) {
  const normalized = normalizeMoney(value, 'Сумма расхода');
  if (normalized <= 0) throw appError('Сумма расхода должна быть больше нуля');
  return normalized;
}

function normalizeText(value, label, { required = false, max = 1000 } = {}) {
  const normalized = String(value ?? '').trim();
  if (required && !normalized) throw appError(`${label} обязательно`);
  if (normalized.length > max) throw appError(`${label} слишком длинное`);
  return normalized || null;
}

function normalizeDateTime(value, fallback = new Date()) {
  const date = value ? new Date(value) : fallback;
  if (Number.isNaN(date.getTime())) throw appError('Время расхода указано некорректно');
  return date;
}

function readJson(value, fallback = []) {
  if (value == null || value === '') return fallback;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  }
  return value;
}

function serializeAccount(account) {
  const raw = toPlain(account);
  if (!raw) return null;
  return {
    email: raw.email || null,
    id: raw.id,
    name: raw.Staff?.name || raw.email || null,
    role: raw.role || null,
  };
}

function serializeSession(session) {
  const raw = toPlain(session);
  if (!raw) return null;
  const openingBanknotes = raw.openingBanknotes == null ? null : roundMoney(raw.openingBanknotes);
  const openingCoins = raw.openingCoins == null ? null : roundMoney(raw.openingCoins);
  const closingBanknotes = raw.closingBanknotes == null ? null : roundMoney(raw.closingBanknotes);
  const closingCoins = raw.closingCoins == null ? null : roundMoney(raw.closingCoins);
  return {
    ...raw,
    openingBanknotes,
    openingCoins,
    openingTotal:
      openingBanknotes == null || openingCoins == null
        ? null
        : roundMoney(openingBanknotes + openingCoins),
    closingBanknotes,
    closingCoins,
    closingTotal:
      closingBanknotes == null || closingCoins == null
        ? null
        : roundMoney(closingBanknotes + closingCoins),
    cashSalesSnapshot:
      raw.cashSalesSnapshot == null ? null : roundMoney(raw.cashSalesSnapshot),
    expensesSnapshot:
      raw.expensesSnapshot == null ? null : roundMoney(raw.expensesSnapshot),
    manualAdjustmentsSnapshot: roundMoney(raw.manualAdjustmentsSnapshot),
    expectedClosingCash:
      raw.expectedClosingCash == null ? null : roundMoney(raw.expectedClosingCash),
    variance: raw.variance == null ? null : roundMoney(raw.variance),
    openingRecordedBy: serializeAccount(raw.openingRecordedBy),
    closingRecordedBy: serializeAccount(raw.closingRecordedBy),
  };
}

function attachmentUrl(expenseId, attachmentId) {
  return `/api/shifts/cash/expenses/${expenseId}/attachments/${attachmentId}`;
}

function serializeExpense(expense) {
  const raw = toPlain(expense);
  const attachments = readJson(raw.attachments, []);
  return {
    ...raw,
    amount: roundMoney(raw.amount),
    attachments: attachments.map((attachment) => ({
      ...attachment,
      url: attachmentUrl(raw.id, attachment.id),
    })),
    createdBy: serializeAccount(raw.createdBy),
    canceledBy: serializeAccount(raw.canceledBy),
    finance: raw.finance ? {
      ...raw.finance,
      amount: roundMoney(raw.finance.amount),
    } : null,
  };
}

function contextKeyForMarker(marker) {
  if (!marker?.isTraining) return 'production';
  return `training:${Number(marker.trainingAccountId)}:${marker.trainingRole}`;
}

async function getDataContext(account) {
  const marker = await onboardingService.getTrainingDataMarker(account);
  return { contextKey: contextKeyForMarker(marker), marker };
}

function assertContextMatches(row, context) {
  const raw = toPlain(row);
  if (!raw || raw.contextKey === context.contextKey) return;
  throw appError('Кассовые данные не найдены', 404);
}

function assertTrainingScopeMatches(row, marker) {
  const raw = toPlain(row);
  if (!raw || Boolean(raw.isTraining) !== Boolean(marker.isTraining)) {
    throw appError('Кассовые данные не найдены', 404);
  }
  if (
    marker.isTraining &&
    (Number(raw.trainingAccountId) !== Number(marker.trainingAccountId) ||
      raw.trainingRole !== marker.trainingRole)
  ) {
    throw appError('Кассовые данные не найдены', 404);
  }
}

async function findActiveShift(options = {}) {
  return db.Shift.findOne({
    include: [{ model: db.Staff, attributes: ['id', 'name', 'role'] }],
    order: [['startedAt', 'DESC']],
    transaction: options.transaction,
    lock: options.lock,
    where: tenantWhere(options.context, { archivedAt: null, status: 'active' }),
  });
}

function assertShiftViewAccess(shift, account) {
  if (!shift) throw appError('Смена не найдена', 404);
  if (!['owner', 'manager', 'admin'].includes(account?.role)) {
    throw appError('Недостаточно прав для просмотра кассы', 403);
  }
  if (account.role === 'admin' && shift.status !== 'active') {
    throw appError('Администратор может видеть кассу только активной смены', 403);
  }
}

function canWriteExpense(expense, shift, account) {
  if (MANAGER_ROLES.has(account?.role)) return true;
  return Boolean(
    account?.role === 'admin' &&
      shift.status === 'active' &&
      Number(expense.createdByAccountId) === Number(account.id),
  );
}

function assertExpenseWriteAccess(expense, shift, account) {
  if (!canWriteExpense(expense, shift, account)) {
    throw appError('Изменять этот расход может только владелец или менеджер', 403);
  }
}

async function findSession(shiftId, context, options = {}) {
  const session = await db.ShiftCashSession.findOne({
    include: options.include === false ? undefined : SESSION_INCLUDE,
    lock: options.lock,
    transaction: options.transaction,
    where: { shiftId, contextKey: context.contextKey },
  });
  if (session) assertContextMatches(session, context);
  return session;
}

async function getOrCreateSession(shift, context, transaction) {
  const [session] = await db.ShiftCashSession.findOrCreate({
    defaults: {
      contextKey: context.contextKey,
      shiftId: shift.id,
      status: 'open',
      ...context.marker,
    },
    transaction,
    where: { shiftId: shift.id, contextKey: context.contextKey },
  });
  assertTrainingScopeMatches(session, context.marker);
  return session;
}

async function getCashSalesForShift(shift, options = {}) {
  if (options.isTraining) return 0;
  if (!shift?.startedAt) return 0;
  const dateTime = { [Op.gte]: shift.startedAt };
  const endedAt = options.endedAt || shift.endedAt;
  if (endedAt) dateTime[Op.lte] = endedAt;
  const receipts = await db.Receipt.findAll({
    attributes: ['cash', 'cashless', 'paymentDetails', 'paymentSource', 'totalAmount', 'type'],
    transaction: options.transaction,
    where: {
      dateTime,
      ...(isTenantShiftsReportsEnabled() ? { clubId: shift.clubId } : {}),
    },
  });
  return roundMoney(
    receipts.reduce(
      (sum, receipt) => sum + Number(resolveStoredReceiptPayments(receipt).cash || 0),
      0,
    ),
  );
}

async function listExpenses(sessionId, options = {}) {
  return db.ShiftCashExpense.findAll({
    include: EXPENSE_INCLUDE,
    order: [['spentAt', 'DESC'], ['id', 'DESC']],
    transaction: options.transaction,
    where: { cashSessionId: sessionId },
  });
}

async function buildCashSummary(shift, session, context, options = {}) {
  const expenses = session ? await listExpenses(session.id, options) : [];
  const activeExpensesTotal = roundMoney(
    expenses.reduce(
      (sum, expense) => sum + (expense.status === 'active' ? Number(expense.amount) : 0),
      0,
    ),
  );
  const serializedSession = serializeSession(session);
  const openingTotal = serializedSession?.openingTotal || 0;
  const cashSales =
    session?.status === 'closed' && session.cashSalesSnapshot != null
      ? roundMoney(session.cashSalesSnapshot)
      : await getCashSalesForShift(shift, {
          endedAt: options.endedAt,
          isTraining: context.marker.isTraining,
          transaction: options.transaction,
        });
  const manualAdjustments = roundMoney(session?.manualAdjustmentsSnapshot);
  const expectedClosingCash = roundMoney(
    openingTotal + cashSales - activeExpensesTotal + manualAdjustments,
  );

  return {
    activeExpensesTotal,
    cashSales,
    expenses: expenses.map(serializeExpense),
    expectedClosingCash,
    manualAdjustments,
    session: serializedSession,
    shift: withoutTenantFields(shift),
  };
}

async function getActiveCash(account, tenant) {
  const boundary = await resolveBoundary(account, tenant);
  const [shift, context] = await Promise.all([
    findActiveShift({ context: boundary.context }),
    getDataContext(boundary.account),
  ]);
  if (!shift) {
    return {
      activeExpensesTotal: 0,
      cashSales: 0,
      expenses: [],
      expectedClosingCash: 0,
      manualAdjustments: 0,
      session: null,
      shift: null,
    };
  }
  assertShiftViewAccess(shift, boundary.account);
  const session = await findSession(shift.id, context);
  return buildCashSummary(shift, session, context);
}

async function getShiftCash(shiftId, account, tenant) {
  const boundary = await resolveBoundary(account, tenant);
  if (!MANAGER_ROLES.has(boundary.account?.role)) {
    throw appError('Кассу закрытых смен могут проверять только владелец и менеджер', 403);
  }
  const shift = await db.Shift.findOne({
    include: [{ model: db.Staff, attributes: ['id', 'name', 'role'] }],
    where: tenantWhere(boundary.context, { id: Number(shiftId) }),
  });
  assertShiftViewAccess(shift, boundary.account);
  const context = { contextKey: 'production', marker: {
    isTraining: false,
    trainingAccountId: null,
    trainingRole: null,
  } };
  const session = await findSession(shift.id, context);
  return buildCashSummary(shift, session, context);
}

async function saveOpening(data, account, tenant) {
  const openingBanknotes = normalizeMoney(data.banknotes, 'Сумма купюр');
  const openingCoins = normalizeMoney(data.coins, 'Сумма мелочи');
  const openingComment = normalizeText(data.comment, 'Комментарий', { max: 1000 });

  const result = await db.sequelize.transaction(async (transaction) => {
    const boundary = await resolveBoundary(account, tenant, {
      lock: true,
      transaction,
    });
    const context = await getDataContext(boundary.account);
    const shift = await findActiveShift({
      context: boundary.context,
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    assertShiftViewAccess(shift, boundary.account);
    await payrollService.assertDateEditable(shift.date, 'остаток кассы смены');
    const session = await getOrCreateSession(shift, context, transaction);
    if (session.status === 'closed') throw appError('Кассовая сверка уже закрыта', 409);
    const beforeData = session.toJSON();
    await session.update(
      {
        openingBanknotes,
        openingCoins,
        openingComment,
        openingRecordedAt: new Date(),
        openingRecordedByAccountId: boundary.account?.id || null,
      },
      { transaction },
    );
    await payrollService.recordChange({
      action: beforeData.openingRecordedAt ? 'shift_cash.opening_updated' : 'shift_cash.opening_recorded',
      entityType: 'shift_cash_session',
      entityId: session.id,
      account: boundary.account,
      date: shift.date,
      reason: openingComment,
      beforeData,
      afterData: session.toJSON(),
      transaction,
    });
    return { account: boundary.account, sessionId: session.id, shiftId: shift.id };
  });

  await onboardingService.recordEventSafe(result.account, 'shift_cash.opening_recorded', {
    entityId: result.sessionId,
    entityType: 'shift_cash_session',
    payload: { shiftId: result.shiftId },
  });
  return getActiveCash(account, tenant);
}

function normalizeExpensePayload(data, shift) {
  const amount = normalizePositiveMoney(data.amount);
  const description = normalizeText(data.description, 'Описание расхода', {
    max: 1000,
    required: true,
  });
  const spentAt = normalizeDateTime(data.spentAt);
  const startedAt = shift.startedAt ? new Date(shift.startedAt) : null;
  const endedAt = shift.endedAt ? new Date(shift.endedAt) : null;
  if (startedAt && spentAt.getTime() < startedAt.getTime()) {
    throw appError('Время расхода не может быть раньше начала смены');
  }
  if (endedAt && spentAt.getTime() > endedAt.getTime()) {
    throw appError('Время расхода не может быть позже закрытия смены');
  }
  if (!endedAt && spentAt.getTime() > Date.now() + 5 * 60000) {
    throw appError('Время расхода не может быть в будущем');
  }
  return { amount, description, spentAt };
}

function financeComment(shift, description) {
  return `Касса смены #${shift.id}: ${description}`;
}

async function createExpense(data, account, tenant) {
  const result = await db.sequelize.transaction(async (transaction) => {
    const boundary = await resolveBoundary(account, tenant, {
      lock: true,
      transaction,
    });
    const context = await getDataContext(boundary.account);
    const shift = await findActiveShift({
      context: boundary.context,
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    assertShiftViewAccess(shift, boundary.account);
    await payrollService.assertDateEditable(shift.date, 'кассовый расход');
    const session = await getOrCreateSession(shift, context, transaction);
    if (!session.openingRecordedAt) {
      throw appError('Сначала зафиксируйте остаток кассы на начало смены', 409);
    }
    const normalized = normalizeExpensePayload(data, shift);
    const { record: finance } = await financeService.createLinkedExpenseRecord(
      {
        amount: normalized.amount,
        category: SHIFT_CASH_EXPENSE_CATEGORY,
        comment: financeComment(shift, normalized.description),
        date: shift.date,
      },
      boundary.account,
      { trainingMarker: context.marker, transaction },
    );
    const expense = await db.ShiftCashExpense.create(
      {
        amount: normalized.amount,
        attachments: [],
        cashSessionId: session.id,
        createdByAccountId: boundary.account?.id || null,
        description: normalized.description,
        financeId: finance.id,
        shiftId: shift.id,
        spentAt: normalized.spentAt,
        status: 'active',
        ...context.marker,
      },
      { transaction },
    );
    await payrollService.recordChange({
      action: 'shift_cash.expense_created',
      entityType: 'shift_cash_expense',
      entityId: expense.id,
      account: boundary.account,
      date: shift.date,
      reason: normalized.description,
      afterData: expense.toJSON(),
      transaction,
    });
    return {
      account: boundary.account,
      expenseId: expense.id,
      shiftId: shift.id,
    };
  });

  await onboardingService.recordEventSafe(result.account, 'shift_cash.expense_created', {
    entityId: result.expenseId,
    entityType: 'shift_cash_expense',
    payload: { shiftId: result.shiftId },
  });
  return {
    ...(await getActiveCash(account, tenant)),
    createdExpenseId: result.expenseId,
  };
}

async function loadExpenseForMutation(expenseId, boundary, transaction) {
  const expense = await db.ShiftCashExpense.findByPk(expenseId, {
    include: [{
      as: 'shift',
      model: db.Shift,
      required: true,
      where: boundary.context ? { clubId: boundary.context.clubId } : undefined,
    }],
    lock: transaction?.LOCK?.UPDATE,
    transaction,
  });
  if (!expense) throw appError('Кассовый расход не найден', 404);
  const context = await getDataContext(boundary.account);
  assertTrainingScopeMatches(expense, context.marker);
  const shift = expense.shift || expense.Shift;
  assertShiftViewAccess(shift, boundary.account);
  assertExpenseWriteAccess(expense, shift, boundary.account);
  return { context, expense, shift };
}

async function recalculateClosedSession(sessionId, transaction) {
  const session = await db.ShiftCashSession.findByPk(sessionId, {
    transaction,
    lock: transaction?.LOCK?.UPDATE,
  });
  if (!session || session.status !== 'closed') return;
  const activeExpenses = await db.ShiftCashExpense.sum('amount', {
    transaction,
    where: { cashSessionId: session.id, status: 'active' },
  });
  const openingTotal = roundMoney(session.openingBanknotes) + roundMoney(session.openingCoins);
  const expectedClosingCash = roundMoney(
    openingTotal + roundMoney(session.cashSalesSnapshot) - roundMoney(activeExpenses) +
      roundMoney(session.manualAdjustmentsSnapshot),
  );
  const closingTotal = roundMoney(session.closingBanknotes) + roundMoney(session.closingCoins);
  await session.update(
    {
      expensesSnapshot: roundMoney(activeExpenses),
      expectedClosingCash,
      variance: roundMoney(closingTotal - expectedClosingCash),
    },
    { transaction },
  );
}

async function updateExpense(expenseId, data, account, tenant) {
  const result = await db.sequelize.transaction(async (transaction) => {
    const boundary = await resolveBoundary(account, tenant, {
      lock: true,
      transaction,
    });
    const { context, expense, shift } = await loadExpenseForMutation(
      expenseId,
      boundary,
      transaction,
    );
    if (expense.status !== 'active') throw appError('Отмененный расход нельзя менять', 409);
    await payrollService.assertDateEditable(shift.date, 'кассовый расход');
    const normalized = normalizeExpensePayload(data, shift);
    const beforeData = expense.toJSON();
    const { record: finance } = await financeService.updateLinkedExpenseRecord(
      expense.financeId,
      {
        amount: normalized.amount,
        category: SHIFT_CASH_EXPENSE_CATEGORY,
        comment: financeComment(shift, normalized.description),
        date: shift.date,
      },
      boundary.account,
      { trainingMarker: context.marker, transaction },
    );
    await expense.update(
      {
        amount: normalized.amount,
        description: normalized.description,
        financeId: finance.id,
        spentAt: normalized.spentAt,
      },
      { transaction },
    );
    await recalculateClosedSession(expense.cashSessionId, transaction);
    await payrollService.recordChange({
      action: 'shift_cash.expense_updated',
      entityType: 'shift_cash_expense',
      entityId: expense.id,
      account: boundary.account,
      date: shift.date,
      reason: normalized.description,
      beforeData,
      afterData: expense.toJSON(),
      transaction,
    });
    return { account: boundary.account, shiftId: shift.id };
  });
  return getCashForMutationResult(result.shiftId, account, tenant);
}

async function cancelExpense(expenseId, data, account, tenant) {
  const reason = normalizeText(data.reason, 'Причина отмены', { max: 1000, required: true });
  const result = await db.sequelize.transaction(async (transaction) => {
    const boundary = await resolveBoundary(account, tenant, {
      lock: true,
      transaction,
    });
    const { context, expense, shift } = await loadExpenseForMutation(
      expenseId,
      boundary,
      transaction,
    );
    if (expense.status === 'canceled') throw appError('Расход уже отменен', 409);
    await payrollService.assertDateEditable(shift.date, 'отмену кассового расхода');
    const beforeData = expense.toJSON();
    await financeService.deleteLinkedExpenseRecord(expense.financeId, boundary.account, {
      reason,
      trainingMarker: context.marker,
      transaction,
    });
    await expense.update(
      {
        canceledAt: new Date(),
        canceledByAccountId: boundary.account?.id || null,
        cancelReason: reason,
        financeId: null,
        status: 'canceled',
      },
      { transaction },
    );
    await recalculateClosedSession(expense.cashSessionId, transaction);
    await payrollService.recordChange({
      action: 'shift_cash.expense_canceled',
      entityType: 'shift_cash_expense',
      entityId: expense.id,
      account: boundary.account,
      date: shift.date,
      reason,
      beforeData,
      afterData: expense.toJSON(),
      transaction,
    });
    return { account: boundary.account, shiftId: shift.id };
  });
  return getCashForMutationResult(result.shiftId, account, tenant);
}

async function getCashForMutationResult(shiftId, account, tenant) {
  const boundary = await resolveBoundary(account, tenant);
  const active = await findActiveShift({ context: boundary.context });
  if (active && Number(active.id) === Number(shiftId)) {
    return getActiveCash(account, tenant);
  }
  return getShiftCash(shiftId, account, tenant);
}

async function loadExpenseForAttachment(
  expenseId,
  boundary,
  { write = false } = {},
) {
  const expense = await db.ShiftCashExpense.findByPk(expenseId, {
    include: [{
      as: 'shift',
      model: db.Shift,
      required: true,
      where: boundary.context ? { clubId: boundary.context.clubId } : undefined,
    }],
  });
  if (!expense) throw appError('Кассовый расход не найден', 404);
  const context = await getDataContext(boundary.account);
  assertTrainingScopeMatches(expense, context.marker);
  const shift = expense.shift || expense.Shift;
  assertShiftViewAccess(shift, boundary.account);
  if (write) {
    assertExpenseWriteAccess(expense, shift, boundary.account);
    if (shift.status !== 'active') {
      throw appError('Фото можно менять только во время активной смены', 409);
    }
    if (expense.status !== 'active') throw appError('Расход уже отменен', 409);
  }
  return { expense, shift };
}

async function uploadAttachment(expenseId, payload, account, requestTenant = null) {
  const boundary = await resolveBoundary(account, requestTenant);
  const { expense, shift } = await loadExpenseForAttachment(
    expenseId,
    boundary,
    { write: true },
  );
  const attachments = readJson(expense.attachments, []);
  if (attachments.length >= attachmentStorage.MAX_ATTACHMENTS_PER_EXPENSE) {
    throw appError(
      `К одному расходу можно прикрепить до ${attachmentStorage.MAX_ATTACHMENTS_PER_EXPENSE} фото`,
    );
  }
  const attachment = await attachmentStorage.storeAttachment(
    expense.id,
    payload,
    boundary.account,
    requestTenant,
  );
  try {
    await expense.update({ attachments: [...attachments, attachment] });
  } catch (error) {
    await attachmentStorage.deleteAttachmentFile(attachment, expense.id, requestTenant);
    throw error;
  }
  await payrollService.recordChange({
    action: 'shift_cash.attachment_uploaded',
    entityType: 'shift_cash_expense',
    entityId: expense.id,
    account: boundary.account,
    date: shift.date,
    afterData: { attachmentId: attachment.id, fileName: attachment.originalName },
  });
  const result = serializeExpense(
    await db.ShiftCashExpense.findByPk(expense.id, { include: EXPENSE_INCLUDE }),
  );
  await onboardingService.recordEventSafe(boundary.account, 'shift_cash.attachment_uploaded', {
    entityId: attachment.id,
    entityType: 'shift_cash_attachment',
    payload: {
      attachmentId: attachment.id,
      expenseId: expense.id,
      shiftId: shift.id,
    },
  });
  return result;
}

async function removeAttachment(expenseId, attachmentId, account, requestTenant = null) {
  const boundary = await resolveBoundary(account, requestTenant);
  const { expense, shift } = await loadExpenseForAttachment(
    expenseId,
    boundary,
    { write: true },
  );
  const attachments = readJson(expense.attachments, []);
  const attachment = attachments.find((item) => item.id === attachmentId);
  if (!attachment) throw appError('Фото не найдено', 404);
  await expense.update({ attachments: attachments.filter((item) => item.id !== attachmentId) });
  await attachmentStorage.deleteAttachmentFile(attachment, expense.id, requestTenant);
  await payrollService.recordChange({
    action: 'shift_cash.attachment_removed',
    entityType: 'shift_cash_expense',
    entityId: expense.id,
    account: boundary.account,
    date: shift.date,
    beforeData: { attachmentId: attachment.id, fileName: attachment.originalName },
  });
  return serializeExpense(await db.ShiftCashExpense.findByPk(expense.id, { include: EXPENSE_INCLUDE }));
}

async function getAttachment(expenseId, attachmentId, account, requestTenant = null) {
  const boundary = await resolveBoundary(account, requestTenant);
  const { expense } = await loadExpenseForAttachment(expenseId, boundary);
  const attachment = readJson(expense.attachments, []).find(
    (item) => item.id === attachmentId,
  );
  if (!attachment) throw appError('Фото не найдено', 404);
  return {
    absolutePath: await attachmentStorage.resolveAttachmentPath(
      attachment,
      expense.id,
      requestTenant,
    ),
    attachment,
  };
}

async function closeCashSession({ shift, endedAt, data, account, transaction }) {
  const context = {
    contextKey: 'production',
    marker: { isTraining: false, trainingAccountId: null, trainingRole: null },
  };
  const session = await findSession(shift.id, context, {
    include: false,
    lock: transaction.LOCK.UPDATE,
    transaction,
  });
  if (!session?.openingRecordedAt) {
    throw appError('Сначала зафиксируйте остаток кассы на начало смены', 409);
  }
  if (session.status === 'closed') throw appError('Кассовая сверка уже закрыта', 409);
  const closingBanknotes = normalizeMoney(data.banknotes, 'Сумма купюр');
  const closingCoins = normalizeMoney(data.coins, 'Сумма мелочи');
  const closingComment = normalizeText(data.comment, 'Комментарий', { max: 1000 });
  const cashSales = await getCashSalesForShift(shift, { endedAt, transaction });
  const expenses = await db.ShiftCashExpense.sum('amount', {
    transaction,
    where: { cashSessionId: session.id, status: 'active' },
  });
  const expensesSnapshot = roundMoney(expenses);
  const { expectedClosingCash, variance } = calculateCashReconciliation({
    cashSales,
    closingBanknotes,
    closingCoins,
    expenses: expensesSnapshot,
    manualAdjustments: session.manualAdjustmentsSnapshot,
    openingBanknotes: session.openingBanknotes,
    openingCoins: session.openingCoins,
  });
  assertVarianceComment(variance, closingComment);

  const beforeData = session.toJSON();
  await session.update(
    {
      cashSalesSnapshot: cashSales,
      closingBanknotes,
      closingCoins,
      closingComment,
      closingRecordedAt: endedAt,
      closingRecordedByAccountId: account?.id || null,
      expectedClosingCash,
      expensesSnapshot,
      status: 'closed',
      variance,
    },
    { transaction },
  );
  await payrollService.recordChange({
    action: 'shift_cash.closed',
    entityType: 'shift_cash_session',
    entityId: session.id,
    account,
    date: shift.date,
    reason: closingComment,
    beforeData,
    afterData: session.toJSON(),
    transaction,
  });
  return serializeSession(session);
}

module.exports = {
  accountInclude,
  buildCashSummary,
  calculateCashReconciliation,
  cancelExpense,
  canWriteExpense,
  assertVarianceComment,
  closeCashSession,
  contextKeyForMarker,
  createExpense,
  getActiveCash,
  getAttachment,
  getCashSalesForShift,
  getShiftCash,
  removeAttachment,
  roundMoney,
  SHIFT_CASH_EXPENSE_CATEGORY,
  saveOpening,
  serializeExpense,
  serializeSession,
  updateExpense,
  uploadAttachment,
};
