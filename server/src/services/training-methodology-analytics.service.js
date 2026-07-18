const { Op } = require('sequelize');
const db = require('../../models');
const {
  TRAINING_EXERCISE_E_LEVEL_VALUES,
} = require('../constants/training-methodology');
const {
  bindMethodologyActor,
  methodologyTenantWhere,
  resolveMethodologyAccessContext,
} = require('./methodology-access-context.service');

const VIEW_ROLES = new Set(['owner', 'manager']);
const RECOMMENDATION_SOURCE_TYPES = [
  'personal_recommendation',
  'group_recommendation',
];
const LOW_APPROVED_EXERCISE_THRESHOLD = 3;
const LOW_DATA_STRUCTURED_RESULTS = 8;
const LOW_DATA_TRAINING_NOTES = 3;
const STUCK_LEVEL_MIN_DAYS = 45;
const STUCK_LEVEL_MIN_TRAININGS = 3;
const NO_PROGRESS_MIN_TRAININGS = 2;
const HIGH_E_LEVELS = new Set(['E6', 'E7']);
const NO_PROGRESS_CHANGE_TYPES = new Set([
  'blocked',
  'consolidate',
  'hold',
  'max_level',
  'repeat',
]);

function appError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function assertCanView(actor) {
  if (!VIEW_ROLES.has(actor?.role)) {
    throw appError('Недостаточно прав для просмотра аналитики методики', 403);
  }
}

function toRaw(value) {
  if (!value) return null;
  return value.toJSON ? value.toJSON() : value;
}

function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeDateOnly(value, label) {
  if (value === undefined || value === null || value === '') return null;
  const date = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw appError(`${label} должна быть в формате YYYY-MM-DD`);
  }
  return date;
}

function formatDateOnly(date) {
  const normalized = new Date(date);
  normalized.setMinutes(normalized.getMinutes() - normalized.getTimezoneOffset());
  return normalized.toISOString().slice(0, 10);
}

function addDays(dateOnly, days) {
  const date = new Date(`${dateOnly}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function normalizePositiveId(value, label) {
  if (value === undefined || value === null || value === '' || value === 'all') {
    return null;
  }

  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    throw appError(`${label} должен быть положительным числом`);
  }
  return id;
}

function normalizeAnalyticsQuery(query = {}) {
  const today = formatDateOnly(new Date());
  const to = normalizeDateOnly(query.to, 'Дата окончания') || today;
  const from = normalizeDateOnly(query.from, 'Дата начала') || addDays(to, -30);
  if (from > to) {
    throw appError('Дата начала не может быть позже даты окончания');
  }

  return {
    from,
    to,
    trainerAccountId: normalizePositiveId(query.trainerAccountId, 'ID тренера'),
  };
}

function buildDateOnlyWhere(from, to) {
  return {
    [Op.gte]: from,
    [Op.lte]: to,
  };
}

function parseFormats(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (!value || typeof value !== 'string') return [];

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
  } catch {
    return [];
  }
}

function mapAccount(account) {
  const raw = toRaw(account);
  if (!raw) return null;
  return {
    email: raw.email || null,
    id: Number(raw.id),
    name: raw.Staff?.name || raw.staff?.name || raw.email || `Аккаунт #${raw.id}`,
    role: raw.role || null,
  };
}

function mapSkill(skill) {
  const raw = toRaw(skill);
  if (!raw) return null;
  return {
    direction: raw.direction || null,
    id: Number(raw.id),
    name: raw.name || `Навык #${raw.id}`,
    status: raw.status || null,
  };
}

function getExerciseSkillIds(exercise) {
  const raw = toRaw(exercise) || {};
  const ids = [
    raw.mainSkillId,
    ...(raw.additionalSkills || []).map((skill) => toRaw(skill)?.id),
  ]
    .map(Number)
    .filter((id) => Number.isInteger(id) && id > 0);
  return Array.from(new Set(ids));
}

function mapExercise(exercise, fallback = {}) {
  const raw = toRaw(exercise) || {};
  const id = Number(raw.id || fallback.trainingExerciseId || fallback.id || 0);
  const formats = parseFormats(raw.formats);

  return {
    eLevel: raw.eLevel || fallback.eLevel || null,
    formats,
    id,
    mainSkill: mapSkill(raw.mainSkill),
    mainSkillId: raw.mainSkillId ? Number(raw.mainSkillId) : null,
    name:
      raw.name ||
      fallback.exerciseName ||
      fallback.exerciseNameSnapshot ||
      (id ? `Упражнение #${id}` : 'Упражнение'),
    skillIds: getExerciseSkillIds(raw),
    status: raw.status || null,
  };
}

function getClientFromNote(note) {
  const raw = toRaw(note) || {};
  return toRaw(raw.User || raw.client || raw.user);
}

