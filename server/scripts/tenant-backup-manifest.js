#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const db = require('../models');

const MANIFEST_SCHEMA = 'setly.installation-backup';
const REQUIRED_LABELS = Object.freeze([
  'database',
  'tenant-storage',
  'legacy-shift-reports',
  'legacy-shift-cash',
  'attachment-orphan-detector',
]);
const EMPTY_DIRECTORY_LABELS = Object.freeze([
  'tenant-storage',
  'legacy-shift-reports',
  'legacy-shift-cash',
]);
const SAFE_DETECTOR_COUNTS = Object.freeze([
  'checksumMismatch',
  'invalidMetadata',
  'missingLegacy',
  'missingStorage',
  'legacyOrphans',
  'storageOrphans',
]);
const WORKER_STATE_POLICY = Object.freeze({
  authoritativeSource: 'database-transcription-jobs',
  localStateIncluded: false,
  policy: 'rebuild-local-worker-state-after-restore; do-not-replay-stale-claims',
});
const BACKUP_MANIFEST_CLI_OPTIONS = Object.freeze([
  'attachment-manifest',
  'db-dump',
  'expect-empty',
  'legacy-shift-cash-root',
  'legacy-shift-report-root',
  'manifest',
  'output',
  'storage-root',
  'verify',
]);
const BACKUP_MANIFEST_CLI_OPTION_SET = new Set(BACKUP_MANIFEST_CLI_OPTIONS);

function parseArgs(argv) {
  const options = {};
  for (const value of argv) {
    if (!value.startsWith('--')) throw new Error(`Unsupported backup argument: ${value}`);
    const [key, ...rest] = value.replace(/^--/, '').split('=');
    if (!BACKUP_MANIFEST_CLI_OPTION_SET.has(key)) {
      throw new Error(`Unsupported backup argument: --${key}`);
    }
    if (Object.prototype.hasOwnProperty.call(options, key)) {
      throw new Error(`Duplicate backup argument: --${key}`);
    }
    options[key] = rest.join('=') || true;
  }
  return options;
}

function hashFile(filePath) {
  const hash = crypto.createHash('sha256');
  const descriptor = fs.openSync(filePath, 'r');
  const buffer = Buffer.alloc(1024 * 1024);
  try {
    let bytes;
    do {
      bytes = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (bytes) hash.update(buffer.subarray(0, bytes));
    } while (bytes);
  } finally {
    fs.closeSync(descriptor);
  }
  return hash.digest('hex');
}

function inventoryPath(root, label, { required = false } = {}) {
  const absoluteRoot = path.resolve(root);
  if (!fs.existsSync(absoluteRoot)) {
    if (required) throw new Error(`Required backup path is missing: ${absoluteRoot}`);
    return { exists: false, files: [], label, root: absoluteRoot, totalBytes: 0 };
  }
  const rootStat = fs.lstatSync(absoluteRoot);
  if (rootStat.isSymbolicLink() || (!rootStat.isDirectory() && !rootStat.isFile())) {
    throw new Error(`Backup path must be a regular file or real directory: ${absoluteRoot}`);
  }
  const files = [];
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name);
      const stat = fs.lstatSync(fullPath);
      if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) {
        throw new Error(`Backup inventory contains symlink or special file: ${fullPath}`);
      }
      if (stat.isDirectory()) walk(fullPath);
      else {
        files.push({
          bytes: stat.size,
          path: path.relative(absoluteRoot, fullPath),
          sha256: hashFile(fullPath),
        });
      }
    }
  };
  if (rootStat.isDirectory()) walk(absoluteRoot);
  else {
    files.push({
      bytes: rootStat.size,
      path: path.basename(absoluteRoot),
      sha256: hashFile(absoluteRoot),
    });
  }
  files.sort((left, right) => left.path.localeCompare(right.path));
  if (required && files.length === 0) {
    throw new Error(`Required backup inventory is empty: ${absoluteRoot}`);
  }
  return {
    exists: true,
    files,
    label,
    root: absoluteRoot,
    totalBytes: files.reduce((sum, file) => sum + file.bytes, 0),
  };
}

function parseExpectedEmptyLabels(value) {
  if (!value) return new Set();
  const labels = String(value)
    .split(',')
    .map((label) => label.trim())
    .filter(Boolean);
  if (
    new Set(labels).size !== labels.length ||
    labels.some((label) => !EMPTY_DIRECTORY_LABELS.includes(label))
  ) {
    throw new Error(
      `--expect-empty accepts unique directory labels: ${EMPTY_DIRECTORY_LABELS.join(', ')}`,
    );
  }
  return new Set(labels);
}

function inventoryManifestArtifact(root, label, expectedEmptyLabels) {
  const expectedEmpty = expectedEmptyLabels.has(label);
  const artifact = inventoryPath(root, label, { required: !expectedEmpty });
  if (expectedEmpty) {
    if (!artifact.exists || artifact.files.length !== 0 || artifact.totalBytes !== 0) {
      throw new Error(`Expected-empty backup root is missing or non-empty: ${label}`);
    }
    if (!fs.lstatSync(path.resolve(root)).isDirectory()) {
      throw new Error(`Expected-empty backup root must be a directory: ${label}`);
    }
  }
  return { ...artifact, expectedEmpty };
}

