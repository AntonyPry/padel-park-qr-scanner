const { Op } = require('sequelize');
const xlsx = require('xlsx');
const db = require('../../models');
const motivationService = require('./motivation.service');
const onboardingService = require('./onboarding.service');

const LOCKED_PAYROLL_STATUSES = ['reviewed', 'approved', 'paid'];
const PAYROLL_STATUSES = ['draft', 'reviewed', 'approved', 'paid'];

function appError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function normalizeDateOnly(value, fieldName = 'дата') {
  const date = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw appError(`Укажите ${fieldName} в формате YYYY-MM-DD`);
  }

  return date;
}

function normalizeRange(from, to) {
  const fromDate = normalizeDateOnly(from, 'дату начала периода');
  const toDate = normalizeDateOnly(to || from, 'дату окончания периода');

  if (fromDate > toDate) {
    throw appError('Дата начала периода не может быть позже даты окончания');
  }

  return { fromDate, toDate };
}

function startOfDate(date) {
  return new Date(`${date}T00:00:00.000`);
}

function endOfDate(date) {
  return new Date(`${date}T23:59:59.999`);
}

function parseSnapshot(snapshot) {
  if (!snapshot) return null;
  if (typeof snapshot === 'string') {
    try {
      return JSON.parse(snapshot);
    } catch {
      return null;
    }
  }

  return snapshot;
}

function sumPayroll(shifts) {
  return shifts.reduce(
    (acc, shift) => {
      if (shift.isDraft) {
        acc.totalDrafts += 1;
      } else {
        acc.totalShifts += 1;
        acc.totalHours += Number(shift.hours) || 0;
      }

      acc.totalRevenue += Number(shift.dailyRevenue) || 0;
      acc.basePay += Number(shift.basePay) || 0;
      acc.bonusPay += Number(shift.bonus) || 0;
      acc.totalPay += Number(shift.total) || 0;
      return acc;
    },
    {
      totalShifts: 0,
      totalDrafts: 0,
      totalHours: 0,
      totalRevenue: 0,
      basePay: 0,
      bonusPay: 0,
      totalPay: 0,
    },
  );
}

function buildWorkbookBuffer(sheets) {
  const workbook = xlsx.utils.book_new();

  sheets.forEach(({ name, rows }) => {
    const worksheet = xlsx.utils.json_to_sheet(rows);
    xlsx.utils.book_append_sheet(workbook, worksheet, name.slice(0, 31));
  });

  return xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });
}

function serializeAccount(account) {
  if (!account) return null;

  return {
    id: account.id,
    email: account.email,
    role: account.role,
    name: account.Staff?.name || account.email,
  };
}

function serializePeriod(period) {
  if (!period) return null;
  const raw = period.toJSON ? period.toJSON() : period;

  return {
    id: raw.id,
    fromDate: raw.fromDate,
    toDate: raw.toDate,
    status: raw.status,
    note: raw.note || '',
    reviewedAt: raw.reviewedAt,
    approvedAt: raw.approvedAt,
    paidAt: raw.paidAt,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    reviewedBy: serializeAccount(raw.reviewedBy),
    approvedBy: serializeAccount(raw.approvedBy),
    paidBy: serializeAccount(raw.paidBy),
  };
}

function getPeriodInclude() {
  return [
    {
      model: db.Account,
      as: 'reviewedBy',
      attributes: ['id', 'email', 'role', 'staffId'],
      include: [{ model: db.Staff, attributes: ['id', 'name'] }],
    },
    {
      model: db.Account,
      as: 'approvedBy',
      attributes: ['id', 'email', 'role', 'staffId'],
      include: [{ model: db.Staff, attributes: ['id', 'name'] }],
    },
    {
      model: db.Account,
      as: 'paidBy',
      attributes: ['id', 'email', 'role', 'staffId'],
      include: [{ model: db.Staff, attributes: ['id', 'name'] }],
    },
  ];
}

function assertTransitionAllowed(period, nextStatus) {
  const current = period.status;

  const allowed = {
    draft: ['reviewed'],
    reviewed: ['draft', 'approved'],
    approved: ['paid'],
    paid: [],
  };

  if (!allowed[current]?.includes(nextStatus)) {
    throw appError(
      `Нельзя перевести payroll из статуса «${current}» в «${nextStatus}»`,
      409,
    );
  }
}

