const crypto = require('crypto');
const db = require('../../models');
const {
  bindClientMoneyActor,
  clubTenantValues,
  clubTenantWhere,
  findClubRecordByPk,
  organizationTenantWhere,
  resolveClientMoneyAccessContextForModel,
} = require('./client-money-access-context.service');

const CERTIFICATE_TYPES = ['money', 'service'];
const CERTIFICATE_STATUSES = ['active', 'expired', 'redeemed', 'canceled'];
const CERTIFICATE_REDEMPTION_STATUSES = ['active', 'reversed'];

function appError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function normalizeOptionalText(value) {
  const text = String(value || '').trim();
  return text || null;
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

function normalizeStatus(value, fallback = 'all') {
  const status = String(value || fallback).trim();
  if (![...CERTIFICATE_STATUSES, 'all'].includes(status)) {
    throw appError('Некорректный статус сертификата');
  }
  return status;
}

function normalizeCertificateType(value, fallback = 'money') {
  const certificateType = String(value || fallback).trim();
  if (!CERTIFICATE_TYPES.includes(certificateType)) {
    throw appError('Некорректный тип сертификата');
  }
  return certificateType;
}

function normalizeCertificateCode(value) {
  const code = String(value || '').trim().replace(/\s+/g, '-').toUpperCase();
  if (!code) return null;
  if (code.length < 3 || code.length > 64) {
    throw appError('Код сертификата должен быть от 3 до 64 символов');
  }
  if (/[^\p{L}\p{N}._-]/u.test(code)) {
    throw appError('Код сертификата может содержать буквы, цифры, точку, дефис и нижнее подчеркивание');
  }
  return code;
}

function normalizePositiveInt(value, fieldName, fallback = null) {
  if (value === undefined || value === null || value === '') return fallback;
  const numberValue = Number(value);
  if (!Number.isInteger(numberValue) || numberValue <= 0) {
    throw appError(`${fieldName} должно быть положительным целым числом`);
  }
  return numberValue;
}

function normalizeMoney(value, fieldName, fallback = null) {
  if (value === undefined || value === null || value === '') return fallback;
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue) || numberValue <= 0) {
    throw appError(`${fieldName} должно быть положительным числом`);
  }
  return Number(numberValue.toFixed(2));
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

function calculateMoneyBalance(certificate) {
  return Number(Math.max(0, toNumber(certificate.amountTotal) - toNumber(certificate.amountUsed)).toFixed(2));
}

function calculateUnitsRemaining(certificate) {
  const total = Number(certificate.unitsTotal || 0);
  const used = Number(certificate.unitsUsed || 0);
  return Math.max(0, total - used);
}

