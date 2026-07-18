#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const db = require('../models');

function parseArgs(argv) {
  const options = {};
  for (const value of argv) {
    const [key, ...rest] = value.replace(/^--/, '').split('=');
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
  const files = [];
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(fullPath);
      else if (entry.isFile()) {
        const stat = fs.statSync(fullPath);
        files.push({
          bytes: stat.size,
          path: path.relative(absoluteRoot, fullPath),
          sha256: hashFile(fullPath),
        });
      }
    }
  };
  if (fs.statSync(absoluteRoot).isDirectory()) walk(absoluteRoot);
  else {
    const stat = fs.statSync(absoluteRoot);
    files.push({ bytes: stat.size, path: path.basename(absoluteRoot), sha256: hashFile(absoluteRoot) });
  }
  files.sort((left, right) => left.path.localeCompare(right.path));
  return {
    exists: true,
    files,
    label,
    root: absoluteRoot,
    totalBytes: files.reduce((sum, file) => sum + file.bytes, 0),
  };
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
  if (!options.output || !options['db-dump'] || !options['storage-root']) {
    throw new Error('Usage: --output=... --db-dump=... --storage-root=... [--attachment-manifest=...]');
  }
  const artifacts = [
    inventoryPath(options['db-dump'], 'database', { required: true }),
    inventoryPath(options['storage-root'], 'tenant-storage', { required: true }),
    inventoryPath(options['legacy-shift-report-root'] || 'var/shift-report-attachments', 'legacy-shift-reports'),
    inventoryPath(options['legacy-shift-cash-root'] || 'var/shift-cash-attachments', 'legacy-shift-cash'),
  ];
  if (options['attachment-manifest']) {
    artifacts.push(inventoryPath(options['attachment-manifest'], 'attachment-orphan-detector', { required: true }));
  }
  const manifest = {
    artifacts,
    generatedAt: new Date().toISOString(),
    integrationConnections: await integrationMetadata(),
    restoreMode: 'installation-wide-only',
    schemaVersion: 1,
    tenantSelectiveRestore: 'unsupported-without-complete-pk-fk-file-remap-contract',
    workerState: {
      authoritativeSource: 'database-transcription-jobs',
      localStateIncluded: false,
      policy: 'rebuild-local-worker-state-after-restore; do-not-replay-stale-claims',
    },
  };
  fs.writeFileSync(path.resolve(options.output), `${JSON.stringify(manifest, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
  });
  return manifest;
}

function verifyManifest(options) {
  if (!options.manifest) throw new Error('Usage: --verify --manifest=...');
  const manifest = JSON.parse(fs.readFileSync(path.resolve(options.manifest), 'utf8'));
  if (manifest.schemaVersion !== 1 || manifest.restoreMode !== 'installation-wide-only') {
    throw new Error('Unsupported or tenant-selective backup manifest');
  }
  const overrideByLabel = {
    'attachment-orphan-detector': options['attachment-manifest'],
    database: options['db-dump'],
    'legacy-shift-cash': options['legacy-shift-cash-root'],
    'legacy-shift-reports': options['legacy-shift-report-root'],
    'tenant-storage': options['storage-root'],
  };
  const results = manifest.artifacts.map((artifact) => {
    const verificationRoot = overrideByLabel[artifact.label] || artifact.root;
    return compareInventory(
      artifact,
      inventoryPath(verificationRoot, artifact.label, { required: artifact.exists }),
    );
  });
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

module.exports = { compareInventory, createManifest, inventoryPath, verifyManifest };