function mapClient(client) {
  const raw = toRaw(client);
  if (!raw) return null;
  return {
    id: Number(raw.id),
    name: raw.name || `Клиент #${raw.id}`,
    status: raw.status || null,
  };
}

function getTrainerFromNote(note) {
  const raw = toRaw(note) || {};
  const account = raw.trainerAccount || raw.trainer || null;
  if (account) return mapAccount(account);
  if (!raw.trainerAccountId) return null;
  return {
    email: null,
    id: Number(raw.trainerAccountId),
    name: `Тренер #${raw.trainerAccountId}`,
    role: 'trainer',
  };
}

function getTrainerIdFromNote(note) {
  const trainer = getTrainerFromNote(note);
  return trainer?.id || null;
}

function getTrainerFromPlan(plan) {
  const raw = toRaw(plan) || {};
  const account = raw.trainerAccount || raw.trainer || null;
  if (account) return mapAccount(account);
  if (!raw.trainerAccountId) return null;
  return {
    email: null,
    id: Number(raw.trainerAccountId),
    name: `Тренер #${raw.trainerAccountId}`,
    role: 'trainer',
  };
}

function getTrainerIdFromHistory(historyEntry) {
  const raw = toRaw(historyEntry) || {};
  const note = toRaw(raw.trainingNote) || {};
  return note.trainerAccountId ? Number(note.trainerAccountId) : null;
}

function percent(numerator, denominator) {
  if (!denominator) return 0;
  return Math.round((numerator / denominator) * 100);
}

function average(total, count) {
  if (!count) return null;
  return Math.round((total / count) * 10) / 10;
}

