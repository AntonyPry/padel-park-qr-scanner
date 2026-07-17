const { Op } = require('sequelize');
const db = require('../../models');
const clientsService = require('./clients.service');
const clientBasesService = require('./client-bases.service');
const onboardingService = require('./onboarding.service');
const {
  BACKGROUND_COMPONENTS,
  assertBackgroundComponentCanRun,
} = require('../files-workers/background-run-context');
const {
  callTaskTenantWhere,
  resolveCallTaskAccessContext,
  resolveEligibleCallTaskAccount,
  resolveStoredCallTaskContext,
} = require('./call-task-access-context.service');

const TASK_STATUSES = new Set(['backlog', 'in_progress', 'done', 'archived']);
const TASK_SCOPE_TYPES = new Set(['snapshot', 'dynamic']);
const TASK_CLIENT_STATUSES = new Set([
  'new',
  'no_answer',
  'callback',
  'doubting',
  'booked',
  'refused',
]);
const FINISHED_CLIENT_STATUSES = new Set(['booked', 'refused']);
const WORKER_ROLES = new Set(['owner', 'manager', 'admin']);
const DAY_MS = 24 * 60 * 60 * 1000;

function appError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function normalizeText(value) {
  const normalized = String(value || '').trim();
  return normalized || null;
}

function normalizeTaskStatus(status = 'backlog') {
  if (!TASK_STATUSES.has(status)) {
    throw appError('Некорректный статус задачи обзвона');
  }

  return status;
}

function normalizeScopeType(scopeType = 'snapshot') {
  if (!TASK_SCOPE_TYPES.has(scopeType)) {
    throw appError('Некорректный режим базы для обзвона');
  }

  return scopeType;
}

function normalizeClientStatus(status = 'new') {
  if (!TASK_CLIENT_STATUSES.has(status)) {
    throw appError('Некорректный статус клиента в обзвоне');
  }

  return status;
}

function normalizeDateTime(value, fieldName) {
  if (value === null || value === undefined || value === '') return null;

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw appError(`Некорректная дата: ${fieldName}`);
  }

  return date;
}

function addDays(date, days) {
  return new Date(date.getTime() + days * DAY_MS);
}

function formatDateForTitle(date) {
  return new Intl.DateTimeFormat('ru-RU').format(date);
}

function getWeekday(date) {
  const day = date.getDay();
  return day === 0 ? 7 : day;
}

function setTime(date, time = '10:00') {
  const [hours, minutes] = String(time || '10:00').split(':').map(Number);
  const next = new Date(date);
  next.setHours(hours || 0, minutes || 0, 0, 0);
  return next;
}

function computeNextRecurringRunAt(base, from = new Date()) {
  if (!base.recurringEnabled) return null;

  if (base.recurringInterval === 'daily') {
    let next = setTime(from, base.recurringTime);
    if (next <= from) next = setTime(addDays(from, 1), base.recurringTime);
    return next;
  }

  if (base.recurringInterval === 'weekly') {
    const targetWeekday = base.recurringWeekday || 1;
    const currentWeekday = getWeekday(from);
    let offset = targetWeekday - currentWeekday;
    if (offset < 0) offset += 7;

    let next = setTime(addDays(from, offset), base.recurringTime);
    if (next <= from) next = setTime(addDays(next, 7), base.recurringTime);
    return next;
  }

  return null;
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

function baseTargetsOnlyActiveClients(base) {
  const filters = parseFilters(base.filters);
  const clientStatus = filters.status || 'active';

  return clientStatus === 'active';
}

function assertBaseTargetsOnlyActiveClients(base) {
  if (baseTargetsOnlyActiveClients(base)) return;

  throw appError(
    'Нельзя создать задачу обзвона по базе с архивными клиентами. В фильтре базы должен быть статус «Активные».',
    409,
  );
}

function isManager(actor) {
  return actor?.role === 'owner' || actor?.role === 'manager';
}

function assertCanManageTask(actor) {
  if (!isManager(actor)) {
    throw appError('Недостаточно прав для управления задачами обзвона', 403);
  }
}

function canWorkTask(actor, task) {
  if (isManager(actor)) return true;
  if (actor?.role !== 'admin') return false;
  return !task.assignedToAccountId || task.assignedToAccountId === actor.id;
}

function assertCanWorkTask(actor, task) {
  if (!canWorkTask(actor, task)) {
    throw appError('Недостаточно прав для работы с этой задачей', 403);
  }
}

async function normalizeAssigneeId(
  assignedToAccountId,
  context,
  transaction = undefined,
) {
  if (
    assignedToAccountId === null ||
    assignedToAccountId === undefined ||
    assignedToAccountId === ''
  ) {
    return null;
  }

  const accountId = Number(assignedToAccountId);
  if (!Number.isInteger(accountId)) {
    throw appError('Некорректный исполнитель');
  }

  let resolved = null;
  try {
    resolved = await resolveEligibleCallTaskAccount(accountId, context, {
      roles: Array.from(WORKER_ROLES),
      transaction,
    });
  } catch {
    throw appError('Исполнитель не найден или отключен', 404);
  }
  if (!resolved) throw appError('Исполнитель не найден или отключен', 404);
  return resolved;
}

async function resolveRecurringAssigneeId(accountId, context, transaction) {
  if (!accountId) return null;
  return resolveEligibleCallTaskAccount(accountId, context, {
    allowInvalid: true,
    roles: Array.from(WORKER_ROLES),
    transaction,
  });
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
          attributes: ['id', 'name', 'organizationId', 'status'],
          required: false,
        },
      ],
    },
  ];
}

