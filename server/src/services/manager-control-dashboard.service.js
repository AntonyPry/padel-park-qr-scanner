const { Op } = require('sequelize');
const db = require('../../models');
const {
  bindClientMoneyActor,
  clubTenantWhere,
  resolveClientMoneyAccessContextForModel,
} = require('./client-money-access-context.service');
const bookingsService = require('./bookings.service');
const callTasksService = require('./call-tasks.service');
const certificatesService = require('./certificates.service');
const corporateClientsService = require('./corporate-clients.service');
const pendingSaleService = require('./pending-sale.service');
const subscriptionsService = require('./subscriptions.service');

const DEFAULT_EXPIRING_DAYS = 14;
const DEFAULT_LIMIT = 6;
const MAX_LIMIT = 30;
const DEFAULT_LOW_BALANCE_THRESHOLD = 5000;
const ACTIVE_CALL_TASK_STATUSES = ['backlog', 'in_progress'];
const ACTIVE_TELEPHONY_STATUSES = ['new', 'in_progress'];

function toNumber(value) {
  const numberValue = Number(value || 0);
  return Number.isFinite(numberValue) ? numberValue : 0;
}

function normalizeInteger(value, fallback, max = null) {
  if (value === undefined || value === null || value === '') return fallback;
  const numberValue = Number(value);
  if (!Number.isInteger(numberValue) || numberValue <= 0) return fallback;
  return max ? Math.min(numberValue, max) : numberValue;
}

function normalizeMoney(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue) || numberValue < 0) return fallback;
  return Number(numberValue.toFixed(2));
}

