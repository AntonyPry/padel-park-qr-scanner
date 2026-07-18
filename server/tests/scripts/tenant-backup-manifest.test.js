'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { afterEach, test } = require('node:test');
const db = require('../../models');
const {
  MANIFEST_SCHEMA,
  WORKER_STATE_POLICY,
  compareInventory,
  createManifest,
  inventoryPath,
  validateAttachmentDetector,
  validateManifestSchema,
  verifyManifest,
} = require('../../scripts/tenant-backup-manifest');

const roots = [];

afterEach(() => {
  while (roots.length) fs.rmSync(roots.pop(), { force: true, recursive: true });
});

function safeDetector(overrides = {}) {
  return {
    counts: {
      checksumMismatch: 0,
      invalidMetadata: 0,
      legacyOrphans: 0,
      missingLegacy: 0,
      missingStorage: 0,
      storageOrphans: 0,
      ...overrides,
    },
    files: [],
    orphans: { legacy: [], storage: [] },
    schema: 'setly.shift-report-attachments',
    version: 1,
  };
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'setly-backup-manifest-'));
  roots.push(root);
  const paths = {
    cash: path.join(root, 'legacy-cash'),
    database: path.join(root, 'database.sql'),
    detector: path.join(root, 'attachments.json'),
    reports: path.join(root, 'legacy-reports'),
    storage: path.join(root, 'tenant-storage'),
  };
  for (const directory of [paths.cash, paths.reports, paths.storage]) {
    fs.mkdirSync(directory);
    fs.writeFileSync(path.join(directory, 'artifact.bin'), `content:${path.basename(directory)}`);
  }
  fs.writeFileSync(paths.database, 'consistent database snapshot');
  fs.writeFileSync(paths.detector, JSON.stringify(safeDetector()));
  const artifacts = [
    inventoryPath(paths.database, 'database', { required: true }),
    inventoryPath(paths.storage, 'tenant-storage', { required: true }),
    inventoryPath(paths.reports, 'legacy-shift-reports', { required: true }),
    inventoryPath(paths.cash, 'legacy-shift-cash', { required: true }),
    inventoryPath(paths.detector, 'attachment-orphan-detector', { required: true }),
  ];
  const manifest = {
    artifacts,
    attachmentDetector: validateAttachmentDetector(paths.detector),
    generatedAt: '2026-01-01T00:00:00.000Z',
    integrationConnections: [],
    restoreMode: 'installation-wide-only',
    schema: MANIFEST_SCHEMA,
    schemaVersion: 1,
    tenantSelectiveRestore: 'unsupported-without-complete-pk-fk-file-remap-contract',
    workerState: WORKER_STATE_POLICY,
  };
  const manifestPath = path.join(root, 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  return { manifest, manifestPath, paths, root };
}

test('backup manifest verifies all required artifacts and exact restored-root overrides', () => {
  const source = fixture();
  assert.equal(verifyManifest({ manifest: source.manifestPath }).ok, true);
  const restored = fixture();
  assert.equal(verifyManifest({
    'attachment-manifest': restored.paths.detector,
    'db-dump': restored.paths.database,
    'legacy-shift-cash-root': restored.paths.cash,
    'legacy-shift-report-root': restored.paths.reports,
    manifest: source.manifestPath,
    'storage-root': restored.paths.storage,
  }).ok, true);
});

test('backup manifest creation includes only non-secret integration metadata', async () => {
  const data = fixture();
  const output = path.join(data.root, 'created-manifest.json');
  const original = db.IntegrationConnection;
  let requestedAttributes;
  db.IntegrationConnection = {
    unscoped() {
      return {
        async findAll(options) {
          requestedAttributes = options.attributes;
          return [{
            clubId: 1,
            connectionKey: 'default',
            createdAt: new Date('2026-01-01T00:00:00.000Z'),
            id: 1,
            organizationId: 1,
            provider: 'evotor',
            purpose: 'receipts',
            status: 'active',
            updatedAt: new Date('2026-01-01T00:00:00.000Z'),
          }];
        },
      };
    },
  };
  try {
    const created = await createManifest({
      'attachment-manifest': data.paths.detector,
      'db-dump': data.paths.database,
      'legacy-shift-cash-root': data.paths.cash,
      'legacy-shift-report-root': data.paths.reports,
      output,
      'storage-root': data.paths.storage,
    });
    assert.equal(created.artifacts.length, 5);
    assert.equal(created.integrationConnections.length, 1);
    assert.equal(requestedAttributes.includes('credentialsEncrypted'), false);
    assert.equal(JSON.stringify(created).includes('token'), false);
    assert.equal(verifyManifest({ manifest: output }).ok, true);
    await assert.rejects(createManifest({
      'attachment-manifest': data.paths.detector,
      'db-dump': data.paths.database,
      'legacy-shift-cash-root': data.paths.cash,
      'legacy-shift-report-root': data.paths.reports,
      output,
      'storage-root': data.paths.storage,
    }), /EEXIST/);
  } finally {
    db.IntegrationConnection = original;
  }
});

