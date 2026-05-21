const { Op } = require('sequelize');
const db = require('../../models');
const clientsService = require('./clients.service');

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

async function normalizeAssigneeId(assignedToAccountId, transaction = undefined) {
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

  const assignee = await db.Account.findByPk(accountId, { transaction });
  if (!assignee || assignee.status !== 'active') {
    throw appError('Исполнитель не найден или отключен', 404);
  }
  if (!WORKER_ROLES.has(assignee.role)) {
    throw appError('У этого пользователя нет доступа к задачам обзвона', 409);
  }

  return accountId;
}

async function resolveRecurringAssigneeId(accountId, transaction) {
  if (!accountId) return null;

  const assignee = await db.Account.findByPk(accountId, { transaction });
  if (!assignee || assignee.status !== 'active' || !WORKER_ROLES.has(assignee.role)) {
    return null;
  }

  return Number(accountId);
}

function taskInclude() {
  return [
    {
      model: db.ClientBase,
      as: 'clientBase',
      attributes: ['id', 'name', 'filters', 'status'],
    },
    {
      model: db.Account,
      as: 'assignedToAccount',
      attributes: ['id', 'email', 'role', 'staffId'],
      include: [{ model: db.Staff, attributes: ['id', 'name'] }],
    },
    {
      model: db.Account,
      as: 'createdByAccount',
      attributes: ['id', 'email', 'role', 'staffId'],
      include: [{ model: db.Staff, attributes: ['id', 'name'] }],
    },
  ];
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

async function countCurrentBaseClients(task) {
  const raw = task.toJSON ? task.toJSON() : task;
  const filters = parseFilters(raw.clientBase?.filters);
  return clientsService.countClients(filters);
}

async function mapTask(task, metricsByTask = new Map()) {
  const raw = task.toJSON ? task.toJSON() : task;
  const metrics = metricsByTask.get(raw.id) || {
    counts: emptyCounts(),
    overdueCount: 0,
    total: raw.snapshotClientCount || 0,
  };
  const currentBaseClientCount = raw.clientBase
    ? await countCurrentBaseClients(raw)
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
    newInBaseCount:
      currentBaseClientCount === null
        ? null
        : Math.max(0, currentBaseClientCount - metrics.total),
    overdueCount: metrics.overdueCount,
    scopeType: raw.scopeType,
    snapshotClientCount: raw.snapshotClientCount,
    status: raw.status,
    title: raw.title,
    totalClientCount: metrics.total,
    updatedAt: raw.updatedAt,
  };
}

async function getTaskOrFail(id) {
  const task = await db.CallTask.findByPk(Number(id), { include: taskInclude() });
  if (!task) throw appError('Задача обзвона не найдена', 404);
  return task;
}

async function getBaseOrFail(id) {
  const base = await db.ClientBase.findByPk(Number(id));
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
  const filters = parseFilters(base.filters);
  const clients = await clientsService.listClientsForSnapshot(filters, {
    limit: options.limit || 20000,
  });
  const total = await clientsService.countClients(filters);

  if (clients.length < total) {
    throw appError(
      `В базе ${total} клиентов. Сузьте фильтр до 20 000 клиентов для одного обзвона`,
      409,
    );
  }

  return clients;
}

