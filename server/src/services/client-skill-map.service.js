const db = require('../../models');
const {
  TRAINING_EXERCISE_E_LEVEL_VALUES,
} = require('../constants/training-methodology');
const {
  isTenantMethodologySkillMapEnabled,
} = require('../tenant-context/capabilities');
const {
  resolveClientAccessContext,
} = require('./client-access-context.service');
const {
  bindMethodologyActor,
  methodologyTenantWhere,
  resolveMethodologyAccessContext,
  validateBookingPlanRecommendationDelegation,
} = require('./methodology-access-context.service');

const VIEW_ROLES = new Set(['owner', 'manager', 'trainer']);
const MANAGE_ROLES = new Set(['owner', 'manager', 'trainer']);
const MAX_SKILL_LEVEL = 5;
const AUTO_HISTORY_SOURCE = 'structured_training';
const HIGH_RATINGS = new Set([4, 5]);

function appError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function assertCanView(actor) {
  if (!VIEW_ROLES.has(actor?.role)) {
    throw appError('Недостаточно прав для просмотра карты навыков клиента', 403);
  }
}

function assertCanManage(actor) {
  if (!MANAGE_ROLES.has(actor?.role)) {
    throw appError('Недостаточно прав для обновления карты навыков клиента', 403);
  }
}

function normalizeSkillLevel(value) {
  const level = Number(value);
  if (!Number.isInteger(level) || level < 0 || level > 5) {
    throw appError('Уровень навыка должен быть от 0 до 5');
  }
  return level;
}

function normalizeDateOnly(value) {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;

  const date = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw appError('Дата последней отработки должна быть в формате YYYY-MM-DD');
  }
  return date;
}

function normalizeNullableText(value, label) {
  if (value === undefined) return undefined;
  if (value === null) return null;

  const text = String(value).trim();
  if (!text) return null;
  if (text.length > 4000) throw appError(`${label} слишком длинное`);
  return text;
}

function normalizeRepeatFlag(value) {
  if (value === undefined) return undefined;
  if (typeof value === 'boolean') return value;
  if (value === 'true' || value === '1') return true;
  if (value === 'false' || value === '0') return false;
  throw appError('Некорректный repeat flag');
}

function normalizeNextEStep(value) {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;

  const step = String(value).trim();
  if (!TRAINING_EXERCISE_E_LEVEL_VALUES.includes(step)) {
    throw appError('Некорректный следующий E-step');
  }
  return step;
}

function normalizeUpdatePayload(data = {}, actor = null) {
  const payload = {};

  if ('level' in data) payload.level = normalizeSkillLevel(data.level);
  if ('lastTrainedAt' in data) payload.lastTrainedAt = normalizeDateOnly(data.lastTrainedAt);
  if ('latestExercises' in data) {
    payload.latestExercises = normalizeNullableText(
      data.latestExercises,
      'Описание последних упражнений',
    );
  }
  if ('latestAssessment' in data) {
    payload.latestAssessment = normalizeNullableText(
      data.latestAssessment,
      'Последняя оценка',
    );
  }
  if ('repeatFlag' in data) payload.repeatFlag = normalizeRepeatFlag(data.repeatFlag);
  if ('nextEStep' in data) payload.nextEStep = normalizeNextEStep(data.nextEStep);

  if (Object.keys(payload).length === 0) {
    throw appError('Нет данных для обновления карты навыков');
  }

  payload.updatedByAccountId = actor?.id || null;
  return payload;
}

function getClientTrainingMarker(client) {
  const raw = client?.toJSON ? client.toJSON() : client;

  return {
    isTraining: Boolean(raw?.isTraining),
    trainingAccountId: raw?.trainingAccountId || null,
    trainingRole: raw?.trainingRole || null,
    trainingSessionId: raw?.trainingSessionId || null,
  };
}

function getEStepIndex(step) {
  return TRAINING_EXERCISE_E_LEVEL_VALUES.indexOf(step);
}

