const db = require('../../models');
const { ACCOUNT_ROLES, ACCOUNT_ROLE_VALUES } = require('../constants/account-roles');
const {
  findOnboardingTask,
  getOnboardingPath,
  getOnboardingRoleOptions,
  listOnboardingPaths,
  ONBOARDING_CLIENT_CHECKPOINT_EVENTS,
} = require('../onboarding/catalog');

const TRAINING_DATA_ENTITIES = [
  { key: 'clients', label: 'Клиенты', modelName: 'User' },
  { key: 'visits', label: 'Визиты', modelName: 'Visit' },
  { key: 'bookings', label: 'Брони', modelName: 'Booking' },
  { key: 'bookingSeries', label: 'Серии броней', modelName: 'BookingSeries' },
  { key: 'finances', label: 'Финансовые операции', modelName: 'Finance' },
  { key: 'clientBases', label: 'Клиентские базы', modelName: 'ClientBase' },
  { key: 'callTasks', label: 'Задачи обзвона', modelName: 'CallTask' },
  { key: 'callTaskClients', label: 'Клиенты в обзвонах', modelName: 'CallTaskClient' },
  { key: 'callTaskAttempts', label: 'Попытки звонков', modelName: 'CallTaskAttempt' },
  { key: 'trainingNotes', label: 'Тренерские заметки', modelName: 'TrainingNote' },
  {
    key: 'onboardingEvents',
    label: 'События обучения',
    modelName: 'OnboardingEvent',
    roleField: 'role',
  },
];

function appError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function normalizeRole(role) {
  if (!ACCOUNT_ROLE_VALUES.includes(role)) {
    throw appError('Неизвестная роль обучения');
  }

  return role;
}

function assertActor(actor) {
  if (!actor?.id || !actor.role) {
    throw appError('Unauthorized', 401);
  }
}

function assertOwner(
  actor,
  message = 'Учебными данными может управлять только владелец',
) {
  assertActor(actor);
  if (actor.role !== 'owner') {
    throw appError(message, 403);
  }
}

function resolveTargetRole(actor, requestedRole) {
  assertActor(actor);

  const targetRole = normalizeRole(requestedRole || actor.role);
  if (actor.role !== 'owner' && targetRole !== actor.role) {
    throw appError('Проходить обучение за другую роль может только владелец', 403);
  }

  return targetRole;
}

function resolveOptionalTrainingRole(role) {
  if (!role) return null;
  return normalizeRole(role);
}

function getTrainingEntityWhere(entity, role) {
  const where = { isTraining: true };
  if (role) {
    where[entity.roleField || 'trainingRole'] = role;
  }
  return where;
}

async function listTrainingIds(model, where, transaction) {
  if (!model) return [];
  const rows = await model.findAll({
    attributes: ['id'],
    raw: true,
    transaction,
    where,
  });

  return rows.map((row) => Number(row.id)).filter(Boolean);
}

async function destroyTrainingRows(model, where, transaction) {
  if (!model) return 0;
  return model.destroy({ transaction, where });
}

function getAvailableRoles(actor) {
  assertActor(actor);

  const roleOptions = getOnboardingRoleOptions();
  if (actor.role === 'owner') {
    return roleOptions.map((role) => ({
      ...role,
      isCurrent: role.value === actor.role,
      isSelectable: true,
    }));
  }

  return roleOptions
    .filter((role) => role.value === actor.role)
    .map((role) => ({
      ...role,
      isCurrent: true,
      isSelectable: true,
    }));
}

function serializeDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  return new Date(value).toISOString();
}

function normalizeId(value) {
  const id = Number(value);
  return Number.isFinite(id) && id > 0 ? id : null;
}

function getPlainProgress(row) {
  if (!row) return null;
  return typeof row.get === 'function' ? row.get({ plain: true }) : row;
}

function getNestedValue(source, path) {
  return String(path)
    .split('.')
    .reduce((value, part) => (value == null ? undefined : value[part]), source);
}

function matchesCheckpointConditions(checkpoint = {}, payload = {}) {
  const conditions = checkpoint.conditions || {};

  return Object.entries(conditions).every(([key, expected]) => {
    const actual = getNestedValue(payload, key);
    if (Array.isArray(expected)) return expected.includes(actual);
    return actual === expected;
  });
}

function listMatchingTasks(role, eventKey, payload = {}) {
  const path = getOnboardingPath(role);
  if (!path) return [];

  return path.missions.flatMap((mission) =>
    mission.tasks.filter(
      (task) =>
        task.checkpoint?.event === eventKey &&
        matchesCheckpointConditions(task.checkpoint, payload),
    ),
  );
}

