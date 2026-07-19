#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const db = require('../models');
const {
  inventoryManifestArtifact,
  parseExpectedEmptyLabels,
  verifyManifest,
} = require('./tenant-backup-manifest');
const {
  runTenantIntegrityDetector,
} = require('../src/tenant-enforcement/integrity-detector');
const {
  requireExactSingletonDefault,
} = require('../src/tenant-enforcement/legacy-singleton');
const {
  ROLLOUT_MAINTENANCE_ENV,
  ROLLOUT_MAINTENANCE_MODE,
  digestJson,
  evaluateCapabilityStage,
  isRolloutMaintenanceActive,
  validateRolloutMaintenanceConfiguration,
} = require('../src/tenant-rollout/contract');
const {
  collectInstallationIdentitySnapshot,
  compareInstallationIdentitySnapshots,
  validateSnapshot,
} = require('../src/tenant-rollout/preservation-evidence');

const REPORT_SCHEMA = 'setly.tenant-production-rollout-gate';
const REPORT_SCHEMA_VERSION = 1;
const ROLLOUT_CLI_OPTIONS = Object.freeze([
  'backup-manifest',
  'baseline',
  'db-dump',
  'expect-empty',
  'expected-sha',
  'legacy-shift-cash-root',
  'legacy-shift-report-root',
  'output',
  'phase',
  'preservation-report',
  'restore-report',
  'stage',
  'storage-root',
]);
const ROLLOUT_CLI_OPTION_SET = new Set(ROLLOUT_CLI_OPTIONS);
const PHASES = new Set([
  'before-migrations',
  'restore-rehearsal',
  'post-migrations',
  'stage',
]);

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith('--')) throw new Error(`Unsupported argument: ${value}`);
    const separator = value.indexOf('=');
    const key = value.slice(2, separator === -1 ? undefined : separator);
    if (!ROLLOUT_CLI_OPTION_SET.has(key)) {
      throw new Error(`Unsupported rollout argument: --${key}`);
    }
    if (Object.prototype.hasOwnProperty.call(options, key)) {
      throw new Error(`Duplicate rollout argument: --${key}`);
    }
    if (separator !== -1) {
      options[key] = value.slice(separator + 1);
      continue;
    }
    const next = argv[index + 1];
    if (next && !next.startsWith('--')) {
      options[key] = next;
      index += 1;
    } else {
      options[key] = true;
    }
  }
  return options;
}

function required(options, key) {
  const value = options[key];
  if (!value || value === true) throw new Error(`--${key} is required`);
  return String(value);
}

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function currentGitHead() {
  return execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: path.resolve(__dirname, '../..'),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function currentGitStatus() {
  return execFileSync(
    'git',
    ['status', '--porcelain', '--untracked-files=normal'],
    {
      cwd: path.resolve(__dirname, '../..'),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  ).trim();
}

function verifyExpectedHead(expectedSha) {
  if (!/^[0-9a-f]{40}$/i.test(expectedSha)) {
    throw new Error('--expected-sha must be a full 40-character Git SHA');
  }
  const actual = currentGitHead();
  const status = currentGitStatus();
  return {
    actual,
    clean: status === '',
    expected: expectedSha,
    ok: actual === expectedSha && status === '',
  };
}

async function loadMigrationStatus() {
  const migrationDir = path.resolve(__dirname, '../migrations');
  const expected = (await fsp.readdir(migrationDir))
    .filter((name) => name.endsWith('.js'))
    .sort();
  const [rows] = await db.sequelize.query('SELECT name FROM SequelizeMeta ORDER BY name');
  const applied = rows.map((row) => row.name).sort();
  const appliedSet = new Set(applied);
  const expectedSet = new Set(expected);
  return {
    applied: applied.length,
    expected: expected.length,
    missing: expected.filter((name) => !appliedSet.has(name)),
    ok: expected.every((name) => appliedSet.has(name)) &&
      applied.every((name) => expectedSet.has(name)),
    unexpected: applied.filter((name) => !expectedSet.has(name)),
  };
}

function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(path.resolve(filePath), 'utf8'));
}

