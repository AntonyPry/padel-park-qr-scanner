const db = require('../../models');
const clientSkillMapService = require('./client-skill-map.service');
const onboardingService = require('./onboarding.service');
const { Op } = require('sequelize');

const LEVELS = new Set(['D', 'D+', 'C', 'C+', 'B', 'B+', 'A']);
const EXERCISE_RESULT_COMMENT_MAX_LENGTH = 240;

function appError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function normalizeDateOnly(value) {
  const date = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw appError('Укажите дату тренировки в формате YYYY-MM-DD');
  }

  return date;
}

function normalizeLevel(level) {
  const normalized = String(level || '').trim().toUpperCase();
  if (!LEVELS.has(normalized)) {
    throw appError('Некорректный уровень игрока');
  }

  return normalized;
}

function normalizeText(value) {
  const text = String(value || '').trim();
  return text || null;
}

function normalizeShortComment(value) {
  const text = normalizeText(value);
  if (text && text.length > EXERCISE_RESULT_COMMENT_MAX_LENGTH) {
    throw appError(
      `Комментарий по упражнению должен быть не длиннее ${EXERCISE_RESULT_COMMENT_MAX_LENGTH} символов`,
    );
  }

  return text;
}

function normalizeBoolean(value) {
  if (value === true || value === 'true' || value === 1 || value === '1') {
    return true;
  }
  return false;
}

function normalizePositiveId(value, label) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    throw appError(`Некорректный ${label}`);
  }

  return id;
}

function normalizeRating(value) {
  const rating = Number(value);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    throw appError('Оценка упражнения должна быть от 1 до 5');
  }

  return rating;
}

function normalizeExerciseResults(value) {
  if (value === undefined) return null;
  if (!Array.isArray(value)) {
    throw appError('Передайте список упражнений тренировки');
  }

  const seenExerciseIds = new Set();
  return value.map((item, index) => {
    const trainingExerciseId = normalizePositiveId(
      item?.trainingExerciseId ?? item?.exerciseId,
      'ID упражнения',
    );
    if (seenExerciseIds.has(trainingExerciseId)) {
      throw appError('Одно упражнение нельзя добавить в тренировку дважды');
    }
    seenExerciseIds.add(trainingExerciseId);

    return {
      canAdvance: normalizeBoolean(item?.canAdvance),
      comment: normalizeShortComment(item?.comment),
      orderIndex: index,
      rating: normalizeRating(item?.rating),
      repeatExercise: normalizeBoolean(item?.repeatExercise),
      repeatSkill: normalizeBoolean(item?.repeatSkill),
      trainingExerciseId,
    };
  });
}

function mapExerciseLite(exercise, fallbackName = '') {
  if (!exercise && !fallbackName) return null;
  const raw = exercise?.toJSON ? exercise.toJSON() : exercise;
  const mainSkill = raw?.mainSkill;

  return {
    eLevel: raw?.eLevel || null,
    id: raw?.id || null,
    mainSkill: mainSkill
      ? {
          direction: mainSkill.direction,
          id: mainSkill.id,
          name: mainSkill.name,
        }
      : null,
    name: raw?.name || fallbackName || 'Упражнение',
    status: raw?.status || null,
  };
}

function mapExerciseResult(result) {
  const raw = result.toJSON ? result.toJSON() : result;
  const exercise = mapExerciseLite(raw.exercise, raw.exerciseNameSnapshot);

  return {
    canAdvance: Boolean(raw.canAdvance),
    comment: raw.comment || '',
    exercise,
    exerciseName: exercise?.name || raw.exerciseNameSnapshot || 'Упражнение',
    id: raw.id,
    orderIndex: raw.orderIndex || 0,
    rating: raw.rating,
    repeatExercise: Boolean(raw.repeatExercise),
    repeatSkill: Boolean(raw.repeatSkill),
    trainingExerciseId: raw.trainingExerciseId,
  };
}

function mapTrainingNote(note) {
  const raw = note.toJSON ? note.toJSON() : note;
  const trainer = raw.trainerAccount;
  const exerciseResults = (raw.exerciseResults || [])
    .map(mapExerciseResult)
    .sort((left, right) => left.orderIndex - right.orderIndex);

  return {
    id: raw.id,
    trainedAt: raw.trainedAt,
    level: raw.level,
    exercises: raw.exercises || '',
    exerciseResults,
    note: raw.note || '',
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    trainer: trainer
      ? {
          id: trainer.id,
          name: trainer.Staff?.name || 'Тренер',
          role: trainer.role,
        }
      : null,
  };
}

