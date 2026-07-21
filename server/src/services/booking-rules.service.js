const { Op } = require('sequelize');
const db = require('../../models');
const {
  bookingTenantWhere,
  resolveBookingAccessContext,
} = require('./booking-access-context.service');

const DEFAULT_SETTINGS = {
  cancellationDeadlineHours: 0,
  maxDurationMinutes: 240,
  minDurationMinutes: 60,
  rescheduleDeadlineHours: 0,
  slotStepMinutes: 30,
  workingHoursEnd: '24:00',
  workingHoursStart: '08:00',
};
const COURT_TYPES = new Set(['all', 'padel_double', 'padel_single', 'other']);
const STATUSES = new Set(['active', 'archived']);
const TIME_RE = /^(([01]\d|2[0-3]):[0-5]\d|24:00)$/;

function appError(message, statusCode = 400, details = {}) {
  const error = new Error(message);
  error.statusCode = statusCode;
  Object.assign(error, details);
  return error;
}

async function resolveRulesContext(authority, options = {}) {
  return resolveBookingAccessContext(authority, options);
}

function normalizeText(value, label = 'Значение', minLength = 1) {
  const text = String(value || '').trim().replace(/\s+/g, ' ');
  if (text.length < minLength) throw appError(`${label} заполнено некорректно`);
  return text;
}

function normalizeOptionalText(value) {
  const text = String(value || '').trim().replace(/\s+/g, ' ');
  return text || null;
}

function normalizeTime(value, label) {
  const time = String(value || '').trim();
  if (!TIME_RE.test(time)) throw appError(`${label} должно быть в формате HH:mm`);
  return time;
}

function timeToMinutes(value) {
  const time = normalizeTime(value, 'Время');
  if (time === '24:00') return 24 * 60;
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

function minutesToTime(minutes) {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

function normalizeTimeRange(start, end) {
  const startTime = normalizeTime(start, 'Время начала');
  const endTime = normalizeTime(end, 'Время окончания');
  if (timeToMinutes(endTime) <= timeToMinutes(startTime)) {
    throw appError('Время окончания должно быть позже времени начала');
  }
  return { endTime, startTime };
}

function normalizeInteger(value, label, min = 0, max = 10000) {
  const numberValue = Number(value);
  if (!Number.isInteger(numberValue) || numberValue < min || numberValue > max) {
    throw appError(`${label} должно быть целым числом от ${min} до ${max}`);
  }
  return numberValue;
}

function normalizeMoney(value, label = 'Цена') {
  const numberValue = Number(String(value ?? '').replace(',', '.'));
  if (!Number.isFinite(numberValue) || numberValue < 0) {
    throw appError(`${label} должна быть неотрицательным числом`);
  }
  return Math.round(numberValue * 100) / 100;
}

function normalizeDate(value, label) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) throw appError(`${label} указано некорректно`);
  return date;
}

function normalizeDateOnly(value) {
  const date = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw appError('Дата должна быть в формате YYYY-MM-DD');
  }
  return date;
}

