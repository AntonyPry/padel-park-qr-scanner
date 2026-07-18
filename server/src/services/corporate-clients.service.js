const { Op } = require('sequelize');
const xlsx = require('xlsx');
const db = require('../../models');
const onboardingService = require('./onboarding.service');
const payrollService = require('./payroll.service');
const {
  bookingTenantWhere,
  resolveBookingAccessContext,
} = require('./booking-access-context.service');
const {
  isTenantBookingsCourtsEnabled,
} = require('../tenant-context/capabilities');
const {
  resolveTrainingOperationsAccessContext,
  trainingOperationsTenantWhere,
} = require('./training-operations-access-context.service');
const {
  bindClientMoneyActor,
  clubTenantValues,
  clubTenantWhere,
  findClubRecordByPk,
  organizationTenantValues,
  organizationTenantWhere,
  resolveClientMoneyAccessContextForModel,
} = require('./client-money-access-context.service');

const CORPORATE_CLIENT_STATUSES = ['active', 'archived'];
const CORPORATE_LEDGER_ENTRY_STATUSES = ['active', 'canceled'];
const CORPORATE_LEDGER_ENTRY_TYPES = ['deposit', 'spending'];
const DEFAULT_LOW_BALANCE_THRESHOLD = 5000;

function appError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function normalizeOptionalText(value) {
  const text = String(value || '').trim().replace(/\s+/g, ' ');
  return text || null;
}

function normalizeName(value) {
  const name = normalizeOptionalText(value);
  if (!name || name.length < 2) {
    throw appError('Название компании должно быть не короче 2 символов');
  }
  if (name.length > 160) {
    throw appError('Название компании слишком длинное');
  }
  return name;
}

function normalizeStatus(value, fallback = 'active') {
  const status = String(value || fallback).trim();
  if (![...CORPORATE_CLIENT_STATUSES, 'all'].includes(status)) {
    throw appError('Некорректный статус корпоративного клиента');
  }
  return status;
}

function normalizeDateOnly(value, fieldName = 'дату операции') {
  const date = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw appError(`Укажите ${fieldName} в формате YYYY-MM-DD`);
  }
  return date;
}

function normalizeMoney(value, fieldName = 'Сумма') {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw appError(`${fieldName} должна быть положительным числом`);
  }
  return Number(amount.toFixed(2));
}

function normalizeService(value) {
  const service = normalizeOptionalText(value);
  if (!service) throw appError('Укажите услугу списания');
  if (service.length > 160) throw appError('Название услуги слишком длинное');
  return service;
}

function normalizeIncomeCategory(value) {
  const category = normalizeOptionalText(value);
  if (!category) throw appError('Выберите категорию дохода');
  if (category.length > 160) throw appError('Категория дохода слишком длинная');
  return category;
}

function normalizeOptionalFilterText(value, fieldName) {
  const text = normalizeOptionalText(value);
  if (text && text.length > 160) {
    throw appError(`${fieldName} слишком длинный`);
  }
  return text;
}

function normalizeId(value, fieldName = 'ID') {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    throw appError(`${fieldName} указан некорректно`);
  }
  return id;
}

