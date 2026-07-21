const crypto = require('node:crypto');
const { Op } = require('sequelize');
const db = require('../../models');
const bookingRulesService = require('./booking-rules.service');
const onboardingService = require('./onboarding.service');
const referencesService = require('./references.service');
const {
  resolveClientAccessContext,
} = require('./client-access-context.service');
const {
  bookingTenantWhere,
  resolveBookingAccessContext,
  resolveEligibleBookingStaff,
} = require('./booking-access-context.service');
const trainingPlansService = require('./training-plans.service');
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
const BOOKING_TYPES = new Set([
  'game',
  'tournament',
  'personal_training',
  'master_class',
  'group_training',
  'corporate',
]);
const TRAINING_BOOKING_TYPES = new Set(['personal_training', 'group_training']);
const BOOKING_RESOURCE_TYPES = new Set(['padel_double', 'padel_single', 'other']);
const MAX_GROUP_PARTICIPANTS = 12;
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

async function resolveBookingContext(authority, options = {}) {
  return resolveBookingAccessContext(authority, options);
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function getIdempotencyMetadata(idempotencyKey, operation, payload) {
  const key = String(idempotencyKey || '').trim();
  if (!key) return null;
  if (key.length > 200) {
    throw appError('Idempotency-Key не может быть длиннее 200 символов');
  }
  return {
    keyHash: sha256(key),
    payloadHash: sha256(stableStringify({ operation, payload })),
  };
}

function assertIdempotencyPayload(row, metadata, payloadHashField) {
  if (!row || !metadata) return;
  if (row[payloadHashField] !== metadata.payloadHash) {
    throw appError('Idempotency-Key уже использован с другим запросом', 409, {
      code: 'IDEMPOTENCY_KEY_REUSED',
    });
  }
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

function normalizeNullableId(value, label) {
  if (value === undefined || value === null || value === '' || value === 'none') {
    return null;
  }
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    throw appError(`${label} указан некорректно`);
  }
  return id;
}

function normalizePositiveId(value, label) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    throw appError(`${label} указан некорректно`);
  }
  return id;
}

function normalizeGroupParticipantIds(data = {}, primaryUserId = null, bookingType = 'game') {
  if (bookingType !== 'group_training') return [];

  const source = Array.isArray(data.groupParticipantIds)
    ? data.groupParticipantIds
    : Array.isArray(data.participantIds)
      ? data.participantIds
      : [];
  const ids = Array.from(
    new Set(
      [
        primaryUserId,
        ...source,
      ]
        .filter((value) => value !== undefined && value !== null && value !== '' && value !== 'none')
        .map((value) => normalizePositiveId(value, 'Участник группы')),
    ),
  );

  if (ids.length > MAX_GROUP_PARTICIPANTS) {
    throw appError(`В групповой тренировке можно выбрать до ${MAX_GROUP_PARTICIPANTS} участников`);
  }

  return ids;
}

function normalizeResourceType(value = 'other') {
  const type = String(value || 'other');
  if (!BOOKING_RESOURCE_TYPES.has(type)) {
    throw appError('Некорректный тип ресурса бронирования');
  }
  return type;
}

