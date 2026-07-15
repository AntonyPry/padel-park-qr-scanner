'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

const DEFAULT_STORAGE_ROOT = path.resolve(__dirname, '../../var/tenant-storage');
const STORAGE_KEY_VERSION = 'v1';
const SAFE_COMPONENT = /^[a-z0-9][a-z0-9_-]{2,80}$/;
const SAFE_DOMAIN = /^[a-z][a-z0-9-]{1,62}[a-z0-9]$/;

class TenantStorageError extends Error {
  constructor(message, code = 'TENANT_STORAGE_INVALID', statusCode = 400) {
    super(message);
    this.name = 'TenantStorageError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

function normalizeIdentity(value, label) {
  const text = String(value ?? '').trim();
  if (!text || text.length > 160) {
    throw new TenantStorageError(`Missing or invalid ${label}`);
  }
  return text;
}

function normalizeTenantId(value, label) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    throw new TenantStorageError(`Missing or invalid ${label}`);
  }
  return id;
}

function opaqueComponent(kind, value) {
  const digest = crypto
    .createHash('sha256')
    .update(`setly-storage:${STORAGE_KEY_VERSION}:${kind}:${value}`)
    .digest('hex')
    .slice(0, 32);
  return `${kind}_${digest}`;
}

function buildTenantStorageKey({ organizationId, clubId = null, domain, recordId, fileId }) {
  const normalizedOrganizationId = normalizeTenantId(organizationId, 'organizationId');
  const normalizedClubId = clubId == null ? null : normalizeTenantId(clubId, 'clubId');
  const normalizedDomain = String(domain || '').trim().toLowerCase();
  if (!SAFE_DOMAIN.test(normalizedDomain)) {
    throw new TenantStorageError('Invalid storage domain');
  }

  const recordIdentity = normalizeIdentity(recordId, 'recordId');
  const fileIdentity = normalizeIdentity(fileId, 'fileId');
  const components = [
    opaqueComponent('org', normalizedOrganizationId),
    normalizedClubId == null
      ? opaqueComponent('orgscope', normalizedOrganizationId)
      : opaqueComponent('club', `${normalizedOrganizationId}:${normalizedClubId}`),
    normalizedDomain,
    opaqueComponent('record', `${normalizedDomain}:${recordIdentity}`),
    opaqueComponent('file', `${normalizedDomain}:${recordIdentity}:${fileIdentity}`),
  ];

  return components.join('/');
}

function normalizeStorageRoot(storageRoot = process.env.SETLY_STORAGE_ROOT) {
  return path.resolve(String(storageRoot || DEFAULT_STORAGE_ROOT));
}

function assertSafeStorageKey(storageKey) {
  const key = String(storageKey || '').trim();
  if (!key || key.includes('\\') || path.isAbsolute(key)) {
    throw new TenantStorageError('Invalid storage key');
  }

  const components = key.split('/');
  if (components.length !== 5 || components.some((part) => !part || part === '.' || part === '..')) {
    throw new TenantStorageError('Invalid storage key');
  }
  if (!SAFE_COMPONENT.test(components[0]) || !SAFE_COMPONENT.test(components[1])) {
    throw new TenantStorageError('Invalid tenant storage namespace');
  }
  if (!SAFE_DOMAIN.test(components[2])) {
    throw new TenantStorageError('Invalid storage domain');
  }
  if (!SAFE_COMPONENT.test(components[3]) || !SAFE_COMPONENT.test(components[4])) {
    throw new TenantStorageError('Invalid storage object identity');
  }

  const normalized = path.posix.normalize(key);
  if (normalized !== key) {
    throw new TenantStorageError('Invalid storage key');
  }
  return key;
}

function assertContained(rootPath, candidatePath) {
  const relative = path.relative(rootPath, candidatePath);
  if (relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))) {
    return candidatePath;
  }
  throw new TenantStorageError('Storage path escaped configured root', 'TENANT_STORAGE_ESCAPE');
}

async function getRealStorageRoot(storageRoot) {
  const rootPath = normalizeStorageRoot(storageRoot);
  await fsp.mkdir(rootPath, { recursive: true, mode: 0o750 });
  const rootStat = await fsp.lstat(rootPath);
  if (!rootStat.isDirectory()) {
    throw new TenantStorageError('Storage root is not a directory');
  }
  return { rootPath, realRootPath: await fsp.realpath(rootPath) };
}