test('backup manifest refuses empty, missing, duplicate and unknown artifact labels', () => {
  const data = fixture();
  for (const artifacts of [
    [],
    data.manifest.artifacts.slice(1),
    [...data.manifest.artifacts, data.manifest.artifacts[0]],
    data.manifest.artifacts.map((artifact, index) =>
      index === 0 ? { ...artifact, label: 'database-copy' } : artifact),
  ]) {
    assert.throws(
      () => validateManifestSchema({ ...data.manifest, artifacts }),
      /labels|incomplete/,
    );
  }
  assert.throws(
    () => validateManifestSchema({
      ...data.manifest,
      artifacts: data.manifest.artifacts.map((artifact, index) =>
        index === 0 ? { ...artifact, files: [] } : artifact),
    }),
    /shape/,
  );
});

test('backup manifest parses detector and refuses unsafe counts or orphan arrays', () => {
  const data = fixture();
  for (const unsafe of [
    safeDetector({ checksumMismatch: 1 }),
    safeDetector({ invalidMetadata: 1 }),
    safeDetector({ missingLegacy: 1 }),
    safeDetector({ missingStorage: 1 }),
    { ...safeDetector(), orphans: { legacy: [{ pathHash: 'x' }], storage: [] } },
  ]) {
    fs.writeFileSync(data.paths.detector, JSON.stringify(unsafe));
    assert.throws(() => validateAttachmentDetector(data.paths.detector), /unsafe|orphan/);
  }
  fs.writeFileSync(data.paths.detector, '{');
  assert.throws(() => validateAttachmentDetector(data.paths.detector), /truncated|invalid/);
});

test('backup manifest detects changed and extra files', () => {
  const data = fixture();
  const expected = data.manifest.artifacts.find((artifact) => artifact.label === 'tenant-storage');
  fs.writeFileSync(path.join(data.paths.storage, 'artifact.bin'), 'changed');
  fs.writeFileSync(path.join(data.paths.storage, 'orphan.bin'), 'orphan');
  const result = compareInventory(
    expected,
    inventoryPath(data.paths.storage, 'tenant-storage', { required: true }),
  );
  assert.deepEqual(result.mismatched, ['artifact.bin']);
  assert.deepEqual(result.orphaned, ['orphan.bin']);
  assert.throws(() => verifyManifest({ manifest: data.manifestPath }), /missing, mismatched or orphaned/);
});

test('backup inventory refuses missing, empty, symlink and special roots', () => {
  const data = fixture();
  assert.throws(
    () => inventoryPath(path.join(data.root, 'missing'), 'database', { required: true }),
    /missing/,
  );
  const empty = path.join(data.root, 'empty');
  fs.mkdirSync(empty);
  assert.throws(() => inventoryPath(empty, 'tenant-storage', { required: true }), /empty/);
  const link = path.join(data.root, 'link');
  fs.symlinkSync(data.paths.storage, link);
  assert.throws(() => inventoryPath(link, 'tenant-storage', { required: true }), /symlink|regular/);
});

test('tenant-selective and malformed worker policy manifests are refused', () => {
  const data = fixture();
  assert.throws(
    () => validateManifestSchema({ ...data.manifest, restoreMode: 'tenant-selective' }),
    /tenant-selective|incomplete/,
  );
  assert.throws(
    () => validateManifestSchema({
      ...data.manifest,
      workerState: { ...WORKER_STATE_POLICY, localStateIncluded: true },
    }),
    /incomplete/,
  );
});