function validateAttachmentDetector(filePath) {
  let detector;
  try {
    detector = JSON.parse(fs.readFileSync(path.resolve(filePath), 'utf8'));
  } catch {
    throw new Error('Attachment orphan detector is missing, truncated or invalid JSON');
  }
  if (
    detector?.schema !== 'setly.shift-report-attachments' ||
    detector?.version !== 1 ||
    !detector.counts || typeof detector.counts !== 'object' ||
    !detector.orphans || !Array.isArray(detector.orphans.legacy) ||
    !Array.isArray(detector.orphans.storage)
  ) {
    throw new Error('Attachment orphan detector schema is invalid');
  }
  for (const name of SAFE_DETECTOR_COUNTS) {
    if (!Number.isSafeInteger(Number(detector.counts[name])) || Number(detector.counts[name]) !== 0) {
      throw new Error(`Attachment orphan detector is unsafe: ${name}`);
    }
  }
  if (detector.orphans.legacy.length || detector.orphans.storage.length) {
    throw new Error('Attachment orphan detector contains orphan results');
  }
  return {
    counts: Object.fromEntries(SAFE_DETECTOR_COUNTS.map((name) => [name, 0])),
    schema: detector.schema,
    version: detector.version,
  };
}

function validateArtifactShape(artifact) {
  if (!artifact || artifact.exists !== true || typeof artifact.root !== 'string' ||
    !path.isAbsolute(artifact.root) || !Array.isArray(artifact.files) ||
    (artifact.expectedEmpty !== undefined &&
      typeof artifact.expectedEmpty !== 'boolean') ||
    !Number.isSafeInteger(artifact.totalBytes) ||
    artifact.totalBytes < 0) {
    throw new Error(`Backup artifact shape is invalid: ${artifact?.label || 'unknown'}`);
  }
  const expectedEmpty = artifact.expectedEmpty === true;
  if (
    (expectedEmpty && !EMPTY_DIRECTORY_LABELS.includes(artifact.label)) ||
    (expectedEmpty && (artifact.files.length !== 0 || artifact.totalBytes !== 0)) ||
    (!expectedEmpty && artifact.files.length === 0)
  ) {
    throw new Error(`Backup artifact empty-state is invalid: ${artifact.label}`);
  }
  const paths = new Set();
  let totalBytes = 0;
  for (const file of artifact.files) {
    if (!file || typeof file.path !== 'string' || !file.path || path.isAbsolute(file.path) ||
      file.path.split(/[\\/]/).some((part) => !part || part === '.' || part === '..') ||
      !Number.isSafeInteger(file.bytes) || file.bytes < 0 ||
      !/^[a-f0-9]{64}$/.test(file.sha256) || paths.has(file.path)) {
      throw new Error(`Backup artifact file inventory is invalid: ${artifact.label}`);
    }
    paths.add(file.path);
    totalBytes += file.bytes;
  }
  if (totalBytes !== artifact.totalBytes) {
    throw new Error(`Backup artifact byte total is invalid: ${artifact.label}`);
  }
}

