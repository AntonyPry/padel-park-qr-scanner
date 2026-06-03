const assert = require('node:assert/strict');
const test = require('node:test');
const {
  __testing,
} = require('../../src/services/training-methodology-analytics.service');

function skill(id, name = `Навык ${id}`) {
  return {
    direction: 'technique',
    id,
    name,
    status: 'active',
  };
}

function exercise(overrides = {}) {
  const mainSkillId = overrides.mainSkillId || 1;
  return {
    additionalSkills: overrides.additionalSkills || [],
    eLevel: overrides.eLevel || 'E2',
    formats: overrides.formats || ['personal'],
    id: overrides.id || 1,
    mainSkill: overrides.mainSkill || skill(mainSkillId),
    mainSkillId,
    name: overrides.name || `Упражнение ${overrides.id || 1}`,
    status: 'approved',
  };
}

function trainer(id = 7) {
  return {
    Staff: { name: `Тренер ${id}` },
    email: `trainer-${id}@example.com`,
    id,
    role: 'trainer',
  };
}

function note(overrides = {}) {
  return {
    User: overrides.User || { id: overrides.userId || 10, name: 'Клиент', status: 'active' },
    createdAt: overrides.createdAt || `${overrides.trainedAt || '2026-06-01'}T10:00:00.000Z`,
    exerciseResults: overrides.exerciseResults || [],
    id: overrides.id || 1,
    level: overrides.level || 'D',
    trainedAt: overrides.trainedAt || '2026-06-01',
    trainerAccount: overrides.trainerAccount || trainer(),
    trainerAccountId: overrides.trainerAccountId || 7,
    userId: overrides.userId || 10,
  };
}

function result(trainingExerciseId, overrides = {}) {
  return {
    exercise: overrides.exercise || exercise({ id: trainingExerciseId }),
    rating: overrides.rating || 3,
    repeatExercise: Boolean(overrides.repeatExercise),
    repeatSkill: Boolean(overrides.repeatSkill),
    trainingExerciseId,
  };
}

test('methodology analytics ranks frequent and rarely used exercises', () => {
  const usage = __testing.buildExerciseUsage(
    [
      note({
        exerciseResults: [
          result(1, { exercise: exercise({ id: 1, name: 'Частое' }), rating: 4 }),
          result(2, { exercise: exercise({ id: 2, name: 'Обычное' }), rating: 2 }),
        ],
      }),
      note({
        id: 2,
        trainedAt: '2026-06-02',
        exerciseResults: [
          result(1, { exercise: exercise({ id: 1, name: 'Частое' }), rating: 5 }),
        ],
      }),
    ],
    [
      exercise({ id: 1, name: 'Частое' }),
      exercise({ id: 2, name: 'Обычное' }),
      exercise({ id: 3, name: 'Не использовалось' }),
    ],
  );

  assert.equal(usage.structuredTrainingNotes, 2);
  assert.equal(usage.structuredResults, 3);
  assert.equal(usage.frequentExercises[0].exerciseId, 1);
  assert.equal(usage.frequentExercises[0].usageCount, 2);
  assert.equal(usage.rarelyUsedExercises[0].exerciseId, 3);
  assert.equal(usage.rarelyUsedExercises[0].usageCount, 0);
});

