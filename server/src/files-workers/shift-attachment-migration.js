'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const db = require('../../models');
const {
  ATTACHMENT_STORAGE_DOMAIN,
  ATTACHMENT_STORAGE_SCHEMA_VERSION,
  LEGACY_UPLOAD_ROOT,
  assertLegacyAttachmentMetadata,
  assertTenantAttachmentMetadata,
  hasTenantAttachmentMetadata,
} = require('../services/shift-reports.service');
const {
  getExactDefaultTenant,
} = require('./tenant-context');
const {
  TenantStorageError,
  atomicWriteStorageObject,
  buildTenantStorageKey,
  checksumBuffer,
  normalizeStorageRoot,
  resolveExistingStoragePath,
} = require('../storage/tenant-storage');

const MANIFEST_SCHEMA = 'setly.shift-report-attachments';
const MANIFEST_VERSION = 1;

function readAttachments(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function readFileChecksum(filePath) {
  const buffer = await fs.readFile(filePath);
  return { buffer, checksumSha256: checksumBuffer(buffer), size: buffer.length };
}

async function atomicWriteOrVerify({ storageKey, buffer, storageRoot }) {
  try {
    return await atomicWriteStorageObject({ storageKey, buffer, storageRoot });
  } catch (error) {
    if (!(error instanceof TenantStorageError) || error.code !== 'TENANT_STORAGE_CONFLICT') {
      throw error;
    }
    const existingPath = await resolveExistingStoragePath({ storageKey, storageRoot });
    const existing = await readFileChecksum(existingPath);
    const expectedChecksum = checksumBuffer(buffer);
    if (existing.checksumSha256 !== expectedChecksum) {
      throw new TenantStorageError(
        'Existing storage object checksum does not match legacy source',
        'TENANT_STORAGE_CHECKSUM_MISMATCH',
        409,
      );
    }
    return { ...existing, storageKey };
  }
}

async function listRegularFiles(rootPath) {
  const files = [];
  async function visit(directory) {
    let entries;
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error.code === 'ENOENT') return;
      throw error;
    }
    for (const entry of entries) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) await visit(entryPath);
      if (entry.isFile() && !entry.name.startsWith('.tmp-')) files.push(entryPath);
    }
  }
  await visit(rootPath);
  return files;
}

function newAttachmentMetadata(attachment, answer, tenant, stored) {
  return {
    checksumSha256: stored.checksumSha256,
    clubId: tenant.clubId,
    domain: ATTACHMENT_STORAGE_DOMAIN,
    id: attachment.id,
    legacyRelativePath: attachment.relativePath,
    mimeType: attachment.mimeType,
    organizationId: tenant.organizationId,
    originalName: attachment.originalName,
    record: {
      answerId: Number(answer.id),
      fileId: attachment.id,
      reportId: Number(answer.reportId),
    },
    size: stored.size,
    storageKey: stored.storageKey,
    storageSchemaVersion: ATTACHMENT_STORAGE_SCHEMA_VERSION,
    uploadedAt: attachment.uploadedAt,
    uploadedByAccountId: attachment.uploadedByAccountId ?? null,
  };
}

function legacyAttachmentMetadata(attachment) {
  return {
    id: attachment.id,
    mimeType: attachment.mimeType,
    originalName: attachment.originalName,
    relativePath: attachment.legacyRelativePath,
    size: attachment.size,
    uploadedAt: attachment.uploadedAt,
    uploadedByAccountId: attachment.uploadedByAccountId ?? null,
  };
}

