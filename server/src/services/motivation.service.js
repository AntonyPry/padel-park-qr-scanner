const db = require('../../models');
const { DEFAULT_MOTIVATION_RULES } = require('../constants/motivation-rules');

const DEFAULT_BASE_RULES = DEFAULT_MOTIVATION_RULES.filter(
  (rule) => rule.group === 'base',
);
const THRESHOLD_TYPES = new Set(['none', 'revenue', 'quantity']);

function normalizeReceiptPaymentSource(value) {
  const source = String(value || '').trim().toUpperCase();
  if (['CASH', 'PAY_CASH', 'TYPE_CASH', '0'].includes(source)) return 'cash';
  if (
    [
      'CARD',
      'CASHLESS',
      'ELECTRON',
      'ELECTRONIC',
      'PAY_CARD',
      'PAY_BY_CREDIT',
      'TYPE_CARD',
      '1',
    ].includes(source)
  ) {
    return 'cashless';
  }
  return 'unknown';
}

function normalizeRule(rule) {
  const raw = rule.toJSON ? rule.toJSON() : rule;
  return {
    ...raw,
    value: Number(raw.value),
  };
}

function defaultsMap() {
  return DEFAULT_BASE_RULES.reduce((acc, rule) => {
    acc[rule.key] = Number(rule.value);
    return acc;
  }, {});
}

async function ensureDefaultRules() {
  for (const rule of DEFAULT_BASE_RULES) {
    await db.MotivationRule.findOrCreate({
      where: { key: rule.key },
      defaults: {
        ...rule,
        isActive: true,
      },
    });
  }
}

async function getRules() {
  await ensureDefaultRules();

  const rules = await db.MotivationRule.findAll({
    where: { group: 'base' },
    order: [
      ['sortOrder', 'ASC'],
      ['id', 'ASC'],
    ],
  });

  return rules.map(normalizeRule);
}

async function getRulesMap() {
  await ensureDefaultRules();

  const rules = await db.MotivationRule.findAll({
    where: { group: 'base' },
  });

  return rules.reduce((acc, rule) => {
    if (rule.isActive) acc[rule.key] = Number(rule.value);
    return acc;
  }, defaultsMap());
}

async function updateRule(key, data) {
  const rule = await db.MotivationRule.findOne({
    where: { key, group: 'base' },
  });
  if (!rule) {
    const error = new Error('Правило мотивации не найдено');
    error.statusCode = 404;
    throw error;
  }

  const value = Number(data.value);
  if (!Number.isFinite(value) || value < 0) {
    const error = new Error('Значение правила должно быть неотрицательным числом');
    error.statusCode = 400;
    throw error;
  }

  await rule.update({ value });
  return normalizeRule(rule);
}

function normalizeCategory(category) {
  const raw = category.toJSON ? category.toJSON() : category;
  return {
    id: raw.id,
    name: raw.name,
    type: raw.type,
    group: raw.group,
    parentId: raw.parentId,
  };
}

function normalizeBonusRule(rule) {
  const raw = rule.toJSON ? rule.toJSON() : rule;
  const categories = (raw.categories || []).map(normalizeCategory);

  return {
    ...raw,
    bonusPercent: Number(raw.bonusPercent),
    thresholdValue: Number(raw.thresholdValue),
    categories,
    categoryIds: categories.map((category) => category.id),
  };
}

async function getAvailableCategories() {
  const categories = await db.Category.findAll({
    where: {
      isActive: true,
      type: 'income',
    },
    order: [['name', 'ASC']],
  });

  return categories.map(normalizeCategory);
}

async function getBonusRules() {
  const rules = await db.MotivationBonusRule.findAll({
    include: [
      {
        model: db.Category,
        as: 'categories',
        through: { attributes: [] },
      },
    ],
    order: [
      ['sortOrder', 'ASC'],
      ['id', 'ASC'],
    ],
  });

  return rules.map(normalizeBonusRule);
}

