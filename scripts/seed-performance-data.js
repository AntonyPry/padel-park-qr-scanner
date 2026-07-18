#!/usr/bin/env node

const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const db = require(path.join(ROOT, 'server', 'models'));
const accountLifecycle = require(path.join(
  ROOT,
  'server',
  'src',
  'services',
  'account-lifecycle.service',
));
let fixtureContext = null;

const DEFAULT_OPTIONS = {
  callTaskClientCount: 15000,
  cleanupOnly: false,
  clients: 5000,
  receipts: 6000,
  visits: 40000,
};

const SOURCES = [
  'Instagram',
  'Telegram',
  'VK',
  'Рекомендация',
  '2ГИС',
  'Яндекс Карты',
  'Ресепшн',
  'Турнир',
];
const VISIT_CATEGORIES = [
  'Игра 2х2',
  'Групповая тренировка',
  'Индивидуальная тренировка',
  'Турнир',
  'Первый раз',
  'Сплит',
];
const RECEIPT_ITEMS = [
  ['Аренда корта 90 минут', 5850, 'SERVICE'],
  ['Аренда корта 60 минут', 3900, 'SERVICE'],
  ['Капучино', 280, 'COMMODITY'],
  ['Вода 0.5', 180, 'COMMODITY'],
  ['Молочный коктейль', 360, 'COMMODITY'],
  ['Мячи Head Pro', 1450, 'COMMODITY'],
  ['VIP раздевалка', 1200, 'SERVICE'],
  ['Овергрип Wilson', 450, 'COMMODITY'],
];

function parseArgs(argv) {
  const options = { ...DEFAULT_OPTIONS };
  argv.forEach((arg) => {
    const [key, value] = arg.replace(/^--/, '').split('=');
    if (key === 'cleanup-only') options.cleanupOnly = true;
    if (key === 'clients') options.clients = Number(value);
    if (key === 'visits') options.visits = Number(value);
    if (key === 'receipts') options.receipts = Number(value);
    if (key === 'call-task-clients') options.callTaskClientCount = Number(value);
  });

  return {
    callTaskClientCount: Math.max(0, options.callTaskClientCount || 0),
    cleanupOnly: options.cleanupOnly,
    clients: Math.max(100, options.clients || DEFAULT_OPTIONS.clients),
    receipts: Math.max(0, options.receipts || 0),
    visits: Math.max(0, options.visits || 0),
  };
}

function chunk(items, size = 1000) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

async function bulkCreateInChunks(model, rows, options = {}) {
  for (const part of chunk(rows, options.chunkSize || 1000)) {
    await model.bulkCreate(part, {
      ignoreDuplicates: true,
      validate: false,
      ...options,
    });
  }
}

async function resolveFixtureContext() {
  const foundation = await db.sequelize.transaction((transaction) =>
    accountLifecycle._private.lockDefaultFoundation(transaction));
  const membership = await db.Membership.findOne({
    order: [['id', 'ASC']],
    where: {
      organizationId: foundation.organization.id,
      status: 'active',
    },
  });
  if (!membership) throw new Error('Performance fixture requires an active default Membership');
  return Object.freeze({
    accountId: Number(membership.accountId),
    clubId: Number(foundation.club.id),
    organizationId: Number(foundation.organization.id),
  });
}

function dateFromIndex(index, hourOffset = 0) {
  const date = new Date(Date.UTC(2026, 4, 1, 6, 0, 0));
  date.setUTCDate(date.getUTCDate() + (index % 90));
  date.setUTCHours(6 + ((index + hourOffset) % 15), (index * 7) % 60, 0, 0);
  return date;
}