function normalizeClientEventKey(eventKey) {
  if (!ONBOARDING_CLIENT_CHECKPOINT_EVENTS.includes(eventKey)) {
    throw appError('Это событие обучения нельзя записывать из клиента');
  }

  return eventKey;
}

async function upsertCompletedProgress(actor, role, taskKey, metadata = {}) {
  const where = {
    accountId: actor.id,
    role,
    taskKey,
  };
  const payload = {
    completedAt: new Date(),
    metadata,
    status: 'completed',
  };
  const existing = await db.OnboardingProgress.findOne({ where });
  if (existing) {
    await existing.update(payload);
  } else {
    await db.OnboardingProgress.create({
      ...where,
      ...payload,
    });
  }
}

function buildProgressMap(progressRows = []) {
  const progressByTaskKey = new Map();

  for (const row of progressRows) {
    const progress = getPlainProgress(row);
    if (progress?.taskKey) {
      progressByTaskKey.set(progress.taskKey, progress);
    }
  }

  return progressByTaskKey;
}

function buildSkillSummary(path, progressByTaskKey) {
  const skillMap = new Map();

  for (const mission of path.missions) {
    for (const task of mission.tasks) {
      const isCompleted = progressByTaskKey.get(task.key)?.status === 'completed';

      for (const skill of task.skills || []) {
        const current = skillMap.get(skill) || {
          completedTasks: 0,
          earnedXp: 0,
          name: skill,
          percent: 0,
          totalTasks: 0,
          totalXp: 0,
        };

        current.totalTasks += 1;
        current.totalXp += task.rewardXp || 0;
        if (isCompleted) {
          current.completedTasks += 1;
          current.earnedXp += task.rewardXp || 0;
        }
        current.percent =
          current.totalTasks > 0
            ? Math.round((current.completedTasks / current.totalTasks) * 100)
            : 0;

        skillMap.set(skill, current);
      }
    }
  }

  return Array.from(skillMap.values());
}

function decorateTask(task, progress, nextTaskKey) {
  const status = progress?.status || 'not_started';

  return {
    ...task,
    progress: {
      completedAt: serializeDate(progress?.completedAt),
      isCompleted: status === 'completed',
      isNext: task.key === nextTaskKey,
      status,
    },
  };
}

function buildOnboardingResponse(actor, targetRole, progressRows = []) {
  const path = getOnboardingPath(targetRole);
  if (!path) {
    throw appError('Для этой роли пока нет обучения', 404);
  }

  const progressByTaskKey = buildProgressMap(progressRows);
  const taskKeys = path.missions.flatMap((mission) =>
    mission.tasks.map((task) => task.key),
  );
  const completedTaskKeys = taskKeys.filter(
    (taskKey) => progressByTaskKey.get(taskKey)?.status === 'completed',
  );
  const nextTaskKey = taskKeys.find(
    (taskKey) => progressByTaskKey.get(taskKey)?.status !== 'completed',
  ) || null;
  const totalTasks = taskKeys.length;
  const completedTasks = completedTaskKeys.length;
  const totalXp = path.missions.reduce(
    (sum, mission) =>
      sum + mission.tasks.reduce((taskSum, task) => taskSum + (task.rewardXp || 0), 0),
    0,
  );
  const earnedXp = path.missions.reduce(
    (sum, mission) =>
      sum +
      mission.tasks.reduce((taskSum, task) => {
        const isCompleted = progressByTaskKey.get(task.key)?.status === 'completed';
        return taskSum + (isCompleted ? task.rewardXp || 0 : 0);
      }, 0),
    0,
  );

  return {
    availableRoles: getAvailableRoles(actor),
    ownerRoleOverrideEnabled: actor.role === 'owner',
    path: {
      ...path,
      missions: path.missions.map((mission) => ({
        ...mission,
        tasks: mission.tasks.map((task) =>
          decorateTask(task, progressByTaskKey.get(task.key), nextTaskKey),
        ),
      })),
    },
    selectedRole: targetRole,
    summary: {
      completedTaskKeys,
      completedTasks,
      earnedXp,
      nextTaskKey,
      percent: totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0,
      skills: buildSkillSummary(path, progressByTaskKey),
      totalTasks,
      totalXp,
    },
  };
}

function serializeTrainingMode(row, fallbackRole) {
  const mode = getPlainProgress(row);
  const role = mode?.role || fallbackRole;

  return {
    disabledAt: serializeDate(mode?.disabledAt),
    enabledAt: serializeDate(mode?.enabledAt),
    isEnabled: Boolean(mode?.isEnabled),
    role,
  };
}