function validatePriorReport(report, phase) {
  if (
    !report ||
    report.schema !== REPORT_SCHEMA ||
    report.schemaVersion !== REPORT_SCHEMA_VERSION ||
    report.phase !== phase ||
    report.ok !== true
  ) {
    throw new Error(`A successful ${phase} rollout report is required`);
  }
  const expectedDigest = digestJson({
    ...report,
    evidenceDigest: undefined,
  });
  if (report.evidenceDigest !== expectedDigest) {
    const error = new Error(`${phase} rollout report evidence digest is invalid`);
    error.code = 'TENANT_ROLLOUT_EVIDENCE_DIGEST_INVALID';
    throw error;
  }
  return report;
}

function assertSameRelease(report, baseReport, phase) {
  if (
    report.git?.actual !== baseReport.git.actual ||
    report.git?.expected !== baseReport.git.expected
  ) {
    const error = new Error(`${phase} rollout report belongs to another release SHA`);
    error.code = 'TENANT_ROLLOUT_RELEASE_SHA_MISMATCH';
    throw error;
  }
}

function maintenanceCheck() {
  const configuration = validateRolloutMaintenanceConfiguration();
  return {
    active: isRolloutMaintenanceActive(),
    env: ROLLOUT_MAINTENANCE_ENV,
    expectedMode: ROLLOUT_MAINTENANCE_MODE,
    ok: configuration.active,
  };
}

function provisioningCheck(env = process.env) {
  const name = 'INSTALLATION_PROVISIONING_ENABLED';
  const value = String(env[name] ?? '').trim().toLowerCase();
  return {
    enabled: ['1', 'true', 'yes', 'on'].includes(value),
    env: name,
    explicit: value !== '',
    ok: ['0', 'false', 'no', 'off'].includes(value),
  };
}

function mutationSourcesCheck(env = process.env) {
  const names = ['BOTS_ENABLED', 'BACKGROUND_RUNNERS_ENABLED'];
  const values = Object.fromEntries(names.map((name) => [
    name,
    String(env[name] ?? '').trim().toLowerCase(),
  ]));
  const disabled = new Set(['0', 'false', 'no', 'off']);
  return {
    ok: names.every((name) => disabled.has(values[name])),
    values,
  };
}

function assertUniqueArtifactRoots(artifacts) {
  const roots = artifacts.map(([, artifactPath]) =>
    fs.realpathSync(path.resolve(artifactPath)));
  if (new Set(roots).size !== roots.length) {
    const error = new Error('Backup artifact roots must be four distinct paths');
    error.code = 'ROLLOUT_BACKUP_ARTIFACT_PATH_COLLISION';
    throw error;
  }
}

async function collectCommonDatabaseChecks(stage) {
  const [migrations, singleton, integrity] = await Promise.all([
    loadMigrationStatus(),
    requireExactSingletonDefault(),
    runTenantIntegrityDetector({ sequelize: db.sequelize, strict: true }),
  ]);
  const capabilities = evaluateCapabilityStage(process.env, stage);
  return {
    capabilities,
    integrity,
    migrations,
    singleton: { ...singleton, ok: true },
  };
}

async function runBeforeMigrations(options, baseReport) {
  const artifactInputs = [
    ['database', required(options, 'db-dump')],
    ['tenant-storage', required(options, 'storage-root')],
    ['legacy-shift-reports', required(options, 'legacy-shift-report-root')],
    ['legacy-shift-cash', required(options, 'legacy-shift-cash-root')],
  ];
  assertUniqueArtifactRoots(artifactInputs);
  const expectedEmptyLabels = parseExpectedEmptyLabels(options['expect-empty']);
  const backupArtifacts = artifactInputs.map(([label, artifactPath]) =>
    inventoryManifestArtifact(artifactPath, label, expectedEmptyLabels));
  const preservationSnapshot = await collectInstallationIdentitySnapshot({
    sequelize: db.sequelize,
  });
  const capabilities = evaluateCapabilityStage(process.env, 'schema-off');
  return {
    ...baseReport,
    backup: {
      artifacts: backupArtifacts.map((artifact) => ({
        digest: digestJson({
          files: artifact.files,
          label: artifact.label,
          expectedEmpty: artifact.expectedEmpty === true,
          totalBytes: artifact.totalBytes,
        }),
        expectedEmpty: artifact.expectedEmpty === true,
        files: artifact.files.length,
        label: artifact.label,
        totalBytes: artifact.totalBytes,
      })),
      ok: true,
      restoreMode: 'installation-wide-only',
      status: 'raw-consistent-capture; full manifest and attachment detector required post-migration',
    },
    capabilities,
    preservationSnapshot,
    secondTenant: {
      allowed: false,
      reason: 'requires successful final rollout, QA and separate production authority',
    },
  };
}