function getExpectedEStep(level) {
  return TRAINING_EXERCISE_E_LEVEL_VALUES[Math.min(Number(level || 0), MAX_SKILL_LEVEL)] || null;
}

function getPreviousEStep(step) {
  const index = getEStepIndex(step);
  if (index <= 0) return TRAINING_EXERCISE_E_LEVEL_VALUES[0] || null;
  return TRAINING_EXERCISE_E_LEVEL_VALUES[index - 1] || null;
}

function isSkillLevelInExerciseRange(result, level) {
  const min = result.skillLevelMin;
  const max = result.skillLevelMax;
  if (min !== null && min !== undefined && Number(level) < Number(min)) return false;
  if (max !== null && max !== undefined && Number(level) > Number(max)) return false;
  return true;
}

function isHighRating(rating) {
  return HIGH_RATINGS.has(Number(rating));
}

function hasRepeat(result) {
  return Boolean(result.repeatSkill || result.repeatExercise);
}

function isSuitableResult(result, level) {
  return (
    result.eLevel === getExpectedEStep(level) &&
    isSkillLevelInExerciseRange(result, level)
  );
}

function buildAssessmentText(result, decision) {
  const exerciseName = result.exerciseNameSnapshot || 'Упражнение';
  const prefix = `${exerciseName}: ${result.rating}/5`;
  return `${prefix}. ${decision.explanation}`;
}

function buildHistoryDecision({
  changeType,
  explanation,
  previousLevel,
  result,
  state,
}) {
  return {
    changeType,
    eLevel: result.eLevel || null,
    exerciseNameSnapshot: result.exerciseNameSnapshot || null,
    explanation,
    nextEStep: state.nextEStep || null,
    nextLevel: state.level,
    occurredAt: result.trainedAt || null,
    previousLevel,
    rating: Number(result.rating),
    repeatFlag: Boolean(state.repeatFlag),
    trainingNoteExerciseId: result.trainingNoteExerciseId || null,
    trainingNoteId: result.trainingNoteId || null,
  };
}

function compareSkillResults(left, right) {
  const leftDate = String(left.trainedAt || '');
  const rightDate = String(right.trainedAt || '');
  if (leftDate !== rightDate) return leftDate.localeCompare(rightDate);
  const leftCreated = new Date(left.trainingNoteCreatedAt || 0).getTime();
  const rightCreated = new Date(right.trainingNoteCreatedAt || 0).getTime();
  if (leftCreated !== rightCreated) return leftCreated - rightCreated;
  if (Number(left.trainingNoteId || 0) !== Number(right.trainingNoteId || 0)) {
    return Number(left.trainingNoteId || 0) - Number(right.trainingNoteId || 0);
  }
  return Number(left.orderIndex || 0) - Number(right.orderIndex || 0);
}