async function getProgressRows(accountId, role) {
  return db.OnboardingProgress.findAll({
    order: [['updatedAt', 'DESC']],
    where: {
      accountId,
      role,
    },
  });
}

async function getTrainingMode(actor) {
  assertActor(actor);

  const mode = await db.OnboardingTrainingMode.findOne({
    where: { accountId: actor.id },
  });

  return serializeTrainingMode(mode, actor.role);
}

async function getEventTargetContext(actor) {
  assertActor(actor);

  const mode = await db.OnboardingTrainingMode.findOne({
    where: { accountId: actor.id },
  });
  const plainMode = getPlainProgress(mode);
  const requestedRole =
    plainMode?.isEnabled && plainMode.role ? plainMode.role : actor.role;

  return {
    isTraining: Boolean(plainMode?.isEnabled),
    role: resolveTargetRole(actor, requestedRole),
  };
}

async function getTrainingDataMarker(actor) {
  if (!actor?.id || !actor.role) {
    return {
      isTraining: false,
      trainingAccountId: null,
      trainingRole: null,
    };
  }

  const context = await getEventTargetContext(actor);
  if (!context.isTraining) {
    return {
      isTraining: false,
      trainingAccountId: null,
      trainingRole: null,
    };
  }

  return {
    isTraining: true,
    trainingAccountId: actor.id,
    trainingRole: context.role,
  };
}

async function getTrainingDataSummary(actor, query = {}) {
  assertOwner(actor);
  const role = resolveOptionalTrainingRole(query.role);

  const entities = await Promise.all(
    TRAINING_DATA_ENTITIES.map(async (entity) => {
      const model = db[entity.modelName];
      const count = model
        ? await model.count({ where: getTrainingEntityWhere(entity, role) })
        : 0;

      return {
        count,
        key: entity.key,
        label: entity.label,
      };
    }),
  );
  const totalRecords = entities.reduce((sum, entity) => sum + entity.count, 0);

  return {
    entities,
    hasRecords: totalRecords > 0,
    role,
    totalRecords,
  };
}

function getCompletedPercent(completed, total) {
  if (total <= 0) return 0;
  return Math.round((completed / total) * 100);
}

function getMaxDate(values) {
  const timestamps = values
    .map((value) => (value ? new Date(value).getTime() : NaN))
    .filter((value) => Number.isFinite(value));

  if (timestamps.length === 0) return null;
  return new Date(Math.max(...timestamps));
}