function getDateOnly(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return getDateOnly(new Date());
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

function normalizeDateOnly(value) {
  const raw = String(value || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  return getDateOnly(new Date());
}

function getDayRange(dateValue) {
  const date = normalizeDateOnly(dateValue);
  return {
    date,
    from: new Date(`${date}T00:00:00`),
    to: new Date(`${date}T23:59:59.999`),
  };
}

function addDays(date, days) {
  const result = new Date(date);
  result.setDate(result.getDate() + Number(days || 0));
  return result;
}

function toDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function normalizeFilters(query = {}) {
  return {
    date: normalizeDateOnly(query.date),
    expiringDays: normalizeInteger(query.expiringDays, DEFAULT_EXPIRING_DAYS, 365),
    limit: normalizeInteger(query.limit, DEFAULT_LIMIT, MAX_LIMIT),
    lowBalanceThreshold: normalizeMoney(
      query.lowBalanceThreshold,
      DEFAULT_LOW_BALANCE_THRESHOLD,
    ),
  };
}

function trimSection(items, limit) {
  return {
    items: items.slice(0, limit),
    total: items.length,
  };
}

function getClientLabel(client, fallbackName = null) {
  if (client?.name) return client.name;
  return fallbackName || 'Клиент не указан';
}

function getBookingDateHref(booking) {
  return getDateOnly(booking.startsAt || new Date());
}

function mapPendingSale(sale) {
  return {
    actionHref: '/admin/catalog?tab=pending',
    actionLabel: 'Привязать клиента',
    amount: toNumber(sale.amount),
    createdAt: sale.createdAt || null,
    id: sale.id,
    meta: sale.receiptDateTime || sale.evotorId || sale.category || null,
    reason: 'Продажа Эвотора без клиента',
    title: sale.itemName,
    type: sale.saleIntent,
  };
}

function mapSubscription(subscription) {
  const label = subscription.remainingSessions === null
    ? 'безлимит'
    : `${subscription.remainingSessions} из ${subscription.sessionsTotal || 0}`;
  return {
    actionHref: `/admin/clients?clientId=${subscription.clientId}`,
    actionLabel: 'Открыть клиента',
    client: subscription.client || null,
    expiresAt: subscription.expiresAt || null,
    id: subscription.id,
    meta: `${label} занятий`,
    reason: 'Скоро истекает',
    title: `${getClientLabel(subscription.client)} · ${subscription.typeName}`,
  };
}

function mapCertificate(certificate) {
  const balance = certificate.certificateType === 'money'
    ? `${toNumber(certificate.amountRemaining)} ₽`
    : `${certificate.unitsRemaining || 0} услуг`;
  return {
    actionHref: `/admin/certificates?certificateId=${certificate.id}`,
    actionLabel: 'Открыть сертификат',
    client: certificate.client || null,
    expiresAt: certificate.expiresAt || null,
    id: certificate.id,
    meta: balance,
    reason: 'Скоро истекает',
    title: `${certificate.code} · ${certificate.title}`,
  };
}

function mapCorporateClient(client) {
  return {
    actionHref: `/admin/corporate-clients?companyId=${client.id}`,
    actionLabel: 'Проверить баланс',
    balance: toNumber(client.balance),
    contact: client.contactName || client.contactPhone || client.contactEmail || null,
    id: client.id,
    meta: `${toNumber(client.balance)} ₽`,
    reason: 'Низкий корпоративный баланс',
    title: client.name,
  };
}

function mapCallTask(task, now) {
  const dueAt = toDate(task.dueAt);
  const taskOverdue = Boolean(dueAt && dueAt.getTime() < now.getTime());
  return {
    actionHref: `/admin/call-tasks?taskId=${task.id}&clientStatus=overdue`,
    actionLabel: 'Разобрать обзвон',
    dueAt: task.dueAt || null,
    id: task.id,
    meta: task.overdueCount > 0
      ? `${task.overdueCount} клиентов просрочено`
      : 'дедлайн задачи прошел',
    reason: taskOverdue ? 'Просрочена задача' : 'Есть просроченные клиенты',
    title: task.title,
  };
}

function mapMissedCall(call) {
  const clientLabel = call.client?.name || call.clientPhone || 'Неизвестный номер';
  return {
    actionHref: `/admin/telephony?status=missed&callId=${call.id}`,
    actionLabel: 'Обработать звонок',
    client: call.client || null,
    id: call.id,
    meta: call.staff?.name || call.clientPhone || null,
    reason: 'Пропущенный звонок без результата',
    startedAt: call.startedAt || call.createdAt || null,
    title: clientLabel,
  };
}

function addBookingProblem(problemMap, booking, type, reason, actionLabel, meta = null) {
  const current = problemMap.get(booking.id) || {
    actionHref: `/admin/bookings?date=${getBookingDateHref(booking)}&bookingId=${booking.id}`,
    actionLabel,
    bookingId: booking.id,
    client: booking.client || null,
    id: booking.id,
    meta,
    paymentStatus: booking.paymentStatus,
    price: toNumber(booking.price),
    problemTypes: [],
    reasons: [],
    startsAt: booking.startsAt,
    status: booking.status,
    title: `${booking.clientName || booking.client?.name || 'Клиент'} · ${booking.court?.name || 'корт'}`,
  };

  if (!current.problemTypes.includes(type)) current.problemTypes.push(type);
  if (!current.reasons.includes(reason)) current.reasons.push(reason);
  if (!current.meta && meta) current.meta = meta;
  if (type === 'conflict') current.actionLabel = 'Открыть конфликт';
  if (type === 'unpaid' && current.actionLabel !== 'Открыть конфликт') {
    current.actionLabel = 'Отметить оплату';
  }
  problemMap.set(booking.id, current);
}

function detectBookingConflicts(bookings) {
  const active = bookings
    .filter((booking) => booking.status !== 'canceled')
    .sort((left, right) => {
      if (left.courtId !== right.courtId) return Number(left.courtId) - Number(right.courtId);
      return new Date(left.startsAt).getTime() - new Date(right.startsAt).getTime();
    });
  const conflicts = [];

  for (let i = 0; i < active.length; i += 1) {
    for (let j = i + 1; j < active.length; j += 1) {
      const left = active[i];
      const right = active[j];
      if (left.courtId !== right.courtId) break;

      const leftStart = new Date(left.startsAt).getTime();
      const leftEnd = new Date(left.endsAt).getTime();
      const rightStart = new Date(right.startsAt).getTime();
      const rightEnd = new Date(right.endsAt).getTime();
      if (leftStart < rightEnd && rightStart < leftEnd) {
        conflicts.push([left, right]);
      }
    }
  }

  return conflicts;
}

function buildProblemBookings(bookings) {
  const problemMap = new Map();

  bookings.forEach((booking) => {
    const price = toNumber(booking.price);
    const paidAmount = toNumber(booking.paidAmount);
    if (
      booking.status !== 'canceled' &&
      price > 0 &&
      booking.paymentStatus !== 'paid' &&
      booking.paymentStatus !== 'refunded' &&
      paidAmount < price
    ) {
      addBookingProblem(
        problemMap,
        booking,
        'unpaid',
        'Бронь без полной оплаты',
        'Отметить оплату',
        `${Math.max(0, price - paidAmount)} ₽ к оплате`,
      );
    }

    if (booking.status === 'canceled') {
      addBookingProblem(
        problemMap,
        booking,
        'canceled',
        'Отмененная бронь',
        'Проверить отмену',
        booking.cancellationReason || 'без причины',
      );
    }
  });

  detectBookingConflicts(bookings).forEach(([left, right]) => {
    addBookingProblem(
      problemMap,
      left,
      'conflict',
      `Пересечение с бронью #${right.id}`,
      'Открыть конфликт',
      right.clientName || right.client?.name || `бронь #${right.id}`,
    );
    addBookingProblem(
      problemMap,
      right,
      'conflict',
      `Пересечение с бронью #${left.id}`,
      'Открыть конфликт',
      left.clientName || left.client?.name || `бронь #${left.id}`,
    );
  });

  return Array.from(problemMap.values()).sort((left, right) => {
    const severityDiff =
      Number(right.problemTypes.includes('conflict')) -
      Number(left.problemTypes.includes('conflict'));
    if (severityDiff !== 0) return severityDiff;
    return new Date(left.startsAt || 0).getTime() - new Date(right.startsAt || 0).getTime();
  });
}

function buildSummary(sections) {
  const total =
    sections.pendingSales.total +
    sections.expiringSubscriptions.total +
    sections.expiringCertificates.total +
    sections.lowCorporateBalances.total +
    sections.overdueCallTasks.total +
    sections.missedCalls.total +
    sections.problemBookings.total;

  return {
    attentionTotal: total,
    bookings: sections.problemBookings.total,
    calls:
      sections.overdueCallTasks.total +
      sections.missedCalls.total,
    prepayments:
      sections.pendingSales.total +
      sections.expiringSubscriptions.total +
      sections.expiringCertificates.total +
      sections.lowCorporateBalances.total,
  };
}

async function listExpiringSubscriptions(now, expiringUntil, context = null) {
  const rows = await db.ClientSubscription.findAll({
    include: [
      {
        model: db.User,
        as: 'client',
        attributes: ['id', 'name', 'phone', 'status'],
      },
      {
        model: db.SubscriptionType,
        as: 'subscriptionType',
      },
    ],
    order: [
      ['expiresAt', 'ASC'],
      ['createdAt', 'DESC'],
    ],
    where: clubTenantWhere(context, {
      expiresAt: { [Op.gte]: now, [Op.lte]: expiringUntil },
      status: 'active',
    }),
  });
  return rows
    .map((row) => subscriptionsService.serializeSubscription(row, { now }))
    .filter((item) => item.status === 'active');
}

async function listExpiringCertificates(now, expiringUntil, context = null) {
  const rows = await db.Certificate.findAll({
    include: [
      {
        model: db.User,
        as: 'client',
        attributes: ['id', 'name', 'phone', 'status'],
      },
    ],
    order: [
      ['expiresAt', 'ASC'],
      ['createdAt', 'DESC'],
    ],
    where: clubTenantWhere(context, {
      expiresAt: { [Op.gte]: now, [Op.lte]: expiringUntil },
      status: 'active',
    }),
  });
  return rows
    .map((row) => certificatesService.serializeCertificate(row, { now }))
    .filter((item) => item.status === 'active');
}

async function listMissedCallsWithoutResult() {
  const where = {
    callStatus: 'missed',
    processingStatus: { [Op.in]: ACTIVE_TELEPHONY_STATUSES },
    result: null,
  };
  const [total, rows] = await Promise.all([
    db.TelephonyCall.count({ where }),
    db.TelephonyCall.findAll({
      include: [
        {
          model: db.User,
          as: 'client',
          attributes: ['id', 'name', 'phone', 'status'],
        },
        {
          model: db.Staff,
          as: 'staff',
          attributes: ['id', 'name', 'role', 'status'],
        },
      ],
      order: [
        ['startedAt', 'ASC'],
        ['createdAt', 'ASC'],
      ],
      where,
    }),
  ]);

  return {
    items: rows.map((row) => {
      const raw = row.toJSON ? row.toJSON() : row;
      return {
        ...raw,
        client: raw.client || null,
        staff: raw.staff || null,
      };
    }),
    total,
  };
}

async function getDashboard(query = {}, account = null, tenant = null) {
  const clientMoneyContext = await resolveClientMoneyAccessContextForModel(
    tenant,
    db.ClientSubscription,
  );
  const authorityActor = bindClientMoneyActor(account, clientMoneyContext);
  const filters = normalizeFilters(query);
  const range = getDayRange(filters.date);
  const now = new Date();
  const expiringUntil = addDays(now, filters.expiringDays);

  const [
    pendingSalesRaw,
    expiringSubscriptionsRaw,
    expiringCertificatesRaw,
    corporateClientsRaw,
    callTasksRaw,
    missedCallsRaw,
    schedule,
  ] = await Promise.all([
    pendingSaleService.listPendingSales(
      { status: 'pending' },
      clientMoneyContext,
    ),
    listExpiringSubscriptions(now, expiringUntil, clientMoneyContext),
    listExpiringCertificates(now, expiringUntil, clientMoneyContext),
    corporateClientsService.listCorporateClients(
      { status: 'active' },
      authorityActor,
      tenant,
    ),
    callTasksService.list(authorityActor, { status: 'active' }, tenant),
    listMissedCallsWithoutResult(),
    bookingsService.getSchedule({ date: range.date, status: 'all' }, tenant),
  ]);

  const pendingSales = pendingSalesRaw
    .filter((sale) => sale.status === 'pending' && !sale.clientId && !sale.client)
    .sort((left, right) => {
      const leftDate = new Date(left.receiptDateTime || left.createdAt || 0).getTime();
      const rightDate = new Date(right.receiptDateTime || right.createdAt || 0).getTime();
      return leftDate - rightDate;
    })
    .map(mapPendingSale);
  const expiringSubscriptions = expiringSubscriptionsRaw.map(mapSubscription);
  const expiringCertificates = expiringCertificatesRaw.map(mapCertificate);
  const lowCorporateBalances = corporateClientsRaw
    .filter(
      (client) =>
        client.status === 'active' &&
        toNumber(client.balance) >= 0 &&
        toNumber(client.balance) <= filters.lowBalanceThreshold,
    )
    .sort((left, right) => toNumber(left.balance) - toNumber(right.balance))
    .map(mapCorporateClient);
  const overdueCallTasks = callTasksRaw
    .filter((task) => {
      const dueAt = toDate(task.dueAt);
      return (
        ACTIVE_CALL_TASK_STATUSES.includes(task.status) &&
        (toNumber(task.overdueCount) > 0 ||
          Boolean(dueAt && dueAt.getTime() < now.getTime()))
      );
    })
    .sort((left, right) => {
      const overdueDiff = toNumber(right.overdueCount) - toNumber(left.overdueCount);
      if (overdueDiff !== 0) return overdueDiff;
      return new Date(left.dueAt || 8640000000000000).getTime() -
        new Date(right.dueAt || 8640000000000000).getTime();
    })
    .map((task) => mapCallTask(task, now));
  const missedCalls = missedCallsRaw.items.map(mapMissedCall);
  const problemBookings = buildProblemBookings(schedule.bookings || []);

  const sections = {
    expiringCertificates: trimSection(expiringCertificates, filters.limit),
    expiringSubscriptions: trimSection(expiringSubscriptions, filters.limit),
    lowCorporateBalances: trimSection(lowCorporateBalances, filters.limit),
    missedCalls: {
      items: missedCalls.slice(0, filters.limit),
      total: missedCallsRaw.total,
    },
    overdueCallTasks: trimSection(overdueCallTasks, filters.limit),
    pendingSales: trimSection(pendingSales, filters.limit),
    problemBookings: trimSection(problemBookings, filters.limit),
  };

  return {
    filters,
    generatedAt: now.toISOString(),
    range: {
      date: range.date,
      expiringUntil: expiringUntil.toISOString(),
    },
    sections,
    summary: buildSummary(sections),
  };
}

module.exports = {
  getDashboard,
  __testing: {
    buildProblemBookings,
    buildSummary,
    detectBookingConflicts,
    normalizeFilters,
  },
};