async function runPreservationVerification(options, baseReport) {
  const baselinePath = path.resolve(required(options, 'baseline'));
  const baseline = validatePriorReport(loadJson(baselinePath), 'before-migrations');
  assertSameRelease(baseline, baseReport, 'before-migrations');
  validateSnapshot(baseline.preservationSnapshot);
  const backupManifestPath = path.resolve(required(options, 'backup-manifest'));
  const backupVerification = verifyManifest({ manifest: backupManifestPath });
  const backupManifest = loadJson(backupManifestPath);
  const expectedArtifactDigests = new Map(
    baseline.backup.artifacts.map((artifact) => [artifact.label, artifact.digest]),
  );
  const backupFindings = backupManifest.artifacts
    .filter((artifact) => expectedArtifactDigests.has(artifact.label))
    .flatMap((artifact) => {
      const digest = digestJson({
        files: artifact.files,
        label: artifact.label,
        expectedEmpty: artifact.expectedEmpty === true,
        totalBytes: artifact.totalBytes,
      });
      return digest === expectedArtifactDigests.get(artifact.label)
        ? []
        : [{ code: 'ROLLOUT_BACKUP_CAPTURE_CHANGED', label: artifact.label }];
    });
  const currentSnapshot = await collectInstallationIdentitySnapshot({
    preservedColumnsByTable: Object.fromEntries(
      baseline.preservationSnapshot.tables.map((table) => [
        table.tableName,
        table.preservedColumns,
      ]),
    ),
    sequelize: db.sequelize,
  });
  const preservation = compareInstallationIdentitySnapshots(
    baseline.preservationSnapshot,
    currentSnapshot,
  );
  const database = await collectCommonDatabaseChecks('schema-off');
  return {
    ...baseReport,
    backup: {
      findings: backupFindings,
      manifestSha256: sha256File(backupManifestPath),
      ok: backupVerification.ok === true && backupFindings.length === 0,
      restoreMode: backupManifest.restoreMode,
    },
    baseline: {
      reportSha256: sha256File(baselinePath),
      snapshotDigest: baseline.preservationSnapshot.identityDigest,
    },
    database,
    preservation: {
      ...preservation,
      afterSnapshotDigest: currentSnapshot.identityDigest,
      beforeSnapshotDigest: baseline.preservationSnapshot.identityDigest,
    },
    secondTenant: {
      allowed: false,
      reason: 'historical singleton is preserved but live staged cutover is not complete',
    },
  };
}

async function runRestoreRehearsal(options, baseReport) {
  const report = await runPreservationVerification(options, baseReport);
  return {
    ...report,
    restoreRehearsal: {
      ok: true,
      policy: 'empty-installation-only; tenant-selective restore unsupported',
    },
  };
}

async function runPostMigrations(options, baseReport) {
  const report = await runPreservationVerification(options, baseReport);
  const restoreReportPath = path.resolve(required(options, 'restore-report'));
  const restoreReport = validatePriorReport(
    loadJson(restoreReportPath),
    'restore-rehearsal',
  );
  assertSameRelease(restoreReport, baseReport, 'restore-rehearsal');
  if (
    restoreReport.restoreRehearsal?.ok !== true ||
    restoreReport.baseline?.reportSha256 !== report.baseline.reportSha256
  ) {
    throw new Error('Restore rehearsal is not bound to the production baseline');
  }
  return {
    ...report,
    restoreRehearsal: {
      ok: true,
      reportSha256: sha256File(restoreReportPath),
    },
  };
}

async function runStage(options, baseReport) {
  const stage = required(options, 'stage');
  const preservationReportPath = path.resolve(required(options, 'preservation-report'));
  const preservationReport = validatePriorReport(
    loadJson(preservationReportPath),
    'post-migrations',
  );
  assertSameRelease(preservationReport, baseReport, 'post-migrations');
  if (preservationReport.preservation?.ok !== true) {
    throw new Error('Preservation report does not prove singleton historical data parity');
  }
  const database = await collectCommonDatabaseChecks(stage);
  return {
    ...baseReport,
    database,
    preservation: {
      ok: true,
      reportSha256: sha256File(preservationReportPath),
      verifiedTables: preservationReport.preservation.verifiedTables,
      preservedRows: preservationReport.preservation.preservedRows,
    },
    secondTenant: {
      allowed: false,
      reason: stage === 'enforcement'
        ? 'technical gate complete; separate production authority and QA acceptance still required'
        : 'tenant capability chain is not fully enabled',
    },
    stage,
  };
}

