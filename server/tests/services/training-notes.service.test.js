const assert = require('node:assert/strict');
const test = require('node:test');
const {
  __testing,
} = require('../../src/services/training-notes.service');

test('training note exercise results normalize compact trainer input', () => {
  const results = __testing.normalizeExerciseResults([
    {
      canAdvance: '1',
      comment: '  Стабильно  ',
      rating: '4',
      repeatExercise: false,
      repeatSkill: 'true',
      trainingExerciseId: '12',
    },
  ]);

  assert.deepEqual(results, [
    {
      canAdvance: true,
      comment: 'Стабильно',
      orderIndex: 0,
      rating: 4,
      repeatExercise: false,
      repeatSkill: true,
      trainingExerciseId: 12,
    },
  ]);
});

test('training note exercise results require rating from 1 to 5', () => {
  assert.throws(
    () =>
      __testing.normalizeExerciseResults([
        {
          rating: 6,
          trainingExerciseId: 12,
        },
      ]),
    /от 1 до 5/,
  );
});

test('training note exercise results reject duplicate exercises', () => {
  assert.throws(
    () =>
      __testing.normalizeExerciseResults([
        { rating: 3, trainingExerciseId: 12 },
        { rating: 4, trainingExerciseId: 12 },
      ]),
    /дважды/,
  );
});

test('training note exercise result comment stays short', () => {
  assert.throws(
    () =>
      __testing.normalizeExerciseResults([
        {
          comment: 'x'.repeat(241),
          rating: 4,
          trainingExerciseId: 12,
        },
      ]),
    /240/,
  );
});
