const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  buildReport,
  getAuditExitCode,
  parseAuditArgs,
} = require('../../scripts/onboarding-audit');

test('onboarding audit args support diagnostic and strict modes', () => {
  assert.deepEqual(parseAuditArgs([]), { json: false, strict: false });
  assert.deepEqual(parseAuditArgs(['--json']), { json: true, strict: false });
  assert.deepEqual(parseAuditArgs(['--strict']), { json: false, strict: true });
  assert.deepEqual(
    parseAuditArgs(['--json', '--fail-on-warnings']),
    { json: true, strict: true },
  );
});

test('strict onboarding audit treats warnings as release failures', () => {
  const warningReport = { errors: [], warnings: ['missing event reference'] };
  const errorReport = { errors: ['invalid catalog'], warnings: [] };
  const cleanReport = { errors: [], warnings: [] };

  assert.equal(getAuditExitCode(warningReport, { strict: false }), 0);
  assert.equal(getAuditExitCode(warningReport, { strict: true }), 1);
  assert.equal(getAuditExitCode(errorReport, { strict: false }), 1);
  assert.equal(getAuditExitCode(cleanReport, { strict: true }), 0);
});

test('current onboarding catalog is strict-release ready', () => {
  const report = buildReport();

  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.warnings, []);
  assert.equal(report.usedEventCount, report.allowedEventCount);
  assert.equal(report.referencedEventCount, report.usedEventCount);
  assert.equal(report.missingInstructionScreenshotCount, 0);
  assert.ok(report.instructionScreenshotCount >= 2);
  assert.ok(report.screenshotRequiredCardCount >= 2);
  assert.equal(
    report.screenshotVerifiedCardCount,
    report.screenshotRequiredCardCount,
  );
  assert.equal(getAuditExitCode(report, { strict: true }), 0);
});