function buildAutoSkillMapState({ baselineLevel = 0, results = [] }) {
  const normalizedBaseline = normalizeSkillLevel(baselineLevel);
  const state = {
    history: [],
    lastTrainedAt: null,
    latestAssessment: null,
    latestExercises: null,
    level: normalizedBaseline,
    nextEStep: getExpectedEStep(normalizedBaseline),
    repeatFlag: false,
  };
  let recentSuitableResults = [];

  for (const result of [...results].sort(compareSkillResults)) {
    const rating = Number(result.rating);
    const previousLevel = state.level;
    const expectedEStep = getExpectedEStep(state.level);
    const suitable = isSuitableResult(result, state.level);
    let changeType = 'hold';
    let explanation = '';

    state.lastTrainedAt = result.trainedAt || state.lastTrainedAt;
    state.latestExercises = result.exerciseNameSnapshot || state.latestExercises;

    if (rating <= 2) {
      state.repeatFlag = true;
      state.nextEStep = getPreviousEStep(result.eLevel) || expectedEStep;
      recentSuitableResults = [];
      changeType = 'repeat';
      explanation = `Оценка ${rating}/5 не снижает уровень ${previousLevel}, ставит repeat и предлагает ${state.nextEStep || 'закрепление'} на ступень ниже.`;
    } else if (rating === 3) {
      state.repeatFlag = false;
      state.nextEStep = result.eLevel || expectedEStep;
      recentSuitableResults = [];
      changeType = 'consolidate';
      explanation = `Оценка 3/5 оставляет уровень ${previousLevel}; нужно закрепить ${state.nextEStep || 'текущий шаг'}.`;
    } else if (hasRepeat(result)) {
      state.repeatFlag = true;
      state.nextEStep = result.eLevel || expectedEStep;
      recentSuitableResults = [];
      changeType = 'blocked';
      explanation = `Оценка ${rating}/5 не повышает уровень из-за repeat по навыку или упражнению.`;
    } else if (!suitable) {
      state.repeatFlag = false;
      state.nextEStep = expectedEStep;
      recentSuitableResults = [];
      changeType = 'blocked';
      explanation = `Оценка ${rating}/5 не повышает уровень: нужен E-level ${expectedEStep || '-'} для текущего уровня ${previousLevel}.`;
    } else if (state.level >= MAX_SKILL_LEVEL) {
      state.repeatFlag = false;
      state.nextEStep = null;
      recentSuitableResults = [];
      changeType = 'max_level';
      explanation = `Оценка ${rating}/5 подтверждает навык, но уровень уже максимальный.`;
    } else {
      recentSuitableResults = [...recentSuitableResults, result].slice(-2);
      state.repeatFlag = false;

      if (
        recentSuitableResults.length === 2 &&
        recentSuitableResults.every((item) => isHighRating(item.rating) && !hasRepeat(item))
      ) {
        state.level += 1;
        state.nextEStep = getExpectedEStep(state.level);
        recentSuitableResults = [];
        changeType = 'advanced';
        explanation = `Последние две подходящие оценки 4/5 или 5/5 без repeat повышают уровень с ${previousLevel} до ${state.level}.`;
      } else {
        state.nextEStep = expectedEStep;
        explanation = `Оценка ${rating}/5 засчитана; для повышения нужна еще одна подходящая оценка 4/5 или 5/5 без repeat.`;
      }
    }

    const decision = buildHistoryDecision({
      changeType,
      explanation,
      previousLevel,
      result,
      state,
    });
    state.latestAssessment = buildAssessmentText(result, decision);
    state.history.push(decision);
  }

  return state;
}

function mapSkill(skill) {
  if (!skill) return null;
  const raw = skill.toJSON ? skill.toJSON() : skill;

  return {
    description: raw.description || '',
    direction: raw.direction,
    id: raw.id,
    name: raw.name,
    status: raw.status,
  };
}

function mapHistoryEntry(historyEntry) {
  const raw = historyEntry.toJSON ? historyEntry.toJSON() : historyEntry;

  return {
    changeType: raw.changeType,
    createdAt: raw.createdAt,
    eLevel: raw.eLevel || null,
    exerciseNameSnapshot: raw.exerciseNameSnapshot || '',
    explanation: raw.explanation || '',
    id: raw.id,
    nextEStep: raw.nextEStep || null,
    nextLevel: Number(raw.nextLevel || 0),
    occurredAt: raw.occurredAt || null,
    previousLevel: Number(raw.previousLevel || 0),
    rating: raw.rating === null || raw.rating === undefined ? null : Number(raw.rating),
    repeatFlag: Boolean(raw.repeatFlag),
    source: raw.source,
    trainingNoteExerciseId: raw.trainingNoteExerciseId || null,
    trainingNoteId: raw.trainingNoteId || null,
  };
}

function mapEntry(entry) {
  const raw = entry.toJSON ? entry.toJSON() : entry;

  return {
    id: raw.id,
    skill: mapSkill(raw.skill),
    skillId: raw.trainingSkillId,
    level: Number(raw.level || 0),
    lastTrainedAt: raw.lastTrainedAt || null,
    latestExercises: raw.latestExercises || '',
    latestAssessment: raw.latestAssessment || '',
    repeatFlag: Boolean(raw.repeatFlag),
    nextEStep: raw.nextEStep || null,
    history: (raw.history || []).map(mapHistoryEntry),
    updatedAt: raw.updatedAt,
  };
}

