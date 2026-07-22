'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { afterEach, test } = require('node:test');
const {
  migrateShiftReportAttachments,
} = require('../../src/files-workers/shift-attachment-migration');

const roots = [];

async function makeRoot(prefix) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { force: true, recursive: true })));
});

function fakeAnswer(initial) {
  return {
    id: 7,
    reportId: 42,
    attachments: initial,
    async update(payload) {
      this.attachments = payload.attachments;
    },
  };
}

function legacyAttachment(attachmentId, relativePath) {
  return {
    id: attachmentId,
    mimeType: 'image/png',
    originalName: 'qa.png',
    relativePath,
    size: 19,
    uploadedAt: '2026-07-01T00:00:00.000Z',
  };
}

async function regularFiles(root) {
  const files = [];
  async function visit(directory) {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(entryPath);
      if (entry.isFile()) files.push(entryPath);
    }
  }
  await visit(root);
  return files.sort();
}

async function assertUnsafeLegacyLink({ linkKind, mode }) {
  const legacyRoot = await makeRoot(`setly-legacy-${linkKind}-${mode}-`);
  const storageRoot = await makeRoot(`setly-storage-${linkKind}-${mode}-`);
  const outsideRoot = await makeRoot(`setly-outside-${linkKind}-${mode}-`);
  const attachmentId = 'b12c1a0e-9f21-4e43-8f26-278af61b3e58';
  const relativePath = path.join('42', `${attachmentId}.png`);
  const legacyPath = path.join(legacyRoot, relativePath);
  const reportDirectory = path.dirname(legacyPath);
  const outsidePath = linkKind === 'directory'
    ? path.join(outsideRoot, path.basename(legacyPath))
    : path.join(outsideRoot, 'outside.png');
  const answer = fakeAnswer([legacyAttachment(attachmentId, relativePath)]);
  const db = { ShiftReportAnswer: { async findAll() { return [answer]; } } };
  const options = {
    db,
    legacyRoot,
    storageRoot,
    tenant: { organizationId: 10, clubId: 20 },
  };

  if (mode === 'rollback') {
    await fs.mkdir(reportDirectory, { recursive: true });
    await fs.writeFile(legacyPath, Buffer.from('outside-safe-target'));
    const applied = await migrateShiftReportAttachments({ ...options, apply: true });
    assert.equal(applied.counts.copied, 1);
    assert.ok(answer.attachments[0].storageKey);
  }

  if (linkKind === 'directory') {
    await fs.rm(reportDirectory, { force: true, recursive: true });
    await fs.writeFile(outsidePath, Buffer.from('outside-safe-target'));
    await fs.symlink(outsideRoot, reportDirectory, 'dir');
  } else {
    await fs.mkdir(reportDirectory, { recursive: true });
    await fs.rm(legacyPath, { force: true });
    await fs.writeFile(outsidePath, Buffer.from('outside-safe-target'));
    await fs.symlink(outsidePath, legacyPath, 'file');
  }

  const metadataBefore = JSON.stringify(answer.attachments);
  const storageFilesBefore = await regularFiles(storageRoot);
  const result = await migrateShiftReportAttachments({
    ...options,
    apply: mode === 'apply',
    rollback: mode === 'rollback',
  });

  assert.equal(result.mode, mode);
  assert.equal(result.counts.invalidMetadata, 1);
  assert.equal(result.counts.copied, 0);
  assert.equal(result.counts.rolledBack, 0);
  assert.equal(result.counts.dbRowsChanged, 0);
  assert.deepEqual(result.files, []);
  assert.equal(JSON.stringify(answer.attachments), metadataBefore);
  assert.deepEqual(await regularFiles(storageRoot), storageFilesBefore);
  assert.equal(await fs.readFile(outsidePath, 'utf8'), 'outside-safe-target');
}

