const { Op } = require('sequelize');
const db = require('../../models');
const {
  TRAINING_EXERCISE_E_LEVEL_VALUES,
} = require('../constants/training-methodology');
const clientSkillMapService = require('./client-skill-map.service');
const trainingNotesService = require('./training-notes.service');
const {
  bindMethodologyActor,
  methodologyTenantWhere,
  resolveMethodologyAccessContext,
  validateBookingPlanRecommendationDelegation,
} = require('./methodology-access-context.service');

const VIEW_ROLES = new Set(['owner', 'manager', 'trainer']);
const MAX_SKILL_LEVEL = 5;
const RECENT_TRAININGS_LIMIT = 3;
const STALE_DAYS = 45;
const MODERATELY_STALE_DAYS = 21;
const RECENT_GOOD_DAYS = 14;
const HIGH_RATING = 4;

const TRAINING_LEVEL_TO_SKILL_LEVEL = {
  A: 5,
  B: 4,
  'B+': 5,
  C: 2,
  'C+': 3,
  D: 0,
  'D+': 1,
};

const DIRECTION_LABELS = {
  game_situations: 'игровые ситуации',
  pair_interaction: 'парное взаимодействие',
  physical_coordination: 'физика и координация',
  tactics: 'тактика',
  technique: 'техника',
};

const BLOCKS = [
  {
    key: 'warmup',
    title: 'Разминка',
    focus: 'warmup',
    preferredFormats: ['personal', 'pair', 'group'],
  },
  {
    key: 'main_technical',
    title: 'Основной технический блок',
    focus: 'main',
    preferredFormats: ['personal', 'pair', 'group'],
  },
  {
    key: 'secondary_or_consolidation',
    title: 'Дополнительный навык или закрепление',
    focus: 'secondary',
    preferredFormats: ['personal', 'pair', 'group'],
  },
  {
    key: 'game_drill',
    title: 'Игровое упражнение',
    focus: 'game',
    preferredFormats: ['game', 'pair', 'group'],
  },
  {
    key: 'mini_game',
    title: 'Игровое закрепление или мини-игра',
    focus: 'mini_game',
    preferredFormats: ['game', 'group', 'pair'],
  },
];

const GROUP_MIN_PARTICIPANTS = 2;
const GROUP_MAX_PARTICIPANTS = 12;
const GROUP_BLOCKS = [
  {
    key: 'group_warmup',
    title: 'Групповая разминка',
    focus: 'warmup',
    preferredFormats: ['group', 'pair', 'game'],
  },
  {
    key: 'group_majority_skill',
    title: 'Навык большинства',
    focus: 'main',
    preferredFormats: ['group', 'pair'],
  },
  {
    key: 'group_differentiation',
    title: 'Дифференцированная отработка',
    focus: 'main',
    preferredFormats: ['group', 'pair'],
  },
  {
    key: 'group_game_drill',
    title: 'Игровая связка',
    focus: 'game',
    preferredFormats: ['game', 'group', 'pair'],
  },
  {
    key: 'group_mini_game',
    title: 'Мини-игра с вариациями',
    focus: 'mini_game',
    preferredFormats: ['game', 'group'],
  },
];

function appError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function assertCanView(actor) {
  if (!VIEW_ROLES.has(actor?.role)) {
    throw appError('Недостаточно прав для рекомендации тренировки', 403);
  }
}

function normalizeClientId(value) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    throw appError('Некорректный ID клиента');
  }
  return id;
}

function normalizeClientIds(value) {
  const source = Array.isArray(value) ? value : [];
  const ids = Array.from(new Set(source.map(normalizeClientId)));
  if (ids.length < GROUP_MIN_PARTICIPANTS) {
    throw appError(`Выберите минимум ${GROUP_MIN_PARTICIPANTS} клиентов для группы`);
  }
  if (ids.length > GROUP_MAX_PARTICIPANTS) {
    throw appError(`В группе можно выбрать до ${GROUP_MAX_PARTICIPANTS} клиентов`);
  }
  return ids;
}

function normalizeGoal(value) {
  const goal = String(value || '').trim().replace(/\s+/g, ' ');
  return goal ? goal.slice(0, 160) : '';
}

function normalizeDateOnly(value) {
  if (value === undefined || value === null || value === '') {
    const now = new Date();
    now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
    return now.toISOString().slice(0, 10);
  }

  const date = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw appError('Дата рекомендации должна быть в формате YYYY-MM-DD');
  }
  return date;
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

function toDate(value) {
  if (!value) return null;
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function getDaysSince(dateOnly, asOfDate) {
  const date = toDate(dateOnly);
  const asOf = toDate(asOfDate);
  if (!date || !asOf) return null;
  return Math.floor((asOf.getTime() - date.getTime()) / 86400000);
}

function eLevelIndex(eLevel) {
  return TRAINING_EXERCISE_E_LEVEL_VALUES.indexOf(eLevel);
}

function clampSkillLevel(level) {
  const value = Number(level || 0);
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(MAX_SKILL_LEVEL, Math.round(value)));
}

function getExpectedELevel(level) {
  const index = Math.min(
    clampSkillLevel(level),
    TRAINING_EXERCISE_E_LEVEL_VALUES.length - 2,
  );
  return TRAINING_EXERCISE_E_LEVEL_VALUES[index] || 'E1';
}

function getSkillELevelCorridor(entry) {
  const level = clampSkillLevel(entry.level);
  const targetELevel = entry.nextEStep || getExpectedELevel(level);
  const targetIndex = Math.max(0, eLevelIndex(targetELevel));
  const corridor = [targetELevel];

  if (level >= MAX_SKILL_LEVEL && targetELevel !== 'E7') {
    corridor.push('E7');
  } else if (entry.repeatFlag && targetIndex > 0) {
    corridor.push(TRAINING_EXERCISE_E_LEVEL_VALUES[targetIndex - 1]);
  } else if (targetIndex + 1 < TRAINING_EXERCISE_E_LEVEL_VALUES.length) {
    corridor.push(TRAINING_EXERCISE_E_LEVEL_VALUES[targetIndex + 1]);
  }

  return Array.from(new Set(corridor.filter(Boolean)));
}

