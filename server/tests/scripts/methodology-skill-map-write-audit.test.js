'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  ALLOWLISTS,
  auditRepository,
  auditSource,
} = require('../../scripts/audit-methodology-skill-map-writes');

test('methodology/skill-map repository audit passes exact writer allowlists', () => {
  assert.deepEqual([...ALLOWLISTS.TrainingSkill], [
    'src/services/training-methodology.service.js',
  ]);
  assert.deepEqual([...ALLOWLISTS.ClientTrainingSkill].sort(), [
    'src/services/client-skill-map.service.js',
    'src/services/clients.service.js',
    'src/services/onboarding.service.js',
  ]);
  assert.deepEqual([...ALLOWLISTS.TrainingNote].sort(), [
    'src/services/clients.service.js',
    'src/services/onboarding.service.js',
    'src/services/training-notes.service.js',
  ]);
  assert.deepEqual([...ALLOWLISTS.TrainingPlan].sort(), [
    'src/services/onboarding.service.js',
    'src/services/training-plans.service.js',
  ]);
  assert.deepEqual(auditRepository(), []);
});

test('methodology/skill-map audit detects model, instance, bulk and SQL writes', () => {
  const source = `
    await db.TrainingSkill.create({ organizationId: 2 });
    const exercise = await db.TrainingExercise.findByPk(1);
    await exercise.update({ organizationId: 2 });
    await db.ClientTrainingSkill.bulkCreate(rows);
    await queryInterface.bulkUpdate('ClientTrainingSkillHistories', values, where);
    await sequelize.query('DELETE FROM TrainingExerciseSkills WHERE trainingExerciseId=1');
  `;
  const findings = auditSource(source, 'bypass.js');
  assert.ok(findings.some((finding) => finding.type === 'TrainingSkill static write'));
  assert.ok(findings.some((finding) => finding.type === 'TrainingExercise instance write'));
  assert.ok(findings.some((finding) => finding.type === 'ClientTrainingSkill static write'));
  assert.ok(findings.some((finding) =>
    finding.type === 'ClientTrainingSkillHistories query-interface write'));
  assert.ok(findings.some((finding) =>
    finding.type === 'TrainingExerciseSkills raw SQL write'));
});
