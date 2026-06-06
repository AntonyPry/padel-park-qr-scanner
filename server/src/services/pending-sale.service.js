const db = require('../../models');
const certificatesService = require('./certificates.service');
const subscriptionsService = require('./subscriptions.service');

const SALE_INTENTS = ['normal', 'subscription', 'certificate'];
const PENDING_SALE_STATUSES = ['pending', 'linked', 'ignored', 'canceled'];

function appError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function normalizeKey(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeItemName(value) {
  const itemName = String(value || '').trim();
  if (!itemName) throw appError('Название товара обязательно');
  return itemName;
}

function normalizeSaleIntent(value) {
  const saleIntent = String(value || 'normal').trim();
  if (!SALE_INTENTS.includes(saleIntent)) {
    throw appError('Неизвестный тип продажи');
  }
  return saleIntent;
}

function normalizeStatus(value) {
  const status = String(value || 'pending').trim();
  if (!PENDING_SALE_STATUSES.includes(status) && status !== 'all') {
    throw appError('Неизвестный статус очереди');
  }
  return status;
}

function normalizeOptionalText(value) {
  const text = String(value || '').trim();
  return text || null;
}

function normalizeSaleSettings(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw appError('Настройки продажи должны быть объектом');
  }
  return value;
}

function serializeSaleSetting(setting) {
  if (!setting) return null;
  const raw = setting.toJSON ? setting.toJSON() : setting;
  return {
    id: raw.id,
    itemName: raw.itemName,
    saleIntent: raw.saleIntent,
    saleSettings: raw.saleSettings || null,
    createdByAccountId: raw.createdByAccountId || null,
    updatedByAccountId: raw.updatedByAccountId || null,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  };
}

function serializeAccount(account) {
  if (!account) return null;
  const raw = account.toJSON ? account.toJSON() : account;
  return {
    email: raw.email || null,
    id: raw.id,
    role: raw.role || null,
  };
}

function serializeHistory(history) {
  if (!history) return null;
  const raw = history.toJSON ? history.toJSON() : history;
  return {
    id: raw.id,
    action: raw.action,
    fromStatus: raw.fromStatus || null,
    toStatus: raw.toStatus || null,
    accountId: raw.accountId || null,
    account: serializeAccount(raw.account),
    role: raw.role || null,
    reason: raw.reason || null,
    createdAt: raw.createdAt,
  };
}

function serializeClient(client) {
  if (!client) return null;
  const raw = client.toJSON ? client.toJSON() : client;
  return {
    id: raw.id,
    name: raw.name,
    phone: raw.phone,
    status: raw.status,
  };
}

function serializePendingSale(row) {
  if (!row) return null;
  const raw = row.toJSON ? row.toJSON() : row;
  const receiptItem = raw.receiptItem || null;
  const receipt = raw.receipt || null;
  const catalogRule = raw.catalogRule || null;

  return {
    id: raw.id,
    receiptId: raw.receiptId,
    receiptItemId: raw.receiptItemId,
    saleSettingId: raw.saleSettingId || null,
    catalogRuleId: raw.catalogRuleId || null,
    itemName: raw.itemName,
    saleIntent: raw.saleIntent,
    status: raw.status,
    clientId: raw.clientId || null,
    client: serializeClient(raw.client),
    category: catalogRule?.category || raw.metadata?.category || null,
    quantity: Number(receiptItem?.quantity ?? raw.metadata?.quantity ?? 0),
    price: Number(receiptItem?.price ?? raw.metadata?.price ?? 0),
    amount: Number(receiptItem?.sum ?? raw.metadata?.amount ?? 0),
    evotorId: receipt?.evotorId || raw.metadata?.evotorId || null,
    receiptDateTime: receipt?.dateTime || raw.metadata?.receiptDateTime || null,
    receiptType: receipt?.type || raw.metadata?.receiptType || null,
    linkedAt: raw.linkedAt || null,
    ignoredAt: raw.ignoredAt || null,
    canceledAt: raw.canceledAt || null,
    statusReason: raw.statusReason || null,
    saleSetting: serializeSaleSetting(raw.saleSetting),
    clientSubscription: raw.clientSubscription
      ? subscriptionsService.serializeSubscription(raw.clientSubscription)
      : null,
    certificate: raw.certificate
      ? certificatesService.serializeCertificate(raw.certificate)
      : null,
    history: Array.isArray(raw.history)
      ? raw.history.map(serializeHistory).filter(Boolean)
      : [],
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  };
}

