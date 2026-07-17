'use strict';

const fs = require('node:fs');
const path = require('node:path');

const repositoryRoot = path.resolve(__dirname, '../..');
const runtimeRoots = [
  path.join(repositoryRoot, 'server/src'),
  path.join(repositoryRoot, 'workers/transcription-worker/src'),
  path.join(repositoryRoot, 'workers/transcription-worker/server'),
];
const FILE_IO_PATTERN = /(writeFile|createWriteStream|sendFile|unlink\s*\(|\.rm\s*\(|mkdtemp|tempfile\.mkdtemp|sqlite3\.connect|readFile\s*\()/;
const ALLOWED_FILE_IO = Object.freeze({
  'server/src/controllers/shift-cash.controller.js': 'club: authorized shift cash attachment download',
  'server/src/controllers/shift-reports.controller.js': 'club: authorized attachment download',
  'server/src/files-workers/shift-attachment-migration.js': 'club: controlled legacy dual-read/backfill manifest',
  'server/src/services/shift-cash-attachments.js': 'club: tenant storage with controlled default-tenant legacy read',
  'server/src/services/shift-reports.service.js': 'club: tenant storage plus flag-off/default legacy compatibility',
  'server/src/storage/tenant-storage.js': 'club/organization: canonical atomic tenant storage primitive',
  'workers/transcription-worker/server/pipeline.py': 'ephemeral: tenant/job/attempt audio namespace',
  'workers/transcription-worker/server/sample.py': 'ephemeral: explicit local sample command',
  'workers/transcription-worker/server/store.py': 'platform local state: partitioned by opaque tenant/job/attempt',
  'workers/transcription-worker/src/asr-http.js': 'ephemeral: reads only the active attempt audio chunk',
  'workers/transcription-worker/src/audio.js': 'ephemeral: writes only caller-provided active attempt target',
  'workers/transcription-worker/src/glossary.js': 'global configuration: read-only checked-in glossary',
  'workers/transcription-worker/src/index.js': 'ephemeral: tenant/job/attempt temp lifecycle and explicit sample command',
});

function relative(filePath) {
  return path.relative(repositoryRoot, filePath).split(path.sep).join('/');
}

function walk(directory, output = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === '__pycache__' || entry.name === 'tests') continue;
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(entryPath, output);
    else if (/\.(?:js|ts|py)$/.test(entry.name)) output.push(entryPath);
  }
  return output;
}

function assertContains(file, patterns, findings) {
  const contents = fs.readFileSync(path.join(repositoryRoot, file), 'utf8');
  for (const pattern of patterns) {
    if (!contents.includes(pattern)) findings.push(`${file}: missing ${pattern}`);
  }
}

function runAudit() {
  const findings = [];
  const observedFileIo = [];
  for (const filePath of runtimeRoots.flatMap((root) => walk(root))) {
    const contents = fs.readFileSync(filePath, 'utf8');
    if (!FILE_IO_PATTERN.test(contents)) continue;
    const file = relative(filePath);
    observedFileIo.push(file);
    if (!ALLOWED_FILE_IO[file]) findings.push(`${file}: unclassified runtime file I/O`);
  }

  for (const file of Object.keys(ALLOWED_FILE_IO)) {
    if (!observedFileIo.includes(file)) findings.push(`${file}: stale file I/O allowlist entry`);
  }

  assertContains('server/src/storage/tenant-storage.js', [
    'assertSafeStorageKey',
    'assertContained',
    'isSymbolicLink()',
    'handle.sync()',
    'fsp.link',
    'fsp.unlink',
  ], findings);
  assertContains('server/src/services/shift-reports.service.js', [
    'requireDefaultTenantContext(requestTenant)',
    'assertTenantAttachmentMetadata',
    'resolveLegacyAttachmentPath',
    'buildTenantStorageKey',
  ], findings);
  assertContains('server/src/services/shift-cash-attachments.js', [
    'requireDefaultTenantContext(requestTenant)',
    'assertTenantAttachmentMetadata',
    'resolveLegacyAttachmentPath',
    'buildTenantStorageKey',
    'atomicWriteStorageObject',
  ], findings);
  assertContains('server/src/services/telephony.service.js', [
    'assertActiveLease',
    'buildWorkerClaimResponse',
    'claimWorkerCredentialId',
    'workerProtocolVersion',
    'tenantRoutingMetadata',
  ], findings);
  assertContains('server/src/middleware/transcription-worker.js', [
    'WORKER_PROTOCOL_UPGRADE_REQUIRED',
    "scope: 'platform'",
    'credentialId: getWorkerCredentialId()',
  ], findings);
  assertContains('server/src/files-workers/background-run-context.js', [
    "classification: 'tenant-routed'",
    'isTenantClientBasesCallTasksEnabled()',
  ], findings);
  assertContains('workers/transcription-worker/src/crm-client.js', [
    "'X-Worker-Protocol-Version': '2'",
    'claimToken',
  ], findings);
  assertContains('workers/transcription-worker/server/crm.py', [
    '"X-Worker-Protocol-Version": "2"',
    'claimToken',
  ], findings);

  return {
    findings,
    inventory: observedFileIo.sort().map((file) => ({
      classification: ALLOWED_FILE_IO[file] || 'unclassified',
      file,
    })),
    ok: findings.length === 0,
  };
}

if (require.main === module) {
  const result = runAudit();
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

module.exports = { ALLOWED_FILE_IO, runAudit };
