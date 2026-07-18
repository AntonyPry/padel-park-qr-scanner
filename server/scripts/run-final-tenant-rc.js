#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SERVER_ROOT = path.resolve(__dirname, '..');
const PROJECT_ROOT = path.resolve(SERVER_ROOT, '..');
const CLIENT_ROOT = path.join(PROJECT_ROOT, 'client');

function parseArgs(argv) {
  const options = { full: false, output: null };
  for (const value of argv) {
    if (value === '--full') options.full = true;
    else if (value.startsWith('--output=')) options.output = value.slice('--output='.length);
    else throw new Error(`Unsupported Feature 9 RC argument: ${value}`);
  }
  return options;
}

function assertSafeEnvironment(options) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Feature 9 RC gate refuses NODE_ENV=production');
  }
  if (/(?:^|[_-])(prod|production|live)(?:$|[_-])/i.test(process.env.DB_NAME || '')) {
    throw new Error('Feature 9 RC gate refuses a production-like DB_NAME');
  }
  if (options.output && !/setly-f9-rc-/.test(path.resolve(options.output))) {
    throw new Error('Feature 9 RC artifact directory must contain setly-f9-rc-');
  }
}

function command(label, executable, args, cwd) {
  return { args, cwd, executable, label };
}

function npmCommand(label, args, cwd) {
  return command(label, process.platform === 'win32' ? 'npm.cmd' : 'npm', args, cwd);
}

function commandsFor(options) {
  const staticAudit = command(
    'final tenant direct-write/alias/route audit',
    process.execPath,
    ['scripts/audit-final-tenant-enforcement.js'],
    SERVER_ROOT,
  );
  if (!options.full) {
    return [
      staticAudit,
      command(
        'targeted enforcement and restore DB gates',
        process.execPath,
        [
          '--test',
          '--test-concurrency=1',
          'tests/tenant-enforcement/final-tenant-enforcement.db.test.js',
          'tests/tenant-enforcement/installation-backup-restore.db.test.js',
        ],
        SERVER_ROOT,
      ),
      command(
        'capability/foundation/manifest unit gates',
        process.execPath,
        [
          '--test',
          '--test-concurrency=1',
          'tests/tenant-context/capabilities.test.js',
          'tests/services/tenant-foundation.service.test.js',
          'tests/scripts/tenant-backup-manifest.test.js',
        ],
        SERVER_ROOT,
      ),
    ];
  }
  return [
    staticAudit,
    npmCommand('serialized full server suite', ['test'], SERVER_ROOT),
    npmCommand('server typecheck', ['run', 'typecheck'], SERVER_ROOT),
    npmCommand('OpenAPI/generated client regeneration', ['run', 'openapi'], SERVER_ROOT),
    command(
      'OpenAPI/generated no-drift assertion',
      'git',
      [
        'diff',
        '--exit-code',
        '--',
        'docs/openapi.json',
        'client/src/api/generated.ts',
      ],
      PROJECT_ROOT,
    ),
    npmCommand('strict onboarding audit', ['run', 'onboarding:audit:strict'], SERVER_ROOT),
    npmCommand('full client tests', ['test'], CLIENT_ROOT),
    npmCommand('client lint', ['run', 'lint'], CLIENT_ROOT),
    npmCommand('client build', ['run', 'build'], CLIENT_ROOT),
  ];
}

function writeReport(artifactRoot, report) {
  const reportPath = path.join(artifactRoot, 'rc-command-report.json');
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
  });
  return reportPath;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  assertSafeEnvironment(options);
  const artifactRoot = options.output
    ? path.resolve(options.output)
    : fs.mkdtempSync(path.join(os.tmpdir(), 'setly-f9-rc-'));
  fs.mkdirSync(artifactRoot, { recursive: true });
  const report = {
    artifactRoot,
    commands: [],
    completedAt: null,
    full: options.full,
    ok: false,
    schema: 'setly.final-tenant-rc-command-report',
    schemaVersion: 1,
    startedAt: new Date().toISOString(),
  };
  const env = {
    ...process.env,
    NODE_ENV: 'test',
    NODE_PATH: [
      process.env.NODE_PATH,
      path.join(CLIENT_ROOT, 'node_modules'),
    ].filter(Boolean).join(path.delimiter),
    SETLY_STORAGE_ROOT: path.join(artifactRoot, 'tenant-storage'),
    TENANT_RC_ARTIFACT_DIR: artifactRoot,
  };

  for (const step of commandsFor(options)) {
    const startedAt = Date.now();
    process.stdout.write(`\n[Feature 9 RC] ${step.label}\n`);
    const result = spawnSync(step.executable, step.args, {
      cwd: step.cwd,
      env,
      stdio: 'inherit',
    });
    const evidence = {
      args: step.args,
      cwd: step.cwd,
      durationMs: Date.now() - startedAt,
      executable: step.executable,
      label: step.label,
      status: result.status,
    };
    report.commands.push(evidence);
    if (result.status !== 0) {
      report.completedAt = new Date().toISOString();
      report.failedStep = step.label;
      const reportPath = writeReport(artifactRoot, report);
      process.stderr.write(`Feature 9 RC failed; report: ${reportPath}\n`);
      process.exitCode = result.status || 1;
      return;
    }
  }
  report.completedAt = new Date().toISOString();
  report.ok = true;
  const reportPath = writeReport(artifactRoot, report);
  process.stdout.write(`\nFeature 9 RC passed; artifacts: ${artifactRoot}\n`);
  process.stdout.write(`Feature 9 RC command report: ${reportPath}\n`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  assertSafeEnvironment,
  commandsFor,
  parseArgs,
};
