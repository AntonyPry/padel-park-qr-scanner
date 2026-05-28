const { Op } = require('sequelize');
const db = require('../../models');
const bookingRulesService = require('./booking-rules.service');
const referencesService = require('./references.service');
const {
  formatRussianPhone,
  getPhoneLookupDigits,
} = require('../utils/phone');

const BOOKING_STATUSES = new Set([
  'new',
  'confirmed',
  'canceled',
  'arrived',
  'no_show',
]);
const PAYMENT_STATUSES = new Set(['unpaid', 'partial', 'paid', 'refunded']);
const PAYMENT_METHODS = new Set(['unknown', 'cash', 'cashless', 'mixed']);
const BOOKING_SOURCES = new Set(['phone', 'admin', 'walk_in', 'other']);
const MAX_DURATION_MINUTES = 720;
const SERIES_STATUSES = new Set(['active', 'archived']);
const MAX_SERIES_DAYS = 370;
const MAX_SERIES_OCCURRENCES = 120;
const MAX_ANALYTICS_DAYS = 370;
const BOOKING_SOURCE_LABELS = {
  admin: 'Админ',
  other: 'Другое',
  phone: 'Телефон',
  walk_in: 'На месте',
};
const BOOKING_STATUS_LABELS = {
  arrived: 'Пришел',
  canceled: 'Отменена',
  confirmed: 'Подтверждена',
  new: 'Новая',
  no_show: 'Не пришел',
};
const BOOKING_PAYMENT_STATUS_LABELS = {
  paid: 'Оплачено',
  partial: 'Частично',
  refunded: 'Возврат',
  unpaid: 'Не оплачено',
};

function appError(message, statusCode = 400, details = {}) {
  const error = new Error(message);
  error.statusCode = statusCode;
  Object.assign(error, details);
  return error;
}

function normalizeText(value) {
  const text = String(value || '').trim().replace(/\s+/g, ' ');
  return text || null;
}

function normalizeClientName(name) {
  const normalized = String(name || '').trim().replace(/\s+/g, ' ');
  if (normalized.length < 2) {
    throw appError('Имя клиента должно быть не короче 2 символов');
  }
  return normalized;
}

function normalizePhonePayload(phone) {
  const phoneNormalized = getPhoneLookupDigits(phone);
  if (phoneNormalized.length !== 10) {
    throw appError('Телефон клиента должен содержать 10 цифр после кода страны');
  }

  return {
    phone: formatRussianPhone(phone),
    phoneNormalized,
  };
}

function normalizeMoney(value, label) {
  if (value === undefined || value === null || value === '') return 0;
  const numberValue = Number(String(value).replace(',', '.'));
  if (!Number.isFinite(numberValue) || numberValue < 0) {
    throw appError(`${label} должно быть неотрицательным числом`);
  }
  return Math.round(numberValue * 100) / 100;
}

function normalizeEnum(value, allowedValues, fallback, label) {
  const normalized = String(value || fallback);
  if (!allowedValues.has(normalized)) {
    throw appError(`Некорректное значение поля «${label}»`);
  }
  return normalized;
}

function normalizeDuration(value) {
  const duration = Number(value || 60);
  if (
    !Number.isInteger(duration) ||
    duration <= 0 ||
    duration > MAX_DURATION_MINUTES
  ) {
    throw appError(`Длительность брони должна быть целым числом от 1 до ${MAX_DURATION_MINUTES} минут`);
  }
  return duration;
}

function parseDate(value, label) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) {
    throw appError(`${label} указано некорректно`);
  }
  return date;
}

function getDayRange(dateValue) {
  const date = String(dateValue || new Date().toISOString().slice(0, 10));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw appError('Дата должна быть в формате YYYY-MM-DD');
  }

  return {
    date,
    from: new Date(`${date}T00:00:00`),
    to: new Date(`${date}T23:59:59.999`),
  };
}

function normalizeDateOnly(value, label = 'Дата') {
  const date = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw appError(`${label} должна быть в формате YYYY-MM-DD`);
  }
  return date;
}