async function getOnboardingMetrics(actor) {
  assertOwner(actor, 'Метрики обучения доступны только владельцу');

  const [accounts, progressRows] = await Promise.all([
    db.Account.findAll({
      attributes: ['id', 'role', 'status'],
      raw: true,
      where: { status: 'active' },
    }),
    db.OnboardingProgress.findAll({
      attributes: ['accountId', 'completedAt', 'role', 'status', 'taskKey'],
      raw: true,
      where: { status: 'completed' },
    }),
  ]);
  const activeAccountIds = new Set();
  const activeAccountsByRole = new Map();

  for (const account of accounts) {
    const accountId = normalizeId(account.id);
    if (!accountId || !ACCOUNT_ROLE_VALUES.includes(account.role)) continue;

    activeAccountIds.add(accountId);
    const roleAccounts = activeAccountsByRole.get(account.role) || new Set();
    roleAccounts.add(accountId);
    activeAccountsByRole.set(account.role, roleAccounts);
  }

  const roles = listOnboardingPaths().map((path) => {
    const tasks = path.missions.flatMap((mission) => mission.tasks);
    const taskKeys = new Set(tasks.map((task) => task.key));
    const nativeAccountIds = activeAccountsByRole.get(path.role) || new Set();
    const participantIds = new Set(nativeAccountIds);
    const completedByAccount = new Map();
    const completedByTask = new Map();
    const completedDates = [];

    for (const progress of progressRows) {
      const accountId = normalizeId(progress.accountId);
      if (
        !accountId ||
        !activeAccountIds.has(accountId) ||
        progress.role !== path.role ||
        !taskKeys.has(progress.taskKey)
      ) {
        continue;
      }

      participantIds.add(accountId);
      completedDates.push(progress.completedAt);

      const accountTasks = completedByAccount.get(accountId) || new Set();
      accountTasks.add(progress.taskKey);
      completedByAccount.set(accountId, accountTasks);

      const taskAccounts = completedByTask.get(progress.taskKey) || new Set();
      taskAccounts.add(accountId);
      completedByTask.set(progress.taskKey, taskAccounts);
    }

    const participantCount = participantIds.size;
    const totalTaskSlots = participantCount * tasks.length;
    const completedTaskSlots = Array.from(completedByAccount.values()).reduce(
      (sum, taskSet) => sum + taskSet.size,
      0,
    );
    const startedAccounts = Array.from(participantIds).filter(
      (accountId) => (completedByAccount.get(accountId)?.size || 0) > 0,
    ).length;
    const completedAccounts = Array.from(participantIds).filter(
      (accountId) => (completedByAccount.get(accountId)?.size || 0) >= tasks.length,
    ).length;
    const percentByAccount =
      participantCount > 0
        ? Array.from(participantIds).reduce((sum, accountId) => {
            const completed = completedByAccount.get(accountId)?.size || 0;
            return sum + getCompletedPercent(completed, tasks.length);
          }, 0) / participantCount
        : 0;

    return {
      averageAccountPercent: Math.round(percentByAccount),
      completedAccounts,
      completedTaskSlots,
      label: ACCOUNT_ROLES[path.role]?.label || path.role,
      lastCompletedAt: serializeDate(getMaxDate(completedDates)),
      nativeAccounts: nativeAccountIds.size,
      percent: getCompletedPercent(completedTaskSlots, totalTaskSlots),
      role: path.role,
      startedAccounts,
      taskCount: tasks.length,
      tasks: tasks.map((task) => {
        const completedAccountsForTask = completedByTask.get(task.key)?.size || 0;
        return {
          completedAccounts: completedAccountsForTask,
          key: task.key,
          percent: getCompletedPercent(completedAccountsForTask, participantCount),
          title: task.title,
        };
      }),
      totalAccounts: participantCount,
      totalTaskSlots,
      trainingRecommendedTasks: tasks.filter(
        (task) => task.trainingMode?.recommended,
      ).length,
    };
  });
  const totalTaskSlots = roles.reduce((sum, role) => sum + role.totalTaskSlots, 0);
  const completedTaskSlots = roles.reduce(
    (sum, role) => sum + role.completedTaskSlots,
    0,
  );

  return {
    generatedAt: new Date().toISOString(),
    roles,
    summary: {
      activeAccounts: activeAccountIds.size,
      completedAccounts: roles.reduce(
        (sum, role) => sum + role.completedAccounts,
        0,
      ),
      completedTaskSlots,
      percent: getCompletedPercent(completedTaskSlots, totalTaskSlots),
      roles: roles.length,
      startedAccounts: roles.reduce((sum, role) => sum + role.startedAccounts, 0),
      totalTaskSlots,
    },
  };
}

async function cleanupTrainingData(actor, query = {}) {
  assertOwner(actor);
  const role = resolveOptionalTrainingRole(query.role);
  const deleted = {};

  await db.sequelize.transaction(async (transaction) => {
    const bookingWhere = getTrainingEntityWhere(
      { modelName: 'Booking' },
      role,
    );
    const visitWhere = getTrainingEntityWhere({ modelName: 'Visit' }, role);

    const [bookingIds, visitIds] = await Promise.all([
      listTrainingIds(db.Booking, bookingWhere, transaction),
      listTrainingIds(db.Visit, visitWhere, transaction),
    ]);

    if (bookingIds.length > 0 && db.BookingChangeLog) {
      deleted.bookingChangeLogs = await db.BookingChangeLog.destroy({
        transaction,
        where: { bookingId: { [db.Sequelize.Op.in]: bookingIds } },
      });
    } else {
      deleted.bookingChangeLogs = 0;
    }

    if (visitIds.length > 0 && db.VisitCategoryAssignment) {
      deleted.visitCategoryAssignments = await db.VisitCategoryAssignment.destroy({
        transaction,
        where: { visitId: { [db.Sequelize.Op.in]: visitIds } },
      });
    } else {
      deleted.visitCategoryAssignments = 0;
    }

    const deletionOrder = [
      { key: 'onboardingEvents', modelName: 'OnboardingEvent', roleField: 'role' },
      { key: 'callTaskAttempts', modelName: 'CallTaskAttempt' },
      { key: 'callTaskClients', modelName: 'CallTaskClient' },
      { key: 'callTasks', modelName: 'CallTask' },
      { key: 'clientBases', modelName: 'ClientBase' },
      { key: 'trainingNotes', modelName: 'TrainingNote' },
      { key: 'bookings', modelName: 'Booking' },
      { key: 'bookingSeries', modelName: 'BookingSeries' },
      { key: 'finances', modelName: 'Finance' },
      { key: 'visits', modelName: 'Visit' },
      { key: 'clients', modelName: 'User' },
    ];

    for (const entity of deletionOrder) {
      deleted[entity.key] = await destroyTrainingRows(
        db[entity.modelName],
        getTrainingEntityWhere(entity, role),
        transaction,
      );
    }
  });

  return {
    deleted,
    remaining: await getTrainingDataSummary(actor, { role }),
    role,
  };
}

