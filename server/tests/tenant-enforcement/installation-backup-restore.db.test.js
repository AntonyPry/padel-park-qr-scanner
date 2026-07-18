'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const SequelizePackage = require('sequelize');
const {
  connect,
  createDisposableDatabase,
  dropDisposableDatabase,
  migrateAll,
  seedTwoTenantFixture,
} = require('../helpers/final-tenant-rc-fixture');
const {
  buildTenantStorageKey,
} = require('../../src/storage/tenant-storage');

function mysqlArgs(database) {
  const args = [
    '-h', process.env.DB_HOST || '127.0.0.1',
    '-u', process.env.DB_USER,
    '--skip-ssl',
  ];
  if (process.env.DB_PORT) args.push('-P', String(process.env.DB_PORT));
  if (database) args.push(database);
  return args;
}

function databaseToolEnv() {
  return {
    ...process.env,
    MYSQL_PWD: process.env.DB_PASSWORD || '',
  };
}

function runDump(database, output) {
  const descriptor = fs.openSync(output, 'wx', 0o600);
  try {
    const result = spawnSync(
      process.env.MYSQLDUMP_BIN || 'mysqldump',
      [
        ...mysqlArgs(null),
        '--single-transaction',
        '--routines',
        '--triggers',
        '--events',
        '--hex-blob',
        '--no-tablespaces',
        '--skip-lock-tables',
        database,
      ],
      {
        encoding: 'utf8',
        env: databaseToolEnv(),
        stdio: ['ignore', descriptor, 'pipe'],
      },
    );
    if (result.status !== 0) {
      throw new Error(`mysqldump failed: ${result.stderr || result.error?.message}`);
    }
  } finally {
    fs.closeSync(descriptor);
  }
}

function runRestore(database, input) {
  const descriptor = fs.openSync(input, 'r');
  try {
    const result = spawnSync(
      process.env.MYSQL_BIN || 'mysql',
      mysqlArgs(database),
      {
        encoding: 'utf8',
        env: databaseToolEnv(),
        stdio: [descriptor, 'pipe', 'pipe'],
      },
    );
    if (result.status !== 0) {
      throw new Error(`mysql restore failed: ${result.stderr || result.error?.message}`);
    }
  } finally {
    fs.closeSync(descriptor);
  }
}

function writeAttachmentDetector(filePath, overrides = {}) {
  const zeroCounts = {
    checksumMismatch: 0,
    invalidMetadata: 0,
    legacyOrphans: 0,
    missingLegacy: 0,
    missingStorage: 0,
    storageOrphans: 0,
  };
  fs.writeFileSync(filePath, `${JSON.stringify({
    counts: { ...zeroCounts, ...(overrides.counts || {}) },
    orphans: { legacy: [], storage: [] },
    schema: 'setly.shift-report-attachments',
    version: 1,
  }, null, 2)}\n`, { flag: 'wx' });
}

function writeArtifact(root, relative, contents) {
  const filePath = path.join(root, relative);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents, { flag: 'wx' });
  return filePath;
}

async function tableCounts(schema) {
  const tables = await schema.query(
    `SELECT TABLE_NAME AS tableName
       FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_SCHEMA=DATABASE() AND TABLE_TYPE='BASE TABLE'
      ORDER BY TABLE_NAME`,
    { type: SequelizePackage.QueryTypes.SELECT },
  );
  const counts = {};
  for (const { tableName } of tables) {
    const [row] = await schema.query(
      `SELECT COUNT(*) AS count FROM \`${tableName}\``,
      { type: SequelizePackage.QueryTypes.SELECT },
    );
    counts[tableName] = Number(row.count);
  }
  return counts;
}

async function tenantIdentityInventory(schema) {
  return schema.query(
    `SELECT o.slug AS organizationSlug,c.slug AS clubSlug,m.role,
            a.email,u.phoneNormalized,ic.provider,ic.purpose,ic.connectionKey
       FROM Organizations AS o
       JOIN Clubs AS c ON c.organizationId=o.id
       LEFT JOIN Memberships AS m ON m.organizationId=o.id
       LEFT JOIN Accounts AS a ON a.id=m.accountId
       LEFT JOIN Users AS u ON u.organizationId=o.id
       LEFT JOIN IntegrationConnections AS ic
         ON ic.organizationId=o.id AND ic.clubId=c.id
      ORDER BY organizationSlug,clubSlug,role,email,provider,purpose`,
    { type: SequelizePackage.QueryTypes.SELECT },
  );
}

