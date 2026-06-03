const assert = require('node:assert/strict');
const test = require('node:test');
const {
  __testing,
} = require('../../src/services/client-skill-map.service');

test('client skill map accepts levels from 0 to 5 only', () => {
  assert.equal(__testing.normalizeSkillLevel('0'), 0);
  assert.equal(__testing.normalizeSkillLevel(5), 5);

  assert.throws(() => __testing.normalizeSkillLevel('-1'), /от 0 до 5/);
  assert.throws(() => __testing.normalizeSkillLevel('6'), /от 0 до 5/);
});

test('client skill map normalizes manual training metadata', () => {
  assert.equal(__testing.normalizeDateOnly('2026-06-02'), '2026-06-02');
  assert.equal(__testing.normalizeDateOnly(''), null);
  assert.equal(__testing.normalizeNextEStep('E4'), 'E4');
  assert.equal(__testing.normalizeNextEStep(null), null);
  assert.equal(__testing.normalizeRepeatFlag('true'), true);
  assert.equal(__testing.normalizeRepeatFlag('0'), false);

  assert.throws(() => __testing.normalizeDateOnly('02.06.2026'), /YYYY-MM-DD/);
  assert.throws(() => __testing.normalizeNextEStep('E8'), /E-step/);
});

test('client skill map update payload stays explicit and manual', () => {
  const payload = __testing.normalizeUpdatePayload(
    {
      lastTrainedAt: '2026-06-02',
      latestAssessment: 'Стабильно 7 из 10',
      latestExercises: 'Bandeja, выход к сетке',
      level: '3',
      nextEStep: 'E5',
      repeatFlag: true,
    },
    { id: 11, role: 'trainer' },
  );

  assert.deepEqual(payload, {
    lastTrainedAt: '2026-06-02',
    latestAssessment: 'Стабильно 7 из 10',
    latestExercises: 'Bandeja, выход к сетке',
    level: 3,
    nextEStep: 'E5',
    repeatFlag: true,
    updatedByAccountId: 11,
  });
  assert.throws(() => __testing.normalizeUpdatePayload({}), /Нет данных/);
});

function structuredResult(overrides = {}) {
  const index = overrides.index || 1;
  return {
    eLevel: 'E1',
    exerciseNameSnapshot: `Упражнение ${index}`,
    orderIndex: index,
    rating: 4,
    repeatExercise: false,
    repeatSkill: false,
    skillLevelMax: null,
    skillLevelMin: null,
    trainedAt: `2026-06-${String(index).padStart(2, '0')}`,
    trainingNoteCreatedAt: `2026-06-${String(index).padStart(2, '0')}T10:00:00.000Z`,
    trainingNoteExerciseId: index,
    trainingNoteId: index,
    trainingSkillId: 7,
    ...overrides,
  };
}

test('auto skill map advances exactly one level after two suitable high ratings', () => {
  const state = __testing.buildAutoSkillMapState({
    baselineLevel: 0,
    results: [
      structuredResult({ index: 1, rating: 4 }),
      structuredResult({ index: 2, rating: 5 }),
    ],
  });

  assert.equal(state.level, 1);
  assert.equal(state.repeatFlag, false);
  assert.equal(state.nextEStep, 'E2');
  assert.equal(state.history.at(-1).changeType, 'advanced');
  assert.match(state.history.at(-1).explanation, /две подходящие оценки/);
});

test('auto skill map does not advance after one high rating or unsuitable E-level', () => {
  const oneHigh = __testing.buildAutoSkillMapState({
    baselineLevel: 0,
    results: [structuredResult({ index: 1, rating: 5 })],
  });
  assert.equal(oneHigh.level, 0);
  assert.equal(oneHigh.nextEStep, 'E1');
  assert.equal(oneHigh.history.at(-1).changeType, 'hold');

  const wrongEStep = __testing.buildAutoSkillMapState({
    baselineLevel: 0,
    results: [
      structuredResult({ eLevel: 'E2', index: 1, rating: 5 }),
      structuredResult({ eLevel: 'E2', index: 2, rating: 5 }),
    ],
  });
  assert.equal(wrongEStep.level, 0);
  assert.equal(wrongEStep.history.at(-1).changeType, 'blocked');
  assert.match(wrongEStep.history.at(-1).explanation, /нужен E-level E1/);
});

test('auto skill map low rating sets repeat and lower E-step without downgrade', () => {
  const state = __testing.buildAutoSkillMapState({
    baselineLevel: 2,
    results: [structuredResult({ eLevel: 'E3', index: 1, rating: 2 })],
  });

  assert.equal(state.level, 2);
  assert.equal(state.repeatFlag, true);
  assert.equal(state.nextEStep, 'E2');
  assert.equal(state.history.at(-1).changeType, 'repeat');
});

test('auto skill map rating 3 keeps level and recommends consolidation', () => {
  const state = __testing.buildAutoSkillMapState({
    baselineLevel: 1,
    results: [structuredResult({ eLevel: 'E2', index: 1, rating: 3 })],
  });

  assert.equal(state.level, 1);
  assert.equal(state.repeatFlag, false);
  assert.equal(state.nextEStep, 'E2');
  assert.equal(state.history.at(-1).changeType, 'consolidate');
});

test('auto skill map repeat flags block advancement despite high rating', () => {
  const state = __testing.buildAutoSkillMapState({
    baselineLevel: 0,
    results: [
      structuredResult({ index: 1, rating: 5 }),
      structuredResult({ index: 2, rating: 5, repeatSkill: true }),
    ],
  });

  assert.equal(state.level, 0);
  assert.equal(state.repeatFlag, true);
  assert.equal(state.nextEStep, 'E1');
  assert.equal(state.history.at(-1).changeType, 'blocked');
});

test('auto skill map low latest rating prevents stale high-score advancement', () => {
  const state = __testing.buildAutoSkillMapState({
    baselineLevel: 0,
    results: [
      structuredResult({ index: 1, rating: 5 }),
      structuredResult({ index: 2, rating: 2 }),
      structuredResult({ index: 3, rating: 5 }),
    ],
  });

  assert.equal(state.level, 0);
  assert.equal(state.repeatFlag, false);
  assert.equal(state.history.at(-1).changeType, 'hold');
});

test('auto skill map respects exercise skill-level range', () => {
  const state = __testing.buildAutoSkillMapState({
    baselineLevel: 0,
    results: [
      structuredResult({ index: 1, rating: 5, skillLevelMin: 1 }),
      structuredResult({ index: 2, rating: 5, skillLevelMin: 1 }),
    ],
  });

  assert.equal(state.level, 0);
  assert.equal(state.history.at(-1).changeType, 'blocked');
});

test('auto skill map replay recalculates after edited training rating', () => {
  const beforeEdit = __testing.buildAutoSkillMapState({
    baselineLevel: 0,
    results: [
      structuredResult({ index: 1, rating: 4 }),
      structuredResult({ index: 2, rating: 5 }),
    ],
  });
  const afterEdit = __testing.buildAutoSkillMapState({
    baselineLevel: 0,
    results: [
      structuredResult({ index: 1, rating: 4 }),
      structuredResult({ index: 2, rating: 3 }),
    ],
  });

  assert.equal(beforeEdit.level, 1);
  assert.equal(afterEdit.level, 0);
  assert.equal(afterEdit.history.at(-1).changeType, 'consolidate');
});