function assertRoleCanTransition(account, nextStatus) {
  const role = account?.role;

  if (nextStatus === 'reviewed' && !['owner', 'manager', 'accountant'].includes(role)) {
    throw appError('Недостаточно прав, чтобы отправить payroll на проверку', 403);
  }

  if (nextStatus === 'draft' && !['owner', 'manager', 'accountant'].includes(role)) {
    throw appError('Недостаточно прав, чтобы вернуть payroll в черновик', 403);
  }

  if (nextStatus === 'approved' && !['owner', 'manager'].includes(role)) {
    throw appError('Утверждать payroll может только владелец или менеджер', 403);
  }

  if (nextStatus === 'paid' && !['owner', 'accountant'].includes(role)) {
    throw appError('Отмечать payroll выплаченным может владелец или бухгалтер', 403);
  }
}

async function recordChange({
  action,
  entityType,
  entityId,
  account,
  reason,
  date,
  fromDate,
  toDate,
  beforeData,
  afterData,
  transaction,
}) {
  try {
    await db.FinanceChangeLog.create(
      {
        action,
        entityType,
        entityId: entityId === undefined || entityId === null ? null : String(entityId),
        accountId: account?.id || null,
        role: account?.role || null,
        reason: reason || null,
        date: date || null,
        fromDate: fromDate || null,
        toDate: toDate || null,
        beforeData: beforeData || null,
        afterData: afterData || null,
      },
      transaction ? { transaction } : undefined,
    );
  } catch (error) {
    console.error('Ошибка записи финансовой истории:', error);
  }
}

async function getCategoryName(itemName, rulesMap) {
  const name = String(itemName || '').toLowerCase().trim();
  return rulesMap[name] || 'Неразобранное';
}

async function buildSalesContext(fromDate, toDate) {
  const [rulesList, receipts] = await Promise.all([
    db.CatalogRule.findAll({ where: { status: 'active' } }),
    db.Receipt.findAll({
      where: {
        dateTime: {
          [Op.gte]: startOfDate(fromDate),
          [Op.lte]: endOfDate(toDate),
        },
      },
      include: [{ model: db.ReceiptItem, as: 'items' }],
      order: [['dateTime', 'ASC']],
    }),
  ]);

  const rulesMap = {};
  rulesList.forEach((rule) => {
    rulesMap[String(rule.itemName).toLowerCase().trim()] = rule.category;
  });

  const salesByDate = {};
  const receiptSales = [];
  let receiptTotal = 0;
  let receiptItemsTotal = 0;

  for (const receipt of receipts) {
    const multiplier = receipt.type === 'PAYBACK' ? -1 : 1;
    const date = new Date(receipt.dateTime).toISOString().split('T')[0];
    if (!salesByDate[date]) salesByDate[date] = { revenue: 0, items: [] };

    const receiptEntry = {
      id: receipt.id,
      date,
      dateTime: new Date(receipt.dateTime),
      total: Math.abs(Number(receipt.totalAmount) || 0) * multiplier,
      items: [],
    };

    receiptTotal += receiptEntry.total;

    for (const item of receipt.items || []) {
      const category = await getCategoryName(item.name, rulesMap);
      const rawAmount = Number(
        item.sumPrice !== undefined && item.sumPrice !== null
          ? item.sumPrice
          : item.sum,
      );
      const sum = Math.abs(rawAmount) * multiplier;
      const qty = Math.abs(Number(item.quantity)) * multiplier;
      if (sum === 0 && qty === 0) continue;

      const saleItem = {
        name: item.name,
        category,
        sum,
        qty,
      };

      receiptItemsTotal += sum;
      receiptEntry.items.push(saleItem);
      salesByDate[date].revenue += sum;
      salesByDate[date].items.push(saleItem);
    }

    receiptSales.push(receiptEntry);
  }

  return {
    receiptSales,
    salesByDate,
    reconciliation: {
      receiptCount: receipts.length,
      receiptsTotal: receiptTotal,
      receiptItemsTotal,
      difference: receiptTotal - receiptItemsTotal,
    },
  };
}

