'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { isTenantFilesWorkersEnabled } = require('../tenant-context/capabilities');
const {
  requireDefaultTenantContext,
  resolveTrustedTenantAttribution,
  tenantMatches,
} = require('../files-workers/tenant-context');
const {
  atomicWriteStorageObject,
  buildTenantStorageKey,
  deleteStorageObject,
  resolveExistingStoragePath,
} = require('../storage/tenant-storage');

const LEGACY_UPLOAD_ROOT = path.resolve(__dirname, '../../var/shift-cash-attachments');
const UPLOAD_ROOT = LEGACY_UPLOAD_ROOT;
const ATTACHMENT_STORAGE_DOMAIN = 'shift-cash-attachments';
const ATTACHMENT_STORAGE_SCHEMA_VERSION = 1;
const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
const MAX_ATTACHMENTS_PER_EXPENSE = 10;
const IMAGE_MIME_EXTENSIONS = new Map([
  ['image/heic', 'heic'],
  ['image/heif', 'heif'],
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
  ['image/gif', 'gif'],
]);

function makeError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function normalizeString(value) {
  return String(value ?? '').trim();
}

function parseDataUrl(data, mimeType) {
  const value = normalizeString(data);
  const match = value.match(/^data:([^;]+);base64,(.+)$/);
  const resolvedMimeType = match?.[1] || normalizeString(mimeType).toLowerCase();
  const buffer = Buffer.from(match?.[2] || value, 'base64');
  if (!buffer.length) throw makeError('Фото не содержит данных');
  return { buffer, mimeType: resolvedMimeType };
}

function normalizeExpenseId(expenseId, attachment = null) {
  const legacyExpenseId = normalizeString(attachment?.relativePath).split(/[\\/]/)[0];
  const id = Number(expenseId ?? attachment?.record?.expenseId ?? legacyExpenseId);
  if (!Number.isInteger(id) || id <= 0) throw makeError('Фото не найдено', 404);
  return id;
}

function hasTenantAttachmentMetadata(attachment) {
  return [
    'storageSchemaVersion',
    'storageKey',
    'organizationId',
    'clubId',
    'domain',
    'record',
    'checksumSha256',
  ].some((key) => attachment?.[key] !== undefined && attachment?.[key] !== null);
}

function assertTenantAttachmentMetadata(attachment, expenseId, tenant) {
  const normalizedExpenseId = normalizeExpenseId(expenseId, attachment);
  const record = attachment?.record || {};
  let expectedStorageKey = null;
  try {
    expectedStorageKey = buildTenantStorageKey({
      clubId: tenant?.clubId,
      domain: ATTACHMENT_STORAGE_DOMAIN,
      fileId: attachment?.id,
      organizationId: tenant?.organizationId,
      recordId: `expense:${normalizedExpenseId}`,
    });
  } catch (_error) {
    // Invalid metadata is intentionally exposed as the same safe not-found response.
  }
  const valid =
    Number(attachment?.storageSchemaVersion) === ATTACHMENT_STORAGE_SCHEMA_VERSION &&
    attachment?.domain === ATTACHMENT_STORAGE_DOMAIN &&
    attachment?.storageKey === expectedStorageKey &&
    /^[a-f0-9]{64}$/.test(String(attachment?.checksumSha256 || '')) &&
    tenantMatches(attachment, tenant) &&
    Number(record.expenseId) === normalizedExpenseId &&
    String(record.fileId || '') === String(attachment?.id || '');
  if (!valid) throw makeError('Фото не найдено', 404);
}

function assertLegacyAttachmentMetadata(attachment, expenseId) {
  if (hasTenantAttachmentMetadata(attachment)) throw makeError('Фото не найдено', 404);
  const normalizedExpenseId = normalizeExpenseId(expenseId, attachment);
  const attachmentId = normalizeString(attachment?.id);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(attachmentId)) {
    throw makeError('Фото не найдено', 404);
  }
  const extension = IMAGE_MIME_EXTENSIONS.get(attachment?.mimeType);
  const expectedPath = extension
    ? path.join(String(normalizedExpenseId), `${attachmentId}.${extension}`)
    : null;
  if (!expectedPath || attachment?.relativePath !== expectedPath) {
    throw makeError('Фото не найдено', 404);
  }
  return expectedPath;
}