function buildInclude({ withHistory = false } = {}) {
  const include = [
    {
      model: db.Receipt,
      as: 'receipt',
      attributes: ['id', 'evotorId', 'dateTime', 'type', 'totalAmount'],
    },
    {
      model: db.ReceiptItem,
      as: 'receiptItem',
      attributes: ['id', 'name', 'quantity', 'price', 'sum', 'sumPrice'],
    },
    {
      model: db.EvotorSaleSetting,
      as: 'saleSetting',
      attributes: ['id', 'itemName', 'saleIntent', 'saleSettings'],
    },
    {
      model: db.CatalogRule,
      as: 'catalogRule',
      attributes: ['id', 'itemName', 'category', 'status'],
    },
    {
      model: db.User,
      as: 'client',
      attributes: ['id', 'name', 'phone', 'status'],
    },
    {
      model: db.ClientSubscription,
      as: 'clientSubscription',
      required: false,
    },
    {
      model: db.Certificate,
      as: 'certificate',
      required: false,
    },
  ];

  if (withHistory) {
    include.push({
      model: db.PendingSaleHistory,
      as: 'history',
      include: [
        {
          model: db.Account,
          as: 'account',
          attributes: ['id', 'email', 'role'],
        },
      ],
    });
  }

  return include;
}

async function findPendingSaleForResponse(id, transaction = null) {
  const pendingSale = await db.PendingSale.findByPk(id, {
    include: buildInclude({ withHistory: true }),
    transaction,
  });
  return serializePendingSale(pendingSale);
}

async function recordHistory({
  pendingSaleId,
  action,
  fromStatus,
  toStatus,
  account,
  reason,
  beforeData,
  afterData,
  transaction,
}) {
  try {
    await db.PendingSaleHistory.create(
      {
        pendingSaleId,
        action,
        fromStatus: fromStatus || null,
        toStatus: toStatus || null,
        accountId: account?.id || null,
        role: account?.role || null,
        reason: reason || null,
        beforeData: beforeData || null,
        afterData: afterData || null,
      },
      { transaction },
    );
  } catch (error) {
    console.error('Ошибка записи истории pending sale:', error);
  }
}

async function getSaleSettings() {
  const rows = await db.EvotorSaleSetting.findAll({
    order: [['itemName', 'ASC']],
  });
  return rows.map(serializeSaleSetting);
}

async function saveSaleSetting(data, account = null) {
  const itemName = normalizeItemName(data.itemName);
  const saleIntent = normalizeSaleIntent(data.saleIntent);
  const saleSettings =
    saleIntent === 'normal' ? null : normalizeSaleSettings(data.saleSettings);
  const existing = await db.EvotorSaleSetting.findOne({ where: { itemName } });

  if (existing) {
    await existing.update({
      saleIntent,
      saleSettings,
      updatedByAccountId: account?.id || null,
    });
    return serializeSaleSetting(existing);
  }

  const setting = await db.EvotorSaleSetting.create({
    itemName,
    saleIntent,
    saleSettings,
    createdByAccountId: account?.id || null,
    updatedByAccountId: account?.id || null,
  });
  return serializeSaleSetting(setting);
}

async function buildSettingMap() {
  const rows = await db.EvotorSaleSetting.findAll();
  return new Map(rows.map((row) => [normalizeKey(row.itemName), row]));
}

async function buildCatalogRuleMap() {
  const rows = await db.CatalogRule.findAll({
    where: { status: 'active' },
  });
  return new Map(rows.map((row) => [normalizeKey(row.itemName), row]));
}

function shouldCreatePendingSale(receipt, item, setting) {
  if (!setting) return false;
  if (!['subscription', 'certificate'].includes(setting.saleIntent)) return false;
  if (String(receipt.type || '').toUpperCase() === 'PAYBACK') return false;
  if (Number(item.sum) <= 0) return false;
  return true;
}

