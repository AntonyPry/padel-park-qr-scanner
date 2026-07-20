'use strict';

const crypto = require('node:crypto');
const db = require('../../models');
const {
  INTEGRATION_CONNECTION_STATUSES,
  INTEGRATION_PROVIDERS,
  INTEGRATION_PURPOSES,
  PROVIDER_PURPOSE,
} = require('./constants');
const { recordRejectedIngress } = require('./diagnostics');
const { isProviderCredentialKey } = require('./credential-keys');
const { decryptSecretBundle, encryptSecretBundle } = require('./secrets');

const PUBLIC_ID_PATTERN = /^ic_[a-f0-9]{32}$/u;
const CONNECTION_KEY_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/u;
const PRIVATE_CONTACT_KEY = /(email|phone)/iu;

function connectionError(code, statusCode = 404, message = 'Integration connection was not found') {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function normalizeSafeObject(value, label) {
  if (value === null || value === undefined) return {};
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw connectionError('INTEGRATION_CONNECTION_CONFIG_INVALID', 400, `${label} is invalid`);
  }
  const serialized = JSON.stringify(value);
  if (serialized.length > 32768) {
    throw connectionError('INTEGRATION_CONNECTION_CONFIG_INVALID', 400, `${label} is too large`);
  }
  const visit = (current) => {
    if (!current || typeof current !== 'object') return;
    for (const [key, child] of Object.entries(current)) {
      if (isProviderCredentialKey(key) || PRIVATE_CONTACT_KEY.test(key)) {
        throw connectionError(
          'INTEGRATION_CONNECTION_CONFIG_CONTAINS_SECRET',
          400,
          `${label} contains a secret field`,
        );
      }
      if (child && typeof child === 'object') visit(child);
    }
  };
  visit(value);
  return JSON.parse(serialized);
}

function normalizeStoredSafeObject(value, label) {
  if (typeof value !== 'string') return normalizeSafeObject(value, label);
  try {
    return normalizeSafeObject(JSON.parse(value), label);
  } catch (error) {
    if (error?.code) throw error;
    throw connectionError('INTEGRATION_CONNECTION_CONFIG_INVALID', 500, `${label} is invalid`);
  }
}

function validateProviderPurpose(provider, purpose) {
  if (!INTEGRATION_PROVIDERS.includes(provider) || !INTEGRATION_PURPOSES.includes(purpose)) {
    throw connectionError('INTEGRATION_CONNECTION_TYPE_INVALID', 400, 'Integration type is invalid');
  }
  if (PROVIDER_PURPOSE[provider] !== purpose) {
    throw connectionError('INTEGRATION_CONNECTION_TYPE_INVALID', 400, 'Integration type is invalid');
  }
}

function generatePublicId() {
  return `ic_${crypto.randomBytes(16).toString('hex')}`;
}

function serializeConnection(row) {
  if (!row) return null;
  const raw = row.toJSON ? row.toJSON() : { ...row };
  return Object.freeze({
    clubId: Number(raw.clubId),
    config: Object.freeze(normalizeStoredSafeObject(raw.config, 'config')),
    connectionId: Number(raw.id),
    connectionKey: raw.connectionKey,
    metadata: Object.freeze(normalizeStoredSafeObject(raw.metadata, 'metadata')),
    organizationId: Number(raw.organizationId),
    provider: raw.provider,
    publicId: raw.publicId,
    purpose: raw.purpose,
    status: raw.status,
  });
}

function contextWithSecrets(row) {
  const context = serializeConnection(row);
  const raw = row.toJSON ? row.toJSON() : row;
  const secrets = decryptSecretBundle(raw.secretCiphertext, {
    provider: context.provider,
    publicId: context.publicId,
  });
  return Object.freeze({ ...context, secrets });
}

