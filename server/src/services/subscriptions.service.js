const db = require('../../models');
const {
  bindClientMoneyActor,
  clubTenantValues,
  clubTenantWhere,
  findClubRecordByPk,
  findOrganizationRecordByPk,
  organizationTenantValues,
  organizationTenantWhere,
  resolveClientMoneyAccessContextForModel,
} = require('./client-money-access-context.service');

const SUBSCRIPTION_TYPE_STATUSES = ['active', 'archived'];
const CLIENT_SUBSCRIPTION_STATUSES = ['active', 'expired', 'used', 'canceled'];
const CLIENT_SUBSCRIPTION_REDEMPTION_STATUSES = ['active', 'reversed'];
const SERVICE_TYPES = ['training'];
const TRAINING_KINDS = ['group', 'personal'];
const TIME_SEGMENTS = ['single', 'off_peak', 'standard', 'all'];

function appError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function normalizeName(value, fieldName = 'Название') {
  const normalized = String(value || '').trim().replace(/\s+/g, ' ');
  if (normalized.length < 2) {
    throw appError(`${fieldName} должно быть не короче 2 символов`);
  }
  return normalized;
}

function normalizeOptionalText(value) {
  const text = String(value || '').trim();
  return text || null;
}

function normalizeStatus(value, allowed, fallback = 'active') {
  const status = String(value || fallback).trim();
  if (!allowed.includes(status) && status !== 'all') {
    throw appError('Некорректный статус');
  }
  return status;
}

function normalizeEnum(value, allowed, fieldName, fallback = null) {
  const normalized = String(value || fallback || '').trim();
  if (!normalized) return null;
  if (!allowed.includes(normalized)) {
    throw appError(`Некорректное значение поля ${fieldName}`);
  }
  return normalized;
}

function normalizeBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  if (['true', '1', 'yes', 'on'].includes(String(value).trim().toLowerCase())) {
    return true;
  }
  if (['false', '0', 'no', 'off'].includes(String(value).trim().toLowerCase())) {
    return false;
  }
  return Boolean(value);
}

function normalizePositiveInt(value, fieldName, fallback = null) {
  if (value === undefined || value === null || value === '') return fallback;
  const numberValue = Number(value);
  if (!Number.isInteger(numberValue) || numberValue <= 0) {
    throw appError(`${fieldName} должно быть положительным целым числом`);
  }
  return numberValue;
}

function normalizeNonNegativeInt(value, fieldName, fallback = 0) {
  if (value === undefined || value === null || value === '') return fallback;
  const numberValue = Number(value);
  if (!Number.isInteger(numberValue) || numberValue < 0) {
    throw appError(`${fieldName} должно быть неотрицательным целым числом`);
  }
  return numberValue;
}

function normalizeMoney(value, fieldName, fallback = 0) {
  if (value === undefined || value === null || value === '') return fallback;
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue) || numberValue < 0) {
    throw appError(`${fieldName} должно быть неотрицательным числом`);
  }
  return Number(numberValue.toFixed(2));
}

function normalizeMetadata(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? parsed
        : null;
    } catch {
      return null;
    }
  }
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw appError('Метаданные должны быть объектом');
  }
  return value;
}

function toNumber(value) {
  const numberValue = Number(value || 0);
  return Number.isFinite(numberValue) ? numberValue : 0;
}

function toDate(value, fallback = null) {
  if (!value) return fallback;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : date;
}

function normalizeDateTime(value, fieldName, fallback = null) {
  if (value === undefined || value === null || value === '') return fallback;
  const date = toDate(value);
  if (!date) throw appError(`${fieldName} указана некорректно`);
  return date;
}

function addDays(date, days) {
  const result = new Date(date);
  result.setDate(result.getDate() + Number(days || 0));
  return result;
}

function calculateRemaining(subscription) {
  if (subscription.isUnlimited) return null;
  const total = Number(subscription.sessionsTotal || 0);
  const used = Number(subscription.sessionsUsed || 0);
  return Math.max(0, total - used);
}

function calculateStatus(subscription, now = new Date()) {
  if (subscription.status === 'canceled') return 'canceled';
  if (subscription.expiresAt) {
    const expiresAt = toDate(subscription.expiresAt);
    if (expiresAt && expiresAt.getTime() < now.getTime()) return 'expired';
  }
  if (!subscription.isUnlimited && calculateRemaining(subscription) <= 0) {
    return 'used';
  }
  if (['expired', 'used'].includes(subscription.status)) return subscription.status;
  return 'active';
}