async function migrateShiftReportAttachments(options = {}) {
  const models = options.db || db;
  const apply = Boolean(options.apply || options.rollback);
  const rollback = Boolean(options.rollback);
  const storageRoot = normalizeStorageRoot(options.storageRoot);
  const legacyRoot = path.resolve(options.legacyRoot || LEGACY_UPLOAD_ROOT);
  const tenant = options.tenant || await getExactDefaultTenant();
  const answers = await models.ShiftReportAnswer.findAll({
    attributes: ['id', 'reportId', 'attachments'],
    order: [['id', 'ASC']],
  });
  const referencedLegacyPaths = new Set();
  const referencedStoragePaths = new Set();
  const entries = [];
  const counts = {
    alreadyMigrated: 0,
    checksumMismatch: 0,
    copied: 0,
    dbRowsChanged: 0,
    eligibleLegacy: 0,
    invalidMetadata: 0,
    missingLegacy: 0,
    missingStorage: 0,
    rolledBack: 0,
    totalAttachments: 0,
    totalAnswers: answers.length,
  };

  for (const answer of answers) {
    const attachments = readAttachments(answer.attachments);
    let changed = false;
    const next = [];

    for (const attachment of attachments) {
      counts.totalAttachments += 1;
      if (hasTenantAttachmentMetadata(attachment)) {
        try {
          assertTenantAttachmentMetadata(
            attachment,
            answer.reportId,
            answer.id,
            tenant,
          );
          const absolutePath = await resolveExistingStoragePath({
            storageKey: attachment.storageKey,
            storageRoot,
          });
          const stored = await readFileChecksum(absolutePath);
          if (stored.checksumSha256 !== attachment.checksumSha256) {
            counts.checksumMismatch += 1;
          } else {
            counts.alreadyMigrated += 1;
          }

          if (attachment.legacyRelativePath) {
            const legacyRelativePath = assertLegacyAttachmentMetadata(
              {
                id: attachment.id,
                mimeType: attachment.mimeType,
                relativePath: attachment.legacyRelativePath,
              },
              answer.reportId,
            );
            const legacyPath = path.resolve(legacyRoot, legacyRelativePath);
            referencedLegacyPaths.add(legacyPath);
            if (rollback) {
              try {
                const legacy = await readFileChecksum(legacyPath);
                if (legacy.checksumSha256 !== attachment.checksumSha256) {
                  counts.checksumMismatch += 1;
                  next.push(attachment);
                  continue;
                }
                next.push(legacyAttachmentMetadata(attachment));
                counts.rolledBack += 1;
                changed = true;
                continue;
              } catch (error) {
                if (error.code === 'ENOENT') counts.missingLegacy += 1;
                else throw error;
              }
            }
          }
          referencedStoragePaths.add(absolutePath);
          entries.push({
            checksumSha256: attachment.checksumSha256,
            fileId: attachment.id,
            size: attachment.size,
            storageKey: attachment.storageKey,
          });
          next.push(attachment);
        } catch (error) {
          if (error.code === 'ENOENT') counts.missingStorage += 1;
          else counts.invalidMetadata += 1;
          next.push(attachment);
        }
        continue;
      }

      let relativePath;
      try {
        relativePath = assertLegacyAttachmentMetadata(attachment, answer.reportId);
      } catch (_error) {
        counts.invalidMetadata += 1;
        next.push(attachment);
        continue;
      }
      counts.eligibleLegacy += 1;
      const legacyPath = path.resolve(legacyRoot, relativePath);
      referencedLegacyPaths.add(legacyPath);
      let legacy;
      try {
        legacy = await readFileChecksum(legacyPath);
      } catch (error) {
        if (error.code === 'ENOENT') {
          counts.missingLegacy += 1;
          next.push(attachment);
          continue;
        }
        throw error;
      }
      const storageKey = buildTenantStorageKey({
        clubId: tenant.clubId,
        domain: ATTACHMENT_STORAGE_DOMAIN,
        fileId: attachment.id,
        organizationId: tenant.organizationId,
        recordId: `report:${answer.reportId}:answer:${answer.id}`,
      });
      entries.push({
        checksumSha256: legacy.checksumSha256,
        fileId: attachment.id,
        size: legacy.size,
        storageKey,
      });
      if (!apply || rollback) {
        next.push(attachment);
        continue;
      }

      const stored = await atomicWriteOrVerify({
        buffer: legacy.buffer,
        storageKey,
        storageRoot,
      });
      const storagePath = await resolveExistingStoragePath({ storageKey, storageRoot });
      referencedStoragePaths.add(storagePath);
      next.push(newAttachmentMetadata(attachment, answer, tenant, stored));
      counts.copied += 1;
      changed = true;
    }

    if (apply && changed) {
      await answer.update({ attachments: next });
      counts.dbRowsChanged += 1;
    }
  }

  const [legacyFiles, storageFiles] = await Promise.all([
    listRegularFiles(legacyRoot),
    listRegularFiles(storageRoot),
  ]);
  const legacyOrphans = legacyFiles.filter((file) => !referencedLegacyPaths.has(file));
  const storageOrphans = storageFiles.filter((file) => !referencedStoragePaths.has(file));

  return {
    schema: MANIFEST_SCHEMA,
    version: MANIFEST_VERSION,
    generatedAt: (options.now || new Date()).toISOString(),
    mode: rollback ? 'rollback' : apply ? 'apply' : 'dry-run',
    storageRoot,
    legacyRoot,
    tenants: [
      {
        organizationId: tenant.organizationId,
        clubId: tenant.clubId,
        domains: {
          [ATTACHMENT_STORAGE_DOMAIN]: {
            fileCount: entries.length,
            totalBytes: entries.reduce((sum, entry) => sum + Number(entry.size || 0), 0),
            checksumSha256: checksumBuffer(
              Buffer.from(entries.map((entry) => entry.checksumSha256).sort().join('\n')),
            ),
          },
        },
      },
    ],
    counts: {
      ...counts,
      legacyFiles: legacyFiles.length,
      legacyOrphans: legacyOrphans.length,
      storageFiles: storageFiles.length,
      storageOrphans: storageOrphans.length,
    },
    files: entries,
    orphans: {
      legacy: await Promise.all(legacyOrphans.map(async (file) => {
        const value = await readFileChecksum(file);
        return {
          checksumSha256: value.checksumSha256,
          pathHash: checksumBuffer(Buffer.from(path.relative(legacyRoot, file))),
          size: value.size,
        };
      })),
      storage: await Promise.all(storageOrphans.map(async (file) => {
        const value = await readFileChecksum(file);
        return {
          checksumSha256: value.checksumSha256,
          pathHash: checksumBuffer(Buffer.from(path.relative(storageRoot, file))),
          size: value.size,
        };
      })),
    },
  };
}

module.exports = {
  MANIFEST_SCHEMA,
  MANIFEST_VERSION,
  migrateShiftReportAttachments,
};
