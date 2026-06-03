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
  { key: 'trainingPlans', label: 'Планы тренировок', modelName: 'TrainingPlan' },
  { key: 'trainingNotes', label: 'Тренерские заметки', modelName: 'TrainingNote' },
  {
    key: 'clientTrainingSkillHistories',
    label: 'История карт навыков клиентов',
    modelName: 'ClientTrainingSkillHistory',
  },
  { key: 'clientTrainingSkills', label: 'Карты навыков клиентов', modelName: 'ClientTrainingSkill' },
  {
    key: 'onboardingEvents',
    label: 'События обучения',
    modelName: 'OnboardingEvent',
    roleField: 'role',
  },
];

const DEFAULT_QUIZ_PASSING_SCORE_PERCENT = 100;

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

function isPlainObject(value) {
  return Boolean(
    value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      !(value instanceof Date),
  );
}

function cloneJsonObject(value) {
  if (typeof value === 'string') {
    try {
      return cloneJsonObject(JSON.parse(value));
    } catch {
      return {};
    }
  }

  if (!isPlainObject(value)) return {};
  return JSON.parse(JSON.stringify(value));
}

function mergeMetadata(base = {}, patch = {}) {
  const result = cloneJsonObject(base);

  for (const [key, value] of Object.entries(patch || {})) {
    if (isPlainObject(value) && isPlainObject(result[key])) {
      result[key] = mergeMetadata(result[key], value);
    } else if (Array.isArray(value)) {
      result[key] = value.map((item) =>
        isPlainObject(item) || Array.isArray(item)
          ? JSON.parse(JSON.stringify(item))
          : item,
      );
    } else if (value !== undefined) {
      result[key] = value;
    }
  }

  return result;
}

function getDefaultPracticeStep(task) {
  return {
    description: task.description,
    key: 'checkpoint',
    target: null,
    title: task.title,
  };
}

function normalizePracticeSteps(task) {
  const steps = Array.isArray(task.practice?.steps)
    ? task.practice.steps.filter((step) => step?.key)
    : [];

  return steps.length > 0
    ? steps.map((step) => ({
        checkpointEvent: step.checkpointEvent || null,
        description: step.description || '',
        key: step.key,
        target: step.target || null,
        title: step.title || step.key,
      }))
    : [getDefaultPracticeStep(task)];
}

function getDefaultQuizQuestion(task) {
  return {
    correctOptionId: 'crm-action',
    hint: 'Задание засчитывается по действию внутри CRM, а не по заметке вне системы.',
    key: 'crm-source-of-truth',
    options: [
      {
        id: 'crm-action',
        text: 'Выполнить действие на нужном экране CRM',
      },
      {
        id: 'external-note',
        text: 'Записать результат вне CRM',
      },
      {
        id: 'skip-training',
        text: 'Пропустить действие и закрыть смену',
      },
    ],
    prompt: `Что нужно сделать, чтобы закрепить задание "${task.title}"?`,
    type: 'single_choice',
  };
}

function normalizeQuizQuestions(task) {
  const questions = Array.isArray(task.quiz?.questions)
    ? task.quiz.questions.filter((question) => question?.key)
    : [];

  return questions.length > 0
    ? questions.map((question) => ({
        correctOptionId: question.correctOptionId,
        correctOptionIds: question.correctOptionIds,
        explanation: question.explanation || null,
        hint: question.hint || null,
        key: question.key,
        options: Array.isArray(question.options) ? question.options : [],
        prompt: question.prompt || question.key,
        type: question.type || 'single_choice',
      }))
    : [getDefaultQuizQuestion(task)];
}

function getGuidedContent(task) {
  const lesson = task.lesson || {};
  const practice = task.practice || {};
  const quiz = task.quiz || {};

  return {
    lesson: {
      blocks:
        Array.isArray(lesson.blocks) && lesson.blocks.length > 0
          ? lesson.blocks
          : [{ text: task.description, type: 'paragraph' }],
      screenshots: Array.isArray(lesson.screenshots) ? lesson.screenshots : [],
      summary: lesson.summary || task.description,
      title: lesson.title || task.title,
    },
    practice: {
      autoTrainingMode:
        practice.autoTrainingMode ?? Boolean(task.trainingMode?.recommended),
      route: practice.route || task.route,
      steps: normalizePracticeSteps(task),
      targetSelectors: Array.isArray(practice.targetSelectors)
        ? practice.targetSelectors
        : [],
      testData: practice.testData || null,
    },
    quiz: {
      passingScorePercent:
        quiz.passingScorePercent || DEFAULT_QUIZ_PASSING_SCORE_PERCENT,
      questions: normalizeQuizQuestions(task),
    },
  };
}

