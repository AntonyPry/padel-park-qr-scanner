'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  auditEventBoundaries,
  auditRepository,
  auditSource,
} = require('../../scripts/audit-onboarding-writes');

test('onboarding repository audit accepts only the canonical service writer', () => {
  assert.deepEqual(auditRepository(), []);
});

test('onboarding repository audit rejects ORM, bulk and raw SQL bypasses', () => {
  const source = `
    db.OnboardingProgress.upsert(payload);
    const mode = await db.OnboardingTrainingMode.findOne();
    await mode.update(payload);
    await sequelize.query('DELETE FROM OnboardingEvents WHERE id=1');
  `;
  const findings = auditSource(source, 'src/services/bypass.js');
  assert.ok(findings.some((finding) => finding.type.includes('OnboardingProgress')));
  assert.ok(findings.some((finding) => finding.type.includes('OnboardingTrainingMode')));
  assert.ok(findings.some((finding) => finding.type.includes('OnboardingEvent')));
});

test('onboarding event audit requires an explicit tenant option', () => {
  assert.equal(
    auditEventBoundaries(
      "onboardingService.recordEventSafe(actor, 'audit.viewed', { tenant, payload: {} });",
    ).length,
    0,
  );
  assert.equal(
    auditEventBoundaries(
      "onboardingService.recordEventSafe(actor, 'audit.viewed', { payload: {} });",
    )[0].type,
    'recordEventSafe without explicit tenant boundary',
  );
});
