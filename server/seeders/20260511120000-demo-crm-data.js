'use strict';

const authService = require('../src/services/auth.service');
const {
  runInitializedSeederBatch,
} = require('../src/services/account-seeder-adapter');

function dateAt(day, hour, minute = 0) {
  return new Date(`2026-05-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00+03:00`);
}

async function resolveUserTenantSeederScope(queryInterface, foundation) {
  const [columns] = await queryInterface.sequelize.query(
    `SELECT COLUMN_NAME AS columnName
       FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'Users'
        AND COLUMN_NAME = 'organizationId'`,
  );
  const isTenantAware = columns.length === 1;
  return {
    insert: isTenantAware
      ? { organizationId: foundation.organization.id }
      : {},
    query: isTenantAware
      ? { replacements: { organizationId: foundation.organization.id } }
      : {},
    sqlPredicate: isTenantAware ? 'organizationId = :organizationId AND ' : '',
    where: isTenantAware
      ? { organizationId: foundation.organization.id }
      : {},
  };
}

async function resolveVisitTenantSeederScope(queryInterface, foundation) {
  const [columns] = await queryInterface.sequelize.query(
    `SELECT COLUMN_NAME AS columnName
       FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'Visits'
        AND COLUMN_NAME IN ('organizationId', 'clubId')`,
  );
  const tenantColumns = new Set(columns.map((column) => column.columnName));
  return tenantColumns.has('organizationId') && tenantColumns.has('clubId')
    ? {
        clubId: foundation.club.id,
        organizationId: foundation.organization.id,
      }
    : {};
}

async function resolveShiftTenantSeederScope(queryInterface, foundation) {
  const [columns] = await queryInterface.sequelize.query(
    `SELECT COLUMN_NAME AS columnName
       FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'Shifts'
        AND COLUMN_NAME = 'clubId'`,
  );
  const tenantAware = columns.length === 1;
  return {
    insert: tenantAware ? { clubId: foundation.club.id } : {},
    where: tenantAware ? { clubId: foundation.club.id } : {},
  };
}

async function resolveUtilizationTenantSeederScope(queryInterface, foundation) {
  const [columns] = await queryInterface.sequelize.query(
    `SELECT COLUMN_NAME AS columnName
       FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'Utilizations'
        AND COLUMN_NAME IN ('organizationId', 'clubId')`,
  );
  const names = new Set(columns.map((column) => column.columnName));
  return names.has('organizationId') && names.has('clubId')
    ? {
        clubId: foundation.club.id,
        organizationId: foundation.organization.id,
      }
    : {};
}

const DEMO_CATALOG_RULES = [
  ['Аренда корта 90 минут', 'Аренда кортов'],
  ['Аренда корта 60 минут', 'Аренда кортов'],
  ['Групповая тренировка', 'Аренда кортов'],
  ['Вода 0.5', 'Напитки'],
  ['Капучино', 'Кофе'],
  ['Батончик протеиновый', 'Снеки'],
  ['Молочный коктейль ванильный', 'Молочные коктейли'],
  ['Пиво безалкогольное', 'Пивко'],
  ['Мячи Head Pro', 'Мячи и тубусы'],
  ['Овергрип Wilson', 'Аксессуары магазина'],
  ['VIP раздевалка', 'VIP-услуги'],
  ['VIP Ракетка Шефа', 'Прокат инвентаря'],
  ['Ракетка шефа', 'Прокат инвентаря'],
  ['Тубус мячей', 'Мячи и тубусы'],
];
const DEMO_CATALOG_RULE_ID_START = 910000;

const DEMO_CATEGORIES = [
  ['Аренда кортов', 'income', 'REVENUE_POS', 0, true],
  ['Бар / Кафе', 'income', 'REVENUE_POS', 0, true],
  ['Магазин (Товары)', 'income', 'REVENUE_POS', 0, true],
  ['Прокат инвентаря / VIP', 'income', 'REVENUE_POS', 0, true],
  ['Доп. услуги', 'income', 'REVENUE_POS', 0, true],
  ['Кофе', 'income', 'REVENUE_POS', 0, false],
  ['Напитки', 'income', 'REVENUE_POS', 0, false],
  ['Снеки', 'income', 'REVENUE_POS', 0, false],
  ['Молочные коктейли', 'income', 'REVENUE_POS', 0, false],
  ['Пивко', 'income', 'REVENUE_POS', 0, false],
  ['Мячи и тубусы', 'income', 'REVENUE_POS', 0, false],
  ['Аксессуары магазина', 'income', 'REVENUE_POS', 0, false],
  ['VIP-услуги', 'income', 'REVENUE_POS', 0, false],
  ['Прокат инвентаря', 'income', 'REVENUE_POS', 0, false],
  ['Корпоративные мероприятия', 'income', 'REVENUE_EXT', 3, false],
  ['Закупка бара', 'expense', 'COGS', 0, false],
  ['Маркетинг', 'expense', 'OPEX', 0, false],
  ['Аренда помещения', 'expense', 'OPEX', 0, false],
];
const DEMO_CATEGORY_ID_START = 912000;