async function setTrainingMode(actor, body = {}) {
  assertActor(actor);

  const isEnabled = Boolean(body.isEnabled);
  const targetRole = resolveTargetRole(actor, body.role || actor.role);
  const now = new Date();
  const payload = {
    disabledAt: isEnabled ? null : now,
    enabledAt: isEnabled ? now : null,
    isEnabled,
    metadata: body.metadata || null,
    role: targetRole,
  };
  const where = { accountId: actor.id };
  const existing = await db.OnboardingTrainingMode.findOne({ where });

  if (existing) {
    await existing.update(payload);
  } else {
    await db.OnboardingTrainingMode.create({
      ...where,
      ...payload,
    });
  }

  return getTrainingMode(actor);
}

async function getOverview(actor, query = {}) {
  const targetRole = resolveTargetRole(actor, query.role);
  const progressRows = await getProgressRows(actor.id, targetRole);
  return buildOnboardingResponse(actor, targetRole, progressRows);
}

async function completeTask(actor, taskKey, body = {}) {
  const targetRole = resolveTargetRole(actor, body.role);
  const taskMatch = findOnboardingTask(targetRole, taskKey);
  if (!taskMatch) {
    throw appError('Задание обучения не найдено', 404);
  }

  await upsertCompletedProgress(actor, targetRole, taskKey, body.metadata || null);

  return getOverview(actor, { role: targetRole });
}

async function recordEventForTarget(actor, target, eventKey, options = {}) {
  const payload = options.payload || {};
  const matchingTasks = listMatchingTasks(target.role, eventKey, payload);
  const completedTaskKeys = [];

  for (const task of matchingTasks) {
    await upsertCompletedProgress(actor, target.role, task.key, {
      checkpointEvent: eventKey,
      entityId: options.entityId || null,
      entityType: options.entityType || null,
      isTraining: target.isTraining,
      payload,
      source: 'event',
    });
    completedTaskKeys.push(task.key);
  }

  const event = await db.OnboardingEvent.create({
    accountId: actor.id,
    completedTaskKeys,
    entityId: options.entityId == null ? null : String(options.entityId),
    entityType: options.entityType || null,
    eventKey,
    isTraining: target.isTraining,
    payload,
    role: target.role,
  });

  return {
    completedTaskKeys,
    event,
    role: target.role,
  };
}

async function recordEvent(actor, eventKey, options = {}) {
  if (!actor?.id || !eventKey) {
    return { completedTaskKeys: [], event: null, role: null };
  }

  const target = await getEventTargetContext(actor);
  return recordEventForTarget(actor, target, eventKey, options);
}

async function recordClientEvent(actor, body = {}) {
  assertActor(actor);

  const eventKey = normalizeClientEventKey(body.eventKey);
  const currentTarget = await getEventTargetContext(actor);
  const targetRole = body.role ? resolveTargetRole(actor, body.role) : currentTarget.role;
  const target = {
    isTraining: currentTarget.isTraining && currentTarget.role === targetRole,
    role: targetRole,
  };

  return recordEventForTarget(actor, target, eventKey, {
    entityId: body.entityId || null,
    entityType: body.entityType || 'client_route',
    payload: {
      ...(body.payload || {}),
      source: 'client',
    },
  });
}

async function recordEventSafe(actor, eventKey, options = {}) {
  try {
    return await recordEvent(actor, eventKey, options);
  } catch (error) {
    console.warn('Onboarding event was not recorded:', {
      error: error?.message || error,
      eventKey,
    });

    return { completedTaskKeys: [], event: null, role: null };
  }
}

async function resetProgress(actor, query = {}) {
  const targetRole = resolveTargetRole(actor, query.role);
  await db.OnboardingProgress.destroy({
    where: {
      accountId: actor.id,
      role: targetRole,
    },
  });

  return getOverview(actor, { role: targetRole });
}

module.exports = {
  buildOnboardingResponse,
  cleanupTrainingData,
  completeTask,
  getAvailableRoles,
  getOverview,
  getOnboardingMetrics,
  getTrainingDataSummary,
  getTrainingMode,
  getTrainingDataMarker,
  listMatchingTasks,
  matchesCheckpointConditions,
  recordClientEvent,
  recordEvent,
  recordEventSafe,
  resetProgress,
  resolveTargetRole,
  setTrainingMode,
};
