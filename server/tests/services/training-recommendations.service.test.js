const assert = require('node:assert/strict');
const test = require('node:test');
const {
  __testing,
} = require('../../src/services/training-recommendations.service');

function skillEntry(overrides = {}) {
  const id = overrides.skillId || overrides.id || 1;
  return {
    history: [],
    lastTrainedAt: null,
    latestAssessment: '',
    latestExercises: '',
    level: 0,
    nextEStep: null,
    repeatFlag: false,
    skill: {
      description: '',
      direction: 'technique',
      id,
      name: `Навык ${id}`,
      status: 'active',
    },
    skillId: id,
    ...overrides,
  };
}

function exercise(overrides = {}) {
  const id = overrides.id || 1;
  const mainSkillId = overrides.mainSkillId || overrides.skillId || 1;
  return {
    additionalSkillIds: [],
    additionalSkills: [],
    complication: 'Добавить темп',
    description: '',
    eLevel: 'E1',
    formats: ['personal'],
    id,
    mainSkill: {
      direction: 'technique',
      id: mainSkillId,
      name: `Навык ${mainSkillId}`,
      status: 'active',
    },
    mainSkillId,
    name: `Упражнение ${id}`,
    simplification: 'Снизить темп',
    skillIds: [mainSkillId],
    skillLevelMax: null,
    skillLevelMin: null,
    status: 'approved',
    successCriterion: '',
    ...overrides,
  };
}

function note(overrides = {}) {
  return {
    createdAt: '2026-05-30T10:00:00.000Z',
    exerciseResults: [],
    id: 1,
    level: 'D+',
    trainedAt: '2026-05-30',
    ...overrides,
  };
}

function participant(id, skillMap, trainingNotes = []) {
  return {
    client: {
      id,
      name: `Ученик ${id}`,
      status: 'active',
    },
    skillMap,
    trainingNotes,
  };
}

test('training recommendation ranks repeat, stale, low-rated and goal-matched skill first', () => {
  const recommendation = __testing.buildRecommendation({
    asOfDate: '2026-06-02',
    exercises: [
      exercise({ id: 10, mainSkillId: 1, name: 'Bandeja control', eLevel: 'E2' }),
      exercise({ id: 11, mainSkillId: 2, name: 'Volley line', eLevel: 'E4' }),
    ],
    goal: 'bandeja',
    skillMap: [
      skillEntry({
        history: [
          {
            createdAt: '2026-04-01T10:00:00.000Z',
            id: 1,
            rating: 2,
            repeatFlag: true,
          },
        ],
        lastTrainedAt: '2026-04-01',
        level: 1,
        nextEStep: 'E2',
        repeatFlag: true,
        skill: {
          description: 'Контроль bandeja',
          direction: 'technique',
          id: 1,
          name: 'Bandeja',
          status: 'active',
        },
        skillId: 1,
      }),
      skillEntry({
        history: [
          {
            createdAt: '2026-05-30T10:00:00.000Z',
            id: 2,
            rating: 5,
            repeatFlag: false,
          },
        ],
        lastTrainedAt: '2026-05-30',
        level: 3,
        skill: {
          description: '',
          direction: 'technique',
          id: 2,
          name: 'Volley',
          status: 'active',
        },
        skillId: 2,
      }),
    ],
    trainingNotes: [note({ level: 'D+' })],
  });

  assert.equal(recommendation.prioritySkills[0].skillId, 1);
  assert.equal(recommendation.prioritySkills[0].targetELevel, 'E2');
  assert.match(recommendation.prioritySkills[0].reasons.join(' '), /repeat flag/);
  assert.match(recommendation.prioritySkills[0].reasons.join(' '), /bandeja/i);
  assert.match(recommendation.prioritySkills[1].loweredReason, /недавно хорошо/);
});

