const db = require('../../models');
const clientsService = require('./clients.service');

const STATUS_VALUES = new Set(['active', 'archived']);
const RECURRENCE_INTERVALS = new Set(['none', 'daily', 'weekly']);
const RECURRENCE_SCOPE_TYPES = new Set(['snapshot', 'dynamic']);
const RECURRENCE_ASSIGNEE_ROLES = new Set(['owner', 'manager', 'admin']);
const FILTER_KEYS = [
  'q',
  'segment',
  'source',
  'sourceId',
  'status',
  'visitCategory',
  'visitCategoryId',
  'visitCountMin',
  'visitCountMax',
  'lastVisitDaysFrom',
  'lastVisitDaysTo',
  'lastVisitFrom',
  'lastVisitTo',
];

function appError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function normalizeStatus(status = 'active') {
  if (!STATUS_VALUES.has(status)) {
    throw appError('Некорректный статус базы');
  }

  return status;
}

function normalizeText(value) {
  const text = String(value || '').trim();
  return text || null;
}

function normalizeNumber(value, { allowZero = false } = {}) {
  if (value === null || value === undefined || value === '') return undefined;
  const number = Number(value);
  if (!Number.isFinite(number)) return undefined;
  if (allowZero ? number < 0 : number <= 0) return undefined;
  return number;
}

function normalizeSlaDays(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0 || number > 60) {
    throw appError('Срок прозвона базы должен быть целым числом от 0 до 60 дней');
  }

  return number;
}

function normalizeTime(value) {
  const time = String(value || '').trim();
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
    throw appError('Укажите время автозадачи в формате HH:mm');
  }

  return time;
}

function getWeekday(date) {
  const day = date.getDay();
  return day === 0 ? 7 : day;
}

function setTime(date, time) {
  const [hours, minutes] = time.split(':').map(Number);
  const next = new Date(date);
  next.setHours(hours, minutes, 0, 0);
  return next;
}

function computeNextRecurringRunAt(recurrence, from = new Date()) {
  if (!recurrence.enabled) return null;

  if (recurrence.interval === 'daily') {
    let next = setTime(from, recurrence.time);
    if (next <= from) {
      next = setTime(new Date(from.getTime() + 24 * 60 * 60 * 1000), recurrence.time);
    }
    return next;
  }

  if (recurrence.interval === 'weekly') {
    const targetWeekday = recurrence.weekday || 1;
    const currentWeekday = getWeekday(from);
    let dayOffset = targetWeekday - currentWeekday;
    if (dayOffset < 0) dayOffset += 7;
    let next = setTime(
      new Date(from.getTime() + dayOffset * 24 * 60 * 60 * 1000),
      recurrence.time,
    );
    if (next <= from) {
      next = setTime(new Date(next.getTime() + 7 * 24 * 60 * 60 * 1000), recurrence.time);
    }
    return next;
  }

  return null;
}

function normalizeRecurrence(data = {}, current = {}) {
  const enabled = Boolean(data.enabled);
  if (!enabled) {
    return {
      recurringAssignedToAccountId: null,
      recurringDescription: null,
      recurringDueDays: null,
      recurringEnabled: false,
      recurringInterval: 'none',
      recurringNextRunAt: null,
      recurringScopeType: 'snapshot',
      recurringTime: null,
      recurringTitle: null,
      recurringWeekday: null,
    };
  }

  const interval = RECURRENCE_INTERVALS.has(data.interval)
    ? data.interval
    : 'weekly';
  if (interval === 'none') {
    throw appError('Выберите период автопостановки задачи');
  }

  const scopeType = RECURRENCE_SCOPE_TYPES.has(data.scopeType)
    ? data.scopeType
    : 'snapshot';
  const weekday = normalizeNumber(data.weekday);
  if (interval === 'weekly' && (!weekday || weekday < 1 || weekday > 7)) {
    throw appError('Выберите день недели для еженедельной автозадачи');
  }

  const dueDays = normalizeNumber(data.dueDays, { allowZero: true });
  if (dueDays !== undefined && dueDays > 60) {
    throw appError('Дедлайн автозадачи не должен быть дальше 60 дней');
  }

  const assignedToAccountId = normalizeNumber(data.assignedToAccountId);
  const recurrence = {
    assignedToAccountId: assignedToAccountId || null,
    description: normalizeText(data.description),
    dueDays: dueDays ?? null,
    enabled,
    interval,
    scopeType,
    time: normalizeTime(data.time || current.recurringTime || '10:00'),
    title: normalizeText(data.title),
    weekday: interval === 'weekly' ? weekday : null,
  };

  return {
    recurringAssignedToAccountId: recurrence.assignedToAccountId,
    recurringDescription: recurrence.description,
    recurringDueDays: recurrence.dueDays,
    recurringEnabled: true,
    recurringInterval: recurrence.interval,
    recurringNextRunAt: computeNextRecurringRunAt(recurrence),
    recurringScopeType: recurrence.scopeType,
    recurringTime: recurrence.time,
    recurringTitle: recurrence.title,
    recurringWeekday: recurrence.weekday,
  };
}

