// src/services/finance.service.js
const { Op } = require('sequelize');
const xlsx = require('xlsx');
const db = require('../../models');
const catalogService = require('./catalog.service');
const motivationService = require('./motivation.service');
const onboardingService = require('./onboarding.service');
const payrollService = require('./payroll.service');
const { FINANCE_TYPES } = require('../constants/catalog');
const { resolveStoredReceiptPayments } = require('../utils/payments');

function appError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function normalizeDateOnly(value) {
  const date = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw appError('Укажите дату операции в формате YYYY-MM-DD');
  }

  return date;
}

function normalizeFinanceType(type) {
  if (!FINANCE_TYPES.includes(type)) {
    throw appError('Некорректный тип финансовой операции');
  }

  return type;
}

function assertTrainingScopeMatches(record, marker) {
  const raw = record?.toJSON ? record.toJSON() : record;
  if (!raw) return;
  if (Boolean(raw.isTraining) !== Boolean(marker?.isTraining)) {
    throw appError('Финансовая запись не соответствует текущему режиму данных', 409);
  }
  if (
    marker?.isTraining &&
    (Number(raw.trainingAccountId) !== Number(marker.trainingAccountId) ||
      raw.trainingRole !== marker.trainingRole)
  ) {
    throw appError('Финансовая запись не соответствует текущему режиму обучения', 409);
  }
}

class FinanceService {
  // 1. Определение категории
  async getCategoryName(itemName, rulesMap) {
    const name = String(itemName).toLowerCase().trim();

    // Если товар есть в базе правил — отдаем его категорию
    if (rulesMap[name]) return rulesMap[name];

    // Если правила нет, отправляем в дефолтную категорию
    return 'Неразобранное';
  }