function getShiftSales(shift, salesContext) {
  const startedAt = shift.startedAt ? new Date(shift.startedAt) : null;
  const endedAt = shift.endedAt ? new Date(shift.endedAt) : null;

  if (startedAt && endedAt && endedAt > startedAt) {
    const items = [];
    let revenue = 0;

    salesContext.receiptSales.forEach((receipt) => {
      if (receipt.dateTime >= startedAt && receipt.dateTime <= endedAt) {
        receipt.items.forEach((item) => {
          revenue += Number(item.sum) || 0;
          items.push(item);
        });
      }
    });

    return { revenue, items };
  }

  return salesContext.salesByDate[shift.date] || { revenue: 0, items: [] };
}

async function buildPayrollSnapshot(from, to) {
  const { fromDate, toDate } = normalizeRange(from, to);

  const [shiftsDb, motivationRules, motivationBonusRules, salesContext] =
    await Promise.all([
      db.Shift.findAll({
        where: {
          date: {
            [Op.gte]: fromDate,
            [Op.lte]: toDate,
          },
          archivedAt: null,
        },
        include: [{ model: db.Staff, attributes: ['id', 'name'] }],
        order: [['date', 'ASC']],
      }),
      motivationService.getRulesMap(),
      motivationService.getBonusRules(),
      buildSalesContext(fromDate, toDate),
    ]);

  const payrollByAdmin = {};
  const shiftsHistory = [];
  const processedDates = new Set();
  const warnings = [];

  const shiftsByDate = shiftsDb.reduce((acc, shift) => {
    acc[shift.date] = (acc[shift.date] || 0) + 1;
    return acc;
  }, {});

  shiftsDb.forEach((shift) => {
    processedDates.add(shift.date);
    const admin = shift.Staff?.name || shift.adminName;
    const staffId = shift.staffId || shift.Staff?.id || null;
    const rawHours = Number(shift.actualHours ?? shift.hours);
    const hrs = Number.isFinite(rawHours) && rawHours > 0 ? rawHours : 0;
    const shiftSales = getShiftSales(shift, salesContext);

    if (shiftsByDate[shift.date] > 1 && (!shift.startedAt || !shift.endedAt)) {
      warnings.push(
        `На ${shift.date} есть несколько смен без точного времени: бонусы считаются по дневной выручке.`,
      );
    }

    const bonusResult = motivationService.calculateShiftBonus(
      shiftSales.items,
      motivationBonusRules,
    );
    const shiftBonus = bonusResult.total;
    const detailedItems = bonusResult.detailedItems;
    const shiftBasePay = motivationService.calculateBasePay(hrs, motivationRules);
    const manualAdj = Number(shift.manualAdjustment) || 0;
    const totalPay = shiftBasePay + shiftBonus + manualAdj;

    if (admin && hrs > 0) {
      const adminKey = staffId
        ? `staff:${staffId}`
        : `name:${admin.toLowerCase()}`;

      if (!payrollByAdmin[adminKey]) {
        payrollByAdmin[adminKey] = {
          staffId,
          name: admin,
          totalShifts: 0,
          totalHours: 0,
          basePay: 0,
          calculatedBonusPay: 0,
          manualAdjustmentTotal: 0,
          bonusPay: 0,
          totalPay: 0,
        };
      }

      payrollByAdmin[adminKey].totalShifts += 1;
      payrollByAdmin[adminKey].totalHours += hrs;
      payrollByAdmin[adminKey].basePay += shiftBasePay;
      payrollByAdmin[adminKey].calculatedBonusPay += shiftBonus;
      payrollByAdmin[adminKey].manualAdjustmentTotal += manualAdj;
      payrollByAdmin[adminKey].bonusPay += shiftBonus + manualAdj;
      payrollByAdmin[adminKey].totalPay += totalPay;
    }

    shiftsHistory.push({
      id: shift.id,
      isDraft: false,
      date: shift.date,
      startedAt: shift.startedAt || null,
      endedAt: shift.endedAt || null,
      status: shift.status,
      staffId,
      adminName: admin,
      hours: hrs,
      dailyRevenue: shiftSales.revenue,
      basePay: shiftBasePay,
      calculatedBonus: shiftBonus,
      manualAdjustment: manualAdj,
      comment: shift.comment || '',
      bonus: shiftBonus + manualAdj,
      total: totalPay,
      items: detailedItems,
    });
  });

  Object.keys(salesContext.salesByDate).forEach((date) => {
    if (!processedDates.has(date)) {
      const todaySales = salesContext.salesByDate[date];
      const detailedItems = motivationService.calculateShiftBonus(
        todaySales.items,
        motivationBonusRules,
      ).detailedItems;

      shiftsHistory.push({
        id: `draft-${date}`,
        isDraft: true,
        date,
        startedAt: null,
        endedAt: null,
        status: 'draft',
        staffId: null,
        adminName: null,
        hours: 0,
        dailyRevenue: todaySales.revenue,
        basePay: 0,
        calculatedBonus: 0,
        manualAdjustment: 0,
        comment: '',
        bonus: 0,
        total: 0,
        items: detailedItems,
      });
    }
  });

  shiftsHistory.sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
  );

  const snapshot = {
    fromDate,
    toDate,
    generatedAt: new Date().toISOString(),
    admins: Object.values(payrollByAdmin),
    shifts: shiftsHistory,
    totals: sumPayroll(shiftsHistory),
    reconciliation: salesContext.reconciliation,
    warnings: [...new Set(warnings)],
  };

  return snapshot;
}