async function assertActiveTenantChain(row) {
  const [organization, club] = await Promise.all([
    db.Organization.findOne({
      attributes: ['id'],
      where: { id: row.organizationId, status: 'active' },
    }),
    db.Club.findOne({
      attributes: ['id'],
      where: {
        id: row.clubId,
        organizationId: row.organizationId,
        status: 'active',
      },
    }),
  ]);
  if (!organization || !club) {
    throw connectionError('INTEGRATION_CONNECTION_TENANT_INACTIVE');
  }
}

async function createConnection({
  clubId,
  config = {},
  connectionKey = 'default',
  metadata = {},
  organizationId,
  provider,
  publicId = generatePublicId(),
  purpose = PROVIDER_PURPOSE[provider],
  secrets,
  status = 'active',
}, { transaction } = {}) {
  validateProviderPurpose(provider, purpose);
  if (!PUBLIC_ID_PATTERN.test(publicId) || !CONNECTION_KEY_PATTERN.test(connectionKey)) {
    throw connectionError('INTEGRATION_CONNECTION_ID_INVALID', 400, 'Integration identity is invalid');
  }
  if (!INTEGRATION_CONNECTION_STATUSES.includes(status)) {
    throw connectionError('INTEGRATION_CONNECTION_STATUS_INVALID', 400, 'Integration status is invalid');
  }
  const tenant = await db.Club.findOne({
    attributes: ['id', 'organizationId'],
    transaction,
    where: { id: clubId, organizationId },
  });
  if (!tenant) throw connectionError('INTEGRATION_CONNECTION_TENANT_INVALID', 400);
  const secretCiphertext = encryptSecretBundle(secrets, { provider, publicId });
  return db.IntegrationConnection.create({
    clubId,
    config: normalizeSafeObject(config, 'config'),
    connectionKey,
    metadata: normalizeSafeObject(metadata, 'metadata'),
    organizationId,
    provider,
    publicId,
    purpose,
    secretCiphertext,
    secretKeyVersion: String(process.env.INTEGRATION_SECRETS_KEY_VERSION || 'v1'),
    secretUpdatedAt: new Date(),
    status,
  }, { transaction });
}

async function updateConnectionConfiguration(row, { config, metadata, secrets, status } = {}) {
  const raw = row?.toJSON ? row.toJSON() : row;
  if (!raw?.id || !raw.publicId || !raw.provider) {
    throw connectionError('INTEGRATION_CONNECTION_ID_INVALID', 400, 'Integration identity is invalid');
  }
  const updates = {};
  if (config !== undefined) updates.config = normalizeSafeObject(config, 'config');
  if (metadata !== undefined) updates.metadata = normalizeSafeObject(metadata, 'metadata');
  if (status !== undefined) {
    if (!INTEGRATION_CONNECTION_STATUSES.includes(status)) {
      throw connectionError('INTEGRATION_CONNECTION_STATUS_INVALID', 400, 'Integration status is invalid');
    }
    updates.status = status;
  }
  if (secrets !== undefined) {
    updates.secretCiphertext = encryptSecretBundle(secrets, {
      provider: raw.provider,
      publicId: raw.publicId,
    });
    updates.secretKeyVersion = String(process.env.INTEGRATION_SECRETS_KEY_VERSION || 'v1');
    updates.secretUpdatedAt = new Date();
  }
  return row.update(updates);
}

async function rejectIngress(reasonCode, diagnostic = {}) {
  await recordRejectedIngress({ ...diagnostic, reasonCode });
  throw connectionError('PROVIDER_CONNECTION_REJECTED');
}