async function loadClientOrFail(clientId, context, options = {}) {
  const where = methodologyTenantWhere(context, { id: Number(clientId) });
  if (!options.includeMerged) where.mergedIntoUserId = null;

  const client = await db.User.findOne({
    attributes: [
      'id',
      'organizationId',
      'status',
      'mergedIntoUserId',
      'isTraining',
      'trainingRole',
      'trainingAccountId',
      'trainingSessionId',
    ],
    lock: options.lock,
    transaction: options.transaction,
    where,
  });

  if (!client) throw appError('Клиент не найден', 404);
  return client;
}

async function syncActiveSkillsForClientWithContext(client, context, options = {}) {
  if (!db.ClientTrainingSkill || !db.TrainingSkill || !client?.id) return;
  if (Number(client.organizationId) !== Number(context?.organizationId)) {
    if (context?.readScoped) throw appError('Клиент не найден', 404);
    return;
  }

  const activeSkills = await db.TrainingSkill.findAll({
    attributes: ['id'],
    transaction: options.transaction,
    where: methodologyTenantWhere(context, { status: 'active' }),
  });
  if (activeSkills.length === 0) return;

  const existingRows = await db.ClientTrainingSkill.findAll({
    attributes: ['trainingSkillId'],
    transaction: options.transaction,
    where: { userId: client.id },
  });
  const existingSkillIds = new Set(
    existingRows.map((row) => Number(row.trainingSkillId)),
  );
  const missingRows = activeSkills
    .map((skill) => Number(skill.id))
    .filter((skillId) => !existingSkillIds.has(skillId))
    .map((skillId) => ({
      ...getClientTrainingMarker(client),
      level: 0,
      trainingSkillId: skillId,
      userId: client.id,
    }));

  if (missingRows.length === 0) return;

  await db.ClientTrainingSkill.bulkCreate(missingRows, {
    ignoreDuplicates: true,
    transaction: options.transaction,
  });
}

async function syncActiveSkillsForClient(client, options = {}) {
  const context = await resolveMethodologyAccessContext(options.tenant, options);
  return syncActiveSkillsForClientWithContext(client, context, options);
}

async function syncActiveSkillsForClientFromProvider(client, options = {}) {
  if (!isTenantMethodologySkillMapEnabled()) {
    return syncActiveSkillsForClient(client, { ...options, tenant: null });
  }
  const providerContext = await resolveClientAccessContext(
    options.tenant,
    options,
  );
  if (
    providerContext.authority !== 'provider' ||
    !providerContext.scoped ||
    !providerContext.connectionId ||
    !providerContext.organizationId
  ) {
    const error = appError('Клиент не найден', 404);
    error.code = 'TENANT_CONTEXT_NOT_FOUND';
    throw error;
  }
  return syncActiveSkillsForClientWithContext(
    client,
    {
      organizationId: providerContext.organizationId,
      readScoped: true,
    },
    options,
  );
}

async function syncActiveSkillsForClientId(clientId, options = {}) {
  const context = await resolveMethodologyAccessContext(options.tenant, options);
  const client = options.client || await loadClientOrFail(clientId, context, {
    includeMerged: Boolean(options.includeMerged),
  });

  if (client.mergedIntoUserId && !options.includeMerged) return;
  await syncActiveSkillsForClientWithContext(client, context, options);
}