async function findExactPeriod(from, to) {
  const { fromDate, toDate } = normalizeRange(from, to);

  return db.PayrollPeriod.findOne({
    where: { fromDate, toDate },
    include: getPeriodInclude(),
  });
}

async function findLockedPeriodForDate(date) {
  const dateOnly = normalizeDateOnly(date);

  return db.PayrollPeriod.findOne({
    where: {
      status: { [Op.in]: LOCKED_PAYROLL_STATUSES },
      fromDate: { [Op.lte]: dateOnly },
      toDate: { [Op.gte]: dateOnly },
    },
  });
}

async function findLockedPeriodForRange(from, to) {
  const { fromDate, toDate } = normalizeRange(from, to);

  return db.PayrollPeriod.findOne({
    where: {
      status: { [Op.in]: LOCKED_PAYROLL_STATUSES },
      fromDate: { [Op.lte]: toDate },
      toDate: { [Op.gte]: fromDate },
    },
  });
}

async function assertDateEditable(date, label = 'дату') {
  const period = await findLockedPeriodForDate(date);
  if (period) {
    throw appError(
      `Нельзя менять ${label}: дата входит в закрытый payroll-период ${period.fromDate} — ${period.toDate}`,
      409,
    );
  }
}

async function assertRangeEditable(from, to, label = 'период') {
  const period = await findLockedPeriodForRange(from, to);
  if (period) {
    throw appError(
      `Нельзя менять ${label}: он пересекается с закрытым payroll-периодом ${period.fromDate} — ${period.toDate}`,
      409,
    );
  }
}

async function calculatePayroll(from, to) {
  const { fromDate, toDate } = normalizeRange(from, to);
  const period = await findExactPeriod(fromDate, toDate);
  const periodSnapshot = period ? parseSnapshot(period.snapshot) : null;

  if (period && period.status !== 'draft' && periodSnapshot) {
    return {
      ...periodSnapshot,
      period: serializePeriod(period),
      locked: true,
      source: 'snapshot',
    };
  }

  const snapshot = await buildPayrollSnapshot(fromDate, toDate);

  return {
    ...snapshot,
    period: serializePeriod(period),
    locked: Boolean(period && LOCKED_PAYROLL_STATUSES.includes(period.status)),
    source: 'live',
  };
}

async function createPeriod(data, account) {
  const { fromDate, toDate } = normalizeRange(data.from, data.to);
  const lockedOverlap = await findLockedPeriodForRange(fromDate, toDate);

  if (lockedOverlap) {
    throw appError(
      `Период пересекается с уже закрытым payroll ${lockedOverlap.fromDate} — ${lockedOverlap.toDate}`,
      409,
    );
  }

  const existing = await findExactPeriod(fromDate, toDate);
  if (existing) {
    throw appError('Payroll-период с такими датами уже создан', 409);
  }

  const snapshot = await buildPayrollSnapshot(fromDate, toDate);
  const period = await db.PayrollPeriod.create({
    fromDate,
    toDate,
    status: 'draft',
    note: data.note ? String(data.note).trim() : null,
    snapshot,
  });

  await recordChange({
    action: 'payroll_period.create',
    entityType: 'payroll_period',
    entityId: period.id,
    account,
    reason: data.note,
    fromDate,
    toDate,
    afterData: { period: serializePeriod(period), totals: snapshot.totals },
  });

  if (nextStatus === 'reviewed') {
    await onboardingService.recordEventSafe(account, 'payroll.reviewed', {
      entityId: period.id,
      entityType: 'payroll_period',
      payload: {
        fromDate: period.fromDate,
        periodId: period.id,
        status: nextStatus,
        toDate: period.toDate,
      },
    });
  }

  return db.PayrollPeriod.findByPk(period.id, { include: getPeriodInclude() });
}