function clamp01(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function compareDateOnly(left, right) {
  return String(left || '').localeCompare(String(right || ''));
}

function daysBetween(fromDateOnly, toDateOnly) {
  const from = new Date(`${fromDateOnly}T00:00:00.000Z`);
  const to = new Date(`${toDateOnly}T00:00:00.000Z`);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return 0;
  return Math.max(0, Math.floor((to.getTime() - from.getTime()) / 86400000));
}

function resultExercise(result) {
  const raw = toRaw(result) || {};
  return mapExercise(raw.exercise, raw);
}

function buildExerciseUsage(trainingNotes = [], approvedExercises = []) {
  const usageByExerciseId = new Map();
  const approvedById = new Map(
    approvedExercises
      .map((exercise) => mapExercise(exercise))
      .filter((exercise) => exercise.id)
      .map((exercise) => [exercise.id, exercise]),
  );
  let structuredTrainingNotes = 0;
  let structuredResults = 0;

  for (const noteValue of trainingNotes) {
    const note = toRaw(noteValue) || {};
    const results = note.exerciseResults || [];
    if (results.length > 0) structuredTrainingNotes += 1;

    for (const resultValue of results) {
      const result = toRaw(resultValue) || {};
      const exerciseId = Number(result.trainingExerciseId || result.exercise?.id);
      if (!exerciseId) continue;

      structuredResults += 1;
      const exercise = approvedById.get(exerciseId) || resultExercise(result);
      const existing = usageByExerciseId.get(exerciseId) || {
        averageRating: null,
        eLevel: exercise.eLevel,
        exerciseId,
        formats: exercise.formats,
        lastUsedAt: null,
        lowRatingCount: 0,
        mainSkill: exercise.mainSkill,
        name: exercise.name,
        ratingCount: 0,
        ratingTotal: 0,
        usageCount: 0,
      };
      const rating = Number(result.rating);

      existing.usageCount += 1;
      if (Number.isFinite(rating)) {
        existing.ratingCount += 1;
        existing.ratingTotal += rating;
        if (rating <= 2) existing.lowRatingCount += 1;
      }
      if (!existing.lastUsedAt || compareDateOnly(note.trainedAt, existing.lastUsedAt) > 0) {
        existing.lastUsedAt = note.trainedAt || existing.lastUsedAt;
      }
      usageByExerciseId.set(exerciseId, existing);
    }
  }

  const finalize = (item) => ({
    averageRating: average(item.ratingTotal, item.ratingCount),
    eLevel: item.eLevel,
    exerciseId: item.exerciseId,
    formats: item.formats,
    lastUsedAt: item.lastUsedAt,
    lowRatingCount: item.lowRatingCount,
    mainSkill: item.mainSkill,
    name: item.name,
    usageCount: item.usageCount,
  });

  const frequentExercises = Array.from(usageByExerciseId.values())
    .map(finalize)
    .sort((left, right) => {
      if (left.usageCount !== right.usageCount) return right.usageCount - left.usageCount;
      return String(left.name).localeCompare(String(right.name));
    });

  const rarelyUsedExercises = Array.from(approvedById.values())
    .map((exercise) => {
      const usage = usageByExerciseId.get(exercise.id);
      return usage
        ? finalize(usage)
        : {
            averageRating: null,
            eLevel: exercise.eLevel,
            exerciseId: exercise.id,
            formats: exercise.formats,
            lastUsedAt: null,
            lowRatingCount: 0,
            mainSkill: exercise.mainSkill,
            name: exercise.name,
            usageCount: 0,
          };
    })
    .sort((left, right) => {
      if (left.usageCount !== right.usageCount) return left.usageCount - right.usageCount;
      return String(left.name).localeCompare(String(right.name));
    });

  return {
    frequentExercises,
    rarelyUsedExercises,
    structuredResults,
    structuredTrainingNotes,
  };
}

function buildSkillCoverage(skills = [], approvedExercises = []) {
  const coverageBySkillId = new Map(
    skills.map((skillValue) => {
      const skill = mapSkill(skillValue);
      return [
        skill.id,
        {
          approvedExerciseCount: 0,
          direction: skill.direction,
          gameFormatCount: 0,
          highELevelCount: 0,
          skillId: skill.id,
          skillName: skill.name,
        },
      ];
    }),
  );

  for (const exerciseValue of approvedExercises) {
    const exercise = mapExercise(exerciseValue);
    const skillIds = exercise.skillIds.length > 0
      ? exercise.skillIds
      : [exercise.mainSkillId].filter(Boolean);

    for (const skillId of skillIds) {
      const bucket = coverageBySkillId.get(Number(skillId));
      if (!bucket) continue;
      bucket.approvedExerciseCount += 1;
      if (HIGH_E_LEVELS.has(exercise.eLevel)) bucket.highELevelCount += 1;
      if (exercise.formats.includes('game')) bucket.gameFormatCount += 1;
    }
  }

  return Array.from(coverageBySkillId.values())
    .filter((item) => item.approvedExerciseCount < LOW_APPROVED_EXERCISE_THRESHOLD)
    .sort((left, right) => {
      if (left.approvedExerciseCount !== right.approvedExerciseCount) {
        return left.approvedExerciseCount - right.approvedExerciseCount;
      }
      return left.skillName.localeCompare(right.skillName);
    });
}

function buildWeakSkills(historyRows = []) {
  const bySkillId = new Map();

  for (const rowValue of historyRows) {
    const row = toRaw(rowValue) || {};
    const skill = mapSkill(row.skill);
    const skillId = Number(row.trainingSkillId || skill?.id);
    if (!skillId) continue;

    const bucket = bySkillId.get(skillId) || {
      affectedClientIds: new Set(),
      advancedCount: 0,
      averageRating: null,
      blockedCount: 0,
      direction: skill?.direction || null,
      eventsCount: 0,
      lowRatingCount: 0,
      noProgressCount: 0,
      ratingCount: 0,
      ratingTotal: 0,
      repeatCount: 0,
      skillId,
      skillName: skill?.name || `Навык #${skillId}`,
      weaknessScore: 0,
    };
    const rating = Number(row.rating);

    bucket.eventsCount += 1;
    if (row.userId) bucket.affectedClientIds.add(Number(row.userId));
    if (row.changeType === 'advanced') bucket.advancedCount += 1;
    if (NO_PROGRESS_CHANGE_TYPES.has(row.changeType)) bucket.noProgressCount += 1;
    if (row.changeType === 'blocked') bucket.blockedCount += 1;
    if (row.repeatFlag || row.changeType === 'repeat') bucket.repeatCount += 1;
    if (Number.isFinite(rating)) {
      bucket.ratingCount += 1;
      bucket.ratingTotal += rating;
      if (rating <= 2) bucket.lowRatingCount += 1;
    }
    bySkillId.set(skillId, bucket);
  }

  return Array.from(bySkillId.values())
    .map((bucket) => ({
      affectedClients: bucket.affectedClientIds.size,
      advancedCount: bucket.advancedCount,
      averageRating: average(bucket.ratingTotal, bucket.ratingCount),
      blockedCount: bucket.blockedCount,
      direction: bucket.direction,
      eventsCount: bucket.eventsCount,
      lowRatingCount: bucket.lowRatingCount,
      noProgressCount: bucket.noProgressCount,
      repeatCount: bucket.repeatCount,
      skillId: bucket.skillId,
      skillName: bucket.skillName,
      weaknessScore:
        bucket.lowRatingCount * 4 +
        bucket.repeatCount * 3 +
        bucket.blockedCount * 2 +
        bucket.noProgressCount,
    }))
    .filter((item) => item.weaknessScore > 0)
    .sort((left, right) => {
      if (left.weaknessScore !== right.weaknessScore) {
        return right.weaknessScore - left.weaknessScore;
      }
      if (left.affectedClients !== right.affectedClients) {
        return right.affectedClients - left.affectedClients;
      }
      return left.skillName.localeCompare(right.skillName);
    });
}

function buildClientsWithoutProgress(trainingNotes = [], historyRows = []) {
  const byClientId = new Map();

  for (const noteValue of trainingNotes) {
    const note = toRaw(noteValue) || {};
    const client = mapClient(getClientFromNote(note));
    const userId = Number(note.userId || client?.id);
    const results = note.exerciseResults || [];
    if (!userId || results.length === 0) continue;

    const bucket = byClientId.get(userId) || {
      advancedCount: 0,
      client,
      latestTrainingAt: null,
      lowRatingCount: 0,
      noProgressEvents: 0,
      repeatEvents: 0,
      structuredTrainings: 0,
      userId,
    };

    bucket.structuredTrainings += 1;
    if (!bucket.latestTrainingAt || compareDateOnly(note.trainedAt, bucket.latestTrainingAt) > 0) {
      bucket.latestTrainingAt = note.trainedAt || bucket.latestTrainingAt;
    }
    byClientId.set(userId, bucket);
  }

  for (const rowValue of historyRows) {
    const row = toRaw(rowValue) || {};
    const userId = Number(row.userId);
    const bucket = byClientId.get(userId);
    if (!bucket) continue;

    const rating = Number(row.rating);
    if (row.changeType === 'advanced') bucket.advancedCount += 1;
    if (NO_PROGRESS_CHANGE_TYPES.has(row.changeType)) bucket.noProgressEvents += 1;
    if (row.repeatFlag || row.changeType === 'repeat') bucket.repeatEvents += 1;
    if (Number.isFinite(rating) && rating <= 2) bucket.lowRatingCount += 1;
  }

  return Array.from(byClientId.values())
    .filter(
      (item) =>
        item.structuredTrainings >= NO_PROGRESS_MIN_TRAININGS &&
        item.advancedCount === 0,
    )
    .map((item) => ({
      advancedCount: item.advancedCount,
      client: item.client,
      latestTrainingAt: item.latestTrainingAt,
      lowRatingCount: item.lowRatingCount,
      noProgressEvents: item.noProgressEvents,
      repeatEvents: item.repeatEvents,
      structuredTrainings: item.structuredTrainings,
      userId: item.userId,
    }))
    .sort((left, right) => {
      if (left.structuredTrainings !== right.structuredTrainings) {
        return right.structuredTrainings - left.structuredTrainings;
      }
      if (left.noProgressEvents !== right.noProgressEvents) {
        return right.noProgressEvents - left.noProgressEvents;
      }
      return String(left.client?.name || '').localeCompare(String(right.client?.name || ''));
    });
}

function buildStuckLevelClients(trainingNotes = [], asOfDate) {
  const byClientId = new Map();

  for (const noteValue of trainingNotes) {
    const note = toRaw(noteValue) || {};
    const client = mapClient(getClientFromNote(note));
    const userId = Number(note.userId || client?.id);
    if (!userId || !note.level || !note.trainedAt) continue;

    const bucket = byClientId.get(userId) || {
      client,
      notes: [],
      userId,
    };
    bucket.notes.push({
      createdAt: note.createdAt || null,
      id: Number(note.id || 0),
      level: note.level,
      trainedAt: note.trainedAt,
    });
    byClientId.set(userId, bucket);
  }

  return Array.from(byClientId.values())
    .map((bucket) => {
      const notes = bucket.notes.sort((left, right) => {
        if (left.trainedAt !== right.trainedAt) return right.trainedAt.localeCompare(left.trainedAt);
        if (String(left.createdAt) !== String(right.createdAt)) {
          return String(right.createdAt).localeCompare(String(left.createdAt));
        }
        return right.id - left.id;
      });
      const latest = notes[0];
      if (!latest) return null;

      const sameLevelRun = [];
      for (const note of notes) {
        if (note.level !== latest.level) break;
        sameLevelRun.push(note);
      }
      const firstSameLevel = sameLevelRun[sameLevelRun.length - 1];
      const daysAtLevel = daysBetween(firstSameLevel.trainedAt, asOfDate);

      return {
        client: bucket.client,
        currentLevel: latest.level,
        daysAtLevel,
        latestTrainingAt: latest.trainedAt,
        sameLevelSince: firstSameLevel.trainedAt,
        sameLevelTrainings: sameLevelRun.length,
        userId: bucket.userId,
      };
    })
    .filter(
      (item) =>
        item &&
        item.daysAtLevel >= STUCK_LEVEL_MIN_DAYS &&
        item.sameLevelTrainings >= STUCK_LEVEL_MIN_TRAININGS,
    )
    .sort((left, right) => {
      if (left.daysAtLevel !== right.daysAtLevel) return right.daysAtLevel - left.daysAtLevel;
      if (left.sameLevelTrainings !== right.sameLevelTrainings) {
        return right.sameLevelTrainings - left.sameLevelTrainings;
      }
      return String(left.client?.name || '').localeCompare(String(right.client?.name || ''));
    });
}

function calculateMonotonyScore({
  exerciseRepeatRatio,
  gameFormatRatio,
  highELevelRatio,
  noProgressRatio,
}) {
  const highELevelPenalty = clamp01((0.15 - highELevelRatio) / 0.15);
  const gameFormatPenalty = clamp01((0.25 - gameFormatRatio) / 0.25);

  return Math.round(
    100 *
      (
        clamp01(exerciseRepeatRatio) * 0.35 +
        highELevelPenalty * 0.2 +
        gameFormatPenalty * 0.2 +
        clamp01(noProgressRatio) * 0.25
      ),
  );
}

function buildTrainerVariety(trainingNotes = [], historyRows = []) {
  const byTrainerId = new Map();

  function ensureTrainer(trainer) {
    if (!trainer?.id) return null;
    const bucket = byTrainerId.get(trainer.id) || {
      advancedHistoryEvents: 0,
      exerciseIds: [],
      explicitRepeatCount: 0,
      gameFormatCount: 0,
      highELevelCount: 0,
      historyEvents: 0,
      noProgressHistoryEvents: 0,
      noteCount: 0,
      resultCount: 0,
      skillIds: [],
      trainer,
    };
    byTrainerId.set(trainer.id, bucket);
    return bucket;
  }

  for (const noteValue of trainingNotes) {
    const note = toRaw(noteValue) || {};
    const bucket = ensureTrainer(getTrainerFromNote(note));
    if (!bucket) continue;

    bucket.noteCount += 1;
    for (const resultValue of note.exerciseResults || []) {
      const result = toRaw(resultValue) || {};
      const exercise = resultExercise(result);
      if (!exercise.id) continue;

      bucket.resultCount += 1;
      bucket.exerciseIds.push(exercise.id);
      bucket.skillIds.push(...exercise.skillIds);
      if (result.repeatExercise || result.repeatSkill) bucket.explicitRepeatCount += 1;
      if (HIGH_E_LEVELS.has(exercise.eLevel)) bucket.highELevelCount += 1;
      if (exercise.formats.includes('game')) bucket.gameFormatCount += 1;
    }
  }

  for (const rowValue of historyRows) {
    const row = toRaw(rowValue) || {};
    const trainerId = getTrainerIdFromHistory(row);
    if (!trainerId) continue;
    const bucket = byTrainerId.get(trainerId);
    if (!bucket) continue;

    bucket.historyEvents += 1;
    if (row.changeType === 'advanced') bucket.advancedHistoryEvents += 1;
    if (NO_PROGRESS_CHANGE_TYPES.has(row.changeType)) {
      bucket.noProgressHistoryEvents += 1;
    }
  }

  return Array.from(byTrainerId.values())
    .map((bucket) => {
      const uniqueExercises = new Set(bucket.exerciseIds).size;
      const uniqueSkills = new Set(bucket.skillIds).size;
      const exerciseRepeatRatio = bucket.resultCount
        ? (bucket.resultCount - uniqueExercises) / bucket.resultCount
        : 0;
      const highELevelRatio = bucket.resultCount
        ? bucket.highELevelCount / bucket.resultCount
        : 0;
      const gameFormatRatio = bucket.resultCount
        ? bucket.gameFormatCount / bucket.resultCount
        : 0;
      const explicitRepeatRatio = bucket.resultCount
        ? bucket.explicitRepeatCount / bucket.resultCount
        : 0;
      const noProgressRatio = bucket.historyEvents
        ? bucket.noProgressHistoryEvents / bucket.historyEvents
        : explicitRepeatRatio;
      const monotonyScore = calculateMonotonyScore({
        exerciseRepeatRatio,
        gameFormatRatio,
        highELevelRatio,
        noProgressRatio,
      });
      const flags = [];

      if (exerciseRepeatRatio >= 0.45) flags.push('повтор упражнений');
      if (highELevelRatio < 0.12) flags.push('мало E6-E7');
      if (gameFormatRatio < 0.2) flags.push('мало игровых форм');
      if (noProgressRatio >= 0.45) flags.push('повтор навыков без прогрессии');
      if (bucket.resultCount < LOW_DATA_STRUCTURED_RESULTS) flags.push('мало данных');

      return {
        advancedHistoryEvents: bucket.advancedHistoryEvents,
        exerciseRepeatPercent: percent(bucket.resultCount - uniqueExercises, bucket.resultCount),
        explicitRepeatPercent: percent(bucket.explicitRepeatCount, bucket.resultCount),
        flags,
        gameFormatPercent: percent(bucket.gameFormatCount, bucket.resultCount),
        highELevelPercent: percent(bucket.highELevelCount, bucket.resultCount),
        monotonyScore,
        noProgressPercent: percent(bucket.noProgressHistoryEvents, bucket.historyEvents),
        noteCount: bucket.noteCount,
        resultCount: bucket.resultCount,
        trainer: bucket.trainer,
        uniqueExercises,
        uniqueSkills,
      };
    })
    .filter((item) => item.resultCount > 0)
    .sort((left, right) => {
      if (left.monotonyScore !== right.monotonyScore) {
        return right.monotonyScore - left.monotonyScore;
      }
      return right.resultCount - left.resultCount;
    });
}

function getPlannedExerciseIds(plan) {
  const raw = toRaw(plan) || {};
  return Array.from(
    new Set(
      (raw.plannedExercises || [])
        .map((item) => Number(toRaw(item)?.trainingExerciseId || toRaw(item)?.exercise?.id))
        .filter(Boolean),
    ),
  );
}

function getActualExerciseIdsFromPlan(plan) {
  const raw = toRaw(plan) || {};
  const ids = [];
  for (const participantValue of raw.participants || []) {
    const participant = toRaw(participantValue) || {};
    const note = toRaw(participant.trainingNote) || {};
    for (const resultValue of note.exerciseResults || []) {
      const result = toRaw(resultValue) || {};
      const exerciseId = Number(result.trainingExerciseId || result.exercise?.id);
      if (exerciseId) ids.push(exerciseId);
    }
  }
  return Array.from(new Set(ids));
}

function buildRecommendationAdherence(plans = []) {
  const byTrainerId = new Map();
  const deviationExamples = [];

  function ensureTrainer(trainer) {
    const id = trainer?.id || 0;
    const bucket = byTrainerId.get(id) || {
      averageAdherencePercent: 0,
      deviatedPlans: 0,
      followedPlans: 0,
      partialPlans: 0,
      planAdherenceTotal: 0,
      recommendationPlans: 0,
      trainer,
    };
    byTrainerId.set(id, bucket);
    return bucket;
  }

  for (const planValue of plans) {
    const plan = toRaw(planValue) || {};
    const trainer = getTrainerFromPlan(plan);
    const bucket = ensureTrainer(trainer);
    const plannedIds = getPlannedExerciseIds(plan);
    const actualIds = getActualExerciseIdsFromPlan(plan);
    const actualSet = new Set(actualIds);
    const plannedSet = new Set(plannedIds);
    const matchedCount = plannedIds.filter((id) => actualSet.has(id)).length;
    const missingCount = plannedIds.length - matchedCount;
    const extraCount = actualIds.filter((id) => !plannedSet.has(id)).length;
    const adherencePercent = percent(matchedCount, plannedIds.length);
    const followed = plannedIds.length > 0 && missingCount === 0 && extraCount === 0;
    const partial =
      !followed &&
      plannedIds.length > 0 &&
      adherencePercent >= 80 &&
      missingCount <= 1;

    bucket.recommendationPlans += 1;
    bucket.planAdherenceTotal += adherencePercent;
    if (followed) bucket.followedPlans += 1;
    else if (partial) bucket.partialPlans += 1;
    else bucket.deviatedPlans += 1;

    if (!followed) {
      deviationExamples.push({
        adherencePercent,
        actualExerciseCount: actualIds.length,
        extraCount,
        missingCount,
        planId: Number(plan.id),
        plannedAt: plan.plannedAt || null,
        plannedExerciseCount: plannedIds.length,
        sourceType: plan.sourceType || null,
        trainer,
      });
    }
  }

  const trainerRecommendationAdherence = Array.from(byTrainerId.values())
    .map((bucket) => ({
      averageAdherencePercent: percent(
        bucket.planAdherenceTotal,
        bucket.recommendationPlans * 100,
      ),
      deviatedPlans: bucket.deviatedPlans,
      followedPlans: bucket.followedPlans,
      partialPlans: bucket.partialPlans,
      recommendationPlans: bucket.recommendationPlans,
      trainer: bucket.trainer,
    }))
    .sort((left, right) => {
      if (left.deviatedPlans !== right.deviatedPlans) {
        return right.deviatedPlans - left.deviatedPlans;
      }
      return left.averageAdherencePercent - right.averageAdherencePercent;
    });

  return {
    recommendationDeviationExamples: deviationExamples
      .sort((left, right) => {
        if (left.adherencePercent !== right.adherencePercent) {
          return left.adherencePercent - right.adherencePercent;
        }
        return right.missingCount + right.extraCount - (left.missingCount + left.extraCount);
      }),
    trainerRecommendationAdherence,
  };
}

function buildEmptyStates(summary) {
  return {
    recommendations:
      summary.recommendationPlans === 0
        ? 'В выбранном периоде нет завершенных планов из рекомендаций.'
        : null,
    structuredTraining:
      summary.structuredResults < LOW_DATA_STRUCTURED_RESULTS
        ? 'Для устойчивых выводов нужно больше структурно заполненных упражнений.'
        : null,
    trainingNotes:
      summary.trainingNotes === 0
        ? 'В выбранном периоде нет тренировочных записей.'
        : null,
  };
}

function limit(items, size) {
  return items.slice(0, size);
}

function accountInclude(alias) {
  return {
    as: alias,
    attributes: ['id', 'email', 'role', 'staffId'],
    include: [{ model: db.Staff, attributes: ['id', 'name'] }],
    model: db.Account,
  };
}

function exerciseInclude(context) {
  return {
    as: 'exercise',
    attributes: ['id', 'name', 'eLevel', 'formats', 'mainSkillId', 'status'],
    include: [
      {
        as: 'mainSkill',
        attributes: ['id', 'name', 'direction', 'status'],
        model: db.TrainingSkill,
        required: true,
        where: methodologyTenantWhere(context, {}),
      },
      {
        as: 'additionalSkills',
        attributes: ['id', 'name', 'direction', 'status'],
        model: db.TrainingSkill,
        required: false,
        through: { attributes: [] },
        where: methodologyTenantWhere(context, {}),
      },
    ],
    model: db.TrainingExercise,
  };
}

async function loadTrainingNotes(filters, context) {
  const where = {
    isTraining: false,
    trainedAt: buildDateOnlyWhere(filters.from, filters.to),
  };
  if (filters.trainerAccountId) where.trainerAccountId = filters.trainerAccountId;

  return db.TrainingNote.findAll({
    include: [
      accountInclude('trainerAccount'),
      {
        attributes: [
          'id',
          'name',
          'organizationId',
          'status',
          'mergedIntoUserId',
          'isTraining',
        ],
        model: db.User,
        required: true,
        where: methodologyTenantWhere(context, {}),
      },
      {
        as: 'exerciseResults',
        include: [exerciseInclude(context)],
        model: db.TrainingNoteExercise,
        required: false,
      },
    ],
    order: [
      ['trainedAt', 'DESC'],
      ['createdAt', 'DESC'],
    ],
    where,
  });
}

async function loadApprovedExercises(context) {
  return db.TrainingExercise.findAll({
    include: [
      {
        as: 'mainSkill',
        attributes: ['id', 'name', 'direction', 'status'],
        model: db.TrainingSkill,
        required: true,
        where: methodologyTenantWhere(context, {}),
      },
      {
        as: 'additionalSkills',
        attributes: ['id', 'name', 'direction', 'status'],
        model: db.TrainingSkill,
        required: false,
        through: { attributes: [] },
        where: methodologyTenantWhere(context, {}),
      },
    ],
    order: [['name', 'ASC']],
    where: methodologyTenantWhere(context, { status: 'approved' }),
  });
}

async function loadActiveSkills(context) {
  return db.TrainingSkill.findAll({
    order: [
      ['direction', 'ASC'],
      ['name', 'ASC'],
    ],
    where: methodologyTenantWhere(context, { status: 'active' }),
  });
}

async function loadSkillHistory(filters, context) {
  const noteWhere = { isTraining: false };
  if (filters.trainerAccountId) noteWhere.trainerAccountId = filters.trainerAccountId;

  return db.ClientTrainingSkillHistory.findAll({
    include: [
      {
        as: 'skill',
        attributes: ['id', 'name', 'direction', 'status'],
        model: db.TrainingSkill,
        required: true,
        where: methodologyTenantWhere(context, {}),
      },
      {
        as: 'trainingNote',
        attributes: ['id', 'trainedAt', 'trainerAccountId', 'isTraining'],
        model: db.TrainingNote,
        required: true,
        where: noteWhere,
      },
      {
        attributes: [
          'id',
          'name',
          'organizationId',
          'status',
          'mergedIntoUserId',
          'isTraining',
        ],
        model: db.User,
        required: true,
        where: methodologyTenantWhere(context, {}),
      },
    ],
    where: {
      isTraining: false,
      occurredAt: buildDateOnlyWhere(filters.from, filters.to),
      source: 'structured_training',
    },
  });
}

async function loadRecommendationPlans(filters, context) {
  const where = {
    isTraining: false,
    plannedAt: buildDateOnlyWhere(filters.from, filters.to),
    sourceType: { [Op.in]: RECOMMENDATION_SOURCE_TYPES },
    status: 'completed',
  };
  if (filters.trainerAccountId) where.trainerAccountId = filters.trainerAccountId;

  return db.TrainingPlan.findAll({
    include: [
      accountInclude('trainerAccount'),
      {
        as: 'booking',
        attributes: ['id', 'organizationId'],
        model: db.Booking,
        required: false,
      },
      {
        as: 'plannedExercises',
        model: db.TrainingPlanExercise,
      },
      {
        as: 'participants',
        include: [
          {
            as: 'client',
            attributes: ['id', 'organizationId'],
            model: db.User,
            required: true,
          },
          {
            as: 'trainingNote',
            include: [
              {
                as: 'exerciseResults',
                model: db.TrainingNoteExercise,
                required: false,
              },
            ],
            model: db.TrainingNote,
          },
        ],
        model: db.TrainingPlanParticipant,
      },
    ],
    order: [['plannedAt', 'DESC']],
    where,
  }).then((plans) => {
    if (!context?.readScoped) return plans;
    return plans.filter((planValue) => {
      const plan = toRaw(planValue) || {};
      const participants = plan.participants || [];
      if (participants.length === 0) return false;
      if (
        plan.booking &&
        Number(plan.booking.organizationId) !== Number(context.organizationId)
      ) {
        return false;
      }
      return participants.every((participant) =>
        Number(participant.client?.organizationId) === Number(context.organizationId));
    });
  });
}

async function loadLevelHistoryNotes(clientIds) {
  if (clientIds.length === 0) return [];

  return db.TrainingNote.findAll({
    include: [
      {
        attributes: ['id', 'name', 'status', 'mergedIntoUserId', 'isTraining'],
        model: db.User,
      },
    ],
    order: [
      ['userId', 'ASC'],
      ['trainedAt', 'DESC'],
      ['createdAt', 'DESC'],
    ],
    where: {
      isTraining: false,
      userId: { [Op.in]: clientIds },
    },
  });
}

async function loadTrainerOptions(context) {
  const accounts = await db.Account.findAll({
    include: [
      { model: db.Staff, attributes: ['id', 'name'] },
      ...(context?.readScoped
        ? [{
            attributes: [],
            model: db.Membership,
            required: true,
            where: {
              organizationId: context.organizationId,
              role: 'trainer',
              status: 'active',
            },
          }]
        : []),
    ],
    order: [['email', 'ASC']],
    where: {
      role: 'trainer',
      status: 'active',
    },
  });

  return accounts.map(mapAccount);
}

async function getAnalytics(query = {}, actor = null, tenant = null) {
  const context = await resolveMethodologyAccessContext(tenant);
  const authorityActor = bindMethodologyActor(actor, context);
  assertCanView(authorityActor);
  const filters = normalizeAnalyticsQuery(query);
  const [
    trainingNotes,
    approvedExercises,
    activeSkills,
    skillHistory,
    recommendationPlans,
    trainers,
  ] = await Promise.all([
    loadTrainingNotes(filters, context),
    loadApprovedExercises(context),
    loadActiveSkills(context),
    loadSkillHistory(filters, context),
    loadRecommendationPlans(filters, context),
    loadTrainerOptions(context),
  ]);
  const exerciseUsage = buildExerciseUsage(trainingNotes, approvedExercises);
  const clientIds = Array.from(
    new Set(
      trainingNotes
        .map((noteValue) => Number((toRaw(noteValue) || {}).userId))
        .filter(Boolean),
    ),
  );
  const levelHistoryNotes = await loadLevelHistoryNotes(clientIds);
  const recommendationAdherence = buildRecommendationAdherence(recommendationPlans);
  const summary = {
    activeSkills: activeSkills.length,
    approvedExercises: approvedExercises.length,
    lowData:
      exerciseUsage.structuredTrainingNotes < LOW_DATA_TRAINING_NOTES ||
      exerciseUsage.structuredResults < LOW_DATA_STRUCTURED_RESULTS,
    recommendationPlans: recommendationPlans.length,
    structuredResults: exerciseUsage.structuredResults,
    structuredTrainingNotes: exerciseUsage.structuredTrainingNotes,
    trainingNotes: trainingNotes.length,
    trainersWithTraining: new Set(
      trainingNotes.map(getTrainerIdFromNote).filter(Boolean),
    ).size,
  };

  return {
    clientsWithoutProgress: limit(
      buildClientsWithoutProgress(trainingNotes, skillHistory),
      10,
    ),
    emptyStates: buildEmptyStates(summary),
    filters,
    frequentExercises: limit(exerciseUsage.frequentExercises, 10),
    lowApprovedSkillCoverage: limit(
      buildSkillCoverage(activeSkills, approvedExercises),
      10,
    ),
    monotonousTrainers: limit(
      buildTrainerVariety(trainingNotes, skillHistory),
      10,
    ),
    rarelyUsedExercises: limit(exerciseUsage.rarelyUsedExercises, 10),
    recommendationDeviationExamples: limit(
      recommendationAdherence.recommendationDeviationExamples,
      8,
    ),
    stuckLevelClients: limit(
      buildStuckLevelClients(levelHistoryNotes, filters.to),
      10,
    ),
    summary,
    trainerRecommendationAdherence: limit(
      recommendationAdherence.trainerRecommendationAdherence,
      10,
    ),
    trainers,
    weakSkills: limit(buildWeakSkills(skillHistory), 10),
  };
}

module.exports = {
  getAnalytics,
  __testing: {
    buildClientsWithoutProgress,
    buildExerciseUsage,
    buildRecommendationAdherence,
    buildSkillCoverage,
    buildStuckLevelClients,
    buildTrainerVariety,
    buildWeakSkills,
    calculateMonotonyScore,
    normalizeAnalyticsQuery,
    parseFormats,
  },
};