test('Feature 9 installation-wide backup/restore rehearsal', async () => {
  assert.ok(process.env.DB_USER, 'DB_USER is required for restore rehearsal');
  const suffix = `${process.pid}_${Date.now()}`;
  const sourceDatabase = `setly_f9_rc_backup_source_${suffix}`;
  const restoreDatabase = `setly_f9_rc_backup_restore_${suffix}`;
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'setly-f9-rc-restore-'));
  const previous = {
    DB_NAME: process.env.DB_NAME,
    NODE_ENV: process.env.NODE_ENV,
  };
  let rootDb;
  let source;
  let restored;

  await createDisposableDatabase(sourceDatabase);
  await createDisposableDatabase(restoreDatabase);
  process.env.DB_NAME = sourceDatabase;
  process.env.NODE_ENV = 'test';
  try {
    source = connect(sourceDatabase);
    await migrateAll(source);
    const fixture = await seedTwoTenantFixture(source);
    const sourceCounts = await tableCounts(source);
    const sourceIdentity = await tenantIdentityInventory(source);

    const sourceStorage = path.join(tempRoot, 'source-tenant-storage');
    const sourceLegacyReports = path.join(tempRoot, 'source-legacy-reports');
    const sourceLegacyCash = path.join(tempRoot, 'source-legacy-cash');
    for (const key of ['A', 'B']) {
      const storageKey = buildTenantStorageKey({
        clubId: fixture.clubs[key][0],
        domain: 'reports',
        fileId: 'same-upload',
        organizationId: fixture.organizations[key],
        recordId: 'same-report',
      });
      writeArtifact(sourceStorage, storageKey, `tenant-${key}-payload\n`);
    }
    writeArtifact(sourceLegacyReports, 'reports/legacy-report.txt', 'legacy-report\n');
    writeArtifact(sourceLegacyCash, 'cash/legacy-cash.txt', 'legacy-cash\n');
    const attachmentDetector = path.join(tempRoot, 'attachment-detector.json');
    writeAttachmentDetector(attachmentDetector);

    const dump = path.join(tempRoot, 'installation.sql');
    runDump(sourceDatabase, dump);
    assert.ok(fs.statSync(dump).size > 1000);

    rootDb = require('../../models');
    const backup = require('../../scripts/tenant-backup-manifest');
    const manifestPath = path.join(tempRoot, 'installation-manifest.json');
    const manifest = await backup.createManifest({
      'attachment-manifest': attachmentDetector,
      'db-dump': dump,
      'legacy-shift-cash-root': sourceLegacyCash,
      'legacy-shift-report-root': sourceLegacyReports,
      output: manifestPath,
      'storage-root': sourceStorage,
    });
    assert.equal(manifest.restoreMode, 'installation-wide-only');
    assert.equal(manifest.tenantSelectiveRestore.startsWith('unsupported'), true);
    assert.equal(manifest.workerState.localStateIncluded, false);
    assert.equal(manifest.integrationConnections.length, 4);
    assert.ok(manifest.integrationConnections.every(
      (connection) =>
        !Object.hasOwn(connection, 'secretCiphertext') &&
        !Object.hasOwn(connection, 'secretKeyVersion'),
    ));
    assert.equal(backup.verifyManifest({ manifest: manifestPath, verify: true }).ok, true);

    runRestore(restoreDatabase, dump);
    restored = connect(restoreDatabase);
    assert.deepEqual(await tableCounts(restored), sourceCounts);
    assert.deepEqual(await tenantIdentityInventory(restored), sourceIdentity);

    const finalMigration = require('../../migrations/20260720100000-add-final-tenant-enforcement');
    await finalMigration.up(restored.getQueryInterface(), SequelizePackage);
    await finalMigration.up(restored.getQueryInterface(), SequelizePackage);
    const {
      runTenantIntegrityDetector,
    } = require('../../src/tenant-enforcement/integrity-detector');
    const detector = await runTenantIntegrityDetector({
      sequelize: restored,
      strict: true,
    });
    assert.equal(detector.ok, true, JSON.stringify(detector.findings, null, 2));

    const restoredStorage = path.join(tempRoot, 'restored-tenant-storage');
    const restoredLegacyReports = path.join(tempRoot, 'restored-legacy-reports');
    const restoredLegacyCash = path.join(tempRoot, 'restored-legacy-cash');
    const restoredAttachmentDetector = path.join(
      tempRoot,
      'restored-detector',
      path.basename(attachmentDetector),
    );
    fs.cpSync(sourceStorage, restoredStorage, { recursive: true });
    fs.cpSync(sourceLegacyReports, restoredLegacyReports, { recursive: true });
    fs.cpSync(sourceLegacyCash, restoredLegacyCash, { recursive: true });
    fs.mkdirSync(path.dirname(restoredAttachmentDetector), { recursive: true });
    fs.copyFileSync(attachmentDetector, restoredAttachmentDetector, fs.constants.COPYFILE_EXCL);
    const verification = backup.verifyManifest({
      'attachment-manifest': restoredAttachmentDetector,
      'db-dump': dump,
      'legacy-shift-cash-root': restoredLegacyCash,
      'legacy-shift-report-root': restoredLegacyReports,
      manifest: manifestPath,
      'storage-root': restoredStorage,
      verify: true,
    });
    assert.equal(verification.ok, true);

    const [providerState] = await restored.query(
      `SELECT
         COUNT(*) AS rowsCount,
         COUNT(DISTINCT idempotencyKey) AS idempotencyKeys
       FROM (
         SELECT idempotencyKey FROM TelephonyRawEvents
         UNION ALL
         SELECT idempotencyKey FROM Receipts
       ) AS providerRows`,
      { type: SequelizePackage.QueryTypes.SELECT },
    );
    assert.equal(Number(providerState.rowsCount), 4);
    assert.equal(Number(providerState.idempotencyKeys), 4);

    const incomplete = JSON.parse(JSON.stringify(manifest));
    incomplete.artifacts.pop();
    assert.throws(
      () => backup.validateManifestSchema(incomplete),
      /artifact labels are missing/,
    );
    const selective = JSON.parse(JSON.stringify(manifest));
    selective.restoreMode = 'tenant-selective';
    assert.throws(
      () => backup.validateManifestSchema(selective),
      /tenant-selective backup manifest/,
    );
    const unsafeDetector = path.join(tempRoot, 'unsafe-attachment-detector.json');
    writeAttachmentDetector(unsafeDetector, { counts: { storageOrphans: 1 } });
    assert.throws(
      () => backup.validateAttachmentDetector(unsafeDetector),
      /unsafe: storageOrphans/,
    );
    if (process.env.TENANT_RC_ARTIFACT_DIR) {
      const artifactRoot = path.resolve(process.env.TENANT_RC_ARTIFACT_DIR);
      assert.match(artifactRoot, /setly-f9-rc-/);
      fs.mkdirSync(artifactRoot, { recursive: true });
      fs.writeFileSync(
        path.join(artifactRoot, 'restore-rehearsal-report.json'),
        `${JSON.stringify({
          artifacts: manifest.artifacts.map((artifact) => ({
            files: artifact.files,
            label: artifact.label,
            totalBytes: artifact.totalBytes,
          })),
          detector: detector.counts,
          generatedAt: new Date().toISOString(),
          integrationConnections: manifest.integrationConnections.length,
          ok: true,
          restoredTableCounts: sourceCounts,
          restoreMode: manifest.restoreMode,
          schema: 'setly.installation-restore-rehearsal',
          schemaVersion: 1,
          tenantSelectiveRestore: manifest.tenantSelectiveRestore,
          verification: verification.results,
          workerState: manifest.workerState,
        }, null, 2)}\n`,
        { flag: 'wx' },
      );
    }
  } finally {
    await rootDb?.sequelize.close().catch(() => {});
    await source?.close().catch(() => {});
    await restored?.close().catch(() => {});
    if (previous.DB_NAME === undefined) delete process.env.DB_NAME;
    else process.env.DB_NAME = previous.DB_NAME;
    if (previous.NODE_ENV === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous.NODE_ENV;
    await dropDisposableDatabase(sourceDatabase).catch(() => {});
    await dropDisposableDatabase(restoreDatabase).catch(() => {});
    fs.rmSync(tempRoot, { force: true, recursive: true });
  }
});
