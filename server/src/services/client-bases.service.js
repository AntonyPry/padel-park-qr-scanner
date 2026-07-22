const db = require('../../models');
const clientsService = require('./clients.service');
const onboardingService = require('./onboarding.service');
const visitsAnalyticsService = require('./visits-analytics.service');
const {
  callTaskTenantWhere,
  resolveCallTaskAccessContext,
  resolveEligibleCallTaskAccount,
} = require('./call-task-access-context.service');

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

async function assertRecurringAssignee(accountId, context, transaction) {
  if (!accountId) return;
  let resolved = null;
  try {
    resolved = await resolveEligibleCallTaskAccount(accountId, context, {
      roles: Array.from(RECURRENCE_ASSIGNEE_ROLES),
      transaction,
    });
  } catch {
    throw appError('Исполнитель автозадачи не найден или отключен', 404);
  }
  if (!resolved) throw appError('Исполнитель автозадачи не найден или отключен', 404);
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

  if (filters.visitsAnalytics) {
    normalized.visitsAnalytics = visitsAnalyticsService.normalizeVisitAnalyticsSegmentFilters(
      filters.visitsAnalytics,
    );
    normalized.status = 'active';
    normalized.segment = 'all';
  }

  return normalized;
}

function isVisitsAnalyticsFilters(filters = {}) {
  return Boolean(filters?.visitsAnalytics);
}

async function countBaseClients(filters = {}, tenant = null, options = {}) {
  if (isVisitsAnalyticsFilters(filters)) {
    return visitsAnalyticsService.countVisitAnalyticsSegmentClients(
      filters.visitsAnalytics,
      options.context?.readScoped
        ? { visitContext: options.context }
        : { tenant },
    );
  }
  return clientsService.countClients(filters, tenant, {
    context: options.context,
  });
}

async function listBaseClientsForSnapshot(filters = {}, options = {}) {
  if (isVisitsAnalyticsFilters(filters)) {
    return (await visitsAnalyticsService.listVisitAnalyticsSegmentClients(
      filters.visitsAnalytics,
      options.context?.readScoped
        ? {
            limit: options.limit || 20000,
            offset: 0,
            visitContext: options.context,
          }
        : { limit: options.limit || 20000, offset: 0, tenant: options.tenant },
    )).items;
  }
  return clientsService.listClientsForSnapshot(filters, {
    ...options,
    context: options.context,
  });
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

function accountTenantInclude(context) {
  return [
    {
      model: db.Membership,
      attributes: ['id', 'staffId'],
      required: false,
      where: {
        organizationId: context.organizationId,
        status: 'active',
      },
      include: [
        {
          model: db.Staff,
          attributes: ['id', 'name'],
          required: false,
        },
      ],
    },
  ];
}

async function mapBase(
  base,
  { context = null, includeCount = true, tenant = null } = {},
) {
  const raw = base.toJSON ? base.toJSON() : base;
  const filters = normalizeFilters(parseFilters(raw.filters));
  const currentClientCount = includeCount
    ? await countBaseClients(filters, tenant, { context })
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
    origin: raw.origin || null,
    originMetadata: parseFilters(raw.originMetadata),
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
              (raw.recurringAssignedToAccount.Memberships || [])[0]?.Staff
                ?.name || raw.recurringAssignedToAccount.email,
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

async function getBaseOrFail(id, context, options = {}) {
  const base = await db.ClientBase.findOne({
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
        include: accountTenantInclude(context),
      },
    ],
    lock: options.lock,
    transaction: options.transaction,
    where: callTaskTenantWhere(context, { id: Number(id) }),
  });

  if (!base) throw appError('База клиентов не найдена', 404);
  return base;
}

async function list(query = {}, tenant = null) {
  const context = await resolveCallTaskAccessContext(tenant);
  const where = callTaskTenantWhere(context);
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
        include: accountTenantInclude(context),
      },
    ],
    order: [['updatedAt', 'DESC']],
  });

  return Promise.all(
    bases.map((base) => mapBase(base, { context, tenant })),
  );
}