async function ensureSafeParent(storageKey, storageRoot) {
  const key = assertSafeStorageKey(storageKey);
  const { rootPath, realRootPath } = await getRealStorageRoot(storageRoot);
  const components = key.split('/').slice(0, -1);
  let current = rootPath;

  for (const component of components) {
    current = path.join(current, component);
    let stat;
    try {
      stat = await fsp.lstat(current);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      try {
        await fsp.mkdir(current, { mode: 0o750 });
      } catch (mkdirError) {
        if (mkdirError.code !== 'EEXIST') throw mkdirError;
      }
      stat = await fsp.lstat(current);
    }
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new TenantStorageError(
        'Storage namespace contains a symlink or non-directory',
        'TENANT_STORAGE_SYMLINK',
      );
    }
  }

  const realParentPath = await fsp.realpath(current);
  assertContained(realRootPath, realParentPath);
  return {
    absolutePath: path.join(realParentPath, key.split('/').at(-1)),
    parentPath: realParentPath,
    realRootPath,
  };
}

async function fsyncDirectory(directory) {
  let handle;
  try {
    handle = await fsp.open(directory, fs.constants.O_RDONLY);
    await handle.sync();
  } catch (error) {
    if (!['EINVAL', 'ENOTSUP', 'EISDIR'].includes(error.code)) throw error;
  } finally {
    await handle?.close().catch(() => {});
  }
}

function checksumBuffer(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

async function atomicWriteStorageObject({ storageKey, buffer, storageRoot }) {
  if (!Buffer.isBuffer(buffer)) {
    throw new TenantStorageError('Storage payload must be a Buffer');
  }
  const { absolutePath, parentPath } = await ensureSafeParent(storageKey, storageRoot);
  const tempPath = path.join(parentPath, `.tmp-${crypto.randomUUID()}`);
  const flags = fs.constants.O_CREAT |
    fs.constants.O_EXCL |
    fs.constants.O_WRONLY |
    (fs.constants.O_NOFOLLOW || 0);
  let handle;

  try {
    try {
      const existing = await fsp.lstat(absolutePath);
      if (existing) {
        throw new TenantStorageError('Storage object already exists', 'TENANT_STORAGE_CONFLICT', 409);
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }

    handle = await fsp.open(tempPath, flags, 0o640);
    await handle.writeFile(buffer);
    await handle.sync();
    await handle.close();
    handle = null;
    try {
      await fsp.link(tempPath, absolutePath);
    } catch (error) {
      if (error.code === 'EEXIST') {
        throw new TenantStorageError(
          'Storage object already exists',
          'TENANT_STORAGE_CONFLICT',
          409,
        );
      }
      throw error;
    }
    await fsp.unlink(tempPath);
    await fsyncDirectory(parentPath);
  } catch (error) {
    await handle?.close().catch(() => {});
    await fsp.unlink(tempPath).catch(() => {});
    throw error;
  }

  return {
    checksumSha256: checksumBuffer(buffer),
    size: buffer.length,
    storageKey: assertSafeStorageKey(storageKey),
  };
}

async function resolveExistingStoragePath({ storageKey, storageRoot }) {
  const key = assertSafeStorageKey(storageKey);
  const { rootPath, realRootPath } = await getRealStorageRoot(storageRoot);
  const candidate = assertContained(rootPath, path.resolve(rootPath, ...key.split('/')));
  const stat = await fsp.lstat(candidate);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new TenantStorageError(
      'Storage object is not a regular file',
      'TENANT_STORAGE_SYMLINK',
    );
  }
  const realPath = await fsp.realpath(candidate);
  assertContained(realRootPath, realPath);
  return realPath;
}

async function deleteStorageObject({ storageKey, storageRoot }) {
  let absolutePath;
  try {
    absolutePath = await resolveExistingStoragePath({ storageKey, storageRoot });
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
  await fsp.unlink(absolutePath);
  return true;
}

module.exports = {
  DEFAULT_STORAGE_ROOT,
  STORAGE_KEY_VERSION,
  TenantStorageError,
  assertContained,
  assertSafeStorageKey,
  atomicWriteStorageObject,
  buildTenantStorageKey,
  checksumBuffer,
  deleteStorageObject,
  normalizeStorageRoot,
  opaqueComponent,
  resolveExistingStoragePath,
};