const DEMO_MOTIVATION_RULES = [
  {
    name: 'Бар',
    description: 'Демо: кофе, напитки, коктейли, снеки и пиво.',
    bonusPercent: 5,
    thresholdType: 'revenue',
    thresholdValue: 4000,
    categories: ['Кофе', 'Напитки', 'Молочные коктейли', 'Пивко', 'Снеки'],
    sortOrder: 10,
  },
  {
    name: 'Магазин',
    description: 'Демо: аксессуары, мячи и тубусы из магазина.',
    bonusPercent: 3,
    thresholdType: 'revenue',
    thresholdValue: 3000,
    categories: ['Аксессуары магазина', 'Мячи и тубусы'],
    sortOrder: 20,
  },
  {
    name: 'VIP и прокат',
    description: 'Демо: VIP-услуги и платный прокат инвентаря.',
    bonusPercent: 10,
    thresholdType: 'none',
    thresholdValue: 0,
    categories: ['VIP-услуги', 'Прокат инвентаря'],
    sortOrder: 30,
  },
];
const DEMO_MOTIVATION_RULE_ID_START = 911000;
const DEMO_USERS = [
  ['demo-tg-1', 'Алексей Новиков', '+79090000001', 'Telegram бот'],
  ['demo-tg-2', 'Кирилл Волков', '+79090000002', 'VK реклама'],
  ['demo-tg-3', 'Даниил Соколов', '+79090000003', 'Рекомендация друга'],
  ['demo-tg-4', 'Полина Сергеева', '+79090000004', '2ГИС'],
  ['demo-tg-5', 'Ирина Павлова', '+79090000005', 'Яндекс Карты'],
  ['demo-tg-6', 'Максим Фомин', '+79090000006', 'Instagram'],
  ['demo-tg-7', 'Алина Захарова', '+79090000007', 'Турнир'],
  ['demo-tg-8', 'Роман Егоров', '+79090000008', 'Ресепшн'],
];
const DEMO_STAFF = [
  ['Антон Pry', 'Владелец', '+79000000100'],
  ['Мария Орлова', 'Управляющий', '+79000000101'],
  ['Илья Смирнов', 'Администратор', '+79000000102'],
  ['Софья Ким', 'Администратор', '+79000000103'],
  ['Елена Морозова', 'Бухгалтер', '+79000000104'],
  ['Виктория Лебедева', 'Наблюдатель', '+79000000105'],
  ['Павел Романов', 'Тренер', '+79000000106'],
];
const DEMO_ACCOUNTS = [
  ['owner@padelpark.demo', 'owner', '+79000000100'],
  ['manager@padelpark.demo', 'manager', '+79000000101'],
  ['admin@padelpark.demo', 'admin', '+79000000102'],
  ['accountant@padelpark.demo', 'accountant', '+79000000104'],
  ['viewer@padelpark.demo', 'viewer', '+79000000105'],
  ['trainer@padelpark.demo', 'trainer', '+79000000106'],
];
const DEMO_FINANCES = [
  ['2026-05-03', 'Корпоративные мероприятия', 45000, 'income', '[demo] Корпоративная бронь на 3 корта'],
  ['2026-05-04', 'Закупка бара', 18500, 'expense', '[demo] Вода, снеки, кофе'],
  ['2026-05-06', 'Маркетинг', 12000, 'expense', '[demo] Таргет на турнир выходного дня'],
  ['2026-05-01', 'Аренда помещения', 180000, 'expense', '[demo] Ежемесячная аренда клуба'],
];
const DEMO_RECEIPT_ITEMS = [
  ['Аренда корта 90 минут', 5850, 'SERVICE'],
  ['Аренда корта 60 минут', 3900, 'SERVICE'],
  ['Вода 0.5', 180, 'COMMODITY'],
  ['Капучино', 280, 'COMMODITY'],
  ['Батончик протеиновый', 240, 'COMMODITY'],
  ['Молочный коктейль ванильный', 360, 'COMMODITY'],
  ['Пиво безалкогольное', 320, 'COMMODITY'],
  ['Мячи Head Pro', 1450, 'COMMODITY'],
  ['Овергрип Wilson', 450, 'COMMODITY'],
  ['VIP раздевалка', 1200, 'SERVICE'],
  ['VIP Ракетка Шефа', 1500, 'SERVICE'],
  ['Тубус мячей', 850, 'COMMODITY'],
];

function demoIds(start, rows) {
  return rows.map((_, index) => start + index);
}