function taskInclude(context) {
  return [
    {
      model: db.ClientBase,
      as: 'clientBase',
      attributes: ['id', 'name', 'filters', 'slaDays', 'status'],
    },
    {
      model: db.Account,
      as: 'assignedToAccount',
      attributes: ['id', 'email', 'role', 'staffId'],
      include: accountTenantInclude(context),
    },
    {
      model: db.Account,
      as: 'createdByAccount',
      attributes: ['id', 'email', 'role', 'staffId'],
      include: accountTenantInclude(context),
    },
  ];
}

function mapAccount(account) {
  if (!account) return null;
  const raw = account.toJSON ? account.toJSON() : account;
  const staff = (raw.Memberships || [])[0]?.Staff;

  return {
    email: raw.email,
    id: raw.id,
    name: staff?.name || raw.email,
    role: raw.role,
  };
}

function emptyCounts() {
  return {
    booked: 0,
    callback: 0,
    doubting: 0,
    new: 0,
    no_answer: 0,
    refused: 0,
  };
}

function getTaskCompletionMetrics(counts, total, overdueCount = 0) {
  const contactedCount = Math.max(0, total - Number(counts.new || 0));
  const finishedCount = Number(counts.booked || 0) + Number(counts.refused || 0);
  const bookedCount = Number(counts.booked || 0);

  return {
    bookedCount,
    completionRate: total > 0 ? Math.round((finishedCount / total) * 1000) / 10 : 0,
    contactedCount,
    contactRate: total > 0 ? Math.round((contactedCount / total) * 1000) / 10 : 0,
    conversionRate:
      contactedCount > 0 ? Math.round((bookedCount / contactedCount) * 1000) / 10 : 0,
    finishedCount,
    overdueRate: total > 0 ? Math.round((overdueCount / total) * 1000) / 10 : 0,
  };
}

async function getTaskClientMetrics(taskIds) {
  if (taskIds.length === 0) return new Map();

  const counts = await db.CallTaskClient.findAll({
    attributes: [
      'callTaskId',
      'status',
      [db.Sequelize.fn('COUNT', db.Sequelize.col('id')), 'count'],
    ],
    where: { callTaskId: { [Op.in]: taskIds } },
    group: ['callTaskId', 'status'],
    raw: true,
  });
  const overdueRows = await db.CallTaskClient.findAll({
    attributes: [
      'callTaskId',
      [db.Sequelize.fn('COUNT', db.Sequelize.col('id')), 'count'],
    ],
    where: {
      callTaskId: { [Op.in]: taskIds },
      deadlineAt: { [Op.lt]: new Date() },
      status: { [Op.notIn]: Array.from(FINISHED_CLIENT_STATUSES) },
    },
    group: ['callTaskId'],
    raw: true,
  });

  const metricsByTask = new Map();
  taskIds.forEach((taskId) => {
    metricsByTask.set(taskId, {
      counts: emptyCounts(),
      overdueCount: 0,
      total: 0,
    });
  });

  counts.forEach((row) => {
    const taskId = Number(row.callTaskId);
    const metrics = metricsByTask.get(taskId) || {
      counts: emptyCounts(),
      overdueCount: 0,
      total: 0,
    };
    const count = Number(row.count || 0);
    metrics.counts[row.status] = count;
    metrics.total += count;
    metricsByTask.set(taskId, metrics);
  });

  overdueRows.forEach((row) => {
    const metrics = metricsByTask.get(Number(row.callTaskId));
    if (metrics) metrics.overdueCount = Number(row.count || 0);
  });

  return metricsByTask;
}

async function countCurrentBaseClients(task, tenant = null) {
  const raw = task.toJSON ? task.toJSON() : task;
  const filters = parseFilters(raw.clientBase?.filters);
  return clientBasesService.countBaseClients(filters, tenant);
}

async function mapTask(task, metricsByTask = new Map(), options = {}) {
  const raw = task.toJSON ? task.toJSON() : task;
  const metrics = metricsByTask.get(raw.id) || {
    counts: emptyCounts(),
    overdueCount: 0,
    total: raw.snapshotClientCount || 0,
  };
  const includeCurrentBaseCount = options.includeCurrentBaseCount === true;
  const currentBaseClientCount = includeCurrentBaseCount && raw.clientBase
    ? await countCurrentBaseClients(raw, options.tenant || null)
    : null;

  return {
    assignedTo: mapAccount(raw.assignedToAccount),
    clientBase: raw.clientBase
      ? {
          id: raw.clientBase.id,
          name: raw.clientBase.name,
          status: raw.clientBase.status,
        }
      : null,
    counts: metrics.counts,
    createdAt: raw.createdAt,
    createdBy: mapAccount(raw.createdByAccount),
    currentBaseClientCount,
    description: raw.description || '',
    dueAt: raw.dueAt,
    id: raw.id,
    metrics: getTaskCompletionMetrics(
      metrics.counts,
      metrics.total,
      metrics.overdueCount,
    ),
    newInBaseCount:
      currentBaseClientCount === null
        ? null
        : Math.max(0, currentBaseClientCount - metrics.total),
    overdueCount: metrics.overdueCount,
    scriptText: raw.scriptText || '',
    scopeType: raw.scopeType,
    snapshotClientCount: raw.snapshotClientCount,
    status: raw.status,
    title: raw.title,
    totalClientCount: metrics.total,
    updatedAt: raw.updatedAt,
  };
}

async function getTaskOrFail(id, context, options = {}) {
  const task = await db.CallTask.findOne({
    include: taskInclude(context),
    lock: options.lock,
    transaction: options.transaction,
    where: callTaskTenantWhere(context, { id: Number(id) }),
  });
  if (!task) throw appError('Задача обзвона не найдена', 404);
  return task;
}

async function getBaseOrFail(id, context, options = {}) {
  const base = await db.ClientBase.findOne({
    lock: options.lock,
    transaction: options.transaction,
    where: callTaskTenantWhere(context, { id: Number(id) }),
  });
  if (!base) throw appError('База клиентов не найдена', 404);
  return base;
}