async function assertRecurringAssignee(accountId) {
  if (!accountId) return;

  const account = await db.Account.findByPk(accountId);
  if (!account || account.status !== 'active') {
    throw appError('Исполнитель автозадачи не найден или отключен', 404);
  }
  if (!RECURRENCE_ASSIGNEE_ROLES.has(account.role)) {
    throw appError('У этого пользователя нет доступа к задачам обзвона', 409);
  }
}

function normalizeFilters(filters = {}) {
  const normalized = {};

  FILTER_KEYS.forEach((key) => {
    if (!(key in filters)) return;
    const raw = filters[key];

    if (
      [
        'sourceId',
        'visitCategoryId',
        'visitCountMin',
        'visitCountMax',
        'lastVisitDaysFrom',
        'lastVisitDaysTo',
      ].includes(key)
    ) {
      const value = normalizeNumber(raw, {
        allowZero: key === 'visitCountMax',
      });
      if (value !== undefined) normalized[key] = value;
      return;
    }

    const value = String(raw || '').trim();
    if (key === 'status' && value === 'all') {
      normalized.status = 'all';
      return;
    }
    if (value && value !== 'all') normalized[key] = value;
  });

  if (!normalized.status) normalized.status = 'active';
  if (!normalized.segment) normalized.segment = 'all';

  return normalized;
}

function assertTaskableFilters(filters) {
  if ((filters.status || 'active') === 'active') return;

  throw appError(
    'Автозадачи можно включить только для базы с активными клиентами. Выберите статус клиентов «Активные».',
    409,
  );
}

function parseFilters(filters) {
  if (!filters) return {};
  if (typeof filters === 'string') {
    try {
      return JSON.parse(filters);
    } catch {
      return {};
    }
  }

  return filters;
}

async function mapBase(base, { includeCount = true } = {}) {
  const raw = base.toJSON ? base.toJSON() : base;
  const filters = normalizeFilters(parseFilters(raw.filters));
  const currentClientCount = includeCount
    ? await clientsService.countClients(filters)
    : null;
  const lastTaskClientCount =
    raw.lastTaskClientCount === null || raw.lastTaskClientCount === undefined
      ? null
      : Number(raw.lastTaskClientCount);

  return {
    id: raw.id,
    name: raw.name,
    description: raw.description || '',
    filters,
    status: raw.status,
    currentClientCount,
    deltaSinceLastTask:
      lastTaskClientCount === null || currentClientCount === null
        ? null
        : currentClientCount - lastTaskClientCount,
    lastCalculatedAt: raw.lastCalculatedAt,
    lastTaskClientCount,
    lastTaskCreatedAt: raw.lastTaskCreatedAt,
    slaDays:
      raw.slaDays === null || raw.slaDays === undefined
        ? null
        : Number(raw.slaDays),
    recurrence: {
      assignedTo: raw.recurringAssignedToAccount
        ? {
            email: raw.recurringAssignedToAccount.email,
            id: raw.recurringAssignedToAccount.id,
            name:
              raw.recurringAssignedToAccount.Staff?.name ||
              raw.recurringAssignedToAccount.email,
          }
        : null,
      assignedToAccountId: raw.recurringAssignedToAccountId,
      description: raw.recurringDescription || '',
      dueDays:
        raw.recurringDueDays === null || raw.recurringDueDays === undefined
          ? ''
          : Number(raw.recurringDueDays),
      enabled: Boolean(raw.recurringEnabled),
      interval: raw.recurringInterval || 'none',
      lastRunAt: raw.recurringLastRunAt,
      nextRunAt: raw.recurringNextRunAt,
      scopeType: raw.recurringScopeType || 'snapshot',
      time: raw.recurringTime || '10:00',
      title: raw.recurringTitle || '',
      weekday: raw.recurringWeekday,
    },
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    createdBy: raw.createdByAccount
      ? {
          id: raw.createdByAccount.id,
          email: raw.createdByAccount.email,
        }
      : null,
  };
}