function trainingNoteInclude() {
  return [
    {
      model: db.Account,
      as: 'trainerAccount',
      attributes: ['id', 'role', 'staffId'],
      include: [{ model: db.Staff, attributes: ['id', 'name'] }],
    },
    {
      model: db.TrainingNoteExercise,
      as: 'exerciseResults',
      include: [
        {
          model: db.TrainingExercise,
          as: 'exercise',
          attributes: ['id', 'name', 'eLevel', 'status', 'mainSkillId'],
          include: [
            {
              model: db.TrainingSkill,
              as: 'mainSkill',
              attributes: ['id', 'name', 'direction'],
            },
          ],
        },
      ],
    },
  ];
}

async function loadApprovedExercisesByIds(ids) {
  if (ids.length === 0) return new Map();

  const rows = await db.TrainingExercise.findAll({
    attributes: ['id', 'name', 'status'],
    where: {
      id: { [Op.in]: ids },
      status: 'approved',
    },
  });
  if (rows.length !== ids.length) {
    throw appError('Выберите упражнения из утвержденной базы');
  }

  return new Map(rows.map((exercise) => [Number(exercise.id), exercise]));
}

function getExerciseNames(exerciseResults, exerciseById) {
  return exerciseResults
    .map((result) => exerciseById.get(Number(result.trainingExerciseId))?.name)
    .filter(Boolean)
    .join(', ');
}

function buildExerciseResultRows(trainingNoteId, exerciseResults, exerciseById) {
  return exerciseResults.map((result) => ({
    ...result,
    exerciseNameSnapshot:
      exerciseById.get(Number(result.trainingExerciseId))?.name || 'Упражнение',
    trainingNoteId,
  }));
}

async function withTransaction(options, callback) {
  if (options?.transaction) {
    return callback(options.transaction);
  }

  return db.sequelize.transaction(callback);
}

async function assertClientExists(clientId) {
  const client = await db.User.findOne({
    where: {
      id: Number(clientId),
      mergedIntoUserId: null,
    },
  });

  if (!client) throw appError('Клиент не найден', 404);
  return client;
}

async function listByClient(clientId, options = {}) {
  if (!options.skipClientCheck) {
    await assertClientExists(clientId);
  }

  const notes = await db.TrainingNote.findAll({
    where: { userId: Number(clientId) },
    include: trainingNoteInclude(),
    order: [
      ['trainedAt', 'DESC'],
      ['createdAt', 'DESC'],
    ],
    limit: options.limit || 100,
  });

  return notes.map(mapTrainingNote);
}

async function getNoteOrFail(noteId) {
  const note = await db.TrainingNote.findByPk(Number(noteId), {
    include: [
      {
        model: db.User,
        attributes: [
          'id',
          'status',
          'mergedIntoUserId',
          'isTraining',
          'trainingRole',
          'trainingAccountId',
        ],
      },
      ...trainingNoteInclude(),
    ],
  });

  if (!note) throw appError('Запись тренировки не найдена', 404);
  return note;
}

function assertCanChangeNote(note, actor) {
  if (['owner', 'manager'].includes(actor?.role)) return;
  if (actor?.role === 'trainer' && Number(note.trainerAccountId) === Number(actor.id)) {
    return;
  }

  throw appError('Можно менять только свои тренировочные записи', 403);
}

function assertClientIsEditable(note) {
  const client = note.User;
  if (!client || client.mergedIntoUserId) {
    throw appError('Клиент не найден', 404);
  }
  if (client.status === 'archived') {
    throw appError('Архивный клиент доступен только для просмотра', 409);
  }
}

async function createRecord(clientId, data, actor, options = {}) {
  const client = options.client || await assertClientExists(clientId);
  if (client.status === 'archived') {
    throw appError('Архивный клиент доступен только для просмотра', 409);
  }

  const exerciseResults = normalizeExerciseResults(data.exerciseResults) || [];
  const exerciseById = await loadApprovedExercisesByIds(
    exerciseResults.map((result) => result.trainingExerciseId),
  );
  const structuredExerciseNames = getExerciseNames(exerciseResults, exerciseById);
  const exercises = normalizeText(data.exercises) || normalizeText(structuredExerciseNames);
  const note = normalizeText(data.note);
  if (!exercises && !note && exerciseResults.length === 0) {
    throw appError('Заполните упражнения или заметку');
  }
  const trainingMarker =
    options.trainingMarker || await onboardingService.getTrainingDataMarker(actor);

  return withTransaction(options, async (transaction) => {
    const created = await db.TrainingNote.create(
      {
        userId: Number(clientId),
        trainerAccountId: actor?.id || null,
        trainedAt: normalizeDateOnly(data.trainedAt),
        level: normalizeLevel(data.level),
        exercises,
        note,
        ...trainingMarker,
      },
      { transaction },
    );

    if (exerciseResults.length > 0) {
      await db.TrainingNoteExercise.bulkCreate(
        buildExerciseResultRows(created.id, exerciseResults, exerciseById),
        { transaction },
      );
      await clientSkillMapService.recalculateFromStructuredTraining(
        clientId,
        actor,
        { client, transaction },
      );
    }

    return created;
  });
}