function mapSnapshotClient(client) {
  return {
    clientName: client.name,
    clientPhone: client.phone,
    lastVisitAt: client.stats?.lastVisitAt || null,
    source: client.source,
    userId: client.id,
    visitCount: Number(client.stats?.visitCount || 0),
  };
}

function getClientDeadlineAt(base, from = new Date(), fallbackDueAt = null) {
  const slaDays = Number(base?.slaDays);
  if (Number.isInteger(slaDays) && slaDays >= 0) {
    if (slaDays === 0) {
      const endOfDay = new Date(from);
      endOfDay.setHours(23, 59, 59, 999);
      return endOfDay;
    }
    return addDays(from, slaDays);
  }

  return fallbackDueAt || null;
}

async function getClientStatsForTask(clientId, context) {
  const stats = await db.Visit.findOne({
    attributes: [
      [db.Sequelize.fn('COUNT', db.Sequelize.col('id')), 'visitCount'],
      [db.Sequelize.fn('MAX', db.Sequelize.col('scannedAt')), 'lastVisitAt'],
    ],
    raw: true,
    where: callTaskTenantWhere(context, { userId: clientId }),
  });

  return {
    lastVisitAt: stats?.lastVisitAt || null,
    visitCount: Number(stats?.visitCount || 0),
  };
}

async function getClientSnapshotOrFail(clientId, tenant = null, context = null) {
  const client = await clientsService.findCanonicalById(clientId, tenant);
  if (!client || Number(client.id) !== Number(clientId)) {
    throw appError('Клиент не найден', 404);
  }
  if (client.status !== 'active') {
    throw appError('Нельзя создать задачу по архивному клиенту', 409);
  }

  return {
    ...client.toJSON(),
    stats: await getClientStatsForTask(client.id, context),
  };
}

function getSnapshotUpdatePayload(row, client) {
  const next = mapSnapshotClient(client);
  const payload = {};

  Object.entries(next).forEach(([key, value]) => {
    const current = row[key];
    if (key === 'lastVisitAt') {
      const currentTime = current ? new Date(current).getTime() : null;
      const nextTime = value ? new Date(value).getTime() : null;
      if (currentTime !== nextTime) payload[key] = value;
      return;
    }

    if (current !== value) payload[key] = value;
  });

  return payload;
}

async function getBaseSnapshotClients(base, options = {}) {
  assertBaseTargetsOnlyActiveClients(base);

  const filters = parseFilters(base.filters);
  const clients = await clientBasesService.listBaseClientsForSnapshot(filters, {
    context: options.context,
    limit: options.limit || 20000,
    tenant: options.tenant || null,
  });
  const total = await clientBasesService.countBaseClients(
    filters,
    options.tenant || null,
    { context: options.context },
  );

  if (clients.length < total) {
    throw appError(
      `В базе ${total} клиентов. Сузьте фильтр до 20 000 клиентов для одного обзвона`,
      409,
    );
  }

  return clients;
}

async function syncDynamicTask(task, tenant = null, context = null) {
  const emptyResult = {
    addedCount: 0,
    keptRemovedCount: 0,
    removedCount: 0,
    updatedCount: 0,
  };

  return db.sequelize.transaction(async (transaction) => {
    const rawTask = task.toJSON ? task.toJSON() : task;
    const lockedContext =
      context?.authority === 'stored-root'
        ? await resolveStoredCallTaskContext(rawTask, {
            lock: true,
            transaction,
          })
        : await resolveCallTaskAccessContext(tenant, {
            accountId: context?.accountId,
            lock: true,
            transaction,
          });
    const lockedTask = await getTaskOrFail(rawTask.id, lockedContext, {
      lock: transaction.LOCK.UPDATE,
      transaction,
    });
    const raw = lockedTask.toJSON ? lockedTask.toJSON() : lockedTask;
    if (raw.scopeType !== 'dynamic' || !raw.clientBase) return emptyResult;
    if (raw.status === 'archived' || raw.status === 'done') return emptyResult;
    if (raw.clientBase.status !== 'active') return emptyResult;
    if (!baseTargetsOnlyActiveClients(raw.clientBase)) return emptyResult;

    const currentClients = await getBaseSnapshotClients(raw.clientBase, {
      context: lockedContext,
      tenant,
    });
    const currentById = new Map(
      currentClients.map((client) => [Number(client.id), client]),
    );
    const existing = await db.CallTaskClient.findAll({
      include: [
        {
          model: db.CallTaskAttempt,
          as: 'attempts',
          attributes: ['id'],
        },
      ],
      lock: transaction.LOCK.UPDATE,
      transaction,
      where: { callTaskId: raw.id },
    });
    const existingIds = new Set(existing.map((item) => Number(item.userId)));
    const missingClients = currentClients.filter(
      (client) => !existingIds.has(client.id),
    );
    let updatedCount = 0;
    let removedCount = 0;
    let keptRemovedCount = 0;

    for (const row of existing) {
      const currentClient = currentById.get(Number(row.userId));
      if (currentClient) {
        const payload = getSnapshotUpdatePayload(row, currentClient);
        if (Object.keys(payload).length > 0) {
          await row.update(payload, { transaction });
          updatedCount += 1;
        }
        continue;
      }

      const hasHistory = (row.attempts || []).length > 0 || row.status !== 'new';
      if (hasHistory) {
        keptRemovedCount += 1;
        continue;
      }

      await row.destroy({ transaction });
      removedCount += 1;
    }

    if (missingClients.length > 0) {
      await db.CallTaskClient.bulkCreate(
        missingClients.map((client) => ({
          ...mapSnapshotClient(client),
          callTaskId: raw.id,
          deadlineAt: getClientDeadlineAt(raw.clientBase, new Date(), raw.dueAt),
          status: 'new',
          isTraining: Boolean(raw.isTraining),
          trainingAccountId: raw.trainingAccountId || null,
          trainingRole: raw.trainingRole || null,
        })),
        {
          ignoreDuplicates: true,
          transaction,
        },
      );
    }
    const total = await db.CallTaskClient.count({
      transaction,
      where: { callTaskId: raw.id },
    });
    await lockedTask.update(
      {
        snapshotClientCount: total,
      },
      { transaction },
    );

    return {
      addedCount: missingClients.length,
      keptRemovedCount,
      removedCount,
      updatedCount,
    };
  });
}

