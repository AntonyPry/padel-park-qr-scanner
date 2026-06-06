const { Op } = require('sequelize');
const xlsx = require('xlsx');
const db = require('../../models');
const onboardingService = require('./onboarding.service');
const payrollService = require('./payroll.service');

const CORPORATE_CLIENT_STATUSES = ['active', 'archived'];
const CORPORATE_LEDGER_ENTRY_STATUSES = ['active', 'canceled'];
const CORPORATE_LEDGER_ENTRY_TYPES = ['deposit', 'spending'];

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

  return {
    id: raw.id,
    name: raw.name,
    contactName: raw.contactName || null,
    contactPhone: raw.contactPhone || null,
    contactEmail: raw.contactEmail || null,
    status: raw.status,
    comment: raw.comment || null,
    balance:
      options.balance === undefined ? calculateBalance(ledgerEntries) : options.balance,
    ledgerEntries,
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

function buildCorporateClientInclude({ withLedger = false } = {}) {
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
    });
  }
  return include;
}

async function getTrainingWhere(account) {
  const marker = await onboardingService.getTrainingDataMarker(account);
  if (marker.isTraining) {
    return {
      isTraining: true,
      trainingAccountId: marker.trainingAccountId,
      trainingRole: marker.trainingRole,
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

async function getBalancesForClientIds(clientIds, transaction = null) {
  if (!clientIds.length) return new Map();
  const rows = await db.CorporateLedgerEntry.findAll({
    attributes: ['corporateClientId', 'type', 'status', 'amount'],
    where: {
      corporateClientId: { [Op.in]: clientIds },
      status: 'active',
    },
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

async function getOpeningBalance(corporateClientId, from, transaction = null) {
  if (!from) return 0;
  const balances = await getBalancesForClientIds([corporateClientId], transaction);
  const periodRows = await db.CorporateLedgerEntry.findAll({
    attributes: ['type', 'status', 'amount'],
    where: {
      corporateClientId,
      date: { [Op.gte]: normalizeDateOnly(from, 'дату начала') },
      status: 'active',
    },
    transaction,
  });
  const periodDelta = periodRows.reduce((sum, entry) => {
    const raw = entry.toJSON ? entry.toJSON() : entry;
    return sum + (raw.type === 'spending' ? -toNumber(raw.amount) : toNumber(raw.amount));
  }, 0);
  return Number(((balances.get(corporateClientId) || 0) - periodDelta).toFixed(2));
}

async function listCorporateClients(query = {}, account = null) {
  const trainingWhere = await getTrainingWhere(account);
  const rows = await db.CorporateClient.findAll({
    where: buildListWhere(query, trainingWhere),
    include: buildCorporateClientInclude(),
    order: [
      ['status', 'ASC'],
      ['name', 'ASC'],
      ['id', 'ASC'],
    ],
  });
  const balances = await getBalancesForClientIds(rows.map((row) => row.id));
  return rows.map((row) =>
    serializeCorporateClient(row, {
      balance: balances.get(row.id) || 0,
      ledgerEntries: [],
    }),
  );
}

async function findCorporateClient(id, options = {}) {
  const corporateClientId = normalizeId(id, 'ID компании');
  const row = await db.CorporateClient.findByPk(corporateClientId, {
    include: buildCorporateClientInclude({ withLedger: options.withLedger }),
    transaction: options.transaction || null,
    lock: options.lock || undefined,
  });
  if (!row) throw appError('Корпоративный клиент не найден', 404);
  return row;
}

async function assertCorporateClientInScope(client, account) {
  const trainingWhere = await getTrainingWhere(account);
  const raw = client.toJSON ? client.toJSON() : client;
  if (Boolean(raw.isTraining) !== Boolean(trainingWhere.isTraining)) {
    throw appError('Корпоративный клиент не найден', 404);
  }
  if (
    trainingWhere.isTraining &&
    (Number(raw.trainingAccountId) !== Number(trainingWhere.trainingAccountId) ||
      raw.trainingRole !== trainingWhere.trainingRole)
  ) {
    throw appError('Корпоративный клиент не найден', 404);
  }
}

async function getCorporateClient(id, account = null) {
  const row = await findCorporateClient(id, { withLedger: true });
  await assertCorporateClientInScope(row, account);
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

async function createCorporateClient(data = {}, account = null) {
  const trainingMarker = await onboardingService.getTrainingDataMarker(account);
  const row = await db.CorporateClient.create(
    buildClientPayload(data, account, trainingMarker),
  );

  await payrollService.recordChange({
    action: 'corporate_client.create',
    entityType: 'corporate_client',
    entityId: row.id,
    account,
    afterData: row.toJSON ? row.toJSON() : row,
  });

  return getCorporateClient(row.id, account);
}

async function updateCorporateClient(id, data = {}, account = null) {
  const row = await findCorporateClient(id);
  await assertCorporateClientInScope(row, account);
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
    account,
    beforeData,
    afterData: row.toJSON ? row.toJSON() : row,
  });

  return getCorporateClient(row.id, account);
}

async function archiveCorporateClient(id, data = {}, account = null) {
  const row = await findCorporateClient(id);
  await assertCorporateClientInScope(row, account);
  if (row.status === 'archived') return getCorporateClient(row.id, account);
  const beforeData = row.toJSON ? row.toJSON() : { ...row };
  await row.update({
    archivedAt: new Date(),
    archivedByAccountId: account?.id || null,
    archiveReason: normalizeOptionalText(data.reason),
    status: 'archived',
  });

  await payrollService.recordChange({
    action: 'corporate_client.archive',
    entityType: 'corporate_client',
    entityId: row.id,
    account,
    reason: data.reason,
    beforeData,
    afterData: row.toJSON ? row.toJSON() : row,
  });

  return getCorporateClient(row.id, account);
}

async function restoreCorporateClient(id, account = null) {
  const row = await findCorporateClient(id);
  await assertCorporateClientInScope(row, account);
  if (row.status === 'active') return getCorporateClient(row.id, account);
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
    account,
    beforeData,
    afterData: row.toJSON ? row.toJSON() : row,
  });

  return getCorporateClient(row.id, account);
}

async function assertFinanceLinkAvailable(financeId, transaction) {
  const existing = await db.CorporateLedgerEntry.findOne({
    where: {
      financeId,
      status: 'active',
    },
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
      raw.trainingRole !== trainingMarker.trainingRole)
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
      raw.trainingRole !== trainingMarker.trainingRole)
  ) {
    throw appError(`${entityName} не соответствует текущему режиму обучения`, 409);
  }
}

async function loadLinkedFinance(data, trainingMarker, transaction) {
  const financeId = normalizeId(data.financeId, 'ID финансовой записи');
  const finance = await db.Finance.findByPk(financeId, {
    transaction,
    lock: transaction?.LOCK?.UPDATE,
  });
  if (!finance) throw appError('Финансовая запись не найдена', 404);
  if (finance.type !== 'income') {
    throw appError('Связать можно только ручной доход', 409);
  }
  const amount = normalizeMoney(finance.amount, 'Сумма финансовой записи');
  await payrollService.assertDateEditable(finance.date, 'корпоративное пополнение');
  await assertFinanceLinkAvailable(finance.id, transaction);
  assertFinanceMatchesTrainingScope(finance, trainingMarker);
  return finance;
}

async function buildSpendingMetadata(data, trainingMarker, transaction) {
  const metadata = {
    ...(normalizeMetadata(data.metadata) || {}),
    service: normalizeService(data.service),
    source: 'manual_corporate_spending',
  };
  const participantName = normalizeOptionalText(data.participantName);
  if (participantName) metadata.participantName = participantName;

  const clientId = normalizeOptionalId(data.clientId, 'ID клиента');
  if (clientId) {
    const client = await db.User.findByPk(clientId, { transaction });
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
    const booking = await db.Booking.findByPk(bookingId, { transaction });
    if (!booking) throw appError('Бронирование списания не найдено', 404);
    assertEntityMatchesTrainingScope(booking, trainingMarker, 'Бронирование списания');
    const raw = booking.toJSON ? booking.toJSON() : booking;
    metadata.bookingId = raw.id;
    metadata.bookingType = raw.bookingType || null;
    if (!metadata.participantName) metadata.participantName = raw.clientName || null;
  }

  const visitId = normalizeOptionalId(data.visitId, 'ID визита');
  if (visitId) {
    const visit = await db.Visit.findByPk(visitId, { transaction });
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
    const trainingNote = await db.TrainingNote.findByPk(trainingNoteId, {
      transaction,
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

async function createFinanceIncomeForDeposit(data, account, trainingMarker, transaction) {
  const amount = normalizeMoney(data.amount);
  const date = normalizeDateOnly(data.date);
  const categoryName = normalizeName(data.category);
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
  });

  await onboardingService.recordEventSafe(account, 'finance.record_created', {
    entityId: finance.id,
    entityType: 'finance',
    payload: {
      amount: finance.amount,
      category: finance.category,
      date: finance.date,
      type: finance.type,
    },
  });

  return finance;
}

function buildDepositPayload({ client, data, finance, account, trainingMarker, linked }) {
  return {
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

async function createDeposit(corporateClientId, data = {}, account = null) {
  const result = await db.sequelize.transaction(async (transaction) => {
    const client = await findCorporateClient(corporateClientId, {
      transaction,
      lock: transaction?.LOCK?.UPDATE,
    });
    await assertCorporateClientInScope(client, account);
    if (client.status !== 'active') {
      throw appError('Пополнение доступно только для активной компании', 409);
    }

    const trainingMarker = await onboardingService.getTrainingDataMarker(account);
    const linked = Boolean(data.financeId);
    const finance = linked
      ? await loadLinkedFinance(data, trainingMarker, transaction)
      : await createFinanceIncomeForDeposit(data, account, trainingMarker, transaction);

    const entry = await db.CorporateLedgerEntry.create(
      buildDepositPayload({
        account,
        client,
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
      account,
      date: entry.date,
      reason: data.comment,
      afterData: entry.toJSON ? entry.toJSON() : entry,
    });

    return {
      clientId: client.id,
      entryId: entry.id,
    };
  });

  const ledgerEntry = await db.CorporateLedgerEntry.findByPk(result.entryId, {
    include: buildLedgerInclude(),
  });

  return {
    corporateClient: await getCorporateClient(result.clientId, account),
    ledgerEntry: serializeLedgerEntry(ledgerEntry),
  };
}

async function createSpending(corporateClientId, data = {}, account = null) {
  const result = await db.sequelize.transaction(async (transaction) => {
    const client = await findCorporateClient(corporateClientId, {
      transaction,
      lock: transaction?.LOCK?.UPDATE,
    });
    await assertCorporateClientInScope(client, account);
    if (client.status !== 'active') {
      throw appError('Списание доступно только для активной компании', 409);
    }

    const amount = normalizeMoney(data.amount);
    const date = normalizeDateOnly(data.date);
    await payrollService.assertDateEditable(date, 'корпоративное списание');
    const balance = (await getBalancesForClientIds([client.id], transaction)).get(client.id) || 0;
    if (amount > balance) {
      throw appError('Недостаточно средств на корпоративном балансе', 409);
    }

    const trainingMarker = await onboardingService.getTrainingDataMarker(account);
    const metadata = await buildSpendingMetadata(data, trainingMarker, transaction);
    const entry = await db.CorporateLedgerEntry.create(
      {
        amount,
        category: metadata.service,
        comment: normalizeOptionalText(data.comment),
        corporateClientId: client.id,
        createdByAccountId: account?.id || null,
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
      account,
      date,
      reason: data.comment,
      afterData: entry.toJSON ? entry.toJSON() : entry,
    });

    return {
      clientId: client.id,
      entryId: entry.id,
    };
  });

  const ledgerEntry = await db.CorporateLedgerEntry.findByPk(result.entryId, {
    include: buildLedgerInclude(),
  });

  return {
    corporateClient: await getCorporateClient(result.clientId, account),
    ledgerEntry: serializeLedgerEntry(ledgerEntry),
  };
}

async function listLedgerEntries(corporateClientId, query = {}, account = null) {
  const client = await findCorporateClient(corporateClientId);
  await assertCorporateClientInScope(client, account);
  const where = {
    corporateClientId: client.id,
  };
  if (query.status && query.status !== 'all') {
    const status = String(query.status);
    if (!CORPORATE_LEDGER_ENTRY_STATUSES.includes(status)) {
      throw appError('Некорректный статус операции баланса');
    }
    where.status = status;
  }
  if (query.type && query.type !== 'all') {
    const type = String(query.type);
    if (!CORPORATE_LEDGER_ENTRY_TYPES.includes(type)) {
      throw appError('Некорректный тип операции баланса');
    }
    where.type = type;
  }
  if (query.from || query.to) {
    where.date = {};
    if (query.from) where.date[Op.gte] = normalizeDateOnly(query.from, 'дату начала');
    if (query.to) where.date[Op.lte] = normalizeDateOnly(query.to, 'дату окончания');
  }

  const rows = await db.CorporateLedgerEntry.findAll({
    where,
    include: buildLedgerInclude(),
    order: [
      ['date', 'DESC'],
      ['id', 'DESC'],
    ],
  });
  const balanceWhere = {
    corporateClientId: client.id,
    status: 'active',
  };
  if (where.date) balanceWhere.date = where.date;
  const balanceRows = await db.CorporateLedgerEntry.findAll({
    where: balanceWhere,
    order: [
      ['date', 'ASC'],
      ['id', 'ASC'],
    ],
  });
  const runningBalances = new Map();
  let balance = await getOpeningBalance(client.id, query.from, null);
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
  });
}

async function cancelDeposit(corporateClientId, entryId, data = {}, account = null) {
  const result = await db.sequelize.transaction(async (transaction) => {
    const client = await findCorporateClient(corporateClientId, {
      transaction,
      lock: transaction?.LOCK?.UPDATE,
    });
    await assertCorporateClientInScope(client, account);
    const entry = await db.CorporateLedgerEntry.findOne({
      where: {
        corporateClientId: client.id,
        id: normalizeId(entryId, 'ID пополнения'),
        type: 'deposit',
      },
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
        canceledByAccountId: account?.id || null,
        cancelReason: normalizeOptionalText(data.reason),
        status: 'canceled',
      },
      { transaction },
    );

    if (entry.financeId && entry.financeCreatedByLedger) {
      const finance = await db.Finance.findByPk(entry.financeId, {
        transaction,
        lock: transaction?.LOCK?.UPDATE,
      });
      if (finance) {
        const financeBefore = finance.toJSON ? finance.toJSON() : { ...finance };
        await finance.destroy({ transaction });
        await payrollService.recordChange({
          action: 'corporate_deposit.finance_deleted',
          entityType: 'finance',
          entityId: finance.id,
          account,
          date: financeBefore.date,
          reason: data.reason,
          beforeData: financeBefore,
        });
      }
    }

    await payrollService.recordChange({
      action: 'corporate_deposit.cancel',
      entityType: 'corporate_ledger_entry',
      entityId: entry.id,
      account,
      date: entry.date,
      reason: data.reason,
      beforeData,
      afterData: entry.toJSON ? entry.toJSON() : entry,
    });

    return {
      clientId: client.id,
      entryId: entry.id,
    };
  });

  const ledgerEntry = await db.CorporateLedgerEntry.findByPk(result.entryId, {
    include: buildLedgerInclude(),
  });

  return {
    corporateClient: await getCorporateClient(result.clientId, account),
    ledgerEntry: serializeLedgerEntry(ledgerEntry),
  };
}

async function reverseSpending(corporateClientId, entryId, data = {}, account = null) {
  const result = await db.sequelize.transaction(async (transaction) => {
    const client = await findCorporateClient(corporateClientId, {
      transaction,
      lock: transaction?.LOCK?.UPDATE,
    });
    await assertCorporateClientInScope(client, account);
    const entry = await db.CorporateLedgerEntry.findOne({
      where: {
        corporateClientId: client.id,
        id: normalizeId(entryId, 'ID списания'),
        type: 'spending',
      },
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
        canceledByAccountId: account?.id || null,
        cancelReason: normalizeOptionalText(data.reason),
        status: 'canceled',
      },
      { transaction },
    );

    await payrollService.recordChange({
      action: 'corporate_spending.reverse',
      entityType: 'corporate_ledger_entry',
      entityId: entry.id,
      account,
      date: entry.date,
      reason: data.reason,
      beforeData,
      afterData: entry.toJSON ? entry.toJSON() : entry,
    });

    return {
      clientId: client.id,
      entryId: entry.id,
    };
  });

  const ledgerEntry = await db.CorporateLedgerEntry.findByPk(result.entryId, {
    include: buildLedgerInclude(),
  });

  return {
    corporateClient: await getCorporateClient(result.clientId, account),
    ledgerEntry: serializeLedgerEntry(ledgerEntry),
  };
}

function buildLedgerExport(rows, client, query = {}) {
  const summaryRows = [
    { Показатель: 'Компания', Значение: client.name },
    { Показатель: 'Период', Значение: `${query.from || '...'} — ${query.to || '...'}` },
    { Показатель: 'Операций', Значение: rows.length },
    { Показатель: 'Текущий баланс', Значение: client.balance },
  ];
  const detailRows = [...rows]
    .sort((left, right) => {
      const dateCompare = String(left.date).localeCompare(String(right.date));
      if (dateCompare !== 0) return dateCompare;
      return Number(left.id || 0) - Number(right.id || 0);
    })
    .map((entry) => ({
      Дата: entry.date,
      Тип: LEDGER_TYPE_LABELS_FOR_EXPORT[entry.type] || entry.type,
      Статус: entry.status === 'active' ? 'Активно' : 'Отменено',
      Услуга: entry.service || (entry.type === 'deposit' ? 'Пополнение' : ''),
      'Участник/клиент': entry.participantName || entry.clientName || '',
      Сумма: entry.signedAmount,
      Комментарий: entry.comment || '',
      Остаток: entry.runningBalance ?? '',
      'ID операции': entry.id,
      'Client ID': entry.clientId || '',
      'Booking ID': entry.bookingId || '',
      'Visit ID': entry.visitId || '',
      'Training note ID': entry.trainingNoteId || '',
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

const LEDGER_TYPE_LABELS_FOR_EXPORT = {
  deposit: 'Пополнение',
  spending: 'Списание',
};

async function exportLedgerDetails(corporateClientId, query = {}, account = null) {
  const client = await getCorporateClient(corporateClientId, account);
  const rows = await listLedgerEntries(corporateClientId, query, account);

  await payrollService.recordChange({
    action: 'corporate_ledger.export',
    entityType: 'corporate_client',
    entityId: client.id,
    account,
    fromDate: query.from || null,
    toDate: query.to || null,
    afterData: {
      entries: rows.length,
      name: client.name,
    },
  });

  await onboardingService.recordEventSafe(account, 'report.exported', {
    entityType: 'corporate_ledger',
    payload: {
      corporateClientId: client.id,
      fromDate: query.from || null,
      report: 'corporate_ledger',
      toDate: query.to || null,
    },
  });

  return {
    buffer: buildLedgerExport(rows, client, query),
    filename: `corporate-${client.id}-${query.from || 'start'}-${query.to || 'end'}.xlsx`,
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