function addDaysToDateOnly(value, days) {
  const date = new Date(`${value}T00:00:00`);
  date.setDate(date.getDate() + days);
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

function countDateDays(from, to) {
  return Math.round(
    (new Date(`${to}T00:00:00`).getTime() - new Date(`${from}T00:00:00`).getTime()) /
      86400000,
  );
}

function getDateOnly(value) {
  const date = new Date(value);
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

function getDateRange(query = {}) {
  const today = getDateOnly(new Date());
  const to = normalizeDateOnly(query.to || today, 'Дата окончания');
  const from = normalizeDateOnly(query.from || addDaysToDateOnly(to, -30), 'Дата начала');
  const days = countDateDays(from, to);

  if (days < 0) {
    throw appError('Дата начала не может быть позже даты окончания');
  }
  if (days > MAX_ANALYTICS_DAYS) {
    throw appError(`Период отчета не может быть длиннее ${MAX_ANALYTICS_DAYS} дней`);
  }

  return {
    days,
    from,
    fromDate: new Date(`${from}T00:00:00`),
    to,
    toDate: new Date(`${to}T23:59:59.999`),
  };
}

function getDateList(from, to) {
  const dates = [];
  for (let date = from; date <= to; date = addDaysToDateOnly(date, 1)) {
    dates.push(date);
  }
  return dates;
}

function getIsoWeekday(dateOnly) {
  const day = new Date(`${dateOnly}T00:00:00`).getDay();
  return day === 0 ? 7 : day;
}

function normalizeWeekday(value) {
  const weekday = Number(value);
  if (!Number.isInteger(weekday) || weekday < 1 || weekday > 7) {
    throw appError('День недели должен быть от 1 до 7');
  }
  return weekday;
}

function normalizeStartTime(value) {
  const time = String(value || '').trim();
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
    throw appError('Время начала должно быть в формате HH:mm');
  }
  return time;
}

function buildStartsAt(data, fallback) {
  if (data.startsAt) return parseDate(data.startsAt, 'Время начала');
  if (data.date && data.startTime) {
    return parseDate(`${data.date}T${data.startTime}:00`, 'Время начала');
  }
  if (fallback) return new Date(fallback);
  throw appError('Укажите дату и время бронирования');
}

function buildTiming(data, currentBooking = null) {
  const startsAt = buildStartsAt(data, currentBooking?.startsAt);
  const durationMinutes = normalizeDuration(
    data.durationMinutes || currentBooking?.durationMinutes,
  );
  const endsAt = new Date(startsAt.getTime() + durationMinutes * 60000);

  if (endsAt <= startsAt) {
    throw appError('Время окончания должно быть позже начала');
  }

  return { durationMinutes, endsAt, startsAt };
}

function mapAccount(account) {
  if (!account) return null;
  const raw = account.toJSON ? account.toJSON() : account;
  return {
    email: raw.email,
    id: raw.id,
    name: raw.Staff?.name || raw.email,
    role: raw.role,
  };
}

function mapClient(client) {
  if (!client) return null;
  const raw = client.toJSON ? client.toJSON() : client;
  return {
    id: raw.id,
    name: raw.name,
    phone: raw.phone,
    status: raw.status,
  };
}

function mapCourt(court) {
  if (!court) return null;
  const raw = court.toJSON ? court.toJSON() : court;
  return {
    id: raw.id,
    isActive: Boolean(raw.isActive),
    name: raw.name,
    sortOrder: Number(raw.sortOrder || 0),
    type: raw.type,
  };
}

function mapBooking(booking) {
  const raw = booking.toJSON ? booking.toJSON() : booking;
  return {
    id: raw.id,
    court: mapCourt(raw.Court),
    courtId: raw.courtId,
    bookingSeriesId: raw.bookingSeriesId || null,
    series: raw.series ? mapSeries(raw.series) : null,
    userId: raw.userId,
    client: mapClient(raw.User),
    clientName: raw.clientName,
    clientPhone: raw.clientPhone,
    startsAt: raw.startsAt,
    endsAt: raw.endsAt,
    durationMinutes: Number(raw.durationMinutes || 0),
    status: raw.status,
    paymentStatus: raw.paymentStatus,
    paymentMethod: raw.paymentMethod,
    price: Number(raw.price || 0),
    paidAmount: Number(raw.paidAmount || 0),
    source: raw.source,
    comment: raw.comment,
    cancellationReason: raw.cancellationReason,
    canceledAt: raw.canceledAt,
    createdBy: mapAccount(raw.createdBy),
    updatedBy: mapAccount(raw.updatedBy),
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  };
}

function mapSeries(series) {
  if (!series) return null;
  const raw = series.toJSON ? series.toJSON() : series;
  return {
    id: raw.id,
    name: raw.name,
    court: mapCourt(raw.Court),
    courtId: raw.courtId,
    userId: raw.userId,
    client: mapClient(raw.User),
    clientName: raw.clientName,
    clientPhone: raw.clientPhone,
    weekday: Number(raw.weekday),
    startTime: raw.startTime,
    durationMinutes: Number(raw.durationMinutes || 0),
    startsOn: raw.startsOn,
    endsOn: raw.endsOn,
    status: raw.status,
    paymentStatus: raw.paymentStatus,
    paymentMethod: raw.paymentMethod,
    price: raw.price === null || raw.price === undefined ? null : Number(raw.price),
    source: raw.source,
    comment: raw.comment,
    lastGeneratedUntil: raw.lastGeneratedUntil,
    archivedAt: raw.archivedAt,
    archiveReason: raw.archiveReason,
    createdBy: mapAccount(raw.createdBy),
    updatedBy: mapAccount(raw.updatedBy),
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  };
}

function mapChangeLog(row) {
  const raw = row.toJSON ? row.toJSON() : row;
  return {
    id: raw.id,
    action: raw.action,
    actor: mapAccount(raw.actor),
    bookingId: raw.bookingId,
    createdAt: raw.createdAt,
    fromStatus: raw.fromStatus,
    reason: raw.reason,
    snapshot: raw.snapshot,
    toStatus: raw.toStatus,
  };
}

async function lockCourtsForBooking(courtIds, transaction) {
  const ids = Array.from(
    new Set(courtIds.map((courtId) => Number(courtId)).filter(Boolean)),
  ).sort((a, b) => a - b);

  const courts = await db.Court.findAll({
    lock: transaction.LOCK.UPDATE,
    order: [['id', 'ASC']],
    transaction,
    where: { id: { [Op.in]: ids } },
  });
  const courtsById = new Map(courts.map((court) => [Number(court.id), court]));

  ids.forEach((id) => {
    const court = courtsById.get(id);
    if (!court || !court.isActive) throw appError('Корт не найден или выключен', 404);
  });

  return courtsById;
}

async function getBookingOrFail(id, transaction) {
  const booking = await db.Booking.findByPk(Number(id), {
    include: [
      db.Court,
      db.User,
      { as: 'series', model: db.BookingSeries },
      { as: 'createdBy', model: db.Account, include: [db.Staff] },
      { as: 'updatedBy', model: db.Account, include: [db.Staff] },
    ],
    lock: transaction ? transaction.LOCK.UPDATE : undefined,
    transaction,
  });
  if (!booking) throw appError('Бронь не найдена', 404);
  return booking;
}

async function resolveClient(data, transaction) {
  if (data.userId) {
    const client = await db.User.findByPk(Number(data.userId), { transaction });
    if (!client) throw appError('Клиент не найден', 404);
    if (client.status === 'archived') {
      throw appError('Клиент в архиве. Сначала восстановите его в разделе клиентов', 409);
    }
    return client;
  }

  const payload = data.client || {};
  if (!payload.name || !payload.phone) {
    throw appError('Выберите клиента или заполните имя и телефон нового клиента');
  }

  const name = normalizeClientName(payload.name);
  const { phone, phoneNormalized } = normalizePhonePayload(payload.phone);
  const existing = await db.User.findOne({
    transaction,
    where: { phoneNormalized },
  });
  if (existing) {
    throw appError(
      existing.status === 'archived'
        ? 'Клиент с таким телефоном уже есть в архиве. Восстановите его вместо повторной регистрации'
        : 'Клиент с таким телефоном уже существует',
      409,
      {
        code:
          existing.status === 'archived'
            ? 'CLIENT_ARCHIVED_CONFLICT'
            : 'CLIENT_ACTIVE_CONFLICT',
        client: mapClient(existing),
      },
    );
  }

  const sourceRef = await referencesService.getClientSourceByInput({
    source: payload.source || 'Ресепшн (Админ)',
    sourceId: payload.sourceId,
  });
  const webId = `web_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

  return db.User.create(
    {
      name,
      note: normalizeText(payload.note),
      phone,
      phoneNormalized,
      source: sourceRef.name,
      sourceId: sourceRef.id,
      status: 'active',
      webId,
    },
    { transaction },
  );
}

async function assertNoConflict({
  courtId,
  endsAt,
  excludeBookingId = null,
  startsAt,
  transaction,
}) {
  const where = {
    courtId: Number(courtId),
    endsAt: { [Op.gt]: startsAt },
    startsAt: { [Op.lt]: endsAt },
    status: { [Op.ne]: 'canceled' },
  };

  if (excludeBookingId) {
    where.id = { [Op.ne]: Number(excludeBookingId) };
  }

  const conflict = await db.Booking.findOne({
    include: [db.Court],
    transaction,
    where,
  });

  if (conflict) {
    throw appError('На это время корт уже забронирован', 409, {
      code: 'BOOKING_TIME_CONFLICT',
      booking: mapBooking(conflict),
    });
  }
}

async function recordChange(booking, action, account, options = {}, transaction) {
  await db.BookingChangeLog.create(
    {
      action,
      actorAccountId: account?.id || null,
      bookingId: booking.id,
      fromStatus: options.fromStatus || null,
      reason: options.reason || null,
      snapshot: mapBooking(booking),
      toStatus: options.toStatus || booking.status,
    },
    { transaction },
  );
}

function buildBookingPayload(data, account, client, timing, currentBooking = null) {
  const status = normalizeEnum(
    data.status,
    BOOKING_STATUSES,
    currentBooking?.status || 'new',
    'статус брони',
  );
  const paymentStatus = normalizeEnum(
    data.paymentStatus,
    PAYMENT_STATUSES,
    currentBooking?.paymentStatus || 'unpaid',
    'статус оплаты',
  );
  const paymentMethod = normalizeEnum(
    data.paymentMethod,
    PAYMENT_METHODS,
    currentBooking?.paymentMethod || 'unknown',
    'способ оплаты',
  );
  const source = normalizeEnum(
    data.source,
    BOOKING_SOURCES,
    currentBooking?.source || 'phone',
    'источник брони',
  );
  const cancellationReason = normalizeText(data.cancellationReason);
  const nextStatus = status;
  if (nextStatus === 'canceled' && !cancellationReason && !currentBooking?.cancellationReason) {
    throw appError('Укажите причину отмены брони');
  }
  const price = normalizeMoney(data.price ?? currentBooking?.price, 'Цена брони');
  const paidAmount = normalizeMoney(
    data.paidAmount ?? currentBooking?.paidAmount,
    'Оплаченная сумма',
  );
  const paymentWasTouched =
    !currentBooking ||
    data.paidAmount !== undefined ||
    data.paymentStatus !== undefined ||
    data.price !== undefined;
  if (paymentWasTouched) {
    if (price > 0 && paidAmount > price) {
      throw appError('Оплаченная сумма не может быть больше цены брони');
    }
    if (paymentStatus === 'paid' && price > 0 && paidAmount < price) {
      throw appError('Для статуса «Оплачено» внесите всю сумму брони');
    }
    if (paymentStatus === 'unpaid' && paidAmount > 0) {
      throw appError('Для статуса «Не оплачено» сумма оплаты должна быть 0');
    }
  }

  return {
    canceledAt:
      nextStatus === 'canceled'
        ? currentBooking?.canceledAt || new Date()
        : null,
    bookingSeriesId:
      data.bookingSeriesId !== undefined
        ? data.bookingSeriesId
        : currentBooking?.bookingSeriesId || null,
    cancellationReason:
      nextStatus === 'canceled'
        ? cancellationReason || currentBooking?.cancellationReason || null
        : null,
    clientName: client.name,
    clientPhone: client.phone,
    comment: normalizeText(data.comment),
    courtId: Number(data.courtId || currentBooking?.courtId),
    durationMinutes: timing.durationMinutes,
    endsAt: timing.endsAt,
    paidAmount,
    paymentMethod,
    paymentStatus,
    price,
    source,
    startsAt: timing.startsAt,
    status,
    updatedByAccountId: account?.id || null,
    userId: client.id,
  };
}

async function listCourts() {
  const courts = await db.Court.findAll({
    order: [
      ['sortOrder', 'ASC'],
      ['name', 'ASC'],
    ],
    where: { isActive: true },
  });
  return courts.map(mapCourt);
}

async function listBookings(query = {}) {
  const range = getDayRange(query.date);
  const where = {
    startsAt: {
      [Op.gte]: range.from,
      [Op.lte]: range.to,
    },
  };

  if (query.status && query.status !== 'all') {
    where.status = normalizeEnum(query.status, BOOKING_STATUSES, 'new', 'статус брони');
  }

  const bookings = await db.Booking.findAll({
    include: [
      db.Court,
      db.User,
      { as: 'series', model: db.BookingSeries },
      { as: 'createdBy', model: db.Account, include: [db.Staff] },
      { as: 'updatedBy', model: db.Account, include: [db.Staff] },
    ],
    order: [
      ['startsAt', 'ASC'],
      [db.Court, 'sortOrder', 'ASC'],
    ],
    where,
  });

  return bookings.map(mapBooking);
}

function buildScheduleStats(bookings) {
  const activeBookings = bookings.filter((booking) => booking.status !== 'canceled');
  const paidAmount = activeBookings.reduce(
    (sum, booking) => sum + Number(booking.paidAmount || 0),
    0,
  );
  const plannedAmount = activeBookings.reduce(
    (sum, booking) => sum + Number(booking.price || 0),
    0,
  );

  return {
    activeCount: activeBookings.length,
    canceledCount: bookings.filter((booking) => booking.status === 'canceled').length,
    noShowCount: bookings.filter((booking) => booking.status === 'no_show').length,
    paidAmount,
    plannedAmount,
    unpaidAmount: Math.max(0, plannedAmount - paidAmount),
  };
}

function getEmptyAnalyticsBucket(id, label, extra = {}) {
  return {
    activeCount: 0,
    bookedMinutes: 0,
    canceledCount: 0,
    id,
    label,
    occupancyPercent: 0,
    paidAmount: 0,
    plannedAmount: 0,
    totalCount: 0,
    unpaidAmount: 0,
    ...extra,
  };
}

function addBookingToAnalyticsBucket(bucket, booking) {
  const isActive = booking.status !== 'canceled';
  bucket.totalCount += 1;
  if (!isActive) {
    bucket.canceledCount += 1;
    return;
  }
  bucket.activeCount += 1;
  bucket.bookedMinutes += Number(booking.durationMinutes || 0);
  bucket.paidAmount += Number(booking.paidAmount || 0);
  bucket.plannedAmount += Number(booking.price || 0);
  bucket.unpaidAmount = Math.max(0, bucket.plannedAmount - bucket.paidAmount);
}

async function buildCapacityByDateAndCourt(dates, courts) {
  const capacityByDate = new Map();
  const capacityByCourt = new Map(courts.map((court) => [Number(court.id), 0]));

  await Promise.all(
    dates.map(async (date) => {
      const schedule = await bookingRulesService.getEffectiveSchedule(date);
      const dayCapacity = schedule.isClosed
        ? 0
        : Math.max(
            0,
            bookingRulesService.timeToMinutes(schedule.workingHoursEnd) -
              bookingRulesService.timeToMinutes(schedule.workingHoursStart),
          );
      const total = dayCapacity * courts.length;
      capacityByDate.set(date, total);
      courts.forEach((court) => {
        capacityByCourt.set(
          Number(court.id),
          Number(capacityByCourt.get(Number(court.id)) || 0) + dayCapacity,
        );
      });
    }),
  );

  return { capacityByCourt, capacityByDate };
}

function finalizeAnalyticsBucket(bucket, capacityMinutes = 0) {
  const bookedHours = Math.round((bucket.bookedMinutes / 60) * 10) / 10;
  const capacityHours = Math.round((capacityMinutes / 60) * 10) / 10;
  return {
    ...bucket,
    bookedHours,
    capacityHours,
    occupancyPercent:
      capacityMinutes > 0
        ? Math.round((bucket.bookedMinutes / capacityMinutes) * 1000) / 10
        : 0,
    paidAmount: Math.round(bucket.paidAmount * 100) / 100,
    plannedAmount: Math.round(bucket.plannedAmount * 100) / 100,
    unpaidAmount: Math.round(Math.max(0, bucket.plannedAmount - bucket.paidAmount) * 100) / 100,
  };
}

function buildDistribution(items, labels) {
  return Object.entries(labels).map(([key, label]) => ({
    count: Number(items.get(key)?.count || 0),
    key,
    label,
    plannedAmount: Math.round(Number(items.get(key)?.plannedAmount || 0) * 100) / 100,
  }));
}

async function getBookingAnalytics(query = {}) {
  const range = getDateRange(query);
  const dates = getDateList(range.from, range.to);
  const courts = await listCourts();
  const bookings = (
    await db.Booking.findAll({
      include: [db.Court, db.User, { as: 'series', model: db.BookingSeries }],
      order: [
        ['startsAt', 'ASC'],
        [db.Court, 'sortOrder', 'ASC'],
      ],
      where: {
        startsAt: {
          [Op.gte]: range.fromDate,
          [Op.lte]: range.toDate,
        },
      },
    })
  ).map(mapBooking);
  const { capacityByCourt, capacityByDate } = await buildCapacityByDateAndCourt(dates, courts);
  const totalCapacityMinutes = Array.from(capacityByDate.values()).reduce(
    (sum, value) => sum + Number(value || 0),
    0,
  );
  const totalBucket = getEmptyAnalyticsBucket('total', 'Итого');
  const byDate = new Map(
    dates.map((date) => [
      date,
      getEmptyAnalyticsBucket(date, date, { date }),
    ]),
  );
  const byCourt = new Map(
    courts.map((court) => [
      Number(court.id),
      getEmptyAnalyticsBucket(court.id, court.name, {
        court,
      }),
    ]),
  );
  const byStatus = new Map();
  const byPaymentStatus = new Map();
  const bySource = new Map();

  bookings.forEach((booking) => {
    const isActive = booking.status !== 'canceled';
    const date = getDateOnly(booking.startsAt);
    const dateBucket = byDate.get(date);
    const courtBucket = byCourt.get(Number(booking.courtId));
    addBookingToAnalyticsBucket(totalBucket, booking);
    if (dateBucket) addBookingToAnalyticsBucket(dateBucket, booking);
    if (courtBucket) addBookingToAnalyticsBucket(courtBucket, booking);

    const statusBucket = byStatus.get(booking.status) || { count: 0, plannedAmount: 0 };
    statusBucket.count += 1;
    statusBucket.plannedAmount += isActive ? Number(booking.price || 0) : 0;
    byStatus.set(booking.status, statusBucket);

    const paymentBucket = byPaymentStatus.get(booking.paymentStatus) || { count: 0, plannedAmount: 0 };
    paymentBucket.count += 1;
    paymentBucket.plannedAmount += isActive ? Number(booking.price || 0) : 0;
    byPaymentStatus.set(booking.paymentStatus, paymentBucket);

    const sourceBucket = bySource.get(booking.source) || { count: 0, plannedAmount: 0 };
    sourceBucket.count += 1;
    sourceBucket.plannedAmount += isActive ? Number(booking.price || 0) : 0;
    bySource.set(booking.source, sourceBucket);
  });

  const courtRows = Array.from(byCourt.values())
    .map((bucket) =>
      finalizeAnalyticsBucket(bucket, Number(capacityByCourt.get(Number(bucket.id)) || 0)),
    )
    .sort((a, b) => b.bookedMinutes - a.bookedMinutes || a.label.localeCompare(b.label));
  const dayRows = Array.from(byDate.values()).map((bucket) =>
    finalizeAnalyticsBucket(bucket, Number(capacityByDate.get(bucket.date) || 0)),
  );
  const total = finalizeAnalyticsBucket(totalBucket, totalCapacityMinutes);

  return {
    byCourt: courtRows,
    byDate: dayRows,
    byPaymentStatus: buildDistribution(byPaymentStatus, BOOKING_PAYMENT_STATUS_LABELS),
    bySource: buildDistribution(bySource, BOOKING_SOURCE_LABELS),
    byStatus: buildDistribution(byStatus, BOOKING_STATUS_LABELS),
    range: {
      days: range.days + 1,
      from: range.from,
      to: range.to,
    },
    total,
  };
}

function shouldAutoPrice(data, currentBooking = null) {
  const priceWasProvided =
    data.price !== undefined &&
    data.price !== null &&
    data.price !== '';
  if (priceWasProvided) return false;
  if (!currentBooking) return true;
  return Boolean(data.courtId || data.startsAt || data.date || data.startTime || data.durationMinutes);
}

async function applyAutomaticPrice(data, courtId, timing, currentBooking = null) {
  if (!shouldAutoPrice(data, currentBooking)) return data;
  const quote = await bookingRulesService.calculateQuote({
    courtId,
    durationMinutes: timing.durationMinutes,
    startsAt: timing.startsAt,
  });
  return { ...data, price: quote.price };
}

function buildSeriesConfig(data) {
  const startsOn = normalizeDateOnly(data.startsOn, 'Дата начала серии');
  const endsOn = normalizeDateOnly(data.endsOn, 'Дата окончания серии');
  if (endsOn < startsOn) {
    throw appError('Дата окончания серии должна быть не раньше даты начала');
  }
  if (countDateDays(startsOn, endsOn) > MAX_SERIES_DAYS) {
    throw appError(`Серия бронирований не может быть длиннее ${MAX_SERIES_DAYS} дней`);
  }

  const weekday = normalizeWeekday(data.weekday || getIsoWeekday(startsOn));
  const startTime = normalizeStartTime(data.startTime);
  const durationMinutes = normalizeDuration(data.durationMinutes);
  const paymentStatus = normalizeEnum(
    data.paymentStatus,
    PAYMENT_STATUSES,
    'unpaid',
    'статус оплаты',
  );
  const paymentMethod = normalizeEnum(
    data.paymentMethod,
    PAYMENT_METHODS,
    'unknown',
    'способ оплаты',
  );
  const source = normalizeEnum(data.source, BOOKING_SOURCES, 'phone', 'источник брони');
  const status = normalizeEnum(
    data.status,
    new Set(['new', 'confirmed']),
    'confirmed',
    'статус брони',
  );

  return {
    comment: normalizeText(data.comment),
    courtId: Number(data.courtId),
    durationMinutes,
    endsOn,
    name: normalizeClientName(data.name || 'Постоянная бронь'),
    paymentMethod,
    paymentStatus,
    price:
      data.price === undefined || data.price === null || data.price === ''
        ? null
        : normalizeMoney(data.price, 'Цена брони'),
    source,
    startsOn,
    startTime,
    status,
    weekday,
  };
}

function getSeriesDates(config) {
  const dates = [];
  for (let date = config.startsOn; date <= config.endsOn; date = addDaysToDateOnly(date, 1)) {
    if (getIsoWeekday(date) === config.weekday) {
      dates.push(date);
    }
    if (dates.length > MAX_SERIES_OCCURRENCES) {
      throw appError(`Серия не может создать больше ${MAX_SERIES_OCCURRENCES} броней за раз`);
    }
  }
  if (dates.length === 0) {
    throw appError('В выбранном периоде нет дат с указанным днем недели');
  }
  return dates;
}

function buildOccurrenceTiming(config, date) {
  const startsAt = parseDate(`${date}T${config.startTime}:00`, 'Время начала брони в серии');
  const endsAt = new Date(startsAt.getTime() + config.durationMinutes * 60000);
  return { endsAt, startsAt };
}

async function inspectSeriesOccurrence(config, date, transaction) {
  const timing = buildOccurrenceTiming(config, date);
  try {
    await bookingRulesService.assertBookable({
      courtId: config.courtId,
      endsAt: timing.endsAt,
      startsAt: timing.startsAt,
      status: config.status,
      transaction,
    });
    const conflict = await db.Booking.findOne({
      include: [db.Court],
      transaction,
      where: {
        courtId: config.courtId,
        endsAt: { [Op.gt]: timing.startsAt },
        startsAt: { [Op.lt]: timing.endsAt },
        status: { [Op.ne]: 'canceled' },
      },
    });
    if (conflict) {
      return {
        conflictBooking: mapBooking(conflict),
        date,
        endsAt: timing.endsAt,
        reason: 'На это время корт уже забронирован',
        startsAt: timing.startsAt,
        status: 'conflict',
      };
    }
    const price =
      config.price === null
        ? (await bookingRulesService.calculateQuote({
            courtId: config.courtId,
            durationMinutes: config.durationMinutes,
            startsAt: timing.startsAt,
          })).price
        : config.price;
    return {
      date,
      endsAt: timing.endsAt,
      price,
      startsAt: timing.startsAt,
      status: 'ok',
    };
  } catch (error) {
    return {
      date,
      endsAt: timing.endsAt,
      reason: error.message || 'Дата недоступна для бронирования',
      startsAt: timing.startsAt,
      status: 'conflict',
    };
  }
}

async function buildSeriesPreview(data, transaction) {
  const config = buildSeriesConfig(data);
  await lockCourtsForBooking([config.courtId], transaction);
  const dates = getSeriesDates(config);
  const occurrences = [];
  for (const date of dates) {
    occurrences.push(await inspectSeriesOccurrence(config, date, transaction));
  }
  const available = occurrences.filter((item) => item.status === 'ok');
  const conflicts = occurrences.filter((item) => item.status === 'conflict');
  return {
    availableCount: available.length,
    conflictCount: conflicts.length,
    conflicts: conflicts.slice(0, 20),
    occurrenceCount: occurrences.length,
    occurrences,
    totalPrice: available.reduce((sum, item) => sum + Number(item.price || 0), 0),
  };
}

async function previewBookingSeries(data) {
  return db.sequelize.transaction(async (transaction) => buildSeriesPreview(data, transaction));
}

async function createBookingSeries(data, account) {
  return db.sequelize.transaction(async (transaction) => {
    const config = buildSeriesConfig(data);
    const courtsById = await lockCourtsForBooking([config.courtId], transaction);
    const court = courtsById.get(config.courtId);
    const preview = await buildSeriesPreview({ ...data, courtId: config.courtId }, transaction);
    if (preview.conflictCount > 0) {
      throw appError('Серия пересекается с существующими бронями или недоступными слотами', 409, {
        code: 'BOOKING_SERIES_CONFLICT',
        conflicts: preview.conflicts,
      });
    }

    const client = await resolveClient(data, transaction);
    const series = await db.BookingSeries.create(
      {
        clientName: client.name,
        clientPhone: client.phone,
        comment: config.comment,
        courtId: court.id,
        createdByAccountId: account?.id || null,
        durationMinutes: config.durationMinutes,
        endsOn: config.endsOn,
        lastGeneratedUntil: config.endsOn,
        name: config.name,
        paymentMethod: config.paymentMethod,
        paymentStatus: config.paymentStatus,
        price: config.price,
        source: config.source,
        startTime: config.startTime,
        startsOn: config.startsOn,
        status: 'active',
        updatedByAccountId: account?.id || null,
        userId: client.id,
        weekday: config.weekday,
      },
      { transaction },
    );

    const createdBookings = [];
    for (const occurrence of preview.occurrences) {
      const timing = {
        durationMinutes: config.durationMinutes,
        endsAt: occurrence.endsAt,
        startsAt: occurrence.startsAt,
      };
      const paymentPrice = Number(occurrence.price || 0);
      const booking = await db.Booking.create(
        {
          ...buildBookingPayload(
            {
              bookingSeriesId: series.id,
              comment: config.comment,
              courtId: court.id,
              durationMinutes: config.durationMinutes,
              paidAmount: config.paymentStatus === 'paid' ? paymentPrice : 0,
              paymentMethod: config.paymentMethod,
              paymentStatus: config.paymentStatus,
              price: paymentPrice,
              source: config.source,
              startsAt: occurrence.startsAt,
              status: config.status,
            },
            account,
            client,
            timing,
          ),
          createdByAccountId: account?.id || null,
        },
        { transaction },
      );
      const fullBooking = await getBookingOrFail(booking.id, transaction);
      await recordChange(fullBooking, 'created', account, { reason: `Серия: ${series.name}` }, transaction);
      createdBookings.push(mapBooking(fullBooking));
    }

    const fullSeries = await db.BookingSeries.findByPk(series.id, {
      include: [
        db.Court,
        db.User,
        { as: 'createdBy', model: db.Account, include: [db.Staff] },
        { as: 'updatedBy', model: db.Account, include: [db.Staff] },
      ],
      transaction,
    });
    return {
      bookings: createdBookings,
      preview,
      series: mapSeries(fullSeries),
    };
  });
}

async function listBookingSeries(query = {}) {
  const where = {};
  if (query.status !== 'all') {
    where.status = SERIES_STATUSES.has(query.status) ? query.status : 'active';
  }
  const rows = await db.BookingSeries.findAll({
    include: [
      db.Court,
      db.User,
      { as: 'createdBy', model: db.Account, include: [db.Staff] },
      { as: 'updatedBy', model: db.Account, include: [db.Staff] },
    ],
    order: [
      ['status', 'ASC'],
      ['weekday', 'ASC'],
      ['startTime', 'ASC'],
      ['id', 'DESC'],
    ],
    where,
  });

  return Promise.all(rows.map(async (row) => {
    const item = mapSeries(row);
    item.generatedBookingsCount = await db.Booking.count({
      where: { bookingSeriesId: row.id },
    });
    item.futureActiveBookingsCount = await db.Booking.count({
      where: {
        bookingSeriesId: row.id,
        startsAt: { [Op.gte]: new Date() },
        status: { [Op.ne]: 'canceled' },
      },
    });
    return item;
  }));
}

async function archiveBookingSeries(id, data = {}, account) {
  return db.sequelize.transaction(async (transaction) => {
    const series = await db.BookingSeries.findByPk(Number(id), {
      include: [db.Court, db.User],
      lock: transaction.LOCK.UPDATE,
      transaction,
    });
    if (!series) throw appError('Серия бронирований не найдена', 404);

    const reason = normalizeText(data.reason) || 'Серия архивирована';
    await series.update(
      {
        archivedAt: new Date(),
        archiveReason: reason,
        status: 'archived',
        updatedByAccountId: account?.id || null,
      },
      { transaction },
    );

    let canceledBookingsCount = 0;
    if (data.cancelFuture) {
      const rows = await db.Booking.findAll({
        include: [db.Court, db.User],
        lock: transaction.LOCK.UPDATE,
        transaction,
        where: {
          bookingSeriesId: series.id,
          startsAt: { [Op.gte]: new Date() },
          status: { [Op.ne]: 'canceled' },
        },
      });
      for (const booking of rows) {
        const fromStatus = booking.status;

        await booking.update(
          {
            canceledAt: new Date(),
            cancellationReason: reason,
            status: 'canceled',
            updatedByAccountId: account?.id || null,
          },
          { transaction },
        );
        const updated = await getBookingOrFail(booking.id, transaction);
        await recordChange(
          updated,
          'canceled',
          account,
          {
            fromStatus,
            reason,
            toStatus: 'canceled',
          },
          transaction,
        );
      }
      canceledBookingsCount = rows.length;
    }

    const fullSeries = await db.BookingSeries.findByPk(series.id, {
      include: [
        db.Court,
        db.User,
        { as: 'createdBy', model: db.Account, include: [db.Staff] },
        { as: 'updatedBy', model: db.Account, include: [db.Staff] },
      ],
      transaction,
    });

    return {
      canceledBookingsCount,
      series: mapSeries(fullSeries),
    };
  });
}

async function getSchedule(query = {}) {
  const range = getDayRange(query.date);
  const [courts, bookings, blocks, scheduleRules] = await Promise.all([
    listCourts(),
    listBookings({ date: range.date, status: query.status || 'all' }),
    bookingRulesService.listBlocks({ date: range.date, status: 'active' }),
    bookingRulesService.getEffectiveSchedule(range.date),
  ]);

  return {
    blocks,
    bookings,
    courts,
    date: range.date,
    stats: buildScheduleStats(bookings),
    workingHours: {
      cancellationDeadlineHours: scheduleRules.cancellationDeadlineHours,
      end: scheduleRules.workingHoursEnd,
      exception: scheduleRules.exception,
      isClosed: scheduleRules.isClosed,
      maxDurationMinutes: scheduleRules.maxDurationMinutes,
      minDurationMinutes: scheduleRules.minDurationMinutes,
      rescheduleDeadlineHours: scheduleRules.rescheduleDeadlineHours,
      start: scheduleRules.workingHoursStart,
      stepMinutes: scheduleRules.slotStepMinutes,
    },
  };
}

async function createBooking(data, account) {
  return db.sequelize.transaction(async (transaction) => {
    const courtsById = await lockCourtsForBooking([data.courtId], transaction);
    const court = courtsById.get(Number(data.courtId));
    const timing = buildTiming(data);
    await bookingRulesService.assertBookable({
      courtId: court.id,
      endsAt: timing.endsAt,
      startsAt: timing.startsAt,
      status: data.status || 'new',
      transaction,
    });
    await assertNoConflict({
      courtId: court.id,
      endsAt: timing.endsAt,
      startsAt: timing.startsAt,
      transaction,
    });
    const client = await resolveClient(data, transaction);
    const pricedData = await applyAutomaticPrice(data, court.id, timing);

    const booking = await db.Booking.create(
      {
        ...buildBookingPayload(pricedData, account, client, timing),
        createdByAccountId: account?.id || null,
      },
      { transaction },
    );

    const fullBooking = await getBookingOrFail(booking.id, transaction);
    await recordChange(fullBooking, 'created', account, {}, transaction);
    return mapBooking(fullBooking);
  });
}

async function updateBooking(id, data, account) {
  return db.sequelize.transaction(async (transaction) => {
    const booking = await getBookingOrFail(id, transaction);
    const client = data.userId || data.client ? await resolveClient(data, transaction) : booking.User;
    const courtId = Number(data.courtId || booking.courtId);
    await lockCourtsForBooking([booking.courtId, courtId], transaction);
    const timing = buildTiming(data, booking);
    const nextStatus = data.status || booking.status;

    await bookingRulesService.assertBookable({
      courtId,
      currentBooking: booking,
      endsAt: timing.endsAt,
      startsAt: timing.startsAt,
      status: nextStatus,
      transaction,
    });

    if (nextStatus !== 'canceled') {
      await assertNoConflict({
        courtId,
        endsAt: timing.endsAt,
        excludeBookingId: booking.id,
        startsAt: timing.startsAt,
        transaction,
      });
    }

    const before = mapBooking(booking);
    const pricedData = await applyAutomaticPrice(data, courtId, timing, booking);
    const payload = buildBookingPayload(
      { ...pricedData, courtId },
      account,
      client,
      timing,
      booking,
    );
    await booking.update(payload, { transaction });
    const updated = await getBookingOrFail(booking.id, transaction);
    const after = mapBooking(updated);
    const isRescheduled =
      before.courtId !== after.courtId ||
      new Date(before.startsAt).getTime() !== new Date(after.startsAt).getTime() ||
      new Date(before.endsAt).getTime() !== new Date(after.endsAt).getTime();
    const isStatusChanged = before.status !== after.status;
    const action =
      after.status === 'canceled' && before.status !== 'canceled'
        ? 'canceled'
        : isRescheduled
          ? 'rescheduled'
          : isStatusChanged
            ? 'status_changed'
            : 'updated';

    await recordChange(
      updated,
      action,
      account,
      {
        fromStatus: before.status,
        reason: normalizeText(data.changeReason || data.cancellationReason),
        toStatus: after.status,
      },
      transaction,
    );

    return after;
  });
}

async function changeBookingStatus(id, data, account) {
  if (data.status === 'canceled' && !normalizeText(data.reason)) {
    throw appError('Укажите причину отмены брони');
  }
  return updateBooking(
    id,
    {
      cancellationReason: data.reason,
      changeReason: data.reason,
      status: data.status,
    },
    account,
  );
}

async function getBooking(id) {
  return mapBooking(await getBookingOrFail(id));
}

async function listBookingHistory(id) {
  await getBookingOrFail(id);
  const rows = await db.BookingChangeLog.findAll({
    include: [{ as: 'actor', model: db.Account, include: [db.Staff] }],
    order: [['createdAt', 'DESC']],
    where: { bookingId: Number(id) },
  });
  return rows.map(mapChangeLog);
}

module.exports = {
  archiveBookingSeries,
  createBooking,
  createBookingSeries,
  changeBookingStatus,
  getBooking,
  getBookingAnalytics,
  getSchedule,
  listBookingSeries,
  listBookingHistory,
  listBookings,
  listCourts,
  previewBookingSeries,
  updateBooking,
};
