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
          email: trainer.email,
          name: trainer.Staff?.name || trainer.email,
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
        attributes: ['id', 'email', 'role', 'staffId'],
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

module.exports = {
  create,
  listByClient,
};