test('training recommendation avoids exercises from last 3 trainings when alternative exists', () => {
  const recommendation = __testing.buildRecommendation({
    asOfDate: '2026-06-02',
    exercises: [
      exercise({ id: 20, mainSkillId: 1, name: 'Старая связка', eLevel: 'E1' }),
      exercise({ id: 21, mainSkillId: 1, name: 'Новая связка', eLevel: 'E1' }),
    ],
    skillMap: [skillEntry({ skillId: 1 })],
    trainingNotes: [
      note({
        exerciseResults: [
          {
            exercise: { id: 20, name: 'Старая связка' },
            exerciseName: 'Старая связка',
            rating: 4,
            repeatExercise: false,
            repeatSkill: false,
            trainingExerciseId: 20,
          },
        ],
        id: 10,
      }),
    ],
  });

  assert.equal(recommendation.summary.selectedExerciseIds.includes(20), false);
  assert.equal(recommendation.summary.selectedExerciseIds.includes(21), true);
  assert.match(
    recommendation.blocks.find((block) => block.exercise?.id === 21).reason.antiRepeat,
    /Не повторяем Старая связка/,
  );
});

test('training recommendation allows recent exercise when trainer marked repeat', () => {
  const recommendation = __testing.buildRecommendation({
    asOfDate: '2026-06-02',
    exercises: [
      exercise({ id: 30, mainSkillId: 1, name: 'Повторяемый контроль', eLevel: 'E1' }),
    ],
    skillMap: [skillEntry({ skillId: 1 })],
    trainingNotes: [
      note({
        exerciseResults: [
          {
            exercise: { id: 30, name: 'Повторяемый контроль' },
            exerciseName: 'Повторяемый контроль',
            rating: 3,
            repeatExercise: true,
            repeatSkill: false,
            trainingExerciseId: 30,
          },
        ],
      }),
    ],
  });

  assert.equal(recommendation.summary.selectedExerciseIds.includes(30), true);
  assert.match(recommendation.blocks[0].reason.antiRepeat, /нужно повторить/);
});

test('training recommendation avoids duplicate insertable exercises across blocks when alternatives exist', () => {
  const recommendation = __testing.buildRecommendation({
    asOfDate: '2026-06-02',
    exercises: [
      exercise({
        eLevel: 'E1',
        formats: ['personal', 'pair', 'game'],
        id: 40,
        mainSkillId: 1,
        name: 'Volley control A',
      }),
      exercise({
        eLevel: 'E1',
        formats: ['personal', 'pair', 'game'],
        id: 41,
        mainSkillId: 1,
        name: 'Volley control B',
      }),
      exercise({
        eLevel: 'E1',
        formats: ['personal', 'pair', 'game'],
        id: 42,
        mainSkillId: 1,
        name: 'Volley control C',
      }),
      exercise({
        eLevel: 'E1',
        formats: ['personal', 'pair', 'game'],
        id: 43,
        mainSkillId: 1,
        name: 'Volley control D',
      }),
      exercise({
        eLevel: 'E1',
        formats: ['personal', 'pair', 'game'],
        id: 44,
        mainSkillId: 1,
        name: 'Volley control E',
      }),
    ],
    goal: 'volley control',
    skillMap: [
      skillEntry({
        level: 1,
        nextEStep: 'E1',
        skill: {
          description: 'Volley control',
          direction: 'technique',
          id: 1,
          name: 'Volley control',
          status: 'active',
        },
        skillId: 1,
      }),
    ],
    trainingNotes: [note({ level: 'D+' })],
  });

  const insertableIds = recommendation.blocks
    .filter((block) => block.insertable)
    .map((block) => block.exercise?.id)
    .filter(Boolean);

  assert.equal(recommendation.blocks.length, 5);
  assert.equal(recommendation.summary.fallbackBlocks, 0);
  assert.equal(insertableIds.length, 5);
  assert.equal(new Set(insertableIds).size, insertableIds.length);
});