async function getTaskMembershipDiff(task, tenant = null, context = null) {
  const raw = task.toJSON ? task.toJSON() : task;
  if (!raw.clientBase || raw.clientBase.status !== 'active') {
    return null;
  }
  if (!baseTargetsOnlyActiveClients(raw.clientBase)) {
    return null;
  }

  const currentClients = await getBaseSnapshotClients(raw.clientBase, {
    context,
    tenant,
  });
  const currentById = new Map(
    currentClients.map((client) => [Number(client.id), client]),
  );
  const existing = await db.CallTaskClient.findAll({
    where: { callTaskId: raw.id },
  });

  let updatedCount = 0;
  existing.forEach((row) => {
    const currentClient = currentById.get(Number(row.userId));
    if (!currentClient) return;
    if (Object.keys(getSnapshotUpdatePayload(row, currentClient)).length > 0) {
      updatedCount += 1;
    }
  });

  const existingIds = new Set(existing.map((row) => Number(row.userId)));
  const removedCount = existing.filter(
    (row) => !currentById.has(Number(row.userId)),
  ).length;
  const addedCount = currentClients.filter(
    (client) => !existingIds.has(Number(client.id)),
  ).length;

  return {
    addedCount,
    currentCount: currentClients.length,
    removedCount,
    taskCount: existing.length,
    updatedCount,
  };
}

async function createTaskForBase({
  actor = null,
  base,
  clients,
  context,
  data = {},
  tenant = null,
  transaction,
}) {
  const now = new Date();
  const snapshotClients =
    clients || (await getBaseSnapshotClients(base, { context, tenant }));
  const title =
    normalizeText(data.title) ||
    `${base.name}: обзвон ${formatDateForTitle(now)}`;
  const dueAt = normalizeDateTime(data.dueAt, 'дедлайн задачи');
  const clientDeadlineAt = getClientDeadlineAt(base, now, dueAt);
  const scopeType = normalizeScopeType(data.scopeType);
  const assignedToAccountId = await normalizeAssigneeId(
    data.assignedToAccountId,
    context,
    transaction,
  );
  const trainingMarker = base.isTraining
    ? {
        isTraining: true,
        trainingAccountId: base.trainingAccountId || null,
        trainingRole: base.trainingRole || null,
      }
    : await onboardingService.getTrainingDataMarker(actor);

  const createdTask = await db.CallTask.create(
    {
      assignedToAccountId,
      clubId: context.clubId,
      clientBaseId: base.id,
      createdByAccountId: actor?.id || null,
      description: normalizeText(data.description),
      dueAt,
      organizationId: context.organizationId,
      scriptText: normalizeText(data.scriptText),
      scopeType,
      snapshotClientCount: snapshotClients.length,
      status: 'backlog',
      title,
      ...trainingMarker,
    },
    { transaction },
  );

  if (snapshotClients.length > 0) {
    await db.CallTaskClient.bulkCreate(
      snapshotClients.map((client) => ({
        ...mapSnapshotClient(client),
        callTaskId: createdTask.id,
        deadlineAt: clientDeadlineAt,
        status: 'new',
        ...trainingMarker,
      })),
      { transaction },
    );
  }

  await base.update(
    {
      lastCalculatedAt: now,
      lastTaskClientCount: snapshotClients.length,
      lastTaskCreatedAt: now,
    },
    { transaction },
  );

  return createdTask;
}

async function createForClient(actor, clientId, data = {}, tenant = null) {
  assertCanManageTask(actor);
  const dueAt = normalizeDateTime(data.dueAt, 'дедлайн задачи');
  const trainingMarker = await onboardingService.getTrainingDataMarker(actor);

  const created = await db.sequelize.transaction(async (transaction) => {
    const context = await resolveCallTaskAccessContext(tenant, {
      accountId: actor?.id,
      lock: true,
      transaction,
    });
    if (context.readScoped && Number(context.accountId) !== Number(actor?.id)) {
      throw appError('Контекст клуба недоступен', 404);
    }
    const client = await getClientSnapshotOrFail(clientId, tenant, context);
    const assignedToAccountId = await normalizeAssigneeId(
      data.assignedToAccountId,
      context,
      transaction,
    );
    const title = normalizeText(data.title) || `Обзвон: ${client.name}`;
    if (title.length < 2) throw appError('Название задачи слишком короткое');
    const task = await db.CallTask.create(
      {
        assignedToAccountId,
        clubId: context.clubId,
        clientBaseId: null,
        createdByAccountId: actor?.id || null,
        description: normalizeText(data.description),
        dueAt,
        organizationId: context.organizationId,
        scriptText: normalizeText(data.scriptText),
        scopeType: 'snapshot',
        snapshotClientCount: 1,
        status: 'backlog',
        title,
        ...trainingMarker,
      },
      { transaction },
    );

    await db.CallTaskClient.create(
      {
        ...mapSnapshotClient(client),
        callTaskId: task.id,
        deadlineAt: dueAt,
        status: 'new',
        ...trainingMarker,
      },
      { transaction },
    );

    return { clientId: Number(client.id), task };
  });

  await onboardingService.recordEventSafe(actor, 'call_task.created', {
    entityId: created.task.id,
    entityType: 'call_task',
    payload: {
      clientId: created.clientId,
      scopeType: 'snapshot',
      taskId: created.task.id,
    },
  });

  return getOne(actor, created.task.id, tenant);
}

