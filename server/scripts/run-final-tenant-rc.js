#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  connect,
  createFreshDisposableDatabase,
  dropDisposableDatabase,
  migrateAll,
} = require('../tests/helpers/final-tenant-rc-fixture');

const SERVER_ROOT = path.resolve(__dirname, '..');
const PROJECT_ROOT = path.resolve(SERVER_ROOT, '..');
const CLIENT_ROOT = path.join(PROJECT_ROOT, 'client');
const LOOPBACK_DATABASE_HOSTS = new Set(['127.0.0.1', '::1', 'localhost']);
const REMOTE_OPT_IN = 'TENANT_RC_ALLOW_REMOTE_DISPOSABLE_DB';
const REMOTE_HOST_PROOF = 'TENANT_RC_REMOTE_DISPOSABLE_HOST';
const REMOTE_PURPOSE_PROOF = 'TENANT_RC_REMOTE_DISPOSABLE_PURPOSE';
const REMOTE_PURPOSE_VALUE = 'setly-feature9-disposable-only';
const FINAL_RC_CLI_OPTIONS = Object.freeze(['full', 'output']);

function parseArgs(argv) {
  const options = { full: false, output: null };
  const seen = new Set();
  for (const value of argv) {
    let key;
    if (value === '--full') key = 'full';
    else if (value.startsWith('--output=')) key = 'output';
    else throw new Error(`Unsupported Feature 9 RC argument: ${value}`);
    if (seen.has(key)) throw new Error(`Duplicate Feature 9 RC argument: --${key}`);
    seen.add(key);
    if (key === 'full') options.full = true;
    else options.output = value.slice('--output='.length);
  }
  return options;
}

function normalizeDatabaseHost(value = process.env.DB_HOST) {
  return String(value || '127.0.0.1').trim().toLowerCase().replace(/^\[|\]$/g, '');
}

function assertSafeDatabaseHost(env = process.env) {
  const host = normalizeDatabaseHost(env.DB_HOST);
  if (LOOPBACK_DATABASE_HOSTS.has(host)) return host;
  if (/(?:^|[._-])(prod|production|live)(?:$|[._-])/i.test(host)) {
    throw new Error(`Feature 9 RC refuses production-like DB_HOST=${host}`);
  }
  const remoteAllowed = env[REMOTE_OPT_IN] === 'true';
  const exactHostProof = normalizeDatabaseHost(env[REMOTE_HOST_PROOF]) === host;
  const purposeProof = env[REMOTE_PURPOSE_PROOF] === REMOTE_PURPOSE_VALUE;
  if (!remoteAllowed || !exactHostProof || !purposeProof) {
    throw new Error(
      `Feature 9 RC refuses non-loopback DB_HOST=${host}; remote disposable use requires ${REMOTE_OPT_IN}=true, exact ${REMOTE_HOST_PROOF}, and ${REMOTE_PURPOSE_PROOF}=${REMOTE_PURPOSE_VALUE}`,
    );
  }
  return host;
}

function assertSafeEnvironment(options, env = process.env) {
  if (env.NODE_ENV === 'production') {
    throw new Error('Feature 9 RC gate refuses NODE_ENV=production');
  }
  if (/(?:^|[_-])(prod|production|live)(?:$|[_-])/i.test(env.DB_NAME || '')) {
    throw new Error('Feature 9 RC gate refuses a production-like DB_NAME');
  }
  assertSafeDatabaseHost(env);
  if (options.output && !/setly-f9-rc-/.test(path.resolve(options.output))) {
    throw new Error('Feature 9 RC artifact directory must contain setly-f9-rc-');
  }
  if (
    options.output &&
    /(?:^|[/_-])(prod|production|live)(?:$|[/_-])/i.test(path.resolve(options.output))
  ) {
    throw new Error('Feature 9 RC gate refuses a production-like artifact target');
  }
}

function assertArtifactOwnership(artifactRoot, fsApi = fs) {
  const stat = fsApi.lstatSync(artifactRoot);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error('Feature 9 RC artifact root must be a fresh non-symlink directory');
  }
  if (typeof process.getuid === 'function' && stat.uid !== process.getuid()) {
    throw new Error('Feature 9 RC artifact root is not owned by the current invocation user');
  }
  return artifactRoot;
}

function prepareArtifactRoot(options, fsApi = fs) {
  if (!options.output) {
    const created = fsApi.mkdtempSync(path.join(os.tmpdir(), 'setly-f9-rc-'));
    return assertArtifactOwnership(created, fsApi);
  }
  const artifactRoot = path.resolve(options.output);
  if (fsApi.existsSync(artifactRoot)) {
    const stat = fsApi.lstatSync(artifactRoot);
    throw new Error(
      `Feature 9 RC artifact target must not pre-exist${stat.isSymbolicLink() ? ' or be a symlink' : ''}: ${artifactRoot}`,
    );
  }
  fsApi.mkdirSync(artifactRoot, { mode: 0o700, recursive: false });
  return assertArtifactOwnership(artifactRoot, fsApi);
}

