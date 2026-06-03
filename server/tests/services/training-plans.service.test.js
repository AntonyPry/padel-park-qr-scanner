const assert = require('node:assert/strict');
const test = require('node:test');
const {
  __testing,
} = require('../../src/services/training-plans.service');

test('training plan validates personal and group participant counts', () => {
  assert.deepEqual(
    __testing.normalizeClientIds({ clientId: '12', kind: 'personal' }),
    [12],
  );
  assert.deepEqual(
    __testing.normalizeClientIds({ clientIds: ['12', 13, '12'], kind: 'group' }),
    [12, 13],
  );
  assert.throws(
    () => __testing.normalizeClientIds({ clientIds: [12, 13], kind: 'personal' }),
    /одного клиента/,
  );
  assert.throws(
    () => __testing.normalizeClientIds({ clientIds: [12], kind: 'group' }),
    /минимум двух/,
  );
});

test('training plan exercises keep recommendation block metadata', () => {
  assert.deepEqual(
    __testing.normalizePlannedExercises([
      {
        key: 'main',
        reason: { skill: 'repeat' },
        title: 'Основной блок',
        trainingExerciseId: '42',
      },
    ]),
    [
      {
        blockKey: 'main',
        blockTitle: 'Основной блок',
        orderIndex: 0,
        reasonSnapshot: '{"skill":"repeat"}',
        trainingExerciseId: 42,
      },
    ],
  );
});

test('training plan exercises reject duplicate exercise ids', () => {
  assert.throws(
    () =>
      __testing.normalizePlannedExercises([
        { trainingExerciseId: 42 },
        { exerciseId: '42' },
      ]),
    /дважды/,
  );
});

test('training plan extracts insertable exercises from recommendation blocks', () => {
  assert.deepEqual(
    __testing.extractInsertablePlanExercises([
      {
        exercise: { id: '42' },
        insertable: true,
        key: 'warmup',
        reason: { antiRepeat: 'ok' },
        title: 'Разминка',
      },
      {
        exercise: null,
        insertable: false,
        key: 'fallback',
        title: 'Ручной блок',
      },
    ]),
    [
      {
        blockKey: 'warmup',
        blockTitle: 'Разминка',
        reasonSnapshot: { antiRepeat: 'ok' },
        trainingExerciseId: 42,
      },
    ],
  );
});

test('training plan extracts only unique insertable exercises from recommendation blocks', () => {
  assert.deepEqual(
    __testing.extractInsertablePlanExercises([
      {
        exercise: { id: '1' },
        insertable: true,
        key: 'warmup',
        title: 'Разминка',
      },
      {
        exercise: { id: 4 },
        insertable: true,
        key: 'main',
        title: 'Основной блок',
      },
      {
        exercise: { id: '1' },
        insertable: true,
        key: 'game',
        title: 'Игра',
      },
    ]),
    [
      {
        blockKey: 'warmup',
        blockTitle: 'Разминка',
        reasonSnapshot: null,
        trainingExerciseId: 1,
      },
      {
        blockKey: 'main',
        blockTitle: 'Основной блок',
        reasonSnapshot: null,
        trainingExerciseId: 4,
      },
    ],
  );
});

test('training plan completion defaults planned exercises to structured results', () => {
  const results = __testing.normalizeCompletionExerciseResults(undefined, [
    { trainingExerciseId: 42 },
    { trainingExerciseId: 43 },
  ]);

  assert.deepEqual(results, [
    {
      canAdvance: false,
      comment: null,
      orderIndex: 0,
      rating: 3,
      repeatExercise: false,
      repeatSkill: false,
      trainingExerciseId: 42,
    },
    {
      canAdvance: false,
      comment: null,
      orderIndex: 1,
      rating: 3,
      repeatExercise: false,
      repeatSkill: false,
      trainingExerciseId: 43,
    },
  ]);
});

test('training plan completion supports participant-specific levels', () => {
  const participantResults = __testing.normalizeParticipantResults(
    {
      participantResults: [
        {
          clientId: '10',
          level: 'D+',
          note: '  персональная заметка  ',
        },
        {
          clientId: 11,
          level: 'C',
        },
      ],
      trainedAt: '2026-06-03',
    },
    {
      participants: [{ userId: 10 }, { userId: 11 }],
      plannedAt: '2026-06-02',
      plannedExercises: [{ trainingExerciseId: 42 }],
    },
  );

  assert.equal(participantResults[0].level, 'D+');
  assert.equal(participantResults[0].note, 'персональная заметка');
  assert.equal(participantResults[1].level, 'C');
  assert.equal(participantResults[1].trainedAt, '2026-06-03');
  assert.equal(participantResults[0].exerciseResults[0].trainingExerciseId, 42);
});