async function recalculatePeriod(id, account, reason) {
  const period = await db.PayrollPeriod.findByPk(id);
  if (!period) throw appError('Payroll-период не найден', 404);
  if (period.status !== 'draft') {
    throw appError('Пересчитать можно только payroll в статусе черновика', 409);
  }

  const before = parseSnapshot(period.snapshot);
  const snapshot = await buildPayrollSnapshot(period.fromDate, period.toDate);
  await period.update({ snapshot });

  await recordChange({
    action: 'payroll_period.recalculate',
    entityType: 'payroll_period',
    entityId: period.id,
    account,
    reason,
    fromDate: period.fromDate,
    toDate: period.toDate,
    beforeData: { totals: before?.totals || null },
    afterData: { totals: snapshot.totals },
  });

  return db.PayrollPeriod.findByPk(period.id, { include: getPeriodInclude() });
}

async function transitionPeriod(id, data, account) {
  const nextStatus = String(data.status || '').trim();
  if (!PAYROLL_STATUSES.includes(nextStatus)) {
    throw appError('Некорректный статус payroll-периода');
  }

  const period = await db.PayrollPeriod.findByPk(id);
  if (!period) throw appError('Payroll-период не найден', 404);

  assertTransitionAllowed(period, nextStatus);
  assertRoleCanTransition(account, nextStatus);

  const before = period.toJSON();
  const payload = {
    status: nextStatus,
    note: data.note !== undefined ? String(data.note || '').trim() : period.note,
  };

  if (nextStatus === 'reviewed') {
    payload.snapshot = await buildPayrollSnapshot(period.fromDate, period.toDate);
    payload.reviewedAt = new Date();
    payload.reviewedByAccountId = account?.id || null;
  }

  if (nextStatus === 'draft') {
    payload.reviewedAt = null;
    payload.reviewedByAccountId = null;
  }

  if (nextStatus === 'approved') {
    payload.approvedAt = new Date();
    payload.approvedByAccountId = account?.id || null;
  }

  if (nextStatus === 'paid') {
    payload.paidAt = new Date();
    payload.paidByAccountId = account?.id || null;
  }

  await period.update(payload);

  await recordChange({
    action: `payroll_period.${nextStatus}`,
    entityType: 'payroll_period',
    entityId: period.id,
    account,
    reason: data.reason || data.note,
    fromDate: period.fromDate,
    toDate: period.toDate,
    beforeData: {
      status: before.status,
      totals: parseSnapshot(before.snapshot)?.totals || null,
    },
    afterData: {
      status: nextStatus,
      totals: parseSnapshot(period.snapshot)?.totals || null,
    },
  });

  return db.PayrollPeriod.findByPk(period.id, { include: getPeriodInclude() });
}

async function listPeriods(query = {}) {
  const where = {};

  if (query.status && query.status !== 'all') where.status = query.status;
  if (query.from || query.to) {
    const fromDate = query.from ? normalizeDateOnly(query.from) : '1900-01-01';
    const toDate = query.to ? normalizeDateOnly(query.to) : '2999-12-31';
    where.fromDate = { [Op.lte]: toDate };
    where.toDate = { [Op.gte]: fromDate };
  }

  const rows = await db.PayrollPeriod.findAll({
    where,
    include: getPeriodInclude(),
    order: [['fromDate', 'DESC']],
  });

  return rows.map((row) => {
    const snapshot = parseSnapshot(row.snapshot);
    return {
      ...serializePeriod(row),
      totals: snapshot?.totals || null,
      generatedAt: snapshot?.generatedAt || null,
    };
  });
}