async function persistBase(actor, data, provenance = null, tenant = null) {
  const name = String(data.name || '').trim();
  if (name.length < 2) throw appError('Название базы слишком короткое');

  const filters = normalizeFilters(data.filters);
  const origin = provenance?.origin || null;
  if (origin === 'visits_analytics' && !isVisitsAnalyticsFilters(filters)) {
    throw appError('Для базы из аналитики не передан аналитический фильтр');
  }
  const recurrencePayload = normalizeRecurrence(data.recurrence || {});
  if (recurrencePayload.recurringEnabled) {
    assertTaskableFilters(filters);
  }
  const trainingMarker = await onboardingService.getTrainingDataMarker(actor, tenant);
  const base = await db.sequelize.transaction(async (transaction) => {
    const context = await resolveCallTaskAccessContext(tenant, {
      accountId: actor?.id,
      lock: true,
      transaction,
    });
    if (
      context.readScoped &&
      actor?.id &&
      Number(context.accountId) !== Number(actor.id)
    ) {
      throw appError('Контекст клуба недоступен', 404);
    }
    if (
      origin === 'visits_analytics' &&
      (await countBaseClients(filters, tenant, { context })) === 0
    ) {
      throw appError('Пустой сегмент нельзя сохранить как клиентскую базу', 409);
    }
    await assertRecurringAssignee(
      recurrencePayload.recurringAssignedToAccountId,
      context,
      transaction,
    );
    return db.ClientBase.create({
      clubId: context.clubId,
      createdByAccountId: actor?.id || null,
      description: String(data.description || '').trim() || null,
      filters,
      lastCalculatedAt: new Date(),
      name,
      organizationId: context.organizationId,
      origin,
      originClubId: origin === 'visits_analytics' ? context.clubId : null,
      originMetadata: origin === 'visits_analytics' ? provenance.originMetadata : null,
      originOrganizationId:
        origin === 'visits_analytics' ? context.organizationId : null,
      slaDays: normalizeSlaDays(data.slaDays),
      ...recurrencePayload,
      status: normalizeStatus(data.status),
      ...trainingMarker,
    }, { transaction });
  });

  await onboardingService.recordEventSafe(actor, 'client_base.created', {
    entityId: base.id,
    entityType: 'client_base',
    tenant,
    payload: {
      baseId: base.id,
      recurrenceEnabled: Boolean(recurrencePayload.recurringEnabled),
      scopeType: base.scopeType,
    },
  });

  const context = await resolveCallTaskAccessContext(tenant, {
    accountId: actor?.id,
  });
  return mapBase(await getBaseOrFail(base.id, context), {
    context,
    tenant,
  });
}

async function create(actor, data, tenant = null) {
  const rawFilters = parseFilters(data.filters);
  if (
    data.origin === 'visits_analytics'
    || 'originMetadata' in data
    || isVisitsAnalyticsFilters(rawFilters)
  ) {
    throw appError(
      'Базы из аналитики посещений создаются только через аналитический сценарий',
      400,
    );
  }

  return persistBase(actor, data, null, tenant);
}

async function createFromVisitsAnalytics(actor, data, tenant = null) {
  const preview = await visitsAnalyticsService.previewVisitAnalyticsSegment(
    data.selection,
    { tenant },
  );

  return persistBase(actor, {
    description: data.description,
    filters: preview.filters,
    name: data.name,
    recurrence: { enabled: false },
    slaDays: null,
    status: 'active',
  }, {
    origin: preview.origin,
    originMetadata: preview.originMetadata,
  }, tenant);
}

async function update(id, data, tenant = null) {
  const initialContext = await resolveCallTaskAccessContext(tenant);
  const initialBase = await getBaseOrFail(id, initialContext);
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
    if (initialBase.origin === 'visits_analytics') {
      throw appError(
        'Фильтр базы из аналитики посещений нельзя изменить',
        409,
      );
    }
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
    Object.assign(payload, normalizeRecurrence(data.recurrence, initialBase));
  }

  const nextFilters = payload.filters || normalizeFilters(parseFilters(initialBase.filters));
  const nextRecurringEnabled =
    'recurrence' in data
      ? Boolean(payload.recurringEnabled)
      : Boolean(initialBase.recurringEnabled);
  if (nextRecurringEnabled) {
    assertTaskableFilters(nextFilters);
  }

  const context = await db.sequelize.transaction(async (transaction) => {
    const writeContext = await resolveCallTaskAccessContext(tenant, {
      lock: true,
      transaction,
    });
    const base = await getBaseOrFail(id, writeContext, {
      lock: transaction.LOCK.UPDATE,
      transaction,
    });
    if (base.origin === 'visits_analytics' && 'filters' in data) {
      throw appError('Фильтр базы из аналитики посещений нельзя изменить', 409);
    }
    if ('recurrence' in data) {
      await assertRecurringAssignee(
        payload.recurringAssignedToAccountId,
        writeContext,
        transaction,
      );
    }
    await base.update(payload, { transaction });
    return writeContext;
  });
  return mapBase(await getBaseOrFail(id, context), { context, tenant });
}

