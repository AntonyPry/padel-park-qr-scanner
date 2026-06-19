#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const {
  ONBOARDING_CHECKPOINT_EVENTS,
  ONBOARDING_ROUTES,
  listOnboardingPaths,
  validateOnboardingCatalog,
} = require('../src/onboarding/catalog');

const ROOT_DIR = path.resolve(__dirname, '..', '..');
const SOURCE_DIRS = [
  path.join(ROOT_DIR, 'server', 'src', 'controllers'),
  path.join(ROOT_DIR, 'server', 'src', 'routes'),
  path.join(ROOT_DIR, 'server', 'src', 'services'),
  path.join(ROOT_DIR, 'client', 'src'),
];
const CLIENT_APP_PATH = path.join(ROOT_DIR, 'client', 'src', 'App.tsx');
const CLIENT_PUBLIC_DIR = path.join(ROOT_DIR, 'client', 'public');
const PILOT_CARD_FORMAT_TASK_KEYS = new Set([
  'admin.client.create',
  'admin.booking.create-phone',
  'admin.subscription.redemption-review',
]);

function walkFiles(dir) {
  if (!fs.existsSync(dir)) return [];

  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return walkFiles(fullPath);
    if (!/\.[jt]s$/.test(entry.name) || /\.d\.ts$/.test(entry.name)) return [];
    return [fullPath];
  });
}

