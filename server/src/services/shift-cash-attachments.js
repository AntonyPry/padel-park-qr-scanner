'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const UPLOAD_ROOT = path.resolve(__dirname, '../../var/shift-cash-attachments');
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

function resolveAbsolutePath(relativePath) {
  const absolutePath = path.resolve(UPLOAD_ROOT, normalizeString(relativePath));
  const relative = path.relative(UPLOAD_ROOT, absolutePath);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw makeError('Некорректный путь вложения', 400);
  }
  return absolutePath;
}

async function storeAttachment(expenseId, payload, account) {
  const parsed = parseDataUrl(payload.data, payload.mimeType);
  if (!IMAGE_MIME_EXTENSIONS.has(parsed.mimeType)) {
    throw makeError('Можно прикреплять только JPEG, PNG, WEBP, GIF или HEIC');
  }
  if (parsed.buffer.length > MAX_ATTACHMENT_BYTES) {
    throw makeError('Фото должно быть не больше 5 МБ');
  }

  const id = crypto.randomUUID();
  const extension = IMAGE_MIME_EXTENSIONS.get(parsed.mimeType);
  const relativePath = path.join(String(expenseId), `${id}.${extension}`);
  const absolutePath = resolveAbsolutePath(relativePath);
  await fs.promises.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.promises.writeFile(absolutePath, parsed.buffer);

  return {
    id,
    mimeType: parsed.mimeType,
    originalName: normalizeString(payload.fileName) || `receipt.${extension}`,
    relativePath,
    size: parsed.buffer.length,
    uploadedAt: new Date().toISOString(),
    uploadedByAccountId: account?.id || null,
  };
}

async function deleteAttachmentFile(attachment) {
  if (!attachment?.relativePath) return;
  let absolutePath;
  try {
    absolutePath = resolveAbsolutePath(attachment.relativePath);
  } catch {
    return;
  }
  await fs.promises.unlink(absolutePath).catch(() => {});
}

async function deleteAttachmentFiles(attachments = []) {
  await Promise.all(attachments.map(deleteAttachmentFile));
}

module.exports = {
  IMAGE_MIME_EXTENSIONS,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS_PER_EXPENSE,
  UPLOAD_ROOT,
  deleteAttachmentFile,
  deleteAttachmentFiles,
  resolveAbsolutePath,
  storeAttachment,
};