  // 2. Генератор P&L отчета
  async getFinanceReport(from, to) {
    const dateFilter = {};
    const dateTimeFilter = {};

    if (from || to) {
      dateFilter.date = {};
      dateTimeFilter.dateTime = {};
      if (from) {
        dateFilter.date[Op.gte] = from;
        dateTimeFilter.dateTime[Op.gte] = new Date(from);
      }
      if (to) {
        dateFilter.date[Op.lte] = to;
        const toDate = new Date(to);
        toDate.setHours(23, 59, 59, 999);
        dateTimeFilter.dateTime[Op.lte] = toDate;
      }
    }

    const categories = await catalogService.getCategories({ status: 'active' });
    const catMap = {};
    const catById = {};
    categories.forEach((c) => {
      catMap[c.name.toLowerCase()] = c;
      catById[c.id] = c;
    });

    const rules = await catalogService.getRules({ status: 'active' });
    const rulesMap = {};
    rules.forEach((r) => {
      rulesMap[String(r.itemName).toLowerCase().trim()] = r.category;
    });
    const motivationRules = await motivationService.getRulesMap();
    const motivationBonusRules = await motivationService.getBonusRules();

    const report = {
      summary: {
        revenue: 0,
        posRev: 0,
        extTotal: 0,
        cogsTotal: 0,
        gross: 0,
        opex: 0,
        net: 0,
        margin: 0,
        cashless: 0,
        cash: 0,
      },
      sections: {
        REVENUE_POS: {},
        REVENUE_EXT: {},
        COGS: {},
        FEES: {},
        OPEX: {},
      },
      details: [],
      reconciliation: {
        receiptCount: 0,
        receiptsTotal: 0,
        receiptItemsTotal: 0,
        difference: 0,
      },
    };

    // --- ОБНОВЛЕННЫЙ ДОБАВЛЯТОР (принимает recordDate) ---
    const addRecord = (
      group,
      categoryName,
      amount,
      type,
      comment,
      source,
      recordDate,
    ) => {
      const val = Number(amount);
      if (val === 0) return;

      const catInfo = catMap[categoryName.toLowerCase()];
      let pathNames = [categoryName];
      let targetGroup = group;

      if (catInfo) {
        pathNames = [];
        let current = catInfo;
        const seenIds = new Set();

        while (current) {
          if (seenIds.has(current.id)) break;
          seenIds.add(current.id);
          pathNames.unshift(current.name);

          if (current.parentId && catById[current.parentId]) {
            current = catById[current.parentId];
          } else {
            targetGroup = current.group;
            break;
          }
        }
      }

      if (!report.sections[targetGroup]) report.sections[targetGroup] = {};

      let currentLevel = report.sections[targetGroup];
      for (let i = 0; i < pathNames.length; i++) {
        const pName = pathNames[i];
        if (!currentLevel[pName])
          currentLevel[pName] = { sum: 0, subItems: {} };
        currentLevel[pName].sum += val;
        if (i < pathNames.length - 1)
          currentLevel = currentLevel[pName].subItems;
      }

      if (targetGroup === 'REVENUE_POS') {
        report.summary.revenue += val;
        report.summary.posRev += val;
      } else if (targetGroup === 'REVENUE_EXT') {
        report.summary.revenue += val;
        report.summary.extTotal += val;
      } else if (targetGroup === 'COGS') {
        report.summary.cogsTotal += val;
      } else if (targetGroup === 'FEES') {
        report.summary.cogsTotal += val;
      } else if (targetGroup === 'OPEX') {
        report.summary.opex += val;
      }

      // СОХРАНЯЕМ ПУТЬ И ДАТУ В ДЕТАЛИЗАЦИЮ
      report.details.push({
        group: targetGroup,
        category: categoryName,
        path: pathNames,
        amount: val,
        type,
        comment,
        source,
        date: recordDate,
      });
    };

    // --- ОБРАБОТКА РУЧНЫХ ОПЕРАЦИЙ ---
    const manualFinances = await db.Finance.findAll({
      where: { ...dateFilter, isTraining: false },
    }).catch(() => []);
    manualFinances.forEach((f) => {
      const catInfo = catMap[f.category.toLowerCase()] || {
        group: f.type === 'income' ? 'REVENUE_EXT' : 'OPEX',
        commissionPercent: 0,
      };

      // Передаем дату: f.date
      addRecord(
        catInfo.group,
        f.category,
        f.amount,
        f.type,
        f.comment,
        'manual',
        f.date,
      );

      const commPercent = Number(catInfo.commissionPercent);
      if (f.type === 'income' && commPercent > 0) {
        const feeSum = Number(f.amount) * (commPercent / 100);
        addRecord(
          'FEES',
          `Комиссия: ${f.category} (${commPercent}%)`,
          feeSum,
          'expense',
          'Авторасчет комиссии',
          'fee',
          f.date,
        );
      }
    });

    // --- ОБРАБОТКА ЧЕКОВ ЭВОТОР ---
    const receipts = await db.Receipt.findAll({
      where: dateTimeFilter,
      include: [{ model: db.ReceiptItem, as: 'items' }],
    });
    const salesByDate = {};

    for (const receipt of receipts) {
      const isPayback = receipt.type === 'PAYBACK';
      const multiplier = isPayback ? -1 : 1;
      const dStr = new Date(receipt.dateTime).toISOString().split('T')[0];
      if (!salesByDate[dStr]) salesByDate[dStr] = { revenue: 0, items: [] };

      // Берем сумму по модулю и применяем свой знак
      const { cash: rCash, cashless: rCashless, total: rTotal } =
        resolveStoredReceiptPayments(receipt);
      report.reconciliation.receiptCount += 1;
      report.reconciliation.receiptsTotal += rTotal;

      if (rCashless !== 0) {
        const acqFee = Math.abs(rCashless) * 0.01 * multiplier;
        addRecord(
          'FEES',
          'Эквайринг (1%)',
          acqFee, // Передаем отрицательную комиссию, если это возврат
          isPayback ? 'income' : 'expense',
          'Безнал кассы',
          'fee',
          receipt.dateTime,
        );
        report.summary.cashless += rCashless;
      }
      if (rCash !== 0) {
        report.summary.cash += rCash;
      }

      let itemsSum = 0;

      for (const item of receipt.items) {
        // 🔥 ВОТ ГЛАВНОЕ ИСПРАВЛЕНИЕ:
        // 1. Берем сумму товара по модулю (Math.abs), чтобы снять возможные минусы из БД.
        // 2. Умножаем на наш multiplier (-1 для возвратов, 1 для продаж).
        const rawAmount = Number(
          item.sumPrice !== undefined && item.sumPrice !== null
            ? item.sumPrice
            : item.sum,
        );
        const finalAmount = Math.abs(rawAmount) * multiplier;

        if (finalAmount === 0) continue;

        itemsSum += Math.abs(rawAmount);
        report.reconciliation.receiptItemsTotal += finalAmount;

        const catName = await this.getCategoryName(item.name, rulesMap);
        addRecord(
          'REVENUE_POS',
          catName,
          finalAmount, // Передаем правильную сумму со знаком
          isPayback ? 'expense' : 'income',
          `${item.name} (${item.quantity} шт)`,
          'evotor',
          receipt.dateTime,
        );

        salesByDate[dStr].revenue += finalAmount;
        salesByDate[dStr].items.push({
          name: item.name,
          category: catName,
          sum: finalAmount,
          qty: Number(item.quantity) * multiplier,
        });
      }

      // Защита от пустых чеков тоже использует модуль
      const receiptTotal = Math.abs(Number(receipt.totalAmount) || 0);
      const diff = receiptTotal - itemsSum;

      if (diff > 1) {
        const finalDiffAmount = diff * multiplier;

        addRecord(
          'REVENUE_POS',
          'Неразобранное',
          finalDiffAmount,
          isPayback ? 'expense' : 'income',
          isPayback
            ? 'Возврат (позиции отсутствуют в БД)'
            : 'Продажа (позиции отсутствуют в БД)',
          'evotor',
          receipt.dateTime,
        );

        salesByDate[dStr].revenue += finalDiffAmount;
        salesByDate[dStr].items.push({
          name: 'Неизвестная позиция',
          category: 'Неразобранное',
          sum: finalDiffAmount,
          qty: 1 * multiplier,
        });
        report.reconciliation.receiptItemsTotal += finalDiffAmount;
      }
    }

    report.reconciliation.difference =
      report.reconciliation.receiptsTotal -
      report.reconciliation.receiptItemsTotal;

    // --- ЗП АДМИНОВ (АВТОРАСЧЕТ) ---
    const shifts = await db.Shift.findAll({
      where: {
        ...dateFilter,
        archivedAt: null,
      },
      include: [{ model: db.Staff, attributes: ['id', 'name'] }],
    });
    shifts.forEach((shift) => {
      const adminName = shift.Staff?.name || shift.adminName;
      if (!adminName || !shift.hours) return;
      const hrs = Number(shift.hours);
      if (!Number.isFinite(hrs) || hrs <= 0) return;
      const todaySales = salesByDate[shift.date] || { revenue: 0, items: [] };
      let shiftBonus = 0;

      shiftBonus = motivationService.calculateShiftBonus(
        todaySales.items,
        motivationBonusRules,
      ).total;

      const base = motivationService.calculateBasePay(hrs, motivationRules);
      const total = base + shiftBonus + (Number(shift.manualAdjustment) || 0);

      if (total > 0) {
        // Передаем дату: shift.date
        addRecord(
          'OPEX',
          'ЗП Админов (Авторасчет)',
          total,
          'expense',
          `Смена ${adminName}`,
          'system',
          shift.date,
        );
      }
    });

    report.summary.gross = report.summary.revenue - report.summary.cogsTotal;
    report.summary.net = report.summary.gross - report.summary.opex;
    report.summary.margin =
      report.summary.revenue > 0
        ? (report.summary.net / report.summary.revenue) * 100
        : 0;

    const formatTree = (obj) => {
      return Object.entries(obj)
        .map(([name, data]) => ({
          name,
          sum: data.sum,
          subItems: formatTree(data.subItems),
        }))
        .sort((a, b) => b.sum - a.sum);
    };

    Object.keys(report.sections).forEach((key) => {
      report.sections[key] = formatTree(report.sections[key]);
    });

    return report;
  }