async function listForClient(clientId, actor, options = {}) {
  const context = await resolveMethodologyAccessContext(options.tenant, options);
  const authorityActor = options.bookingPlanRecommendationDelegation
    ? validateBookingPlanRecommendationDelegation(
        options.bookingPlanRecommendationDelegation,
        actor,
        context,
      )
    : bindMethodologyActor(actor, context);
  if (!options.bookingPlanRecommendationDelegation) assertCanView(authorityActor);
  const client = await loadClientOrFail(clientId, context, { includeMerged: true });

  if (!client.mergedIntoUserId && options.sync !== false) {
    await syncActiveSkillsForClientWithContext(client, context, options);
  }

  const rows = await db.ClientTrainingSkill.findAll({
    include: [
      {
        as: 'skill',
        model: db.TrainingSkill,
        required: true,
        where: methodologyTenantWhere(context, { status: 'active' }),
      },
      ...(db.ClientTrainingSkillHistory
        ? [
            {
              as: 'history',
              limit: 20,
              model: db.ClientTrainingSkillHistory,
              order: [
                ['createdAt', 'DESC'],
                ['id', 'DESC'],
              ],
              required: false,
              separate: true,
            },
          ]
        : []),
    ],
    where: { userId: client.id },
  });

  return rows
    .map(mapEntry)
    .sort((a, b) => {
      const directionCompare = String(a.skill?.direction || '').localeCompare(
        String(b.skill?.direction || ''),
      );
      if (directionCompare !== 0) return directionCompare;
      return String(a.skill?.name || '').localeCompare(String(b.skill?.name || ''));
    });
}

function mapStructuredResult(row) {
  const raw = row.toJSON ? row.toJSON() : row;
  const note = raw.trainingNote || {};
  const exercise = raw.exercise || {};

  return {
    canAdvance: Boolean(raw.canAdvance),
    eLevel: exercise.eLevel || null,
    exerciseNameSnapshot:
      raw.exerciseNameSnapshot || exercise.name || 'Упражнение',
    orderIndex: Number(raw.orderIndex || 0),
    rating: Number(raw.rating),
    repeatExercise: Boolean(raw.repeatExercise),
    repeatSkill: Boolean(raw.repeatSkill),
    skillLevelMax:
      exercise.skillLevelMax === null || exercise.skillLevelMax === undefined
        ? null
        : Number(exercise.skillLevelMax),
    skillLevelMin:
      exercise.skillLevelMin === null || exercise.skillLevelMin === undefined
        ? null
        : Number(exercise.skillLevelMin),
    trainingNoteCreatedAt: note.createdAt || null,
    trainingNoteExerciseId: raw.id,
    trainingNoteId: raw.trainingNoteId,
    trainedAt: note.trainedAt || null,
    trainingSkillId: exercise.mainSkillId ? Number(exercise.mainSkillId) : null,
  };
}

async function loadStructuredSkillResults(clientId, context, options = {}) {
  if (!db.TrainingNoteExercise || !db.TrainingExercise || !db.TrainingNote) {
    return [];
  }

  const rows = await db.TrainingNoteExercise.findAll({
    include: [
      {
        as: 'trainingNote',
        attributes: ['id', 'userId', 'trainedAt', 'createdAt'],
        model: db.TrainingNote,
        required: true,
        where: { userId: Number(clientId) },
      },
      {
        as: 'exercise',
        attributes: [
          'id',
          'name',
          'mainSkillId',
          'eLevel',
          'skillLevelMin',
          'skillLevelMax',
        ],
        model: db.TrainingExercise,
        required: true,
        where: methodologyTenantWhere(context, {}),
      },
    ],
    transaction: options.transaction,
  });

  return rows
    .map(mapStructuredResult)
    .filter((result) => result.trainingSkillId)
    .sort(compareSkillResults);
}

function groupResultsBySkillId(results) {
  const grouped = new Map();
  for (const result of results) {
    const skillId = Number(result.trainingSkillId);
    if (!grouped.has(skillId)) grouped.set(skillId, []);
    grouped.get(skillId).push(result);
  }
  return grouped;
}

