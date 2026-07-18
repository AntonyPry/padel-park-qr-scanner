const crypto = require('crypto');
const db = require('../../models');
const { ACCOUNT_ROLES, ACCOUNT_ROLE_VALUES } = require('../constants/account-roles');
const {
  findOnboardingTask,
  getOnboardingPath,
  getOnboardingRoleOptions,
  listOnboardingPaths,
  ONBOARDING_CLIENT_CHECKPOINT_EVENTS,
} = require('../onboarding/catalog');
const shiftCashAttachmentStorage = require('./shift-cash-attachments');
const { TENANT_SCOPES } = require('../tenant-context/route-scope-declarations');
const {
  bindOnboardingActor,
  resolveOnboardingAccessContext,
} = require('./onboarding-access-context.service');
const {
  callTaskTenantWhere,
  resolveCallTaskAccessContext,
} = require('./call-task-access-context.service');
const {
  isTenantClientBasesCallTasksEnabled,
  isTenantBookingsCourtsEnabled,
  isTenantMethodologySkillMapEnabled,
  isTenantTrainingNotesPlansEnabled,
  isTenantClientMoneyInstrumentsEnabled,
  isTenantShiftsReportsEnabled,
} = require('../tenant-context/capabilities');
const {
  bookingTenantWhere,
  resolveBookingAccessContext,
} = require('./booking-access-context.service');
const {
  bindMethodologyActor,
  methodologyTenantWhere,
  resolveMethodologyAccessContext,
} = require('./methodology-access-context.service');
const {
  resolveTrainingOperationsAccessContext,
  trainingOperationsTenantWhere,
} = require('./training-operations-access-context.service');
const {
  clubTenantWhere,
  organizationTenantWhere,
  resolveClientMoneyAccessContextForModel,
} = require('./client-money-access-context.service');
const {
  bindShiftOperationsActor,
  resolveShiftOperationsAccessContext,
} = require('./shift-operations-access-context.service');

const TRAINING_DATA_ENTITIES = [
  { key: 'clients', label: 'Клиенты', modelName: 'User' },
  { key: 'visits', label: 'Визиты', modelName: 'Visit' },
  { key: 'bookings', label: 'Брони', modelName: 'Booking' },
  { key: 'bookingSeries', label: 'Серии броней', modelName: 'BookingSeries' },
  { key: 'finances', label: 'Финансовые операции', modelName: 'Finance' },
  {
    key: 'shiftCashSessions',
    label: 'Кассовые сверки смен',
    modelName: 'ShiftCashSession',
  },
  {
    key: 'shiftCashExpenses',
    label: 'Кассовые расходы смен',
    modelName: 'ShiftCashExpense',
  },
  { key: 'clientBases', label: 'Клиентские базы', modelName: 'ClientBase' },
  { key: 'callTasks', label: 'Задачи обзвона', modelName: 'CallTask' },
  { key: 'callTaskClients', label: 'Клиенты в обзвонах', modelName: 'CallTaskClient' },
  { key: 'callTaskAttempts', label: 'Попытки звонков', modelName: 'CallTaskAttempt' },
  { key: 'corporateClients', label: 'Корпоративные клиенты', modelName: 'CorporateClient' },
  {
    key: 'corporateLedgerEntries',
    label: 'Операции корпоративных балансов',
    modelName: 'CorporateLedgerEntry',
  },
  { key: 'trainingPlans', label: 'Планы тренировок', modelName: 'TrainingPlan' },
  { key: 'trainingNotes', label: 'Тренерские заметки', modelName: 'TrainingNote' },
  {
    key: 'clientTrainingSkillHistories',
    label: 'История карт навыков клиентов',
    modelName: 'ClientTrainingSkillHistory',
  },
  {
    key: 'clientTrainingSkills',
    label: 'Карты навыков клиентов',
    modelName: 'ClientTrainingSkill',
  },
  {
    key: 'onboardingEvents',
    label: 'События обучения',
    modelName: 'OnboardingEvent',
    roleField: 'role',
  },
];

const DEFAULT_QUIZ_PASSING_SCORE_PERCENT = 100;
const CALL_TASK_TRAINING_MODELS = new Set([
  'CallTask',
  'CallTaskAttempt',
  'CallTaskClient',
  'ClientBase',
]);
const BOOKING_TRAINING_MODELS = new Set(['Booking', 'BookingSeries']);
const METHODOLOGY_TRAINING_MODELS = new Set([
  'ClientTrainingSkill',
  'ClientTrainingSkillHistory',
]);
const TRAINING_OPERATION_MODELS = new Set(['TrainingNote', 'TrainingPlan']);
const CLIENT_MONEY_ORGANIZATION_MODELS = new Set(['CorporateClient']);
const CLIENT_MONEY_CLUB_MODELS = new Set([
  'CorporateLedgerEntry',
  'Finance',
]);
const SHIFT_OPERATION_CHILD_MODELS = new Set([
  'ShiftCashExpense',
  'ShiftCashSession',
]);
const TRAINING_MODE_TTL_MS = Math.max(
  60 * 60 * 1000,
  Number(process.env.ONBOARDING_TRAINING_MODE_TTL_HOURS || 24) * 60 * 60 * 1000,
);

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