function normalizeOptionalId(value, fieldName = 'ID') {
  if (value === undefined || value === null || value === '') return null;
  return normalizeId(value, fieldName);
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

function toSignedAmount(entry) {
  const amount = toNumber(entry.amount);
  return entry.type === 'spending' ? -amount : amount;
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

function serializeFinance(finance) {
  if (!finance) return null;
  const raw = finance.toJSON ? finance.toJSON() : finance;
  return {
    amount: toNumber(raw.amount),
    category: raw.category,
    comment: raw.comment || null,
    date: raw.date,
    id: raw.id,
    type: raw.type,
  };
}

function calculateBalance(entries = []) {
  return Number(
    entries.reduce((sum, entry) => {
      const raw = entry.toJSON ? entry.toJSON() : entry;
      if (raw.status !== 'active') return sum;
      if (raw.type === 'spending') return sum - toNumber(raw.amount);
      return sum + toNumber(raw.amount);
    }, 0).toFixed(2),
  );
}

function isLowBalance(balance, status = 'active') {
  return (
    status === 'active' &&
    balance >= 0 &&
    balance <= DEFAULT_LOW_BALANCE_THRESHOLD
  );
}

function buildBalanceReconciliation(entries = [], options = {}) {
  const activeEntries = entries.filter((entry) => entry.status === 'active');
  const activeDeposits = activeEntries.filter((entry) => entry.type === 'deposit');
  const activeSpendings = activeEntries.filter((entry) => entry.type === 'spending');
  const depositsTotal = Number(
    activeDeposits
      .reduce((sum, entry) => sum + toNumber(entry.amount), 0)
      .toFixed(2),
  );
  const spendingsTotal = Number(
    activeSpendings
      .reduce((sum, entry) => sum + toNumber(entry.amount), 0)
      .toFixed(2),
  );
  const expectedBalance = Number((depositsTotal - spendingsTotal).toFixed(2));
  const currentBalance =
    options.currentBalance === undefined
      ? expectedBalance
      : Number(toNumber(options.currentBalance).toFixed(2));
  const difference = Number((currentBalance - expectedBalance).toFixed(2));
  const financeChecks = activeDeposits.reduce(
    (summary, entry) => {
      if (!entry.financeId) {
        summary.missingFinanceId += 1;
        return summary;
      }
      if (entry.financeCreatedByLedger) {
        summary.createdFinanceIncome += 1;
      } else {
        summary.linkedFinanceIncome += 1;
      }
      if (!entry.finance) {
        summary.missingFinanceRecord += 1;
        return summary;
      }
      summary.checked += 1;
      const amountMatches =
        Math.abs(toNumber(entry.finance.amount) - toNumber(entry.amount)) < 0.01;
      const dateMatches = String(entry.finance.date || '') === String(entry.date || '');
      if (entry.finance.type !== 'income' || !amountMatches || !dateMatches) {
        summary.mismatch += 1;
      }
      return summary;
    },
    {
      checked: 0,
      createdFinanceIncome: 0,
      linkedFinanceIncome: 0,
      mismatch: 0,
      missingFinanceId: 0,
      missingFinanceRecord: 0,
    },
  );

  return {
    activeDepositsCount: activeDeposits.length,
    activeEntriesCount: activeEntries.length,
    activeSpendingsCount: activeSpendings.length,
    canceledEntriesCount: entries.filter((entry) => entry.status === 'canceled').length,
    currentBalance,
    depositsTotal,
    difference,
    expectedBalance,
    financeChecks,
    isBalanced: Math.abs(difference) < 0.01,
    lowBalance: isLowBalance(currentBalance, options.status),
    lowBalanceThreshold: DEFAULT_LOW_BALANCE_THRESHOLD,
    spendingsTotal,
  };
}

function serializeLedgerEntry(entry) {
  if (!entry) return null;
  const raw = entry.toJSON ? entry.toJSON() : entry;
  const metadata = normalizeMetadata(raw.metadata) || {};
  return {
    id: raw.id,
    corporateClientId: raw.corporateClientId,
    type: raw.type,
    status: raw.status,
    date: raw.date,
    amount: toNumber(raw.amount),
    financeId: raw.financeId || null,
    finance: serializeFinance(raw.finance),
    financeCreatedByLedger: Boolean(raw.financeCreatedByLedger),
    category: raw.category || null,
    comment: raw.comment || null,
    createdByAccountId: raw.createdByAccountId || null,
    createdBy: serializeAccount(raw.createdBy),
    canceledAt: raw.canceledAt || null,
    canceledByAccountId: raw.canceledByAccountId || null,
    canceledBy: serializeAccount(raw.canceledBy),
    cancelReason: raw.cancelReason || null,
    service: metadata.service || raw.category || null,
    participantName: metadata.participantName || metadata.clientName || null,
    clientId: metadata.clientId || null,
    clientName: metadata.clientName || null,
    bookingId: metadata.bookingId || null,
    visitId: metadata.visitId || null,
    trainingNoteId: metadata.trainingNoteId || null,
    signedAmount: toSignedAmount(raw),
    runningBalance:
      raw.runningBalance === undefined || raw.runningBalance === null
        ? null
        : toNumber(raw.runningBalance),
    metadata,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  };
}

function serializeCorporateClient(client, options = {}) {
  if (!client) return null;
  const raw = client.toJSON ? client.toJSON() : client;
  const ledgerEntries = Array.isArray(raw.ledgerEntries)
    ? raw.ledgerEntries.map(serializeLedgerEntry).filter(Boolean)
    : options.ledgerEntries || [];
  const balance =
    options.balance === undefined ? calculateBalance(ledgerEntries) : options.balance;
  const hasLedgerDetails =
    Array.isArray(raw.ledgerEntries) || Boolean(options.includeReconciliation);
  const reconciliation = hasLedgerDetails
    ? buildBalanceReconciliation(ledgerEntries, {
        currentBalance: balance,
        status: raw.status,
      })
    : null;

  return {
    id: raw.id,
    name: raw.name,
    contactName: raw.contactName || null,
    contactPhone: raw.contactPhone || null,
    contactEmail: raw.contactEmail || null,
    status: raw.status,
    comment: raw.comment || null,
    balance,
    flags: {
      lowBalance: isLowBalance(balance, raw.status),
    },
    ledgerEntries,
    reconciliation,
    createdByAccountId: raw.createdByAccountId || null,
    createdBy: serializeAccount(raw.createdBy),
    archivedAt: raw.archivedAt || null,
    archivedByAccountId: raw.archivedByAccountId || null,
    archivedBy: serializeAccount(raw.archivedBy),
    archiveReason: raw.archiveReason || null,
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

function buildLedgerInclude() {
  return [
    {
      model: db.Finance,
      as: 'finance',
      attributes: ['id', 'date', 'category', 'amount', 'type', 'comment'],
    },
    buildAccountInclude('createdBy'),
    buildAccountInclude('canceledBy'),
  ];
}

function buildCorporateClientInclude({ context = null, withLedger = false } = {}) {
  const include = [buildAccountInclude('createdBy'), buildAccountInclude('archivedBy')];
  if (withLedger) {
    include.push({
      model: db.CorporateLedgerEntry,
      as: 'ledgerEntries',
      include: buildLedgerInclude(),
      order: [
        ['date', 'DESC'],
        ['id', 'DESC'],
      ],
      separate: true,
      where: context?.clubId ? clubTenantWhere(context) : undefined,
    });
  }
  return include;
}

async function getTrainingWhere(account, tenant) {
  const marker = await onboardingService.getTrainingDataMarker(account, tenant);
  if (marker.isTraining) {
    return {
      isTraining: true,
      trainingAccountId: marker.trainingAccountId,
      trainingRole: marker.trainingRole,
      trainingSessionId: marker.trainingSessionId,
    };
  }
  return { isTraining: false };
}

function buildListWhere(query = {}, trainingWhere = { isTraining: false }) {
  const status = normalizeStatus(query.status || 'active', 'active');
  const q = String(query.q || query.query || '').trim();
  const where = { ...trainingWhere };
  if (status !== 'all') where.status = status;
  if (q) {
    const like = `%${q}%`;
    where[Op.or] = [
      { name: { [Op.like]: like } },
      { contactName: { [Op.like]: like } },
      { contactPhone: { [Op.like]: like } },
      { contactEmail: { [Op.like]: like } },
    ];
  }
  return where;
}

function ledgerTenantWhere(context, values = {}) {
  return context?.clubId
    ? clubTenantWhere(context, values)
    : organizationTenantWhere(context, values);
}

async function getBalancesForClientIds(
  clientIds,
  transaction = null,
  context = null,
) {
  if (!clientIds.length) return new Map();
  const rows = await db.CorporateLedgerEntry.findAll({
    attributes: ['corporateClientId', 'type', 'status', 'amount'],
    where: ledgerTenantWhere(context, {
      corporateClientId: { [Op.in]: clientIds },
      status: 'active',
    }),
    transaction,
  });
  const balances = new Map();
  rows.forEach((entry) => {
    const raw = entry.toJSON ? entry.toJSON() : entry;
    const current = balances.get(raw.corporateClientId) || 0;
    const delta = raw.type === 'spending' ? -toNumber(raw.amount) : toNumber(raw.amount);
    balances.set(raw.corporateClientId, Number((current + delta).toFixed(2)));
  });
  return balances;
}

async function getOpeningBalance(
  corporateClientId,
  from,
  transaction = null,
  context = null,
) {
  if (!from) return 0;
  const balances = await getBalancesForClientIds(
    [corporateClientId],
    transaction,
    context,
  );
  const periodRows = await db.CorporateLedgerEntry.findAll({
    attributes: ['type', 'status', 'amount'],
    where: ledgerTenantWhere(context, {
      corporateClientId,
      date: { [Op.gte]: normalizeDateOnly(from, 'дату начала') },
      status: 'active',
    }),
    transaction,
  });
  const periodDelta = periodRows.reduce((sum, entry) => {
    const raw = entry.toJSON ? entry.toJSON() : entry;
    return sum + (raw.type === 'spending' ? -toNumber(raw.amount) : toNumber(raw.amount));
  }, 0);
  return Number(((balances.get(corporateClientId) || 0) - periodDelta).toFixed(2));
}

async function listCorporateClients(query = {}, account = null, tenant = null) {
  const context = await resolveClientMoneyAccessContextForModel(
    tenant,
    db.CorporateClient,
  );
  const authorityActor = bindClientMoneyActor(account, context);
  const trainingWhere = await getTrainingWhere(authorityActor, tenant);
  const rows = await db.CorporateClient.findAll({
    where: organizationTenantWhere(
      context,
      buildListWhere(query, trainingWhere),
    ),
    include: buildCorporateClientInclude(),
    order: [
      ['status', 'ASC'],
      ['name', 'ASC'],
      ['id', 'ASC'],
    ],
  });
  const balances = await getBalancesForClientIds(
    rows.map((row) => row.id),
    null,
    context,
  );
  return rows.map((row) =>
    serializeCorporateClient(row, {
      balance: balances.get(row.id) || 0,
      ledgerEntries: [],
    }),
  );
}

async function findCorporateClient(id, options = {}) {
  const corporateClientId = normalizeId(id, 'ID компании');
  const query = {
    include: buildCorporateClientInclude({
      context: options.context,
      withLedger: options.withLedger,
    }),
    transaction: options.transaction || null,
    lock: options.lock || undefined,
  };
  const row = options.context
    ? await db.CorporateClient.findOne({
      ...query,
      where: organizationTenantWhere(options.context, {
        id: corporateClientId,
      }),
    })
    : await db.CorporateClient.findByPk(corporateClientId, query);
  if (!row) throw appError('Корпоративный клиент не найден', 404);
  return row;
}

async function assertCorporateClientInScope(client, account, tenant) {
  const trainingWhere = await getTrainingWhere(account, tenant);
  const raw = client.toJSON ? client.toJSON() : client;
  if (Boolean(raw.isTraining) !== Boolean(trainingWhere.isTraining)) {
    throw appError('Корпоративный клиент не найден', 404);
  }
  if (
    trainingWhere.isTraining &&
    (Number(raw.trainingAccountId) !== Number(trainingWhere.trainingAccountId) ||
      raw.trainingRole !== trainingWhere.trainingRole ||
      raw.trainingSessionId !== trainingWhere.trainingSessionId)
  ) {
    throw appError('Корпоративный клиент не найден', 404);
  }
}

async function getCorporateClient(id, account = null, tenant = null) {
  const context = await resolveClientMoneyAccessContextForModel(
    tenant,
    db.CorporateClient,
  );
  const authorityActor = bindClientMoneyActor(account, context);
  const row = await findCorporateClient(id, { context, withLedger: true });
  await assertCorporateClientInScope(row, authorityActor, tenant);
  return serializeCorporateClient(row);
}

function buildClientPayload(data = {}, account = null, trainingMarker = {}) {
  return {
    name: normalizeName(data.name),
    contactName: normalizeOptionalText(data.contactName),
    contactPhone: normalizeOptionalText(data.contactPhone),
    contactEmail: normalizeOptionalText(data.contactEmail),
    comment: normalizeOptionalText(data.comment),
    createdByAccountId: account?.id || null,
    status: 'active',
    ...trainingMarker,
  };
}

async function createCorporateClient(data = {}, account = null, tenant = null) {
  const context = await resolveClientMoneyAccessContextForModel(
    tenant,
    db.CorporateClient,
  );
  const authorityActor = bindClientMoneyActor(account, context);
  const trainingMarker = await onboardingService.getTrainingDataMarker(
    authorityActor,
    tenant,
  );
  const row = await db.CorporateClient.create(
    {
      ...organizationTenantValues(context),
      ...buildClientPayload(data, authorityActor, trainingMarker),
    },
  );

  await payrollService.recordChange({
    action: 'corporate_client.create',
    entityType: 'corporate_client',
    entityId: row.id,
    account: authorityActor,
    afterData: row.toJSON ? row.toJSON() : row,
  });

  return getCorporateClient(row.id, authorityActor, context);
}

async function updateCorporateClient(id, data = {}, account = null, tenant = null) {
  const context = await resolveClientMoneyAccessContextForModel(
    tenant,
    db.CorporateClient,
  );
  const authorityActor = bindClientMoneyActor(account, context);
  const row = await findCorporateClient(id, { context });
  await assertCorporateClientInScope(row, authorityActor, tenant);
  const beforeData = row.toJSON ? row.toJSON() : { ...row };
  const payload = {};
  if (data.name !== undefined) payload.name = normalizeName(data.name);
  if (data.contactName !== undefined) {
    payload.contactName = normalizeOptionalText(data.contactName);
  }
  if (data.contactPhone !== undefined) {
    payload.contactPhone = normalizeOptionalText(data.contactPhone);
  }
  if (data.contactEmail !== undefined) {
    payload.contactEmail = normalizeOptionalText(data.contactEmail);
  }
  if (data.comment !== undefined) payload.comment = normalizeOptionalText(data.comment);
  await row.update(payload);

  await payrollService.recordChange({
    action: 'corporate_client.update',
    entityType: 'corporate_client',
    entityId: row.id,
    account: authorityActor,
    beforeData,
    afterData: row.toJSON ? row.toJSON() : row,
  });

  return getCorporateClient(row.id, authorityActor, context);
}

async function archiveCorporateClient(id, data = {}, account = null, tenant = null) {
  const context = await resolveClientMoneyAccessContextForModel(
    tenant,
    db.CorporateClient,
  );
  const authorityActor = bindClientMoneyActor(account, context);
  const row = await findCorporateClient(id, { context });
  await assertCorporateClientInScope(row, authorityActor, tenant);
  if (row.status === 'archived') {
    return getCorporateClient(row.id, authorityActor, context);
  }
  const beforeData = row.toJSON ? row.toJSON() : { ...row };
  await row.update({
    archivedAt: new Date(),
    archivedByAccountId: authorityActor?.id || null,
    archiveReason: normalizeOptionalText(data.reason),
    status: 'archived',
  });

  await payrollService.recordChange({
    action: 'corporate_client.archive',
    entityType: 'corporate_client',
    entityId: row.id,
    account: authorityActor,
    reason: data.reason,
    beforeData,
    afterData: row.toJSON ? row.toJSON() : row,
  });

  return getCorporateClient(row.id, authorityActor, context);
}

async function restoreCorporateClient(id, account = null, tenant = null) {
  const context = await resolveClientMoneyAccessContextForModel(
    tenant,
    db.CorporateClient,
  );
  const authorityActor = bindClientMoneyActor(account, context);
  const row = await findCorporateClient(id, { context });
  await assertCorporateClientInScope(row, authorityActor, tenant);
  if (row.status === 'active') {
    return getCorporateClient(row.id, authorityActor, context);
  }
  const beforeData = row.toJSON ? row.toJSON() : { ...row };
  await row.update({
    archivedAt: null,
    archivedByAccountId: null,
    archiveReason: null,
    status: 'active',
  });

  await payrollService.recordChange({
    action: 'corporate_client.restore',
    entityType: 'corporate_client',
    entityId: row.id,
    account: authorityActor,
    beforeData,
    afterData: row.toJSON ? row.toJSON() : row,
  });

  return getCorporateClient(row.id, authorityActor, context);
}

async function assertFinanceLinkAvailable(financeId, transaction, context = null) {
  const existing = await db.CorporateLedgerEntry.findOne({
    where: clubTenantWhere(context, {
      financeId,
      status: 'active',
    }),
    transaction,
  });
  if (existing) {
    throw appError('Эта финансовая запись уже связана с активным пополнением', 409);
  }
}

function assertFinanceMatchesTrainingScope(finance, trainingMarker) {
  const raw = finance.toJSON ? finance.toJSON() : finance;
  if (Boolean(raw.isTraining) !== Boolean(trainingMarker.isTraining)) {
    throw appError('Финансовая запись не соответствует текущему режиму данных', 409);
  }
  if (
    trainingMarker.isTraining &&
    (Number(raw.trainingAccountId) !== Number(trainingMarker.trainingAccountId) ||
      raw.trainingRole !== trainingMarker.trainingRole ||
      raw.trainingSessionId !== trainingMarker.trainingSessionId)
  ) {
    throw appError('Финансовая запись не соответствует текущему режиму обучения', 409);
  }
}

function assertEntityMatchesTrainingScope(entity, trainingMarker, entityName) {
  const raw = entity?.toJSON ? entity.toJSON() : entity;
  if (!raw) return;
  if (Boolean(raw.isTraining) !== Boolean(trainingMarker.isTraining)) {
    throw appError(`${entityName} не соответствует текущему режиму данных`, 409);
  }
  if (
    trainingMarker.isTraining &&
    (Number(raw.trainingAccountId) !== Number(trainingMarker.trainingAccountId) ||
      raw.trainingRole !== trainingMarker.trainingRole ||
      raw.trainingSessionId !== trainingMarker.trainingSessionId)
  ) {
    throw appError(`${entityName} не соответствует текущему режиму обучения`, 409);
  }
}

async function loadLinkedFinance(
  data,
  trainingMarker,
  transaction,
  context = null,
) {
  const financeId = normalizeId(data.financeId, 'ID финансовой записи');
  const finance = await findClubRecordByPk(db.Finance, financeId, {
    transaction,
    lock: transaction?.LOCK?.UPDATE,
  }, context);
  if (!finance) throw appError('Финансовая запись не найдена', 404);
  if (finance.type !== 'income') {
    throw appError('Связать можно только ручной доход', 409);
  }
  const amount = normalizeMoney(finance.amount, 'Сумма финансовой записи');
  await payrollService.assertDateEditable(finance.date, 'корпоративное пополнение');
  await assertFinanceLinkAvailable(finance.id, transaction, context);
  assertFinanceMatchesTrainingScope(finance, trainingMarker);
  return finance;
}

async function buildSpendingMetadata(
  data,
  trainingMarker,
  transaction,
  tenant = null,
  context = null,
) {
  const metadata = {
    ...(normalizeMetadata(data.metadata) || {}),
    service: normalizeService(data.service),
    source: 'manual_corporate_spending',
  };
  const participantName = normalizeOptionalText(data.participantName);
  if (participantName) metadata.participantName = participantName;

  const clientId = normalizeOptionalId(data.clientId, 'ID клиента');
  if (clientId) {
    const client = await db.User.findOne({
      transaction,
      where: organizationTenantWhere(context, { id: clientId }),
    });
    if (!client) throw appError('Клиент списания не найден', 404);
    assertEntityMatchesTrainingScope(client, trainingMarker, 'Клиент списания');
    const raw = client.toJSON ? client.toJSON() : client;
    metadata.clientId = raw.id;
    metadata.clientName = raw.name || null;
    metadata.clientPhone = raw.phone || null;
    if (!metadata.participantName) metadata.participantName = raw.name || null;
  }

  const bookingId = normalizeOptionalId(data.bookingId, 'ID бронирования');
  if (bookingId) {
    const context = isTenantBookingsCourtsEnabled()
      ? await resolveBookingAccessContext(tenant, { transaction })
      : null;
    const booking = await db.Booking.findOne({
      transaction,
      where: bookingTenantWhere(
        context,
        { id: bookingId },
        { force: Boolean(context) },
      ),
    });
    if (!booking) throw appError('Бронирование списания не найдено', 404);
    assertEntityMatchesTrainingScope(booking, trainingMarker, 'Бронирование списания');
    const raw = booking.toJSON ? booking.toJSON() : booking;
    metadata.bookingId = raw.id;
    metadata.bookingType = raw.bookingType || null;
    if (!metadata.participantName) metadata.participantName = raw.clientName || null;
  }

  const visitId = normalizeOptionalId(data.visitId, 'ID визита');
  if (visitId) {
    const visit = await db.Visit.findOne({
      transaction,
      where: clubTenantWhere(context, { id: visitId }),
    });
    if (!visit) throw appError('Визит списания не найден', 404);
    assertEntityMatchesTrainingScope(visit, trainingMarker, 'Визит списания');
    const raw = visit.toJSON ? visit.toJSON() : visit;
    metadata.visitId = raw.id;
    metadata.visitUserId = raw.userId || null;
  }

  const trainingNoteId = normalizeOptionalId(
    data.trainingNoteId,
    'ID тренерской заметки',
  );
  if (trainingNoteId) {
    const trainingContext = await resolveTrainingOperationsAccessContext(tenant, {
      transaction,
    });
    const trainingNote = await db.TrainingNote.findOne({
      transaction,
      where: trainingOperationsTenantWhere(
        trainingContext,
        { id: trainingNoteId },
      ),
    });
    if (!trainingNote) throw appError('Тренерская заметка списания не найдена', 404);
    assertEntityMatchesTrainingScope(
      trainingNote,
      trainingMarker,
      'Тренерская заметка списания',
    );
    const raw = trainingNote.toJSON ? trainingNote.toJSON() : trainingNote;
    metadata.trainingNoteId = raw.id;
    metadata.trainingNoteUserId = raw.userId || null;
  }

  return metadata;
}

async function createFinanceIncomeForDeposit(
  data,
  account,
  trainingMarker,
  transaction,
  context = null,
) {
  const amount = normalizeMoney(data.amount);
  const date = normalizeDateOnly(data.date);
  const categoryName = normalizeIncomeCategory(data.category);
  await payrollService.assertDateEditable(date, 'корпоративное пополнение');

  const category = await db.Category.findOne({
    where: {
      name: categoryName,
      type: 'income',
      isActive: true,
    },
    transaction,
  });
  if (!category) throw appError('Категория дохода не найдена', 404);

  const finance = await db.Finance.create(
    {
      ...clubTenantValues(context),
      amount,
      category: category.name,
      comment: normalizeOptionalText(data.comment),
      createdByAccountId: account?.id || null,
      date,
      type: 'income',
      ...trainingMarker,
    },
    { transaction },
  );

  await payrollService.recordChange({
    action: 'corporate_deposit.finance_created',
    entityType: 'finance',
    entityId: finance.id,
    account,
    date,
    reason: data.comment,
    afterData: finance.toJSON ? finance.toJSON() : finance,
    transaction,
  });

  return finance;
}

function buildDepositPayload({
  account,
  client,
  context,
  data,
  finance,
  linked,
  trainingMarker,
}) {
  return {
    ...clubTenantValues(context),
    amount: normalizeMoney(finance.amount),
    category: finance.category || normalizeOptionalText(data.category),
    comment: normalizeOptionalText(data.comment) || finance.comment || null,
    corporateClientId: client.id,
    createdByAccountId: account?.id || null,
    date: normalizeDateOnly(finance.date),
    financeCreatedByLedger: !linked,
    financeId: finance.id,
    metadata: {
      source: linked ? 'linked_finance_income' : 'created_finance_income',
    },
    status: 'active',
    type: 'deposit',
    ...trainingMarker,
  };
}

async function createDeposit(
  corporateClientId,
  data = {},
  account = null,
  tenant = null,
) {
  const result = await db.sequelize.transaction(async (transaction) => {
    const context = await resolveClientMoneyAccessContextForModel(
      tenant,
      db.CorporateLedgerEntry,
      { lock: true, transaction },
    );
    const authorityActor = bindClientMoneyActor(account, context);
    const client = await findCorporateClient(corporateClientId, {
      context,
      transaction,
      lock: transaction?.LOCK?.UPDATE,
    });
    await assertCorporateClientInScope(client, authorityActor, tenant);
    if (client.status !== 'active') {
      throw appError('Пополнение доступно только для активной компании', 409);
    }

    const trainingMarker = await onboardingService.getTrainingDataMarker(
      authorityActor,
      tenant,
    );
    const linked = Boolean(data.financeId);
    const finance = linked
      ? await loadLinkedFinance(data, trainingMarker, transaction, context)
      : await createFinanceIncomeForDeposit(
        data,
        authorityActor,
        trainingMarker,
        transaction,
        context,
      );

    const entry = await db.CorporateLedgerEntry.create(
      buildDepositPayload({
        account: authorityActor,
        client,
        context,
        data,
        finance,
        linked,
        trainingMarker,
      }),
      { transaction },
    );

    await payrollService.recordChange({
      action: linked ? 'corporate_deposit.link' : 'corporate_deposit.create',
      entityType: 'corporate_ledger_entry',
      entityId: entry.id,
      account: authorityActor,
      date: entry.date,
      reason: data.comment,
      afterData: entry.toJSON ? entry.toJSON() : entry,
      transaction,
    });

    return {
      clientId: client.id,
      entryId: entry.id,
      financeEvent: linked
        ? null
        : {
            entityId: finance.id,
            entityType: 'finance',
            payload: {
              amount: finance.amount,
              category: finance.category,
              date: finance.date,
              type: finance.type,
            },
          },
      context,
      actor: authorityActor,
    };
  });

  if (result.financeEvent) {
    await onboardingService.recordEventSafe(
      result.actor,
      'finance.record_created',
      { ...result.financeEvent, tenant },
    );
  }

  const ledgerEntry = await findClubRecordByPk(
    db.CorporateLedgerEntry,
    result.entryId,
    {
    include: buildLedgerInclude(),
    },
    result.context,
  );

  return {
    corporateClient: await getCorporateClient(
      result.clientId,
      result.actor,
      result.context,
    ),
    ledgerEntry: serializeLedgerEntry(ledgerEntry),
  };
}

async function createSpending(
  corporateClientId,
  data = {},
  account = null,
  tenant = null,
) {
  const result = await db.sequelize.transaction(async (transaction) => {
    const context = await resolveClientMoneyAccessContextForModel(
      tenant,
      db.CorporateLedgerEntry,
      { lock: true, transaction },
    );
    const authorityActor = bindClientMoneyActor(account, context);
    const client = await findCorporateClient(corporateClientId, {
      context,
      transaction,
      lock: transaction?.LOCK?.UPDATE,
    });
    await assertCorporateClientInScope(client, authorityActor, tenant);
    if (client.status !== 'active') {
      throw appError('Списание доступно только для активной компании', 409);
    }

    const amount = normalizeMoney(data.amount);
    const date = normalizeDateOnly(data.date);
    await payrollService.assertDateEditable(date, 'корпоративное списание');
    const balance = (
      await getBalancesForClientIds([client.id], transaction, context)
    ).get(client.id) || 0;
    if (amount > balance) {
      throw appError('Недостаточно средств на корпоративном балансе', 409);
    }

    const trainingMarker = await onboardingService.getTrainingDataMarker(
      authorityActor,
      tenant,
    );
    const metadata = await buildSpendingMetadata(
      data,
      trainingMarker,
      transaction,
      tenant,
      context,
    );
    const entry = await db.CorporateLedgerEntry.create(
      {
        ...clubTenantValues(context),
        amount,
        category: metadata.service,
        comment: normalizeOptionalText(data.comment),
        corporateClientId: client.id,
        createdByAccountId: authorityActor?.id || null,
        date,
        financeCreatedByLedger: false,
        financeId: null,
        metadata,
        status: 'active',
        type: 'spending',
        ...trainingMarker,
      },
      { transaction },
    );

    await payrollService.recordChange({
      action: 'corporate_spending.create',
      entityType: 'corporate_ledger_entry',
      entityId: entry.id,
      account: authorityActor,
      date,
      reason: data.comment,
      afterData: entry.toJSON ? entry.toJSON() : entry,
      transaction,
    });

    return {
      clientId: client.id,
      entryId: entry.id,
      context,
      actor: authorityActor,
    };
  });

  const ledgerEntry = await findClubRecordByPk(
    db.CorporateLedgerEntry,
    result.entryId,
    {
    include: buildLedgerInclude(),
    },
    result.context,
  );

  return {
    corporateClient: await getCorporateClient(
      result.clientId,
      result.actor,
      result.context,
    ),
    ledgerEntry: serializeLedgerEntry(ledgerEntry),
  };
}

function normalizeLedgerFilters(query = {}) {
  const status = query.status ? String(query.status) : '';
  const type = query.type ? String(query.type) : '';
  if (status && status !== 'all' && !CORPORATE_LEDGER_ENTRY_STATUSES.includes(status)) {
    throw appError('Некорректный статус операции баланса');
  }
  if (type && type !== 'all' && !CORPORATE_LEDGER_ENTRY_TYPES.includes(type)) {
    throw appError('Некорректный тип операции баланса');
  }
  return {
    from: query.from ? normalizeDateOnly(query.from, 'дату начала') : null,
    participant: normalizeOptionalFilterText(query.participant, 'Фильтр участника'),
    service: normalizeOptionalFilterText(query.service, 'Фильтр услуги'),
    status: status || 'all',
    to: query.to ? normalizeDateOnly(query.to, 'дату окончания') : null,
    type: type || 'all',
  };
}

function buildLedgerWhere(clientId, filters, options = {}, context = null) {
  const where = clubTenantWhere(context, {
    corporateClientId: clientId,
  });
  const status = options.activeOnly ? 'active' : filters.status;
  if (status && status !== 'all') where.status = status;
  if (options.includeType !== false && filters.type !== 'all') {
    where.type = filters.type;
  }
  if (filters.from || filters.to) {
    where.date = {};
    if (filters.from) where.date[Op.gte] = filters.from;
    if (filters.to) where.date[Op.lte] = filters.to;
  }
  return where;
}

function matchesLedgerTextFilters(entry, filters) {
  const service = [entry.service, entry.category]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  const participant = [entry.participantName, entry.clientName]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  if (filters.service && !service.includes(filters.service.toLowerCase())) {
    return false;
  }
  if (
    filters.participant &&
    !participant.includes(filters.participant.toLowerCase())
  ) {
    return false;
  }
  return true;
}

function buildLedgerSummary(entries, client, filters) {
  const activeEntries = entries.filter((entry) => entry.status === 'active');
  const depositsTotal = Number(
    activeEntries
      .filter((entry) => entry.type === 'deposit')
      .reduce((sum, entry) => sum + toNumber(entry.amount), 0)
      .toFixed(2),
  );
  const spendingsTotal = Number(
    activeEntries
      .filter((entry) => entry.type === 'spending')
      .reduce((sum, entry) => sum + toNumber(entry.amount), 0)
      .toFixed(2),
  );
  const periodDelta = Number((depositsTotal - spendingsTotal).toFixed(2));
  const chronological = [...activeEntries]
    .filter((entry) => entry.runningBalance !== null && entry.runningBalance !== undefined)
    .sort((left, right) => {
      const dateCompare = String(left.date).localeCompare(String(right.date));
      if (dateCompare !== 0) return dateCompare;
      return Number(left.id || 0) - Number(right.id || 0);
    });
  const openingBalance =
    chronological.length > 0
      ? Number(
          (
            toNumber(chronological[0].runningBalance) -
            toSignedAmount(chronological[0])
          ).toFixed(2),
        )
      : null;
  const endingBalance =
    chronological.length > 0
      ? toNumber(chronological[chronological.length - 1].runningBalance)
      : null;

  return {
    activeEntriesCount: activeEntries.length,
    canceledEntriesCount: entries.filter((entry) => entry.status === 'canceled').length,
    depositsTotal,
    endingBalance,
    filters,
    lowBalance: isLowBalance(toNumber(client.balance), client.status),
    lowBalanceThreshold: DEFAULT_LOW_BALANCE_THRESHOLD,
    openingBalance,
    periodDelta,
    spendingsTotal,
    totalEntriesCount: entries.length,
  };
}

async function listLedgerEntries(
  corporateClientId,
  query = {},
  account = null,
  tenant = null,
) {
  const context = await resolveClientMoneyAccessContextForModel(
    tenant,
    db.CorporateLedgerEntry,
  );
  const authorityActor = bindClientMoneyActor(account, context);
  const client = await findCorporateClient(corporateClientId, { context });
  await assertCorporateClientInScope(client, authorityActor, tenant);
  const filters = normalizeLedgerFilters(query);
  const where = buildLedgerWhere(client.id, filters, {}, context);

  const rows = await db.CorporateLedgerEntry.findAll({
    where,
    include: buildLedgerInclude(),
    order: [
      ['date', 'DESC'],
      ['id', 'DESC'],
    ],
  });
  const balanceWhere = buildLedgerWhere(client.id, filters, {
    activeOnly: true,
    includeType: false,
  }, context);
  const balanceRows = await db.CorporateLedgerEntry.findAll({
    where: balanceWhere,
    order: [
      ['date', 'ASC'],
      ['id', 'ASC'],
    ],
  });
  const runningBalances = new Map();
  let balance = await getOpeningBalance(client.id, query.from, null, context);
  balanceRows.forEach((entry) => {
    const raw = entry.toJSON ? entry.toJSON() : entry;
    balance = Number((balance + toSignedAmount(raw)).toFixed(2));
    runningBalances.set(raw.id, balance);
  });

  return rows.map((row) => {
    const raw = row.toJSON ? row.toJSON() : row;
    return serializeLedgerEntry({
      ...raw,
      runningBalance: runningBalances.has(raw.id)
        ? runningBalances.get(raw.id)
        : null,
    });
  }).filter((entry) => matchesLedgerTextFilters(entry, filters));
}

async function getLedgerDetails(
  corporateClientId,
  query = {},
  account = null,
  tenant = null,
) {
  const [client, entries] = await Promise.all([
    getCorporateClient(corporateClientId, account, tenant),
    listLedgerEntries(corporateClientId, query, account, tenant),
  ]);
  const filters = normalizeLedgerFilters(query);
  return {
    corporateClientId: client.id,
    entries,
    filters,
    generatedAt: new Date().toISOString(),
    summary: buildLedgerSummary(entries, client, filters),
  };
}

async function cancelDeposit(
  corporateClientId,
  entryId,
  data = {},
  account = null,
  tenant = null,
) {
  const result = await db.sequelize.transaction(async (transaction) => {
    const context = await resolveClientMoneyAccessContextForModel(
      tenant,
      db.CorporateLedgerEntry,
      { lock: true, transaction },
    );
    const authorityActor = bindClientMoneyActor(account, context);
    const client = await findCorporateClient(corporateClientId, {
      context,
      transaction,
      lock: transaction?.LOCK?.UPDATE,
    });
    await assertCorporateClientInScope(client, authorityActor, tenant);
    const entry = await db.CorporateLedgerEntry.findOne({
      where: clubTenantWhere(context, {
        corporateClientId: client.id,
        id: normalizeId(entryId, 'ID пополнения'),
        type: 'deposit',
      }),
      include: buildLedgerInclude(),
      transaction,
      lock: transaction?.LOCK?.UPDATE,
    });
    if (!entry) throw appError('Пополнение не найдено', 404);
    if (entry.status === 'canceled') {
      throw appError('Это пополнение уже отменено', 409);
    }
    await payrollService.assertDateEditable(entry.date, 'отмену корпоративного пополнения');

    const beforeData = entry.toJSON ? entry.toJSON() : { ...entry };
    await entry.update(
      {
        canceledAt: new Date(),
        canceledByAccountId: authorityActor?.id || null,
        cancelReason: normalizeOptionalText(data.reason),
        status: 'canceled',
      },
      { transaction },
    );

    if (entry.financeId && entry.financeCreatedByLedger) {
      const finance = await findClubRecordByPk(db.Finance, entry.financeId, {
        transaction,
        lock: transaction?.LOCK?.UPDATE,
      }, context);
      if (finance) {
        const financeBefore = finance.toJSON ? finance.toJSON() : { ...finance };
        await finance.destroy({ transaction });
        await payrollService.recordChange({
          action: 'corporate_deposit.finance_deleted',
          entityType: 'finance',
          entityId: finance.id,
          account: authorityActor,
          date: financeBefore.date,
          reason: data.reason,
          beforeData: financeBefore,
          transaction,
        });
      }
    }

    await payrollService.recordChange({
      action: 'corporate_deposit.cancel',
      entityType: 'corporate_ledger_entry',
      entityId: entry.id,
      account: authorityActor,
      date: entry.date,
      reason: data.reason,
      beforeData,
      afterData: entry.toJSON ? entry.toJSON() : entry,
      transaction,
    });

    return {
      clientId: client.id,
      entryId: entry.id,
      actor: authorityActor,
      context,
    };
  });

  const ledgerEntry = await findClubRecordByPk(
    db.CorporateLedgerEntry,
    result.entryId,
    {
    include: buildLedgerInclude(),
    },
    result.context,
  );

  return {
    corporateClient: await getCorporateClient(
      result.clientId,
      result.actor,
      result.context,
    ),
    ledgerEntry: serializeLedgerEntry(ledgerEntry),
  };
}

async function reverseSpending(
  corporateClientId,
  entryId,
  data = {},
  account = null,
  tenant = null,
) {
  const result = await db.sequelize.transaction(async (transaction) => {
    const context = await resolveClientMoneyAccessContextForModel(
      tenant,
      db.CorporateLedgerEntry,
      { lock: true, transaction },
    );
    const authorityActor = bindClientMoneyActor(account, context);
    const client = await findCorporateClient(corporateClientId, {
      context,
      transaction,
      lock: transaction?.LOCK?.UPDATE,
    });
    await assertCorporateClientInScope(client, authorityActor, tenant);
    const entry = await db.CorporateLedgerEntry.findOne({
      where: clubTenantWhere(context, {
        corporateClientId: client.id,
        id: normalizeId(entryId, 'ID списания'),
        type: 'spending',
      }),
      include: buildLedgerInclude(),
      transaction,
      lock: transaction?.LOCK?.UPDATE,
    });
    if (!entry) throw appError('Списание не найдено', 404);
    if (entry.status === 'canceled') {
      throw appError('Это списание уже отменено', 409);
    }
    await payrollService.assertDateEditable(entry.date, 'отмену корпоративного списания');

    const beforeData = entry.toJSON ? entry.toJSON() : { ...entry };
    await entry.update(
      {
        canceledAt: new Date(),
        canceledByAccountId: authorityActor?.id || null,
        cancelReason: normalizeOptionalText(data.reason),
        status: 'canceled',
      },
      { transaction },
    );

    await payrollService.recordChange({
      action: 'corporate_spending.reverse',
      entityType: 'corporate_ledger_entry',
      entityId: entry.id,
      account: authorityActor,
      date: entry.date,
      reason: data.reason,
      beforeData,
      afterData: entry.toJSON ? entry.toJSON() : entry,
      transaction,
    });

    return {
      clientId: client.id,
      entryId: entry.id,
      actor: authorityActor,
      context,
    };
  });

  const ledgerEntry = await findClubRecordByPk(
    db.CorporateLedgerEntry,
    result.entryId,
    {
    include: buildLedgerInclude(),
    },
    result.context,
  );

  return {
    corporateClient: await getCorporateClient(
      result.clientId,
      result.actor,
      result.context,
    ),
    ledgerEntry: serializeLedgerEntry(ledgerEntry),
  };
}

function buildLedgerExport(rows, client, query = {}) {
  const summary = buildLedgerSummary(rows, client, normalizeLedgerFilters(query));
  const reconciliation = client.reconciliation || {
    currentBalance: client.balance,
    depositsTotal: client.balance,
    difference: 0,
    expectedBalance: client.balance,
    isBalanced: true,
    spendingsTotal: 0,
  };
  const summaryRows = [
    { Показатель: 'Компания', Значение: client.name },
    { Показатель: 'Период', Значение: `${query.from || '...'} — ${query.to || '...'}` },
    { Показатель: 'Фильтр услуги', Значение: query.service || 'Все услуги' },
    { Показатель: 'Фильтр участника', Значение: query.participant || 'Все участники' },
    { Показатель: 'Операций в детализации', Значение: rows.length },
    { Показатель: 'Пополнения в детализации', Значение: summary.depositsTotal },
    { Показатель: 'Списания в детализации', Значение: summary.spendingsTotal },
    { Показатель: 'Итого по детализации', Значение: summary.periodDelta },
    { Показатель: 'Текущий баланс', Значение: reconciliation.currentBalance },
    { Показатель: 'Сверка баланса', Значение: reconciliation.isBalanced ? 'OK' : 'Расхождение' },
    { Показатель: 'Пополнения всего', Значение: reconciliation.depositsTotal },
    { Показатель: 'Списания всего', Значение: reconciliation.spendingsTotal },
    { Показатель: 'Пополнения минус списания', Значение: reconciliation.expectedBalance },
  ];
  const detailRows = [...rows]
    .sort((left, right) => {
      const dateCompare = String(left.date).localeCompare(String(right.date));
      if (dateCompare !== 0) return dateCompare;
      return Number(left.id || 0) - Number(right.id || 0);
    })
    .map((entry) => ({
      Дата: entry.date,
      Услуга: entry.service || (entry.type === 'deposit' ? 'Пополнение' : ''),
      Участник: entry.participantName || entry.clientName || '',
      Сумма: entry.signedAmount,
      Комментарий: entry.comment || '',
      Остаток: entry.runningBalance ?? '',
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
    'Детализация',
  );
  return xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });
}

async function exportLedgerDetails(
  corporateClientId,
  query = {},
  account = null,
  tenant = null,
) {
  const context = await resolveClientMoneyAccessContextForModel(
    tenant,
    db.CorporateLedgerEntry,
  );
  const authorityActor = bindClientMoneyActor(account, context);
  const client = await getCorporateClient(
    corporateClientId,
    authorityActor,
    context,
  );
  const exportQuery = { ...query, status: query.status || 'active' };
  const rows = await listLedgerEntries(
    corporateClientId,
    exportQuery,
    authorityActor,
    context,
  );

  await payrollService.recordChange({
    action: 'corporate_ledger.export',
    entityType: 'corporate_client',
    entityId: client.id,
    account: authorityActor,
    fromDate: exportQuery.from || null,
    toDate: exportQuery.to || null,
    afterData: {
      entries: rows.length,
      name: client.name,
    },
  });

  await onboardingService.recordEventSafe(authorityActor, 'report.exported', {
    entityType: 'corporate_ledger',
    tenant,
    payload: {
      corporateClientId: client.id,
      fromDate: exportQuery.from || null,
      report: 'corporate_ledger',
      toDate: exportQuery.to || null,
    },
  });

  return {
    buffer: buildLedgerExport(rows, client, exportQuery),
    filename: `corporate-${client.id}-${exportQuery.from || 'start'}-${exportQuery.to || 'end'}.xlsx`,
  };
}

module.exports = {
  CORPORATE_CLIENT_STATUSES,
  CORPORATE_LEDGER_ENTRY_STATUSES,
  CORPORATE_LEDGER_ENTRY_TYPES,
  archiveCorporateClient,
  calculateBalance,
  cancelDeposit,
  createCorporateClient,
  createDeposit,
  createSpending,
  exportLedgerDetails,
  getCorporateClient,
  getLedgerDetails,
  listCorporateClients,
  listLedgerEntries,
  reverseSpending,
  restoreCorporateClient,
  serializeCorporateClient,
  serializeLedgerEntry,
  updateCorporateClient,
  __testing: {
    normalizeMoney,
    normalizeName,
  },
};