test('attachment migration dry-run/apply/rollback/reapply is idempotent and never removes files', async () => {
  const legacyRoot = await makeRoot('setly-legacy-');
  const storageRoot = await makeRoot('setly-tenant-storage-');
  const attachmentId = '912c1a0e-9f21-4e43-8f26-278af61b3e58';
  const relativePath = path.join('42', `${attachmentId}.heic`);
  const legacyPath = path.join(legacyRoot, relativePath);
  await fs.mkdir(path.dirname(legacyPath), { recursive: true });
  await fs.writeFile(legacyPath, Buffer.from('heic-test-content'));
  const answer = fakeAnswer([{
    id: attachmentId,
    mimeType: 'image/heic',
    originalName: 'private-name.heic',
    relativePath,
    size: 17,
    uploadedAt: '2026-07-01T00:00:00.000Z',
  }]);
  const db = { ShiftReportAnswer: { async findAll() { return [answer]; } } };
  const options = {
    db,
    legacyRoot,
    storageRoot,
    tenant: { organizationId: 10, clubId: 20 },
    now: new Date('2026-07-15T12:00:00.000Z'),
  };

  const dryRun = await migrateShiftReportAttachments(options);
  assert.equal(dryRun.mode, 'dry-run');
  assert.equal(dryRun.counts.eligibleLegacy, 1);
  assert.equal(dryRun.files[0].storageKey.includes('private-name'), false);
  assert.equal(dryRun.tenants[0].domains['shift-report-attachments'].fileCount, 1);

  const applied = await migrateShiftReportAttachments({ ...options, apply: true });
  assert.equal(applied.counts.copied, 1);
  assert.equal(answer.attachments[0].organizationId, 10);
  const tenantPath = path.join(storageRoot, ...answer.attachments[0].storageKey.split('/'));
  assert.equal(await fs.readFile(tenantPath, 'utf8'), 'heic-test-content');
  assert.equal(await fs.readFile(legacyPath, 'utf8'), 'heic-test-content');

  const appliedAgain = await migrateShiftReportAttachments({ ...options, apply: true });
  assert.equal(appliedAgain.counts.alreadyMigrated, 1);
  assert.equal(appliedAgain.counts.dbRowsChanged, 0);

  const rolledBack = await migrateShiftReportAttachments({ ...options, rollback: true });
  assert.equal(rolledBack.counts.rolledBack, 1);
  assert.equal(rolledBack.counts.storageOrphans, 1);
  assert.equal(answer.attachments[0].relativePath, relativePath);
  assert.equal(await fs.readFile(tenantPath, 'utf8'), 'heic-test-content');
  assert.equal(await fs.readFile(legacyPath, 'utf8'), 'heic-test-content');

  const reapplied = await migrateShiftReportAttachments({ ...options, apply: true });
  assert.equal(reapplied.counts.copied, 1);
  assert.equal(answer.attachments[0].storageKey, applied.files[0].storageKey);
});

test('rollback rejects a tampered legacy fallback path even when its checksum matches', async () => {
  const legacyRoot = await makeRoot('setly-legacy-tampered-');
  const storageRoot = await makeRoot('setly-tenant-storage-tampered-');
  const outsideRoot = await makeRoot('setly-outside-tampered-');
  const attachmentId = 'a12c1a0e-9f21-4e43-8f26-278af61b3e58';
  const relativePath = path.join('42', `${attachmentId}.png`);
  const legacyPath = path.join(legacyRoot, relativePath);
  await fs.mkdir(path.dirname(legacyPath), { recursive: true });
  await fs.writeFile(legacyPath, Buffer.from('same-checksum'));
  const answer = fakeAnswer([{
    id: attachmentId,
    mimeType: 'image/png',
    originalName: 'qa.png',
    relativePath,
    size: 13,
  }]);
  const db = { ShiftReportAnswer: { async findAll() { return [answer]; } } };
  const options = {
    db,
    legacyRoot,
    storageRoot,
    tenant: { organizationId: 10, clubId: 20 },
  };
  await migrateShiftReportAttachments({ ...options, apply: true });
  const outsidePath = path.join(outsideRoot, 'outside.png');
  await fs.writeFile(outsidePath, Buffer.from('same-checksum'));
  answer.attachments[0].legacyRelativePath = path.relative(legacyRoot, outsidePath);

  const rollback = await migrateShiftReportAttachments({ ...options, rollback: true });
  assert.equal(rollback.counts.rolledBack, 0);
  assert.equal(rollback.counts.invalidMetadata, 1);
  assert.ok(answer.attachments[0].storageKey);
  assert.equal(answer.attachments[0].relativePath, undefined);
});

test('dry-run/apply/rollback reject a symlinked report directory outside legacy root', async (t) => {
  for (const mode of ['dry-run', 'apply', 'rollback']) {
    await t.test(mode, () => assertUnsafeLegacyLink({ linkKind: 'directory', mode }));
  }
});

test('dry-run/apply/rollback reject a symlinked legacy file outside legacy root', async (t) => {
  for (const mode of ['dry-run', 'apply', 'rollback']) {
    await t.test(mode, () => assertUnsafeLegacyLink({ linkKind: 'file', mode }));
  }
});