function pluralRu(count, one, few, many) {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

function countRoleStats(pathConfig) {
  const tasks = pathConfig.missions.flatMap((mission) => mission.tasks);
  return {
    missions: pathConfig.missions.length,
    reviewTasks: tasks.filter((task) => task.kind === 'review').length,
    tasks: tasks.length,
    trainingTasks: tasks.filter((task) => task.trainingMode?.recommended).length,
    xp: tasks.reduce((sum, task) => sum + Number(task.rewardXp || 0), 0),
  };
}

function collectUsedCheckpointEvents(paths) {
  const events = new Set();
  for (const pathConfig of paths) {
    for (const mission of pathConfig.missions) {
      for (const task of mission.tasks) {
        if (task.checkpoint?.event) events.add(task.checkpoint.event);
      }
    }
  }
  return events;
}

function collectReferencedEvents() {
  const sourceText = SOURCE_DIRS.flatMap(walkFiles)
    .map((filePath) => fs.readFileSync(filePath, 'utf8'))
    .join('\n');

  return new Set(
    ONBOARDING_CHECKPOINT_EVENTS.filter((eventKey) =>
      sourceText.includes(`'${eventKey}'`) ||
      sourceText.includes(`"${eventKey}"`) ||
      sourceText.includes(`\`${eventKey}\``),
    ),
  );
}

function collectClientRoutes() {
  if (!fs.existsSync(CLIENT_APP_PATH)) return new Set();

  const appSource = fs.readFileSync(CLIENT_APP_PATH, 'utf8');
  return new Set(
    Array.from(appSource.matchAll(/<Route\s+path=["']([^"']+)["']/g)).map(
      (match) => match[1],
    ),
  );
}

function getScreenshotFilePath(src) {
  if (typeof src !== 'string' || !src.startsWith('/')) return null;
  return path.join(CLIENT_PUBLIC_DIR, src.replace(/^\/+/, ''));
}

function isInstructionBlockScreenshotRequired(block) {
  if (!block || typeof block !== 'object') return false;
  if (block.screenshotRequired === true) return true;
  if (block.screenshotRequired === false) return false;
  return (
    block.type === 'step' ||
    Number.isInteger(block.screenshotIndex) ||
    Array.isArray(block.screenshotIndices)
  );
}

function getInstructionBlockScreenshotIndices(block) {
  if (!block || typeof block !== 'object') return [];
  if (Array.isArray(block.screenshotIndices)) return block.screenshotIndices;
  if (Number.isInteger(block.screenshotIndex)) return [block.screenshotIndex];
  return [];
}

function collectInstructionScreenshotCoverage(paths) {
  const warnings = [];
  let screenshotCount = 0;
  let screenshotRequiredCardCount = 0;
  let screenshotVerifiedCardCount = 0;

  for (const pathConfig of paths) {
    for (const mission of pathConfig.missions) {
      for (const task of mission.tasks) {
        const lesson = task.lesson;
        if (!lesson) continue;

        const blocks = Array.isArray(lesson.blocks) ? lesson.blocks : [];
        const screenshots = Array.isArray(lesson.screenshots)
          ? lesson.screenshots
          : [];
        screenshotCount += screenshots.length;

        screenshots.forEach((screenshot, screenshotIndex) => {
          if (!screenshot?.src) {
            warnings.push(
              `Instruction screenshot ${task.key}[${screenshotIndex}] has no src`,
            );
            return;
          }

          if (!screenshot.src.startsWith('/onboarding/')) {
            warnings.push(
              `Instruction screenshot ${task.key}[${screenshotIndex}] must live under /onboarding/: ${screenshot.src}`,
            );
            return;
          }

          const filePath = getScreenshotFilePath(screenshot.src);
          if (!filePath || !fs.existsSync(filePath)) {
            warnings.push(
              `Instruction screenshot file is missing for ${task.key}[${screenshotIndex}]: ${screenshot.src}`,
            );
          }
        });

        blocks.forEach((block, blockIndex) => {
          const explicitIndices = getInstructionBlockScreenshotIndices(block);
          const invalidIndices = explicitIndices.filter(
            (explicitIndex) =>
              !Number.isInteger(explicitIndex) ||
              explicitIndex < 0 ||
              explicitIndex >= screenshots.length,
          );

          invalidIndices.forEach((explicitIndex) => {
            warnings.push(
              `Instruction block ${task.key}[${blockIndex}] references missing screenshotIndex ${explicitIndex}`,
            );
          });

          if (!isInstructionBlockScreenshotRequired(block)) return;

          screenshotRequiredCardCount += 1;
          if (explicitIndices.length === 0) {
            warnings.push(
              `Instruction card ${task.key}[${blockIndex}] requires an explicit screenshotIndex`,
            );
            return;
          }

          if (invalidIndices.length > 0) return;

          const allFilesExist = explicitIndices.every((screenshotIndex) => {
            const screenshot = screenshots[screenshotIndex];
            const filePath = screenshot?.src
              ? getScreenshotFilePath(screenshot.src)
              : null;
            return Boolean(filePath && fs.existsSync(filePath));
          });

          if (allFilesExist) {
            screenshotVerifiedCardCount += 1;
            return;
          }

          warnings.push(
            `Instruction card ${task.key}[${blockIndex}] requires a real CRM screenshot`,
          );
        });
      }
    }
  }

  return {
    missingInstructionScreenshotCount:
      screenshotRequiredCardCount - screenshotVerifiedCardCount,
    screenshotCount,
    screenshotRequiredCardCount,
    screenshotVerifiedCardCount,
    warnings,
  };
}

function collectPilotScreenshotReleaseGateWarnings(paths) {
  const warnings = [];

  for (const pathConfig of paths) {
    for (const mission of pathConfig.missions) {
      for (const task of mission.tasks) {
        if (!PILOT_CARD_FORMAT_TASK_KEYS.has(task.key)) continue;

        const blocks = Array.isArray(task.lesson?.blocks)
          ? task.lesson.blocks
          : [];
        const screenshots = Array.isArray(task.lesson?.screenshots)
          ? task.lesson.screenshots
          : [];
        const hasSectionActionFormat =
          task.lesson?.format === 'section-first-cards';
        const hasOverviewScreenshots = blocks.some((block) => {
          const indices = getInstructionBlockScreenshotIndices(block);
          return (
            indices.length > 0 &&
            indices.every((index) => {
              const screenshot = screenshots[index];
              const filePath = screenshot?.src
                ? getScreenshotFilePath(screenshot.src)
                : null;
              return Boolean(filePath && fs.existsSync(filePath));
            })
          );
        });

        blocks.forEach((block, blockIndex) => {
          if (block?.missingScreenshot) {
            warnings.push(
              `Pilot screenshot release gate: ${task.key}[${blockIndex}] still has draft screenshot marker`,
            );
            return;
          }

          if (block?.screenshotRequired !== false) return;

          if (hasSectionActionFormat && hasOverviewScreenshots) return;

          warnings.push(
            `Pilot screenshot release gate: ${task.key}[${blockIndex}] disables screenshots without overview coverage`,
          );
        });
      }
    }
  }

  return warnings;
}

function collectLessonFreshnessWarnings(paths) {
  const warnings = [];

  for (const pathConfig of paths) {
    for (const mission of pathConfig.missions) {
      for (const task of mission.tasks) {
        if (!task.lesson) continue;

        const updatedAt = task.lesson.updatedAt || task.updatedAt;
        const parsed = updatedAt ? new Date(updatedAt) : null;

        if (!updatedAt || Number.isNaN(parsed.getTime())) {
          warnings.push(
            `Instruction lesson ${task.key} must have a valid updatedAt date`,
          );
        }
      }
    }
  }

  return warnings;
}

function parseAuditArgs(argv = process.argv.slice(2)) {
  return {
    json: argv.includes('--json'),
    strict: argv.includes('--strict') || argv.includes('--fail-on-warnings'),
  };
}

function getAuditExitCode(report, options = {}) {
  if (report.errors.length > 0) return 1;
  if (options.strict && report.warnings.length > 0) return 1;
  return 0;
}

function printHumanReport(report, options = {}) {
  console.log('Onboarding audit');
  console.log('================');
  console.log('');

  if (report.errors.length > 0) {
    console.log('Errors:');
    report.errors.forEach((error) => console.log(`- ${error}`));
    console.log('');
  } else {
    console.log('Catalog validation: OK');
    console.log('');
  }

  console.log('Role paths:');
  report.roles.forEach((role) => {
    console.log(
      `- ${role.role}: ${role.missions} ${pluralRu(role.missions, 'mission', 'missions', 'missions')}, ` +
        `${role.tasks} tasks, ${role.reviewTasks} review, ${role.trainingTasks} training-safe, ${role.xp} XP`,
    );
  });
  console.log('');

  console.log('Coverage:');
  console.log(`- catalog routes: ${report.routeCount}`);
  console.log(`- registered client routes: ${report.clientRouteCount}`);
  console.log(`- allowed checkpoint events: ${report.allowedEventCount}`);
  console.log(`- events used by tasks: ${report.usedEventCount}`);
  console.log(`- events referenced in product code: ${report.referencedEventCount}`);
  console.log(`- instruction screenshots: ${report.instructionScreenshotCount}`);
  console.log(
    `- instruction cards with required screenshots: ${report.screenshotVerifiedCardCount}/${report.screenshotRequiredCardCount}`,
  );
  console.log('');

  if (report.warnings.length > 0) {
    console.log('Warnings:');
    report.warnings.forEach((warning) => console.log(`- ${warning}`));
    console.log('');
  }

  if (options.strict) {
    console.log(
      report.warnings.length > 0
        ? 'Strict release gate: FAIL (warnings are treated as errors)'
        : 'Strict release gate: PASS',
    );
    console.log('');
  }

  console.log('Next release checklist:');
  console.log('- review feature `Onboarding impact`;');
  console.log('- update catalog tasks, skills, badges and checkpoint events;');
  console.log('- refresh instruction screenshots for changed CRM screens;');
  console.log('- run this audit before release.');
}

function buildReport() {
  const paths = listOnboardingPaths();
  const errors = validateOnboardingCatalog();
  const usedEvents = collectUsedCheckpointEvents(paths);
  const referencedEvents = collectReferencedEvents();
  const clientRoutes = collectClientRoutes();
  const screenshotCoverage = collectInstructionScreenshotCoverage(paths);
  const pilotScreenshotReleaseGateWarnings =
    collectPilotScreenshotReleaseGateWarnings(paths);
  const lessonFreshnessWarnings = collectLessonFreshnessWarnings(paths);
  const warnings = [];
  const routesMissingInClient = ONBOARDING_ROUTES.filter(
    (route) => !clientRoutes.has(route),
  );
  const unusedAllowedEvents = ONBOARDING_CHECKPOINT_EVENTS.filter(
    (eventKey) => !usedEvents.has(eventKey),
  );
  const unreferencedUsedEvents = Array.from(usedEvents).filter(
    (eventKey) => !referencedEvents.has(eventKey),
  );

  if (routesMissingInClient.length > 0) {
    warnings.push(
      `Catalog routes missing from client router: ${routesMissingInClient.join(', ')}`,
    );
  }

  if (unusedAllowedEvents.length > 0) {
    warnings.push(
      `Allowed checkpoint events not used by tasks: ${unusedAllowedEvents.join(', ')}`,
    );
  }

  if (unreferencedUsedEvents.length > 0) {
    warnings.push(
      `Task checkpoint events without direct product-code reference: ${unreferencedUsedEvents.join(', ')}`,
    );
  }

  warnings.push(...screenshotCoverage.warnings);
  warnings.push(...pilotScreenshotReleaseGateWarnings);
  warnings.push(...lessonFreshnessWarnings);

  return {
    allowedEventCount: ONBOARDING_CHECKPOINT_EVENTS.length,
    clientRouteCount: clientRoutes.size,
    errors,
    instructionScreenshotCount: screenshotCoverage.screenshotCount,
    missingInstructionScreenshotCount:
      screenshotCoverage.missingInstructionScreenshotCount,
    referencedEventCount: referencedEvents.size,
    routeCount: ONBOARDING_ROUTES.length,
    roles: paths.map((pathConfig) => ({
      role: pathConfig.role,
      ...countRoleStats(pathConfig),
    })),
    screenshotRequiredCardCount: screenshotCoverage.screenshotRequiredCardCount,
    screenshotVerifiedCardCount: screenshotCoverage.screenshotVerifiedCardCount,
    usedEventCount: usedEvents.size,
    warnings,
  };
}

if (require.main === module) {
  const report = buildReport();
  const options = parseAuditArgs();

  if (options.json) {
    console.log(
      JSON.stringify(
        {
          ...report,
          releaseGate: {
            mode: options.strict ? 'strict' : 'diagnostic',
            ok: getAuditExitCode(report, options) === 0,
          },
        },
        null,
        2,
      ),
    );
  } else {
    printHumanReport(report, options);
  }

  process.exitCode = getAuditExitCode(report, options);
}

module.exports = {
  buildReport,
  collectInstructionScreenshotCoverage,
  collectLessonFreshnessWarnings,
  collectPilotScreenshotReleaseGateWarnings,
  getAuditExitCode,
  parseAuditArgs,
};
