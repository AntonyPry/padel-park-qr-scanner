'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { afterEach, test } = require('node:test');
const {
  main: runAttachmentCli,
  parseArgs,
} = require('../../scripts/migrate-shift-report-attachments');

const serverRoot = path.resolve(__dirname, '../..');
const preloadPath = path.join(serverRoot, 'tests/helpers/attachment-cli-preload.js');
const roots = [];

function manifest(countOverrides = {}) {
  return {
    schema: 'setly.shift-report-attachments',
    version: 1,
    generatedAt: '2026-07-19T00:00:00.000Z',
    mode: 'dry-run',
    storageRoot: '/safe/tenant-storage',
    legacyRoot: '/safe/legacy-shift-reports',
    tenants: [],
    counts: {
      checksumMismatch: 0,
      invalidMetadata: 0,
      legacyOrphans: 0,
      missingLegacy: 0,
      missingStorage: 0,
      storageOrphans: 0,
      ...countOverrides,
    },
    files: [],
    orphans: { legacy: [], storage: [] },
  };
}

async function makeRoot() {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'setly-attachment-cli-'));
  roots.push(root);
  return root;
}

function runDocumentedCommand(outputPath, detectorManifest) {
  const executable = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const existingNodeOptions = String(process.env.NODE_OPTIONS || '').trim();
  return spawnSync(
    executable,
    [
      'run',
      'tenant:files-workers:attachments',
      '--',
      `--output=${outputPath}`,
    ],
    {
      cwd: serverRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        NODE_OPTIONS: `${existingNodeOptions} --require=${preloadPath}`.trim(),
        SETLY_ATTACHMENT_CLI_TEST_MANIFEST: JSON.stringify(detectorManifest),
      },
    },
  );
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) =>
    fsp.rm(root, { force: true, recursive: true })));
});

test('documented package command atomically writes a parseable attachment manifest', async () => {
  const root = await makeRoot();
  const outputPath = path.join(root, 'attachments.json');
  const expected = manifest();
  const result = runDocumentedCommand(outputPath, expected);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(fs.existsSync(outputPath), true);
  assert.deepEqual(JSON.parse(await fsp.readFile(outputPath, 'utf8')), expected);
  assert.match(result.stdout, /"schema": "setly\.shift-report-attachments"/);
  assert.equal((await fsp.stat(outputPath)).mode & 0o777, 0o600);
  assert.deepEqual(
    (await fsp.readdir(root)).sort(),
    ['attachments.json'],
    'atomic writer must not leave a temporary file',
  );
});

test('documented package command preserves unsafe detector exit code and evidence', async () => {
  const root = await makeRoot();
  const outputPath = path.join(root, 'attachments-unsafe.json');
  const expected = manifest({ missingLegacy: 1 });
  const result = runDocumentedCommand(outputPath, expected);

  assert.equal(result.status, 2, result.stderr || result.stdout);
  assert.deepEqual(JSON.parse(await fsp.readFile(outputPath, 'utf8')), expected);
  assert.match(result.stdout, /"missingLegacy": 1/);
});

test('attachment output refuses missing parents, symlinks and non-regular targets', async () => {
  const root = await makeRoot();
  const sentinelPath = path.join(root, 'sentinel.json');
  const symlinkPath = path.join(root, 'attachments-link.json');
  await fsp.writeFile(sentinelPath, 'sentinel', 'utf8');
  await fsp.symlink(sentinelPath, symlinkPath);

  const symlinkResult = runDocumentedCommand(symlinkPath, manifest());
  assert.equal(symlinkResult.status, 1);
  assert.match(symlinkResult.stderr, /ATTACHMENT_CLI_OUTPUT_SYMLINK/);
  assert.equal(await fsp.readFile(sentinelPath, 'utf8'), 'sentinel');

  const directoryTarget = path.join(root, 'attachments-directory');
  await fsp.mkdir(directoryTarget);
  const directoryResult = runDocumentedCommand(directoryTarget, manifest());
  assert.equal(directoryResult.status, 1);
  assert.match(directoryResult.stderr, /ATTACHMENT_CLI_OUTPUT_NON_REGULAR/);

  const missingParentResult = runDocumentedCommand(
    path.join(root, 'missing-parent', 'attachments.json'),
    manifest(),
  );
  assert.equal(missingParentResult.status, 1);
  assert.match(missingParentResult.stderr, /ATTACHMENT_CLI_OUTPUT_PARENT_MISSING/);

  const readOnlyParent = path.join(root, 'read-only-parent');
  await fsp.mkdir(readOnlyParent, { mode: 0o500 });
  const readOnlyResult = runDocumentedCommand(
    path.join(readOnlyParent, 'attachments.json'),
    manifest(),
  );
  await fsp.chmod(readOnlyParent, 0o700);
  assert.equal(readOnlyResult.status, 1);
  assert.match(readOnlyResult.stderr, /ATTACHMENT_CLI_OUTPUT_PARENT_NOT_WRITABLE/);
});

test('attachment CLI rejects unsupported, duplicate and ambiguous arguments', () => {
  assert.deepEqual(parseArgs(['--output=/tmp/attachments.json']), {
    apply: false,
    output: '/tmp/attachments.json',
    rollback: false,
  });
  assert.throws(() => parseArgs(['--output']), /Unsupported/);
  assert.throws(() => parseArgs(['--unknown=value']), /Unsupported/);
  assert.throws(
    () => parseArgs(['--output=/tmp/one.json', '--output=/tmp/two.json']),
    /Duplicate/,
  );
  assert.throws(() => parseArgs(['--apply', '--rollback']), /either --apply or --rollback/);
});

test('attachment CLI preserves apply and rollback forwarding plus stdout', async () => {
  for (const mode of ['apply', 'rollback']) {
    let received;
    let stdout = '';
    let authenticated = false;
    const expected = manifest();
    const exitCode = await runAttachmentCli({
      argv: [`--${mode}`],
      async migrate(options) {
        received = options;
        return expected;
      },
      sequelize: {
        async authenticate() {
          authenticated = true;
        },
      },
      stdout: {
        write(value) {
          stdout += value;
        },
      },
    });
    assert.equal(authenticated, true);
    assert.deepEqual(received, {
      apply: mode === 'apply',
      rollback: mode === 'rollback',
    });
    assert.equal(exitCode, 0);
    assert.deepEqual(JSON.parse(stdout), expected);
  }
});