function normalizeSearchText(value) {
  return String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function includesGoal(value, goal) {
  const needle = normalizeSearchText(goal);
  if (!needle) return false;
  return normalizeSearchText(value).includes(needle);
}

function getLatestTrainingLevel(trainingNotes = []) {
  return trainingNotes.find((note) => note?.level)?.level || null;
}

function getTrainingLevelTarget(trainingLevel) {
  if (!trainingLevel) return 0;
  return TRAINING_LEVEL_TO_SKILL_LEVEL[trainingLevel] ?? 0;
}

function getNextTrainingLevelTarget(trainingLevel) {
  const levels = ['D', 'D+', 'C', 'C+', 'B', 'B+', 'A'];
  const index = levels.indexOf(trainingLevel);
  if (index < 0 || index + 1 >= levels.length) return getTrainingLevelTarget(trainingLevel);
  return getTrainingLevelTarget(levels[index + 1]);
}

function getLatestHistory(entry) {
  const history = Array.isArray(entry.history) ? entry.history : [];
  return [...history].sort((left, right) => {
    const leftTime = new Date(left.occurredAt || left.createdAt || 0).getTime();
    const rightTime = new Date(right.occurredAt || right.createdAt || 0).getTime();
    if (leftTime !== rightTime) return rightTime - leftTime;
    return Number(right.id || 0) - Number(left.id || 0);
  })[0] || null;
}

function skillMatchesGoal(entry, exercises, goal) {
  if (!goal) return false;
  const skill = entry.skill || {};
  if (
    includesGoal(skill.name, goal) ||
    includesGoal(skill.description, goal) ||
    includesGoal(DIRECTION_LABELS[skill.direction], goal) ||
    includesGoal(skill.direction, goal)
  ) {
    return true;
  }

  return exercises.some((exercise) => {
    if (!exercise.skillIds.includes(Number(entry.skillId))) return false;
    return (
      includesGoal(exercise.name, goal) ||
      includesGoal(exercise.description, goal) ||
      includesGoal(exercise.successCriterion, goal)
    );
  });
}

function scoreSkill(entry, context) {
  const level = clampSkillLevel(entry.level);
  const latestHistory = getLatestHistory(entry);
  const latestRating =
    latestHistory?.rating === null || latestHistory?.rating === undefined
      ? null
      : Number(latestHistory.rating);
  const daysSinceLast = getDaysSince(entry.lastTrainedAt, context.asOfDate);
  const goalMatch = skillMatchesGoal(entry, context.exercises, context.goal);
  const currentLevelTarget = getTrainingLevelTarget(context.latestTrainingLevel);
  const nextLevelTarget = getNextTrainingLevelTarget(context.latestTrainingLevel);
  const littleHistory = context.trainingNotes.length < 2;
  const reasons = [];
  let score = 0;

  const levelBoost = (MAX_SKILL_LEVEL - level) * 8;
  score += levelBoost;
  if (level <= 1) {
    reasons.push(`низкий уровень навыка ${level}/5`);
  } else {
    reasons.push(`уровень навыка ${level}/5`);
  }

  if (daysSinceLast === null) {
    score += 24;
    reasons.push('навык еще не отрабатывался в структурной истории');
  } else if (daysSinceLast >= STALE_DAYS) {
    score += 22;
    reasons.push(`давно не отрабатывался: ${daysSinceLast} дн.`);
  } else if (daysSinceLast >= MODERATELY_STALE_DAYS) {
    score += 12;
    reasons.push(`нужен повтор после паузы ${daysSinceLast} дн.`);
  }

  if (latestRating !== null && latestRating <= 2) {
    score += 32;
    reasons.push(`последняя оценка низкая: ${latestRating}/5`);
  } else if (latestRating === 3) {
    score += 14;
    reasons.push('последняя оценка 3/5 требует закрепления');
  }

  if (entry.repeatFlag || latestHistory?.repeatFlag) {
    score += 34;
    reasons.push('стоит repeat flag');
  }

  if (goalMatch) {
    score += 18;
    reasons.push(`совпадает с целью: ${context.goal}`);
  }

  if (!context.latestTrainingLevel || level <= currentLevelTarget) {
    score += 10;
    reasons.push(
      context.latestTrainingLevel
        ? `базовый навык для уровня ${context.latestTrainingLevel}`
        : 'базовый навык при малой истории клиента',
    );
  }

  if (level < nextLevelTarget) {
    score += 16;
    reasons.push(`нужен для перехода к следующему уровню игры`);
  }

  const recentlyGood =
    daysSinceLast !== null &&
    daysSinceLast <= RECENT_GOOD_DAYS &&
    latestRating !== null &&
    latestRating >= HIGH_RATING &&
    !entry.repeatFlag &&
    !latestHistory?.repeatFlag;
  const loweredReason = recentlyGood
    ? 'временно ниже: недавно хорошо отработан и закрепление не требуется'
    : null;
  if (recentlyGood) score -= 30;
  if (littleHistory && daysSinceLast === null) {
    reasons.push('истории мало, начинаем с базового коридора');
  }

  return {
    daysSinceLast,
    latestRating,
    loweredReason,
    priorityScore: score,
    reasons,
    skill: entry.skill || null,
    skillId: Number(entry.skillId),
    targetELevel: entry.nextEStep || getExpectedELevel(level),
    eLevelCorridor: getSkillELevelCorridor(entry),
    level,
    repeatFlag: Boolean(entry.repeatFlag || latestHistory?.repeatFlag),
  };
}

function mapExercise(exercise) {
  const raw = exercise.toJSON ? exercise.toJSON() : exercise;
  const additionalSkills = raw.additionalSkills || [];
  const mainSkill = raw.mainSkill || null;
  const additionalSkillIds = additionalSkills.map((skill) => Number(skill.id));
  const mainSkillId = raw.mainSkillId ? Number(raw.mainSkillId) : null;

  return {
    additionalSkillIds,
    additionalSkills: additionalSkills.map((skill) => ({
      direction: skill.direction,
      id: Number(skill.id),
      name: skill.name,
      status: skill.status,
    })),
    complication: raw.complication || '',
    description: raw.description || '',
    eLevel: raw.eLevel || null,
    formats: parseFormats(raw.formats),
    id: Number(raw.id),
    mainSkill: mainSkill
      ? {
          direction: mainSkill.direction,
          id: Number(mainSkill.id),
          name: mainSkill.name,
          status: mainSkill.status,
        }
      : null,
    mainSkillId,
    name: raw.name,
    simplification: raw.simplification || '',
    skillIds: Array.from(
      new Set([mainSkillId, ...additionalSkillIds].filter(Boolean)),
    ),
    skillLevelMax:
      raw.skillLevelMax === null || raw.skillLevelMax === undefined
        ? null
        : Number(raw.skillLevelMax),
    skillLevelMin:
      raw.skillLevelMin === null || raw.skillLevelMin === undefined
        ? null
        : Number(raw.skillLevelMin),
    status: raw.status,
    successCriterion: raw.successCriterion || '',
  };
}

function exerciseMatchesSkillLevel(exercise, level) {
  if (exercise.skillLevelMin !== null && level < exercise.skillLevelMin) return false;
  if (exercise.skillLevelMax !== null && level > exercise.skillLevelMax) return false;
  return true;
}

function isWarmupExercise(exercise) {
  const text = normalizeSearchText(
    [
      exercise.name,
      exercise.description,
      exercise.successCriterion,
      exercise.mainSkill?.name,
    ].join(' '),
  );
  return (
    text.includes('размин') ||
    text.includes('warmup')
  );
}

function formatList(values) {
  return values.filter(Boolean).join(', ');
}

function getRecentExerciseUsage(trainingNotes = []) {
  const usage = new Map();
  trainingNotes.slice(0, RECENT_TRAININGS_LIMIT).forEach((note, noteIndex) => {
    (note.exerciseResults || []).forEach((result) => {
      const exerciseId = Number(result.trainingExerciseId || result.exercise?.id);
      if (!exerciseId || usage.has(exerciseId)) return;
      usage.set(exerciseId, {
        exerciseName: result.exercise?.name || result.exerciseName || 'упражнение',
        noteIndex,
        repeatExercise: Boolean(result.repeatExercise),
        repeatSkill: Boolean(result.repeatSkill),
      });
    });
  });
  return usage;
}

function getAntiRepeatDecision({ exercise, priority, recentUsage, relevantCandidates }) {
  const usage = recentUsage.get(Number(exercise.id));
  if (!usage) {
    return {
      allowed: true,
      reason: 'В последних 3 тренировках упражнение не встречалось.',
    };
  }

  const nonRecentAlternatives = relevantCandidates.filter(
    (candidate) => Number(candidate.id) !== Number(exercise.id) && !recentUsage.has(Number(candidate.id)),
  );
  if (usage.repeatExercise || usage.repeatSkill) {
    return {
      allowed: true,
      reason: `Повтор разрешен: тренер отметил «нужно повторить» для ${usage.exerciseName}.`,
    };
  }
  if (priority.repeatFlag || priority.latestRating !== null && priority.latestRating <= 3) {
    return {
      allowed: true,
      reason: 'Повтор разрешен: навык требует закрепления по repeat/оценке.',
    };
  }
  if (nonRecentAlternatives.length === 0) {
    return {
      allowed: true,
      reason: 'Повтор разрешен: по навыку нет альтернатив вне последних 3 тренировок.',
    };
  }
  if (isWarmupExercise(exercise)) {
    return {
      allowed: true,
      reason: 'Повтор разрешен: это базовая разминка.',
    };
  }

  return {
    allowed: false,
    reason: `Не повторяем ${usage.exerciseName} из последних 3 тренировок.`,
  };
}

function exerciseFormatScore(exercise, block) {
  const preferred = block.preferredFormats || [];
  const firstMatchIndex = preferred.findIndex((format) => exercise.formats.includes(format));
  if (firstMatchIndex >= 0) return 18 - firstMatchIndex * 4;
  if (block.focus === 'game' || block.focus === 'mini_game') return -18;
  return 0;
}

function exerciseELevelScore(exercise, priority) {
  if (!exercise.eLevel) return -16;
  const targetIndex = eLevelIndex(priority.targetELevel);
  const exerciseIndex = eLevelIndex(exercise.eLevel);
  if (exercise.eLevel === priority.targetELevel) return 24;
  if (priority.eLevelCorridor.includes(exercise.eLevel)) return 14;
  if (targetIndex < 0 || exerciseIndex < 0) return -10;
  return Math.max(-20, 10 - Math.abs(targetIndex - exerciseIndex) * 8);
}

function scoreExerciseCandidate({ antiRepeat, block, exercise, priority, usedExerciseIds }) {
  let score = priority.priorityScore;
  score += exerciseELevelScore(exercise, priority);
  score += exerciseFormatScore(exercise, block);
  if (exerciseMatchesSkillLevel(exercise, priority.level)) score += 12;
  else score -= 18;
  if (block.focus === 'warmup' && isWarmupExercise(exercise)) score += 20;
  if (Number(exercise.mainSkillId) === Number(priority.skillId)) score += 8;
  if (usedExerciseIds.has(Number(exercise.id))) score -= 70;
  if (!antiRepeat.allowed) score -= 200;
  return score;
}

function buildManualReuseReason(priority) {
  return {
    antiRepeat: 'Подходящее упражнение уже есть в плане. Повтор оставлен ручным блоком и не вставляется автоматически.',
    eLevel: `Целевой коридор ${formatList(priority.eLevelCorridor)} для уровня навыка ${priority.level}/5.`,
    skill: `Навык выбран по причинам: ${priority.reasons.join('; ')}.`,
    adjustment: 'Проще: дать короткую подводящую вариацию без отдельной строки упражнения. Сложнее: вручную заменить на другую игровую вариацию с тем же навыком.',
  };
}

function buildManualAntiRepeatReason(priority) {
  return {
    antiRepeat: 'Все свободные варианты нарушают правило последних 3 тренировок, поэтому блок оставлен ручным и не вставляется автоматически.',
    eLevel: `Целевой коридор ${formatList(priority.eLevelCorridor)} для уровня навыка ${priority.level}/5.`,
    skill: `Навык выбран по причинам: ${priority.reasons.join('; ')}.`,
    adjustment: 'Проще: провести навык устно или через короткую подводящую работу. Сложнее: вручную выбрать новую approved-вариацию после пополнения базы.',
  };
}

function chooseSkillForBlock(block, prioritySkills, usedSkillIds) {
  if (prioritySkills.length === 0) return null;

  if (block.focus === 'secondary') {
    return (
      prioritySkills.find(
        (priority) =>
          !usedSkillIds.has(priority.skillId) ||
          priority.repeatFlag ||
          priority.latestRating === 3,
      ) || prioritySkills[0]
    );
  }

  if (block.focus === 'game' || block.focus === 'mini_game') {
    return (
      prioritySkills.find((priority) => !usedSkillIds.has(priority.skillId)) ||
      prioritySkills[0]
    );
  }

  return prioritySkills[0];
}

function buildFallbackReason(block, priority) {
  if (!priority) {
    return {
      antiRepeat: 'Истории упражнений нет, повтор ограничивать нечего.',
      eLevel: 'Нет активной карты навыков, используйте базовую свободную работу.',
      skill: 'Навык не выбран: в методической базе нет активных навыков.',
      adjustment: 'Проще: уменьшить темп и площадь. Сложнее: добавить движение и счет.',
    };
  }

  return {
    antiRepeat: 'Недостаточно утвержденных упражнений, блок оставлен как ручной fallback.',
    eLevel: `Целевой коридор ${formatList(priority.eLevelCorridor)} для уровня навыка ${priority.level}/5.`,
    skill: `Навык выбран по причинам: ${priority.reasons.join('; ')}.`,
    adjustment: 'Проще: оставить подводящее движение без счета. Сложнее: добавить темп, счет или ограничение по зонам.',
  };
}

function buildExerciseReason({ antiRepeatReason, avoidedRecentNames, exercise, priority }) {
  const antiRepeat = avoidedRecentNames.length > 0
    ? `Не повторяем ${formatList(avoidedRecentNames)} из последних 3 тренировок; выбран другой вариант.`
    : antiRepeatReason;
  const levelRange = exercise.skillLevelMin === null || exercise.skillLevelMax === null
    ? 'без жесткого ограничения по уровню навыка'
    : `для уровня навыка ${exercise.skillLevelMin}-${exercise.skillLevelMax}`;

  return {
    antiRepeat,
    eLevel: `${exercise.eLevel || '-'} выбран, потому что целевой коридор навыка: ${formatList(priority.eLevelCorridor)}; ${levelRange}.`,
    skill: `Навык выбран по причинам: ${priority.reasons.join('; ')}.`,
    adjustment: [
      `Проще: ${exercise.simplification || 'снизить темп, оставить больше времени на подготовку и убрать счет'}.`,
      `Сложнее: ${exercise.complication || 'добавить движение, ограничить зоны или вести счет'}.`,
    ].join(' '),
  };
}

function chooseExerciseForBlock({
  block,
  exercises,
  priority,
  recentUsage,
  usedExerciseIds,
}) {
  if (!priority) return null;

  const relevantCandidates = exercises.filter((exercise) =>
    exercise.skillIds.includes(Number(priority.skillId)),
  );
  const blockCandidates = relevantCandidates.filter((exercise) => {
    if (block.focus === 'warmup') return true;
    if (!block.preferredFormats?.length) return true;
    return block.preferredFormats.some((format) => exercise.formats.includes(format));
  });
  const preferredCandidates = blockCandidates.length > 0 ? blockCandidates : relevantCandidates;
  if (preferredCandidates.length === 0) return null;

  const unusedPreferredCandidates = preferredCandidates.filter(
    (exercise) => !usedExerciseIds.has(Number(exercise.id)),
  );
  const unusedRelevantCandidates = relevantCandidates.filter(
    (exercise) => !usedExerciseIds.has(Number(exercise.id)),
  );
  const preferredCandidateIds = new Set(
    unusedPreferredCandidates.map((exercise) => Number(exercise.id)),
  );
  const fallbackCandidates = unusedRelevantCandidates.filter(
    (exercise) => !preferredCandidateIds.has(Number(exercise.id)),
  );
  const candidateTiers = [
    unusedPreferredCandidates,
    fallbackCandidates,
  ].filter((tier) => tier.length > 0);

  if (candidateTiers.length === 0) {
    return {
      exercise: null,
      reason: buildManualReuseReason(priority),
    };
  }

  const antiRepeatByExerciseId = new Map();
  const getAntiRepeat = (exercise) => {
    const exerciseId = Number(exercise.id);
    if (!antiRepeatByExerciseId.has(exerciseId)) {
      antiRepeatByExerciseId.set(
        exerciseId,
        getAntiRepeatDecision({
          exercise,
          priority,
          recentUsage,
          relevantCandidates,
        }),
      );
    }
    return antiRepeatByExerciseId.get(exerciseId);
  };

  const selected = candidateTiers
    .map((tier) =>
      tier
        .filter((exercise) => getAntiRepeat(exercise).allowed)
        .map((exercise) => {
          const antiRepeat = getAntiRepeat(exercise);
          return {
            antiRepeat,
            exercise,
            score: scoreExerciseCandidate({
              antiRepeat,
              block,
              exercise,
              priority,
              usedExerciseIds,
            }),
          };
        })
        .sort((left, right) => {
          if (left.score !== right.score) return right.score - left.score;
          return String(left.exercise.name).localeCompare(String(right.exercise.name));
        })[0],
    )
    .find(Boolean);
  if (!selected) {
    return {
      exercise: null,
      reason: buildManualAntiRepeatReason(priority),
    };
  }

  const avoidedRecentNames = relevantCandidates
    .filter((exercise) => !getAntiRepeat(exercise).allowed)
    .map((exercise) => recentUsage.get(Number(exercise.id))?.exerciseName)
    .filter(Boolean);

  return {
    exercise: selected.exercise,
    reason: buildExerciseReason({
      antiRepeatReason: selected.antiRepeat.reason,
      avoidedRecentNames,
      exercise: selected.exercise,
      priority,
    }),
  };
}

function buildBlock({ block, exerciseSelection, priority }) {
  const exercise = exerciseSelection?.exercise || null;
  return {
    exercise: exercise
      ? {
          eLevel: exercise.eLevel,
          formats: exercise.formats,
          id: exercise.id,
          mainSkill: exercise.mainSkill,
          name: exercise.name,
          successCriterion: exercise.successCriterion,
        }
      : null,
    insertable: Boolean(exercise),
    isFallback: !exercise,
    key: block.key,
    reason: exerciseSelection?.reason || buildFallbackReason(block, priority),
    skill: priority?.skill || null,
    skillId: priority?.skillId || null,
    targetELevel: priority?.targetELevel || null,
    title: block.title,
  };
}

function rankSkills({ asOfDate, exercises, goal, skillMap, trainingNotes }) {
  return skillMap
    .map((entry) =>
      scoreSkill(entry, {
        asOfDate,
        exercises,
        goal,
        latestTrainingLevel: getLatestTrainingLevel(trainingNotes),
        trainingNotes,
      }),
    )
    .sort((left, right) => {
      if (left.priorityScore !== right.priorityScore) {
        return right.priorityScore - left.priorityScore;
      }
      return String(left.skill?.name || '').localeCompare(String(right.skill?.name || ''));
    });
}

function buildRecommendation({
  asOfDate,
  exercises,
  goal = '',
  skillMap = [],
  trainingNotes = [],
}) {
  const normalizedGoal = normalizeGoal(goal);
  const normalizedDate = normalizeDateOnly(asOfDate);
  const recentUsage = getRecentExerciseUsage(trainingNotes);
  const prioritySkills = rankSkills({
    asOfDate: normalizedDate,
    exercises,
    goal: normalizedGoal,
    skillMap,
    trainingNotes,
  });
  const usedExerciseIds = new Set();
  const usedSkillIds = new Set();
  const blocks = BLOCKS.map((block) => {
    const priority = chooseSkillForBlock(block, prioritySkills, usedSkillIds);
    const exerciseSelection = chooseExerciseForBlock({
      block,
      exercises,
      priority,
      recentUsage,
      usedExerciseIds,
    });
    if (priority?.skillId) usedSkillIds.add(priority.skillId);
    if (exerciseSelection?.exercise?.id) {
      usedExerciseIds.add(Number(exerciseSelection.exercise.id));
    }
    return buildBlock({ block, exerciseSelection, priority });
  });
  const fallbackBlocks = blocks.filter((block) => block.isFallback).length;
  const littleHistory = trainingNotes.length < 2;

  return {
    asOfDate: normalizedDate,
    blocks,
    generatedAt: `${normalizedDate}T00:00:00.000Z`,
    goal: normalizedGoal,
    prioritySkills: prioritySkills.slice(0, 5).map((priority) => ({
      daysSinceLast: priority.daysSinceLast,
      eLevelCorridor: priority.eLevelCorridor,
      latestRating: priority.latestRating,
      level: priority.level,
      loweredReason: priority.loweredReason,
      priorityScore: priority.priorityScore,
      reasons: priority.reasons,
      repeatFlag: priority.repeatFlag,
      skill: priority.skill,
      skillId: priority.skillId,
      targetELevel: priority.targetELevel,
    })),
    summary: {
      approvedExercisesCount: exercises.length,
      fallbackBlocks,
      historyDepth: trainingNotes.length,
      latestTrainingLevel: getLatestTrainingLevel(trainingNotes),
      littleHistory,
      recentExerciseIds: Array.from(recentUsage.keys()),
      selectedExerciseIds: Array.from(usedExerciseIds),
    },
  };
}

function getMajorityCount(count) {
  return Math.floor(Number(count || 0) / 2) + 1;
}

function roundOne(value) {
  return Math.round(Number(value || 0) * 10) / 10;
}

function mapClientLite(client) {
  const raw = client?.toJSON ? client.toJSON() : client;
  return {
    id: Number(raw.id),
    name: raw.name || `Клиент ${raw.id}`,
    status: raw.status,
  };
}

function buildParticipantContext({
  asOfDate,
  client,
  exercises,
  goal,
  skillMap = [],
  trainingNotes = [],
}) {
  const mappedClient = mapClientLite(client);
  return {
    asOfDate,
    client: mappedClient,
    clientId: mappedClient.id,
    clientName: mappedClient.name,
    exercises,
    goal,
    latestTrainingLevel: getLatestTrainingLevel(trainingNotes),
    skillById: new Map(skillMap.map((entry) => [Number(entry.skillId), entry])),
    skillMap,
    trainingNotes,
  };
}

function hasGoalReason(priority) {
  return (priority.reasons || []).some((reason) => reason.includes('совпадает с целью'));
}

function isParticipantSkillRelevant(priority) {
  return (
    priority.repeatFlag ||
    priority.latestRating !== null && priority.latestRating <= 3 ||
    priority.daysSinceLast === null ||
    priority.daysSinceLast >= MODERATELY_STALE_DAYS ||
    hasGoalReason(priority) ||
    priority.priorityScore >= 48
  );
}

function isStaleForGroup(daysSinceLast) {
  return daysSinceLast === null || daysSinceLast >= STALE_DAYS;
}

function isModeratelyStaleForGroup(daysSinceLast) {
  return daysSinceLast === null || daysSinceLast >= MODERATELY_STALE_DAYS;
}

function formatParticipantNames(participants = []) {
  return participants.map((participant) => participant.clientName).filter(Boolean).join(', ');
}

function mapParticipantStat(stat) {
  return {
    clientId: stat.clientId,
    clientName: stat.clientName,
    daysSinceLast: stat.daysSinceLast,
    latestRating: stat.latestRating,
    level: stat.level,
    priorityScore: stat.priorityScore,
    relevant: stat.relevant,
    repeatFlag: stat.repeatFlag,
  };
}

function scoreParticipantSkill(context, entry) {
  return scoreSkill(entry, {
    asOfDate: context.asOfDate,
    exercises: context.exercises,
    goal: context.goal,
    latestTrainingLevel: context.latestTrainingLevel,
    trainingNotes: context.trainingNotes,
  });
}

function buildGroupSkillComparison(skillId, participantContexts) {
  const entries = participantContexts
    .map((context) => context.skillById.get(Number(skillId)))
    .filter(Boolean);
  const firstEntry = entries[0];
  if (!firstEntry) return null;

  const participantStats = participantContexts
    .map((context) => {
      const entry = context.skillById.get(Number(skillId));
      if (!entry) return null;
      const priority = scoreParticipantSkill(context, entry);
      return {
        clientId: context.clientId,
        clientName: context.clientName,
        daysSinceLast: priority.daysSinceLast,
        latestRating: priority.latestRating,
        level: priority.level,
        priorityScore: priority.priorityScore,
        reasons: priority.reasons,
        relevant: isParticipantSkillRelevant(priority),
        repeatFlag: priority.repeatFlag,
      };
    })
    .filter(Boolean);

  if (participantStats.length === 0) return null;

  const participantCount = participantStats.length;
  const majorityCount = getMajorityCount(participantCount);
  const levels = participantStats.map((stat) => stat.level);
  const minLevel = Math.min(...levels);
  const maxLevel = Math.max(...levels);
  const averageLevel = roundOne(
    levels.reduce((sum, level) => sum + level, 0) / participantCount,
  );
  const targetLevel = clampSkillLevel(Math.round(averageLevel));
  const levelSpread = maxLevel - minLevel;
  const relevantCount = participantStats.filter((stat) => stat.relevant).length;
  const staleCount = participantStats.filter((stat) =>
    isStaleForGroup(stat.daysSinceLast),
  ).length;
  const moderatelyStaleCount = participantStats.filter((stat) =>
    isModeratelyStaleForGroup(stat.daysSinceLast),
  ).length;
  const repeatCount = participantStats.filter((stat) => stat.repeatFlag).length;
  const lowRatingCount = participantStats.filter(
    (stat) => stat.latestRating !== null && stat.latestRating <= 3,
  ).length;
  const goalMatch = skillMatchesGoal(firstEntry, participantContexts[0]?.exercises || [], participantContexts[0]?.goal);
  const weakParticipants = participantStats.filter(
    (stat) => stat.level <= averageLevel - 1 || (levelSpread > 2 && stat.level === minLevel),
  );
  const advancedParticipants = participantStats.filter(
    (stat) => stat.level >= averageLevel + 1 || (levelSpread > 2 && stat.level === maxLevel),
  );
  const targetELevel = getExpectedELevel(targetLevel);
  const eLevelCorridor = getSkillELevelCorridor({
    level: targetLevel,
    nextEStep: targetELevel,
    repeatFlag: repeatCount >= majorityCount,
  });
  const averagePriorityScore = participantStats.reduce(
    (sum, stat) => sum + stat.priorityScore,
    0,
  ) / participantCount;
  const reasons = [];
  let priorityScore = averagePriorityScore;

  if (relevantCount >= majorityCount) {
    priorityScore += 26;
    reasons.push(`актуален большинству: ${relevantCount}/${participantCount}`);
  } else {
    priorityScore -= 18;
    reasons.push(`актуален не всей группе: ${relevantCount}/${participantCount}`);
  }

  if (staleCount >= majorityCount) {
    priorityScore += 24;
    reasons.push(`давно не отрабатывался у большинства: ${staleCount}/${participantCount}`);
  } else if (moderatelyStaleCount >= majorityCount) {
    priorityScore += 12;
    reasons.push(`нужен повтор после паузы у большинства: ${moderatelyStaleCount}/${participantCount}`);
  }

  if (goalMatch) {
    priorityScore += 22;
    reasons.push(`совпадает с темой: ${participantContexts[0]?.goal}`);
  }
  if (repeatCount > 0) {
    priorityScore += repeatCount * 8;
    reasons.push(`repeat у участников: ${repeatCount}/${participantCount}`);
  }
  if (lowRatingCount > 0) {
    priorityScore += lowRatingCount * 6;
    reasons.push(`есть оценки 1-3/5: ${lowRatingCount}/${participantCount}`);
  }
  if (levelSpread > 2) {
    priorityScore -= levelSpread * 3;
  }

  return {
    advancedParticipants: advancedParticipants.map(mapParticipantStat),
    averageLevel,
    eLevelCorridor,
    levelSpread,
    majorityRelevant: relevantCount >= majorityCount,
    maxLevel,
    minLevel,
    participantCount,
    participants: participantStats.map(mapParticipantStat),
    priorityScore: roundOne(priorityScore),
    reasons,
    relevantCount,
    skill: firstEntry.skill || null,
    skillId: Number(skillId),
    staleCount,
    staleMajority: staleCount >= majorityCount,
    targetELevel,
    targetLevel,
    warning:
      levelSpread > 2
        ? `Разброс по навыку ${levelSpread} уровня: нужна дифференциация.`
        : null,
    weakParticipants: weakParticipants.map(mapParticipantStat),
  };
}

function rankGroupSkills({ asOfDate, exercises, goal, participants }) {
  const participantContexts = participants.map((participant) =>
    buildParticipantContext({
      asOfDate,
      client: participant.client,
      exercises,
      goal,
      skillMap: participant.skillMap,
      trainingNotes: participant.trainingNotes,
    }),
  );
  const skillIds = new Set();
  participantContexts.forEach((context) => {
    context.skillMap.forEach((entry) => skillIds.add(Number(entry.skillId)));
  });

  const comparisons = Array.from(skillIds)
    .map((skillId) => buildGroupSkillComparison(skillId, participantContexts))
    .filter(Boolean)
    .sort((left, right) => {
      if (left.majorityRelevant !== right.majorityRelevant) {
        return left.majorityRelevant ? -1 : 1;
      }
      if (left.priorityScore !== right.priorityScore) {
        return right.priorityScore - left.priorityScore;
      }
      return String(left.skill?.name || '').localeCompare(String(right.skill?.name || ''));
    });

  return { comparisons, participantContexts };
}

function isGroupCapableExercise(exercise) {
  return ['group', 'pair', 'game'].some((format) => exercise.formats.includes(format));
}

function hasExerciseAdjustments(exercise) {
  return Boolean(
    String(exercise.simplification || '').trim() &&
    String(exercise.complication || '').trim(),
  );
}

function exerciseFitsGroupLevels(exercise, comparison) {
  if (!exerciseMatchesSkillLevel(exercise, Math.round(comparison.averageLevel))) {
    return false;
  }
  if (
    exercise.skillLevelMin !== null &&
    exercise.skillLevelMin > comparison.minLevel + 1
  ) {
    return false;
  }
  if (
    exercise.skillLevelMax !== null &&
    exercise.skillLevelMax < comparison.maxLevel - 1
  ) {
    return false;
  }
  return true;
}

function getGroupRecentExerciseUsage(participantContexts = []) {
  const usage = new Map();
  participantContexts.forEach((context) => {
    const seenForParticipant = new Set();
    context.trainingNotes.slice(0, RECENT_TRAININGS_LIMIT).forEach((note) => {
      (note.exerciseResults || []).forEach((result) => {
        const exerciseId = Number(result.trainingExerciseId || result.exercise?.id);
        if (!exerciseId || seenForParticipant.has(exerciseId)) return;
        seenForParticipant.add(exerciseId);
        if (!usage.has(exerciseId)) {
          usage.set(exerciseId, {
            exerciseName: result.exercise?.name || result.exerciseName || 'упражнение',
            participantIds: new Set(),
            participantNames: [],
          });
        }
        const entry = usage.get(exerciseId);
        entry.participantIds.add(context.clientId);
        entry.participantNames.push(context.clientName);
      });
    });
  });

  return usage;
}

function getGroupAntiRepeatDecision({ exercise, majorityCount, recentUsage }) {
  const usage = recentUsage.get(Number(exercise.id));
  if (!usage) {
    return {
      allowed: true,
      reason: 'В последних 3 тренировках участников упражнение не встречалось.',
    };
  }

  const count = usage.participantIds.size;
  if (count >= majorityCount) {
    return {
      allowed: false,
      reason: `Не повторяем ${usage.exerciseName}: недавно было у большинства (${count}).`,
    };
  }

  return {
    allowed: true,
    reason: `Недавно было у ${formatParticipantNames(
      usage.participantNames.map((clientName) => ({ clientName })),
    )}, но не у большинства группы.`,
  };
}

function scoreGroupExerciseCandidate({
  antiRepeat,
  block,
  comparison,
  exercise,
  usedExerciseIds,
}) {
  let score = comparison.priorityScore;
  score += exerciseELevelScore(exercise, comparison);
  score += exerciseFormatScore(exercise, block);
  if (Number(exercise.mainSkillId) === Number(comparison.skillId)) score += 10;
  if (exercise.skillLevelMin === null && exercise.skillLevelMax === null) score += 6;
  if (
    exercise.skillLevelMin !== null &&
    exercise.skillLevelMin > comparison.minLevel
  ) {
    score -= 10;
  }
  if (
    exercise.skillLevelMax !== null &&
    exercise.skillLevelMax < comparison.maxLevel
  ) {
    score -= 10;
  }
  if (usedExerciseIds.has(Number(exercise.id))) score -= 80;
  if (!antiRepeat.allowed) score -= 300;
  return score;
}

function buildGroupManualReason(comparison, detail) {
  return {
    antiRepeat: detail || 'Нет подходящего approved-упражнения вне недавних повторов большинства.',
    level: `Группа: min ${comparison?.minLevel ?? '-'}, avg ${comparison?.averageLevel ?? '-'}, max ${comparison?.maxLevel ?? '-'}, разброс ${comparison?.levelSpread ?? '-'}.`,
    skill: comparison
      ? `Навык выбран по группе: ${comparison.reasons.join('; ')}.`
      : 'Навык не выбран: активная карта навыков недоступна.',
    variations: 'Проще: дать подводящую версию вручную. Сложнее: добавить счет, темп или игровое ограничение вручную.',
  };
}

function buildGroupExerciseReason({ antiRepeatReason, comparison, exercise }) {
  const levelRange = exercise.skillLevelMin === null || exercise.skillLevelMax === null
    ? 'без жесткого диапазона уровней'
    : `диапазон ${exercise.skillLevelMin}-${exercise.skillLevelMax}`;

  return {
    antiRepeat: antiRepeatReason,
    level: `${exercise.eLevel || '-'} под средний уровень ${comparison.averageLevel}/5; ${levelRange}.`,
    skill: `Навык выбран по группе: ${comparison.reasons.join('; ')}.`,
    variations: 'Есть общая версия, упрощение для слабых участников и усложнение для сильных.',
  };
}

function buildFocusNotes(comparison, exercise) {
  const weakIds = new Set(comparison.weakParticipants.map((participant) => participant.clientId));
  const advancedIds = new Set(
    comparison.advancedParticipants.map((participant) => participant.clientId),
  );

  return comparison.participants.map((participant) => {
    let focus = '';
    let role = 'core';
    if (weakIds.has(participant.clientId)) {
      role = 'weak';
      focus = `Упрощение: ${exercise.simplification}. Держать качество контакта без ускорения.`;
    } else if (advancedIds.has(participant.clientId)) {
      role = 'advanced';
      focus = `Усложнение: ${exercise.complication}. Добавить темп, решение или счет.`;
    } else if (isModeratelyStaleForGroup(participant.daysSinceLast)) {
      focus = 'Общая версия: вернуть стабильность движения и не повышать сложность до серии успешных повторов.';
    } else if (participant.repeatFlag) {
      focus = 'Общая версия: закрепить без перехода на следующий шаг, следить за повторяемой ошибкой.';
    } else {
      focus = 'Общая версия: работать в среднем темпе и фиксировать качество по критерию успеха.';
    }

    return {
      clientId: participant.clientId,
      clientName: participant.clientName,
      daysSinceLast: participant.daysSinceLast,
      focus,
      latestRating: participant.latestRating,
      level: participant.level,
      role,
    };
  });
}

function chooseGroupSkillForBlock(block, comparisons, usedSkillIds) {
  const majoritySkills = comparisons.filter((comparison) => comparison.majorityRelevant);
  const preferred = majoritySkills.length > 0 ? majoritySkills : comparisons;

  if (block.focus === 'game' || block.focus === 'mini_game') {
    return preferred.find((comparison) => !usedSkillIds.has(comparison.skillId)) || preferred[0] || null;
  }

  if (block.key === 'group_differentiation') {
    return (
      preferred.find(
        (comparison) =>
          comparison.levelSpread > 0 && !usedSkillIds.has(comparison.skillId),
      ) ||
      preferred.find((comparison) => !usedSkillIds.has(comparison.skillId)) ||
      preferred[0] ||
      null
    );
  }

  return preferred.find((comparison) => !usedSkillIds.has(comparison.skillId)) || preferred[0] || null;
}

function chooseGroupExerciseForBlock({
  block,
  comparison,
  exercises,
  majorityCount,
  recentUsage,
  usedExerciseIds,
}) {
  if (!comparison) return null;

  const relevantCandidates = exercises.filter(
    (exercise) =>
      exercise.skillIds.includes(Number(comparison.skillId)) &&
      isGroupCapableExercise(exercise) &&
      hasExerciseAdjustments(exercise) &&
      exerciseFitsGroupLevels(exercise, comparison),
  );
  const blockCandidates = relevantCandidates.filter((exercise) => {
    if (!block.preferredFormats?.length) return true;
    return block.preferredFormats.some((format) => exercise.formats.includes(format));
  });
  const preferredCandidates = blockCandidates.length > 0 ? blockCandidates : relevantCandidates;
  if (preferredCandidates.length === 0) {
    return {
      exercise: null,
      reason: buildGroupManualReason(
        comparison,
        'Нет approved group/pair/game упражнения с упрощением, усложнением и подходящим уровнем.',
      ),
    };
  }

  const unusedPreferredCandidates = preferredCandidates.filter(
    (exercise) => !usedExerciseIds.has(Number(exercise.id)),
  );
  if (unusedPreferredCandidates.length === 0) {
    return {
      exercise: null,
      reason: buildGroupManualReason(
        comparison,
        'Подходящие упражнения уже выбраны в других блоках плана.',
      ),
    };
  }
  const antiRepeatByExerciseId = new Map();
  const getAntiRepeat = (exercise) => {
    const exerciseId = Number(exercise.id);
    if (!antiRepeatByExerciseId.has(exerciseId)) {
      antiRepeatByExerciseId.set(
        exerciseId,
        getGroupAntiRepeatDecision({ exercise, majorityCount, recentUsage }),
      );
    }
    return antiRepeatByExerciseId.get(exerciseId);
  };
  const selected = unusedPreferredCandidates
    .map((exercise) => {
      const antiRepeat = getAntiRepeat(exercise);
      return {
        antiRepeat,
        exercise,
        score: scoreGroupExerciseCandidate({
          antiRepeat,
          block,
          comparison,
          exercise,
          usedExerciseIds,
        }),
      };
    })
    .filter((candidate) => candidate.antiRepeat.allowed)
    .sort((left, right) => {
      if (left.score !== right.score) return right.score - left.score;
      return String(left.exercise.name).localeCompare(String(right.exercise.name));
    })[0];

  if (!selected) {
    return {
      exercise: null,
      reason: buildGroupManualReason(
        comparison,
        'Все подходящие упражнения недавно повторялись у большинства группы.',
      ),
    };
  }

  return {
    exercise: selected.exercise,
    reason: buildGroupExerciseReason({
      antiRepeatReason: selected.antiRepeat.reason,
      comparison,
      exercise: selected.exercise,
    }),
  };
}

function buildGroupBlock({ block, comparison, exerciseSelection }) {
  const exercise = exerciseSelection?.exercise || null;
  return {
    advancedParticipants: comparison?.advancedParticipants || [],
    commonVersion: exercise
      ? exercise.description || `Общая версия: ${exercise.name}.`
      : 'Ручной блок: подберите упражнение из методической базы с вариациями.',
    exercise: exercise
      ? {
          complication: exercise.complication,
          description: exercise.description,
          eLevel: exercise.eLevel,
          formats: exercise.formats,
          id: exercise.id,
          mainSkill: exercise.mainSkill,
          name: exercise.name,
          simplification: exercise.simplification,
          successCriterion: exercise.successCriterion,
        }
      : null,
    focusNotes: exercise && comparison ? buildFocusNotes(comparison, exercise) : [],
    insertable: Boolean(exercise),
    isFallback: !exercise,
    key: block.key,
    reason: exerciseSelection?.reason || buildGroupManualReason(comparison),
    skill: comparison?.skill || null,
    skillId: comparison?.skillId || null,
    skillStats: comparison
      ? {
          averageLevel: comparison.averageLevel,
          levelSpread: comparison.levelSpread,
          maxLevel: comparison.maxLevel,
          minLevel: comparison.minLevel,
          relevantCount: comparison.relevantCount,
          staleCount: comparison.staleCount,
          staleMajority: comparison.staleMajority,
        }
      : null,
    targetELevel: comparison?.targetELevel || null,
    title: block.title,
    warning: comparison?.warning || null,
    weakParticipants: comparison?.weakParticipants || [],
  };
}

function buildGroupRecommendation({
  asOfDate,
  exercises,
  goal = '',
  participants = [],
}) {
  const normalizedGoal = normalizeGoal(goal);
  const normalizedDate = normalizeDateOnly(asOfDate);
  const { comparisons, participantContexts } = rankGroupSkills({
    asOfDate: normalizedDate,
    exercises,
    goal: normalizedGoal,
    participants,
  });
  const majorityCount = getMajorityCount(participantContexts.length);
  const recentUsage = getGroupRecentExerciseUsage(participantContexts);
  const usedExerciseIds = new Set();
  const usedSkillIds = new Set();
  const blocks = GROUP_BLOCKS.map((block) => {
    const comparison = chooseGroupSkillForBlock(block, comparisons, usedSkillIds);
    const exerciseSelection = chooseGroupExerciseForBlock({
      block,
      comparison,
      exercises,
      majorityCount,
      recentUsage,
      usedExerciseIds,
    });
    if (comparison?.skillId) usedSkillIds.add(comparison.skillId);
    if (exerciseSelection?.exercise?.id) {
      usedExerciseIds.add(Number(exerciseSelection.exercise.id));
    }
    return buildGroupBlock({ block, comparison, exerciseSelection });
  });
  const fallbackBlocks = blocks.filter((block) => block.isFallback).length;

  return {
    asOfDate: normalizedDate,
    blocks,
    generatedAt: `${normalizedDate}T00:00:00.000Z`,
    goal: normalizedGoal,
    participants: participantContexts.map((context) => ({
      clientId: context.clientId,
      historyDepth: context.trainingNotes.length,
      latestTrainingLevel: context.latestTrainingLevel,
      name: context.clientName,
      status: context.client.status,
    })),
    prioritySkills: comparisons.slice(0, 6),
    summary: {
      approvedExercisesCount: exercises.length,
      fallbackBlocks,
      majorityCount,
      participantCount: participantContexts.length,
      recentExerciseIds: Array.from(recentUsage.keys()),
      selectedExerciseIds: Array.from(usedExerciseIds),
      warningSkillsCount: comparisons.filter((comparison) => comparison.warning).length,
    },
    warnings: comparisons
      .filter((comparison) => comparison.warning)
      .slice(0, 5)
      .map((comparison) => ({
        skill: comparison.skill,
        skillId: comparison.skillId,
        text: comparison.warning,
      })),
  };
}

async function loadClientOrFail(clientId, context) {
  const client = await db.User.findOne({
    attributes: ['id', 'organizationId', 'status', 'mergedIntoUserId'],
    where: methodologyTenantWhere(context, {
      id: Number(clientId),
      mergedIntoUserId: null,
    }),
  });
  if (!client) throw appError('Клиент не найден', 404);
  return client;
}

async function loadGroupClientsOrFail(clientIds, context) {
  const clients = await db.User.findAll({
    attributes: ['id', 'name', 'organizationId', 'status', 'mergedIntoUserId'],
    where: methodologyTenantWhere(context, {
      id: { [Op.in]: clientIds },
      mergedIntoUserId: null,
    }),
  });
  const clientById = new Map(clients.map((client) => [Number(client.id), client]));
  const missingId = clientIds.find((clientId) => !clientById.has(Number(clientId)));
  if (missingId) throw appError(`Клиент ${missingId} не найден`, 404);
  const archivedClient = clientIds
    .map((clientId) => clientById.get(Number(clientId)))
    .find((client) => client.status === 'archived');
  if (archivedClient) {
    throw appError(`Клиент ${archivedClient.name || archivedClient.id} в архиве`, 409);
  }

  return clientIds.map((clientId) => clientById.get(Number(clientId)));
}

async function loadApprovedExercises(context) {
  if (!db.TrainingExercise) return [];

  const rows = await db.TrainingExercise.findAll({
    include: [
      {
        as: 'mainSkill',
        model: db.TrainingSkill,
        required: true,
        where: methodologyTenantWhere(context, {}),
      },
      {
        as: 'additionalSkills',
        model: db.TrainingSkill,
        required: false,
        through: { attributes: [] },
        where: methodologyTenantWhere(context, {}),
      },
    ],
    order: [
      ['eLevel', 'ASC'],
      ['name', 'ASC'],
    ],
    where: methodologyTenantWhere(context, {
      status: 'approved',
      mainSkillId: { [Op.ne]: null },
    }),
  });

  return rows.map(mapExercise);
}

async function recommendForClient(
  clientId,
  query = {},
  actor = null,
  tenant = null,
  options = {},
) {
  const context = await resolveMethodologyAccessContext(tenant);
  const authorityActor = options.bookingPlanRecommendationDelegation
    ? validateBookingPlanRecommendationDelegation(
        options.bookingPlanRecommendationDelegation,
        actor,
        context,
      )
    : bindMethodologyActor(actor, context);
  if (!options.bookingPlanRecommendationDelegation) assertCanView(authorityActor);
  const id = normalizeClientId(clientId);
  const asOfDate = normalizeDateOnly(query.date);
  const goal = normalizeGoal(query.goal);
  const client = await loadClientOrFail(id, context);
  const [skillMap, trainingNotes, exercises] = await Promise.all([
    clientSkillMapService.listForClient(id, authorityActor, {
      bookingPlanRecommendationDelegation:
        options.bookingPlanRecommendationDelegation,
      tenant,
    }),
    trainingNotesService.listByClient(id, {
      actor: authorityActor,
      bookingPlanRecommendationDelegation:
        options.bookingPlanRecommendationDelegation,
      limit: 50,
      skipClientCheck: true,
      tenant,
    }),
    loadApprovedExercises(context),
  ]);

  return {
    clientId: id,
    clientStatus: client.status,
    ...buildRecommendation({
      asOfDate,
      exercises,
      goal,
      skillMap,
      trainingNotes,
    }),
  };
}

async function recommendForGroup(
  data = {},
  actor = null,
  tenant = null,
  options = {},
) {
  const context = await resolveMethodologyAccessContext(tenant);
  const authorityActor = options.bookingPlanRecommendationDelegation
    ? validateBookingPlanRecommendationDelegation(
        options.bookingPlanRecommendationDelegation,
        actor,
        context,
      )
    : bindMethodologyActor(actor, context);
  if (!options.bookingPlanRecommendationDelegation) assertCanView(authorityActor);
  const clientIds = normalizeClientIds(data.clientIds);
  const asOfDate = normalizeDateOnly(data.date);
  const goal = normalizeGoal(data.goal);
  const clients = await loadGroupClientsOrFail(clientIds, context);
  const exercises = await loadApprovedExercises(context);
  const participantRows = await Promise.all(
    clients.map(async (client) => {
      const clientId = Number(client.id);
      const [skillMap, trainingNotes] = await Promise.all([
        clientSkillMapService.listForClient(clientId, authorityActor, {
          bookingPlanRecommendationDelegation:
            options.bookingPlanRecommendationDelegation,
          tenant,
        }),
        trainingNotesService.listByClient(clientId, {
          actor: authorityActor,
          bookingPlanRecommendationDelegation:
            options.bookingPlanRecommendationDelegation,
          limit: 50,
          skipClientCheck: true,
          tenant,
        }),
      ]);

      return {
        client,
        skillMap,
        trainingNotes,
      };
    }),
  );

  return {
    clientIds,
    ...buildGroupRecommendation({
      asOfDate,
      exercises,
      goal,
      participants: participantRows,
    }),
  };
}

module.exports = {
  recommendForClient,
  recommendForGroup,
  __testing: {
    buildRecommendation,
    buildGroupRecommendation,
    getGroupAntiRepeatDecision,
    getGroupRecentExerciseUsage,
    getAntiRepeatDecision,
    getDaysSince,
    getExpectedELevel,
    getMajorityCount,
    getRecentExerciseUsage,
    getSkillELevelCorridor,
    normalizeDateOnly,
    normalizeClientIds,
    normalizeGoal,
    rankGroupSkills,
    rankSkills,
  },
};
