'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { afterEach, test } = require('node:test');
const {
  TenantStorageError,
  assertSafeStorageKey,
  atomicWriteStorageObject,
  buildTenantStorageKey,
  deleteStorageObject,
  resolveExistingStoragePath,
} = require('../../src/storage/tenant-storage');

const roots = [];

async function tempRoot() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'setly-storage-test-'));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { force: true, recursive: true })));
});

test('storage keys separate organization and club even for identical record/file identities', () => {
  const input = { domain: 'shift-report-attachments', fileId: 'file-a', recordId: 'record-a' };
  const first = buildTenantStorageKey({ ...input, organizationId: 1, clubId: 1 });
  const secondClub = buildTenantStorageKey({ ...input, organizationId: 1, clubId: 2 });
  const secondOrganization = buildTenantStorageKey({ ...input, organizationId: 2, clubId: 1 });

  assert.notEqual(first, secondClub);
  assert.notEqual(first, secondOrganization);
  assert.equal(first.split('/').length, 5);
  assert.equal(first.includes('record-a'), false);
  assert.equal(first.includes('file-a'), false);
});

test('storage key validation rejects absolute paths and traversal', () => {
  for (const key of ['/tmp/file', '../file', 'org_a/club_a/domain/../file', 'org_a\\club_a']) {
    assert.throws(() => assertSafeStorageKey(key), TenantStorageError);
  }
});

test('atomic write fsync flow creates a regular object and delete is idempotent', async () => {
  const root = await tempRoot();
  const key = buildTenantStorageKey({
    organizationId: 4,
    clubId: 9,
    domain: 'shift-report-attachments',
    recordId: 17,
    fileId: 'file-a',
  });
  const written = await atomicWriteStorageObject({
    buffer: Buffer.from('tenant payload'),
    storageKey: key,
    storageRoot: root,
  });
  const absolutePath = await resolveExistingStoragePath({ storageKey: key, storageRoot: root });
  assert.equal(await fs.readFile(absolutePath, 'utf8'), 'tenant payload');
  assert.equal(written.size, 14);
  assert.equal(await deleteStorageObject({ storageKey: key, storageRoot: root }), true);
  assert.equal(await deleteStorageObject({ storageKey: key, storageRoot: root }), false);
});

test('symlink namespace and object escapes are rejected', async () => {
  const root = await tempRoot();
  const outside = await tempRoot();
  const key = buildTenantStorageKey({
    organizationId: 3,
    clubId: 5,
    domain: 'shift-report-attachments',
    recordId: 20,
    fileId: 'file-b',
  });
  const [organizationComponent] = key.split('/');
  await fs.symlink(outside, path.join(root, organizationComponent));

  await assert.rejects(
    atomicWriteStorageObject({ buffer: Buffer.from('nope'), storageKey: key, storageRoot: root }),
    (error) => error.code === 'TENANT_STORAGE_SYMLINK',
  );
});

test('conflicting atomic write leaves no temporary partial files', async () => {
  const root = await tempRoot();
  const key = buildTenantStorageKey({
    organizationId: 1,
    clubId: 1,
    domain: 'shift-report-attachments',
    recordId: 2,
    fileId: 'same',
  });
  await atomicWriteStorageObject({ buffer: Buffer.from('first'), storageKey: key, storageRoot: root });
  await assert.rejects(
    atomicWriteStorageObject({ buffer: Buffer.from('second'), storageKey: key, storageRoot: root }),
    (error) => error.code === 'TENANT_STORAGE_CONFLICT',
  );
  const parent = path.dirname(await resolveExistingStoragePath({ storageKey: key, storageRoot: root }));
  assert.equal((await fs.readdir(parent)).some((name) => name.startsWith('.tmp-')), false);
});

test('concurrent writes never replace an already linked storage object', async () => {
  const root = await tempRoot();
  const key = buildTenantStorageKey({
    organizationId: 1,
    clubId: 1,
    domain: 'shift-report-attachments',
    recordId: 3,
    fileId: 'concurrent',
  });
  const results = await Promise.allSettled([
    atomicWriteStorageObject({ buffer: Buffer.from('first'), storageKey: key, storageRoot: root }),
    atomicWriteStorageObject({ buffer: Buffer.from('second'), storageKey: key, storageRoot: root }),
  ]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  const rejected = results.find((result) => result.status === 'rejected');
  assert.equal(rejected.reason.code, 'TENANT_STORAGE_CONFLICT');
  const absolutePath = await resolveExistingStoragePath({ storageKey: key, storageRoot: root });
  assert.ok(['first', 'second'].includes(await fs.readFile(absolutePath, 'utf8')));
  assert.equal((await fs.readdir(path.dirname(absolutePath))).some((name) => name.startsWith('.tmp-')), false);
});