function reportChecks(report) {
  const checks = [
    report.git?.ok,
    report.maintenance?.ok,
    report.mutationSources?.ok,
    report.provisioning?.ok,
    report.capabilities?.ok,
    report.backup?.ok,
    report.preservation?.ok,
    report.database?.capabilities?.ok,
    report.database?.integrity?.ok,
    report.database?.migrations?.ok,
    report.database?.singleton?.ok,
  ].filter((value) => value !== undefined);
  return checks.every(Boolean);
}

async function writeReport(report, outputPath) {
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  if (outputPath) {
    const absolute = path.resolve(outputPath);
    await fsp.mkdir(path.dirname(absolute), { recursive: true });
    await fsp.writeFile(absolute, serialized, { flag: 'wx' });
  }
  process.stdout.write(serialized);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const phase = required(options, 'phase');
  if (!PHASES.has(phase)) throw new Error(`Unsupported rollout phase: ${phase}`);
  const expectedSha = required(options, 'expected-sha');
  const baseReport = {
    generatedAt: new Date().toISOString(),
    git: verifyExpectedHead(expectedSha),
    maintenance: maintenanceCheck(),
    mutationSources: mutationSourcesCheck(),
    phase,
    provisioning: provisioningCheck(),
    schema: REPORT_SCHEMA,
    schemaVersion: REPORT_SCHEMA_VERSION,
  };
  if (!baseReport.git.ok) {
    const error = new Error(
      'Current checkout must be clean and match --expected-sha',
    );
    error.code = 'TENANT_ROLLOUT_GIT_SHA_MISMATCH';
    throw error;
  }
  if (!baseReport.maintenance.ok) {
    const error = new Error(
      `${ROLLOUT_MAINTENANCE_ENV}=${ROLLOUT_MAINTENANCE_MODE} is required`,
    );
    error.code = 'TENANT_ROLLOUT_MAINTENANCE_REQUIRED';
    throw error;
  }
  if (!baseReport.provisioning.ok) {
    const error = new Error(
      'INSTALLATION_PROVISIONING_ENABLED must be explicitly disabled during rollout',
    );
    error.code = 'TENANT_ROLLOUT_PROVISIONING_MUST_BE_DISABLED';
    throw error;
  }
  if (!baseReport.mutationSources.ok) {
    const error = new Error(
      'BOTS_ENABLED and BACKGROUND_RUNNERS_ENABLED must be explicitly disabled during rollout',
    );
    error.code = 'TENANT_ROLLOUT_MUTATION_SOURCES_MUST_BE_DISABLED';
    throw error;
  }
  await db.sequelize.authenticate();
  const report = phase === 'before-migrations'
    ? await runBeforeMigrations(options, baseReport)
    : phase === 'restore-rehearsal'
      ? await runRestoreRehearsal(options, baseReport)
      : phase === 'post-migrations'
        ? await runPostMigrations(options, baseReport)
        : await runStage(options, baseReport);
  report.ok = reportChecks(report);
  report.evidenceDigest = digestJson({
    ...report,
    evidenceDigest: undefined,
  });
  await writeReport(report, options.output);
  if (!report.ok) process.exitCode = 1;
}

if (require.main === module) {
  main()
    .catch((error) => {
      process.stderr.write(`${JSON.stringify({
        code: error.code || 'TENANT_PRODUCTION_ROLLOUT_FAILED',
        error: error.message,
      }, null, 2)}\n`);
      process.exitCode = 1;
    })
    .finally(() => db.sequelize.close());
}

module.exports = {
  PHASES,
  REPORT_SCHEMA,
  REPORT_SCHEMA_VERSION,
  ROLLOUT_CLI_OPTIONS,
  assertUniqueArtifactRoots,
  assertSameRelease,
  currentGitHead,
  currentGitStatus,
  loadMigrationStatus,
  mutationSourcesCheck,
  parseArgs,
  provisioningCheck,
  reportChecks,
  validatePriorReport,
  verifyExpectedHead,
};