function buildDemoReceiptRows(foundation) {
  const receipts = [];
  const receiptItems = [];
  let receiptId = 20000;
  for (let day = 1; day <= 11; day += 1) {
    for (let receiptIndex = 0; receiptIndex < 4; receiptIndex += 1) {
      const id = receiptId;
      receiptId += 1;
      const date = dateAt(day, 9 + receiptIndex * 3, 10);
      const selected = [
        DEMO_RECEIPT_ITEMS[(day + receiptIndex) % DEMO_RECEIPT_ITEMS.length],
        DEMO_RECEIPT_ITEMS[(day + receiptIndex + 3) % DEMO_RECEIPT_ITEMS.length],
      ];
      let total = 0;
      selected.forEach(([name, price, itemType], itemIndex) => {
        const quantity = itemIndex === 0 ? 1 : 1 + ((day + receiptIndex) % 2);
        const sum = Number(price) * quantity;
        total += sum;
        receiptItems.push({
          receiptId: id,
          name,
          quantity,
          price,
          sum,
          itemType,
          measureName: 'шт',
          costPrice: Number(price) * 0.35,
          sumPrice: sum,
          tax: 0,
          taxPercent: 0,
          discount: 0,
          createdAt: date,
          updatedAt: date,
        });
      });
      const isCash = receiptIndex === 3;
      receipts.push({
        organizationId: foundation.organization.id,
        clubId: foundation.club.id,
        id,
        evotorId: `demo-padel-${id}`,
        dateTime: date,
        type: 'SELL',
        totalAmount: total,
        cash: isCash ? total : 0,
        cashless: isCash ? 0 : total,
        employeeId: receiptIndex % 2 === 0 ? 'ilya-demo' : 'sofia-demo',
        shiftId: `demo-shift-${day}`,
        totalTax: 0,
        totalDiscount: 0,
        paymentSource: isCash ? 'CASH' : 'PAY_CARD',
        createdAt: date,
        updatedAt: date,
      });
    }
  }
  return { receiptItems, receipts };
}

function fixtureOwnershipError(table, id) {
  const error = new Error(`Demo fixture ownership lost for ${table} id ${id}`);
  error.code = 'TENANT_SEEDER_ARTIFACT_OWNERSHIP_LOST';
  return error;
}