function validateManifestSchema(manifest) {
  if (!manifest || manifest.schema !== MANIFEST_SCHEMA || manifest.schemaVersion !== 1 ||
    manifest.restoreMode !== 'installation-wide-only' ||
    manifest.tenantSelectiveRestore !==
      'unsupported-without-complete-pk-fk-file-remap-contract' ||
    !sameJson(manifest.workerState, WORKER_STATE_POLICY) ||
    !Array.isArray(manifest.artifacts) || !Array.isArray(manifest.integrationConnections)) {
    throw new Error('Unsupported, incomplete or tenant-selective backup manifest');
  }
  const labels = manifest.artifacts.map((artifact) => artifact?.label);
  if (labels.length !== REQUIRED_LABELS.length || new Set(labels).size !== labels.length ||
    REQUIRED_LABELS.some((label) => !labels.includes(label)) ||
    labels.some((label) => !REQUIRED_LABELS.includes(label))) {
    throw new Error('Backup manifest artifact labels are missing, duplicate or unknown');
  }
  manifest.artifacts.forEach(validateArtifactShape);
  if (!manifest.attachmentDetector || manifest.attachmentDetector.schema !==
    'setly.shift-report-attachments' || manifest.attachmentDetector.version !== 1 ||
    SAFE_DETECTOR_COUNTS.some((name) => manifest.attachmentDetector.counts?.[name] !== 0)) {
    throw new Error('Backup manifest attachment detector summary is invalid');
  }
  return manifest;
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function integrationMetadata() {
  const rows = await db.IntegrationConnection.unscoped().findAll({
    attributes: [
      'id', 'organizationId', 'clubId', 'provider', 'purpose',
      'connectionKey', 'status', 'createdAt', 'updatedAt',
    ],
    order: [['id', 'ASC']],
    raw: true,
  });
  return rows.map((row) => ({
    ...row,
    createdAt: row.createdAt?.toISOString?.() || row.createdAt,
    updatedAt: row.updatedAt?.toISOString?.() || row.updatedAt,
  }));
}

function compareInventory(expected, actual) {
  const expectedFiles = new Map(expected.files.map((file) => [file.path, file]));
  const actualFiles = new Map(actual.files.map((file) => [file.path, file]));
  const missing = [];
  const mismatched = [];
  const orphaned = [];
  for (const [filePath, file] of expectedFiles) {
    const current = actualFiles.get(filePath);
    if (!current) missing.push(filePath);
    else if (current.bytes !== file.bytes || current.sha256 !== file.sha256) mismatched.push(filePath);
  }
  for (const filePath of actualFiles.keys()) {
    if (!expectedFiles.has(filePath)) orphaned.push(filePath);
  }
  return { label: expected.label, mismatched, missing, orphaned };
}

async function createManifest(options) {
  if (!options.output || !options['db-dump'] || !options['storage-root'] ||
    !options['legacy-shift-report-root'] || !options['legacy-shift-cash-root'] ||
    !options['attachment-manifest']) {
    throw new Error('Complete backup requires output, DB, tenant storage, both legacy roots and attachment detector');
  }
  const attachmentDetector = validateAttachmentDetector(options['attachment-manifest']);
  const expectedEmptyLabels = parseExpectedEmptyLabels(options['expect-empty']);
  const artifacts = [
    inventoryManifestArtifact(options['db-dump'], 'database', expectedEmptyLabels),
    inventoryManifestArtifact(options['storage-root'], 'tenant-storage', expectedEmptyLabels),
    inventoryManifestArtifact(
      options['legacy-shift-report-root'],
      'legacy-shift-reports',
      expectedEmptyLabels,
    ),
    inventoryManifestArtifact(
      options['legacy-shift-cash-root'],
      'legacy-shift-cash',
      expectedEmptyLabels,
    ),
    inventoryManifestArtifact(
      options['attachment-manifest'],
      'attachment-orphan-detector',
      expectedEmptyLabels,
    ),
  ];
  const manifest = {
    artifacts,
    attachmentDetector,
    generatedAt: new Date().toISOString(),
    integrationConnections: await integrationMetadata(),
    restoreMode: 'installation-wide-only',
    schema: MANIFEST_SCHEMA,
    schemaVersion: 1,
    tenantSelectiveRestore: 'unsupported-without-complete-pk-fk-file-remap-contract',
    workerState: WORKER_STATE_POLICY,
  };
  validateManifestSchema(manifest);
  fs.writeFileSync(path.resolve(options.output), `${JSON.stringify(manifest, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
  });
  return manifest;
}

function verifyManifest(options) {
  if (!options.manifest) throw new Error('Usage: --verify --manifest=...');
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(path.resolve(options.manifest), 'utf8'));
  } catch {
    throw new Error('Backup manifest is missing, truncated or invalid JSON');
  }
  validateManifestSchema(manifest);
  const overrideByLabel = {
    'attachment-orphan-detector': options['attachment-manifest'],
    database: options['db-dump'],
    'legacy-shift-cash': options['legacy-shift-cash-root'],
    'legacy-shift-reports': options['legacy-shift-report-root'],
    'tenant-storage': options['storage-root'],
  };
  const results = manifest.artifacts.map((artifact) => {
    const verificationRoot = overrideByLabel[artifact.label] || artifact.root;
    const current = inventoryPath(verificationRoot, artifact.label, {
      required: !artifact.expectedEmpty,
    });
    if (!current.exists) {
      throw new Error(`Expected-empty backup root is missing: ${artifact.label}`);
    }
    return compareInventory(
      artifact,
      current,
    );
  });
  const detectorArtifact = manifest.artifacts.find(
    (artifact) => artifact.label === 'attachment-orphan-detector',
  );
  validateAttachmentDetector(
    overrideByLabel['attachment-orphan-detector'] || detectorArtifact.root,
  );
  const failed = results.some((result) =>
    result.missing.length || result.mismatched.length || result.orphaned.length);
  if (failed) {
    const error = new Error('Backup manifest verification found missing, mismatched or orphaned files');
    error.results = results;
    throw error;
  }
  return { ok: true, results };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const result = options.verify
    ? verifyManifest(options)
    : await createManifest(options);
  console.log(JSON.stringify(result, null, 2));
}

if (require.main === module) {
  main()
    .catch((error) => {
      console.error(JSON.stringify({ error: error.message, results: error.results || null }, null, 2));
      process.exitCode = 1;
    })
    .finally(() => db.sequelize.close());
}

module.exports = {
  BACKUP_MANIFEST_CLI_OPTIONS,
  EMPTY_DIRECTORY_LABELS,
  MANIFEST_SCHEMA,
  REQUIRED_LABELS,
  WORKER_STATE_POLICY,
  compareInventory,
  createManifest,
  inventoryManifestArtifact,
  inventoryPath,
  parseArgs,
  parseExpectedEmptyLabels,
  validateAttachmentDetector,
  validateManifestSchema,
  verifyManifest,
};