test('training recommendation marks unavoidable repeated exercise as manual fallback', () => {
  const recommendation = __testing.buildRecommendation({
    asOfDate: '2026-06-02',
    exercises: [
      exercise({
        eLevel: 'E1',
        id: 50,
        mainSkillId: 1,
        name: 'Only volley control',
      }),
    ],
    goal: 'volley control',
    skillMap: [
      skillEntry({
        level: 1,
        nextEStep: 'E1',
        skill: {
          description: 'Volley control',
          direction: 'technique',
          id: 1,
          name: 'Volley control',
          status: 'active',
        },
        skillId: 1,
      }),
    ],
    trainingNotes: [note({ level: 'D+' })],
  });

  const insertableBlocks = recommendation.blocks.filter((block) => block.insertable);
  const manualBlocks = recommendation.blocks.filter((block) => !block.insertable);

  assert.equal(recommendation.blocks.length, 5);
  assert.deepEqual(recommendation.summary.selectedExerciseIds, [50]);
  assert.equal(insertableBlocks.length, 1);
  assert.equal(manualBlocks.length, 4);
  assert.equal(recommendation.summary.fallbackBlocks, 4);
  assert.equal(manualBlocks[0].exercise, null);
  assert.match(manualBlocks[0].reason.antiRepeat, /уже есть в плане/);
  assert.match(manualBlocks[0].reason.antiRepeat, /не вставляется автоматически/);
});

test('training recommendation returns manual fallback blocks with little history and no approved exercises', () => {
  const recommendation = __testing.buildRecommendation({
    asOfDate: '2026-06-02',
    exercises: [],
    skillMap: [
      skillEntry({
        level: 0,
        skill: {
          description: '',
          direction: 'technique',
          id: 1,
          name: 'Контроль мяча',
          status: 'active',
        },
        skillId: 1,
      }),
    ],
    trainingNotes: [],
  });

  assert.equal(recommendation.blocks.length, 5);
  assert.equal(recommendation.summary.fallbackBlocks, 5);
  assert.equal(recommendation.summary.littleHistory, true);
  assert.equal(recommendation.blocks[0].insertable, false);
  assert.match(recommendation.blocks[0].reason.skill, /истории мало|Навык выбран/);
  assert.match(recommendation.blocks[0].reason.eLevel, /E1/);
});

test('training recommendation maps skill levels to E-level corridor including E7 at max level', () => {
  assert.equal(__testing.getExpectedELevel(0), 'E1');
  assert.equal(__testing.getExpectedELevel(5), 'E6');
  assert.deepEqual(
    __testing.getSkillELevelCorridor({ level: 5, nextEStep: null, repeatFlag: false }),
    ['E6', 'E7'],
  );
});

test('group training recommendation compares participant skill levels and warns on large spread', () => {
  const recommendation = __testing.buildGroupRecommendation({
    asOfDate: '2026-06-02',
    exercises: [
      exercise({
        complication: 'Добавить счет и ограничение по зонам',
        eLevel: 'E4',
        formats: ['group'],
        id: 100,
        mainSkillId: 1,
        name: 'Групповой контроль volley',
        simplification: 'Уменьшить темп и оставить подачу от тренера',
        skillLevelMax: 5,
        skillLevelMin: 0,
      }),
    ],
    goal: 'volley',
    participants: [
      participant(1, [
        skillEntry({
          lastTrainedAt: '2026-04-01',
          level: 1,
          skill: {
            description: 'Volley under pressure',
            direction: 'technique',
            id: 1,
            name: 'Volley',
            status: 'active',
          },
          skillId: 1,
        }),
      ]),
      participant(2, [
        skillEntry({
          lastTrainedAt: '2026-04-10',
          level: 3,
          skill: {
            description: 'Volley under pressure',
            direction: 'technique',
            id: 1,
            name: 'Volley',
            status: 'active',
          },
          skillId: 1,
        }),
      ]),
      participant(3, [
        skillEntry({
          lastTrainedAt: '2026-05-30',
          level: 5,
          skill: {
            description: 'Volley under pressure',
            direction: 'technique',
            id: 1,
            name: 'Volley',
            status: 'active',
          },
          skillId: 1,
        }),
      ]),
    ],
  });

  const skill = recommendation.prioritySkills[0];
  assert.equal(skill.skillId, 1);
  assert.equal(skill.minLevel, 1);
  assert.equal(skill.maxLevel, 5);
  assert.equal(skill.averageLevel, 3);
  assert.equal(skill.levelSpread, 4);
  assert.equal(skill.staleMajority, true);
  assert.match(skill.warning, /Разброс/);
  assert.deepEqual(skill.weakParticipants.map((item) => item.clientId), [1]);
  assert.deepEqual(skill.advancedParticipants.map((item) => item.clientId), [3]);
  assert.equal(recommendation.warnings.length, 1);

  const firstBlock = recommendation.blocks[0];
  assert.equal(firstBlock.exercise.id, 100);
  assert.match(firstBlock.commonVersion, /Групповой контроль volley/);
  assert.equal(firstBlock.weakParticipants[0].clientId, 1);
  assert.equal(firstBlock.advancedParticipants[0].clientId, 3);
  assert.equal(
    firstBlock.focusNotes.find((item) => item.clientId === 1).role,
    'weak',
  );
  assert.equal(
    firstBlock.focusNotes.find((item) => item.clientId === 3).role,
    'advanced',
  );
});

