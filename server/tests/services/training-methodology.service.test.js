const assert = require('node:assert/strict');
const test = require('node:test');
const {
  __testing,
} = require('../../src/services/training-methodology.service');

test('methodology exercise approval requires main skill and E-level', () => {
  assert.throws(
    () => __testing.assertExerciseCanBeApproved({ status: 'approved' }),
    /главного навыка/,
  );
  assert.throws(
    () =>
      __testing.assertExerciseCanBeApproved({
        mainSkillId: 1,
        status: 'approved',
      }),
    /E-level/,
  );
  assert.doesNotThrow(() =>
    __testing.assertExerciseCanBeApproved({
      eLevel: 'E3',
      mainSkillId: 1,
      status: 'approved',
    }),
  );
});

test('trainer-created methodology exercise is always a draft', () => {
  const payload = __testing.normalizeExercisePayload(
    {
      eLevel: 'E2',
      formats: ['personal', 'group', 'personal'],
      mainSkillId: 5,
      name: 'Контроль глубины',
      status: 'approved',
    },
    { id: 10, role: 'trainer' },
  );

  assert.equal(payload.status, 'draft');
  assert.deepEqual(payload.formats, ['personal', 'group']);
});

test('skill level range accepts exact value or ordered range', () => {
  assert.deepEqual(__testing.normalizeSkillLevelRange({ skillLevel: '3' }), {
    skillLevelMax: 3,
    skillLevelMin: 3,
  });
  assert.deepEqual(
    __testing.normalizeSkillLevelRange({ skillLevelMax: '5', skillLevelMin: '2' }),
    {
      skillLevelMax: 5,
      skillLevelMin: 2,
    },
  );
  assert.throws(
    () =>
      __testing.normalizeSkillLevelRange({
        skillLevelMax: '1',
        skillLevelMin: '4',
      }),
    /Минимальный уровень/,
  );
});
