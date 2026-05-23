const db = require('../../models');

const LEVELS = new Set(['D', 'D+', 'C', 'C+', 'B', 'B+', 'A']);

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

function mapTrainingNote(note) {
  const raw = note.toJSON ? note.toJSON() : note;
  const trainer = raw.trainerAccount;

  return {
    id: raw.id,
    trainedAt: raw.trainedAt,
    level: raw.level,
    exercises: raw.exercises || '',
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

async function listByClient(clientId) {
  await assertClientExists(clientId);

  const notes = await db.TrainingNote.findAll({
    where: { userId: Number(clientId) },
    include: [
      {
        model: db.Account,
        as: 'trainerAccount',
        attributes: ['id', 'role', 'staffId'],
        include: [{ model: db.Staff, attributes: ['id', 'name'] }],
      },
    ],
    order: [
      ['trainedAt', 'DESC'],
      ['createdAt', 'DESC'],
    ],
    limit: 100,
  });

  return notes.map(mapTrainingNote);
}

async function getNoteOrFail(noteId) {
  const note = await db.TrainingNote.findByPk(Number(noteId), {
    include: [
      {
        model: db.User,
        attributes: ['id', 'status', 'mergedIntoUserId'],
      },
      {
        model: db.Account,
        as: 'trainerAccount',
        attributes: ['id', 'role', 'staffId'],
        include: [{ model: db.Staff, attributes: ['id', 'name'] }],
      },
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

async function create(clientId, data, actor) {
  const client = await assertClientExists(clientId);
  if (client.status === 'archived') {
    throw appError('Архивный клиент доступен только для просмотра', 409);
  }

  const exercises = normalizeText(data.exercises);
  const note = normalizeText(data.note);
  if (!exercises && !note) {
    throw appError('Заполните упражнения или заметку');
  }

  await db.TrainingNote.create({
    userId: Number(clientId),
    trainerAccountId: actor?.id || null,
    trainedAt: normalizeDateOnly(data.trainedAt),
    level: normalizeLevel(data.level),
    exercises,
    note,
  });

  return listByClient(clientId);
}

async function update(noteId, data, actor) {
  const note = await getNoteOrFail(noteId);
  assertCanChangeNote(note, actor);
  assertClientIsEditable(note);

  const nextExercises =
    data.exercises === undefined ? note.exercises : normalizeText(data.exercises);
  const nextNote = data.note === undefined ? note.note : normalizeText(data.note);

  if (!nextExercises && !nextNote) {
    throw appError('Заполните упражнения или заметку');
  }

  await note.update({
    exercises: nextExercises,
    level:
      data.level === undefined ? note.level : normalizeLevel(data.level),
    note: nextNote,
    trainedAt:
      data.trainedAt === undefined
        ? note.trainedAt
        : normalizeDateOnly(data.trainedAt),
  });

  return listByClient(note.userId);
}

async function remove(noteId, actor) {
  const note = await getNoteOrFail(noteId);
  assertCanChangeNote(note, actor);
  assertClientIsEditable(note);
  const clientId = note.userId;

  await note.destroy();
  return listByClient(clientId);
}

module.exports = {
  create,
  listByClient,
  remove,
  update,
};
