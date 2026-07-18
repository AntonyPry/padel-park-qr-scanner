'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  auditCanonicalServiceWrites,
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

test('onboarding event audit follows destructured, assigned and bound aliases', () => {
  const source = `
    const { recordEventSafe: destructured } = onboardingService;
    const assigned = destructured;
    let rebound;
    rebound = assigned.bind(onboardingService);
    destructured(actor, 'one', { payload: {} });
    assigned(actor, 'two', optionsWithoutTenant);
    rebound(actor, 'three', { payload: {} });
  `;
  const findings = auditEventBoundaries(source);
  assert.equal(findings.length, 3);
  assert.ok(findings.every((finding) => finding.type.includes('without explicit tenant')));
});

test('onboarding event audit resolves static option aliases and spreads', () => {
  const source = `
    const base = { tenant };
    const options = { ...base, payload: {} };
    const alias = options;
    const record = onboardingService.recordEventSafe;
    record(actor, 'safe', alias);
  `;
  assert.deepEqual(auditEventBoundaries(source), []);
  const unsafe = `
    const base = { payload: {} };
    const options = { ...base };
    const record = onboardingService.recordEventSafe.bind(onboardingService);
    record(actor, 'unsafe', options);
  `;
  assert.equal(auditEventBoundaries(unsafe).length, 1);
});

test('onboarding event audit follows factory-returned aliases and adjacent chains', () => {
  const unsafe = `
    const directFactory = () => onboardingService.recordEventSafe;
    const factoryAlias = directFactory;
    const boundFactory = factoryAlias.bind(null);
    const record = boundFactory();
    record(actor, 'factory', { payload: {} });

    function declaredFactory() {
      return record.bind(onboardingService);
    }
    declaredFactory()(actor, 'declared-factory', optionsWithoutTenant);
  `;
  assert.equal(auditEventBoundaries(unsafe).length, 2);

  const safe = `
    const base = { tenant };
    const options = { ...base, payload: {} };
    const make = () => onboardingService.recordEventSafe;
    const record = make();
    record(actor, 'factory-safe', options);
  `;
  assert.deepEqual(auditEventBoundaries(safe), []);
});

test('onboarding event audit follows static computed property references only', () => {
  const unsafe = `
    onboardingService['recordEventSafe'](actor, 'direct', { payload: {} });
    const record = onboardingService['recordEventSafe'];
    record(actor, 'alias', { payload: {} });
  `;
  assert.equal(auditEventBoundaries(unsafe).length, 2);

  const safe = `
    const options = { tenant, payload: {} };
    onboardingService['recordEventSafe'](actor, 'direct-safe', options);
    const record = onboardingService['recordEventSafe'].bind(onboardingService);
    record(actor, 'alias-safe', { ...options });
    onboardingService[eventMethod](actor, 'dynamic-unrelated', { payload: {} });
  `;
  assert.deepEqual(auditEventBoundaries(safe), []);
});

test('onboarding event audit follows destructuring assignment aliases', () => {
  const unsafe = `
    let assigned;
    ({ recordEventSafe: assigned } = onboardingService);
    const chained = assigned;
    chained(actor, 'assigned', { payload: {} });

    let shorthand;
    ({ recordEventSafe: shorthand } = serviceAlias);
    shorthand(actor, 'renamed', optionsWithoutTenant);
  `;
  assert.equal(auditEventBoundaries(unsafe).length, 2);

  const safe = `
    const base = { tenant };
    const options = { ...base, payload: {} };
    let assigned;
    ({ ['recordEventSafe']: assigned } = onboardingService);
    const rebound = assigned.bind(onboardingService);
    rebound(actor, 'assigned-safe', options);
  `;
  assert.deepEqual(auditEventBoundaries(safe), []);
});

test('canonical service audit rejects writes outside exact writer methods', () => {
  const source = `
    async function rogueWriter(payload) {
      await db.OnboardingProgress.create(payload);
      await db.sequelize.query('DELETE FROM OnboardingEvents');
    }
  `;
  const findings = auditCanonicalServiceWrites(source);
  assert.ok(findings.some((finding) => finding.type.includes('OnboardingProgress')));
  assert.ok(findings.some((finding) => finding.type.includes('OnboardingEvent')));
});