async function loadAutoHistorySkillIds(clientId, context, options = {}) {
  if (!db.ClientTrainingSkillHistory) return new Set();
  const rows = await db.ClientTrainingSkillHistory.findAll({
    attributes: ['trainingSkillId'],
    group: ['trainingSkillId'],
    include: context?.readScoped
      ? [{
          as: 'skill',
          attributes: [],
          model: db.TrainingSkill,
          required: true,
          where: { organizationId: context.organizationId },
        }]
      : undefined,
    raw: true,
    transaction: options.transaction,
    where: {
      source: AUTO_HISTORY_SOURCE,
      userId: Number(clientId),
    },
  });

  return new Set(rows.map((row) => Number(row.trainingSkillId)));
}

function buildHistoryRows(entry, history, actor, clientMarker) {
  return history.map((decision) => ({
    ...decision,
    ...clientMarker,
    clientTrainingSkillId: entry.id,
    source: AUTO_HISTORY_SOURCE,
    trainingSkillId: Number(entry.trainingSkillId),
    updatedByAccountId: actor?.id || null,
    userId: Number(entry.userId),
  }));
}

async function replaceAutoHistory(entry, history, actor, clientMarker, options = {}) {
  if (!db.ClientTrainingSkillHistory) return;

  await db.ClientTrainingSkillHistory.destroy({
    transaction: options.transaction,
    where: {
      source: AUTO_HISTORY_SOURCE,
      trainingSkillId: Number(entry.trainingSkillId),
      userId: Number(entry.userId),
    },
  });

  if (history.length === 0) return;

  await db.ClientTrainingSkillHistory.bulkCreate(
    buildHistoryRows(entry, history, actor, clientMarker),
    { transaction: options.transaction },
  );
}

async function recordManualHistory(entry, previousEntry, payload, actor, options = {}) {
  if (!db.ClientTrainingSkillHistory) return;

  const previousLevel = Number(previousEntry.level || 0);
  const nextLevel = Number(entry.level || 0);
  const changedFields = Object.keys(payload)
    .filter((key) => key !== 'updatedByAccountId')
    .sort();

  await db.ClientTrainingSkillHistory.create({
    ...getClientTrainingMarker(entry),
    changeType: 'manual_update',
    clientTrainingSkillId: entry.id,
    eLevel: null,
    exerciseNameSnapshot: null,
    explanation: changedFields.length > 0
      ? `Ручное обновление карты навыков: ${changedFields.join(', ')}.`
      : 'Ручное обновление карты навыков.',
    nextEStep: entry.nextEStep || null,
    nextLevel,
    occurredAt: entry.lastTrainedAt || null,
    previousLevel,
    rating: null,
    repeatFlag: Boolean(entry.repeatFlag),
    source: 'manual',
    trainingNoteExerciseId: null,
    trainingNoteId: null,
    trainingSkillId: Number(entry.trainingSkillId),
    updatedByAccountId: actor?.id || null,
    userId: Number(entry.userId),
  }, { transaction: options.transaction });
}