async function cleanup() {
  const users = await db.User.findAll({
    attributes: ['id'],
    raw: true,
    where: {
      organizationId: fixtureContext.organizationId,
      phone: {
        [db.Sequelize.Op.like]: '+7988%',
      },
    },
  });
  const userIds = users.map((user) => user.id);

  const callTasks = await db.CallTask.findAll({
    attributes: ['id'],
    raw: true,
    where: {
      organizationId: fixtureContext.organizationId,
      clubId: fixtureContext.clubId,
      title: {
        [db.Sequelize.Op.like]: '[perf]%',
      },
    },
  });
  const callTaskIds = callTasks.map((task) => task.id);

  const clientBases = await db.ClientBase.findAll({
    attributes: ['id'],
    raw: true,
    where: {
      organizationId: fixtureContext.organizationId,
      clubId: fixtureContext.clubId,
      name: {
        [db.Sequelize.Op.like]: '[perf]%',
      },
    },
  });
  const clientBaseIds = clientBases.map((base) => base.id);

  if (callTaskIds.length > 0) {
    const taskClients = await db.CallTaskClient.findAll({
      attributes: ['id'],
      raw: true,
      where: { callTaskId: { [db.Sequelize.Op.in]: callTaskIds } },
    });
    const taskClientIds = taskClients.map((item) => item.id);
    if (taskClientIds.length > 0) {
      await db.CallTaskAttempt.destroy({
        where: { callTaskClientId: { [db.Sequelize.Op.in]: taskClientIds } },
      });
    }
    await db.CallTaskClient.destroy({
      where: { callTaskId: { [db.Sequelize.Op.in]: callTaskIds } },
    });
    await db.CallTask.destroy({
      where: { id: { [db.Sequelize.Op.in]: callTaskIds } },
    });
  }

  if (clientBaseIds.length > 0) {
    await db.ClientBase.destroy({
      where: { id: { [db.Sequelize.Op.in]: clientBaseIds } },
    });
  }

  if (userIds.length > 0) {
    await db.TrainingNote.destroy({
      where: {
        clubId: fixtureContext.clubId,
        userId: { [db.Sequelize.Op.in]: userIds },
      },
    });
    await db.Visit.destroy({
      where: { userId: { [db.Sequelize.Op.in]: userIds } },
    });
    await db.User.destroy({
      where: { id: { [db.Sequelize.Op.in]: userIds } },
    });
  }

  const receiptIds = (
    await db.Receipt.findAll({
      attributes: ['id'],
      raw: true,
      where: {
        organizationId: fixtureContext.organizationId,
        clubId: fixtureContext.clubId,
        evotorId: {
          [db.Sequelize.Op.like]: 'perf-%',
        },
      },
    })
  ).map((receipt) => receipt.id);

  if (receiptIds.length > 0) {
    await db.ReceiptItem.destroy({
      where: { receiptId: { [db.Sequelize.Op.in]: receiptIds } },
    });
    await db.Receipt.destroy({
      where: { id: { [db.Sequelize.Op.in]: receiptIds } },
    });
  }
}

async function seedClients(options) {
  const now = new Date();
  const users = Array.from({ length: options.clients }, (_, index) => {
    const serial = String(index + 1).padStart(6, '0');
    const isArchived = index % 23 === 0;
    return {
      createdAt: dateFromIndex(index),
      organizationId: fixtureContext.organizationId,
      name: `[perf] Клиент ${serial}`,
      phone: `+7988${serial}`,
      phoneNormalized: `988${serial}`,
      source: SOURCES[index % SOURCES.length],
      status: isArchived ? 'archived' : 'active',
      telegramId: `perf_tg_${serial}`,
      updatedAt: now,
      vkId: `perf_vk_${serial}`,
      webId: `perf_web_${serial}`,
    };
  });

  await bulkCreateInChunks(db.User, users, { chunkSize: 1000 });

  return db.User.findAll({
    attributes: ['id', 'name', 'phone', 'source', 'status'],
    order: [['id', 'ASC']],
    raw: true,
    where: {
      organizationId: fixtureContext.organizationId,
      phone: {
        [db.Sequelize.Op.like]: '+7988%',
      },
    },
  });
}

async function seedVisits(users, options) {
  const activeUsers = users.filter((user) => user.status === 'active');
  const rows = Array.from({ length: options.visits }, (_, index) => {
    const user = activeUsers[index % activeUsers.length];
    const scannedAt = dateFromIndex(index, index % 5);
    return {
      category: VISIT_CATEGORIES[index % VISIT_CATEGORIES.length],
      organizationId: fixtureContext.organizationId,
      clubId: fixtureContext.clubId,
      clientEventId: `perf-event-${index + 1}`,
      createdAt: scannedAt,
      entrySource: index % 5 === 0 ? 'manual' : 'qr',
      keyNumber: index % 3 === 0 ? String(100 + (index % 900)) : null,
      scannedAt,
      updatedAt: scannedAt,
      userId: user.id,
    };
  });

  await bulkCreateInChunks(db.Visit, rows, { chunkSize: 1500 });
}

async function seedTrainingNotes(users) {
  const activeUsers = users.filter((user) => user.status === 'active');
  const account = await db.Account.findByPk(fixtureContext.accountId);
  if (!account) return;

  const levels = ['D', 'D+', 'C', 'C+', 'B', 'B+', 'A'];
  const rows = activeUsers.slice(0, 2500).map((user, index) => ({
    createdAt: dateFromIndex(index),
    clubId: fixtureContext.clubId,
    exercises: 'Разминка, удары справа/слева, игра на счет',
    level: levels[index % levels.length],
    note: `[perf] Тренировочная заметка ${index + 1}`,
    trainedAt: dateFromIndex(index),
    trainerAccountId: account.id,
    updatedAt: dateFromIndex(index),
    userId: user.id,
  }));

  await bulkCreateInChunks(db.TrainingNote, rows, { chunkSize: 1000 });
}