test('methodology analytics detects weak skills and clients without progress', () => {
  const historyRows = [
    {
      changeType: 'repeat',
      rating: 2,
      repeatFlag: true,
      skill: skill(1, 'Bandeja'),
      trainingSkillId: 1,
      userId: 10,
    },
    {
      changeType: 'blocked',
      rating: 4,
      repeatFlag: false,
      skill: skill(1, 'Bandeja'),
      trainingSkillId: 1,
      userId: 10,
    },
    {
      changeType: 'advanced',
      rating: 5,
      repeatFlag: false,
      skill: skill(2, 'Volley'),
      trainingSkillId: 2,
      userId: 11,
    },
  ];

  const weakSkills = __testing.buildWeakSkills(historyRows);
  assert.equal(weakSkills[0].skillId, 1);
  assert.equal(weakSkills[0].lowRatingCount, 1);
  assert.equal(weakSkills[0].repeatCount, 1);

  const clientsWithoutProgress = __testing.buildClientsWithoutProgress(
    [
      note({ exerciseResults: [result(1)], id: 1, userId: 10 }),
      note({ exerciseResults: [result(2)], id: 2, trainedAt: '2026-06-02', userId: 10 }),
      note({ exerciseResults: [result(3)], id: 3, userId: 11 }),
      note({ exerciseResults: [result(4)], id: 4, trainedAt: '2026-06-02', userId: 11 }),
    ],
    historyRows,
  );

  assert.equal(clientsWithoutProgress.length, 1);
  assert.equal(clientsWithoutProgress[0].userId, 10);
});

test('methodology analytics scores trainer monotony from repeats and missing game forms', () => {
  const monotony = __testing.buildTrainerVariety(
    [
      note({
        exerciseResults: [
          result(1, { exercise: exercise({ eLevel: 'E2', formats: ['personal'], id: 1 }) }),
          result(1, { exercise: exercise({ eLevel: 'E2', formats: ['personal'], id: 1 }) }),
          result(1, {
            exercise: exercise({ eLevel: 'E2', formats: ['personal'], id: 1 }),
            repeatSkill: true,
          }),
          result(2, { exercise: exercise({ eLevel: 'E3', formats: ['pair'], id: 2 }) }),
        ],
      }),
    ],
    [
      {
        changeType: 'repeat',
        rating: 2,
        trainingNote: { trainerAccountId: 7 },
      },
      {
        changeType: 'blocked',
        rating: 4,
        trainingNote: { trainerAccountId: 7 },
      },
    ],
  );

  assert.equal(monotony[0].trainer.id, 7);
  assert.ok(monotony[0].monotonyScore >= 60);
  assert.equal(monotony[0].flags.includes('повтор упражнений'), true);
  assert.equal(monotony[0].flags.includes('мало игровых форм'), true);
});

test('methodology analytics compares completed recommendation plan with actual exercises', () => {
  const adherence = __testing.buildRecommendationAdherence([
    {
      id: 12,
      participants: [
        {
          trainingNote: {
            exerciseResults: [
              { trainingExerciseId: 1 },
              { trainingExerciseId: 3 },
            ],
          },
        },
      ],
      plannedAt: '2026-06-01',
      plannedExercises: [
        { trainingExerciseId: 1 },
        { trainingExerciseId: 2 },
      ],
      sourceType: 'personal_recommendation',
      trainerAccount: trainer(7),
      trainerAccountId: 7,
    },
  ]);

  assert.equal(adherence.trainerRecommendationAdherence[0].deviatedPlans, 1);
  assert.equal(adherence.trainerRecommendationAdherence[0].averageAdherencePercent, 50);
  assert.equal(adherence.recommendationDeviationExamples[0].missingCount, 1);
  assert.equal(adherence.recommendationDeviationExamples[0].extraCount, 1);
});

test('methodology analytics finds clients stuck at the same training level', () => {
  const stuck = __testing.buildStuckLevelClients(
    [
      note({ id: 1, trainedAt: '2026-03-01', userId: 10 }),
      note({ id: 2, trainedAt: '2026-04-01', userId: 10 }),
      note({ id: 3, trainedAt: '2026-05-01', userId: 10 }),
      note({ id: 4, level: 'D', trainedAt: '2026-03-01', userId: 11 }),
      note({ id: 5, level: 'D+', trainedAt: '2026-05-01', userId: 11 }),
    ],
    '2026-06-03',
  );

  assert.equal(stuck.length, 1);
  assert.equal(stuck[0].userId, 10);
  assert.equal(stuck[0].currentLevel, 'D');
});