function buildTaskWhere(actor, query = {}) {
  const where = {};
  const status = query.status || 'active';

  if (status === 'active') {
    where.status = { [Op.in]: ['backlog', 'in_progress'] };
  } else if (status !== 'all') {
    where.status = normalizeTaskStatus(status);
  }

  const baseId = Number(query.baseId);
  if (Number.isInteger(baseId) && baseId > 0) {
    where.clientBaseId = baseId;
  }

  if (!isManager(actor)) {
    where[Op.or] = [
      { assignedToAccountId: null },
      { assignedToAccountId: actor.id },
    ];
  }

  return where;
}

async function list(actor, query = {}, tenant = null) {
  const context = await resolveCallTaskAccessContext(tenant, {
    accountId: actor?.id,
  });
  const where = callTaskTenantWhere(context, buildTaskWhere(actor, query));

  const tasks = await db.CallTask.findAll({
    where,
    include: taskInclude(context),
    order: [
      [db.Sequelize.literal("CASE WHEN `CallTask`.`status` = 'in_progress' THEN 0 WHEN `CallTask`.`status` = 'backlog' THEN 1 WHEN `CallTask`.`status` = 'done' THEN 2 ELSE 3 END"), 'ASC'],
      ['dueAt', 'ASC'],
      ['createdAt', 'DESC'],
    ],
  });

  const metricsByTask = await getTaskClientMetrics(
    tasks.map((task) => task.id),
  );

  return Promise.all(
    tasks.map((task) => mapTask(task, metricsByTask, { tenant })),
  );
}

async function createFromBase(actor, baseId, data = {}, tenant = null) {
  assertCanManageTask(actor);

  const task = await db.sequelize.transaction(async (transaction) => {
    const context = await resolveCallTaskAccessContext(tenant, {
      accountId: actor?.id,
      lock: true,
      transaction,
    });
    const base = await getBaseOrFail(baseId, context, {
      lock: transaction.LOCK.UPDATE,
      transaction,
    });
    if (base.status !== 'active') {
      throw appError('Нельзя создать обзвон из архивной базы', 409);
    }
    return createTaskForBase({
      actor,
      base,
      context,
      data,
      tenant,
      transaction,
    });
  });

  await onboardingService.recordEventSafe(actor, 'call_task.created', {
    entityId: task.id,
    entityType: 'call_task',
    payload: {
      baseId: Number(baseId),
      scopeType: data.scopeType || 'snapshot',
      taskId: task.id,
    },
  });

  return getOne(actor, task.id, tenant);
}

async function getOne(actor, id, tenant = null) {
  const context = await resolveCallTaskAccessContext(tenant, {
    accountId: actor?.id,
  });
  const task = await getTaskOrFail(id, context);
  assertCanWorkTask(actor, task);
  await syncDynamicTask(task, tenant, context);

  const metricsByTask = await getTaskClientMetrics([task.id]);
  const freshTask = await getTaskOrFail(id, context);
  const mapped = await mapTask(freshTask, metricsByTask, {
    includeCurrentBaseCount: true,
    tenant,
  });
  mapped.membershipDiff = await getTaskMembershipDiff(
    freshTask,
    tenant,
    context,
  );
  return mapped;
}

async function update(actor, id, data = {}, tenant = null) {
  assertCanManageTask(actor);
  await db.sequelize.transaction(async (transaction) => {
    const context = await resolveCallTaskAccessContext(tenant, {
      accountId: actor?.id,
      lock: true,
      transaction,
    });
    const task = await getTaskOrFail(id, context, {
      lock: transaction.LOCK.UPDATE,
      transaction,
    });

    const mutableFields = [
      'assignedToAccountId',
      'description',
      'dueAt',
      'scriptText',
      'scopeType',
      'status',
      'title',
    ];
    const requestedFields = mutableFields.filter((field) => field in data);
    const requestedNonStatusFields = requestedFields.filter(
      (field) => field !== 'status',
    );

    if (
      (task.status === 'archived' || task.status === 'done') &&
      requestedNonStatusFields.length > 0
    ) {
      throw appError(
        task.status === 'archived'
          ? 'Архивную задачу можно только восстановить'
          : 'Завершенную задачу можно только вернуть в работу или архивировать',
        409,
      );
    }

    const payload = {};
    if ('title' in data) {
      const title = normalizeText(data.title);
      if (!title || title.length < 2) {
        throw appError('Название задачи слишком короткое');
      }
      payload.title = title;
    }
    if ('description' in data) payload.description = normalizeText(data.description);
    if ('scriptText' in data) payload.scriptText = normalizeText(data.scriptText);
    if ('status' in data) payload.status = normalizeTaskStatus(data.status);
    if (
      task.status === 'archived' &&
      payload.status &&
      !['archived', 'backlog'].includes(payload.status)
    ) {
      throw appError('Архивную задачу можно вернуть только в бэклог', 409);
    }
    if (
      task.status === 'done' &&
      payload.status &&
      !['done', 'in_progress', 'archived'].includes(payload.status)
    ) {
      throw appError(
        'Завершенную задачу можно вернуть в работу или архивировать',
        409,
      );
    }
    if ('scopeType' in data) payload.scopeType = normalizeScopeType(data.scopeType);
    if ('dueAt' in data) {
      payload.dueAt = normalizeDateTime(data.dueAt, 'дедлайн задачи');
    }
    if ('assignedToAccountId' in data) {
      payload.assignedToAccountId = await normalizeAssigneeId(
        data.assignedToAccountId,
        context,
        transaction,
      );
    }

    await task.update(payload, { transaction });
  });
  return getOne(actor, id, tenant);
}

function parsePaging(query = {}) {
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const pageSize = Math.min(
    100,
    Math.max(10, Number.parseInt(query.pageSize, 10) || 25),
  );

  return {
    limit: pageSize,
    offset: (page - 1) * pageSize,
    page,
    pageSize,
  };
}