async function assertDemoArtifactOwnership(queryInterface, foundation) {
  const [catalogRows] = await queryInterface.sequelize.query(
    'SELECT id,itemName,category FROM CatalogRules WHERE id IN (:ids)',
    { replacements: { ids: demoIds(DEMO_CATALOG_RULE_ID_START, DEMO_CATALOG_RULES) } },
  );
  for (const row of catalogRows) {
    const expected = DEMO_CATALOG_RULES[Number(row.id) - DEMO_CATALOG_RULE_ID_START];
    if (!expected || row.itemName !== expected[0] || row.category !== expected[1]) {
      throw fixtureOwnershipError('CatalogRules', row.id);
    }
  }
  const [motivationRows] = await queryInterface.sequelize.query(
    'SELECT id,name,description FROM MotivationBonusRules WHERE id IN (:ids)',
    { replacements: { ids: demoIds(DEMO_MOTIVATION_RULE_ID_START, DEMO_MOTIVATION_RULES) } },
  );
  for (const row of motivationRows) {
    const expected = DEMO_MOTIVATION_RULES[Number(row.id) - DEMO_MOTIVATION_RULE_ID_START];
    if (!expected || row.name !== expected.name || row.description !== expected.description) {
      throw fixtureOwnershipError('MotivationBonusRules', row.id);
    }
  }
  const [categoryRows] = await queryInterface.sequelize.query(
    'SELECT id,name,type,`group`,commissionPercent,isSystem FROM Categories WHERE id IN (:ids)',
    { replacements: { ids: demoIds(DEMO_CATEGORY_ID_START, DEMO_CATEGORIES) } },
  );
  for (const row of categoryRows) {
    const expected = DEMO_CATEGORIES[Number(row.id) - DEMO_CATEGORY_ID_START];
    if (!expected || row.name !== expected[0] || row.type !== expected[1] ||
      row.group !== expected[2] || Number(row.commissionPercent) !== expected[3] ||
      Boolean(row.isSystem) !== expected[4]) {
      throw fixtureOwnershipError('Categories', row.id);
    }
  }
  const categoryNameById = new Map(categoryRows.map((row) => [Number(row.id), row.name]));
  const motivationById = new Map(motivationRows.map((row) => [Number(row.id), row]));
  const [motivationLinks] = await queryInterface.sequelize.query(
    `SELECT bonusRuleId,categoryId FROM MotivationBonusRuleCategories
      WHERE bonusRuleId IN (:ids)`,
    { replacements: { ids: demoIds(DEMO_MOTIVATION_RULE_ID_START, DEMO_MOTIVATION_RULES) } },
  );
  for (const row of motivationLinks) {
    const rule = DEMO_MOTIVATION_RULES[Number(row.bonusRuleId) - DEMO_MOTIVATION_RULE_ID_START];
    if (!motivationById.has(Number(row.bonusRuleId)) ||
      !rule?.categories.includes(categoryNameById.get(Number(row.categoryId)))) {
      throw fixtureOwnershipError('MotivationBonusRuleCategories', `${row.bonusRuleId}:${row.categoryId}`);
    }
  }

  const organizationId = Number(foundation.organization.id);
  const clubId = Number(foundation.club.id);
  const [users] = await queryInterface.sequelize.query(
    `SELECT id,organizationId,telegramId,name,phone,source FROM Users
      WHERE organizationId=:organizationId AND phone LIKE '+7909%'`,
    { replacements: { organizationId } },
  );
  const userByPhone = new Map(DEMO_USERS.map((row) => [row[2], row]));
  for (const row of users) {
    const expected = userByPhone.get(row.phone);
    if (!expected || Number(row.organizationId) !== organizationId ||
      row.telegramId !== expected[0] || row.name !== expected[1] || row.source !== expected[3]) {
      throw fixtureOwnershipError('Users', row.id);
    }
  }
  const userIds = users.map((row) => row.id);
  const [scannerRows] = userIds.length === 0 ? [[]] : await queryInterface.sequelize.query(
    `SELECT id FROM ScannerEvents WHERE userId IN (:userIds)
       OR visitId IN (SELECT id FROM Visits WHERE userId IN (:userIds))`,
    { replacements: { userIds } },
  );
  if (scannerRows.length > 0) throw fixtureOwnershipError('ScannerEvents', scannerRows[0].id);
  const [visits] = userIds.length === 0 ? [[]] : await queryInterface.sequelize.query(
    'SELECT id,userId,keyNumber,category FROM Visits WHERE userId IN (:userIds)',
    { replacements: { userIds } },
  );
  const visitCategories = ['Игра 2х2', 'Групповая тренировка', 'Индивидуальная тренировка', 'Турнир', 'Первый раз'];
  const userIndex = new Map(users.map((row) => [Number(row.id), DEMO_USERS.findIndex((item) => item[2] === row.phone)]));
  const expectedVisits = new Set();
  for (const [id, index] of userIndex) {
    for (let offset = 0; offset < 3; offset += 1) {
      expectedVisits.add(`${id}|${20 + index + offset}|${visitCategories[(index + offset) % visitCategories.length]}`);
    }
  }
  for (const visit of visits) {
    if (!expectedVisits.has(`${Number(visit.userId)}|${visit.keyNumber}|${visit.category}`)) {
      throw fixtureOwnershipError('Visits', visit.id);
    }
  }

  const [staff] = await queryInterface.sequelize.query(
    `SELECT id,name,role,phone,status FROM Staffs
      WHERE organizationId=:organizationId AND phone LIKE '+790000001%'`,
    { replacements: { organizationId } },
  );
  const staffByPhone = new Map(DEMO_STAFF.map((row) => [row[2], row]));
  for (const row of staff) {
    const expected = staffByPhone.get(row.phone);
    if (!expected || row.name !== expected[0] || row.role !== expected[1] || row.status !== 'active') {
      throw fixtureOwnershipError('Staffs', row.id);
    }
  }
  const [accounts] = await queryInterface.sequelize.query(
    `SELECT account.id,account.email,account.role,account.status,staff.phone,
            membership.id membershipId,membership.role membershipRole,
            membership.status membershipStatus,membership.organizationId,
            COUNT(access.membershipId) accessCount,
            SUM(access.organizationId=:organizationId AND access.clubId=:clubId
                AND access.status='active' AND access.roleOverride IS NULL) validAccessCount
       FROM Accounts account
       LEFT JOIN Staffs staff ON staff.id=account.staffId
       LEFT JOIN Memberships membership ON membership.accountId=account.id
       LEFT JOIN MembershipClubAccesses access ON access.membershipId=membership.id
      WHERE account.email LIKE '%@padelpark.demo'
      GROUP BY account.id,account.email,account.role,account.status,staff.phone,
               membership.id,membership.role,membership.status,membership.organizationId`,
    { replacements: { clubId, organizationId } },
  );
  const accountByEmail = new Map(DEMO_ACCOUNTS.map((row) => [row[0], row]));
  for (const row of accounts) {
    const expected = accountByEmail.get(row.email);
    const owner = expected?.[1] === 'owner';
    if (!expected || row.role !== expected[1] || row.membershipRole !== expected[1] ||
      row.phone !== expected[2] || row.status !== 'active' || row.membershipStatus !== 'active' ||
      Number(row.organizationId) !== organizationId || Number(row.accessCount) !== (owner ? 0 : 1) ||
      Number(row.validAccessCount || 0) !== (owner ? 0 : 1)) {
      throw fixtureOwnershipError('Accounts', row.id);
    }
  }

  const [receipts] = await queryInterface.sequelize.query(
    `SELECT id,organizationId,clubId,evotorId,type,totalAmount,cash,cashless,
            employeeId,shiftId,totalTax,totalDiscount,paymentSource FROM Receipts
      WHERE id BETWEEN 20000 AND 29999`,
  );
  const expectedReceiptRows = buildDemoReceiptRows(foundation);
  const expectedReceiptById = new Map(
    expectedReceiptRows.receipts.map((row) => [Number(row.id), row]),
  );
  for (const row of receipts) {
    const expected = expectedReceiptById.get(Number(row.id));
    const numericFields = [
      'organizationId', 'clubId', 'totalAmount', 'cash', 'cashless',
      'totalTax', 'totalDiscount',
    ];
    const stringFields = ['evotorId', 'type', 'employeeId', 'shiftId', 'paymentSource'];
    if (!expected || numericFields.some((key) => Number(row[key]) !== Number(expected[key])) ||
      stringFields.some((key) => row[key] !== expected[key])) {
      throw fixtureOwnershipError('Receipts', row.id);
    }
  }
  const receiptIds = receipts.map((row) => row.id);
  if (receiptIds.length > 0) {
    const [actualItems] = await queryInterface.sequelize.query(
      `SELECT id,receiptId,name,quantity,price,sum,itemType,measureName,costPrice,
              sumPrice,tax,taxPercent,discount
         FROM ReceiptItems WHERE receiptId IN (:receiptIds) ORDER BY receiptId,id`,
      { replacements: { receiptIds } },
    );
    const decimal = (value) => Math.round(Number(value) * 100) / 100;
    const itemSignature = (item) => [
      item.name, Number(item.quantity), decimal(item.price), decimal(item.sum), item.itemType,
      item.measureName, decimal(item.costPrice), decimal(item.sumPrice), decimal(item.tax),
      decimal(item.taxPercent), decimal(item.discount),
    ].join('|');
    for (const receiptId of receiptIds) {
      const actual = actualItems
        .filter((row) => Number(row.receiptId) === Number(receiptId))
        .map(itemSignature).sort();
      const expected = expectedReceiptRows.receiptItems
        .filter((row) => Number(row.receiptId) === Number(receiptId))
        .map(itemSignature).sort();
      if (actual.length !== expected.length || actual.join('\n') !== expected.join('\n')) {
        throw fixtureOwnershipError('ReceiptItems', receiptId);
      }
    }
  }

  const [shifts] = await queryInterface.sequelize.query(
    `SELECT shift.id,shift.date,shift.adminName,shift.comment,staff.phone
       FROM Shifts shift LEFT JOIN Staffs staff ON staff.id=shift.staffId
      WHERE shift.clubId=:clubId AND shift.comment LIKE '[demo]%'`,
    { replacements: { clubId } },
  );
  for (const row of shifts) {
    const day = Number(String(row.date).slice(-2));
    const phone = day % 2 === 0 ? '+79000000102' : '+79000000101';
    const admin = day % 2 === 0 ? 'Илья Смирнов' : 'Мария Орлова';
    if (day < 1 || day > 11 || row.phone !== phone || row.adminName !== admin ||
      row.comment !== '[demo] Реалистичная смена для проверки мотивации') {
      throw fixtureOwnershipError('Shifts', row.id);
    }
  }
  const [finances] = await queryInterface.sequelize.query(
    `SELECT id,date,category,amount,type,comment FROM Finances
      WHERE organizationId=:organizationId AND clubId=:clubId AND comment LIKE '[demo]%'`,
    { replacements: { clubId, organizationId } },
  );
  const financeByComment = new Map(DEMO_FINANCES.map((row) => [row[4], row]));
  for (const row of finances) {
    const expected = financeByComment.get(row.comment);
    if (!expected || String(row.date) !== expected[0] || row.category !== expected[1] ||
      Number(row.amount) !== expected[2] || row.type !== expected[3]) {
      throw fixtureOwnershipError('Finances', row.id);
    }
  }
  const [utilizations] = await queryInterface.sequelize.query(
    `SELECT id,date,booked2,booked1,sessions2,sessions1 FROM Utilizations
      WHERE organizationId=:organizationId AND clubId=:clubId
        AND date BETWEEN '2026-05-01' AND '2026-05-14'`,
    { replacements: { clubId, organizationId } },
  );
  for (const row of utilizations) {
    const day = Number(String(row.date).slice(-2));
    if (day < 1 || day > 11 || Number(row.booked2) !== 42 + ((day * 7) % 24) ||
      Number(row.booked1) !== 6 + ((day * 3) % 8) ||
      Number(row.sessions2) !== 18 + ((day * 5) % 12) ||
      Number(row.sessions1) !== 5 + ((day * 2) % 7)) {
      throw fixtureOwnershipError('Utilizations', row.id);
    }
  }
  return {
    accountEmails: accounts.map((row) => row.email),
    financeIds: finances.map((row) => row.id),
    receiptIds,
    shiftIds: shifts.map((row) => row.id),
    staffIds: staff.map((row) => row.id),
    userIds,
    utilizationIds: utilizations.map((row) => row.id),
    visitIds: visits.map((row) => row.id),
  };
}