function normalizeSortOrder(value, fallback = 0) {
  if (value === undefined || value === null || value === '') return fallback;
  const sortOrder = Number(value);
  if (!Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 10000) {
    throw appError('Порядок колонки должен быть целым числом от 0 до 10000');
  }
  return sortOrder;
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

function mapStaff(staff) {
  if (!staff) return null;
  const raw = staff.toJSON ? staff.toJSON() : staff;
  return {
    id: raw.id,
    name: raw.name,
    phone: raw.phone || null,
    position: raw.position || raw.role || null,
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

function mapBookingParticipant(participant) {
  if (!participant) return null;
  const raw = participant.toJSON ? participant.toJSON() : participant;
  const client = raw.client || raw.User;
  return {
    client: mapClient(client),
    clientId: Number(raw.userId),
    id: raw.id,
  };
}

function mapBookingTrainingPlan(plan) {
  if (!plan) return null;
  const raw = plan.toJSON ? plan.toJSON() : plan;
  return {
    completedAt: raw.completedAt || null,
    id: raw.id,
    kind: raw.kind,
    plannedAt: raw.plannedAt,
    status: raw.status,
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
    bookingType: raw.bookingType || 'game',
    participants: (raw.participants || [])
      .map(mapBookingParticipant)
      .filter(Boolean)
      .sort((left, right) => String(left.client?.name || '').localeCompare(String(right.client?.name || ''))),
    responsibleStaffId: raw.responsibleStaffId || null,
    responsibleStaff: mapStaff(raw.responsibleStaff),
    trainingPlan: mapBookingTrainingPlan(raw.trainingPlan),
    isFirstBooking: Boolean(raw.isFirstBooking),
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
    bookingType: raw.bookingType || 'game',
    responsibleStaffId: raw.responsibleStaffId || null,
    responsibleStaff: mapStaff(raw.responsibleStaff),
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

function getBookingIncludes() {
  return [
    db.Court,
    db.User,
    { as: 'series', model: db.BookingSeries },
    { as: 'responsibleStaff', model: db.Staff },
    {
      as: 'participants',
      model: db.BookingParticipant,
      include: [{ as: 'client', model: db.User }],
    },
    { as: 'trainingPlan', model: db.TrainingPlan },
    { as: 'createdBy', model: db.Account, include: [db.Staff] },
    { as: 'updatedBy', model: db.Account, include: [db.Staff] },
  ];
}

function getSeriesIncludes() {
  return [
    db.Court,
    db.User,
    { as: 'responsibleStaff', model: db.Staff },
    { as: 'createdBy', model: db.Account, include: [db.Staff] },
    { as: 'updatedBy', model: db.Account, include: [db.Staff] },
  ];
}

async function markFirstBookingFlags(bookings, transaction, authority = null) {
  const context = await resolveBookingContext(authority, { transaction });
  const rows = Array.isArray(bookings) ? bookings : [bookings].filter(Boolean);
  const userIds = Array.from(
    new Set(rows.map((booking) => Number(booking.userId)).filter(Boolean)),
  );
  if (userIds.length === 0) return bookings;

  const firstBookings = await db.Booking.findAll({
    attributes: ['id', 'userId'],
    order: [
      ['userId', 'ASC'],
      ['startsAt', 'ASC'],
      ['id', 'ASC'],
    ],
    transaction,
    where: bookingTenantWhere(context, {
      status: { [Op.ne]: 'canceled' },
      userId: { [Op.in]: userIds },
    }, { force: true }),
  });
  const firstBookingIdByUserId = new Map();
  firstBookings.forEach((booking) => {
    const userId = Number(booking.userId);
    if (!firstBookingIdByUserId.has(userId)) {
      firstBookingIdByUserId.set(userId, Number(booking.id));
    }
  });
  const visits = await db.Visit.findAll({
    attributes: ['userId', 'scannedAt'],
    order: [
      ['userId', 'ASC'],
      ['scannedAt', 'ASC'],
      ['id', 'ASC'],
    ],
    transaction,
    where: bookingTenantWhere(context, {
      userId: { [Op.in]: userIds },
    }, { force: true }),
  });
  const firstVisitAtByUserId = new Map();
  visits.forEach((visit) => {
    const userId = Number(visit.userId);
    if (!firstVisitAtByUserId.has(userId)) {
      firstVisitAtByUserId.set(userId, new Date(visit.scannedAt).getTime());
    }
  });

  rows.forEach((booking) => {
    const bookingStartTime = new Date(booking.startsAt).getTime();
    const firstVisitAt = firstVisitAtByUserId.get(Number(booking.userId));
    const hasEarlierVisit = Number.isFinite(firstVisitAt) && firstVisitAt < bookingStartTime;
    const isFirstBooking =
      booking.status !== 'canceled' &&
      !hasEarlierVisit &&
      firstBookingIdByUserId.get(Number(booking.userId)) === Number(booking.id);
    if (typeof booking.setDataValue === 'function') {
      booking.setDataValue('isFirstBooking', isFirstBooking);
    } else {
      booking.isFirstBooking = isFirstBooking;
    }
  });

  return bookings;
}

async function lockCourtsForBooking(courtIds, transaction, authority = null) {
  const context = await resolveBookingContext(authority, { lock: true, transaction });
  const ids = Array.from(
    new Set(courtIds.map((courtId) => Number(courtId)).filter(Boolean)),
  ).sort((a, b) => a - b);

  const courts = await db.Court.findAll({
    lock: transaction.LOCK.UPDATE,
    order: [['id', 'ASC']],
    transaction,
    where: bookingTenantWhere(context, { id: { [Op.in]: ids } }, { force: true }),
  });
  const courtsById = new Map(courts.map((court) => [Number(court.id), court]));

  ids.forEach((id) => {
    const court = courtsById.get(id);
    if (!court || !court.isActive) throw appError('Ресурс бронирования не найден или выключен', 404);
  });

  return courtsById;
}

async function getBookingOrFail(id, transaction, authority = null) {
  const context = await resolveBookingContext(authority, { lock: Boolean(transaction), transaction });
  const booking = await db.Booking.findOne({
    include: getBookingIncludes(),
    lock: transaction ? transaction.LOCK.UPDATE : undefined,
    transaction,
    where: bookingTenantWhere(context, { id: Number(id) }, { force: true }),
  });
  if (!booking) throw appError('Бронь не найдена', 404);
  await markFirstBookingFlags(booking, transaction, context);
  return booking;
}

async function resolveClient(
  data,
  transaction,
  trainingMarker = {},
  tenant = null,
  bookingContext = null,
) {
  const context = await resolveClientAccessContext(tenant, {
    lock: true,
    transaction,
  });
  const scopedWhere = (where) =>
    context.scoped
      ? { ...where, organizationId: context.organizationId }
      : where;
  if (
    bookingContext &&
    Number(context.organizationId) !== Number(bookingContext.organizationId)
  ) {
    throw appError('Клиент не найден', 404);
  }
  if (data.userId) {
    const client = await db.User.findOne({
      transaction,
      where: scopedWhere({ id: Number(data.userId) }),
    });
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
    where: scopedWhere({ phoneNormalized, isTraining: false }),
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

  const sourceRef = await referencesService.getClientSourceByInput(
    {
      source: payload.source || 'Ресепшн (Админ)',
      sourceId: payload.sourceId,
    },
    tenant,
  );
  const webId = `web_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

  return db.User.create(
    {
      name,
      organizationId: context.organizationId,
      note: normalizeText(payload.note),
      phone,
      phoneNormalized,
      source: sourceRef.name,
      sourceId: sourceRef.id,
      status: 'active',
      webId,
      ...trainingMarker,
    },
    { transaction },
  );
}

async function loadGroupParticipantsOrFail(
  participantIds,
  transaction,
  tenant = null,
) {
  if (participantIds.length === 0) return [];
  const context = await resolveClientAccessContext(tenant, {
    lock: true,
    transaction,
  });

  const clients = await db.User.findAll({
    transaction,
    where: {
      id: { [Op.in]: participantIds },
      ...(context.scoped ? { organizationId: context.organizationId } : {}),
      mergedIntoUserId: null,
    },
  });
  const clientById = new Map(clients.map((client) => [Number(client.id), client]));
  const missingId = participantIds.find((idValue) => !clientById.has(Number(idValue)));
  if (missingId) throw appError(`Участник группы ${missingId} не найден`, 404);

  const archivedClient = participantIds
    .map((idValue) => clientById.get(Number(idValue)))
    .find((client) => client.status === 'archived');
  if (archivedClient) {
    throw appError(`Клиент ${archivedClient.name || archivedClient.id} в архиве`, 409);
  }

  return participantIds.map((idValue) => clientById.get(Number(idValue)));
}

async function syncBookingParticipants(booking, participantIds, transaction) {
  const ids = Array.from(new Set(participantIds.map(Number).filter(Boolean)));
  await db.BookingParticipant.destroy({
    transaction,
    where: { bookingId: booking.id },
  });

  if (ids.length === 0) return;

  await db.BookingParticipant.bulkCreate(
    ids.map((userId) => ({
      bookingId: booking.id,
      userId,
    })),
    { transaction },
  );
}

async function resolveResponsibleStaffId(
  data,
  currentBooking = null,
  transaction,
  authority = null,
) {
  const rawValue =
    data.responsibleStaffId !== undefined
      ? data.responsibleStaffId
      : currentBooking?.responsibleStaffId || null;
  const responsibleStaffId = normalizeNullableId(rawValue, 'Ответственный сотрудник');
  if (!responsibleStaffId) return null;

  const context = await resolveBookingContext(authority, { lock: true, transaction });
  if (context.readScoped) {
    const staff = await resolveEligibleBookingStaff(responsibleStaffId, context, {
      lock: true,
      transaction,
    });
    return staff.id;
  }

  const staff = await db.Staff.findByPk(responsibleStaffId, { transaction });
  if (!staff || staff.status !== 'active') {
    throw appError('Ответственный сотрудник не найден или в архиве', 404);
  }
  return staff.id;
}

async function assertNoConflict({
  courtId,
  endsAt,
  excludeBookingId = null,
  startsAt,
  transaction,
  tenant,
}) {
  const context = await resolveBookingContext(tenant, { transaction });
  const where = {
    courtId: Number(courtId),
    endsAt: { [Op.gt]: startsAt },
    isTraining: false,
    startsAt: { [Op.lt]: endsAt },
    status: { [Op.ne]: 'canceled' },
  };

  if (excludeBookingId) {
    where.id = { [Op.ne]: Number(excludeBookingId) };
  }

  const conflict = await db.Booking.findOne({
    include: [db.Court],
    transaction,
    where: bookingTenantWhere(context, where, { force: true }),
  });

  if (conflict) {
    throw appError('На это время ресурс уже забронирован', 409, {
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
  const bookingType = normalizeEnum(
    data.bookingType,
    BOOKING_TYPES,
    currentBooking?.bookingType || 'game',
    'тип брони',
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
    bookingType,
    paidAmount,
    paymentMethod,
    paymentStatus,
    price,
    responsibleStaffId:
      data.responsibleStaffId !== undefined
        ? data.responsibleStaffId
        : currentBooking?.responsibleStaffId || null,
    source,
    startsAt: timing.startsAt,
    status,
    updatedByAccountId: account?.id || null,
    userId: client.id,
  };
}

async function listCourts(authority = null) {
  return listBookingResources({ status: 'active' }, authority);
}

async function listBookingResources(query = {}, authority = null) {
  const context = await resolveBookingContext(authority);
  const where = {};
  if (query.status !== 'all') {
    where.isActive = query.status === 'archived' ? false : true;
  }
  const courts = await db.Court.findAll({
    order: [
      ['sortOrder', 'ASC'],
      ['name', 'ASC'],
    ],
    where: bookingTenantWhere(context, where, { force: true }),
  });
  return courts.map(mapCourt);
}

async function getNextResourceSortOrder(transaction, context) {
  const maxSortOrder = await db.Court.max('sortOrder', {
    transaction,
    where: bookingTenantWhere(context, {}, { force: true }),
  });
  return Number.isFinite(Number(maxSortOrder)) ? Number(maxSortOrder) + 10 : 10;
}

async function normalizeBookingResourcePayload(
  data = {},
  current = null,
  transaction = undefined,
  context,
) {
  const nextSortOrder = current
    ? Number(current.sortOrder || 0)
    : await getNextResourceSortOrder(transaction, context);
  const payload = {
    isActive:
      data.isActive === undefined
        ? current?.isActive ?? true
        : Boolean(data.isActive),
    name: normalizeClientName(data.name ?? current?.name),
    sortOrder: normalizeSortOrder(data.sortOrder, nextSortOrder),
    type: normalizeResourceType(data.type ?? current?.type ?? 'other'),
  };

  const existing = await db.Court.findOne({
    transaction,
    where: bookingTenantWhere(context, {
      name: payload.name,
      ...(current ? { id: { [Op.ne]: current.id } } : {}),
    }, { force: true }),
  });
  if (existing) {
    throw appError('Колонка бронирования с таким названием уже существует', 409);
  }

  return payload;
}

async function createBookingResource(data = {}, authority = null) {
  return db.sequelize.transaction(async (transaction) => {
    const context = await resolveBookingContext(authority, { lock: true, transaction });
    const payload = await normalizeBookingResourcePayload(data, null, transaction, context);
    const resource = await db.Court.create({
      ...payload,
      clubId: context.clubId,
      organizationId: context.organizationId,
    }, { transaction });
    return mapCourt(resource);
  });
}

async function updateBookingResource(id, data = {}, authority = null) {
  return db.sequelize.transaction(async (transaction) => {
    const context = await resolveBookingContext(authority, { lock: true, transaction });
    const resource = await db.Court.findOne({
      lock: transaction.LOCK.UPDATE,
      transaction,
      where: bookingTenantWhere(context, { id: Number(id) }, { force: true }),
    });
    if (!resource) throw appError('Колонка бронирования не найдена', 404);
    const payload = await normalizeBookingResourcePayload(data, resource, transaction, context);
    if (resource.isActive && payload.isActive === false) {
      await assertResourceCanBeArchived(resource.id, transaction, context);
    }
    await resource.update(payload, { transaction });
    return mapCourt(resource);
  });
}

async function assertResourceCanBeArchived(resourceId, transaction, context) {
  const now = new Date();
  const [futureBookings, activeSeries, activeBlocks] = await Promise.all([
    db.Booking.count({
      transaction,
      where: bookingTenantWhere(context, {
        courtId: resourceId,
        endsAt: { [Op.gte]: now },
        status: { [Op.ne]: 'canceled' },
      }, { force: true }),
    }),
    db.BookingSeries.count({
      transaction,
      where: bookingTenantWhere(context, {
        courtId: resourceId,
        status: 'active',
      }, { force: true }),
    }),
    db.CourtBlock.count({
      transaction,
      where: {
        courtId: resourceId,
        endsAt: { [Op.gte]: now },
        status: 'active',
      },
    }),
  ]);

  if (futureBookings || activeSeries || activeBlocks) {
    throw appError(
      'Нельзя выключить колонку: на ней есть будущие брони, постоянные брони или активные блокировки',
      409,
      {
        activeBlocks,
        activeSeries,
        code: 'BOOKING_RESOURCE_IN_USE',
        futureBookings,
      },
    );
  }
}

async function archiveBookingResource(id, authority = null) {
  return db.sequelize.transaction(async (transaction) => {
    const context = await resolveBookingContext(authority, { lock: true, transaction });
    const resource = await db.Court.findOne({
      lock: transaction.LOCK.UPDATE,
      transaction,
      where: bookingTenantWhere(context, { id: Number(id) }, { force: true }),
    });
    if (!resource) throw appError('Колонка бронирования не найдена', 404);
    await assertResourceCanBeArchived(resource.id, transaction, context);
    await resource.update({ isActive: false }, { transaction });
    return mapCourt(resource);
  });
}

async function listResponsibleStaff(authority = null) {
  const context = await resolveBookingContext(authority);
  const staff = await db.Staff.findAll({
    order: [
      ['name', 'ASC'],
      ['id', 'ASC'],
    ],
    where: context.readScoped
      ? { organizationId: context.organizationId, status: 'active' }
      : { status: 'active' },
  });
  if (!context.readScoped) return staff.map(mapStaff);
  const eligible = [];
  for (const row of staff) {
    if (await resolveEligibleBookingStaff(row.id, context, { allowInvalid: true })) {
      eligible.push(mapStaff(row));
    }
  }
  return eligible;
}

async function listBookings(query = {}, authority = null) {
  const context = await resolveBookingContext(authority);
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
    include: getBookingIncludes(),
    order: [
      ['startsAt', 'ASC'],
      [db.Court, 'sortOrder', 'ASC'],
    ],
    where: bookingTenantWhere(context, where, { force: true }),
  });
  await markFirstBookingFlags(bookings, undefined, context);

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

async function buildCapacityByDateAndCourt(dates, courts, context) {
  const capacityByDate = new Map();
  const capacityByCourt = new Map(courts.map((court) => [Number(court.id), 0]));

  await Promise.all(
    dates.map(async (date) => {
      const schedule = await bookingRulesService.getEffectiveSchedule(date, context);
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

async function getBookingAnalytics(query = {}, authority = null) {
  const context = await resolveBookingContext(authority);
  const range = getDateRange(query);
  const dates = getDateList(range.from, range.to);
  const courts = await listCourts(context);
  const bookings = (
    await db.Booking.findAll({
      include: getBookingIncludes(),
      order: [
        ['startsAt', 'ASC'],
        [db.Court, 'sortOrder', 'ASC'],
      ],
      where: bookingTenantWhere(context, {
        isTraining: false,
        startsAt: {
          [Op.gte]: range.fromDate,
          [Op.lte]: range.toDate,
        },
      }, { force: true }),
    })
  ).map(mapBooking);
  const { capacityByCourt, capacityByDate } = await buildCapacityByDateAndCourt(
    dates,
    courts,
    context,
  );
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

function withoutAdminManualPrice(data, account) {
  if (account?.role !== 'admin' || data?.price === undefined) return data;
  const sanitized = { ...data };
  delete sanitized.price;
  return sanitized;
}

async function applyAutomaticPrice(
  data,
  courtId,
  timing,
  currentBooking = null,
  authority = null,
  account = null,
  transaction = null,
) {
  const priceSafeData = withoutAdminManualPrice(data, account);
  if (!shouldAutoPrice(priceSafeData, currentBooking)) return priceSafeData;
  const quote = await bookingRulesService.calculateQuote({
    courtId,
    durationMinutes: timing.durationMinutes,
    startsAt: timing.startsAt,
  }, authority, { transaction });
  return { ...priceSafeData, price: quote.price };
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
  const bookingType = normalizeEnum(data.bookingType, BOOKING_TYPES, 'game', 'тип брони');
  const status = normalizeEnum(
    data.status,
    new Set(['new', 'confirmed']),
    'confirmed',
    'статус брони',
  );

  return {
    bookingType,
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

async function inspectSeriesOccurrence(config, date, transaction, context) {
  const timing = buildOccurrenceTiming(config, date);
  try {
    await bookingRulesService.assertBookable({
      courtId: config.courtId,
      endsAt: timing.endsAt,
      startsAt: timing.startsAt,
      status: config.status,
      transaction,
    }, context);
    const conflict = await db.Booking.findOne({
      include: [db.Court],
      transaction,
      where: bookingTenantWhere(context, {
        courtId: config.courtId,
        endsAt: { [Op.gt]: timing.startsAt },
        startsAt: { [Op.lt]: timing.endsAt },
        status: { [Op.ne]: 'canceled' },
      }, { force: true }),
    });
    if (conflict) {
      return {
        conflictBooking: mapBooking(conflict),
        date,
        endsAt: timing.endsAt,
        reason: 'На это время ресурс уже забронирован',
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
          }, context, { transaction })).price
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

async function buildSeriesPreview(data, transaction, authority = null) {
  const context = await resolveBookingContext(authority, { lock: true, transaction });
  const config = buildSeriesConfig(data);
  await lockCourtsForBooking([config.courtId], transaction, context);
  await resolveResponsibleStaffId(data, null, transaction, context);
  const dates = getSeriesDates(config);
  const occurrences = [];
  for (const date of dates) {
    occurrences.push(await inspectSeriesOccurrence(config, date, transaction, context));
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

async function previewBookingSeries(data, authority = null) {
  return db.sequelize.transaction(async (transaction) =>
    buildSeriesPreview(data, transaction, authority));
}

async function loadCreatedSeriesResult(series, context, transaction) {
  const rows = await db.Booking.findAll({
    include: getBookingIncludes(),
    order: [['startsAt', 'ASC']],
    transaction,
    where: bookingTenantWhere(context, { bookingSeriesId: series.id }, { force: true }),
  });
  await markFirstBookingFlags(rows, transaction, context);
  const bookings = rows.map(mapBooking);
  const occurrences = bookings.map((booking) => ({
    date: getDateOnly(booking.startsAt),
    endsAt: booking.endsAt,
    price: booking.price,
    startsAt: booking.startsAt,
    status: 'ok',
  }));
  return {
    bookings,
    preview: {
      availableCount: occurrences.length,
      conflictCount: 0,
      conflicts: [],
      occurrenceCount: occurrences.length,
      occurrences,
      totalPrice: bookings.reduce((sum, booking) => sum + Number(booking.price || 0), 0),
    },
    series: mapSeries(series),
  };
}

async function createBookingSeries(data, account, tenant = null, options = {}) {
  const trainingMarker = await onboardingService.getTrainingDataMarker(account, tenant);
  const idempotency = getIdempotencyMetadata(
    options.idempotencyKey,
    'booking-series.create',
    data,
  );

  return db.sequelize.transaction(async (transaction) => {
    const context = await resolveBookingContext(tenant, { lock: true, transaction });
    if (idempotency) {
      const existing = await db.BookingSeries.findOne({
        include: getSeriesIncludes(),
        lock: transaction.LOCK.UPDATE,
        transaction,
        where: bookingTenantWhere(context, {
          creationKeyHash: idempotency.keyHash,
        }, { force: true }),
      });
      if (existing) {
        assertIdempotencyPayload(existing, idempotency, 'creationPayloadHash');
        return loadCreatedSeriesResult(existing, context, transaction);
      }
    }
    const priceSafeData = withoutAdminManualPrice(data, account);
    const config = buildSeriesConfig(priceSafeData);
    const responsibleStaffId = await resolveResponsibleStaffId(data, null, transaction, context);
    const courtsById = await lockCourtsForBooking([config.courtId], transaction, context);
    const court = courtsById.get(config.courtId);
    const preview = await buildSeriesPreview(
      { ...priceSafeData, courtId: config.courtId },
      transaction,
      context,
    );
    if (preview.conflictCount > 0) {
      throw appError('Серия пересекается с существующими бронями или недоступными слотами', 409, {
        code: 'BOOKING_SERIES_CONFLICT',
        conflicts: preview.conflicts,
      });
    }

    const client = await resolveClient(data, transaction, trainingMarker, tenant, context);
    const participantIds = normalizeGroupParticipantIds(
      data,
      client.id,
      config.bookingType,
    );
    await loadGroupParticipantsOrFail(participantIds, transaction, tenant);
    const series = await db.BookingSeries.create(
      {
        clientName: client.name,
        clientPhone: client.phone,
        bookingType: config.bookingType,
        clubId: context.clubId,
        comment: config.comment,
        courtId: court.id,
        createdByAccountId: account?.id || null,
        creationKeyHash: idempotency?.keyHash || null,
        creationPayloadHash: idempotency?.payloadHash || null,
        durationMinutes: config.durationMinutes,
        endsOn: config.endsOn,
        lastGeneratedUntil: config.endsOn,
        name: config.name,
        organizationId: context.organizationId,
        paymentMethod: config.paymentMethod,
        paymentStatus: config.paymentStatus,
        price: config.price,
        responsibleStaffId,
        source: config.source,
        startTime: config.startTime,
        startsOn: config.startsOn,
        status: 'active',
        updatedByAccountId: account?.id || null,
        userId: client.id,
        weekday: config.weekday,
        ...trainingMarker,
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
              bookingType: config.bookingType,
              comment: config.comment,
              courtId: court.id,
              durationMinutes: config.durationMinutes,
              paidAmount: config.paymentStatus === 'paid' ? paymentPrice : 0,
              paymentMethod: config.paymentMethod,
              paymentStatus: config.paymentStatus,
              price: paymentPrice,
              responsibleStaffId,
              source: config.source,
              startsAt: occurrence.startsAt,
              status: config.status,
            },
            account,
            client,
            timing,
          ),
          clubId: context.clubId,
          createdByAccountId: account?.id || null,
          organizationId: context.organizationId,
          ...trainingMarker,
        },
        { transaction },
      );
      await syncBookingParticipants(booking, participantIds, transaction);
      const fullBooking = await getBookingOrFail(booking.id, transaction, context);
      await recordChange(fullBooking, 'created', account, { reason: `Серия: ${series.name}` }, transaction);
      createdBookings.push(mapBooking(fullBooking));
    }

    const fullSeries = await db.BookingSeries.findOne({
      include: getSeriesIncludes(),
      transaction,
      where: bookingTenantWhere(context, { id: series.id }, { force: true }),
    });
    return {
      bookings: createdBookings,
      preview,
      series: mapSeries(fullSeries),
    };
  });
}

async function listBookingSeries(query = {}, authority = null) {
  const context = await resolveBookingContext(authority);
  const where = {};
  if (query.status !== 'all') {
    where.status = SERIES_STATUSES.has(query.status) ? query.status : 'active';
  }
  const rows = await db.BookingSeries.findAll({
    include: getSeriesIncludes(),
    order: [
      ['status', 'ASC'],
      ['weekday', 'ASC'],
      ['startTime', 'ASC'],
      ['id', 'DESC'],
    ],
    where: bookingTenantWhere(context, where, { force: true }),
  });

  return Promise.all(rows.map(async (row) => {
    const item = mapSeries(row);
    item.generatedBookingsCount = await db.Booking.count({
      where: bookingTenantWhere(context, { bookingSeriesId: row.id }, { force: true }),
    });
    item.futureActiveBookingsCount = await db.Booking.count({
      where: bookingTenantWhere(context, {
        bookingSeriesId: row.id,
        startsAt: { [Op.gte]: new Date() },
        status: { [Op.ne]: 'canceled' },
      }, { force: true }),
    });
    return item;
  }));
}

async function archiveBookingSeries(id, data = {}, account, authority = null, options = {}) {
  const idempotency = getIdempotencyMetadata(
    options.idempotencyKey,
    `booking-series.archive:${Number(id)}`,
    data,
  );
  return db.sequelize.transaction(async (transaction) => {
    const context = await resolveBookingContext(authority, { lock: true, transaction });
    const series = await db.BookingSeries.findOne({
      include: [db.Court, db.User],
      lock: transaction.LOCK.UPDATE,
      transaction,
      where: bookingTenantWhere(context, { id: Number(id) }, { force: true }),
    });
    if (!series) throw appError('Серия бронирований не найдена', 404);
    if (idempotency && series.lastMutationKeyHash === idempotency.keyHash) {
      assertIdempotencyPayload(series, idempotency, 'lastMutationPayloadHash');
      const loaded = await db.BookingSeries.findOne({
        include: getSeriesIncludes(),
        transaction,
        where: bookingTenantWhere(context, { id: series.id }, { force: true }),
      });
      return { canceledBookingsCount: 0, series: mapSeries(loaded) };
    }

    const reason = normalizeText(data.reason) || 'Серия архивирована';
    await series.update(
      {
        archivedAt: new Date(),
        archiveReason: reason,
        lastMutationKeyHash: idempotency?.keyHash || null,
        lastMutationPayloadHash: idempotency?.payloadHash || null,
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
        where: bookingTenantWhere(context, {
          bookingSeriesId: series.id,
          startsAt: { [Op.gte]: new Date() },
          status: { [Op.ne]: 'canceled' },
        }, { force: true }),
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
        const updated = await getBookingOrFail(booking.id, transaction, context);
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

    const fullSeries = await db.BookingSeries.findOne({
      include: getSeriesIncludes(),
      transaction,
      where: bookingTenantWhere(context, { id: series.id }, { force: true }),
    });

    return {
      canceledBookingsCount,
      series: mapSeries(fullSeries),
    };
  });
}

async function getSchedule(query = {}, authority = null) {
  const context = await resolveBookingContext(authority);
  const range = getDayRange(query.date);
  const [courts, bookings, blocks, scheduleRules] = await Promise.all([
    listCourts(context),
    listBookings({ date: range.date, status: query.status || 'all' }, context),
    bookingRulesService.listBlocks({ date: range.date, status: 'active' }, context),
    bookingRulesService.getEffectiveSchedule(range.date, context),
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

async function createBooking(data, account, tenant = null, options = {}) {
  const trainingMarker = await onboardingService.getTrainingDataMarker(account, tenant);
  const idempotency = getIdempotencyMetadata(
    options.idempotencyKey,
    'booking.create',
    data,
  );

  const result = await db.sequelize.transaction(async (transaction) => {
    const context = await resolveBookingContext(tenant, { lock: true, transaction });
    if (idempotency) {
      const existing = await db.Booking.findOne({
        include: getBookingIncludes(),
        lock: transaction.LOCK.UPDATE,
        transaction,
        where: bookingTenantWhere(context, {
          creationKeyHash: idempotency.keyHash,
        }, { force: true }),
      });
      if (existing) {
        assertIdempotencyPayload(existing, idempotency, 'creationPayloadHash');
        await markFirstBookingFlags(existing, transaction, context);
        return { booking: mapBooking(existing), replayed: true };
      }
    }
    const courtsById = await lockCourtsForBooking([data.courtId], transaction, context);
    const court = courtsById.get(Number(data.courtId));
    const timing = buildTiming(data);
    await bookingRulesService.assertBookable({
      courtId: court.id,
      endsAt: timing.endsAt,
      startsAt: timing.startsAt,
      status: data.status || 'new',
      transaction,
    }, context);
    await assertNoConflict({
      courtId: court.id,
      endsAt: timing.endsAt,
      startsAt: timing.startsAt,
      transaction,
      tenant: context,
    });
    const client = await resolveClient(data, transaction, trainingMarker, tenant, context);
    const responsibleStaffId = await resolveResponsibleStaffId(
      data,
      null,
      transaction,
      context,
    );
    const pricedData = await applyAutomaticPrice(
      data,
      court.id,
      timing,
      null,
      context,
      account,
      transaction,
    );
    const bookingPayload = buildBookingPayload(
      { ...pricedData, responsibleStaffId },
      account,
      client,
      timing,
    );
    const participantIds = normalizeGroupParticipantIds(
      data,
      client.id,
      bookingPayload.bookingType,
    );
    await loadGroupParticipantsOrFail(participantIds, transaction, tenant);

    const booking = await db.Booking.create(
      {
        ...bookingPayload,
        clubId: context.clubId,
        createdByAccountId: account?.id || null,
        creationKeyHash: idempotency?.keyHash || null,
        creationPayloadHash: idempotency?.payloadHash || null,
        organizationId: context.organizationId,
        ...trainingMarker,
      },
      { transaction },
    );
    await syncBookingParticipants(booking, participantIds, transaction);

    const fullBooking = await getBookingOrFail(booking.id, transaction, context);
    await recordChange(fullBooking, 'created', account, {}, transaction);
    return { booking: mapBooking(fullBooking), replayed: false };
  });

  if (!result.replayed) {
    await onboardingService.recordEventSafe(account, 'booking.created', {
      entityId: result.booking.id,
      entityType: 'booking',
      tenant,
      payload: result.booking,
    });
    if (result.booking.paymentStatus === 'paid') {
      await onboardingService.recordEventSafe(account, 'booking.paid', {
        entityId: result.booking.id,
        entityType: 'booking',
        tenant,
        payload: result.booking,
      });
    }
  }

  return result.booking;
}

async function updateBooking(id, data, account, tenant = null, options = {}) {
  const idempotency = getIdempotencyMetadata(
    options.idempotencyKey,
    `booking.update:${Number(id)}`,
    data,
  );
  const result = await db.sequelize.transaction(async (transaction) => {
    const context = await resolveBookingContext(tenant, { lock: true, transaction });
    const booking = await getBookingOrFail(id, transaction, context);
    if (idempotency && booking.lastMutationKeyHash === idempotency.keyHash) {
      assertIdempotencyPayload(booking, idempotency, 'lastMutationPayloadHash');
      return { booking: mapBooking(booking), events: [], replayed: true };
    }
    const client = data.userId || data.client
      ? await resolveClient(data, transaction, {}, tenant, context)
      : booking.User;
    const courtId = Number(data.courtId || booking.courtId);
    await lockCourtsForBooking([booking.courtId, courtId], transaction, context);
    const timing = buildTiming(data, booking);
    const nextStatus = data.status || booking.status;

    await bookingRulesService.assertBookable({
      courtId,
      currentBooking: booking,
      endsAt: timing.endsAt,
      startsAt: timing.startsAt,
      status: nextStatus,
      transaction,
    }, context);

    if (nextStatus !== 'canceled') {
      await assertNoConflict({
        courtId,
        endsAt: timing.endsAt,
        excludeBookingId: booking.id,
        startsAt: timing.startsAt,
        transaction,
        tenant: context,
      });
    }

    const before = mapBooking(booking);
    const responsibleStaffId = await resolveResponsibleStaffId(
      data,
      booking,
      transaction,
      context,
    );
    const pricedData = await applyAutomaticPrice(
      data,
      courtId,
      timing,
      booking,
      context,
      account,
      transaction,
    );
    const payload = buildBookingPayload(
      { ...pricedData, courtId, responsibleStaffId },
      account,
      client,
      timing,
      booking,
    );
    const participantPayloadWasProvided =
      data.groupParticipantIds !== undefined ||
      data.participantIds !== undefined;
    const shouldSyncParticipants =
      participantPayloadWasProvided ||
      before.bookingType !== payload.bookingType ||
      before.userId !== payload.userId;
    const participantInput = participantPayloadWasProvided
      ? data
      : { groupParticipantIds: before.participants?.map((participant) => participant.clientId) || [] };
    const participantIds = shouldSyncParticipants
      ? normalizeGroupParticipantIds(participantInput, client.id, payload.bookingType)
      : null;
    if (participantIds) {
      await loadGroupParticipantsOrFail(participantIds, transaction, tenant);
    }
    await booking.update({
      ...payload,
      ...(idempotency
        ? {
            lastMutationKeyHash: idempotency.keyHash,
            lastMutationPayloadHash: idempotency.payloadHash,
          }
        : {}),
    }, { transaction });
    if (participantIds) {
      await syncBookingParticipants(booking, participantIds, transaction);
    }
    const updated = await getBookingOrFail(booking.id, transaction, context);
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

    const events = [];
    if (action === 'canceled') events.push('booking.cancelled');
    if (isRescheduled) events.push('booking.moved');
    if (before.paymentStatus !== 'paid' && after.paymentStatus === 'paid') {
      events.push('booking.paid');
    }

    return { booking: after, events, replayed: false };
  });

  for (const eventKey of result.events) {
    await onboardingService.recordEventSafe(account, eventKey, {
      entityId: result.booking.id,
      entityType: 'booking',
      tenant,
      payload: result.booking,
    });
  }

  return result.booking;
}

async function changeBookingStatus(id, data, account, tenant = null, options = {}) {
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
    tenant,
    options,
  );
}

async function getBooking(id, authority = null) {
  return mapBooking(await getBookingOrFail(id, undefined, authority));
}

async function getBookingTrainingPlan(id, account, authority = null) {
  const booking = await getBookingOrFail(id, undefined, authority);
  if (!TRAINING_BOOKING_TYPES.has(booking.bookingType)) return null;
  return trainingPlansService.getByBookingId(booking.id, account, {
    allowBookingViewer: true,
    tenant: authority,
  });
}

async function createBookingTrainingPlan(id, account, authority = null) {
  await getBookingOrFail(id, undefined, authority);
  return trainingPlansService.createFromBooking(id, account, authority);
}

async function listBookingHistory(id, authority = null) {
  await getBookingOrFail(id, undefined, authority);
  const rows = await db.BookingChangeLog.findAll({
    include: [{ as: 'actor', model: db.Account, include: [db.Staff] }],
    order: [['createdAt', 'DESC']],
    where: { bookingId: Number(id) },
  });
  return rows.map(mapChangeLog);
}

module.exports = {
  archiveBookingResource,
  archiveBookingSeries,
  createBooking,
  createBookingResource,
  createBookingSeries,
  changeBookingStatus,
  getBooking,
  getBookingAnalytics,
  getBookingTrainingPlan,
  getSchedule,
  listBookingSeries,
  listBookingHistory,
  listBookingResources,
  listBookings,
  listCourts,
  listResponsibleStaff,
  previewBookingSeries,
  createBookingTrainingPlan,
  updateBookingResource,
  updateBooking,
  __testing: {
    applyAutomaticPrice,
    normalizeGroupParticipantIds,
    withoutAdminManualPrice,
  },
};