function getTrainingEntityWhere(entity, role, ownership = {}) {
  const where = { isTraining: true };
  if (role) {
    where[entity.roleField || 'trainingRole'] = role;
  }
  if (ownership.accountId) {
    where[entity.modelName === 'OnboardingEvent' ? 'accountId' : 'trainingAccountId'] =
      ownership.accountId;
  }
  if (ownership.sessionId) {
    where.trainingSessionId = ownership.sessionId;
  }
  return where;
}

async function listTrainingIds(model, where, transaction, options = {}) {
  if (!model) return [];
  const rows = await model.findAll({
    attributes: ['id'],
    include: options.include,
    raw: true,
    transaction,
    where,
  });

  return rows.map((row) => Number(row.id)).filter(Boolean);
}

async function destroyTrainingRows(model, where, transaction, options = {}) {
  if (!model) return 0;
  if (options.include) {
    const ids = await listTrainingIds(model, where, transaction, options);
    if (ids.length === 0) return 0;
    return model.destroy({
      transaction,
      where: { id: { [db.Sequelize.Op.in]: ids } },
    });
  }
  return model.destroy({ transaction, where });
}

async function resolveTrainingCallTaskContext(actor, tenant, options = {}) {
  if (!isTenantClientBasesCallTasksEnabled()) return null;
  return resolveCallTaskAccessContext(tenant, {
    ...options,
    accountId: actor.id,
  });
}

async function resolveTrainingBookingContext(tenant, options = {}) {
  if (!isTenantBookingsCourtsEnabled()) return null;
  return resolveBookingAccessContext(tenant, options);
}

async function resolveTrainingMethodologyContext(tenant, options = {}) {
  if (!isTenantMethodologySkillMapEnabled()) return null;
  return resolveMethodologyAccessContext(tenant, options);
}

async function resolveTrainingOperationsContext(tenant, options = {}) {
  if (!isTenantTrainingNotesPlansEnabled()) return null;
  return resolveTrainingOperationsAccessContext(tenant, options);
}

async function resolveTrainingClientMoneyContext(tenant, options = {}) {
  if (!isTenantClientMoneyInstrumentsEnabled()) return null;
  return resolveClientMoneyAccessContextForModel(
    tenant,
    db.CorporateLedgerEntry,
    options,
  );
}

async function resolveTrainingShiftContext(tenant, options = {}) {
  if (!isTenantShiftsReportsEnabled()) return null;
  return resolveShiftOperationsAccessContext(tenant, options);
}