function getClientStatusWhere(status) {
  if (!status || status === 'all') return {};
  return { status: normalizeClientStatus(status) };
}

function mapTaskClient(row) {
  const raw = row.toJSON ? row.toJSON() : row;
  const client = raw.client;
  const attempts = raw.attempts || [];
  const mappedAttempts = attempts.map((attempt) => ({
    actor: mapAccount(attempt.actorAccount),
    createdAt: attempt.createdAt,
    deadlineAt: attempt.deadlineAt,
    id: attempt.id,
    status: attempt.status,
    summary: attempt.summary || '',
  }));

  return {
    client: client
      ? {
          id: client.id,
          name: client.name,
          phone: client.phone,
          status: client.status,
        }
      : null,
    clientName: raw.clientName,
    clientPhone: raw.clientPhone,
    contactedAt: raw.contactedAt,
    deadlineAt: raw.deadlineAt,
    id: raw.id,
    attempts: mappedAttempts,
    lastAttempt: mappedAttempts[0] || null,
    lastVisitAt: raw.lastVisitAt,
    source: raw.source,
    status: raw.status,
    summary: raw.summary || '',
    userId: raw.userId,
    visitCount: raw.visitCount,
  };
}

async function listTaskClients(actor, taskId, query = {}, tenant = null) {
  const context = await resolveCallTaskAccessContext(tenant, {
    accountId: actor?.id,
  });
  const task = await getTaskOrFail(taskId, context);
  assertCanWorkTask(actor, task);
  await syncDynamicTask(task, tenant, context);

  const paging = parsePaging(query);
  const where = {
    callTaskId: task.id,
    ...getClientStatusWhere(query.status),
  };
  if (query.overdue === 'true') {
    where.deadlineAt = { [Op.lt]: new Date() };
    where.status = { [Op.notIn]: Array.from(FINISHED_CLIENT_STATUSES) };
  }
  const q = String(query.q || '').trim();
  if (q) {
    where[Op.or] = [
      { clientName: { [Op.like]: `%${q}%` } },
      { clientPhone: { [Op.like]: `%${q}%` } },
    ];
  }

  const { rows, count } = await db.CallTaskClient.findAndCountAll({
    distinct: true,
    include: [
      {
        model: db.User,
        as: 'client',
        attributes: ['id', 'name', 'phone', 'status'],
      },
      {
        model: db.CallTaskAttempt,
        as: 'attempts',
        separate: true,
        limit: 5,
        order: [['createdAt', 'DESC']],
        include: [
          {
            model: db.Account,
            as: 'actorAccount',
            attributes: ['id', 'email', 'role', 'staffId'],
            include: accountTenantInclude(context),
          },
        ],
      },
    ],
    limit: paging.limit,
    offset: paging.offset,
    order: [
      [db.Sequelize.literal("CASE WHEN deadlineAt IS NULL THEN 1 ELSE 0 END"), 'ASC'],
      ['deadlineAt', 'ASC'],
      ['updatedAt', 'DESC'],
    ],
    where,
  });

  return {
    items: rows.map(mapTaskClient),
    page: paging.page,
    pageSize: paging.pageSize,
    total: count,
    totalPages: Math.max(1, Math.ceil(count / paging.pageSize)),
  };
}

async function addAttempt(actor, taskClientId, data = {}, tenant = null) {
  const updated = await db.sequelize.transaction(async (transaction) => {
    const context = await resolveCallTaskAccessContext(tenant, {
      accountId: actor?.id,
      lock: true,
      transaction,
    });
    const taskClient = await db.CallTaskClient.findOne({
      include: [
        {
          model: db.CallTask,
          as: 'callTask',
          include: taskInclude(context),
          required: true,
          where: callTaskTenantWhere(context),
        },
      ],
      lock: transaction.LOCK.UPDATE,
      transaction,
      where: { id: Number(taskClientId) },
    });
    if (!taskClient) throw appError('Клиент в задаче не найден', 404);
    assertCanWorkTask(actor, taskClient.callTask);
    if (taskClient.callTask.status === 'archived') {
      throw appError('Архивная задача доступна только для просмотра', 409);
    }
    if (taskClient.callTask.status === 'done') {
      throw appError('Завершенная задача доступна только для просмотра', 409);
    }

    const status = normalizeClientStatus(data.status || taskClient.status);
    const summary = normalizeText(data.summary);
    const deadlineAt = normalizeDateTime(data.deadlineAt, 'дедлайн клиента');
    const now = new Date();
    const trainingMarker = taskClient.isTraining
      ? {
          isTraining: true,
          trainingAccountId: taskClient.trainingAccountId || null,
          trainingRole: taskClient.trainingRole || null,
        }
      : await onboardingService.getTrainingDataMarker(actor);

    await db.CallTaskAttempt.create(
      {
        actorAccountId: actor?.id || null,
        callTaskClientId: taskClient.id,
        deadlineAt,
        status,
        summary,
        ...trainingMarker,
      },
      { transaction },
    );

    await taskClient.update(
      {
        contactedAt: status === 'new' ? taskClient.contactedAt : now,
        deadlineAt,
        status,
        summary,
      },
      { transaction },
    );
    return {
      callTaskId: Number(taskClient.callTaskId),
      id: Number(taskClient.id),
      status,
    };
  });

  await onboardingService.recordEventSafe(actor, 'call_task.attempt_logged', {
    entityId: updated.id,
    entityType: 'call_task_client',
    payload: {
      callTaskId: updated.callTaskId,
      status: updated.status,
      taskClientId: updated.id,
    },
  });

  const responseContext = await resolveCallTaskAccessContext(tenant, {
    accountId: actor?.id,
  });
  return mapTaskClient(
    await db.CallTaskClient.findOne({
      include: [
        {
          model: db.CallTask,
          as: 'callTask',
          attributes: ['id'],
          required: true,
          where: callTaskTenantWhere(responseContext),
        },
        {
          model: db.User,
          as: 'client',
          attributes: ['id', 'name', 'phone', 'status'],
        },
        {
          model: db.CallTaskAttempt,
          as: 'attempts',
          separate: true,
          limit: 5,
          order: [['createdAt', 'DESC']],
          include: [
            {
              model: db.Account,
              as: 'actorAccount',
              attributes: ['id', 'email', 'role', 'staffId'],
              include: accountTenantInclude(responseContext),
            },
          ],
        },
      ],
      where: { id: updated.id },
    }),
  );
}

