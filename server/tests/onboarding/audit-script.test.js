const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  buildReport,
  collectInstructionScreenshotCoverage,
  collectLessonFreshnessWarnings,
  collectPilotScreenshotReleaseGateWarnings,
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

test('pilot screenshot release gate rejects draft markers', () => {
  const warnings = collectPilotScreenshotReleaseGateWarnings([
    {
      missions: [
        {
          tasks: [
            {
              key: 'admin.client.create',
              lesson: {
                blocks: [
                  { screenshotIndex: 0, type: 'step' },
                  {
                    missingScreenshot: 'Needs a real CRM screenshot',
                    screenshotRequired: false,
                    type: 'step',
                  },
                ],
              },
            },
          ],
        },
      ],
    },
  ]);

  assert.deepEqual(warnings, [
    'Pilot screenshot release gate: admin.client.create[1] still has draft screenshot marker',
  ]);
});

test('pilot screenshot release gate accepts section-first format with text-only action step', () => {
  const warnings = collectPilotScreenshotReleaseGateWarnings([
    {
      missions: [
        {
          tasks: [
            {
              key: 'admin.client.create',
              lesson: {
                format: 'section-first-cards',
                blocks: [
                  {
                    screenshotIndex: 0,
                    type: 'overview',
                  },
                  {
                    screenshotRequired: false,
                    type: 'step',
                  },
                ],
                screenshots: [
                  {
                    src: '/onboarding/admin/client-create/client-list.png',
                  },
                ],
              },
            },
          ],
        },
      ],
    },
  ]);

  assert.deepEqual(warnings, []);
});

test('instruction screenshot coverage accepts multiple screenshot indices per card', () => {
  const coverage = collectInstructionScreenshotCoverage([
    {
      missions: [
        {
          tasks: [
            {
              key: 'admin.client.create',
              lesson: {
                blocks: [
                  {
                    screenshotIndices: [0, 1],
                    type: 'step',
                  },
                ],
                screenshots: [
                  {
                    src: '/onboarding/admin/client-create/client-list.png',
                  },
                  {
                    src: '/onboarding/admin/client-create/client-form.png',
                  },
                ],
              },
            },
          ],
        },
      ],
    },
  ]);

  assert.equal(coverage.screenshotRequiredCardCount, 1);
  assert.equal(coverage.screenshotVerifiedCardCount, 1);
  assert.deepEqual(coverage.warnings, []);
});

test('lesson freshness audit requires updatedAt for instruction updates', () => {
  const warnings = collectLessonFreshnessWarnings([
    {
      missions: [
        {
          tasks: [
            {
              key: 'admin.client.create',
              lesson: {
                blocks: [{ text: 'Step', type: 'step' }],
              },
            },
            {
              key: 'admin.booking.create-phone',
              lesson: {
                blocks: [{ text: 'Step', type: 'step' }],
                updatedAt: '2026-06-08T00:00:00.000+03:00',
              },
            },
          ],
        },
      ],
    },
  ]);

  assert.deepEqual(warnings, [
    'Instruction lesson admin.client.create must have a valid updatedAt date',
  ]);
});

test('current onboarding audit report is consistent', () => {
  const report = buildReport();

  assert.deepEqual(report.errors, []);
  assert.ok(report.instructionScreenshotCount >= 2);
  assert.ok(report.screenshotRequiredCardCount >= 2);
  assert.equal(
    getAuditExitCode(report, { strict: true }),
    report.warnings.length > 0 ? 1 : 0,
  );
});