function sanitizeQuiz(quiz) {
  return {
    passingScorePercent: quiz.passingScorePercent,
    questions: quiz.questions.map((question) => ({
      hint: question.hint || null,
      key: question.key,
      options: question.options.map((option) => ({
        id: option.id,
        text: option.text,
      })),
      prompt: question.prompt,
      type: question.type,
    })),
  };
}

function getGuidanceSummary(task) {
  const content = getGuidedContent(task);

  return {
    hasLesson: true,
    hasPractice: true,
    hasQuiz: true,
    practiceStepCount: content.practice.steps.length,
    quizQuestionCount: content.quiz.questions.length,
    screenshotCount: content.lesson.screenshots.length,
  };
}

function getProgressMetadata(progress) {
  return cloneJsonObject(getPlainProgress(progress)?.metadata);
}

function hasGuidedMetadata(metadata = {}) {
  return Boolean(metadata.lesson || metadata.practice || metadata.quiz);
}

function getCompletedPracticeStepKeys(task, metadata = {}) {
  const content = getGuidedContent(task);
  const steps = metadata.practice?.steps || {};

  return content.practice.steps
    .filter((step) => steps[step.key]?.completedAt)
    .map((step) => step.key);
}

function getTaskRequirementState(task, progress) {
  const plainProgress = getPlainProgress(progress);
  const metadata = getProgressMetadata(progress);
  const content = getGuidedContent(task);
  const legacyCompleted =
    plainProgress?.status === 'completed' && !hasGuidedMetadata(metadata);
  const completedAt = serializeDate(plainProgress?.completedAt);
  const completedStepKeys = getCompletedPracticeStepKeys(task, metadata);
  const practiceCompleted =
    legacyCompleted ||
    Boolean(metadata.practice?.completedAt) ||
    completedStepKeys.length >= content.practice.steps.length;
  const quizLastAttempt = metadata.quiz?.lastAttempt || null;
  const quizAttempts = Array.isArray(metadata.quiz?.attempts)
    ? metadata.quiz.attempts
    : [];

  return {
    hasStarted:
      legacyCompleted ||
      hasGuidedMetadata(metadata) ||
      plainProgress?.status === 'in_progress',
    lesson: {
      isRead: legacyCompleted || Boolean(metadata.lesson?.readAt),
      readAt: legacyCompleted ? completedAt : serializeDate(metadata.lesson?.readAt),
    },
    practice: {
      activeStepKey: metadata.practice?.activeStepKey || null,
      completedAt: legacyCompleted
        ? completedAt
        : serializeDate(metadata.practice?.completedAt),
      completedStepKeys,
      isCompleted: practiceCompleted,
      isStarted: legacyCompleted || Boolean(metadata.practice?.startedAt),
      startedAt: legacyCompleted
        ? completedAt
        : serializeDate(metadata.practice?.startedAt),
      totalSteps: content.practice.steps.length,
    },
    quiz: {
      attemptsCount: quizAttempts.length,
      isPassed: legacyCompleted || Boolean(metadata.quiz?.passedAt),
      lastAttemptAt: serializeDate(quizLastAttempt?.submittedAt),
      lastCorrectCount: quizLastAttempt?.correctCount ?? null,
      passedAt: legacyCompleted ? completedAt : serializeDate(metadata.quiz?.passedAt),
      totalQuestions: content.quiz.questions.length,
    },
  };
}

function isTaskFullySatisfied(task, metadata = {}) {
  const fakeProgress = { metadata, status: 'in_progress' };
  const requirements = getTaskRequirementState(task, fakeProgress);

  return (
    requirements.lesson.isRead &&
    requirements.practice.isCompleted &&
    requirements.quiz.isPassed
  );
}

function resolveStoredProgressStatus(task, metadata, currentStatus) {
  if (currentStatus === 'skipped') return 'skipped';
  return isTaskFullySatisfied(task, metadata) ? 'completed' : 'in_progress';
}