async function getBaseOrFail(id) {
  const base = await db.ClientBase.findByPk(Number(id), {
    include: [
      {
        model: db.Account,
        as: 'createdByAccount',
        attributes: ['id', 'email'],
      },
      {
        model: db.Account,
        as: 'recurringAssignedToAccount',
        attributes: ['id', 'email', 'role', 'staffId'],
        include: [{ model: db.Staff, attributes: ['id', 'name'] }],
      },
    ],
  });

  if (!base) throw appError('База клиентов не найдена', 404);
  return base;
}

async function list(query = {}) {
  const where = {};
  if (query.status && query.status !== 'all') {
    where.status = normalizeStatus(query.status);
  } else if (!query.status) {
    where.status = 'active';
  }

  const bases = await db.ClientBase.findAll({
    where,
    include: [
      {
        model: db.Account,
        as: 'createdByAccount',
        attributes: ['id', 'email'],
      },
      {
        model: db.Account,
        as: 'recurringAssignedToAccount',
        attributes: ['id', 'email', 'role', 'staffId'],
        include: [{ model: db.Staff, attributes: ['id', 'name'] }],
      },
    ],
    order: [['updatedAt', 'DESC']],
  });

  return Promise.all(bases.map((base) => mapBase(base)));
}

async function create(actor, data) {
  const name = String(data.name || '').trim();
  if (name.length < 2) throw appError('Название базы слишком короткое');

  const filters = normalizeFilters(data.filters);
  const recurrencePayload = normalizeRecurrence(data.recurrence || {});
  if (recurrencePayload.recurringEnabled) {
    assertTaskableFilters(filters);
  }
  await assertRecurringAssignee(recurrencePayload.recurringAssignedToAccountId);

  const base = await db.ClientBase.create({
    name,
    description: String(data.description || '').trim() || null,
    filters,
    slaDays: normalizeSlaDays(data.slaDays),
    ...recurrencePayload,
    status: normalizeStatus(data.status),
    createdByAccountId: actor?.id || null,
    lastCalculatedAt: new Date(),
  });

  return mapBase(await getBaseOrFail(base.id));
}

async function update(id, data) {
  const base = await getBaseOrFail(id);
  const payload = {};

  if ('name' in data) {
    const name = String(data.name || '').trim();
    if (name.length < 2) throw appError('Название базы слишком короткое');
    payload.name = name;
  }

  if ('description' in data) {
    payload.description = String(data.description || '').trim() || null;
  }

  if ('filters' in data) {
    payload.filters = normalizeFilters(data.filters);
    payload.lastCalculatedAt = new Date();
  }

  if ('slaDays' in data) {
    payload.slaDays = normalizeSlaDays(data.slaDays);
  }

  if ('status' in data) {
    payload.status = normalizeStatus(data.status);
  }

  if ('recurrence' in data) {
    Object.assign(payload, normalizeRecurrence(data.recurrence, base));
    await assertRecurringAssignee(payload.recurringAssignedToAccountId);
  }

  const nextFilters = payload.filters || normalizeFilters(parseFilters(base.filters));
  const nextRecurringEnabled =
    'recurrence' in data
      ? Boolean(payload.recurringEnabled)
      : Boolean(base.recurringEnabled);
  if (nextRecurringEnabled) {
    assertTaskableFilters(nextFilters);
  }

  await base.update(payload);
  return mapBase(await getBaseOrFail(id));
}

async function archive(id) {
  const base = await getBaseOrFail(id);
  await base.update({ status: 'archived' });
  return mapBase(await getBaseOrFail(id));
}

async function restore(id) {
  const base = await getBaseOrFail(id);
  await base.update({ status: 'active' });
  return mapBase(await getBaseOrFail(id));
}

async function removeArchived(id) {
  const base = await getBaseOrFail(id);
  if (base.status !== 'archived') {
    throw appError('Удалять безвозвратно можно только базы из архива', 409);
  }

  const tasksCount = await db.CallTask.count({
    where: { clientBaseId: base.id },
  });
  if (tasksCount > 0) {
    throw appError(
      'Базу нельзя удалить безвозвратно: по ней уже есть задачи обзвона. Оставьте ее в архиве.',
      409,
    );
  }

  await base.destroy();
  return { success: true };
}

async function getClients(id, query = {}) {
  const base = await getBaseOrFail(id);
  const filters = normalizeFilters(parseFilters(base.filters));
  const page = query.page || 1;
  const pageSize = query.pageSize || 10;
  return clientsService.listClients({ ...filters, page, pageSize });
}

module.exports = {
  archive,
  create,
  getClients,
  list,
  removeArchived,
  restore,
  update,
};