async function cleanupDemoArtifacts(queryInterface, accountBatch, owned, Sequelize) {
  if (owned.receiptIds.length) {
    await queryInterface.bulkDelete('ReceiptItems', { receiptId: { [Sequelize.Op.in]: owned.receiptIds } });
    await queryInterface.bulkDelete('Receipts', { id: { [Sequelize.Op.in]: owned.receiptIds } });
  }
  if (owned.visitIds.length) await queryInterface.bulkDelete('Visits', { id: { [Sequelize.Op.in]: owned.visitIds } });
  if (owned.userIds.length) await queryInterface.bulkDelete('Users', { id: { [Sequelize.Op.in]: owned.userIds } });
  if (owned.shiftIds.length) await queryInterface.bulkDelete('Shifts', { id: { [Sequelize.Op.in]: owned.shiftIds } });
  if (owned.accountEmails.length) await accountBatch.deleteAccountsByEmails(owned.accountEmails);
  if (owned.staffIds.length) await queryInterface.bulkDelete('Staffs', { id: { [Sequelize.Op.in]: owned.staffIds } });
  if (owned.financeIds.length) await queryInterface.bulkDelete('Finances', { id: { [Sequelize.Op.in]: owned.financeIds } });
  if (owned.utilizationIds.length) await queryInterface.bulkDelete('Utilizations', { id: { [Sequelize.Op.in]: owned.utilizationIds } });
}