test('group training recommendation does not mark duplicate exercise fallbacks as insertable', () => {
  const recommendation = __testing.buildGroupRecommendation({
    asOfDate: '2026-06-02',
    exercises: [
      exercise({
        complication: 'Добавить темп',
        eLevel: 'E2',
        formats: ['group'],
        id: 150,
        mainSkillId: 1,
        name: 'Единственный group volley',
        simplification: 'Упростить подачу тренера',
        skillLevelMax: 4,
        skillLevelMin: 0,
      }),
    ],
    goal: 'volley control',
    participants: [
      participant(1, [skillEntry({ level: 1, nextEStep: 'E2', skillId: 1 })]),
      participant(2, [skillEntry({ level: 1, nextEStep: 'E2', skillId: 1 })]),
      participant(3, [skillEntry({ level: 1, nextEStep: 'E2', skillId: 1 })]),
    ],
  });

  const insertableIds = recommendation.blocks
    .filter((block) => block.insertable)
    .map((block) => block.exercise?.id)
    .filter(Boolean);
  const manualBlocks = recommendation.blocks.filter((block) => !block.insertable);

  assert.equal(recommendation.blocks.length, 5);
  assert.deepEqual(insertableIds, [150]);
  assert.deepEqual(recommendation.summary.selectedExerciseIds, [150]);
  assert.equal(recommendation.summary.fallbackBlocks, 4);
  assert.equal(manualBlocks.length, 4);
  assert.equal(manualBlocks[0].exercise, null);
  assert.match(manualBlocks[0].reason.antiRepeat, /уже выбраны/);
});

test('group training recommendation avoids exercises recently repeated by majority', () => {
  const recommendation = __testing.buildGroupRecommendation({
    asOfDate: '2026-06-02',
    exercises: [
      exercise({
        complication: 'Играть на счет',
        eLevel: 'E2',
        formats: ['group'],
        id: 200,
        mainSkillId: 1,
        name: 'Старая групповая связка',
        simplification: 'Снизить темп',
        skillLevelMax: 3,
        skillLevelMin: 0,
      }),
      exercise({
        complication: 'Добавить решение по направлению',
        eLevel: 'E2',
        formats: ['group'],
        id: 201,
        mainSkillId: 1,
        name: 'Новая групповая связка',
        simplification: 'Оставить короткую дистанцию',
        skillLevelMax: 3,
        skillLevelMin: 0,
      }),
    ],
    participants: [
      participant(
        1,
        [skillEntry({ level: 1, nextEStep: 'E2', skillId: 1 })],
        [
          note({
            exerciseResults: [
              {
                exercise: { id: 200, name: 'Старая групповая связка' },
                exerciseName: 'Старая групповая связка',
                rating: 4,
                trainingExerciseId: 200,
              },
            ],
          }),
        ],
      ),
      participant(
        2,
        [skillEntry({ level: 1, nextEStep: 'E2', skillId: 1 })],
        [
          note({
            exerciseResults: [
              {
                exercise: { id: 200, name: 'Старая групповая связка' },
                exerciseName: 'Старая групповая связка',
                rating: 4,
                trainingExerciseId: 200,
              },
            ],
          }),
        ],
      ),
      participant(3, [skillEntry({ level: 1, nextEStep: 'E2', skillId: 1 })]),
    ],
  });

  assert.equal(recommendation.summary.recentExerciseIds.includes(200), true);
  assert.equal(recommendation.summary.selectedExerciseIds.includes(200), false);
  assert.equal(recommendation.summary.selectedExerciseIds.includes(201), true);
  assert.match(recommendation.blocks[0].reason.antiRepeat, /не у большинства|не встречалось/);
});
