'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { after, before, test } = require('node:test');
const db = require('../../models');
const {
  compareInventory,
  createManifest,
  inventoryPath,
  verifyManifest,
} = require('../../scripts/tenant-backup-manifest');

let root;
let storage;
let manifestPath;

before(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'setly-backup-manifest-'));
  storage = path.join(root, 'tenant-storage');
  fs.mkdirSync(storage);
  fs.writeFileSync(path.join(storage, 'attachment.txt'), 'tenant-owned-content');
  const artifact = inventoryPath(storage, 'tenant-storage', { required: true });
  manifestPath = path.join(root, 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify({
    artifacts: [artifact],
    integrationConnections: [{
      clubId: 1,
      connectionKey: 'default',
      id: 1,
      organizationId: 1,
      provider: 'evotor',
      purpose: 'receipts',
      status: 'active',
    }],
    restoreMode: 'installation-wide-only',
    schemaVersion: 1,
    tenantSelectiveRestore: 'unsupported-without-complete-pk-fk-file-remap-contract',
    workerState: {
      localStateIncluded: false,
      policy: 'rebuild-local-worker-state-after-restore; do-not-replay-stale-claims',
    },
  }));
});

after(() => {
  fs.rmSync(root, { force: true, recursive: true });
});

test('backup manifest verifies exact checksums and installation-wide policy', () => {
  assert.equal(verifyManifest({ manifest: manifestPath }).ok, true);
  const restoredStorage = path.join(root, 'restored-tenant-storage');
  fs.mkdirSync(restoredStorage);
  fs.copyFileSync(
    path.join(storage, 'attachment.txt'),
    path.join(restoredStorage, 'attachment.txt'),
  );
  assert.equal(verifyManifest({
    manifest: manifestPath,
    'storage-root': restoredStorage,
  }).ok, true);
});

test('backup manifest creation includes only non-secret integration metadata', async () => {
  const dump = path.join(root, 'database.sql');
  const output = path.join(root, 'created-manifest.json');
  fs.writeFileSync(dump, 'consistent database snapshot');
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
      'db-dump': dump,
      'legacy-shift-cash-root': path.join(root, 'missing-cash'),
      'legacy-shift-report-root': path.join(root, 'missing-reports'),
      output,
      'storage-root': storage,
    });
    assert.equal(created.restoreMode, 'installation-wide-only');
    assert.equal(created.integrationConnections.length, 1);
    assert.equal(created.integrationConnections[0].provider, 'evotor');
    assert.equal(requestedAttributes.includes('credentialsEncrypted'), false);
    assert.equal(requestedAttributes.includes('secret'), false);
    assert.equal(JSON.stringify(created).includes('token'), false);
    assert.equal(fs.existsSync(output), true);
    await assert.rejects(
      createManifest({
        'db-dump': dump,
        output,
        'storage-root': storage,
      }),
      /EEXIST/,
    );
  } finally {
    db.IntegrationConnection = original;
  }
});

test('backup manifest detects checksum changes and orphan files', () => {
  const expected = inventoryPath(storage, 'tenant-storage', { required: true });
  fs.writeFileSync(path.join(storage, 'attachment.txt'), 'changed');
  fs.writeFileSync(path.join(storage, 'orphan.txt'), 'orphan');
  const result = compareInventory(
    expected,
    inventoryPath(storage, 'tenant-storage', { required: true }),
  );
  assert.deepEqual(result.mismatched, ['attachment.txt']);
  assert.deepEqual(result.orphaned, ['orphan.txt']);
  assert.throws(
    () => verifyManifest({ manifest: manifestPath }),
    /missing, mismatched or orphaned/,
  );
});

test('tenant-selective restore manifests are refused', () => {
  const selective = path.join(root, 'selective.json');
  fs.writeFileSync(selective, JSON.stringify({
    artifacts: [],
    restoreMode: 'tenant-selective',
    schemaVersion: 1,
  }));
  assert.throws(
    () => verifyManifest({ manifest: selective }),
    /Unsupported or tenant-selective/,
  );
});