async function getHistory(query = {}) {
  const where = {};

  if (query.from || query.to) {
    const fromDate = query.from ? normalizeDateOnly(query.from) : '1900-01-01';
    const toDate = query.to ? normalizeDateOnly(query.to) : '2999-12-31';
    where[Op.or] = [
      { date: { [Op.between]: [fromDate, toDate] } },
      {
        fromDate: { [Op.lte]: toDate },
        toDate: { [Op.gte]: fromDate },
      },
    ];
  }

  const rows = await db.FinanceChangeLog.findAll({
    where,
    include: [
      {
        model: db.Account,
        as: 'account',
        attributes: ['id', 'email', 'role', 'staffId'],
        include: [{ model: db.Staff, attributes: ['id', 'name'] }],
      },
    ],
    order: [['createdAt', 'DESC']],
    limit: Math.min(100, Math.max(10, Number(query.limit) || 30)),
  });

  return rows.map((row) => {
    const raw = row.toJSON();
    return {
      ...raw,
      account: serializeAccount(raw.account),
    };
  });
}

function buildPayrollExport(snapshot) {
  const adminRows = (snapshot.admins || []).map((admin) => ({
    Сотрудник: admin.name,
    Смен: admin.totalShifts,
    Часов: admin.totalHours,
    'База, ₽': admin.basePay,
    'Премии и корректировки, ₽': admin.bonusPay,
    'Итого, ₽': admin.totalPay,
  }));

  const shiftRows = (snapshot.shifts || []).map((shift) => ({
    Дата: shift.date,
    Статус: shift.isDraft ? 'Черновик' : 'Заполнено',
    Администратор: shift.adminName || '',
    Часов: shift.hours,
    'Выручка дня/смены, ₽': shift.dailyRevenue,
    'База, ₽': shift.basePay,
    'Премия, ₽': shift.calculatedBonus || 0,
    'Корректировка, ₽': shift.manualAdjustment || 0,
    'Итого, ₽': shift.total,
    Комментарий: shift.comment || '',
  }));

  const totalsRows = [
    {
      Показатель: 'Период',
      Значение: `${snapshot.fromDate} — ${snapshot.toDate}`,
    },
    {
      Показатель: 'Смен',
      Значение: snapshot.totals?.totalShifts || 0,
    },
    {
      Показатель: 'Часов',
      Значение: snapshot.totals?.totalHours || 0,
    },
    {
      Показатель: 'Итого начислено',
      Значение: snapshot.totals?.totalPay || 0,
    },
  ];

  return buildWorkbookBuffer([
    { name: 'Итоги', rows: totalsRows },
    { name: 'По сотрудникам', rows: adminRows },
    { name: 'Смены', rows: shiftRows },
  ]);
}

async function exportPayroll(query, account) {
  let snapshot;
  let period = null;

  if (query.periodId) {
    period = await db.PayrollPeriod.findByPk(query.periodId);
    if (!period) throw appError('Payroll-период не найден', 404);
    snapshot = parseSnapshot(period.snapshot);
  } else {
    snapshot = await buildPayrollSnapshot(query.from, query.to);
  }

  if (!snapshot) {
    throw appError('У payroll-периода нет сохраненного расчета', 409);
  }

  await recordChange({
    action: 'payroll.export',
    entityType: 'payroll_period',
    entityId: period?.id || null,
    account,
    fromDate: snapshot.fromDate,
    toDate: snapshot.toDate,
    afterData: { totals: snapshot.totals },
  });

  await onboardingService.recordEventSafe(account, 'report.exported', {
    entityId: period?.id || null,
    entityType: 'payroll_period',
    payload: {
      fromDate: snapshot.fromDate,
      report: 'payroll',
      toDate: snapshot.toDate,
    },
  });

  return {
    buffer: buildPayrollExport(snapshot),
    filename: `payroll-${snapshot.fromDate}-${snapshot.toDate}.xlsx`,
  };
}

module.exports = {
  LOCKED_PAYROLL_STATUSES,
  assertDateEditable,
  assertRangeEditable,
  buildPayrollSnapshot,
  calculatePayroll,
  createPeriod,
  exportPayroll,
  getHistory,
  listPeriods,
  recordChange,
  recalculatePeriod,
  serializePeriod,
  transitionPeriod,
};