function normalizeTaskClientIds(value) {
  const ids = Array.isArray(value) ? value : [];
  const normalized = Array.from(
    new Set(
      ids
        .map((id) => Number(id))
        .filter((id) => Number.isInteger(id) && id > 0),
    ),
  );

  if (normalized.length === 0) {
    throw appError('Выберите клиентов для массового действия');
  }
  if (normalized.length > 500) {
    throw appError('За один раз можно обновить не больше 500 клиентов');
  }

  return normalized;
}

async function bulkUpdateClients(actor, taskId, data = {}, tenant = null) {
  const taskClientIds = normalizeTaskClientIds(data.taskClientIds);
  const hasStatus = 'status' in data && data.status !== '' && data.status !== null;
  const hasDeadline = 'deadlineAt' in data;
  const hasSummary = 'summary' in data;
  if (!hasStatus && !hasDeadline && !hasSummary) {
    throw appError('Укажите, что нужно изменить');
  }

  const status = hasStatus ? normalizeClientStatus(data.status) : null;
  const deadlineAt = hasDeadline
    ? normalizeDateTime(data.deadlineAt, 'дедлайн клиентов')
    : undefined;
  const summary = hasSummary ? normalizeText(data.summary) : undefined;
  const now = new Date();

  const result = await db.sequelize.transaction(async (transaction) => {
    const context = await resolveCallTaskAccessContext(tenant, {
      accountId: actor?.id,
      lock: true,
      transaction,
    });
    const task = await getTaskOrFail(taskId, context, {
      lock: transaction.LOCK.UPDATE,
      transaction,
    });
    assertCanWorkTask(actor, task);
    if (task.status === 'archived') {
      throw appError('Архивная задача доступна только для просмотра', 409);
    }
    if (task.status === 'done') {
      throw appError('Завершенная задача доступна только для просмотра', 409);
    }
    const rows = await db.CallTaskClient.findAll({
      lock: transaction.LOCK.UPDATE,
      transaction,
      where: {
        callTaskId: task.id,
        id: { [Op.in]: taskClientIds },
      },
    });

    if (rows.length !== taskClientIds.length) {
      throw appError('Часть клиентов не найдена в этой задаче', 404);
    }

    for (const row of rows) {
      const nextStatus = status || row.status;
      const nextDeadlineAt = deadlineAt === undefined ? row.deadlineAt : deadlineAt;
      const nextSummary = summary === undefined ? row.summary : summary;
      const nextContactedAt =
        hasStatus && nextStatus !== 'new' ? now : row.contactedAt;

      await db.CallTaskAttempt.create(
        {
          actorAccountId: actor?.id || null,
          callTaskClientId: row.id,
          deadlineAt: nextDeadlineAt,
          status: nextStatus,
          summary: summary === undefined ? 'Массовое обновление' : summary,
        },
        { transaction },
      );

      await row.update(
        {
          contactedAt: nextContactedAt,
          deadlineAt: nextDeadlineAt,
          status: nextStatus,
          summary: nextSummary,
        },
        { transaction },
      );
    }

    return rows.length;
  });

  return {
    updatedCount: result,
  };
}

async function getReport(actor, query = {}, tenant = null) {
  const context = await resolveCallTaskAccessContext(tenant, {
    accountId: actor?.id,
  });
  const where = callTaskTenantWhere(context, buildTaskWhere(actor, query));
  where.isTraining = false;
  const createdFrom = normalizeDateTime(query.createdFrom, 'начало периода');
  const createdTo = normalizeDateTime(query.createdTo, 'конец периода');
  if (createdFrom || createdTo) {
    where.createdAt = {};
    if (createdFrom) where.createdAt[Op.gte] = createdFrom;
    if (createdTo) where.createdAt[Op.lte] = createdTo;
  }

  const tasks = await db.CallTask.findAll({
    attributes: ['id'],
    where,
    raw: true,
  });
  const taskIds = tasks.map((task) => Number(task.id));

  if (taskIds.length === 0) {
    return {
      attemptsCount: 0,
      counts: emptyCounts(),
      metrics: getTaskCompletionMetrics(emptyCounts(), 0, 0),
      overdueCount: 0,
      tasksCount: 0,
      totalClientCount: 0,
    };
  }

  const metricsByTask = await getTaskClientMetrics(taskIds);
  const counts = emptyCounts();
  let overdueCount = 0;
  let totalClientCount = 0;
  metricsByTask.forEach((metrics) => {
    totalClientCount += metrics.total;
    overdueCount += metrics.overdueCount;
    Object.keys(counts).forEach((key) => {
      counts[key] += Number(metrics.counts[key] || 0);
    });
  });

  const attemptsCount = await db.CallTaskAttempt.count({
    include: [
      {
        model: db.CallTaskClient,
        as: 'taskClient',
        required: true,
        where: { callTaskId: { [Op.in]: taskIds } },
      },
    ],
  });

  return {
    attemptsCount,
    counts,
    metrics: getTaskCompletionMetrics(counts, totalClientCount, overdueCount),
    overdueCount,
    tasksCount: taskIds.length,
    totalClientCount,
  };
}