async function archive(id, tenant = null) {
  const context = await db.sequelize.transaction(async (transaction) => {
    const writeContext = await resolveCallTaskAccessContext(tenant, {
      lock: true,
      transaction,
    });
    const base = await getBaseOrFail(id, writeContext, {
      lock: transaction.LOCK.UPDATE,
      transaction,
    });
    await base.update({ status: 'archived' }, { transaction });
    return writeContext;
  });
  return mapBase(await getBaseOrFail(id, context), { context, tenant });
}

async function restore(id, tenant = null) {
  const context = await db.sequelize.transaction(async (transaction) => {
    const writeContext = await resolveCallTaskAccessContext(tenant, {
      lock: true,
      transaction,
    });
    const base = await getBaseOrFail(id, writeContext, {
      lock: transaction.LOCK.UPDATE,
      transaction,
    });
    await base.update({ status: 'active' }, { transaction });
    return writeContext;
  });
  return mapBase(await getBaseOrFail(id, context), { context, tenant });
}

async function removeArchived(id, tenant = null) {
  await db.sequelize.transaction(async (transaction) => {
    const context = await resolveCallTaskAccessContext(tenant, {
      lock: true,
      transaction,
    });
    const base = await getBaseOrFail(id, context, {
      lock: transaction.LOCK.UPDATE,
      transaction,
    });
    if (base.status !== 'archived') {
      throw appError('Удалять безвозвратно можно только базы из архива', 409);
    }

    const tasksCount = await db.CallTask.count({
      transaction,
      where: callTaskTenantWhere(context, { clientBaseId: base.id }),
    });
    if (tasksCount > 0) {
      throw appError(
        'Базу нельзя удалить безвозвратно: по ней уже есть задачи обзвона. Оставьте ее в архиве.',
        409,
      );
    }

    await base.destroy({ transaction });
  });
  return { success: true };
}

async function getClients(id, query = {}, tenant = null) {
  const context = await resolveCallTaskAccessContext(tenant);
  const base = await getBaseOrFail(id, context);
  const filters = normalizeFilters(parseFilters(base.filters));
  const page = query.page || 1;
  const pageSize = query.pageSize || 10;
  if (isVisitsAnalyticsFilters(filters)) {
    const result = await visitsAnalyticsService.listVisitAnalyticsSegmentClients(
      filters.visitsAnalytics,
      context.readScoped
        ? { limit: pageSize, offset: (page - 1) * pageSize, visitContext: context }
        : { limit: pageSize, offset: (page - 1) * pageSize, tenant },
    );
    return {
      items: result.items,
      page,
      pageSize,
      total: result.total,
      totalPages: Math.max(1, Math.ceil(result.total / pageSize)),
    };
  }
  if (context.readScoped) {
    const result = await clientsService.listClientsForSnapshot(
      { ...filters },
      { context, limit: 20000, tenant },
    );
    const start = (page - 1) * pageSize;
    return {
      items: result.slice(start, start + pageSize),
      page,
      pageSize,
      total: result.length,
      totalPages: Math.max(1, Math.ceil(result.length / pageSize)),
    };
  }
  return clientsService.listClients({ ...filters, page, pageSize }, null, tenant);
}

module.exports = {
  archive,
  countBaseClients,
  create,
  createFromVisitsAnalytics,
  getClients,
  list,
  listBaseClientsForSnapshot,
  removeArchived,
  restore,
  update,
};