function buildTaskProgress(task, progress, nextTaskKey) {
  const plainProgress = getPlainProgress(progress);
  const requirements = getTaskRequirementState(task, progress);
  const status = plainProgress?.status || 'not_started';
  const resolvedStatus =
    status === 'completed' || status === 'skipped'
      ? status
      : requirements.hasStarted
        ? 'in_progress'
        : 'not_started';

  return {
    completedAt: serializeDate(plainProgress?.completedAt),
    isCompleted: resolvedStatus === 'completed',
    isNext: task.key === nextTaskKey,
    lesson: requirements.lesson,
    practice: requirements.practice,
    quiz: requirements.quiz,
    status: resolvedStatus,
  };
}

function buildCompletedMetadata(task) {
  const now = new Date().toISOString();
  const content = getGuidedContent(task);
  const steps = Object.fromEntries(
    content.practice.steps.map((step) => [
      step.key,
      {
        completedAt: now,
        source: 'manual-complete',
      },
    ]),
  );

  return {
    lesson: { readAt: now },
    practice: {
      activeStepKey: null,
      completedAt: now,
      startedAt: now,
      steps,
    },
    quiz: {
      attempts: [
        {
          correctCount: content.quiz.questions.length,
          isPassed: true,
          source: 'manual-complete',
          submittedAt: now,
          totalQuestions: content.quiz.questions.length,
        },
      ],
      lastAttempt: {
        correctCount: content.quiz.questions.length,
        isPassed: true,
        source: 'manual-complete',
        submittedAt: now,
        totalQuestions: content.quiz.questions.length,
      },
      passedAt: now,
    },
  };
}