async function resolveIngressConnection({
  provider,
  publicId,
  purpose = PROVIDER_PURPOSE[provider],
  requestId,
  sourceIp,
}) {
  if (!PUBLIC_ID_PATTERN.test(String(publicId || ''))) {
    return rejectIngress('CONNECTION_ID_INVALID', { provider, publicId, requestId, sourceIp });
  }
  const row = await db.IntegrationConnection.unscoped().findOne({ where: { publicId } });
  if (!row) return rejectIngress('CONNECTION_UNKNOWN', { provider, publicId, requestId, sourceIp });
  if (row.provider !== provider || row.purpose !== purpose) {
    return rejectIngress('CONNECTION_PROVIDER_MISMATCH', { provider, publicId, requestId, sourceIp });
  }
  if (row.status !== 'active') {
    return rejectIngress(`CONNECTION_${String(row.status).toUpperCase()}`, {
      provider,
      publicId,
      requestId,
      sourceIp,
    });
  }
  try {
    await assertActiveTenantChain(row);
  } catch {
    return rejectIngress('CONNECTION_TENANT_INACTIVE', { provider, publicId, requestId, sourceIp });
  }
  try {
    return contextWithSecrets(row);
  } catch {
    return rejectIngress('CONNECTION_SECRET_INVALID', { provider, publicId, requestId, sourceIp });
  }
}

async function resolveTenantConnection({
  connectionKey,
  provider,
  purpose = PROVIDER_PURPOSE[provider],
  tenant,
}) {
  const organizationId = Number(tenant?.organizationId);
  const clubId = Number(tenant?.clubId);
  if (!Number.isInteger(organizationId) || !Number.isInteger(clubId)) {
    throw connectionError('TENANT_CONTEXT_REQUIRED', 400, 'Tenant context is required');
  }
  const where = { clubId, organizationId, provider, purpose, status: 'active' };
  if (connectionKey) where.connectionKey = connectionKey;
  const rows = await db.IntegrationConnection.unscoped().findAll({ limit: 2, where });
  if (rows.length !== 1) {
    throw connectionError(
      rows.length === 0 ? 'PROVIDER_CONNECTION_REQUIRED' : 'PROVIDER_CONNECTION_AMBIGUOUS',
      409,
      'Provider connection is not configured',
    );
  }
  await assertActiveTenantChain(rows[0]);
  return contextWithSecrets(rows[0]);
}

async function resolveConnectionForTenantById({ connectionId, provider, tenant }) {
  const organizationId = Number(tenant?.organizationId);
  const clubId = Number(tenant?.clubId);
  const id = Number(connectionId);
  if (![organizationId, clubId, id].every((value) => Number.isInteger(value) && value > 0)) {
    throw connectionError('PROVIDER_CONNECTION_REQUIRED', 409, 'Provider connection is not configured');
  }
  const row = await db.IntegrationConnection.unscoped().findOne({
    where: {
      clubId,
      id,
      organizationId,
      provider,
      purpose: PROVIDER_PURPOSE[provider],
      status: 'active',
    },
  });
  if (!row) {
    throw connectionError('PROVIDER_CONNECTION_REQUIRED', 409, 'Provider connection is not configured');
  }
  await assertActiveTenantChain(row);
  return contextWithSecrets(row);
}

async function listActiveConnections({ provider, purpose = PROVIDER_PURPOSE[provider] }) {
  const rows = await db.IntegrationConnection.unscoped().findAll({
    order: [['organizationId', 'ASC'], ['clubId', 'ASC'], ['id', 'ASC']],
    where: { provider, purpose, status: 'active' },
  });
  const contexts = [];
  for (const row of rows) {
    try {
      await assertActiveTenantChain(row);
      contexts.push(contextWithSecrets(row));
    } catch {
      contexts.push(Object.freeze({
        ...serializeConnection(row),
        configurationError: true,
        secrets: Object.freeze({}),
      }));
    }
  }
  return contexts;
}

module.exports = {
  PUBLIC_ID_PATTERN,
  connectionError,
  contextWithSecrets,
  createConnection,
  generatePublicId,
  listActiveConnections,
  normalizeSafeObject,
  resolveConnectionForTenantById,
  resolveIngressConnection,
  resolveTenantConnection,
  serializeConnection,
  updateConnectionConfiguration,
};