function validationError(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function normalizeBonusRulePayload(data) {
  const name = String(data.name || '').trim();
  if (!name) throw validationError('Название правила обязательно');

  const bonusPercent = Number(data.bonusPercent);
  if (!Number.isFinite(bonusPercent) || bonusPercent < 0) {
    throw validationError('Процент бонуса должен быть неотрицательным числом');
  }

  const thresholdType = data.thresholdType || 'none';
  if (!THRESHOLD_TYPES.has(thresholdType)) {
    throw validationError('Некорректный тип порога');
  }

  const thresholdValue =
    thresholdType === 'none' ? 0 : Number(data.thresholdValue);
  if (!Number.isFinite(thresholdValue) || thresholdValue < 0) {
    throw validationError('Порог должен быть неотрицательным числом');
  }

  return {
    name,
    description: data.description || null,
    bonusPercent,
    thresholdType,
    thresholdValue,
    sortOrder: Number.isFinite(Number(data.sortOrder))
      ? Number(data.sortOrder)
      : 0,
    isActive: data.isActive !== false,
  };
}

async function normalizeCategoryIds(categoryIds = []) {
  const rawIds = categoryIds.map((id) => Number(id));

  if (rawIds.some((id) => !Number.isInteger(id))) {
    throw validationError('Переданы некорректные категории');
  }

  const normalizedIds = Array.from(new Set(rawIds));

  if (normalizedIds.length === 0) return [];

  const categories = await db.Category.findAll({
    where: {
      id: {
        [db.Sequelize.Op.in]: normalizedIds,
      },
      isActive: true,
      type: 'income',
    },
  });

  if (categories.length !== normalizedIds.length) {
    throw validationError('Одна или несколько категорий не найдены');
  }

  return normalizedIds;
}

async function assertCategoriesAvailable(categoryIds, ownerRuleId = null) {
  if (categoryIds.length === 0) return;

  const where = {
    categoryId: {
      [db.Sequelize.Op.in]: categoryIds,
    },
  };

  if (ownerRuleId) {
    where.bonusRuleId = {
      [db.Sequelize.Op.ne]: Number(ownerRuleId),
    };
  }

  const existingLinks = await db.MotivationBonusRuleCategory.findAll({ where });
  if (existingLinks.length === 0) return;

  const [categories, rules] = await Promise.all([
    db.Category.findAll({
      where: {
        id: {
          [db.Sequelize.Op.in]: existingLinks.map((link) => link.categoryId),
        },
      },
    }),
    db.MotivationBonusRule.findAll({
      where: {
        id: {
          [db.Sequelize.Op.in]: existingLinks.map((link) => link.bonusRuleId),
        },
      },
    }),
  ]);
  const categoryById = new Map(
    categories.map((category) => [category.id, category.name]),
  );
  const ruleById = new Map(rules.map((rule) => [rule.id, rule.name]));
  const conflicts = existingLinks
    .map((link) => {
      const categoryName = categoryById.get(link.categoryId);
      const ruleName = ruleById.get(link.bonusRuleId);
      if (!categoryName || !ruleName) return null;
      return `${categoryName} уже в мотивации «${ruleName}»`;
    })
    .filter(Boolean);

  throw validationError(
    conflicts.length > 0
      ? conflicts.join(', ')
      : 'Категория уже используется в другой мотивации',
  );
}

async function getBonusRuleOrFail(id) {
  const rule = await db.MotivationBonusRule.findByPk(id);
  if (!rule) {
    const error = new Error('Бонусное правило не найдено');
    error.statusCode = 404;
    throw error;
  }
  return rule;
}

async function findBonusRuleWithCategories(id) {
  const rule = await db.MotivationBonusRule.findByPk(id, {
    include: [
      {
        model: db.Category,
        as: 'categories',
        through: { attributes: [] },
      },
    ],
  });

  return normalizeBonusRule(rule);
}

async function createBonusRule(data) {
  const payload = normalizeBonusRulePayload(data);
  const categoryIds = await normalizeCategoryIds(data.categoryIds || []);
  await assertCategoriesAvailable(categoryIds);
  const maxSortOrder = await db.MotivationBonusRule.max('sortOrder');

  const rule = await db.MotivationBonusRule.create({
    ...payload,
    sortOrder:
      Number.isFinite(Number(data.sortOrder)) && Number(data.sortOrder) > 0
        ? Number(data.sortOrder)
        : (Number(maxSortOrder) || 0) + 10,
  });
  await rule.setCategories(categoryIds);

  return findBonusRuleWithCategories(rule.id);
}

async function updateBonusRule(id, data) {
  const rule = await getBonusRuleOrFail(id);
  const payload = normalizeBonusRulePayload({
    ...rule.toJSON(),
    ...data,
  });

  await rule.update(payload);

  if (Array.isArray(data.categoryIds)) {
    const categoryIds = await normalizeCategoryIds(data.categoryIds);
    await assertCategoriesAvailable(categoryIds, rule.id);
    await rule.setCategories(categoryIds);
  }

  return findBonusRuleWithCategories(rule.id);
}

async function assignCategoryToBonusRule(categoryId, bonusRuleId) {
  const [normalizedCategoryId] = await normalizeCategoryIds([categoryId]);

  if (!bonusRuleId) {
    await db.MotivationBonusRuleCategory.destroy({
      where: { categoryId: normalizedCategoryId },
    });
    return getBonusRules();
  }

  const rule = await getBonusRuleOrFail(bonusRuleId);

  await db.sequelize.transaction(async (transaction) => {
    await db.MotivationBonusRuleCategory.destroy({
      where: { categoryId: normalizedCategoryId },
      transaction,
    });
    await db.MotivationBonusRuleCategory.create(
      {
        bonusRuleId: rule.id,
        categoryId: normalizedCategoryId,
      },
      { transaction },
    );
  });

  return getBonusRules();
}

async function deleteBonusRule(id) {
  const rule = await getBonusRuleOrFail(id);
  await rule.destroy();
  return { success: true };
}

async function getCurrentShiftSales(options = {}) {
  const includePaymentSummary = Boolean(options.includePaymentSummary);
  const activeShift = await db.Shift.findOne({
    where: { status: 'active' },
    order: [['startedAt', 'DESC']],
  });

  if (!activeShift?.startedAt) {
    const emptyRecords = [];
    if (!includePaymentSummary) return emptyRecords;

    return {
      paymentSummary: { cash: 0, cashless: 0, total: 0 },
      records: emptyRecords,
    };
  }

  const rules = await db.CatalogRule.findAll({
    where: { status: 'active' },
  });
  const rulesMap = {};
  rules.forEach((rule) => {
    rulesMap[String(rule.itemName).toLowerCase().trim()] = rule.category;
  });
  const categories = await db.Category.findAll({
    where: { isActive: true },
  });
  const categoryByName = new Map(
    categories.map((category) => [
      String(category.name).toLowerCase(),
      category,
    ]),
  );

  const receipts = await db.Receipt.findAll({
    where: {
      dateTime: {
        [db.Sequelize.Op.gte]: activeShift.startedAt,
      },
    },
    include: [{ model: db.ReceiptItem, as: 'items' }],
    order: [['dateTime', 'DESC']],
  });

  const records = [];
  const paymentSummary = {
    cash: 0,
    cashless: 0,
    total: 0,
  };

  for (const receipt of receipts) {
    const isPayback = receipt.type === 'PAYBACK';
    const multiplier = isPayback ? -1 : 1;
    const receiptTotal = Math.abs(Number(receipt.totalAmount) || 0) * multiplier;
    let receiptCash = Math.abs(Number(receipt.cash) || 0) * multiplier;
    let receiptCashless = Math.abs(Number(receipt.cashless) || 0) * multiplier;
    const paymentSource = normalizeReceiptPaymentSource(receipt.paymentSource);

    if (paymentSource === 'cash' && receiptCash === 0 && receiptTotal !== 0) {
      receiptCash = receiptTotal;
      receiptCashless = 0;
    } else if (
      paymentSource === 'cashless' &&
      receiptCashless === 0 &&
      receiptTotal !== 0
    ) {
      receiptCash = 0;
      receiptCashless = receiptTotal;
    } else if (receiptCash === 0 && receiptCashless === 0 && receiptTotal !== 0) {
      receiptCashless = receiptTotal;
    }

    paymentSummary.cash += receiptCash;
    paymentSummary.cashless += receiptCashless;
    paymentSummary.total += receiptCash + receiptCashless;
    const paymentMethod =
      receiptCash !== 0 && receiptCashless !== 0
        ? 'mixed'
        : receiptCash !== 0
          ? 'cash'
          : receiptCashless !== 0
            ? 'cashless'
            : 'unknown';

    for (const item of receipt.items) {
      const rawAmount = Number(
        item.sumPrice !== undefined && item.sumPrice !== null
          ? item.sumPrice
          : item.sum,
      );
      const amount = Math.abs(rawAmount) * multiplier;
      if (amount === 0) continue;
      const quantity = Math.abs(Number(item.quantity) || 0) * multiplier;

      const category =
        rulesMap[String(item.name).toLowerCase().trim()] || 'Неразобранное';
      const catalogCategory = categoryByName.get(
        String(category).toLowerCase(),
      );

      records.push({
        categoryId: catalogCategory?.id || null,
        category,
        amount,
        type: isPayback ? 'expense' : 'income',
        source: 'evotor',
        date: receipt.dateTime,
        comment: `${item.name} (${quantity} шт)`,
        paymentCash: receiptCash,
        paymentCashless: receiptCashless,
        paymentMethod,
        paymentSource: receipt.paymentSource || null,
        receiptId: receipt.id,
        qty: quantity,
      });
    }
  }

  if (!includePaymentSummary) return records;

  return {
    paymentSummary,
    records,
  };
}

function calculateBasePay(hours, rules) {
  const normalizedHours = Math.max(0, Number(hours) || 0);
  const overtimeAfterHours = Number(rules.overtime_after_hours) || 12;
  const baseRate = Number(rules.base_hour_rate) || 0;
  const overtimeRate = Number(rules.overtime_hour_rate) || baseRate;

  return (
    Math.min(normalizedHours, overtimeAfterHours) * baseRate +
    Math.max(0, normalizedHours - overtimeAfterHours) * overtimeRate
  );
}

function getItemCategoryKey(item) {
  return String(item.category || '').toLowerCase().trim();
}

function ruleThresholdPassed(rule, totals) {
  if (rule.thresholdType === 'none') return true;
  if (rule.thresholdType === 'quantity') {
    return totals.quantity >= Number(rule.thresholdValue);
  }

  return totals.revenue >= Number(rule.thresholdValue);
}

function calculateShiftBonus(items, bonusRules = []) {
  const activeRules = bonusRules
    .filter((rule) => rule.isActive)
    .map(normalizeBonusRule);
  const rulesByCategory = new Map();
  const totalsByRuleId = new Map();

  activeRules.forEach((rule) => {
    totalsByRuleId.set(rule.id, {
      ruleId: rule.id,
      ruleName: rule.name,
      bonusPercent: Number(rule.bonusPercent),
      thresholdType: rule.thresholdType,
      thresholdValue: Number(rule.thresholdValue),
      revenue: 0,
      quantity: 0,
      bonus: 0,
      thresholdPassed: false,
      categories: rule.categories,
    });

    rule.categories.forEach((category) => {
      const key = String(category.name).toLowerCase().trim();
      const rules = rulesByCategory.get(key) || [];
      rules.push(rule);
      rulesByCategory.set(key, rules);
    });
  });

  items.forEach((item) => {
    const matchedRules = rulesByCategory.get(getItemCategoryKey(item)) || [];
    const revenue = Number(item.sum) || 0;
    const quantity = Number(item.qty) || 0;

    matchedRules.forEach((rule) => {
      const totals = totalsByRuleId.get(rule.id);
      if (!totals) return;

      totals.revenue += revenue;
      totals.quantity += quantity;
    });
  });

  totalsByRuleId.forEach((totals) => {
    totals.thresholdPassed = ruleThresholdPassed(totals, totals);
    totals.bonus = totals.thresholdPassed
      ? totals.revenue * (totals.bonusPercent / 100)
      : 0;
  });

  const detailedItems = items.map((item) => {
    const matchedRules = rulesByCategory.get(getItemCategoryKey(item)) || [];
    const sum = Number(item.sum) || 0;
    const bonuses = matchedRules
      .map((rule) => {
        const totals = totalsByRuleId.get(rule.id);
        if (!totals?.thresholdPassed) return null;

        return {
          ruleId: rule.id,
          ruleName: rule.name,
          bonusPercent: Number(rule.bonusPercent),
          earned: sum * (Number(rule.bonusPercent) / 100),
        };
      })
      .filter(Boolean);
    const earned = bonuses.reduce((acc, bonus) => acc + bonus.earned, 0);

    return {
      ...item,
      bonusRuleIds: bonuses.map((bonus) => bonus.ruleId),
      bonusRuleNames: bonuses.map((bonus) => bonus.ruleName),
      bonusPercent: bonuses.reduce(
        (acc, bonus) => acc + Number(bonus.bonusPercent),
        0,
      ),
      bonus: earned,
      bucket: bonuses.length ? 'bonus' : '',
      bonuses,
    };
  });

  const breakdown = Array.from(totalsByRuleId.values()).sort(
    (a, b) => b.bonus - a.bonus,
  );

  return {
    total: breakdown.reduce((acc, rule) => acc + rule.bonus, 0),
    detailedItems,
    breakdown,
  };
}

module.exports = {
  calculateBasePay,
  calculateShiftBonus,
  assignCategoryToBonusRule,
  createBonusRule,
  deleteBonusRule,
  getAvailableCategories,
  getBonusRules,
  getCurrentShiftSales,
  getRules,
  getRulesMap,
  updateBonusRule,
  updateRule,
};
