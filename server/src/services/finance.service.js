// src/services/finance.service.js
const db = require('../../models');

class FinanceService {
  async getCategory(itemName, dbRulesMap) {
    const name = String(itemName).toLowerCase().trim();

    if (dbRulesMap[name]) return dbRulesMap[name];

    if (
      [
        'bombbar',
        'shock',
        'вода',
        'чиа',
        'cola',
        'кофе',
        'чай',
        'смузи',
        'батончик',
      ].some((kw) => name.includes(kw))
    )
      return 'Бар / Кафе';
    if (
      ['овергрип', 'намотка', 'мяч', 'купить ракетку'].some((kw) =>
        name.includes(kw),
      )
    )
      return 'Магазин (Товары)';
    if (
      ['вип', 'vip', 'ракетка шефа', 'тубус', 'аренда ракетки', 'люкс'].some(
        (kw) => name.includes(kw),
      )
    )
      return 'Прокат инвентаря / VIP';
    if (name.includes('турнир')) return 'Турниры';

    return 'Аренда кортов';
  }

  async buildFinanceRecords() {
    const records = [];

    const rulesList = await db.CatalogRule.findAll();
    const rulesMap = {};
    rulesList.forEach((r) => {
      rulesMap[r.itemName.toLowerCase()] = r.category;
    });

    const manualFinances = await db.Finance.findAll().catch(() => []);
    manualFinances.forEach((f) => {
      records.push({
        id: `manual-${f.id}`,
        date: f.date,
        category: f.category,
        amount: f.amount,
        type: f.type,
        comment: f.comment || 'Ручная операция',
        source: 'manual',
      });
      if (f.type === 'income' && f.category === 'lunda_courts') {
        records.push({
          id: `fee-lun-${f.id}`,
          date: f.date,
          category: 'Комиссия Лунда',
          amount: (Number(f.amount) * 0.015).toString(),
          type: 'expense',
          comment: `1.5% с Лунды`,
          source: 'fee',
        });
      }
      if (f.type === 'income' && f.category === 'aladdin') {
        records.push({
          id: `fee-ala-${f.id}`,
          date: f.date,
          category: 'Комиссия Алладин',
          amount: (Number(f.amount) * 0.17).toString(),
          type: 'expense',
          comment: `17% с Алладин`,
          source: 'fee',
        });
      }
    });

    const receipts = await db.Receipt.findAll();
    const items = await db.ReceiptItem.findAll();
    const salesByDate = {};

    for (const receipt of receipts) {
      const receiptItems = items.filter((i) => i.receiptId === receipt.id);
      const dateStr = new Date(receipt.dateTime).toISOString().split('T')[0];
      const isPayback = receipt.type === 'PAYBACK';
      const multiplier = isPayback ? -1 : 1;

      if (!salesByDate[dateStr])
        salesByDate[dateStr] = { revenue: 0, items: [] };

      if (Number(receipt.cashless) > 0) {
        records.push({
          id: `fee-acq-${receipt.id}`,
          date: dateStr,
          category: 'Эквайринг',
          amount: (Number(receipt.cashless) * 0.01).toString(),
          type: isPayback ? 'income' : 'expense',
          comment: `1% от безнала`,
          source: 'fee',
          rawCashless: receipt.cashless,
        });
      }

      for (const item of receiptItems) {
        const amount = Number(item.sum);
        if (amount === 0) continue;
        const category = await this.getCategory(item.name, rulesMap);

        salesByDate[dateStr].revenue += amount * multiplier;
        salesByDate[dateStr].items.push({
          name: item.name,
          category,
          sum: amount * multiplier,
          qty: Number(item.quantity) * multiplier,
        });

        records.push({
          id: `evotor-${item.id}`,
          date: dateStr,
          category: category,
          amount: amount.toString(),
          type: isPayback ? 'expense' : 'income',
          comment: `${item.name} (${item.quantity} шт.)`,
          source: 'evotor',
        });
      }
    }

    const shifts = await db.Shift.findAll();
    shifts.forEach((shift) => {
      if (!shift.adminName || !shift.hours) return;

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

      todaySales.items.forEach((item) => {
        if (item.category === 'Бар / Кафе') foodSales += item.sum;
        if (
          item.category === 'Магазин (Товары)' &&
          !item.name.toLowerCase().includes('аренда')
        )
          storeSales += item.sum;
        if (
          item.category === 'Прокат инвентаря / VIP' ||
          item.category === 'Доп. услуги'
        ) {
          if (
            item.name.toLowerCase().includes('vip') ||
            item.name.toLowerCase().includes('вип')
          )
            vipSales += item.sum;
          if (item.name.toLowerCase().includes('ракетка шефа')) {
            chefSum += item.sum;
            chefQty += item.qty;
          }
          if (item.name.toLowerCase().includes('тубус')) {
            tubesSum += item.sum;
            tubesQty += item.qty;
          }
        }
      });

      if (foodSales > 4000) shiftBonus += foodSales * 0.05;
      if (storeSales > 3000) shiftBonus += storeSales * 0.03;
      if (vipSales > 0) shiftBonus += vipSales * 0.1;
      if (chefQty > 8) shiftBonus += chefSum * 0.05;
      if (tubesQty > 5) shiftBonus += tubesSum * 0.1;

      const shiftBasePay =
        Math.min(hrs, 12) * 250 + Math.max(0, hrs - 12) * 300;
      const totalPay =
        shiftBasePay + shiftBonus + (Number(shift.manualAdjustment) || 0);

      if (totalPay > 0) {
        records.push({
          id: `payroll-${shift.id}`,
          date: shift.date,
          category: 'payroll',
          amount: totalPay.toString(),
          type: 'expense',
          comment: `ЗП: ${shift.adminName} (${hrs}ч)`,
          source: 'system',
        });
      }
    });

    records.sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
    );
    return records;
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