function buildPendingSaleDefaults(receipt, item, setting, catalogRule) {
  return {
    receiptId: receipt.id,
    receiptItemId: item.id,
    saleSettingId: setting.id,
    catalogRuleId: catalogRule?.id || null,
    itemName: item.name,
    saleIntent: setting.saleIntent,
    status: 'pending',
    metadata: {
      amount: Number(item.sum) || 0,
      category: catalogRule?.category || null,
      evotorId: receipt.evotorId,
      itemName: item.name,
      price: Number(item.price) || 0,
      quantity: Number(item.quantity) || 0,
      receiptDateTime: receipt.dateTime,
      receiptType: receipt.type || null,
      saleIntent: setting.saleIntent,
      saleSettings: setting.saleSettings || null,
    },
  };
}

async function createPendingSalesForReceipt(receiptId, options = {}) {
  const transaction = options.transaction || null;
  const receipt = await db.Receipt.findByPk(receiptId, {
    include: [{ model: db.ReceiptItem, as: 'items' }],
    transaction,
  });
  if (!receipt) throw appError('Чек не найден', 404);

  const [settingMap, catalogRuleMap] = await Promise.all([
    buildSettingMap(),
    buildCatalogRuleMap(),
  ]);

  const results = [];
  const items = receipt.items || [];
  for (const item of items) {
    const setting = settingMap.get(normalizeKey(item.name));
    if (!shouldCreatePendingSale(receipt, item, setting)) continue;

    const catalogRule = catalogRuleMap.get(normalizeKey(item.name)) || null;
    const defaults = buildPendingSaleDefaults(receipt, item, setting, catalogRule);

    let row;
    let created = false;
    try {
      [row, created] = await db.PendingSale.findOrCreate({
        where: { receiptItemId: item.id },
        defaults,
        transaction,
      });
    } catch (error) {
      if (error.name !== 'SequelizeUniqueConstraintError') throw error;
      row = await db.PendingSale.findOne({
        where: { receiptItemId: item.id },
        transaction,
      });
    }

    if (created) {
      await recordHistory({
        pendingSaleId: row.id,
        action: 'pending_sale.created',
        fromStatus: null,
        toStatus: 'pending',
        account: null,
        afterData: defaults,
        transaction,
      });
    }

    results.push({ created, id: row.id, receiptItemId: item.id });
  }

  return {
    created: results.filter((item) => item.created).length,
    items: results,
  };
}

async function listPendingSales(query = {}) {
  const status = normalizeStatus(query.status || 'pending');
  const saleIntent = query.saleIntent
    ? normalizeSaleIntent(query.saleIntent)
    : null;
  const where = {};

  if (status !== 'all') where.status = status;
  if (saleIntent && saleIntent !== 'normal') where.saleIntent = saleIntent;

  const rows = await db.PendingSale.findAll({
    where,
    include: buildInclude({ withHistory: true }),
    order: [['createdAt', 'DESC']],
  });

  return rows.map(serializePendingSale);
}

async function getPendingSaleForUpdate(id, transaction) {
  const pendingSale = await db.PendingSale.findByPk(id, {
    lock: transaction.LOCK.UPDATE,
    transaction,
  });
  if (!pendingSale) throw appError('Продажа из очереди не найдена', 404);
  return pendingSale;
}

async function assertClientExists(clientId, transaction) {
  const normalizedClientId = Number(clientId);
  if (!Number.isInteger(normalizedClientId) || normalizedClientId <= 0) {
    throw appError('Выберите клиента');
  }

  const client = await db.User.findOne({
    where: {
      id: normalizedClientId,
      isTraining: false,
      mergedIntoUserId: null,
      status: 'active',
    },
    transaction,
  });

  if (!client) throw appError('Активный клиент не найден', 404);
  return client;
}