  async calculatePayroll(from, to) {
    return payrollService.calculatePayroll(from, to);
  }

  async createManualRecord(data, account) {
    const type = normalizeFinanceType(data.type);
    const amount = Number(data.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw appError('Сумма операции должна быть положительным числом');
    }

    const categoryName = String(data.category || '').trim();
    if (!categoryName) throw appError('Категория операции обязательна');

    const category = await db.Category.findOne({
      where: {
        name: categoryName,
        type,
        isActive: true,
      },
    });

    if (!category) {
      throw appError('Категория с таким типом операции не найдена', 404);
    }

    const date = normalizeDateOnly(data.date);
    await payrollService.assertDateEditable(date, 'ручную финансовую операцию');
    const trainingMarker = await onboardingService.getTrainingDataMarker(account);

    const record = await db.Finance.create({
      date,
      category: category.name,
      amount,
      type,
      comment: data.comment ? String(data.comment).trim() : null,
      createdByAccountId: account?.id || null,
      ...trainingMarker,
    });

    await payrollService.recordChange({
      action: 'finance_manual.create',
      entityType: 'finance',
      entityId: record.id,
      account,
      date,
      reason: data.comment,
      afterData: record.toJSON(),
    });

    await onboardingService.recordEventSafe(account, 'finance.record_created', {
      entityId: record.id,
      entityType: 'finance',
      payload: {
        amount: record.amount,
        category: record.category,
        date: record.date,
        type: record.type,
      },
    });

    return record;
  }

  async createLinkedExpenseRecord(data, account, options = {}) {
    const amount = Number(data.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw appError('Сумма расхода должна быть положительным числом');
    }

    const category = String(data.category || '').trim();
    if (!category) throw appError('Категория расхода обязательна');

    const date = normalizeDateOnly(data.date);
    await payrollService.assertDateEditable(date, 'кассовый расход');
    const trainingMarker =
      options.trainingMarker ||
      (await onboardingService.getTrainingDataMarker(account));
    const record = await db.Finance.create(
      {
        amount: Number(amount.toFixed(2)),
        category,
        comment: data.comment ? String(data.comment).trim() : null,
        createdByAccountId: account?.id || null,
        date,
        type: 'expense',
        ...trainingMarker,
      },
      options.transaction ? { transaction: options.transaction } : undefined,
    );

    await payrollService.recordChange({
      action: options.auditAction || 'shift_cash_expense.finance_created',
      entityType: 'finance',
      entityId: record.id,
      account,
      date,
      reason: data.comment,
      afterData: record.toJSON(),
      transaction: options.transaction,
    });

    return { record };
  }