async function seedReceipts(options) {
  const receipts = [];
  const receiptItems = [];

  for (let index = 0; index < options.receipts; index += 1) {
    const dateTime = dateFromIndex(index, 2);
    const firstItem = RECEIPT_ITEMS[index % RECEIPT_ITEMS.length];
    const secondItem = RECEIPT_ITEMS[(index + 3) % RECEIPT_ITEMS.length];
    const firstSum = firstItem[1];
    const secondQuantity = 1 + (index % 3);
    const secondSum = secondItem[1] * secondQuantity;
    const totalAmount = firstSum + secondSum;
    const isCash = index % 4 === 0;

    receipts.push({
      organizationId: fixtureContext.organizationId,
      clubId: fixtureContext.clubId,
      cash: isCash ? totalAmount : 0,
      cashless: isCash ? 0 : totalAmount,
      createdAt: dateTime,
      dateTime,
      employeeId: index % 2 === 0 ? 'perf-admin-a' : 'perf-admin-b',
      evotorId: `perf-${index + 1}`,
      paymentParseStatus: 'parsed',
      paymentSource: isCash ? 'CASH' : 'PAY_CARD',
      shiftId: `perf-shift-${index % 60}`,
      totalAmount,
      type: 'SELL',
      updatedAt: dateTime,
    });

    receiptItems.push(
      {
        createdAt: dateTime,
        itemType: firstItem[2],
        name: firstItem[0],
        price: firstItem[1],
        quantity: 1,
        receiptId: null,
        sum: firstSum,
        sumPrice: firstSum,
        updatedAt: dateTime,
      },
      {
        createdAt: dateTime,
        itemType: secondItem[2],
        name: secondItem[0],
        price: secondItem[1],
        quantity: secondQuantity,
        receiptId: null,
        sum: secondSum,
        sumPrice: secondSum,
        updatedAt: dateTime,
      },
    );
  }

  for (const part of chunk(receipts, 1000)) {
    await db.Receipt.bulkCreate(part, {
      ignoreDuplicates: true,
      validate: false,
    });
  }

  const savedReceipts = await db.Receipt.findAll({
    attributes: ['id', 'evotorId'],
    order: [['id', 'ASC']],
    raw: true,
    where: {
      organizationId: fixtureContext.organizationId,
      clubId: fixtureContext.clubId,
      evotorId: {
        [db.Sequelize.Op.like]: 'perf-%',
      },
    },
  });
  const receiptIdByEvotorId = new Map(
    savedReceipts.map((receipt) => [receipt.evotorId, receipt.id]),
  );
  const itemRows = [];
  for (let index = 0; index < options.receipts; index += 1) {
    const receiptId = receiptIdByEvotorId.get(`perf-${index + 1}`);
    if (!receiptId) continue;
    itemRows.push(
      { ...receiptItems[index * 2], receiptId },
      { ...receiptItems[index * 2 + 1], receiptId },
    );
  }

  await bulkCreateInChunks(db.ReceiptItem, itemRows, { chunkSize: 1500 });
}