function serializeTaskForOverview(task, progress, nextTaskKey) {
  const { lesson, practice, quiz, ...taskSummary } = task;

  return {
    ...taskSummary,
    guidance: getGuidanceSummary(task),
    progress: buildTaskProgress(task, progress, nextTaskKey),
  };
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
  return serializeTaskForOverview(task, progress, nextTaskKey);
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

async function getTaskProgressContext(actor, taskKey, role) {
  const targetRole = resolveTargetRole(actor, role);
  const taskMatch = findOnboardingTask(targetRole, taskKey);
  if (!taskMatch) {
    throw appError('Задание обучения не найдено', 404);
  }

  const where = {
    accountId: actor.id,
    role: targetRole,
    taskKey,
  };
  const existing = await db.OnboardingProgress.findOne({ where });

  return {
    existing,
    metadata: getProgressMetadata(existing),
    taskMatch,
    targetRole,
    where,
  };
}

async function saveTaskProgress(context, metadata, statusOverride = null) {
  const current = getPlainProgress(context.existing);
  const status =
    statusOverride ||
    resolveStoredProgressStatus(context.taskMatch.task, metadata, current?.status);
  const completedAt =
    status === 'completed'
      ? current?.completedAt || new Date()
      : null;
  const payload = {
    completedAt,
    metadata,
    status,
  };

  if (context.existing) {
    await context.existing.update(payload);
    return context.existing;
  }

  return db.OnboardingProgress.create({
    ...context.where,
    ...payload,
  });
}

async function upsertTaskProgress(actor, role, task, metadataPatch = {}) {
  const context = await getTaskProgressContext(actor, task.key, role);
  const metadata = mergeMetadata(context.metadata, metadataPatch);
  return saveTaskProgress(context, metadata);
}

function buildTaskDetailResponse(actor, targetRole, taskMatch, progress) {
  const { mission, path, task } = taskMatch;
  const content = getGuidedContent(task);
  const overviewTask = serializeTaskForOverview(task, progress, null);

  return {
    availableRoles: getAvailableRoles(actor),
    mission: {
      description: mission.description,
      key: mission.key,
      title: mission.title,
    },
    ownerRoleOverrideEnabled: actor.role === 'owner',
    path: {
      completionBadge: path.completionBadge,
      description: path.description,
      levelLabel: path.levelLabel,
      role: path.role,
      title: path.title,
    },
    selectedRole: targetRole,
    task: {
      ...overviewTask,
      lesson: content.lesson,
      practice: content.practice,
      quiz: sanitizeQuiz(content.quiz),
    },
  };
}

async function getTaskDetail(actor, taskKey, query = {}) {
  const context = await getTaskProgressContext(actor, taskKey, query.role);
  return buildTaskDetailResponse(
    actor,
    context.targetRole,
    context.taskMatch,
    context.existing,
  );
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
      { key: 'clientTrainingSkillHistories', modelName: 'ClientTrainingSkillHistory' },
      { key: 'trainingPlans', modelName: 'TrainingPlan' },
      { key: 'trainingNotes', modelName: 'TrainingNote' },
      { key: 'clientTrainingSkills', modelName: 'ClientTrainingSkill' },
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
  const context = await getTaskProgressContext(actor, taskKey, body.role);
  const metadata = mergeMetadata(context.metadata, {
    ...buildCompletedMetadata(context.taskMatch.task),
    manual: body.metadata || null,
  });

  await saveTaskProgress(context, metadata);

  return getOverview(actor, { role: context.targetRole });
}

async function markLessonRead(actor, taskKey, body = {}) {
  const context = await getTaskProgressContext(actor, taskKey, body.role);
  const now = new Date().toISOString();
  const metadata = mergeMetadata(context.metadata, {
    lesson: {
      readAt: now,
    },
    lessonReadMetadata: body.metadata || null,
  });
  const progress = await saveTaskProgress(context, metadata);

  return buildTaskDetailResponse(
    actor,
    context.targetRole,
    context.taskMatch,
    progress,
  );
}

async function startPractice(actor, taskKey, body = {}) {
  const context = await getTaskProgressContext(actor, taskKey, body.role);
  const now = new Date().toISOString();
  const content = getGuidedContent(context.taskMatch.task);

  if (content.practice.autoTrainingMode) {
    await setTrainingMode(actor, {
      isEnabled: true,
      metadata: {
        source: 'onboarding-practice',
        taskKey,
      },
      role: context.targetRole,
    });
  }

  const metadata = mergeMetadata(context.metadata, {
    practice: {
      activeStepKey:
        context.metadata.practice?.activeStepKey ||
        content.practice.steps[0]?.key ||
        null,
      startedAt: context.metadata.practice?.startedAt || now,
    },
    practiceStartMetadata: body.metadata || null,
  });
  const progress = await saveTaskProgress(context, metadata);

  return buildTaskDetailResponse(
    actor,
    context.targetRole,
    context.taskMatch,
    progress,
  );
}

async function completePracticeStep(actor, taskKey, stepKey, body = {}) {
  const context = await getTaskProgressContext(actor, taskKey, body.role);
  const content = getGuidedContent(context.taskMatch.task);
  const stepKeys = content.practice.steps.map((step) => step.key);

  if (!stepKeys.includes(stepKey)) {
    throw appError('Шаг задания обучения не найден', 404);
  }

  const now = new Date().toISOString();
  const nextMetadata = mergeMetadata(context.metadata, {
    practice: {
      startedAt: context.metadata.practice?.startedAt || now,
      steps: {
        [stepKey]: {
          completedAt: now,
          metadata: body.metadata || null,
        },
      },
    },
  });
  const completedStepKeys = getCompletedPracticeStepKeys(
    context.taskMatch.task,
    nextMetadata,
  );
  const nextIncompleteStep = content.practice.steps.find(
    (step) => !completedStepKeys.includes(step.key),
  );

  nextMetadata.practice = mergeMetadata(nextMetadata.practice, {
    activeStepKey: nextIncompleteStep?.key || null,
    completedAt:
      completedStepKeys.length >= content.practice.steps.length
        ? nextMetadata.practice.completedAt || now
        : null,
  });

  const progress = await saveTaskProgress(context, nextMetadata);

  return buildTaskDetailResponse(
    actor,
    context.targetRole,
    context.taskMatch,
    progress,
  );
}

function normalizeAnswer(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item)).sort();
  }
  if (value == null) return [];
  return [String(value)];
}

function getCorrectAnswer(question) {
  if (Array.isArray(question.correctOptionIds)) {
    return question.correctOptionIds.map((item) => String(item)).sort();
  }
  if (question.correctOptionId == null) return [];
  return [String(question.correctOptionId)];
}

function answersEqual(actual, expected) {
  if (actual.length !== expected.length) return false;
  return actual.every((value, index) => value === expected[index]);
}