function serializeType(type) {
  if (!type) return null;
  const raw = type.toJSON ? type.toJSON() : type;
  return {
    id: raw.id,
    name: raw.name,
    serviceType: raw.serviceType,
    trainingKind: raw.trainingKind || null,
    timeSegment: raw.timeSegment || null,
    sessionsTotal: raw.sessionsTotal === null ? null : Number(raw.sessionsTotal || 0),
    isUnlimited: Boolean(raw.isUnlimited),
    validityDays: Number(raw.validityDays || 0),
    price: toNumber(raw.price),
    bonusPersonalSessions: Number(raw.bonusPersonalSessions || 0),
    status: raw.status,
    description: raw.description || null,
    metadata: normalizeMetadata(raw.metadata),
    createdByAccountId: raw.createdByAccountId || null,
    updatedByAccountId: raw.updatedByAccountId || null,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
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

function serializeAccount(account) {
  if (!account) return null;
  const raw = account.toJSON ? account.toJSON() : account;
  const staff = raw.Staff || raw.staff || null;
  return {
    email: raw.email || null,
    id: raw.id,
    name: staff?.name || raw.name || raw.email || null,
    role: raw.role || null,
  };
}

function serializeRedemption(redemption) {
  if (!redemption) return null;
  const raw = redemption.toJSON ? redemption.toJSON() : redemption;
  return {
    id: raw.id,
    clientSubscriptionId: raw.clientSubscriptionId,
    clientId: raw.clientId,
    quantity: Number(raw.quantity || 1),
    serviceType: raw.serviceType,
    trainingKind: raw.trainingKind || null,
    redeemedAt: raw.redeemedAt,
    redeemedByAccountId: raw.redeemedByAccountId || null,
    redeemedBy: serializeAccount(raw.redeemedBy),
    comment: raw.comment || null,
    status: raw.status || 'active',
    reversedAt: raw.reversedAt || null,
    reversedByAccountId: raw.reversedByAccountId || null,
    reversedBy: serializeAccount(raw.reversedBy),
    reversalReason: raw.reversalReason || null,
    metadata: normalizeMetadata(raw.metadata),
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  };
}

function serializeSubscription(subscription, options = {}) {
  if (!subscription) return null;
  const raw = subscription.toJSON ? subscription.toJSON() : subscription;
  const remainingSessions = calculateRemaining(raw);
  const status = calculateStatus(raw, options.now || new Date());
  const redemptions = Array.isArray(raw.redemptions)
    ? raw.redemptions
      .map(serializeRedemption)
      .filter(Boolean)
      .sort((a, b) => {
        const dateDiff =
          new Date(b.redeemedAt || b.createdAt || 0).getTime() -
          new Date(a.redeemedAt || a.createdAt || 0).getTime();
        if (dateDiff !== 0) return dateDiff;
        return Number(b.id || 0) - Number(a.id || 0);
      })
    : [];

  return {
    id: raw.id,
    clientId: raw.clientId,
    client: serializeClient(raw.client),
    subscriptionTypeId: raw.subscriptionTypeId || null,
    subscriptionType: serializeType(raw.subscriptionType),
    pendingSaleId: raw.pendingSaleId || null,
    sourceReceiptId: raw.sourceReceiptId || null,
    sourceReceiptItemId: raw.sourceReceiptItemId || null,
    source: raw.source,
    typeName: raw.typeName,
    serviceType: raw.serviceType,
    trainingKind: raw.trainingKind || null,
    timeSegment: raw.timeSegment || null,
    sessionsTotal: raw.sessionsTotal === null ? null : Number(raw.sessionsTotal || 0),
    sessionsUsed: Number(raw.sessionsUsed || 0),
    remainingSessions,
    isUnlimited: Boolean(raw.isUnlimited),
    bonusPersonalSessions: Number(raw.bonusPersonalSessions || 0),
    startsAt: raw.startsAt,
    expiresAt: raw.expiresAt || null,
    status,
    storedStatus: raw.status,
    pricePaid: toNumber(raw.pricePaid),
    saleAmount: toNumber(raw.saleAmount),
    metadata: normalizeMetadata(raw.metadata),
    createdByAccountId: raw.createdByAccountId || null,
    createdBy: serializeAccount(raw.createdBy),
    canceledAt: raw.canceledAt || null,
    canceledByAccountId: raw.canceledByAccountId || null,
    canceledBy: serializeAccount(raw.canceledBy),
    cancelReason: raw.cancelReason || null,
    redemptions,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  };
}

function buildAccountInclude(as) {
  const include = {
    model: db.Account,
    as,
    attributes: ['id', 'email', 'role', 'staffId'],
  };
  if (db.Staff) {
    include.include = [{ model: db.Staff, attributes: ['id', 'name'] }];
  }
  return include;
}

function buildRedemptionInclude() {
  return [
    buildAccountInclude('redeemedBy'),
    buildAccountInclude('reversedBy'),
  ];
}

function buildSubscriptionInclude() {
  return [
    {
      model: db.User,
      as: 'client',
      attributes: ['id', 'name', 'phone', 'status'],
    },
    {
      model: db.SubscriptionType,
      as: 'subscriptionType',
    },
    {
      model: db.Account,
      as: 'createdBy',
      attributes: ['id', 'email', 'role', 'staffId'],
      include: db.Staff ? [{ model: db.Staff, attributes: ['id', 'name'] }] : [],
    },
    {
      model: db.Account,
      as: 'canceledBy',
      attributes: ['id', 'email', 'role', 'staffId'],
      include: db.Staff ? [{ model: db.Staff, attributes: ['id', 'name'] }] : [],
    },
    {
      model: db.ClientSubscriptionRedemption,
      as: 'redemptions',
      include: buildRedemptionInclude(),
      order: [
        ['redeemedAt', 'DESC'],
        ['id', 'DESC'],
      ],
      separate: true,
    },
  ];
}

function buildTypePayload(data = {}, account = null, existing = null) {
  const payload = {};

  if (!existing || 'name' in data) {
    payload.name = normalizeName(data.name, 'Название типа абонемента');
  }

  if (!existing || 'serviceType' in data) {
    payload.serviceType = normalizeEnum(
      data.serviceType,
      SERVICE_TYPES,
      'услуга',
      existing?.serviceType || 'training',
    );
  }

  if (payload.serviceType !== 'training') {
    throw appError('Сейчас доступны только абонементы на тренировки');
  }

  if (!existing || 'trainingKind' in data) {
    payload.trainingKind = normalizeEnum(
      data.trainingKind,
      TRAINING_KINDS,
      'тип тренировки',
      existing?.trainingKind || 'group',
    );
  }

  if (!existing || 'timeSegment' in data) {
    payload.timeSegment = normalizeEnum(
      data.timeSegment,
      TIME_SEGMENTS,
      'период действия',
      existing?.timeSegment || 'all',
    );
  }

  const isUnlimited =
    'isUnlimited' in data
      ? normalizeBoolean(data.isUnlimited, Boolean(existing?.isUnlimited))
      : Boolean(existing?.isUnlimited || false);
  payload.isUnlimited = isUnlimited;

  if (isUnlimited) {
    payload.sessionsTotal = null;
  } else if (!existing || 'sessionsTotal' in data || existing.sessionsTotal === null) {
    payload.sessionsTotal = normalizePositiveInt(
      data.sessionsTotal,
      'Количество занятий',
      existing?.sessionsTotal || null,
    );
    if (!payload.sessionsTotal) {
      throw appError('Для обычного абонемента укажите количество занятий');
    }
  }

  if (!existing || 'validityDays' in data) {
    payload.validityDays = normalizePositiveInt(
      data.validityDays,
      'Срок действия',
      existing?.validityDays || 30,
    );
  }

  if (!existing || 'price' in data) {
    payload.price = normalizeMoney(data.price, 'Цена', toNumber(existing?.price));
  }

  if (!existing || 'bonusPersonalSessions' in data) {
    payload.bonusPersonalSessions = normalizeNonNegativeInt(
      data.bonusPersonalSessions,
      'Бонусные персональные тренировки',
      Number(existing?.bonusPersonalSessions || 0),
    );
  }

  if ('description' in data || !existing) {
    payload.description = normalizeOptionalText(data.description);
  }

  if ('metadata' in data) {
    payload.metadata = normalizeMetadata(data.metadata);
  }

  if (!existing) {
    payload.status = 'active';
    payload.createdByAccountId = account?.id || null;
  }
  payload.updatedByAccountId = account?.id || null;

  return payload;
}

async function assertTypeNameAvailable(
  name,
  typeId = null,
  transaction = null,
  context = null,
) {
  const where = organizationTenantWhere(context, { name });
  if (typeId) {
    where.id = { [db.Sequelize.Op.ne]: Number(typeId) };
  }

  const existing = await db.SubscriptionType.findOne({ where, transaction });
  if (existing) {
    throw appError('Тип абонемента с таким названием уже существует', 409);
  }
}

async function getTypeOrFail(id, options = {}, context = null) {
  const type = await findOrganizationRecordByPk(
    db.SubscriptionType,
    id,
    options,
    context,
  );
  if (!type) throw appError('Тип абонемента не найден', 404);
  return type;
}

async function listSubscriptionTypes(query = {}, tenant = null) {
  const context = await resolveClientMoneyAccessContextForModel(
    tenant,
    db.SubscriptionType,
  );
  const status = normalizeStatus(
    query.status || 'active',
    SUBSCRIPTION_TYPE_STATUSES,
  );
  const where = organizationTenantWhere(context);
  if (status !== 'all') where.status = status;

  const rows = await db.SubscriptionType.findAll({
    where,
    order: [
      ['status', 'ASC'],
      ['trainingKind', 'ASC'],
      ['price', 'ASC'],
      ['name', 'ASC'],
    ],
  });

  return rows.map(serializeType);
}

async function createSubscriptionType(data, account = null, tenant = null) {
  const context = await resolveClientMoneyAccessContextForModel(
    tenant,
    db.SubscriptionType,
  );
  const authorityActor = bindClientMoneyActor(account, context);
  const payload = {
    ...organizationTenantValues(context),
    ...buildTypePayload(data, authorityActor),
  };
  await assertTypeNameAvailable(payload.name, null, null, context);
  const type = await db.SubscriptionType.create(payload);
  return serializeType(type);
}

async function updateSubscriptionType(id, data, account = null, tenant = null) {
  const context = await resolveClientMoneyAccessContextForModel(
    tenant,
    db.SubscriptionType,
  );
  const authorityActor = bindClientMoneyActor(account, context);
  const type = await getTypeOrFail(id, {}, context);
  const payload = buildTypePayload(data, authorityActor, type);
  if (payload.name) {
    await assertTypeNameAvailable(payload.name, type.id, null, context);
  }
  await type.update(payload);
  return serializeType(type);
}

async function archiveSubscriptionType(id, account = null, tenant = null) {
  const context = await resolveClientMoneyAccessContextForModel(
    tenant,
    db.SubscriptionType,
  );
  const authorityActor = bindClientMoneyActor(account, context);
  const type = await getTypeOrFail(id, {}, context);
  await type.update({
    status: 'archived',
    updatedByAccountId: authorityActor?.id || null,
  });
  return serializeType(type);
}

async function restoreSubscriptionType(id, account = null, tenant = null) {
  const context = await resolveClientMoneyAccessContextForModel(
    tenant,
    db.SubscriptionType,
  );
  const authorityActor = bindClientMoneyActor(account, context);
  const type = await getTypeOrFail(id, {}, context);
  await type.update({
    status: 'active',
    updatedByAccountId: authorityActor?.id || null,
  });
  return serializeType(type);
}

async function removeArchivedSubscriptionType(id, tenant = null) {
  const context = await resolveClientMoneyAccessContextForModel(
    tenant,
    db.SubscriptionType,
  );
  const type = await getTypeOrFail(id, {}, context);
  if (type.status !== 'archived') {
    throw appError('Удалять навсегда можно только типы из архива', 409);
  }

  const [usageCount, saleSettings] = await Promise.all([
    db.ClientSubscription.count({
      where: organizationTenantWhere(context, { subscriptionTypeId: type.id }),
    }),
    db.EvotorSaleSetting.findAll({
      attributes: ['id', 'itemName', 'saleIntent', 'saleSettings'],
      where: organizationTenantWhere(context, { saleIntent: 'subscription' }),
    }),
  ]);
  if (usageCount > 0) {
    throw appError(
      'Тип абонемента нельзя удалить: по нему уже есть клиентские абонементы. Оставьте его в архиве.',
      409,
    );
  }

  const linkedSetting = saleSettings.find(
    (setting) =>
      extractSubscriptionTypeId(normalizeMetadata(setting.saleSettings)) ===
      Number(type.id),
  );
  if (linkedSetting) {
    throw appError(
      `Тип абонемента нельзя удалить: он выбран в настройке продажи Эвотора «${linkedSetting.itemName}». Сначала измените настройку товара.`,
      409,
    );
  }

  await type.destroy();
  return { success: true };
}

async function assertClientExists(clientId, transaction = null, context = null) {
  const normalizedClientId = Number(clientId);
  if (!Number.isInteger(normalizedClientId) || normalizedClientId <= 0) {
    throw appError('Некорректный клиент');
  }

  const client = await db.User.findOne({
    where: organizationTenantWhere(context, {
      id: normalizedClientId,
      isTraining: false,
      mergedIntoUserId: null,
    }),
    transaction,
  });
  if (!client) throw appError('Клиент не найден', 404);
  return client;
}

async function listClientSubscriptions(clientId, query = {}, tenant = null) {
  const context = await resolveClientMoneyAccessContextForModel(
    tenant,
    db.ClientSubscription,
  );
  await assertClientExists(clientId, null, context);
  const status = normalizeStatus(
    query.status || 'all',
    CLIENT_SUBSCRIPTION_STATUSES,
    'all',
  );
  const rows = await db.ClientSubscription.findAll({
    where: clubTenantWhere(context, { clientId: Number(clientId) }),
    include: buildSubscriptionInclude(),
    order: [
      ['startsAt', 'DESC'],
      ['id', 'DESC'],
    ],
  });
  const items = rows.map(serializeSubscription);
  if (status === 'all') return items;
  return items.filter((item) => item.status === status);
}

async function getClientSubscription(id, tenant = null) {
  const context = await resolveClientMoneyAccessContextForModel(
    tenant,
    db.ClientSubscription,
  );
  const row = await findClubRecordByPk(db.ClientSubscription, id, {
    include: buildSubscriptionInclude(),
  }, context);
  if (!row) throw appError('Абонемент клиента не найден', 404);
  return serializeSubscription(row);
}

async function issueClientSubscription(
  clientId,
  data = {},
  account = null,
  tenant = null,
) {
  const context = await resolveClientMoneyAccessContextForModel(
    tenant,
    db.ClientSubscription,
  );
  const authorityActor = bindClientMoneyActor(account, context);

  return db.sequelize.transaction(async (transaction) => {
    const [client, type] = await Promise.all([
      assertClientExists(clientId, transaction, context),
      getTypeOrFail(data.subscriptionTypeId, { transaction }, context),
    ]);
    if (type.status !== 'active') {
      throw appError('Нельзя выдать архивный тип абонемента', 409);
    }

    const startsAt = normalizeDateTime(data.startsAt, 'Дата начала', new Date());
    const expiresAt = type.validityDays
      ? addDays(startsAt, Number(type.validityDays))
      : null;
    const saleAmount = normalizeMoney(data.saleAmount, 'Сумма оплаты', 0);
    const paymentMethod = normalizeEnum(
      data.paymentMethod,
      ['unknown', 'cash', 'cashless', 'mixed'],
      'способ оплаты',
      'unknown',
    );

    const created = await db.ClientSubscription.create(
      {
        ...clubTenantValues(context),
        bonusPersonalSessions: Number(type.bonusPersonalSessions || 0),
        clientId: client.id,
        createdByAccountId: authorityActor?.id || null,
        expiresAt,
        isUnlimited: Boolean(type.isUnlimited),
        metadata: {
          comment: normalizeOptionalText(data.comment),
          issuedManually: true,
          paymentMethod,
          subscriptionTypeSnapshot: serializeType(type),
        },
        pricePaid: saleAmount,
        saleAmount,
        serviceType: type.serviceType,
        sessionsTotal: type.sessionsTotal,
        sessionsUsed: 0,
        source: 'manual',
        startsAt,
        status: 'active',
        subscriptionTypeId: type.id,
        timeSegment: type.timeSegment,
        trainingKind: type.trainingKind,
        typeName: type.name,
      },
      { transaction },
    );

    return findClientSubscriptionForResponse(created.id, transaction, context);
  });
}

async function findClientSubscriptionForUpdate(id, transaction, context = null) {
  const row = await findClubRecordByPk(db.ClientSubscription, id, {
    transaction,
    lock: transaction?.LOCK?.UPDATE,
  }, context);
  if (!row) throw appError('Абонемент клиента не найден', 404);
  return row;
}

async function findClientSubscriptionForResponse(
  id,
  transaction = null,
  context = null,
) {
  const row = await findClubRecordByPk(db.ClientSubscription, id, {
    include: buildSubscriptionInclude(),
    transaction,
  }, context);
  if (!row) throw appError('Абонемент клиента не найден', 404);
  return serializeSubscription(row);
}

async function findRedemptionForResponse(id, transaction = null, context = null) {
  const row = await findClubRecordByPk(db.ClientSubscriptionRedemption, id, {
    include: buildRedemptionInclude(),
    transaction,
  }, context);
  return serializeRedemption(row);
}

function calculateStatusAfterUsage(subscription, sessionsUsed, now = new Date()) {
  const raw = subscription.toJSON ? subscription.toJSON() : subscription;
  const baseStatus = raw.status === 'canceled' ? 'canceled' : 'active';
  return calculateStatus(
    {
      ...raw,
      sessionsUsed,
      status: baseStatus,
    },
    now,
  );
}

function buildRedemptionPayload(
  subscription,
  data = {},
  account = null,
  context = null,
) {
  const raw = subscription.toJSON ? subscription.toJSON() : subscription;
  const now = new Date();
  const quantity = normalizePositiveInt(data.quantity, 'Количество занятий', 1);
  const serviceType = normalizeEnum(
    data.serviceType,
    SERVICE_TYPES,
    'услуга',
    raw.serviceType || 'training',
  );
  const trainingKind = normalizeEnum(
    data.trainingKind,
    TRAINING_KINDS,
    'тип тренировки',
    raw.trainingKind || null,
  );

  return {
    ...clubTenantValues(context),
    clientSubscriptionId: raw.id,
    clientId: raw.clientId,
    quantity,
    serviceType,
    trainingKind,
    redeemedAt: normalizeDateTime(data.redeemedAt, 'Дата списания', now),
    redeemedByAccountId: account?.id || null,
    comment: normalizeOptionalText(data.comment),
    status: 'active',
    metadata: normalizeMetadata(data.metadata),
  };
}

function assertCanRedeemSubscription(subscription, quantity, now = new Date()) {
  const raw = subscription.toJSON ? subscription.toJSON() : subscription;
  const status = calculateStatus(raw, now);
  if (status !== 'active') {
    throw appError('Списывать можно только активный абонемент', 409);
  }

  if (!raw.isUnlimited) {
    const remaining = calculateRemaining(raw);
    if (quantity > remaining) {
      throw appError('Недостаточно занятий для списания', 409);
    }
  }
}

async function listClientSubscriptionRedemptions(subscriptionId, tenant = null) {
  const context = await resolveClientMoneyAccessContextForModel(
    tenant,
    db.ClientSubscriptionRedemption,
  );
  const subscription = await findClubRecordByPk(
    db.ClientSubscription,
    subscriptionId,
    {
    attributes: ['id'],
    },
    context,
  );
  if (!subscription) throw appError('Абонемент клиента не найден', 404);

  const rows = await db.ClientSubscriptionRedemption.findAll({
    where: clubTenantWhere(context, {
      clientSubscriptionId: Number(subscriptionId),
    }),
    include: buildRedemptionInclude(),
    order: [
      ['redeemedAt', 'DESC'],
      ['id', 'DESC'],
    ],
  });

  return rows.map(serializeRedemption);
}

async function redeemClientSubscription(
  subscriptionId,
  data = {},
  account = null,
  tenant = null,
) {
  return db.sequelize.transaction(async (transaction) => {
    const context = await resolveClientMoneyAccessContextForModel(
      tenant,
      db.ClientSubscriptionRedemption,
      { lock: true, transaction },
    );
    const authorityActor = bindClientMoneyActor(account, context);
    const subscription = await findClientSubscriptionForUpdate(
      subscriptionId,
      transaction,
      context,
    );
    const payload = buildRedemptionPayload(
      subscription,
      data,
      authorityActor,
      context,
    );
    assertCanRedeemSubscription(subscription, payload.quantity);

    const currentUsed = Number(subscription.sessionsUsed || 0);
    const sessionsUsed = currentUsed + payload.quantity;
    const status = calculateStatusAfterUsage(subscription, sessionsUsed);
    const redemption = await db.ClientSubscriptionRedemption.create(payload, {
      transaction,
    });

    await subscription.update(
      {
        sessionsUsed,
        status,
      },
      { transaction },
    );

    return {
      redemption: await findRedemptionForResponse(
        redemption.id,
        transaction,
        context,
      ),
      subscription: await findClientSubscriptionForResponse(
        subscription.id,
        transaction,
        context,
      ),
    };
  });
}

async function reverseClientSubscriptionRedemption(
  subscriptionId,
  redemptionId,
  data = {},
  account = null,
  tenant = null,
) {
  return db.sequelize.transaction(async (transaction) => {
    const context = await resolveClientMoneyAccessContextForModel(
      tenant,
      db.ClientSubscriptionRedemption,
      { lock: true, transaction },
    );
    const authorityActor = bindClientMoneyActor(account, context);
    const subscription = await findClientSubscriptionForUpdate(
      subscriptionId,
      transaction,
      context,
    );
    const redemption = await db.ClientSubscriptionRedemption.findOne({
      where: clubTenantWhere(context, {
        id: Number(redemptionId),
        clientSubscriptionId: Number(subscriptionId),
      }),
      transaction,
      lock: transaction?.LOCK?.UPDATE,
    });
    if (!redemption) throw appError('Списание абонемента не найдено', 404);
    if (redemption.status === 'reversed') {
      throw appError('Это списание уже отменено', 409);
    }

    const quantity = Number(redemption.quantity || 1);
    const sessionsUsed = Math.max(0, Number(subscription.sessionsUsed || 0) - quantity);
    const status = calculateStatusAfterUsage(subscription, sessionsUsed);

    await redemption.update(
      {
        status: 'reversed',
        reversedAt: new Date(),
        reversedByAccountId: authorityActor?.id || null,
        reversalReason: normalizeOptionalText(data.reason),
      },
      { transaction },
    );
    await subscription.update(
      {
        sessionsUsed,
        status,
      },
      { transaction },
    );

    return {
      redemption: await findRedemptionForResponse(
        redemption.id,
        transaction,
        context,
      ),
      subscription: await findClientSubscriptionForResponse(
        subscription.id,
        transaction,
        context,
      ),
    };
  });
}

function extractSubscriptionTypeId(...settingsList) {
  for (const settings of settingsList) {
    if (!settings || typeof settings !== 'object') continue;
    const candidates = [
      settings.subscriptionTypeId,
      settings.typeId,
      settings.subscriptionType?.id,
    ];
    for (const candidate of candidates) {
      const id = Number(candidate);
      if (Number.isInteger(id) && id > 0) return id;
    }
  }
  return null;
}

async function findTypeForPendingSale(
  pendingSale,
  saleSetting,
  transaction,
  context = null,
) {
  const metadata = normalizeMetadata(pendingSale.metadata) || {};
  const saleSettings = normalizeMetadata(saleSetting?.saleSettings) || null;
  const subscriptionTypeId = extractSubscriptionTypeId(
    saleSettings,
    metadata.saleSettings,
  );

  if (subscriptionTypeId) {
    const type = await findOrganizationRecordByPk(
      db.SubscriptionType,
      subscriptionTypeId,
      { transaction },
      context,
    );
    if (!type) throw appError('Тип абонемента из настройки продажи не найден', 404);
    if (type.status !== 'active') {
      throw appError('Тип абонемента из настройки продажи находится в архиве', 409);
    }
    return type;
  }

  const byName = await db.SubscriptionType.findOne({
    where: organizationTenantWhere(context, {
      name: pendingSale.itemName,
      status: 'active',
    }),
    transaction,
  });
  if (byName) return byName;

  throw appError(
    'Для продажи абонемента выберите тип абонемента в настройке товара Эвотор',
    409,
  );
}

async function loadPendingSaleContext(pendingSale, transaction, context = null) {
  const pendingSaleId = Number(pendingSale?.id || pendingSale);
  const row = await findClubRecordByPk(db.PendingSale, pendingSaleId, {
    include: [
      {
        model: db.EvotorSaleSetting,
        as: 'saleSetting',
      },
      {
        model: db.Receipt,
        as: 'receipt',
        attributes: ['id', 'evotorId', 'dateTime', 'type'],
      },
      {
        model: db.ReceiptItem,
        as: 'receiptItem',
        attributes: ['id', 'name', 'quantity', 'price', 'sum', 'sumPrice'],
      },
    ],
    transaction,
  }, context);
  if (!row) throw appError('Продажа из очереди не найдена', 404);
  return row;
}

function buildSubscriptionDefaults(
  pendingSale,
  type,
  account = null,
  context = null,
) {
  const raw = pendingSale.toJSON ? pendingSale.toJSON() : pendingSale;
  const typeRaw = type.toJSON ? type.toJSON() : type;
  const metadata = normalizeMetadata(raw.metadata) || {};
  const receipt = raw.receipt || null;
  const receiptItem = raw.receiptItem || null;
  const startsAt =
    toDate(receipt?.dateTime) ||
    toDate(metadata.receiptDateTime) ||
    toDate(raw.linkedAt) ||
    new Date();
  const validityDays = Number(typeRaw.validityDays || 30);
  const saleAmount = toNumber(receiptItem?.sum ?? metadata.amount ?? typeRaw.price);

  return {
    ...clubTenantValues(context),
    clientId: raw.clientId,
    subscriptionTypeId: typeRaw.id,
    pendingSaleId: raw.id,
    sourceReceiptId: raw.receiptId || receipt?.id || null,
    sourceReceiptItemId: raw.receiptItemId || receiptItem?.id || null,
    source: 'evotor_pending_sale',
    typeName: typeRaw.name,
    serviceType: typeRaw.serviceType,
    trainingKind: typeRaw.trainingKind || null,
    timeSegment: typeRaw.timeSegment || null,
    sessionsTotal: typeRaw.isUnlimited ? null : Number(typeRaw.sessionsTotal || 0),
    sessionsUsed: 0,
    isUnlimited: Boolean(typeRaw.isUnlimited),
    bonusPersonalSessions: Number(typeRaw.bonusPersonalSessions || 0),
    startsAt,
    expiresAt: validityDays > 0 ? addDays(startsAt, validityDays) : null,
    status: 'active',
    pricePaid: toNumber(typeRaw.price),
    saleAmount,
    metadata: {
      evotorId: receipt?.evotorId || metadata.evotorId || null,
      itemName: raw.itemName,
      pendingSaleId: raw.id,
      receiptItemName: receiptItem?.name || raw.itemName,
      saleIntent: raw.saleIntent,
      subscriptionTypeSnapshot: serializeType(typeRaw),
    },
    createdByAccountId: account?.id || raw.linkedByAccountId || null,
  };
}

async function findExistingSubscriptionForSale(
  pendingSale,
  transaction,
  context = null,
) {
  const raw = pendingSale.toJSON ? pendingSale.toJSON() : pendingSale;
  const or = [];
  if (raw.id) or.push({ pendingSaleId: raw.id });
  if (raw.receiptItemId) or.push({ sourceReceiptItemId: raw.receiptItemId });
  if (or.length === 0) return null;

  return db.ClientSubscription.findOne({
    where: clubTenantWhere(context, { [db.Sequelize.Op.or]: or }),
    include: buildSubscriptionInclude(),
    transaction,
  });
}

async function createFromPendingSale(pendingSale, options = {}) {
  const transaction = options.transaction || null;
  const context = await resolveClientMoneyAccessContextForModel(
    options.tenant || null,
    db.ClientSubscription,
    { transaction },
  );
  const account = bindClientMoneyActor(options.account || null, context);
  const row = await loadPendingSaleContext(pendingSale, transaction, context);
  const raw = row.toJSON ? row.toJSON() : row;

  if (raw.saleIntent !== 'subscription') {
    return { created: false, subscription: null };
  }
  if (raw.status !== 'linked' || !raw.clientId) {
    throw appError('Абонемент можно создать только после привязки продажи к клиенту', 409);
  }

  const existing = await findExistingSubscriptionForSale(
    row,
    transaction,
    context,
  );
  if (existing) {
    return {
      created: false,
      subscription: serializeSubscription(existing),
    };
  }

  const type = await findTypeForPendingSale(
    row,
    raw.saleSetting,
    transaction,
    context,
  );
  const defaults = buildSubscriptionDefaults(row, type, account, context);
  let subscription;

  try {
    subscription = await db.ClientSubscription.create(defaults, {
      transaction,
    });
  } catch (error) {
    if (error.name !== 'SequelizeUniqueConstraintError') throw error;
    subscription = await findExistingSubscriptionForSale(
      row,
      transaction,
      context,
    );
  }

  const withInclude = await findClubRecordByPk(
    db.ClientSubscription,
    subscription.id,
    {
    include: buildSubscriptionInclude(),
    transaction,
    },
    context,
  );

  return {
    created: true,
    subscription: serializeSubscription(withInclude || subscription),
  };
}

async function cancelFromPendingSale(
  pendingSaleId,
  account = null,
  reason = null,
  transaction = null,
  tenant = null,
) {
  const context = await resolveClientMoneyAccessContextForModel(
    tenant,
    db.ClientSubscription,
    { transaction },
  );
  const authorityActor = bindClientMoneyActor(account, context);
  const subscription = await db.ClientSubscription.findOne({
    where: clubTenantWhere(context, { pendingSaleId: Number(pendingSaleId) }),
    transaction,
  });
  if (!subscription || subscription.status === 'canceled') return null;

  await subscription.update(
    {
      canceledAt: new Date(),
      canceledByAccountId: authorityActor?.id || null,
      cancelReason: normalizeOptionalText(reason),
      status: 'canceled',
    },
    { transaction },
  );

  return serializeSubscription(subscription);
}

module.exports = {
  CLIENT_SUBSCRIPTION_REDEMPTION_STATUSES,
  CLIENT_SUBSCRIPTION_STATUSES,
  SERVICE_TYPES,
  SUBSCRIPTION_TYPE_STATUSES,
  TIME_SEGMENTS,
  TRAINING_KINDS,
  archiveSubscriptionType,
  calculateRemaining,
  calculateStatus,
  cancelFromPendingSale,
  createFromPendingSale,
  createSubscriptionType,
  getClientSubscription,
  issueClientSubscription,
  listClientSubscriptionRedemptions,
  listClientSubscriptions,
  listSubscriptionTypes,
  removeArchivedSubscriptionType,
  redeemClientSubscription,
  reverseClientSubscriptionRedemption,
  restoreSubscriptionType,
  serializeRedemption,
  serializeSubscription,
  serializeType,
  updateSubscriptionType,
  __testing: {
    buildSubscriptionDefaults,
    extractSubscriptionTypeId,
  },
};