async function syncDynamicTask(task) {
  const raw = task.toJSON ? task.toJSON() : task;
  const emptyResult = {
    addedCount: 0,
    keptRemovedCount: 0,
    removedCount: 0,
    updatedCount: 0,
  };
  if (raw.scopeType !== 'dynamic' || !raw.clientBase) return emptyResult;
  if (raw.status === 'archived' || raw.status === 'done') return emptyResult;
  if (raw.clientBase.status !== 'active') return emptyResult;

  return db.sequelize.transaction(async (transaction) => {
    const currentClients = await getBaseSnapshotClients(raw.clientBase);
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
          deadlineAt: raw.dueAt || null,
          status: 'new',
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
    await task.update(
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

async function getTaskMembershipDiff(task) {
  const raw = task.toJSON ? task.toJSON() : task;
  if (!raw.clientBase || raw.clientBase.status !== 'active') {
    return null;
  }

  const currentClients = await getBaseSnapshotClients(raw.clientBase);
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
  data = {},
  transaction,
}) {
  const now = new Date();
  const snapshotClients = clients || (await getBaseSnapshotClients(base));
  const title =
    normalizeText(data.title) ||
    `${base.name}: обзвон ${formatDateForTitle(now)}`;
  const dueAt = normalizeDateTime(data.dueAt, 'дедлайн задачи');
  const scopeType = normalizeScopeType(data.scopeType);
  const assignedToAccountId = await normalizeAssigneeId(
    data.assignedToAccountId,
    transaction,
  );

  const createdTask = await db.CallTask.create(
    {
      assignedToAccountId,
      clientBaseId: base.id,
      createdByAccountId: actor?.id || null,
      description: normalizeText(data.description),
      dueAt,
      scopeType,
      snapshotClientCount: snapshotClients.length,
      status: 'backlog',
      title,
    },
    { transaction },
  );

  if (snapshotClients.length > 0) {
    await db.CallTaskClient.bulkCreate(
      snapshotClients.map((client) => ({
        ...mapSnapshotClient(client),
        callTaskId: createdTask.id,
        deadlineAt: dueAt,
        status: 'new',
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

async function list(actor, query = {}) {
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

  const tasks = await db.CallTask.findAll({
    where,
    include: taskInclude(),
    order: [
      [db.Sequelize.literal("CASE WHEN `CallTask`.`status` = 'in_progress' THEN 0 WHEN `CallTask`.`status` = 'backlog' THEN 1 WHEN `CallTask`.`status` = 'done' THEN 2 ELSE 3 END"), 'ASC'],
      ['dueAt', 'ASC'],
      ['createdAt', 'DESC'],
    ],
  });

  await Promise.all(
    tasks
      .filter((task) => task.scopeType === 'dynamic')
      .map((task) => syncDynamicTask(task)),
  );

  const syncedTasks = await db.CallTask.findAll({
    where,
    include: taskInclude(),
    order: [
      [db.Sequelize.literal("CASE WHEN `CallTask`.`status` = 'in_progress' THEN 0 WHEN `CallTask`.`status` = 'backlog' THEN 1 WHEN `CallTask`.`status` = 'done' THEN 2 ELSE 3 END"), 'ASC'],
      ['dueAt', 'ASC'],
      ['createdAt', 'DESC'],
    ],
  });
  const metricsByTask = await getTaskClientMetrics(
    syncedTasks.map((task) => task.id),
  );

  return Promise.all(syncedTasks.map((task) => mapTask(task, metricsByTask)));
}

async function createFromBase(actor, baseId, data = {}) {
  assertCanManageTask(actor);

  const base = await getBaseOrFail(baseId);
  if (base.status !== 'active') {
    throw appError('Нельзя создать обзвон из архивной базы', 409);
  }

  const task = await db.sequelize.transaction(async (transaction) => {
    return createTaskForBase({ actor, base, data, transaction });
  });

  return getOne(actor, task.id);
}

async function getOne(actor, id) {
  const task = await getTaskOrFail(id);
  assertCanWorkTask(actor, task);
  await syncDynamicTask(task);

  const metricsByTask = await getTaskClientMetrics([task.id]);
  const freshTask = await getTaskOrFail(id);
  const mapped = await mapTask(freshTask, metricsByTask);
  mapped.membershipDiff = await getTaskMembershipDiff(freshTask);
  return mapped;
}

async function update(actor, id, data = {}) {
  const task = await getTaskOrFail(id);
  assertCanManageTask(actor);

  const mutableFields = [
    'assignedToAccountId',
    'description',
    'dueAt',
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
    throw appError('Завершенную задачу можно вернуть в работу или архивировать', 409);
  }
  if ('scopeType' in data) payload.scopeType = normalizeScopeType(data.scopeType);
  if ('dueAt' in data) payload.dueAt = normalizeDateTime(data.dueAt, 'дедлайн задачи');
  if ('assignedToAccountId' in data) {
    payload.assignedToAccountId = await normalizeAssigneeId(
      data.assignedToAccountId,
    );
  }

  await task.update(payload);
  return getOne(actor, id);
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

async function listTaskClients(actor, taskId, query = {}) {
  const task = await getTaskOrFail(taskId);
  assertCanWorkTask(actor, task);
  await syncDynamicTask(task);

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
            include: [{ model: db.Staff, attributes: ['id', 'name'] }],
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

async function addAttempt(actor, taskClientId, data = {}) {
  const taskClient = await db.CallTaskClient.findByPk(Number(taskClientId), {
    include: [{ model: db.CallTask, as: 'callTask', include: taskInclude() }],
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

  await db.sequelize.transaction(async (transaction) => {
    await db.CallTaskAttempt.create(
      {
        actorAccountId: actor?.id || null,
        callTaskClientId: taskClient.id,
        deadlineAt,
        status,
        summary,
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
  });

  return mapTaskClient(
    await db.CallTaskClient.findByPk(taskClient.id, {
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
              include: [{ model: db.Staff, attributes: ['id', 'name'] }],
            },
          ],
        },
      ],
    }),
  );
}

async function sync(actor, id) {
  const task = await getTaskOrFail(id);
  assertCanManageTask(actor);
  const result = await syncDynamicTask(task);
  return {
    ...result,
    task: await getOne(actor, id),
  };
}

async function runDueRecurringTasks(now = new Date()) {
  const bases = await db.ClientBase.findAll({
    where: {
      recurringEnabled: true,
      recurringNextRunAt: { [Op.lte]: now },
      status: 'active',
    },
    order: [['recurringNextRunAt', 'ASC']],
  });
  const results = [];

  for (const base of bases) {
    try {
      const result = await db.sequelize.transaction(async (transaction) => {
        const lockedBase = await db.ClientBase.findByPk(base.id, {
          lock: transaction.LOCK.UPDATE,
          transaction,
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
          transaction,
        );
        if (lockedBase.recurringAssignedToAccountId && !assignedToAccountId) {
          await lockedBase.update(
            { recurringAssignedToAccountId: null },
            { transaction },
          );
        }
        const clients = await getBaseSnapshotClients(lockedBase);

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
          data: {
            assignedToAccountId,
            description: lockedBase.recurringDescription,
            dueAt,
            scopeType: lockedBase.recurringScopeType || 'snapshot',
            title:
              lockedBase.recurringTitle ||
              `${lockedBase.name}: обзвон ${formatDateForTitle(now)}`,
          },
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

async function removeArchived(actor, id) {
  const task = await getTaskOrFail(id);
  assertCanManageTask(actor);
  if (task.status !== 'archived') {
    throw appError('Удалять безвозвратно можно только задачи из архива', 409);
  }

  await task.destroy();
  return { success: true };
}

module.exports = {
  addAttempt,
  createFromBase,
  getOne,
  list,
  listTaskClients,
  removeArchived,
  runDueRecurringTasks,
  sync,
  update,
};