async function sync(actor, id, tenant = null) {
  assertCanManageTask(actor);
  const context = await resolveCallTaskAccessContext(tenant, {
    accountId: actor?.id,
  });
  const task = await getTaskOrFail(id, context);
  const result = await syncDynamicTask(task, tenant, context);
  return {
    ...result,
    task: await getOne(actor, id, tenant),
  };
}

async function runDueRecurringTasks(now = new Date(), tenant = null, actor = null) {
  assertBackgroundComponentCanRun(BACKGROUND_COMPONENTS.CALL_TASKS_RECURRING);
  const requestContext = tenant
    ? await resolveCallTaskAccessContext(tenant, { accountId: actor?.id })
    : null;
  const bases = await db.ClientBase.findAll({
    where: callTaskTenantWhere(requestContext, {
      recurringEnabled: true,
      recurringNextRunAt: { [Op.lte]: now },
      status: 'active',
    }),
    order: [['recurringNextRunAt', 'ASC']],
  });
  const results = [];

  for (const base of bases) {
    try {
      const result = await db.sequelize.transaction(async (transaction) => {
        const storedContext = requestContext
          ? await resolveCallTaskAccessContext(tenant, {
              accountId: actor?.id,
              lock: true,
              transaction,
            })
          : await resolveStoredCallTaskContext(base, {
              lock: true,
              transaction,
            });
        const lockedBase = await db.ClientBase.findOne({
          lock: transaction.LOCK.UPDATE,
          transaction,
          where: callTaskTenantWhere(storedContext, { id: base.id }, { force: true }),
        });
        if (
          !lockedBase ||
          lockedBase.status !== 'active' ||
          !lockedBase.recurringEnabled ||
          !lockedBase.recurringNextRunAt ||
          lockedBase.recurringNextRunAt > now
        ) {
          return null;
        }

        const nextRunAt = computeNextRecurringRunAt(
          lockedBase,
          new Date(now.getTime() + 1000),
        );
        const dueAt =
          lockedBase.recurringDueDays === null ||
          lockedBase.recurringDueDays === undefined
            ? null
            : addDays(now, Number(lockedBase.recurringDueDays));
        const assignedToAccountId = await resolveRecurringAssigneeId(
          lockedBase.recurringAssignedToAccountId,
          storedContext,
          transaction,
        );
        if (lockedBase.recurringAssignedToAccountId && !assignedToAccountId) {
          await lockedBase.update(
            { recurringAssignedToAccountId: null },
            { transaction },
          );
        }
        const clients = await getBaseSnapshotClients(lockedBase, {
          context: storedContext,
          tenant,
        });

        if (clients.length === 0) {
          await lockedBase.update(
            {
              lastCalculatedAt: now,
              lastTaskClientCount: 0,
              recurringLastRunAt: now,
              recurringNextRunAt: nextRunAt,
            },
            { transaction },
          );
          return {
            baseId: lockedBase.id,
            clientCount: 0,
            created: false,
            reason: 'empty',
          };
        }

        const task = await createTaskForBase({
          actor: null,
          base: lockedBase,
          clients,
          context: storedContext,
          data: {
            assignedToAccountId,
            description: lockedBase.recurringDescription,
            dueAt,
            scopeType: lockedBase.recurringScopeType || 'snapshot',
            title:
              lockedBase.recurringTitle ||
              `${lockedBase.name}: обзвон ${formatDateForTitle(now)}`,
          },
          tenant,
          transaction,
        });
        await lockedBase.update(
          {
            recurringLastRunAt: now,
            recurringNextRunAt: nextRunAt,
          },
          { transaction },
        );

        return {
          baseId: lockedBase.id,
          clientCount: clients.length,
          created: true,
          taskId: task.id,
        };
      });

      if (result) results.push(result);
    } catch (error) {
      results.push({
        baseId: base.id,
        created: false,
        error: error.message,
      });
    }
  }

  return {
    processed: results.length,
    results,
  };
}

async function removeArchived(actor, id, tenant = null) {
  assertCanManageTask(actor);
  await db.sequelize.transaction(async (transaction) => {
    const context = await resolveCallTaskAccessContext(tenant, {
      accountId: actor?.id,
      lock: true,
      transaction,
    });
    const task = await getTaskOrFail(id, context, {
      lock: transaction.LOCK.UPDATE,
      transaction,
    });
    if (task.status !== 'archived') {
      throw appError('Удалять безвозвратно можно только задачи из архива', 409);
    }

    const taskClients = await db.CallTaskClient.findAll({
      attributes: ['id', 'status', 'summary', 'contactedAt'],
      transaction,
      where: { callTaskId: task.id },
    });
    const clientIds = taskClients.map((client) => client.id);
    const [attemptsCount, linkedCallsCount] = await Promise.all([
      clientIds.length === 0
        ? 0
        : db.CallTaskAttempt.count({
            transaction,
            where: {
              callTaskClientId: {
                [Op.in]: clientIds,
              },
            },
          }),
      db.TelephonyCall.count({
        transaction,
        where: callTaskTenantWhere(
          context,
          { followUpCallTaskId: task.id },
          { force: true },
        ),
      }),
    ]);
    const hasCallHistory =
      attemptsCount > 0 ||
      linkedCallsCount > 0 ||
      taskClients.some(
        (client) =>
          client.status !== 'new' ||
          Boolean(String(client.summary || '').trim()) ||
          Boolean(client.contactedAt),
      );

    if (hasCallHistory) {
      throw appError(
        'Задачу нельзя удалить безвозвратно: по ней уже есть история обзвона. Оставьте ее в архиве.',
        409,
      );
    }

    await task.destroy({ transaction });
  });
  return { success: true };
}

module.exports = {
  addAttempt,
  bulkUpdateClients,
  createForClient,
  createFromBase,
  getOne,
  getReport,
  list,
  listTaskClients,
  removeArchived,
  runDueRecurringTasks,
  sync,
  update,
};