async function seedCallTasks(users, options) {
  const now = new Date();
  const activeUsers = users.filter((user) => user.status === 'active');
  const account = await db.Account.findByPk(fixtureContext.accountId);
  const baseDefinitions = [
    ['[perf] Все активные', { status: 'active', segment: 'all' }],
    ['[perf] Новички', { status: 'active', segment: 'new' }],
    ['[perf] Постоянные', { status: 'active', segment: 'regular' }],
    ['[perf] Instagram', { status: 'active', segment: 'all', source: 'Instagram' }],
    ['[perf] Без визитов', { status: 'active', segment: 'no_visits' }],
  ];

  await db.ClientBase.bulkCreate(
    baseDefinitions.map(([name, filters], index) => ({
      createdAt: now,
      organizationId: fixtureContext.organizationId,
      clubId: fixtureContext.clubId,
      createdByAccountId: account?.id || null,
      description: '[perf] Нагрузочная база',
      filters,
      lastCalculatedAt: now,
      name,
      recurringEnabled: index < 2,
      recurringInterval: index < 2 ? 'weekly' : 'none',
      recurringNextRunAt: index < 2 ? dateFromIndex(index + 10) : null,
      recurringScopeType: index < 2 ? 'dynamic' : 'snapshot',
      recurringTime: '10:00',
      recurringTitle: `[perf] Автозадача ${index + 1}`,
      recurringWeekday: 1 + index,
      slaDays: 2 + index,
      status: 'active',
      updatedAt: now,
    })),
    { validate: false },
  );

  const bases = await db.ClientBase.findAll({
    order: [['id', 'ASC']],
    raw: true,
    where: {
      organizationId: fixtureContext.organizationId,
      clubId: fixtureContext.clubId,
      name: {
        [db.Sequelize.Op.like]: '[perf]%',
      },
    },
  });
  const tasks = [];
  for (let index = 0; index < 30; index += 1) {
    const base = bases[index % bases.length];
    tasks.push({
      assignedToAccountId: account?.id || null,
      organizationId: fixtureContext.organizationId,
      clubId: fixtureContext.clubId,
      clientBaseId: base.id,
      createdAt: now,
      createdByAccountId: account?.id || null,
      description: '[perf] Нагрузочная задача обзвона',
      dueAt: dateFromIndex(index + 30),
      scopeType: index % 3 === 0 ? 'dynamic' : 'snapshot',
      snapshotClientCount: 0,
      status: index % 7 === 0 ? 'done' : index % 2 === 0 ? 'in_progress' : 'backlog',
      title: `[perf] Обзвон ${String(index + 1).padStart(2, '0')}`,
      updatedAt: now,
    });
  }

  await db.CallTask.bulkCreate(tasks, { validate: false });

  const savedTasks = await db.CallTask.findAll({
    order: [['id', 'ASC']],
    raw: true,
    where: {
      organizationId: fixtureContext.organizationId,
      clubId: fixtureContext.clubId,
      title: {
        [db.Sequelize.Op.like]: '[perf]%',
      },
    },
  });
  const taskClients = [];
  for (let index = 0; index < options.callTaskClientCount; index += 1) {
    const task = savedTasks[index % savedTasks.length];
    const user = activeUsers[index % activeUsers.length];
    const status =
      index % 17 === 0
        ? 'booked'
        : index % 13 === 0
          ? 'refused'
          : index % 5 === 0
            ? 'callback'
            : index % 3 === 0
              ? 'no_answer'
              : 'new';

    taskClients.push({
      callTaskId: task.id,
      clientName: user.name,
      clientPhone: user.phone,
      contactedAt: status === 'new' ? null : dateFromIndex(index),
      createdAt: now,
      deadlineAt: dateFromIndex(index + 2),
      lastVisitAt: dateFromIndex(index),
      source: user.source,
      status,
      summary: status === 'new' ? null : '[perf] Короткое саммари звонка',
      updatedAt: now,
      userId: user.id,
      visitCount: 1 + (index % 20),
    });
  }

  await bulkCreateInChunks(db.CallTaskClient, taskClients, { chunkSize: 1500 });

  const counts = await db.CallTaskClient.findAll({
    attributes: [
      'callTaskId',
      [db.Sequelize.fn('COUNT', db.Sequelize.col('id')), 'count'],
    ],
    group: ['callTaskId'],
    raw: true,
    where: {
      callTaskId: {
        [db.Sequelize.Op.in]: savedTasks.map((task) => task.id),
      },
    },
  });

  for (const row of counts) {
    await db.CallTask.update(
      { snapshotClientCount: Number(row.count || 0) },
      { where: { id: row.callTaskId } },
    );
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  fixtureContext = await resolveFixtureContext();
  console.log('Cleaning previous [perf] data...');
  await cleanup();
  if (options.cleanupOnly) {
    console.log('Cleanup complete.');
    await db.sequelize.close();
    return;
  }

  console.log('Creating performance clients...');
  const users = await seedClients(options);
  console.log(`Created ${users.length} clients`);
  console.log('Creating visits...');
  await seedVisits(users, options);
  console.log('Creating training notes...');
  await seedTrainingNotes(users);
  console.log('Creating receipts...');
  await seedReceipts(options);
  console.log('Creating call bases/tasks...');
  await seedCallTasks(users, options);

  const counts = {
    CallTask: await db.CallTask.count(),
    CallTaskClient: await db.CallTaskClient.count(),
    ClientBase: await db.ClientBase.count(),
    Receipt: await db.Receipt.count(),
    ReceiptItem: await db.ReceiptItem.count(),
    User: await db.User.count(),
    Visit: await db.Visit.count(),
  };

  console.log(JSON.stringify(counts, null, 2));
  await db.sequelize.close();
}

if (require.main === module) {
  main().catch(async (error) => {
    console.error(error);
    try {
      await db.sequelize.close();
    } catch {}
    process.exit(1);
  });
}

module.exports = {
  _private: {
    cleanup,
    parseArgs,
    resolveFixtureContext,
  },
};