function disposableFullDatabaseName() {
  return `setly_f9_rc_full_${process.pid}_${Date.now()}`;
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
          'tests/tenant-enforcement/legacy-singleton.db.test.js',
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
          'tests/scripts/final-tenant-rc.test.js',
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
      ['diff', '--exit-code', '--', 'docs/openapi.json', 'client/src/api/generated.ts'],
      PROJECT_ROOT,
    ),
    npmCommand('strict onboarding audit', ['run', 'onboarding:audit:strict'], SERVER_ROOT),
    npmCommand('full client tests', ['test'], CLIENT_ROOT),
    npmCommand('client lint', ['run', 'lint'], CLIENT_ROOT),
    npmCommand('client build', ['run', 'build'], CLIENT_ROOT),
  ];
}

function writeReport(artifactRoot, report, fsApi = fs) {
  const reportPath = path.join(artifactRoot, 'rc-command-report.json');
  fsApi.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
  });
  return reportPath;
}

function defaultDependencies() {
  return {
    connect,
    createFreshDisposableDatabase,
    dropDisposableDatabase,
    migrateAll,
    runCommand(step, env) {
      return spawnSync(step.executable, step.args, {
        cwd: step.cwd,
        env,
        stdio: 'inherit',
      });
    },
  };
}

async function prepareFullDatabase(database, dependencies = defaultDependencies()) {
  let owned = false;
  try {
    await dependencies.createFreshDisposableDatabase(database);
    owned = true;
    const schema = dependencies.connect(database);
    try {
      await dependencies.migrateAll(schema);
    } finally {
      await schema.close();
    }
    return { database, owned: true };
  } catch (error) {
    if (owned) await dependencies.dropDisposableDatabase(database);
    throw error;
  }
}

async function runRc(options, injected = {}) {
  assertSafeEnvironment(options, injected.env || process.env);
  const fsApi = injected.fs || fs;
  const artifactRoot = prepareArtifactRoot(options, fsApi);
  const dependencies = { ...defaultDependencies(), ...injected.dependencies };
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
  let database = null;
  let databaseOwned = false;
  let failedStatus = 0;
  let failure = null;
  try {
    if (options.full) {
      process.stdout.write('\n[Feature 9 RC] prepare disposable full-suite database\n');
      database = injected.databaseName || disposableFullDatabaseName();
      await dependencies.createFreshDisposableDatabase(database);
      databaseOwned = true;
      report.database = {
        cleanup: 'pending',
        name: database,
        ownership: 'current-invocation',
        scope: 'disposable-full-suite',
      };
      const schema = dependencies.connect(database);
      try {
        await dependencies.migrateAll(schema);
      } finally {
        await schema.close();
      }
    }
    const env = {
      ...(injected.env || process.env),
      ...(database ? { DB_NAME: database } : {}),
      NODE_ENV: 'test',
      NODE_PATH: [
        (injected.env || process.env).NODE_PATH,
        path.join(CLIENT_ROOT, 'node_modules'),
      ].filter(Boolean).join(path.delimiter),
      SETLY_STORAGE_ROOT: path.join(artifactRoot, 'tenant-storage'),
      TENANT_RC_ARTIFACT_DIR: artifactRoot,
    };
    for (const step of commandsFor(options)) {
      const startedAt = Date.now();
      process.stdout.write(`\n[Feature 9 RC] ${step.label}\n`);
      const result = dependencies.runCommand(step, env);
      report.commands.push({
        args: step.args,
        cwd: step.cwd,
        durationMs: Date.now() - startedAt,
        executable: step.executable,
        label: step.label,
        status: result.status,
      });
      if (result.status !== 0) {
        report.failedStep = step.label;
        failedStatus = result.status || 1;
        break;
      }
    }
  } catch (error) {
    failure = error;
    failedStatus = 1;
    report.error = { code: error.code || null, message: error.message };
  } finally {
    if (databaseOwned) {
      try {
        await dependencies.dropDisposableDatabase(database);
        report.database.cleanup = 'dropped';
      } catch (cleanupError) {
        failedStatus = 1;
        report.database.cleanup = 'failed';
        report.cleanupError = {
          code: cleanupError.code || null,
          message: cleanupError.message,
        };
      }
    }
  }
  report.completedAt = new Date().toISOString();
  report.ok = failedStatus === 0;
  const reportPath = writeReport(artifactRoot, report, fsApi);
  return { failure, report, reportPath, status: failedStatus };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const result = await runRc(options);
  if (result.status) {
    process.stderr.write(`Feature 9 RC failed; report: ${result.reportPath}\n`);
    if (result.failure) process.stderr.write(`${result.failure.stack || result.failure.message}\n`);
    process.exitCode = result.status;
    return;
  }
  process.stdout.write(`\nFeature 9 RC passed; artifacts: ${result.report.artifactRoot}\n`);
  process.stdout.write(`Feature 9 RC command report: ${result.reportPath}\n`);
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  FINAL_RC_CLI_OPTIONS,
  REMOTE_HOST_PROOF,
  REMOTE_OPT_IN,
  REMOTE_PURPOSE_PROOF,
  REMOTE_PURPOSE_VALUE,
  assertArtifactOwnership,
  assertSafeDatabaseHost,
  assertSafeEnvironment,
  commandsFor,
  disposableFullDatabaseName,
  normalizeDatabaseHost,
  parseArgs,
  prepareArtifactRoot,
  prepareFullDatabase,
  runRc,
};