module.exports = {
  async up(queryInterface, Sequelize) {
    return runInitializedSeederBatch(
      queryInterface,
      async (queryInterface, accountBatch, foundation) => {
        const now = new Date();
        const passwordHash = await authService.hashPassword('Demo1234!');
        const userTenantScope = await resolveUserTenantSeederScope(
          queryInterface,
          foundation,
        );
        const utilizationTenantScope = await resolveUtilizationTenantSeederScope(
          queryInterface,
          foundation,
        );
        const shiftTenantScope = await resolveShiftTenantSeederScope(
          queryInterface,
          foundation,
        );
        const owned = await assertDemoArtifactOwnership(queryInterface, foundation);
        await cleanupDemoArtifacts(queryInterface, accountBatch, owned, Sequelize);
    await queryInterface.sequelize.query(
      'DELETE FROM MotivationBonusRuleCategories WHERE bonusRuleId IN (:bonusRuleIds)',
      { replacements: { bonusRuleIds: demoIds(DEMO_MOTIVATION_RULE_ID_START, DEMO_MOTIVATION_RULES) } },
    );
    await queryInterface.bulkDelete('MotivationBonusRules', {
      id: { [Sequelize.Op.in]: demoIds(DEMO_MOTIVATION_RULE_ID_START, DEMO_MOTIVATION_RULES) },
    });
    await queryInterface.bulkDelete('CatalogRules', {
      id: { [Sequelize.Op.in]: demoIds(DEMO_CATALOG_RULE_ID_START, DEMO_CATALOG_RULES) },
    });

    await queryInterface.bulkInsert(
      'Categories',
      DEMO_CATEGORIES.map(([name, type, group, commissionPercent, isSystem], index) => ({
        id: DEMO_CATEGORY_ID_START + index,
        name,
        type,
        group,
        commissionPercent,
        isSystem,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      })),
      { ignoreDuplicates: true },
    );

    await queryInterface.bulkInsert(
      'CatalogRules',
      DEMO_CATALOG_RULES.map(([itemName, category], index) => ({
        id: DEMO_CATALOG_RULE_ID_START + index,
        itemName,
        category,
        createdAt: now,
        updatedAt: now,
      })),
      { ignoreDuplicates: true },
    );

    await queryInterface.bulkInsert(
      'MotivationBonusRules',
      DEMO_MOTIVATION_RULES.map((rule, index) => ({
        id: DEMO_MOTIVATION_RULE_ID_START + index,
        name: rule.name,
        description: rule.description,
        bonusPercent: rule.bonusPercent,
        thresholdType: rule.thresholdType,
        thresholdValue: rule.thresholdValue,
        sortOrder: rule.sortOrder,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      })),
    );

    const [categoryRows] = await queryInterface.sequelize.query(
      'SELECT id, name FROM Categories',
    );
    const [bonusRuleRows] = await queryInterface.sequelize.query(
      'SELECT id, name FROM MotivationBonusRules WHERE id IN (:bonusRuleIds)',
      { replacements: { bonusRuleIds: demoIds(DEMO_MOTIVATION_RULE_ID_START, DEMO_MOTIVATION_RULES) } },
    );
    const categoryByName = Object.fromEntries(
      categoryRows.map((category) => [category.name, category.id]),
    );
    const bonusRuleByName = Object.fromEntries(
      bonusRuleRows.map((rule) => [rule.name, rule.id]),
    );
    const bonusRuleLinks = DEMO_MOTIVATION_RULES.flatMap((rule) => {
      const bonusRuleId = bonusRuleByName[rule.name];
      if (!bonusRuleId) return [];

      return rule.categories
        .map((categoryName) => {
          const categoryId = categoryByName[categoryName];
          if (!categoryId) return null;

          return {
            bonusRuleId,
            categoryId,
            createdAt: now,
            updatedAt: now,
          };
        })
        .filter(Boolean);
    });

    if (bonusRuleLinks.length > 0) {
      await queryInterface.bulkInsert(
        'MotivationBonusRuleCategories',
        bonusRuleLinks,
      );
    }

    await queryInterface.bulkInsert('Staffs', [
      {
        name: 'Антон Pry',
        organizationId: foundation.organization.id,
        role: 'Владелец',
        phone: '+79000000100',
        status: 'active',
        createdAt: now,
        updatedAt: now,
      },
      {
        name: 'Мария Орлова',
        organizationId: foundation.organization.id,
        role: 'Управляющий',
        phone: '+79000000101',
        status: 'active',
        createdAt: now,
        updatedAt: now,
      },
      {
        name: 'Илья Смирнов',
        organizationId: foundation.organization.id,
        role: 'Администратор',
        phone: '+79000000102',
        status: 'active',
        createdAt: now,
        updatedAt: now,
      },
      {
        name: 'Софья Ким',
        organizationId: foundation.organization.id,
        role: 'Администратор',
        phone: '+79000000103',
        status: 'active',
        createdAt: now,
        updatedAt: now,
      },
      {
        name: 'Елена Морозова',
        organizationId: foundation.organization.id,
        role: 'Бухгалтер',
        phone: '+79000000104',
        status: 'active',
        createdAt: now,
        updatedAt: now,
      },
      {
        name: 'Виктория Лебедева',
        organizationId: foundation.organization.id,
        role: 'Наблюдатель',
        phone: '+79000000105',
        status: 'active',
        createdAt: now,
        updatedAt: now,
      },
      {
        name: 'Павел Романов',
        organizationId: foundation.organization.id,
        role: 'Тренер',
        phone: '+79000000106',
        status: 'active',
        createdAt: now,
        updatedAt: now,
      },
    ]);

    const [staffRows] = await queryInterface.sequelize.query(
      'SELECT id, phone FROM Staffs WHERE organizationId = :organizationId AND phone LIKE "+790000001%"',
      { replacements: { organizationId: foundation.organization.id } },
    );
    const staffByPhone = Object.fromEntries(
      staffRows.map((staff) => [staff.phone, staff.id]),
    );

        await accountBatch.insertAccounts([
      {
        staffId: staffByPhone['+79000000100'],
        email: 'owner@padelpark.demo',
        passwordHash,
        role: 'owner',
        status: 'active',
        createdAt: now,
        updatedAt: now,
      },
      {
        staffId: staffByPhone['+79000000101'],
        email: 'manager@padelpark.demo',
        passwordHash,
        role: 'manager',
        status: 'active',
        createdAt: now,
        updatedAt: now,
      },
      {
        staffId: staffByPhone['+79000000102'],
        email: 'admin@padelpark.demo',
        passwordHash,
        role: 'admin',
        status: 'active',
        createdAt: now,
        updatedAt: now,
      },
      {
        staffId: staffByPhone['+79000000104'],
        email: 'accountant@padelpark.demo',
        passwordHash,
        role: 'accountant',
        status: 'active',
        createdAt: now,
        updatedAt: now,
      },
      {
        staffId: staffByPhone['+79000000105'],
        email: 'viewer@padelpark.demo',
        passwordHash,
        role: 'viewer',
        status: 'active',
        createdAt: now,
        updatedAt: now,
      },
      {
        staffId: staffByPhone['+79000000106'],
        email: 'trainer@padelpark.demo',
        passwordHash,
        role: 'trainer',
        status: 'active',
        createdAt: now,
        updatedAt: now,
      },
    ]);

    await queryInterface.bulkInsert(
      'Users',
      DEMO_USERS.map(([telegramId, name, phone, source]) => ({
        ...userTenantScope.insert,
        telegramId,
        name,
        phone,
        source,
        createdAt: now,
        updatedAt: now,
      })),
    );

    const [users] = await queryInterface.sequelize.query(
      `SELECT id, phone FROM Users WHERE ${userTenantScope.sqlPredicate}phone LIKE "+7909%"`,
      userTenantScope.query,
    );

    const visitCategories = [
      'Игра 2х2',
      'Групповая тренировка',
      'Индивидуальная тренировка',
      'Турнир',
      'Первый раз',
    ];
    const visits = [];
    const visitTenantScope = await resolveVisitTenantSeederScope(
      queryInterface,
      foundation,
    );

    users.forEach((user, index) => {
      for (let i = 0; i < 3; i += 1) {
        visits.push({
          ...visitTenantScope,
          userId: user.id,
          scannedAt: dateAt(1 + index + i * 3, 10 + ((index + i) % 9), 20),
          keyNumber: String(20 + index + i),
          category: visitCategories[(index + i) % visitCategories.length],
          createdAt: now,
          updatedAt: now,
        });
      }
    });
    await queryInterface.bulkInsert('Visits', visits);

    const { receiptItems, receipts } = buildDemoReceiptRows(foundation);

    await queryInterface.bulkInsert('Receipts', receipts);
    await queryInterface.bulkInsert('ReceiptItems', receiptItems);

    const shifts = [];
    for (let day = 1; day <= 11; day += 1) {
      const staffId =
        day % 2 === 0
          ? staffByPhone['+79000000102']
          : staffByPhone['+79000000101'];
      shifts.push({
        ...shiftTenantScope.insert,
        date: `2026-05-${String(day).padStart(2, '0')}`,
        adminName: day % 2 === 0 ? 'Илья Смирнов' : 'Мария Орлова',
        staffId,
        hours: day % 5 === 0 ? 13 : 12,
        actualHours: day % 5 === 0 ? 13 : 12,
        status: 'closed',
        manualAdjustment: day === 7 ? 500 : 0,
        comment: '[demo] Реалистичная смена для проверки мотивации',
        createdAt: now,
        updatedAt: now,
      });
    }
    await queryInterface.bulkInsert('Shifts', shifts);

    await queryInterface.bulkInsert('Finances', [
      {
        organizationId: foundation.organization.id,
        clubId: foundation.club.id,
        date: '2026-05-03',
        category: 'Корпоративные мероприятия',
        amount: 45000,
        type: 'income',
        comment: '[demo] Корпоративная бронь на 3 корта',
        createdAt: now,
        updatedAt: now,
      },
      {
        organizationId: foundation.organization.id,
        clubId: foundation.club.id,
        date: '2026-05-04',
        category: 'Закупка бара',
        amount: 18500,
        type: 'expense',
        comment: '[demo] Вода, снеки, кофе',
        createdAt: now,
        updatedAt: now,
      },
      {
        organizationId: foundation.organization.id,
        clubId: foundation.club.id,
        date: '2026-05-06',
        category: 'Маркетинг',
        amount: 12000,
        type: 'expense',
        comment: '[demo] Таргет на турнир выходного дня',
        createdAt: now,
        updatedAt: now,
      },
      {
        organizationId: foundation.organization.id,
        clubId: foundation.club.id,
        date: '2026-05-01',
        category: 'Аренда помещения',
        amount: 180000,
        type: 'expense',
        comment: '[demo] Ежемесячная аренда клуба',
        createdAt: now,
        updatedAt: now,
      },
    ]);

    const utilization = [];
    for (let day = 1; day <= 11; day += 1) {
      utilization.push({
        ...utilizationTenantScope,
        date: `2026-05-${String(day).padStart(2, '0')}`,
        booked2: 42 + ((day * 7) % 24),
        booked1: 6 + ((day * 3) % 8),
        sessions2: 18 + ((day * 5) % 12),
        sessions1: 5 + ((day * 2) % 7),
        createdAt: now,
        updatedAt: now,
      });
    }

        await queryInterface.bulkInsert('Utilizations', utilization, {
          updateOnDuplicate: ['booked2', 'booked1', 'sessions2', 'sessions1', 'updatedAt'],
        });
      },
    );
  },

  async down(queryInterface, Sequelize) {
    return runInitializedSeederBatch(
      queryInterface,
      async (queryInterface, accountBatch, foundation) => {
        const userTenantScope = await resolveUserTenantSeederScope(
          queryInterface,
          foundation,
        );
        const utilizationTenantScope = await resolveUtilizationTenantSeederScope(
          queryInterface,
          foundation,
        );
        const shiftTenantScope = await resolveShiftTenantSeederScope(
          queryInterface,
          foundation,
        );
        const owned = await assertDemoArtifactOwnership(queryInterface, foundation);
        await cleanupDemoArtifacts(queryInterface, accountBatch, owned, Sequelize);
    await queryInterface.sequelize.query(
      'DELETE FROM MotivationBonusRuleCategories WHERE bonusRuleId IN (:bonusRuleIds)',
      { replacements: { bonusRuleIds: demoIds(DEMO_MOTIVATION_RULE_ID_START, DEMO_MOTIVATION_RULES) } },
    );
    await queryInterface.bulkDelete('MotivationBonusRules', {
      id: { [Sequelize.Op.in]: demoIds(DEMO_MOTIVATION_RULE_ID_START, DEMO_MOTIVATION_RULES) },
    });
        await queryInterface.bulkDelete('CatalogRules', {
          id: { [Sequelize.Op.in]: demoIds(DEMO_CATALOG_RULE_ID_START, DEMO_CATALOG_RULES) },
        });
      },
    );
  },
};