  async updateLinkedExpenseRecord(financeId, data, account, options = {}) {
    const amount = Number(data.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw appError('Сумма расхода должна быть положительным числом');
    }
    const category = String(data.category || '').trim();
    if (!category) throw appError('Категория расхода обязательна');

    const transaction = options.transaction;
    const record = await db.Finance.findByPk(financeId, {
      transaction,
      lock: transaction?.LOCK?.UPDATE,
    });
    if (!record || record.type !== 'expense') {
      throw appError('Связанный финансовый расход не найден', 404);
    }
    const trainingMarker =
      options.trainingMarker ||
      (await onboardingService.getTrainingDataMarker(account));
    assertTrainingScopeMatches(record, trainingMarker);

    const date = normalizeDateOnly(data.date || record.date);
    await payrollService.assertDateEditable(record.date, 'кассовый расход');
    if (date !== record.date) {
      await payrollService.assertDateEditable(date, 'кассовый расход');
    }
    const beforeData = record.toJSON();
    await record.update(
      {
        amount: Number(amount.toFixed(2)),
        category,
        comment: data.comment ? String(data.comment).trim() : null,
        date,
      },
      transaction ? { transaction } : undefined,
    );
    await payrollService.recordChange({
      action: options.auditAction || 'shift_cash_expense.finance_updated',
      entityType: 'finance',
      entityId: record.id,
      account,
      date,
      reason: data.comment,
      beforeData,
      afterData: record.toJSON(),
      transaction,
    });

    return { record };
  }

  async deleteLinkedExpenseRecord(financeId, account, options = {}) {
    if (!financeId) return null;
    const transaction = options.transaction;
    const record = await db.Finance.findByPk(financeId, {
      transaction,
      lock: transaction?.LOCK?.UPDATE,
    });
    if (!record) return null;
    const trainingMarker =
      options.trainingMarker ||
      (await onboardingService.getTrainingDataMarker(account));
    assertTrainingScopeMatches(record, trainingMarker);
    await payrollService.assertDateEditable(record.date, 'отмену кассового расхода');

    const beforeData = record.toJSON();
    await record.destroy(transaction ? { transaction } : undefined);
    await payrollService.recordChange({
      action: options.auditAction || 'shift_cash_expense.finance_deleted',
      entityType: 'finance',
      entityId: record.id,
      account,
      date: beforeData.date,
      reason: options.reason,
      beforeData,
      transaction,
    });
    return beforeData;
  }

  buildFinanceExport(report, from, to) {
    const summaryRows = Object.entries(report.summary).map(([key, value]) => ({
      Показатель: key,
      Значение: value,
    }));

    summaryRows.push(
      {
        Показатель: 'Период',
        Значение: `${from || '...'} — ${to || '...'}`,
      },
      {
        Показатель: 'Чеков Эвотор',
        Значение: report.reconciliation.receiptCount,
      },
      {
        Показатель: 'Расхождение чеков и позиций',
        Значение: report.reconciliation.difference,
      },
    );

    const detailRows = report.details.map((detail) => ({
      Дата: detail.date,
      Группа: detail.group,
      Категория: detail.category,
      Путь: detail.path?.join(' / ') || detail.category,
      Тип: detail.type,
      Источник: detail.source,
      Сумма: detail.amount,
      Комментарий: detail.comment || '',
    }));

    const workbook = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(
      workbook,
      xlsx.utils.json_to_sheet(summaryRows),
      'Итоги',
    );
    xlsx.utils.book_append_sheet(
      workbook,
      xlsx.utils.json_to_sheet(detailRows),
      'Операции',
    );

    return xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  }

  async exportFinanceReport(from, to, account) {
    const report = await this.getFinanceReport(from, to);

    await payrollService.recordChange({
      action: 'finance_report.export',
      entityType: 'finance_report',
      account,
      fromDate: from || null,
      toDate: to || null,
      afterData: {
        summary: report.summary,
        reconciliation: report.reconciliation,
      },
    });

    await onboardingService.recordEventSafe(account, 'report.exported', {
      entityType: 'finance_report',
      payload: {
        fromDate: from || null,
        report: 'finance',
        toDate: to || null,
      },
    });

    return {
      buffer: this.buildFinanceExport(report, from, to),
      filename: `pnl-${from || 'start'}-${to || 'end'}.xlsx`,
    };
  }
}

module.exports = new FinanceService();