function evaluateQuizAttempt(task, answers = {}) {
  const content = getGuidedContent(task);
  const results = content.quiz.questions.map((question) => {
    const selectedOptionIds = normalizeAnswer(answers[question.key]);
    const correctOptionIds = getCorrectAnswer(question);
    const isCorrect = answersEqual(selectedOptionIds, correctOptionIds);

    return {
      explanation: question.explanation || null,
      hint: isCorrect ? null : question.hint || null,
      isCorrect,
      questionKey: question.key,
      selectedOptionIds,
    };
  });
  const correctCount = results.filter((result) => result.isCorrect).length;
  const totalQuestions = content.quiz.questions.length;
  const scorePercent =
    totalQuestions > 0 ? Math.round((correctCount / totalQuestions) * 100) : 0;

  return {
    correctCount,
    isPassed: scorePercent >= content.quiz.passingScorePercent,
    results,
    scorePercent,
    submittedAt: new Date().toISOString(),
    totalQuestions,
  };
}

async function submitQuizAttempt(actor, taskKey, body = {}) {
  const context = await getTaskProgressContext(actor, taskKey, body.role);
  const attempt = evaluateQuizAttempt(context.taskMatch.task, body.answers || {});
  const attempts = Array.isArray(context.metadata.quiz?.attempts)
    ? context.metadata.quiz.attempts
    : [];
  const nextAttempts = [...attempts, attempt].slice(-10);
  const metadata = mergeMetadata(context.metadata, {
    quiz: {
      attempts: nextAttempts,
      lastAttempt: attempt,
      passedAt: attempt.isPassed
        ? context.metadata.quiz?.passedAt || attempt.submittedAt
        : context.metadata.quiz?.passedAt || null,
    },
    quizAttemptMetadata: body.metadata || null,
  });
  const progress = await saveTaskProgress(context, metadata);

  return {
    attempt,
    detail: buildTaskDetailResponse(
      actor,
      context.targetRole,
      context.taskMatch,
      progress,
    ),
  };
}

async function recordEventForTarget(actor, target, eventKey, options = {}) {
  const payload = options.payload || {};
  const matchingTasks = listMatchingTasks(target.role, eventKey, payload);
  const completedTaskKeys = [];
  const progressedTaskKeys = [];

  for (const task of matchingTasks) {
    const now = new Date().toISOString();
    const content = getGuidedContent(task);
    const matchingStepKeys = content.practice.steps
      .filter((step) => !step.checkpointEvent || step.checkpointEvent === eventKey)
      .map((step) => step.key);
    const stepKeys =
      matchingStepKeys.length > 0
        ? matchingStepKeys
        : content.practice.steps.map((step) => step.key);
    const steps = Object.fromEntries(
      stepKeys.map((stepKey) => [
        stepKey,
        {
          completedAt: now,
          eventKey,
          source: 'event',
        },
      ]),
    );
    const progress = await upsertTaskProgress(actor, target.role, task, {
      checkpointEvent: eventKey,
      entityId: options.entityId || null,
      entityType: options.entityType || null,
      isTraining: target.isTraining,
      payload,
      practice: {
        activeStepKey: null,
        completedAt: now,
        startedAt: now,
        steps,
      },
      source: 'event',
    });
    progressedTaskKeys.push(task.key);
    if (getPlainProgress(progress)?.status === 'completed') {
      completedTaskKeys.push(task.key);
    }
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
    progressedTaskKeys,
    role: target.role,
  };
}

async function recordEvent(actor, eventKey, options = {}) {
  if (!actor?.id || !eventKey) {
    return {
      completedTaskKeys: [],
      event: null,
      progressedTaskKeys: [],
      role: null,
    };
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

    return {
      completedTaskKeys: [],
      event: null,
      progressedTaskKeys: [],
      role: null,
    };
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
  completePracticeStep,
  getAvailableRoles,
  getOverview,
  getOnboardingMetrics,
  getTaskDetail,
  getTrainingDataSummary,
  getTrainingMode,
  getTrainingDataMarker,
  listMatchingTasks,
  markLessonRead,
  matchesCheckpointConditions,
  recordClientEvent,
  recordEvent,
  recordEventSafe,
  resetProgress,
  resolveTargetRole,
  setTrainingMode,
  startPractice,
  submitQuizAttempt,
};