async function resolveLegacyAttachmentPath(attachment, expenseId, tenant) {
  await requireDefaultTenantContext(tenant);
  const relativePath = assertLegacyAttachmentMetadata(attachment, expenseId);
  const candidate = path.resolve(LEGACY_UPLOAD_ROOT, relativePath);
  const lexicalRelative = path.relative(LEGACY_UPLOAD_ROOT, candidate);
  if (lexicalRelative.startsWith('..') || path.isAbsolute(lexicalRelative)) {
    throw makeError('Фото не найдено', 404);
  }

  try {
    const rootRealPath = await fs.promises.realpath(LEGACY_UPLOAD_ROOT);
    let current = LEGACY_UPLOAD_ROOT;
    for (const component of relativePath.split(path.sep)) {
      current = path.join(current, component);
      const stat = await fs.promises.lstat(current);
      const isLast = current === candidate;
      if (stat.isSymbolicLink() || (isLast ? !stat.isFile() : !stat.isDirectory())) {
        throw makeError('Фото не найдено', 404);
      }
    }
    const candidateRealPath = await fs.promises.realpath(candidate);
    const realRelative = path.relative(rootRealPath, candidateRealPath);
    if (realRelative.startsWith('..') || path.isAbsolute(realRelative)) {
      throw makeError('Фото не найдено', 404);
    }
    return candidateRealPath;
  } catch (error) {
    if (error.code === 'ENOENT') throw makeError('Фото не найдено', 404);
    throw error;
  }
}

async function storeAttachment(expenseId, payload, account, requestTenant = null) {
  const normalizedExpenseId = normalizeExpenseId(expenseId);
  const parsed = parseDataUrl(payload.data, payload.mimeType);
  if (!IMAGE_MIME_EXTENSIONS.has(parsed.mimeType)) {
    throw makeError('Можно прикреплять только JPEG, PNG, WEBP, GIF или HEIC');
  }
  if (parsed.buffer.length > MAX_ATTACHMENT_BYTES) {
    throw makeError('Фото должно быть не больше 5 МБ');
  }

  const id = crypto.randomUUID();
  const extension = IMAGE_MIME_EXTENSIONS.get(parsed.mimeType);
  const commonMetadata = {
    id,
    mimeType: parsed.mimeType,
    originalName: normalizeString(payload.fileName) || `receipt.${extension}`,
    uploadedAt: new Date().toISOString(),
    uploadedByAccountId: account?.id || null,
  };

  if (isTenantFilesWorkersEnabled()) {
    const tenant = await requireDefaultTenantContext(requestTenant);
    const storageKey = buildTenantStorageKey({
      clubId: tenant.clubId,
      domain: ATTACHMENT_STORAGE_DOMAIN,
      fileId: id,
      organizationId: tenant.organizationId,
      recordId: `expense:${normalizedExpenseId}`,
    });
    const stored = await atomicWriteStorageObject({ storageKey, buffer: parsed.buffer });
    return {
      ...commonMetadata,
      checksumSha256: stored.checksumSha256,
      clubId: tenant.clubId,
      domain: ATTACHMENT_STORAGE_DOMAIN,
      organizationId: tenant.organizationId,
      record: { expenseId: normalizedExpenseId, fileId: id },
      size: stored.size,
      storageKey: stored.storageKey,
      storageSchemaVersion: ATTACHMENT_STORAGE_SCHEMA_VERSION,
    };
  }

  const relativePath = path.join(String(normalizedExpenseId), `${id}.${extension}`);
  const absolutePath = path.join(LEGACY_UPLOAD_ROOT, relativePath);
  await fs.promises.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.promises.writeFile(absolutePath, parsed.buffer);
  return { ...commonMetadata, relativePath, size: parsed.buffer.length };
}

async function resolveAttachmentPath(attachment, expenseId, requestTenant = null) {
  const tenant = await resolveTrustedTenantAttribution(requestTenant);
  if (hasTenantAttachmentMetadata(attachment)) {
    assertTenantAttachmentMetadata(attachment, expenseId, tenant);
    try {
      return await resolveExistingStoragePath({ storageKey: attachment.storageKey });
    } catch (error) {
      if (error.code === 'ENOENT') throw makeError('Фото не найдено', 404);
      throw error;
    }
  }
  return resolveLegacyAttachmentPath(attachment, expenseId, tenant);
}

async function deleteAttachmentFile(attachment, expenseId = null, requestTenant = null) {
  if (!attachment) return false;
  const tenant = await resolveTrustedTenantAttribution(requestTenant);
  if (hasTenantAttachmentMetadata(attachment)) {
    assertTenantAttachmentMetadata(attachment, expenseId, tenant);
    return deleteStorageObject({ storageKey: attachment.storageKey });
  }
  const absolutePath = await resolveLegacyAttachmentPath(attachment, expenseId, tenant);
  await fs.promises.unlink(absolutePath);
  return true;
}

async function deleteAttachmentFiles(attachments = [], requestTenant = null) {
  await Promise.all(
    attachments.map((attachment) =>
      deleteAttachmentFile(attachment, null, requestTenant).catch(() => false),
    ),
  );
}

module.exports = {
  ATTACHMENT_STORAGE_DOMAIN,
  ATTACHMENT_STORAGE_SCHEMA_VERSION,
  IMAGE_MIME_EXTENSIONS,
  LEGACY_UPLOAD_ROOT,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS_PER_EXPENSE,
  UPLOAD_ROOT,
  assertLegacyAttachmentMetadata,
  assertTenantAttachmentMetadata,
  deleteAttachmentFile,
  deleteAttachmentFiles,
  hasTenantAttachmentMetadata,
  resolveAttachmentPath,
  resolveLegacyAttachmentPath,
  storeAttachment,
};