function getTrainingEntityQuery(
  entity,
  role,
  ownership,
  context,
  bookingContext = null,
  methodologyContext = null,
  trainingOperationsContext = null,
  clientMoneyContext = null,
  shiftOperationsContext = null,
) {
  const where = getTrainingEntityWhere(entity, role, ownership);
  if (
    shiftOperationsContext &&
    SHIFT_OPERATION_CHILD_MODELS.has(entity.modelName)
  ) {
    return {
      include: [{
        as: 'shift',
        attributes: [],
        model: db.Shift,
        required: true,
        where: { clubId: shiftOperationsContext.clubId },
      }],
      where,
    };
  }
  if (
    clientMoneyContext &&
    CLIENT_MONEY_ORGANIZATION_MODELS.has(entity.modelName)
  ) {
    return {
      where: organizationTenantWhere(clientMoneyContext, where, { force: true }),
    };
  }
  if (
    clientMoneyContext &&
    CLIENT_MONEY_CLUB_MODELS.has(entity.modelName)
  ) {
    return {
      where: clubTenantWhere(clientMoneyContext, where, { force: true }),
    };
  }
  if (
    bookingContext &&
    ['OnboardingEvent', 'Visit'].includes(entity.modelName)
  ) {
    return {
      where: {
        ...where,
        clubId: bookingContext.clubId,
        organizationId: bookingContext.organizationId,
      },
    };
  }
  if (methodologyContext && entity.modelName === 'User') {
    return {
      where: methodologyTenantWhere(methodologyContext, where, { force: true }),
    };
  }
  if (
    trainingOperationsContext &&
    TRAINING_OPERATION_MODELS.has(entity.modelName)
  ) {
    return {
      where: trainingOperationsTenantWhere(
        trainingOperationsContext,
        where,
        { force: true },
      ),
    };
  }
  if (
    methodologyContext &&
    METHODOLOGY_TRAINING_MODELS.has(entity.modelName)
  ) {
    return {
      include: [{
        attributes: [],
        model: db.User,
        required: true,
        where: { organizationId: methodologyContext.organizationId },
      }],
      where,
    };
  }
  if (bookingContext && BOOKING_TRAINING_MODELS.has(entity.modelName)) {
    return {
      where: bookingTenantWhere(bookingContext, where, { force: true }),
    };
  }
  if (!context || !CALL_TASK_TRAINING_MODELS.has(entity.modelName)) {
    return { where };
  }
  if (entity.modelName === 'ClientBase' || entity.modelName === 'CallTask') {
    return { where: callTaskTenantWhere(context, where, { force: true }) };
  }
  if (entity.modelName === 'CallTaskClient') {
    return {
      include: [{
        as: 'callTask',
        attributes: [],
        model: db.CallTask,
        required: true,
        where: callTaskTenantWhere(context, {}, { force: true }),
      }],
      where,
    };
  }
  return {
    include: [{
      as: 'taskClient',
      attributes: [],
      model: db.CallTaskClient,
      required: true,
      include: [{
        as: 'callTask',
        attributes: [],
        model: db.CallTask,
        required: true,
        where: callTaskTenantWhere(context, {}, { force: true }),
      }],
    }],
    where,
  };
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
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
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

function isPracticeDisabled(task) {
  return task.practice === false || task.practice?.enabled === false;
}

function normalizePracticeSteps(task) {
  if (isPracticeDisabled(task)) return [];

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
  const practiceDisabled = isPracticeDisabled(task);
  const practiceSteps = practiceDisabled ? [] : normalizePracticeSteps(task);

  return {
    lesson: {
      blocks:
        Array.isArray(lesson.blocks) && lesson.blocks.length > 0
          ? lesson.blocks
          : [{ text: task.description, type: 'paragraph' }],
      format: lesson.format || null,
      screenshots: Array.isArray(lesson.screenshots) ? lesson.screenshots : [],
      summary: lesson.summary || task.description,
      title: lesson.title || task.title,
      updatedAt: serializeDate(lesson.updatedAt || task.updatedAt),
    },
    practice: {
      autoTrainingMode:
        practiceDisabled
          ? false
          : practice.autoTrainingMode ?? Boolean(task.trainingMode?.recommended),
      route: practice.route || task.route,
      steps: practiceSteps,
      targetSelectors: !practiceDisabled && Array.isArray(practice.targetSelectors)
        ? practice.targetSelectors
        : [],
      testData: practiceDisabled ? null : practice.testData || null,
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
    hasPractice: content.practice.steps.length > 0,
    hasQuiz: true,
    practiceStepCount: content.practice.steps.length,
    quizQuestionCount: content.quiz.questions.length,
    screenshotCount: content.lesson.screenshots.length,
  };
}

function getProgressMetadata(progress) {
  return cloneJsonObject(getPlainProgress(progress)?.metadata);
}

function isAfterDate(left, right) {
  if (!left || !right) return false;
  const leftDate = new Date(left);
  const rightDate = new Date(right);
  if (Number.isNaN(leftDate.getTime()) || Number.isNaN(rightDate.getTime())) {
    return false;
  }
  return leftDate.getTime() > rightDate.getTime();
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
  const lessonUpdatedAt = content.lesson.updatedAt;
  const lessonContentReviewedAt = serializeDate(metadata.lesson?.contentReviewedAt);
  const lessonFreshnessReferenceAt = lessonContentReviewedAt || completedAt;
  const isCompleted = plainProgress?.status === 'completed';
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
      isUpdatedAfterCompletion:
        isCompleted && isAfterDate(lessonUpdatedAt, lessonFreshnessReferenceAt),
      readAt: legacyCompleted ? completedAt : serializeDate(metadata.lesson?.readAt),
      reviewedAt: lessonContentReviewedAt,
      reviewedVersionAt: serializeDate(metadata.lesson?.contentReviewedVersionAt),
      updatedAt: lessonUpdatedAt,
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
    lesson: {
      contentReviewedAt: now,
      contentReviewedVersionAt: content.lesson.updatedAt,
      readAt: now,
    },
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

async function resolveBoundary(actor, tenant, scope, options = {}) {
  const authority = await resolveOnboardingAccessContext(
    actor,
    tenant,
    scope,
    options,
  );
  return {
    actor: bindOnboardingActor(actor, authority),
    authority,
  };
}

async function getProgressRows(membershipId, role) {
  return db.OnboardingProgress.findAll({
    order: [['updatedAt', 'DESC']],
    where: {
      membershipId,
      role,
    },
  });
}

async function getTaskProgressContext(actor, taskKey, role, tenant, options = {}) {
  const scope = [TENANT_SCOPES.CLUB, TENANT_SCOPES.ORGANIZATION].includes(
    tenant?.scope,
  ) ? tenant.scope : TENANT_SCOPES.MEMBERSHIP;
  const boundary = await resolveBoundary(
    actor,
    tenant,
    scope,
    options,
  );
  const targetRole = resolveTargetRole(boundary.actor, role);
  const taskMatch = findOnboardingTask(targetRole, taskKey);
  if (!taskMatch) {
    throw appError('Задание обучения не найдено', 404);
  }

  const where = {
    accountId: boundary.authority.accountId,
    membershipId: boundary.authority.membershipId,
    organizationId: boundary.authority.organizationId,
    role: targetRole,
    taskKey,
  };
  const existing = await db.OnboardingProgress.findOne({
    lock: options.transaction && options.lock
      ? options.transaction.LOCK?.UPDATE
      : undefined,
    transaction: options.transaction,
    where,
  });

  return {
    existing,
    actor: boundary.actor,
    authority: boundary.authority,
    metadata: getProgressMetadata(existing),
    taskMatch,
    targetRole,
    where,
  };
}

async function saveTaskProgress(
  context,
  metadata,
  statusOverride = null,
  options = {},
) {
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
    await context.existing.update(payload, { transaction: options.transaction });
    return context.existing;
  }

  return db.OnboardingProgress.create(
    {
      ...context.where,
      ...payload,
    },
    { transaction: options.transaction },
  );
}

async function upsertTaskProgress(
  actor,
  role,
  task,
  metadataPatch = {},
  tenant = null,
  eventAuthority = null,
  options = {},
) {
  const context = await getTaskProgressContext(
    actor,
    task.key,
    role,
    tenant,
    options,
  );
  if (
    eventAuthority?.clubId &&
    context.existing?.clubId &&
    Number(context.existing.clubId) !== Number(eventAuthority.clubId)
  ) {
    throw appError('Задание обучения принадлежит другому клубу', 409);
  }
  if (eventAuthority?.clubId && !context.existing) {
    context.where.clubId = eventAuthority.clubId;
  }
  const metadata = mergeMetadata(context.metadata, metadataPatch);
  return saveTaskProgress(context, metadata, null, options);
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

async function getTaskDetail(actor, taskKey, query = {}, tenant = null) {
  const context = await getTaskProgressContext(actor, taskKey, query.role, tenant);
  return buildTaskDetailResponse(
    context.actor,
    context.targetRole,
    context.taskMatch,
    context.existing,
  );
}

async function loadTrainingMode(boundary, options = {}) {
  const mode = await db.OnboardingTrainingMode.findOne({
    lock: options.transaction && options.lock
      ? options.transaction.LOCK?.UPDATE
      : undefined,
    transaction: options.transaction,
    where: {
      membershipId: boundary.authority.membershipId,
      clubId: boundary.authority.clubId,
      organizationId: boundary.authority.organizationId,
    },
  });
  if (
    mode?.isEnabled &&
    mode.expiresAt &&
    new Date(mode.expiresAt).getTime() <= Date.now()
  ) {
    await mode.update({ disabledAt: new Date(), isEnabled: false }, {
      transaction: options.transaction,
    });
  }
  return mode;
}

async function getTrainingMode(actor, tenant = null) {
  const boundary = await resolveBoundary(actor, tenant, TENANT_SCOPES.CLUB);
  const mode = await loadTrainingMode(boundary);

  return serializeTrainingMode(mode, boundary.actor.role);
}

async function getEventTargetContext(
  actor,
  tenant,
  scope = TENANT_SCOPES.CLUB,
  options = {},
) {
  const boundary = await resolveBoundary(actor, tenant, scope, options);
  const mode = scope === TENANT_SCOPES.CLUB
    ? await loadTrainingMode(boundary, options)
    : null;
  const plainMode = getPlainProgress(mode);
  const requestedRole =
    plainMode?.isEnabled && plainMode.role ? plainMode.role : boundary.actor.role;

  return {
    actor: boundary.actor,
    authority: boundary.authority,
    isTraining: Boolean(plainMode?.isEnabled && plainMode?.sessionId),
    role: resolveTargetRole(boundary.actor, requestedRole),
    trainingSessionId: plainMode?.isEnabled ? plainMode.sessionId : null,
  };
}

async function getTrainingDataMarker(actor, tenant = null) {
  if (!actor?.id || !actor.role) {
    return {
      isTraining: false,
      trainingAccountId: null,
      trainingRole: null,
      trainingSessionId: null,
    };
  }

  const context = await getEventTargetContext(actor, tenant, TENANT_SCOPES.CLUB);
  if (!context.isTraining) {
    return {
      isTraining: false,
      trainingAccountId: null,
      trainingRole: null,
      trainingSessionId: null,
    };
  }

  return {
    isTraining: true,
    trainingAccountId: actor.id,
    trainingRole: context.role,
    trainingSessionId: context.trainingSessionId,
  };
}

async function getTrainingDataSummary(actor, query = {}, tenant = null) {
  const role = resolveOptionalTrainingRole(query.role);
  const boundary = await resolveBoundary(actor, tenant, TENANT_SCOPES.CLUB);
  const mode = await loadTrainingMode(boundary);
  const ownership = {
    accountId: boundary.authority.accountId,
    sessionId: mode?.sessionId || '__no-training-session__',
  };
  const methodologyContext = await resolveTrainingMethodologyContext(tenant);
  const authorityActor = methodologyContext
    ? bindMethodologyActor(boundary.actor, methodologyContext)
    : boundary.actor;
  assertOwner(authorityActor);
  const callTaskContext = await resolveTrainingCallTaskContext(authorityActor, tenant);
  const bookingContext = await resolveTrainingBookingContext(tenant);
  const trainingOperationsContext = await resolveTrainingOperationsContext(tenant);
  const clientMoneyContext = await resolveTrainingClientMoneyContext(tenant);
  const shiftOperationsContext = await resolveTrainingShiftContext(tenant);
  const shiftAuthorityActor = shiftOperationsContext
    ? bindShiftOperationsActor(authorityActor, shiftOperationsContext)
    : authorityActor;
  assertOwner(shiftAuthorityActor);

  const entities = await Promise.all(
    TRAINING_DATA_ENTITIES.map(async (entity) => {
      const model = db[entity.modelName];
      const count = model
        ? await model.count(getTrainingEntityQuery(
            entity,
            role,
            ownership,
            callTaskContext,
            bookingContext,
            methodologyContext,
            trainingOperationsContext,
            clientMoneyContext,
            shiftOperationsContext,
          ))
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

async function getOnboardingMetrics(actor, tenant = null) {
  const boundary = await resolveBoundary(
    actor,
    tenant,
    TENANT_SCOPES.ORGANIZATION,
  );
  assertOwner(boundary.actor, 'Метрики обучения доступны только владельцу');

  const [accounts, progressRows] = await Promise.all([
    db.Membership.findAll({
      attributes: [['accountId', 'id'], 'role', 'status'],
      raw: true,
      where: {
        organizationId: boundary.authority.organizationId,
        status: 'active',
      },
    }),
    db.OnboardingProgress.findAll({
      attributes: ['accountId', 'completedAt', 'role', 'status', 'taskKey'],
      raw: true,
      where: {
        organizationId: boundary.authority.organizationId,
        status: 'completed',
      },
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

async function cleanupTrainingData(actor, query = {}, tenant = null) {
  const role = resolveOptionalTrainingRole(query.role);
  const deleted = {};
  const shiftCashAttachments = [];
  let cleanupOwnership = null;

  await db.sequelize.transaction(async (transaction) => {
    const boundary = await resolveBoundary(actor, tenant, TENANT_SCOPES.CLUB, {
      lock: true,
      transaction,
    });
    const mode = await loadTrainingMode(boundary, { lock: true, transaction });
    if (role && mode?.sessionId && mode.role !== role) {
      throw appError('Учебная сессия принадлежит другой роли; очистите её в исходной роли', 409);
    }
    cleanupOwnership = {
      accountId: boundary.authority.accountId,
      sessionId: mode?.sessionId || '__no-training-session__',
    };
    const methodologyContext = await resolveTrainingMethodologyContext(tenant, {
      lock: true,
      transaction,
    });
    const authorityActor = methodologyContext
      ? bindMethodologyActor(boundary.actor, methodologyContext)
      : boundary.actor;
    assertOwner(authorityActor);
    const callTaskContext = await resolveTrainingCallTaskContext(
      authorityActor,
      tenant,
      { lock: true, transaction },
    );
    const bookingContext = await resolveTrainingBookingContext(tenant, {
      lock: true,
      transaction,
    });
    const trainingOperationsContext = await resolveTrainingOperationsContext(
      tenant,
      { lock: true, transaction },
    );
    const clientMoneyContext = await resolveTrainingClientMoneyContext(
      tenant,
      { lock: true, transaction },
    );
    const shiftOperationsContext = await resolveTrainingShiftContext(tenant, {
      lock: true,
      transaction,
    });
    const shiftAuthorityActor = shiftOperationsContext
      ? bindShiftOperationsActor(authorityActor, shiftOperationsContext)
      : authorityActor;
    assertOwner(shiftAuthorityActor);
    const bookingWhere = bookingContext
      ? bookingTenantWhere(
          bookingContext,
          getTrainingEntityWhere(
            { modelName: 'Booking' },
            role,
            cleanupOwnership,
          ),
          { force: true },
        )
      : getTrainingEntityWhere({ modelName: 'Booking' }, role, cleanupOwnership);
    const visitWhere = getTrainingEntityWhere(
      { modelName: 'Visit' },
      role,
      cleanupOwnership,
    );

    const [bookingIds, visitIds, userIds] = await Promise.all([
      listTrainingIds(db.Booking, bookingWhere, transaction),
      listTrainingIds(db.Visit, visitWhere, transaction),
      listTrainingIds(
        db.User,
        getTrainingEntityQuery(
          { modelName: 'User' },
          role,
          cleanupOwnership,
          callTaskContext,
          bookingContext,
          methodologyContext,
          trainingOperationsContext,
          clientMoneyContext,
        ).where,
        transaction,
      ),
    ]);

    if (db.ShiftCashExpense) {
      const cashExpenses = await db.ShiftCashExpense.findAll({
        attributes: ['attachments'],
        raw: true,
        transaction,
        where: getTrainingEntityWhere(
          { modelName: 'ShiftCashExpense' },
          role,
          cleanupOwnership,
        ),
        include: shiftOperationsContext ? [{
          as: 'shift',
          attributes: [],
          model: db.Shift,
          required: true,
          where: { clubId: shiftOperationsContext.clubId },
        }] : undefined,
      });
      cashExpenses.forEach((expense) => {
        const attachments = Array.isArray(expense.attachments)
          ? expense.attachments
          : (() => {
              try {
                return JSON.parse(expense.attachments || '[]');
              } catch {
                return [];
              }
            })();
        shiftCashAttachments.push(...attachments);
      });
    }

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

    if ((visitIds.length > 0 || userIds.length > 0) && db.ScannerEvent) {
      const scannerWhere = [];
      if (visitIds.length > 0) {
        scannerWhere.push({ visitId: { [db.Sequelize.Op.in]: visitIds } });
      }
      if (userIds.length > 0) {
        scannerWhere.push({ userId: { [db.Sequelize.Op.in]: userIds } });
      }
      deleted.scannerEvents = await db.ScannerEvent.destroy({
        transaction,
        where: { [db.Sequelize.Op.or]: scannerWhere },
      });
    } else {
      deleted.scannerEvents = 0;
    }

    const deletionOrder = [
      { key: 'onboardingEvents', modelName: 'OnboardingEvent', roleField: 'role' },
      { key: 'callTaskAttempts', modelName: 'CallTaskAttempt' },
      { key: 'callTaskClients', modelName: 'CallTaskClient' },
      { key: 'callTasks', modelName: 'CallTask' },
      {
        key: 'corporateLedgerEntries',
        modelName: 'CorporateLedgerEntry',
      },
      { key: 'corporateClients', modelName: 'CorporateClient' },
      { key: 'clientBases', modelName: 'ClientBase' },
      {
        key: 'clientTrainingSkillHistories',
        modelName: 'ClientTrainingSkillHistory',
      },
      { key: 'clientTrainingSkills', modelName: 'ClientTrainingSkill' },
      { key: 'trainingPlans', modelName: 'TrainingPlan' },
      { key: 'trainingNotes', modelName: 'TrainingNote' },
      { key: 'bookings', modelName: 'Booking' },
      { key: 'bookingSeries', modelName: 'BookingSeries' },
      { key: 'shiftCashExpenses', modelName: 'ShiftCashExpense' },
      { key: 'shiftCashSessions', modelName: 'ShiftCashSession' },
      { key: 'finances', modelName: 'Finance' },
      { key: 'visits', modelName: 'Visit' },
      { key: 'clients', modelName: 'User' },
    ];

    for (const entity of deletionOrder) {
      const entityQuery = getTrainingEntityQuery(
        entity,
        role,
        cleanupOwnership,
        callTaskContext,
        bookingContext,
        methodologyContext,
        trainingOperationsContext,
        clientMoneyContext,
        shiftOperationsContext,
      );
      deleted[entity.key] = await destroyTrainingRows(
        db[entity.modelName],
        entityQuery.where,
        transaction,
        { include: entityQuery.include },
      );
    }

    if (mode?.sessionId === cleanupOwnership.sessionId) {
      await mode.update({
        disabledAt: mode.disabledAt || new Date(),
        isEnabled: false,
        sessionId: null,
        expiresAt: null,
      }, { transaction });
    }
  });

  await shiftCashAttachmentStorage.deleteAttachmentFiles(
    shiftCashAttachments,
    tenant,
  );

  return {
    deleted,
    remaining: await getTrainingDataSummary(actor, { role }, tenant),
    role,
  };
}

async function setTrainingMode(actor, body = {}, tenant = null) {
  await db.sequelize.transaction(async (transaction) => {
    const boundary = await resolveBoundary(actor, tenant, TENANT_SCOPES.CLUB, {
      lock: true,
      transaction,
    });
    const isEnabled = Boolean(body.isEnabled);
    const targetRole = resolveTargetRole(
      boundary.actor,
      body.role || boundary.actor.role,
    );
    const now = new Date();
    const where = { membershipId: boundary.authority.membershipId };
    const existing = await db.OnboardingTrainingMode.findOne({
      lock: transaction.LOCK.UPDATE,
      transaction,
      where,
    });
    if (existing?.sessionId && (
      Number(existing.clubId) !== boundary.authority.clubId ||
      existing.role !== targetRole
    )) {
      throw appError(
        'Сначала очистите сохранённую учебную сессию исходной роли и клуба',
        409,
      );
    }
    const startsNewSession = isEnabled && !existing?.sessionId;
    const payload = {
      accountId: boundary.authority.accountId,
      clubId: boundary.authority.clubId,
      disabledAt: isEnabled ? null : now,
      enabledAt: startsNewSession ? now : existing?.enabledAt,
      expiresAt: isEnabled
        ? new Date(now.getTime() + TRAINING_MODE_TTL_MS)
        : existing?.expiresAt || null,
      isEnabled,
      membershipId: boundary.authority.membershipId,
      metadata: body.metadata || null,
      organizationId: boundary.authority.organizationId,
      role: targetRole,
      sessionId: startsNewSession ? crypto.randomUUID() : existing?.sessionId,
    };
    if (existing) await existing.update(payload, { transaction });
    else await db.OnboardingTrainingMode.create(payload, { transaction });
  });

  return getTrainingMode(actor, tenant);
}

async function getOverview(actor, query = {}, tenant = null) {
  const boundary = await resolveBoundary(actor, tenant, TENANT_SCOPES.MEMBERSHIP);
  const targetRole = resolveTargetRole(boundary.actor, query.role);
  const progressRows = await getProgressRows(
    boundary.authority.membershipId,
    targetRole,
  );
  return buildOnboardingResponse(boundary.actor, targetRole, progressRows);
}

async function completeTask(actor, taskKey, body = {}, tenant = null) {
  const context = await getTaskProgressContext(actor, taskKey, body.role, tenant);
  const metadata = mergeMetadata(context.metadata, {
    ...buildCompletedMetadata(context.taskMatch.task),
    manual: body.metadata || null,
  });

  await saveTaskProgress(context, metadata);

  return getOverview(context.actor, { role: context.targetRole }, tenant);
}

async function markLessonRead(actor, taskKey, body = {}, tenant = null) {
  const context = await getTaskProgressContext(actor, taskKey, body.role, tenant);
  const now = new Date().toISOString();
  const metadata = mergeMetadata(context.metadata, {
    lesson: {
      readAt: now,
    },
    lessonReadMetadata: body.metadata || null,
  });
  const progress = await saveTaskProgress(context, metadata);

  return buildTaskDetailResponse(
    context.actor,
    context.targetRole,
    context.taskMatch,
    progress,
  );
}

async function startPractice(actor, taskKey, body = {}, tenant = null) {
  const context = await getTaskProgressContext(actor, taskKey, body.role, tenant);
  const now = new Date().toISOString();
  const content = getGuidedContent(context.taskMatch.task);

  if (content.practice.steps.length === 0) {
    throw appError('Практический режим для этой инструкции отключен', 404);
  }

  if (content.practice.autoTrainingMode) {
    await setTrainingMode(context.actor, {
      isEnabled: true,
      metadata: {
        source: 'onboarding-practice',
        taskKey,
      },
      role: context.targetRole,
    }, tenant);
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
    context.actor,
    context.targetRole,
    context.taskMatch,
    progress,
  );
}

async function completePracticeStep(actor, taskKey, stepKey, body = {}, tenant = null) {
  const context = await getTaskProgressContext(actor, taskKey, body.role, tenant);
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
    context.actor,
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

async function submitQuizAttempt(actor, taskKey, body = {}, tenant = null) {
  const context = await getTaskProgressContext(actor, taskKey, body.role, tenant);
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
      context.actor,
      context.targetRole,
      context.taskMatch,
      progress,
    ),
  };
}

async function recordEventForTarget(actor, target, eventKey, options = {}) {
  const payload = options.payload || {};
  const idempotencyKey = crypto.createHash('sha256').update(JSON.stringify({
    clubId: target.authority.clubId,
    entityId: options.entityId == null ? null : String(options.entityId),
    entityType: options.entityType || null,
    eventKey,
    membershipId: target.authority.membershipId,
    role: target.role,
    taskKey: payload.taskKey || null,
    trainingSessionId: target.trainingSessionId || null,
  })).digest('hex');
  const existingEvent = typeof db.OnboardingEvent.findOne === 'function'
    ? await db.OnboardingEvent.findOne({
    lock: options.transaction ? options.transaction.LOCK?.UPDATE : undefined,
    transaction: options.transaction,
    where: {
      idempotencyKey,
      membershipId: target.authority.membershipId,
      organizationId: target.authority.organizationId,
    },
    })
    : null;
  if (existingEvent) {
    return {
      completedTaskKeys: existingEvent.completedTaskKeys || [],
      event: existingEvent,
      progressedTaskKeys: [],
      role: target.role,
    };
  }
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
    const progress = await upsertTaskProgress(target.actor, target.role, task, {
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
    }, options.tenant, target.authority, {
      lock: true,
      transaction: options.transaction,
    });
    progressedTaskKeys.push(task.key);
    if (getPlainProgress(progress)?.status === 'completed') {
      completedTaskKeys.push(task.key);
    }
  }

  const event = await db.OnboardingEvent.create(
    {
      accountId: target.authority.accountId,
      clubId: target.authority.clubId,
      completedTaskKeys,
      entityId: options.entityId == null ? null : String(options.entityId),
      entityType: options.entityType || null,
      eventKey,
      idempotencyKey,
      isTraining: target.isTraining,
      membershipId: target.authority.membershipId,
      organizationId: target.authority.organizationId,
      payload,
      role: target.role,
      trainingSessionId: target.trainingSessionId,
    },
    { transaction: options.transaction },
  );

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

  return db.sequelize.transaction(async (transaction) => {
    const scope = options.tenant?.scope || TENANT_SCOPES.CLUB;
    const currentTarget = await getEventTargetContext(
      actor,
      options.tenant,
      scope,
      { lock: true, transaction },
    );
    const requestedRole = options.onboardingContext?.role;
    const targetRole = requestedRole
      ? resolveTargetRole(currentTarget.actor, requestedRole)
      : currentTarget.role;
    const isTraining = currentTarget.isTraining && currentTarget.role === targetRole;
    const target = {
      actor: currentTarget.actor,
      authority: currentTarget.authority,
      isTraining,
      role: targetRole,
      trainingSessionId: isTraining ? currentTarget.trainingSessionId : null,
    };
    const taskKey = options.onboardingContext?.taskKey;

    return recordEventForTarget(actor, target, eventKey, {
      ...options,
      payload: {
        ...(options.payload || {}),
        ...(taskKey ? { taskKey } : {}),
      },
      transaction,
    });
  });
}

async function recordClientEvent(actor, body = {}, tenant = null) {

  const eventKey = normalizeClientEventKey(body.eventKey);
  return db.sequelize.transaction(async (transaction) => {
    const currentTarget = await getEventTargetContext(
      actor,
      tenant,
      TENANT_SCOPES.CLUB,
      { lock: true, transaction },
    );
    const targetRole = body.role
      ? resolveTargetRole(currentTarget.actor, body.role)
      : currentTarget.role;
    const isTraining = currentTarget.isTraining && currentTarget.role === targetRole;
    const target = {
      actor: currentTarget.actor,
      authority: currentTarget.authority,
      isTraining,
      role: targetRole,
      trainingSessionId: isTraining ? currentTarget.trainingSessionId : null,
    };

    return recordEventForTarget(actor, target, eventKey, {
      entityId: body.entityId || null,
      entityType: body.entityType || 'client_route',
      payload: {
        ...(body.payload || {}),
        source: 'client',
      },
      tenant,
      transaction,
    });
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

async function resetProgress(actor, query = {}, tenant = null) {
  const boundary = await resolveBoundary(actor, tenant, TENANT_SCOPES.MEMBERSHIP);
  const targetRole = resolveTargetRole(boundary.actor, query.role);
  await db.OnboardingProgress.destroy({
    where: {
      membershipId: boundary.authority.membershipId,
      role: targetRole,
    },
  });

  return getOverview(boundary.actor, { role: targetRole }, tenant);
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