function calculateStatus(certificate, now = new Date()) {
  if (certificate.status === 'canceled') return 'canceled';
  const expiresAt = toDate(certificate.expiresAt);
  if (expiresAt && expiresAt.getTime() < now.getTime()) return 'expired';
  if (certificate.certificateType === 'money') {
    if (calculateMoneyBalance(certificate) <= 0) return 'redeemed';
  } else if (calculateUnitsRemaining(certificate) <= 0) {
    return 'redeemed';
  }
  return 'active';
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
    certificateId: raw.certificateId,
    clientId: raw.clientId,
    amount: raw.amount === null || raw.amount === undefined ? null : toNumber(raw.amount),
    quantity: raw.quantity === null || raw.quantity === undefined ? null : Number(raw.quantity || 0),
    serviceType: raw.serviceType || null,
    serviceName: raw.serviceName || null,
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

function serializeCertificate(certificate, options = {}) {
  if (!certificate) return null;
  const raw = certificate.toJSON ? certificate.toJSON() : certificate;
  const status = calculateStatus(raw, options.now || new Date());
  const redemptions = Array.isArray(raw.redemptions)
    ? raw.redemptions
      .map(serializeRedemption)
      .filter(Boolean)
      .sort((left, right) => {
        const dateDiff =
          new Date(right.redeemedAt || right.createdAt || 0).getTime() -
          new Date(left.redeemedAt || left.createdAt || 0).getTime();
        if (dateDiff !== 0) return dateDiff;
        return Number(right.id || 0) - Number(left.id || 0);
      })
    : [];

  return {
    id: raw.id,
    code: raw.code,
    clientId: raw.clientId,
    client: serializeClient(raw.client),
    pendingSaleId: raw.pendingSaleId || null,
    sourceReceiptId: raw.sourceReceiptId || null,
    sourceReceiptItemId: raw.sourceReceiptItemId || null,
    source: raw.source,
    certificateType: raw.certificateType,
    title: raw.title,
    serviceType: raw.serviceType || null,
    serviceName: raw.serviceName || null,
    amountTotal: raw.amountTotal === null || raw.amountTotal === undefined ? null : toNumber(raw.amountTotal),
    amountUsed: toNumber(raw.amountUsed),
    amountRemaining: raw.certificateType === 'money' ? calculateMoneyBalance(raw) : null,
    unitsTotal: raw.unitsTotal === null || raw.unitsTotal === undefined ? null : Number(raw.unitsTotal || 0),
    unitsUsed: Number(raw.unitsUsed || 0),
    unitsRemaining: raw.certificateType === 'service' ? calculateUnitsRemaining(raw) : null,
    startsAt: raw.startsAt,
    expiresAt: raw.expiresAt || null,
    status,
    storedStatus: raw.status,
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

function buildCertificateInclude({ withRedemptions = true } = {}) {
  const include = [
    {
      model: db.User,
      as: 'client',
      attributes: ['id', 'name', 'phone', 'status'],
    },
    buildAccountInclude('createdBy'),
    buildAccountInclude('canceledBy'),
  ];

  if (withRedemptions) {
    include.push({
      model: db.CertificateRedemption,
      as: 'redemptions',
      include: buildRedemptionInclude(),
      order: [
        ['redeemedAt', 'DESC'],
        ['id', 'DESC'],
      ],
      separate: true,
    });
  }

  return include;
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

function buildListWhere(query = {}, context = null) {
  const where = clubTenantWhere(context);
  const q = String(query.q || query.query || query.code || '').trim();
  const certificateType = query.certificateType
    ? normalizeCertificateType(query.certificateType)
    : null;

  if (certificateType) where.certificateType = certificateType;
  if (query.clientId) where.clientId = Number(query.clientId);
  if (q) {
    const like = `%${q}%`;
    where[db.Sequelize.Op.or] = [
      { code: { [db.Sequelize.Op.like]: like } },
      { title: { [db.Sequelize.Op.like]: like } },
      { serviceName: { [db.Sequelize.Op.like]: like } },
      { '$client.name$': { [db.Sequelize.Op.like]: like } },
      { '$client.phone$': { [db.Sequelize.Op.like]: like } },
    ];
  }

  return where;
}

async function listCertificates(query = {}, tenant = null) {
  const context = await resolveClientMoneyAccessContextForModel(
    tenant,
    db.Certificate,
  );
  const status = normalizeStatus(query.status || 'all', 'all');
  const rows = await db.Certificate.findAll({
    where: buildListWhere(query, context),
    include: buildCertificateInclude({ withRedemptions: false }),
    order: [
      ['createdAt', 'DESC'],
      ['id', 'DESC'],
    ],
    subQuery: false,
  });

  const items = rows.map((row) => serializeCertificate(row));
  if (status === 'all') return items;
  return items.filter((item) => item.status === status);
}

async function listClientCertificates(clientId, query = {}, tenant = null) {
  const context = await resolveClientMoneyAccessContextForModel(
    tenant,
    db.Certificate,
  );
  await assertClientExists(clientId, null, context);
  const status = normalizeStatus(query.status || 'all', 'all');
  const rows = await db.Certificate.findAll({
    where: buildListWhere({ ...query, clientId }, context),
    include: buildCertificateInclude({
      withRedemptions: query.withRedemptions === true || query.withRedemptions === 'true',
    }),
    order: [
      ['createdAt', 'DESC'],
      ['id', 'DESC'],
    ],
    subQuery: false,
  });

  const items = rows.map((row) => serializeCertificate(row));
  if (status === 'all') return items;
  return items.filter((item) => item.status === status);
}

async function getCertificate(id, tenant = null) {
  const context = await resolveClientMoneyAccessContextForModel(
    tenant,
    db.Certificate,
  );
  const row = await findClubRecordByPk(db.Certificate, id, {
    include: buildCertificateInclude(),
  }, context);
  if (!row) throw appError('Сертификат не найден', 404);
  return serializeCertificate(row);
}

async function findCertificateForUpdate(id, transaction, context = null) {
  const row = await findClubRecordByPk(db.Certificate, id, {
    transaction,
    lock: transaction?.LOCK?.UPDATE,
  }, context);
  if (!row) throw appError('Сертификат не найден', 404);
  return row;
}

async function findCertificateForResponse(id, transaction = null, context = null) {
  const row = await findClubRecordByPk(db.Certificate, id, {
    include: buildCertificateInclude(),
    transaction,
  }, context);
  if (!row) throw appError('Сертификат не найден', 404);
  return serializeCertificate(row);
}

async function findRedemptionForResponse(id, transaction = null, context = null) {
  const row = await findClubRecordByPk(db.CertificateRedemption, id, {
    include: buildRedemptionInclude(),
    transaction,
  }, context);
  return serializeRedemption(row);
}

async function assertCertificateCodeAvailable(
  code,
  certificateId = null,
  transaction = null,
  context = null,
) {
  const where = clubTenantWhere(context, { code });
  if (certificateId) where.id = { [db.Sequelize.Op.ne]: Number(certificateId) };
  const existing = await db.Certificate.findOne({ where, transaction });
  if (existing) throw appError('Сертификат с таким кодом уже существует', 409);
}

function generateCertificateCode(startsAt = new Date()) {
  const date = toDate(startsAt, new Date()).toISOString().slice(0, 10).replace(/-/g, '');
  const random = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `CERT-${date}-${random}`;
}

async function resolveCertificateCode(
  preferredCode,
  startsAt,
  transaction,
  context = null,
) {
  const manualCode = normalizeCertificateCode(preferredCode);
  if (manualCode) {
    await assertCertificateCodeAvailable(manualCode, null, transaction, context);
    return manualCode;
  }

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const code = generateCertificateCode(startsAt);
    const existing = await db.Certificate.findOne({
      where: clubTenantWhere(context, { code }),
      transaction,
    });
    if (!existing) return code;
  }

  throw appError('Не удалось сгенерировать уникальный код сертификата', 500);
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

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== '');
}

function buildCertificateSettings(pendingSale, overrides = {}) {
  const raw = pendingSale.toJSON ? pendingSale.toJSON() : pendingSale;
  const metadata = normalizeMetadata(raw.metadata) || {};
  const saleSetting = raw.saleSetting || null;
  const saleSettings = normalizeMetadata(saleSetting?.saleSettings) || {};
  const metadataSaleSettings = normalizeMetadata(metadata.saleSettings) || {};
  const overrideSettings = normalizeMetadata(overrides) || {};
  return {
    ...saleSettings,
    ...metadataSaleSettings,
    ...overrideSettings,
  };
}

async function buildCertificateDefaults(
  pendingSale,
  overrides = {},
  account = null,
  transaction = null,
  context = null,
) {
  const raw = pendingSale.toJSON ? pendingSale.toJSON() : pendingSale;
  const metadata = normalizeMetadata(raw.metadata) || {};
  const receipt = raw.receipt || null;
  const receiptItem = raw.receiptItem || null;
  const settings = buildCertificateSettings(raw, overrides);
  const startsAt =
    toDate(firstDefined(settings.startsAt, receipt?.dateTime, metadata.receiptDateTime, raw.linkedAt)) ||
    new Date();
  const validityDays = normalizePositiveInt(
    firstDefined(settings.validityDays, settings.expiresInDays),
    'Срок действия сертификата',
    365,
  );
  const expiresAt = validityDays > 0 ? addDays(startsAt, validityDays) : null;
  const certificateType = normalizeCertificateType(
    firstDefined(settings.certificateType, settings.type),
    'money',
  );
  const saleAmount = toNumber(firstDefined(receiptItem?.sum, metadata.amount, settings.saleAmount));
  const title = normalizeOptionalText(settings.title) || raw.itemName || 'Сертификат';
  const code = await resolveCertificateCode(
    settings.code,
    startsAt,
    transaction,
    context,
  );

  const defaults = {
    ...clubTenantValues(context),
    clientId: raw.clientId,
    pendingSaleId: raw.id,
    sourceReceiptId: raw.receiptId || receipt?.id || null,
    sourceReceiptItemId: raw.receiptItemId || receiptItem?.id || null,
    source: 'evotor_pending_sale',
    certificateType,
    code,
    title,
    startsAt,
    expiresAt,
    status: 'active',
    saleAmount,
    metadata: {
      certificateSettings: settings,
      evotorId: receipt?.evotorId || metadata.evotorId || null,
      itemName: raw.itemName,
      pendingSaleId: raw.id,
      receiptItemName: receiptItem?.name || raw.itemName,
      saleIntent: raw.saleIntent,
    },
    createdByAccountId: account?.id || raw.linkedByAccountId || null,
  };

  if (certificateType === 'money') {
    defaults.amountTotal = normalizeMoney(
      firstDefined(settings.amountTotal, settings.amount, saleAmount),
      'Номинал сертификата',
    );
    defaults.amountUsed = 0;
    defaults.unitsTotal = null;
    defaults.unitsUsed = 0;
    defaults.serviceType = null;
    defaults.serviceName = null;
  } else {
    defaults.amountTotal = null;
    defaults.amountUsed = 0;
    defaults.unitsTotal = normalizePositiveInt(
      firstDefined(settings.unitsTotal, settings.quantity, receiptItem?.quantity),
      'Количество услуг в сертификате',
      1,
    );
    defaults.unitsUsed = 0;
    defaults.serviceType = normalizeOptionalText(settings.serviceType) || 'training';
    defaults.serviceName = normalizeOptionalText(settings.serviceName) || title;
  }

  return defaults;
}

async function findExistingCertificateForSale(
  pendingSale,
  transaction,
  context = null,
) {
  const raw = pendingSale.toJSON ? pendingSale.toJSON() : pendingSale;
  const or = [];
  if (raw.id) or.push({ pendingSaleId: raw.id });
  if (raw.receiptItemId) or.push({ sourceReceiptItemId: raw.receiptItemId });
  if (or.length === 0) return null;

  return db.Certificate.findOne({
    where: clubTenantWhere(context, { [db.Sequelize.Op.or]: or }),
    include: buildCertificateInclude(),
    transaction,
  });
}

async function createFromPendingSale(pendingSale, options = {}) {
  const transaction = options.transaction || null;
  const context = await resolveClientMoneyAccessContextForModel(
    options.tenant || null,
    db.Certificate,
    { transaction },
  );
  const account = bindClientMoneyActor(options.account || null, context);
  const row = await loadPendingSaleContext(pendingSale, transaction, context);
  const raw = row.toJSON ? row.toJSON() : row;

  if (raw.saleIntent !== 'certificate') {
    return { certificate: null, created: false };
  }
  if (raw.status !== 'linked' || !raw.clientId) {
    throw appError('Сертификат можно создать только после привязки продажи к клиенту', 409);
  }

  const existing = await findExistingCertificateForSale(
    row,
    transaction,
    context,
  );
  if (existing) {
    return {
      certificate: serializeCertificate(existing),
      created: false,
    };
  }

  const defaults = await buildCertificateDefaults(
    row,
    options.certificate || {},
    account,
    transaction,
    context,
  );
  let certificate;

  try {
    certificate = await db.Certificate.create(defaults, { transaction });
  } catch (error) {
    if (error.name !== 'SequelizeUniqueConstraintError') throw error;
    certificate = await findExistingCertificateForSale(
      row,
      transaction,
      context,
    );
    if (!certificate) throw error;
  }

  const withInclude = await findClubRecordByPk(
    db.Certificate,
    certificate.id,
    {
    include: buildCertificateInclude(),
    transaction,
    },
    context,
  );

  return {
    certificate: serializeCertificate(withInclude || certificate),
    created: true,
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
    db.Certificate,
    { transaction },
  );
  const authorityActor = bindClientMoneyActor(account, context);
  const certificate = await db.Certificate.findOne({
    where: clubTenantWhere(context, { pendingSaleId: Number(pendingSaleId) }),
    transaction,
  });
  if (!certificate || certificate.status === 'canceled') return null;

  await certificate.update(
    {
      canceledAt: new Date(),
      canceledByAccountId: authorityActor?.id || null,
      cancelReason: normalizeOptionalText(reason),
      status: 'canceled',
    },
    { transaction },
  );

  return serializeCertificate(certificate);
}

function calculateStatusAfterUsage(certificate, usage, now = new Date()) {
  const raw = certificate.toJSON ? certificate.toJSON() : certificate;
  const baseStatus = raw.status === 'canceled' ? 'canceled' : 'active';
  return calculateStatus(
    {
      ...raw,
      ...usage,
      status: baseStatus,
    },
    now,
  );
}

function buildRedemptionPayload(
  certificate,
  data = {},
  account = null,
  context = null,
) {
  const raw = certificate.toJSON ? certificate.toJSON() : certificate;
  const now = new Date();
  const payload = {
    ...clubTenantValues(context),
    certificateId: raw.id,
    clientId: raw.clientId,
    comment: normalizeOptionalText(data.comment),
    metadata: normalizeMetadata(data.metadata),
    redeemedAt: normalizeDateTime(data.redeemedAt, 'Дата списания', now),
    redeemedByAccountId: account?.id || null,
    serviceName: raw.serviceName || null,
    serviceType: raw.serviceType || null,
    status: 'active',
  };

  if (raw.certificateType === 'money') {
    payload.amount = normalizeMoney(data.amount, 'Сумма списания');
    payload.quantity = null;
  } else {
    payload.amount = null;
    payload.quantity = normalizePositiveInt(data.quantity, 'Количество услуг', 1);
  }

  return payload;
}

function assertCanRedeemCertificate(certificate, redemptionPayload, now = new Date()) {
  const raw = certificate.toJSON ? certificate.toJSON() : certificate;
  const status = calculateStatus(raw, now);
  if (status !== 'active') {
    throw appError('Списывать можно только активный сертификат', 409);
  }

  if (raw.certificateType === 'money') {
    const balance = calculateMoneyBalance(raw);
    if (toNumber(redemptionPayload.amount) > balance) {
      throw appError('Недостаточно остатка сертификата для списания', 409);
    }
  } else {
    const remaining = calculateUnitsRemaining(raw);
    if (Number(redemptionPayload.quantity || 0) > remaining) {
      throw appError('Недостаточно услуг в сертификате для списания', 409);
    }
  }
}

async function listCertificateRedemptions(certificateId, tenant = null) {
  const context = await resolveClientMoneyAccessContextForModel(
    tenant,
    db.CertificateRedemption,
  );
  const certificate = await findClubRecordByPk(
    db.Certificate,
    certificateId,
    {
    attributes: ['id'],
    },
    context,
  );
  if (!certificate) throw appError('Сертификат не найден', 404);

  const rows = await db.CertificateRedemption.findAll({
    where: clubTenantWhere(context, { certificateId: Number(certificateId) }),
    include: buildRedemptionInclude(),
    order: [
      ['redeemedAt', 'DESC'],
      ['id', 'DESC'],
    ],
  });

  return rows.map(serializeRedemption);
}

async function redeemCertificate(
  certificateId,
  data = {},
  account = null,
  tenant = null,
) {
  return db.sequelize.transaction(async (transaction) => {
    const context = await resolveClientMoneyAccessContextForModel(
      tenant,
      db.CertificateRedemption,
      { lock: true, transaction },
    );
    const authorityActor = bindClientMoneyActor(account, context);
    const certificate = await findCertificateForUpdate(
      certificateId,
      transaction,
      context,
    );
    const payload = buildRedemptionPayload(
      certificate,
      data,
      authorityActor,
      context,
    );
    assertCanRedeemCertificate(certificate, payload);

    const usage = {};
    if (certificate.certificateType === 'money') {
      usage.amountUsed = Number(
        (toNumber(certificate.amountUsed) + toNumber(payload.amount)).toFixed(2),
      );
    } else {
      usage.unitsUsed = Number(certificate.unitsUsed || 0) + Number(payload.quantity || 0);
    }
    usage.status = calculateStatusAfterUsage(certificate, usage);

    const redemption = await db.CertificateRedemption.create(payload, {
      transaction,
    });
    await certificate.update(usage, { transaction });

    return {
      certificate: await findCertificateForResponse(
        certificate.id,
        transaction,
        context,
      ),
      redemption: await findRedemptionForResponse(
        redemption.id,
        transaction,
        context,
      ),
    };
  });
}

async function reverseCertificateRedemption(
  certificateId,
  redemptionId,
  data = {},
  account = null,
  tenant = null,
) {
  return db.sequelize.transaction(async (transaction) => {
    const context = await resolveClientMoneyAccessContextForModel(
      tenant,
      db.CertificateRedemption,
      { lock: true, transaction },
    );
    const authorityActor = bindClientMoneyActor(account, context);
    const certificate = await findCertificateForUpdate(
      certificateId,
      transaction,
      context,
    );
    const redemption = await db.CertificateRedemption.findOne({
      where: clubTenantWhere(context, {
        certificateId: Number(certificateId),
        id: Number(redemptionId),
      }),
      transaction,
      lock: transaction?.LOCK?.UPDATE,
    });
    if (!redemption) throw appError('Списание сертификата не найдено', 404);
    if (redemption.status === 'reversed') {
      throw appError('Это списание уже отменено', 409);
    }

    const usage = {};
    if (certificate.certificateType === 'money') {
      usage.amountUsed = Number(
        Math.max(0, toNumber(certificate.amountUsed) - toNumber(redemption.amount)).toFixed(2),
      );
    } else {
      usage.unitsUsed = Math.max(
        0,
        Number(certificate.unitsUsed || 0) - Number(redemption.quantity || 0),
      );
    }
    usage.status = calculateStatusAfterUsage(certificate, usage);

    await redemption.update(
      {
        reversalReason: normalizeOptionalText(data.reason),
        reversedAt: new Date(),
        reversedByAccountId: authorityActor?.id || null,
        status: 'reversed',
      },
      { transaction },
    );
    await certificate.update(usage, { transaction });

    return {
      certificate: await findCertificateForResponse(
        certificate.id,
        transaction,
        context,
      ),
      redemption: await findRedemptionForResponse(
        redemption.id,
        transaction,
        context,
      ),
    };
  });
}

module.exports = {
  CERTIFICATE_REDEMPTION_STATUSES,
  CERTIFICATE_STATUSES,
  CERTIFICATE_TYPES,
  calculateMoneyBalance,
  calculateStatus,
  calculateUnitsRemaining,
  cancelFromPendingSale,
  createFromPendingSale,
  getCertificate,
  listCertificateRedemptions,
  listCertificates,
  listClientCertificates,
  redeemCertificate,
  reverseCertificateRedemption,
  serializeCertificate,
  serializeRedemption,
  __testing: {
    buildCertificateDefaults,
    normalizeCertificateCode,
  },
};