async function linkPendingSale(id, data, account = null) {
  return db.sequelize.transaction(async (transaction) => {
    const pendingSale = await getPendingSaleForUpdate(id, transaction);
    if (pendingSale.status !== 'pending') {
      throw appError('Привязать можно только продажу в ожидании', 409);
    }

    const client = await assertClientExists(data.clientId, transaction);
    const beforeData = pendingSale.toJSON();
    const linkedAt = new Date();
    const reason = normalizeOptionalText(data.comment);

    await pendingSale.update(
      {
        clientId: client.id,
        linkedAt,
        linkedByAccountId: account?.id || null,
        status: 'linked',
        statusReason: reason,
      },
      { transaction },
    );

    await recordHistory({
      pendingSaleId: pendingSale.id,
      action: 'pending_sale.linked',
      fromStatus: beforeData.status,
      toStatus: 'linked',
      account,
      reason,
      beforeData,
      afterData: pendingSale.toJSON(),
      transaction,
    });

    let clientSubscription = null;
    let certificate = null;
    if (pendingSale.saleIntent === 'subscription') {
      const result = await subscriptionsService.createFromPendingSale(
        pendingSale,
        {
          account,
          transaction,
        },
      );
      clientSubscription = result.subscription;

      if (result.created) {
        await recordHistory({
          pendingSaleId: pendingSale.id,
          action: 'client_subscription.created',
          fromStatus: 'linked',
          toStatus: 'linked',
          account,
          reason,
          afterData: clientSubscription,
          transaction,
        });
      }
    } else if (pendingSale.saleIntent === 'certificate') {
      const result = await certificatesService.createFromPendingSale(
        pendingSale,
        {
          account,
          certificate: data.certificate || null,
          transaction,
        },
      );
      certificate = result.certificate;

      if (result.created) {
        await recordHistory({
          pendingSaleId: pendingSale.id,
          action: 'certificate.created',
          fromStatus: 'linked',
          toStatus: 'linked',
          account,
          reason,
          afterData: certificate,
          transaction,
        });
      }
    }

    const response = await findPendingSaleForResponse(pendingSale.id, transaction);
    if (clientSubscription) response.clientSubscription = clientSubscription;
    if (certificate) response.certificate = certificate;
    return response;
  });
}

async function ignorePendingSale(id, data, account = null) {
  return db.sequelize.transaction(async (transaction) => {
    const pendingSale = await getPendingSaleForUpdate(id, transaction);
    if (pendingSale.status !== 'pending') {
      throw appError('Игнорировать можно только продажу в ожидании', 409);
    }

    const beforeData = pendingSale.toJSON();
    const ignoredAt = new Date();
    const reason = normalizeOptionalText(data.reason);

    await pendingSale.update(
      {
        ignoredAt,
        ignoredByAccountId: account?.id || null,
        status: 'ignored',
        statusReason: reason,
      },
      { transaction },
    );

    await recordHistory({
      pendingSaleId: pendingSale.id,
      action: 'pending_sale.ignored',
      fromStatus: beforeData.status,
      toStatus: 'ignored',
      account,
      reason,
      beforeData,
      afterData: pendingSale.toJSON(),
      transaction,
    });

    return findPendingSaleForResponse(pendingSale.id, transaction);
  });
}

async function cancelPendingSale(id, data, account = null) {
  return db.sequelize.transaction(async (transaction) => {
    const pendingSale = await getPendingSaleForUpdate(id, transaction);
    if (!['pending', 'linked'].includes(pendingSale.status)) {
      throw appError('Эту продажу уже нельзя отменить', 409);
    }

    const beforeData = pendingSale.toJSON();
    const canceledAt = new Date();
    const reason = normalizeOptionalText(data.reason);

    await pendingSale.update(
      {
        canceledAt,
        canceledByAccountId: account?.id || null,
        status: 'canceled',
        statusReason: reason,
      },
      { transaction },
    );

    await recordHistory({
      pendingSaleId: pendingSale.id,
      action: 'pending_sale.canceled',
      fromStatus: beforeData.status,
      toStatus: 'canceled',
      account,
      reason,
      beforeData,
      afterData: pendingSale.toJSON(),
      transaction,
    });

    if (pendingSale.saleIntent === 'subscription') {
      await subscriptionsService.cancelFromPendingSale(
        pendingSale.id,
        account,
        reason,
        transaction,
      );
    } else if (pendingSale.saleIntent === 'certificate') {
      await certificatesService.cancelFromPendingSale(
        pendingSale.id,
        account,
        reason,
        transaction,
      );
    }

    return findPendingSaleForResponse(pendingSale.id, transaction);
  });
}

module.exports = {
  SALE_INTENTS,
  PENDING_SALE_STATUSES,
  __testing: {
    buildPendingSaleDefaults,
    normalizeItemName,
    normalizeSaleIntent,
    shouldCreatePendingSale,
  },
  cancelPendingSale,
  createPendingSalesForReceipt,
  getSaleSettings,
  ignorePendingSale,
  linkPendingSale,
  listPendingSales,
  saveSaleSetting,
};
