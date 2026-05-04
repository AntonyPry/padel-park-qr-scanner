// src/services/finance.service.js
const { Op } = require('sequelize');
const db = require('../../models');

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

    const categories = await db.Category.findAll();
    const catMap = {};
    const catById = {};
    categories.forEach((c) => {
      catMap[c.name.toLowerCase()] = c;
      catById[c.id] = c;
    });

    const rules = await db.CatalogRule.findAll();
    const rulesMap = {};
    rules.forEach((r) => {
      rulesMap[r.itemName.toLowerCase()] = r.category;
    });

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
      where: dateFilter,
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
      const rCashless = Math.abs(Number(receipt.cashless)) * multiplier;
      const rCash = Math.abs(Number(receipt.cash)) * multiplier;

      if (rCashless !== 0) {
        const acqFee = Math.abs(Number(receipt.cashless)) * 0.01 * multiplier;
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
      }
    }

    // --- ЗП АДМИНОВ (АВТОРАСЧЕТ) ---
    const shifts = await db.Shift.findAll({ where: dateFilter });
    shifts.forEach((shift) => {
      if (!shift.adminName || !shift.hours) return;
      const hrs = Number(shift.hours);
      const todaySales = salesByDate[shift.date] || { revenue: 0, items: [] };
      let shiftBonus = 0;

      todaySales.items.forEach((item) => {
        if (item.category === 'Бар / Кафе') shiftBonus += item.sum * 0.05;
      });

      const base = Math.min(hrs, 12) * 250 + Math.max(0, hrs - 12) * 300;
      const total = base + shiftBonus + (Number(shift.manualAdjustment) || 0);

      if (total > 0) {
        // Передаем дату: shift.date
        addRecord(
          'OPEX',
          'ЗП Админов (Авторасчет)',
          total,
          'expense',
          `Смена ${shift.adminName}`,
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
    const shiftsDb = await db.Shift.findAll();
    const receipts = await db.Receipt.findAll({
      include: [{ model: db.ReceiptItem, as: 'items' }],
    });

    const rulesList = await db.CatalogRule.findAll();
    const rulesMap = {};
    rulesList.forEach((r) => {
      rulesMap[r.itemName.toLowerCase()] = r.category;
    });

    const salesByDate = {};
    for (const r of receipts) {
      const dStr = new Date(r.dateTime).toISOString().split('T')[0];
      if (from && dStr < from) continue;
      if (to && dStr > to) continue;

      if (!salesByDate[dStr]) salesByDate[dStr] = { revenue: 0, items: [] };

      const multiplier = r.type === 'PAYBACK' ? -1 : 1;
      for (const item of r.items) {
        const category = await this.getCategory(item.name, rulesMap);
        const sum = Number(item.sum) * multiplier;
        const qty = Number(item.quantity) * multiplier;
        salesByDate[dStr].revenue += sum;
        salesByDate[dStr].items.push({ name: item.name, category, sum, qty });
      }
    }

    const validShifts = shiftsDb.filter((s) => {
      if (from && s.date < from) return false;
      if (to && s.date > to) return false;
      return true;
    });

    const payrollByAdmin = {};
    const shiftsHistory = [];
    const processedDates = new Set();

    validShifts.forEach((shift) => {
      processedDates.add(shift.date);
      const admin = shift.adminName;
      const hrs = Number(shift.hours);
      const todaySales = salesByDate[shift.date] || { revenue: 0, items: [] };

      let shiftBonus = 0;
      let foodSales = 0,
        storeSales = 0,
        vipSales = 0,
        chefSum = 0,
        chefQty = 0,
        tubesSum = 0,
        tubesQty = 0;

      const detailedItems = todaySales.items.map((item) => {
        let bucket = '';
        if (item.category === 'Бар / Кафе') {
          foodSales += item.sum;
          bucket = 'food';
        }
        if (
          item.category === 'Магазин (Товары)' &&
          !item.name.toLowerCase().includes('аренда')
        ) {
          storeSales += item.sum;
          bucket = 'store';
        }
        if (
          item.category === 'Прокат инвентаря / VIP' ||
          item.category === 'Доп. услуги'
        ) {
          if (
            item.name.toLowerCase().includes('vip') ||
            item.name.toLowerCase().includes('вип')
          ) {
            vipSales += item.sum;
            bucket = 'vip';
          }
          if (item.name.toLowerCase().includes('ракетка шефа')) {
            chefSum += item.sum;
            chefQty += item.qty;
            bucket = 'chef';
          }
          if (item.name.toLowerCase().includes('тубус')) {
            tubesSum += item.sum;
            tubesQty += item.qty;
            bucket = 'tube';
          }
        }
        return { ...item, bucket };
      });

      if (foodSales > 4000) shiftBonus += foodSales * 0.05;
      if (storeSales > 3000) shiftBonus += storeSales * 0.03;
      if (vipSales > 0) shiftBonus += vipSales * 0.1;
      if (chefQty > 8) shiftBonus += chefSum * 0.05;
      if (tubesQty > 5) shiftBonus += tubesSum * 0.1;

      const shiftBasePay =
        Math.min(hrs, 12) * 250 + Math.max(0, hrs - 12) * 300;
      const manualAdj = Number(shift.manualAdjustment) || 0;
      const totalPay = shiftBasePay + shiftBonus + manualAdj;

      if (admin) {
        if (!payrollByAdmin[admin])
          payrollByAdmin[admin] = {
            name: admin,
            totalShifts: 0,
            totalHours: 0,
            basePay: 0,
            bonusPay: 0,
            totalPay: 0,
          };
        payrollByAdmin[admin].totalShifts += 1;
        payrollByAdmin[admin].totalHours += hrs;
        payrollByAdmin[admin].basePay += shiftBasePay;
        payrollByAdmin[admin].bonusPay += shiftBonus + manualAdj;
        payrollByAdmin[admin].totalPay += totalPay;
      }

      shiftsHistory.push({
        id: shift.id,
        isDraft: false,
        date: shift.date,
        adminName: admin,
        hours: hrs,
        dailyRevenue: todaySales.revenue,
        basePay: shiftBasePay,
        bonus: shiftBonus + manualAdj,
        total: totalPay,
        items: detailedItems,
      });
    });

    Object.keys(salesByDate).forEach((date) => {
      if (!processedDates.has(date)) {
        const todaySales = salesByDate[date];
        const detailedItems = todaySales.items.map((item) => {
          let bucket = '';
          if (item.category === 'Бар / Кафе') bucket = 'food';
          if (item.category === 'Магазин (Товары)') bucket = 'store';
          if (item.name.toLowerCase().includes('vip')) bucket = 'vip';
          if (item.name.toLowerCase().includes('ракетка шефа')) bucket = 'chef';
          if (item.name.toLowerCase().includes('тубус')) bucket = 'tube';
          return { ...item, bucket };
        });

        shiftsHistory.push({
          id: `draft-${date}`,
          isDraft: true,
          date: date,
          adminName: null,
          hours: 0,
          dailyRevenue: todaySales.revenue,
          basePay: 0,
          bonus: 0,
          total: 0,
          items: detailedItems,
        });
      }
    });

    shiftsHistory.sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
    );
    return { admins: Object.values(payrollByAdmin), shifts: shiftsHistory };
  }

  async createManualRecord(data) {
    return await db.Finance.create(data);
  }
}

module.exports = new FinanceService();