function getLocalDateOnly(value) {
  const date = new Date(value);
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

function getLocalMinutes(value, baseDate) {
  const date = new Date(value);
  let minutes = date.getHours() * 60 + date.getMinutes();
  if (getLocalDateOnly(date) !== baseDate) minutes += 24 * 60;
  return minutes;
}

function getIsoWeekday(date) {
  const day = new Date(date).getDay();
  return day === 0 ? 7 : day;
}

function parseJsonArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function normalizeWeekdays(value) {
  const raw = Array.isArray(value) ? value : parseJsonArray(value);
  const weekdays = Array.from(
    new Set(raw.map(Number).filter((day) => Number.isInteger(day) && day >= 1 && day <= 7)),
  ).sort((a, b) => a - b);
  if (!weekdays.length) throw appError('Выберите хотя бы один день недели');
  return weekdays;
}

function mapSettings(row) {
  const raw = row?.toJSON ? row.toJSON() : row || DEFAULT_SETTINGS;
  return {
    cancellationDeadlineHours: Number(raw.cancellationDeadlineHours ?? DEFAULT_SETTINGS.cancellationDeadlineHours),
    id: raw.id || 1,
    maxDurationMinutes: Number(raw.maxDurationMinutes ?? DEFAULT_SETTINGS.maxDurationMinutes),
    minDurationMinutes: Number(raw.minDurationMinutes ?? DEFAULT_SETTINGS.minDurationMinutes),
    rescheduleDeadlineHours: Number(raw.rescheduleDeadlineHours ?? DEFAULT_SETTINGS.rescheduleDeadlineHours),
    slotStepMinutes: Number(raw.slotStepMinutes ?? DEFAULT_SETTINGS.slotStepMinutes),
    workingHoursEnd: raw.workingHoursEnd || DEFAULT_SETTINGS.workingHoursEnd,
    workingHoursStart: raw.workingHoursStart || DEFAULT_SETTINGS.workingHoursStart,
  };
}

function mapPriceRule(row) {
  const raw = row?.toJSON ? row.toJSON() : row;
  return {
    courtType: raw.courtType,
    endTime: raw.endTime,
    id: raw.id,
    name: raw.name,
    pricePerHour: Number(raw.pricePerHour || 0),
    priority: Number(raw.priority || 0),
    startTime: raw.startTime,
    status: raw.status,
    weekdays: normalizeWeekdays(raw.weekdays),
  };
}

function mapCourt(court) {
  const raw = court?.toJSON ? court.toJSON() : court;
  if (!raw) return null;
  return {
    id: raw.id,
    isActive: Boolean(raw.isActive),
    name: raw.name,
    sortOrder: Number(raw.sortOrder || 0),
    type: raw.type,
  };
}

function mapBlock(row) {
  const raw = row?.toJSON ? row.toJSON() : row;
  return {
    court: mapCourt(raw.Court),
    courtId: raw.courtId,
    endsAt: raw.endsAt,
    id: raw.id,
    reason: raw.reason,
    startsAt: raw.startsAt,
    status: raw.status,
  };
}

function mapException(row) {
  const raw = row?.toJSON ? row.toJSON() : row;
  return {
    date: raw.date,
    id: raw.id,
    isClosed: Boolean(raw.isClosed),
    reason: raw.reason,
    status: raw.status,
    workingHoursEnd: raw.workingHoursEnd,
    workingHoursStart: raw.workingHoursStart,
  };
}

async function getSettingsRow(context, transaction) {
  let row = await db.BookingSettings.findOne({
    lock: transaction ? transaction.LOCK.UPDATE : undefined,
    transaction,
    where: bookingTenantWhere(context, {}, { force: true }),
  });
  if (!row) {
    row = await db.BookingSettings.create({
      ...DEFAULT_SETTINGS,
      clubId: context.clubId,
      organizationId: context.organizationId,
    }, { transaction });
  }
  return row;
}

async function getSettings(tenant = null, transaction) {
  const context = await resolveRulesContext(tenant, { transaction });
  return mapSettings(await getSettingsRow(context, transaction));
}

async function updateSettings(data, tenant = null) {
  return db.sequelize.transaction(async (transaction) => {
    const context = await resolveRulesContext(tenant, { lock: true, transaction });
    const row = await getSettingsRow(context, transaction);
    const working = normalizeTimeRange(
      data.workingHoursStart ?? row.workingHoursStart,
      data.workingHoursEnd ?? row.workingHoursEnd,
    );
    const payload = {
      cancellationDeadlineHours: normalizeInteger(
        data.cancellationDeadlineHours ?? row.cancellationDeadlineHours,
        'Правило отмены',
        0,
        168,
      ),
      maxDurationMinutes: normalizeInteger(
        data.maxDurationMinutes ?? row.maxDurationMinutes,
        'Максимальная длительность',
        30,
        720,
      ),
      minDurationMinutes: normalizeInteger(
        data.minDurationMinutes ?? row.minDurationMinutes,
        'Минимальная длительность',
        30,
        720,
      ),
      rescheduleDeadlineHours: normalizeInteger(
        data.rescheduleDeadlineHours ?? row.rescheduleDeadlineHours,
        'Правило переноса',
        0,
        168,
      ),
      slotStepMinutes: normalizeInteger(data.slotStepMinutes ?? row.slotStepMinutes, 'Шаг сетки', 15, 120),
      workingHoursEnd: working.endTime,
      workingHoursStart: working.startTime,
    };
    if (payload.maxDurationMinutes < payload.minDurationMinutes) {
      throw appError('Максимальная длительность не может быть меньше минимальной');
    }
    if (payload.minDurationMinutes % payload.slotStepMinutes !== 0 || payload.maxDurationMinutes % payload.slotStepMinutes !== 0) {
      throw appError('Длительности должны делиться на шаг сетки');
    }
    await row.update(payload, { transaction });
    return mapSettings(row);
  });
}

async function getScheduleException(date, tenant = null, transaction) {
  const context = await resolveRulesContext(tenant, { transaction });
  const row = await db.BookingScheduleException.findOne({
    transaction,
    where: bookingTenantWhere(context, {
      date: normalizeDateOnly(date),
      status: 'active',
    }, { force: true }),
  });
  return row ? mapException(row) : null;
}

async function getEffectiveSchedule(date, tenant = null, transaction) {
  const context = await resolveRulesContext(tenant, { transaction });
  const settings = await getSettings(context, transaction);
  const exception = await getScheduleException(date, context, transaction);
  return {
    ...settings,
    exception,
    isClosed: Boolean(exception?.isClosed),
    workingHoursEnd: exception?.workingHoursEnd || settings.workingHoursEnd,
    workingHoursStart: exception?.workingHoursStart || settings.workingHoursStart,
  };
}

function assertDuration(durationMinutes, settings) {
  if (
    durationMinutes < settings.minDurationMinutes ||
    durationMinutes > settings.maxDurationMinutes ||
    durationMinutes % settings.slotStepMinutes !== 0
  ) {
    throw appError(
      `Длительность брони должна быть от ${settings.minDurationMinutes} до ${settings.maxDurationMinutes} минут с шагом ${settings.slotStepMinutes} минут`,
    );
  }
}

function assertWorkingHours(startsAt, endsAt, schedule) {
  if (schedule.isClosed) {
    throw appError(schedule.exception?.reason || 'В этот день клуб закрыт для бронирований', 409, {
      code: 'BOOKING_DAY_CLOSED',
    });
  }
  const date = getLocalDateOnly(startsAt);
  const startMinute = getLocalMinutes(startsAt, date);
  const endMinute = getLocalMinutes(endsAt, date);
  const workStart = timeToMinutes(schedule.workingHoursStart);
  const workEnd = timeToMinutes(schedule.workingHoursEnd);
  if (startMinute < workStart || endMinute > workEnd) {
    throw appError(
      `Бронь должна попадать в рабочие часы ${schedule.workingHoursStart}-${schedule.workingHoursEnd}`,
      409,
      { code: 'BOOKING_OUTSIDE_WORKING_HOURS' },
    );
  }
}

async function assertNoBlockConflict({ context, courtId, endsAt, startsAt, transaction }) {
  const block = await db.CourtBlock.findOne({
    include: [{
      model: db.Court,
      required: true,
      where: bookingTenantWhere(context, {}, { force: true }),
    }],
    transaction,
    where: {
      courtId: Number(courtId),
      endsAt: { [Op.gt]: startsAt },
      startsAt: { [Op.lt]: endsAt },
      status: 'active',
    },
  });
  if (block) {
    throw appError(`Ресурс заблокирован: ${block.reason}`, 409, {
      block: mapBlock(block),
      code: 'COURT_BLOCK_CONFLICT',
    });
  }
}

function assertDeadline(currentBooking, timing, status, schedule) {
  if (!currentBooking) return;
  const now = Date.now();
  const startsAtMs = new Date(currentBooking.startsAt).getTime();
  const hoursUntilStart = (startsAtMs - now) / 36e5;
  const isRescheduled =
    Number(currentBooking.courtId) !== Number(timing.courtId) ||
    new Date(currentBooking.startsAt).getTime() !== new Date(timing.startsAt).getTime() ||
    new Date(currentBooking.endsAt).getTime() !== new Date(timing.endsAt).getTime();
  if (
    isRescheduled &&
    schedule.rescheduleDeadlineHours > 0 &&
    hoursUntilStart < schedule.rescheduleDeadlineHours
  ) {
    throw appError(`Перенос доступен не позднее чем за ${schedule.rescheduleDeadlineHours} ч до начала`, 409, {
      code: 'BOOKING_RESCHEDULE_DEADLINE',
    });
  }
  if (
    status === 'canceled' &&
    currentBooking.status !== 'canceled' &&
    schedule.cancellationDeadlineHours > 0 &&
    hoursUntilStart < schedule.cancellationDeadlineHours
  ) {
    throw appError(`Отмена доступна не позднее чем за ${schedule.cancellationDeadlineHours} ч до начала`, 409, {
      code: 'BOOKING_CANCEL_DEADLINE',
    });
  }
}

async function assertBookable(
  { context: inputContext = null, courtId, currentBooking = null, endsAt, startsAt, status = 'new', tenant = null, transaction },
  authority = null,
) {
  const context = await resolveRulesContext(inputContext || tenant || authority, { transaction });
  const schedule = await getEffectiveSchedule(getLocalDateOnly(startsAt), context, transaction);
  const isNew = !currentBooking;
  const isRescheduled =
    Boolean(currentBooking) &&
    (
      Number(currentBooking.courtId) !== Number(courtId) ||
      new Date(currentBooking.startsAt).getTime() !== new Date(startsAt).getTime() ||
      new Date(currentBooking.endsAt).getTime() !== new Date(endsAt).getTime()
    );

  if (isNew || isRescheduled) {
    assertDuration(Math.round((new Date(endsAt).getTime() - new Date(startsAt).getTime()) / 60000), schedule);
    assertWorkingHours(startsAt, endsAt, schedule);
    if (status !== 'canceled') {
      await assertNoBlockConflict({ context, courtId, endsAt, startsAt, transaction });
    }
  }
  assertDeadline(currentBooking, { courtId, endsAt, startsAt }, status, schedule);
  return schedule;
}

async function listPriceRules(status = 'active', tenant = null, options = {}) {
  const context = await resolveRulesContext(tenant, {
    transaction: options.transaction,
  });
  const where = bookingTenantWhere(context, {}, { force: true });
  if (status !== 'all') where.status = STATUSES.has(status) ? status : 'active';
  const rows = await db.BookingPriceRule.findAll({
    order: [
      ['priority', 'DESC'],
      ['id', 'ASC'],
    ],
    transaction: options.transaction,
    where,
  });
  return rows.map(mapPriceRule);
}

function normalizePriceRulePayload(data, current = {}) {
  const { endTime, startTime } = normalizeTimeRange(
    data.startTime ?? current.startTime ?? '08:00',
    data.endTime ?? current.endTime ?? '24:00',
  );
  const courtType = String(data.courtType ?? current.courtType ?? 'all');
  if (!COURT_TYPES.has(courtType)) throw appError('Некорректный тип ресурса');
  return {
    courtType,
    endTime,
    name: normalizeText(data.name ?? current.name, 'Название тарифа', 2),
    pricePerHour: normalizeMoney(data.pricePerHour ?? current.pricePerHour, 'Цена за час'),
    priority: normalizeInteger(data.priority ?? current.priority ?? 100, 'Приоритет', 1, 10000),
    startTime,
    status: STATUSES.has(data.status) ? data.status : current.status || 'active',
    weekdays: normalizeWeekdays(data.weekdays ?? current.weekdays ?? [1, 2, 3, 4, 5, 6, 7]),
  };
}

async function createPriceRule(data, tenant = null) {
  return db.sequelize.transaction(async (transaction) => {
    const context = await resolveRulesContext(tenant, { lock: true, transaction });
    const row = await db.BookingPriceRule.create({
      ...normalizePriceRulePayload(data),
      clubId: context.clubId,
      organizationId: context.organizationId,
    }, { transaction });
    return mapPriceRule(row);
  });
}

async function updatePriceRule(id, data, tenant = null) {
  return db.sequelize.transaction(async (transaction) => {
    const context = await resolveRulesContext(tenant, { lock: true, transaction });
    const row = await db.BookingPriceRule.findOne({
      lock: transaction.LOCK.UPDATE,
      transaction,
      where: bookingTenantWhere(context, { id: Number(id) }, { force: true }),
    });
    if (!row) throw appError('Тариф не найден', 404);
    await row.update(normalizePriceRulePayload(data, row), { transaction });
    return mapPriceRule(row);
  });
}

async function archivePriceRule(id, tenant = null) {
  return updatePriceRule(id, { status: 'archived' }, tenant);
}

function ruleApplies(rule, courtType, weekday, minute) {
  const weekdays = normalizeWeekdays(rule.weekdays);
  return (
    (rule.courtType === 'all' || rule.courtType === courtType) &&
    weekdays.includes(weekday) &&
    minute >= timeToMinutes(rule.startTime) &&
    minute < timeToMinutes(rule.endTime)
  );
}

async function lockCourts(courtIds, context, transaction) {
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

async function calculateQuote(
  { courtId, durationMinutes, startsAt },
  tenant = null,
  options = {},
) {
  const context = await resolveRulesContext(tenant, {
    transaction: options.transaction,
  });
  const court = await db.Court.findOne({
    transaction: options.transaction,
    where: bookingTenantWhere(context, { id: Number(courtId) }, { force: true }),
  });
  if (!court || !court.isActive) throw appError('Ресурс бронирования не найден или выключен', 404);
  const start = normalizeDate(startsAt, 'Время начала');
  const duration = normalizeInteger(durationMinutes, 'Длительность', 1, 720);
  const end = new Date(start.getTime() + duration * 60000);
  const schedule = await getEffectiveSchedule(
    getLocalDateOnly(start),
    context,
    options.transaction,
  );
  assertDuration(duration, schedule);
  assertWorkingHours(start, end, schedule);

  const rules = await listPriceRules('active', context, options);
  let price = 0;
  const applied = new Map();
  for (let offset = 0; offset < duration; offset += schedule.slotStepMinutes) {
    const segmentStart = new Date(start.getTime() + offset * 60000);
    const segmentEndOffset = Math.min(offset + schedule.slotStepMinutes, duration);
    const segmentMinutes = segmentEndOffset - offset;
    const weekday = getIsoWeekday(segmentStart);
    const minute = segmentStart.getHours() * 60 + segmentStart.getMinutes();
    const rule = rules.find((item) => ruleApplies(item, court.type, weekday, minute));
    if (!rule) {
      throw appError(
        `Нет активного тарифа для ${court.name} на ${minutesToTime(minute)}`,
        409,
        { code: 'BOOKING_PRICE_RULE_MISSING' },
      );
    }
    price += Number(rule.pricePerHour || 0) * (segmentMinutes / 60);
    applied.set(rule.id, rule);
  }
  return {
    appliedRules: Array.from(applied.values()),
    court: mapCourt(court),
    durationMinutes: duration,
    price: Math.round(price * 100) / 100,
    startsAt: start,
  };
}

function getDayRange(dateValue) {
  const date = normalizeDateOnly(dateValue || getLocalDateOnly(new Date()));
  return {
    date,
    from: new Date(`${date}T00:00:00`),
    to: new Date(`${date}T23:59:59.999`),
  };
}

async function listBlocks(query = {}, tenant = null) {
  const context = await resolveRulesContext(tenant);
  const where = {};
  if (query.status !== 'all') where.status = STATUSES.has(query.status) ? query.status : 'active';
  if (query.date) {
    const range = getDayRange(query.date);
    where.startsAt = { [Op.lte]: range.to };
    where.endsAt = { [Op.gte]: range.from };
  }
  const rows = await db.CourtBlock.findAll({
    include: [{
      model: db.Court,
      required: true,
      where: bookingTenantWhere(context, {}, { force: true }),
    }],
    order: [['startsAt', 'ASC']],
    where,
  });
  return rows.map(mapBlock);
}

async function assertNoBookingConflictForBlock({ context, courtId, endsAt, excludeBlockId = null, startsAt, transaction }) {
  const booking = await db.Booking.findOne({
    transaction,
    where: bookingTenantWhere(context, {
      courtId: Number(courtId),
      endsAt: { [Op.gt]: startsAt },
      startsAt: { [Op.lt]: endsAt },
      status: { [Op.ne]: 'canceled' },
    }, { force: true }),
  });
  if (booking) throw appError('На это время уже есть бронь, блокировку создать нельзя', 409);

  const blockWhere = {
    courtId: Number(courtId),
    endsAt: { [Op.gt]: startsAt },
    startsAt: { [Op.lt]: endsAt },
    status: 'active',
  };
  if (excludeBlockId) blockWhere.id = { [Op.ne]: Number(excludeBlockId) };
  const block = await db.CourtBlock.findOne({ transaction, where: blockWhere });
  if (block) throw appError('На это время уже есть блокировка ресурса', 409);
}

async function buildBlockPayload(data, account, context, transaction) {
  const court = await db.Court.findOne({
    transaction,
    where: bookingTenantWhere(context, { id: Number(data.courtId) }, { force: true }),
  });
  if (!court || !court.isActive) throw appError('Ресурс бронирования не найден или выключен', 404);
  const startsAt = normalizeDate(data.startsAt, 'Время начала блокировки');
  const endsAt = normalizeDate(data.endsAt, 'Время окончания блокировки');
  if (endsAt <= startsAt) throw appError('Окончание блокировки должно быть позже начала');
  return {
    courtId: court.id,
    endsAt,
    reason: normalizeText(data.reason, 'Причина блокировки', 2),
    startsAt,
    status: STATUSES.has(data.status) ? data.status : 'active',
    updatedByAccountId: account?.id || null,
  };
}

async function createBlock(data, account, tenant = null) {
  return db.sequelize.transaction(async (transaction) => {
    const context = await resolveRulesContext(tenant, { lock: true, transaction });
    const payload = await buildBlockPayload(data, account, context, transaction);
    await lockCourts([payload.courtId], context, transaction);
    await assertNoBookingConflictForBlock({ ...payload, context, transaction });
    const row = await db.CourtBlock.create(
      { ...payload, createdByAccountId: account?.id || null },
      { transaction },
    );
    return mapBlock(await db.CourtBlock.findByPk(row.id, { include: [db.Court], transaction }));
  });
}

async function updateBlock(id, data, account, tenant = null) {
  return db.sequelize.transaction(async (transaction) => {
    const context = await resolveRulesContext(tenant, { lock: true, transaction });
    const row = await db.CourtBlock.findOne({
      include: [{ model: db.Court, required: true, where: bookingTenantWhere(context, {}, { force: true }) }],
      lock: transaction.LOCK.UPDATE,
      transaction,
      where: { id: Number(id) },
    });
    if (!row) throw appError('Блокировка не найдена', 404);
    const payload = await buildBlockPayload({ ...row.toJSON(), ...data }, account, context, transaction);
    await lockCourts([row.courtId, payload.courtId], context, transaction);
    await assertNoBookingConflictForBlock({ ...payload, context, excludeBlockId: row.id, transaction });
    await row.update(payload, { transaction });
    return mapBlock(await db.CourtBlock.findByPk(row.id, { include: [db.Court], transaction }));
  });
}

async function archiveBlock(id, account, tenant = null) {
  return db.sequelize.transaction(async (transaction) => {
    const context = await resolveRulesContext(tenant, { lock: true, transaction });
    const row = await db.CourtBlock.findOne({
      include: [{ model: db.Court, required: true, where: bookingTenantWhere(context, {}, { force: true }) }],
      lock: transaction.LOCK.UPDATE,
      transaction,
      where: { id: Number(id) },
    });
    if (!row) throw appError('Блокировка не найдена', 404);
    await row.update({ status: 'archived', updatedByAccountId: account?.id || null }, { transaction });
    return mapBlock(row);
  });
}

function normalizeExceptionPayload(data, current = {}) {
  const isClosed = Boolean(data.isClosed ?? current.isClosed);
  let workingHoursStart = data.workingHoursStart ?? current.workingHoursStart ?? null;
  let workingHoursEnd = data.workingHoursEnd ?? current.workingHoursEnd ?? null;
  if (!isClosed) {
    const range = normalizeTimeRange(
      workingHoursStart || DEFAULT_SETTINGS.workingHoursStart,
      workingHoursEnd || DEFAULT_SETTINGS.workingHoursEnd,
    );
    workingHoursStart = range.startTime;
    workingHoursEnd = range.endTime;
  }
  return {
    date: normalizeDateOnly(data.date ?? current.date),
    isClosed,
    reason: normalizeOptionalText(data.reason ?? current.reason),
    status: STATUSES.has(data.status) ? data.status : current.status || 'active',
    workingHoursEnd: isClosed ? null : workingHoursEnd,
    workingHoursStart: isClosed ? null : workingHoursStart,
  };
}

async function listExceptions(status = 'active', tenant = null) {
  const context = await resolveRulesContext(tenant);
  const where = bookingTenantWhere(context, {}, { force: true });
  if (status !== 'all') where.status = STATUSES.has(status) ? status : 'active';
  const rows = await db.BookingScheduleException.findAll({
    order: [['date', 'ASC']],
    where,
  });
  return rows.map(mapException);
}

async function upsertException(data, tenant = null) {
  return db.sequelize.transaction(async (transaction) => {
    const context = await resolveRulesContext(tenant, { lock: true, transaction });
    const payload = normalizeExceptionPayload(data);
    const [row, created] = await db.BookingScheduleException.findOrCreate({
      defaults: {
        ...payload,
        clubId: context.clubId,
        organizationId: context.organizationId,
      },
      transaction,
      where: bookingTenantWhere(context, { date: payload.date }, { force: true }),
    });
    if (!created) await row.update(payload, { transaction });
    return mapException(row);
  });
}

async function updateException(id, data, tenant = null) {
  return db.sequelize.transaction(async (transaction) => {
    const context = await resolveRulesContext(tenant, { lock: true, transaction });
    const row = await db.BookingScheduleException.findOne({
      lock: transaction.LOCK.UPDATE,
      transaction,
      where: bookingTenantWhere(context, { id: Number(id) }, { force: true }),
    });
    if (!row) throw appError('Исключение не найдено', 404);
    await row.update(normalizeExceptionPayload(data, row), { transaction });
    return mapException(row);
  });
}

async function archiveException(id, tenant = null) {
  return updateException(id, { status: 'archived' }, tenant);
}

module.exports = {
  archiveBlock,
  archiveException,
  archivePriceRule,
  assertBookable,
  calculateQuote,
  createBlock,
  createPriceRule,
  getEffectiveSchedule,
  getSettings,
  listBlocks,
  listExceptions,
  listPriceRules,
  timeToMinutes,
  updateBlock,
  updateException,
  updatePriceRule,
  updateSettings,
  upsertException,
};