async function create(clientId, data, actor) {
  const trainingNote = await createRecord(clientId, data, actor);

  await onboardingService.recordEventSafe(actor, 'training_note.created', {
    entityId: trainingNote.id,
    entityType: 'training_note',
    payload: {
      clientId: Number(clientId),
      level: trainingNote.level,
      noteId: trainingNote.id,
    },
  });
  await onboardingService.recordEventSafe(actor, 'training_level.updated', {
    entityId: clientId,
    entityType: 'client',
    payload: {
      clientId: Number(clientId),
      level: trainingNote.level,
      noteId: trainingNote.id,
    },
  });

  return listByClient(clientId);
}

async function updateRecord(noteId, data, actor, options = {}) {
  const note = options.note || await getNoteOrFail(noteId);
  assertCanChangeNote(note, actor);
  assertClientIsEditable(note);

  const exerciseResults = normalizeExerciseResults(data.exerciseResults);
  const exerciseById = await loadApprovedExercisesByIds(
    (exerciseResults || []).map((result) => result.trainingExerciseId),
  );
  const structuredExerciseNames = exerciseResults
    ? getExerciseNames(exerciseResults, exerciseById)
    : null;
  const nextExercises =
    data.exercises === undefined
      ? exerciseResults === null
        ? note.exercises
        : normalizeText(structuredExerciseNames)
      : normalizeText(data.exercises);
  const nextNote = data.note === undefined ? note.note : normalizeText(data.note);
  const nextExerciseResultsCount =
    exerciseResults === null ? note.exerciseResults?.length || 0 : exerciseResults.length;

  if (!nextExercises && !nextNote && nextExerciseResultsCount === 0) {
    throw appError('Заполните упражнения или заметку');
  }

  const shouldRecalculateSkillMap =
    exerciseResults !== null || data.trainedAt !== undefined;

  await withTransaction(options, async (transaction) => {
    await note.update(
      {
        exercises: nextExercises,
        level:
          data.level === undefined ? note.level : normalizeLevel(data.level),
        note: nextNote,
        trainedAt:
          data.trainedAt === undefined
            ? note.trainedAt
            : normalizeDateOnly(data.trainedAt),
      },
      { transaction },
    );

    if (exerciseResults !== null) {
      await db.TrainingNoteExercise.destroy({
        transaction,
        where: { trainingNoteId: note.id },
      });
      if (exerciseResults.length > 0) {
        await db.TrainingNoteExercise.bulkCreate(
          buildExerciseResultRows(note.id, exerciseResults, exerciseById),
          { transaction },
        );
      }
    }

    if (shouldRecalculateSkillMap) {
      await clientSkillMapService.recalculateFromStructuredTraining(
        note.userId,
        actor,
        { client: note.User, transaction },
      );
    }
  });

  return note;
}

async function update(noteId, data, actor) {
  const note = await updateRecord(noteId, data, actor);

  await onboardingService.recordEventSafe(actor, 'training_note.updated', {
    entityId: note.id,
    entityType: 'training_note',
    payload: {
      clientId: note.userId,
      level: note.level,
      noteId: note.id,
    },
  });

  return listByClient(note.userId);
}

async function remove(noteId, actor) {
  const note = await getNoteOrFail(noteId);
  assertCanChangeNote(note, actor);
  assertClientIsEditable(note);
  const clientId = note.userId;

  await db.sequelize.transaction(async (transaction) => {
    await note.destroy({ transaction });
    await clientSkillMapService.recalculateFromStructuredTraining(
      clientId,
      actor,
      { client: note.User, transaction },
    );
  });
  return listByClient(clientId);
}

module.exports = {
  create,
  createRecord,
  listByClient,
  normalizeExerciseResults,
  remove,
  update,
  updateRecord,
  __testing: {
    mapTrainingNote,
    normalizeExerciseResults,
    normalizeRating,
  },
};