async function recalculateFromStructuredTraining(clientId, actor, options = {}) {
  const context = await resolveMethodologyAccessContext(options.tenant, options);
  const authorityActor = bindMethodologyActor(actor, context);
  const client = options.client || await loadClientOrFail(clientId, context, {
    includeMerged: Boolean(options.includeMerged),
  });
  if (client.mergedIntoUserId && !options.includeMerged) return;

  await syncActiveSkillsForClientWithContext(client, context, options);

  const entries = await db.ClientTrainingSkill.findAll({
    include: [
      {
        as: 'skill',
        model: db.TrainingSkill,
        required: true,
        where: methodologyTenantWhere(context, { status: 'active' }),
      },
    ],
    transaction: options.transaction,
    where: { userId: client.id },
  });
  const results = await loadStructuredSkillResults(client.id, context, options);
  const autoHistorySkillIds = await loadAutoHistorySkillIds(client.id, context, options);
  const resultsBySkillId = groupResultsBySkillId(results);
  const clientMarker = getClientTrainingMarker(client);

  for (const entry of entries) {
    const skillId = Number(entry.trainingSkillId);
    const skillResults = resultsBySkillId.get(skillId) || [];
    const hasAutoState =
      (entry.autoBaselineLevel !== null &&
        entry.autoBaselineLevel !== undefined) ||
      autoHistorySkillIds.has(skillId);
    if (skillResults.length === 0 && !hasAutoState) continue;

    const baselineLevel =
      entry.autoBaselineLevel === null || entry.autoBaselineLevel === undefined
        ? Number(entry.level || 0)
        : Number(entry.autoBaselineLevel);
    const nextState =
      skillResults.length === 0
        ? {
            history: [],
            lastTrainedAt: null,
            latestAssessment: null,
            latestExercises: null,
            level: baselineLevel,
            nextEStep: null,
            repeatFlag: false,
          }
        : buildAutoSkillMapState({
            baselineLevel,
            results: skillResults,
          });

    await entry.update(
      {
        autoBaselineLevel: skillResults.length === 0 ? null : baselineLevel,
        lastTrainedAt: nextState.lastTrainedAt,
        latestAssessment: nextState.latestAssessment,
        latestExercises: nextState.latestExercises,
        level: nextState.level,
        nextEStep: nextState.nextEStep,
        repeatFlag: nextState.repeatFlag,
        updatedByAccountId: authorityActor?.id || entry.updatedByAccountId || null,
      },
      { transaction: options.transaction },
    );

    await replaceAutoHistory(
      entry,
      nextState.history,
      authorityActor,
      clientMarker,
      options,
    );
  }
}

async function updateEntry(clientId, skillId, data, actor, tenant = null) {
  await db.sequelize.transaction(async (transaction) => {
    const context = await resolveMethodologyAccessContext(tenant, {
      lock: true,
      transaction,
    });
    const authorityActor = bindMethodologyActor(actor, context);
    assertCanManage(authorityActor);
    const payload = normalizeUpdatePayload(data, authorityActor);
    const client = await loadClientOrFail(clientId, context, {
      lock: transaction.LOCK.UPDATE,
      transaction,
    });
    if (client.status === 'archived') {
      throw appError('Архивный клиент доступен только для просмотра', 409);
    }
    if (Number(client.organizationId) !== Number(context.organizationId)) {
      throw appError('Клиент не найден', 404);
    }
    const skill = await db.TrainingSkill.findOne({
      lock: transaction.LOCK.UPDATE,
      transaction,
      where: methodologyTenantWhere(context, {
        id: Number(skillId),
        status: 'active',
      }, { force: true }),
    });
    if (!skill) throw appError('Активный навык не найден', 404);
    await syncActiveSkillsForClientWithContext(client, context, { transaction });
    const [entry] = await db.ClientTrainingSkill.findOrCreate({
      defaults: {
        ...getClientTrainingMarker(client),
        level: 0,
      },
      transaction,
      where: {
        trainingSkillId: Number(skillId),
        userId: client.id,
      },
    });
    const previousEntry = entry.toJSON ? entry.toJSON() : { ...entry };
    await entry.update({
      ...payload,
      ...('level' in payload ? { autoBaselineLevel: payload.level } : {}),
    }, { transaction });
    await recordManualHistory(
      entry,
      previousEntry,
      payload,
      authorityActor,
      { transaction },
    );
  });
  return listForClient(clientId, actor, { sync: false, tenant });
}

module.exports = {
  listForClient,
  recalculateFromStructuredTraining,
  syncActiveSkillsForClient,
  syncActiveSkillsForClientFromProvider,
  syncActiveSkillsForClientId,
  updateEntry,
  __testing: {
    buildAutoSkillMapState,
    compareSkillResults,
    getExpectedEStep,
    getPreviousEStep,
    isSkillLevelInExerciseRange,
    isSuitableResult,
    normalizeDateOnly,
    normalizeNextEStep,
    normalizeRepeatFlag,
    normalizeSkillLevel,
    normalizeUpdatePayload,
  },
};
