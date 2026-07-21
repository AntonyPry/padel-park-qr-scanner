'use strict';

const crypto = require('node:crypto');
const db = require('../../models');
const auditService = require('./audit.service');
const installationOperatorAuth = require('./installation-operator-auth.service');
const {
  assertTenantFoundationInitialized,
  invalidateTenantFoundationGateCache,
} = require('./tenant-foundation.service');
const {
  contextWithSecrets,
  createConnection,
  generatePublicId,
  updateConnectionConfiguration,
} = require('../provider-integrations/connection-service');
const {
  PROVIDER_PURPOSE,
} = require('../provider-integrations/constants');
const {
  assertUniqueFingerprints,
  PRIMARY_SECRET_KEY,
} = require('../provider-integrations/fingerprints');
const {
  generateCallbackToken,
} = require('../provider-integrations/beeline-callback');
const {
  validateProviderCandidate,
} = require('../provider-integrations/operator-validation');
const { withProviderConnectionLock } = require('../provider-integrations/locks');
const telephonyService = require('./telephony.service');

const PROVIDERS = Object.freeze(['beeline', 'evotor', 'telegram', 'vk']);
const MUTABLE_BEELINE_SETTINGS = Object.freeze([
  'apiBaseUrl',
  'apiTimeoutMs',
  'callbackBaseUrl',
  'recordsPath',
  'statisticsPath',
  'subscriptionAutoRenewEnabled',
  'subscriptionExpiresSeconds',
  'subscriptionPath',
  'subscriptionPattern',
  'subscriptionRenewBeforeSeconds',
  'subscriptionType',
]);

function managementError(message, statusCode, code) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, stableValue(value[key])]),
  );
}

function payloadHash(action, scope, input) {
  const copy = { ...input };
  delete copy.idempotencyKey;
  return sha256(JSON.stringify(stableValue({ action, scope, input: copy })));
}

function parseStoredJson(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function dateIso(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function redactedSafeIdentity(provider, value) {
  const candidate = typeof value === 'string' ? value.trim() : '';
  if (!candidate || candidate.length > 120 || /[\r\n]/u.test(candidate)) return null;
  if (provider === 'telegram') return /^@[A-Za-z0-9_]{5,32}$/u.test(candidate) ? candidate : null;
  if (provider === 'beeline') return /^(?:ВАТС|Виртуальная АТС) [\p{L}\p{N} .·«»—_+()-]+$/u.test(candidate)
    ? candidate
    : null;
  if (provider === 'evotor') return /^Webhook [\p{L}\p{N} .·«»—_+()-]+$/u.test(candidate)
    ? candidate
    : null;
  return /^[\p{L}\p{N} .·«»—_+()-]+$/u.test(candidate) ? candidate : null;
}

function redactedSafeCallback(provider, value) {
  const candidate = typeof value === 'string' ? value.trim() : '';
  if (!candidate || candidate.length > 500 || /[?#]/u.test(candidate)) return null;
  try {
    const url = new URL(candidate);
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    if (provider === 'evotor' && !/^\/api\/webhooks\/evotor\/ic_[a-f0-9]{32}$/u.test(url.pathname)) {
      return null;
    }
    if (provider === 'beeline' && !candidate.endsWith('/[скрыто]')) return null;
    return candidate;
  } catch {
    return null;
  }
}

function assertFresh(row, expectedUpdatedAt, label) {
  const current = dateIso(row?.updatedAt);
  if (!current || current !== dateIso(expectedUpdatedAt)) {
    throw managementError(
      `${label} уже изменён. Обновите страницу и повторите действие`,
      409,
      'INSTALLATION_STALE_STATE',
    );
  }
}

function normalizeName(value) {
  return String(value || '').trim().replace(/\s+/gu, ' ');
}

function normalizeNameKey(value) {
  return normalizeName(value).normalize('NFKC').toLocaleLowerCase('ru-RU');
}

function canonicalTimezone(value) {
  const timezone = String(value || '').trim();
  try {
    return new Intl.DateTimeFormat('ru-RU', { timeZone: timezone })
      .resolvedOptions().timeZone;
  } catch {
    throw managementError(
      'Выберите корректный город или часовой пояс',
      400,
      'CLUB_TIMEZONE_INVALID',
    );
  }
}

async function lockOrganization(organizationId, transaction) {
  const organization = await db.Organization.findByPk(Number(organizationId), {
    lock: transaction.LOCK.UPDATE,
    transaction,
  });
  if (!organization) {
    throw managementError('Организация не найдена', 404, 'INSTALLATION_ORGANIZATION_NOT_FOUND');
  }
  return organization;
}

async function lockClub(organizationId, clubId, transaction) {
  const club = await db.Club.findOne({
    lock: transaction.LOCK.UPDATE,
    transaction,
    where: { id: Number(clubId), organizationId: Number(organizationId) },
  });
  if (!club) throw managementError('Клуб не найден', 404, 'INSTALLATION_CLUB_NOT_FOUND');
  return club;
}

async function assertOrganizationNameAvailable(name, excludeId, transaction) {
  const rows = await db.Organization.findAll({
    attributes: ['id', 'name'],
    lock: transaction.LOCK.UPDATE,
    transaction,
  });
  if (rows.some((row) => Number(row.id) !== Number(excludeId) &&
    normalizeNameKey(row.name) === normalizeNameKey(name))) {
    throw managementError(
      'Организация с таким названием уже существует',
      409,
      'ORGANIZATION_NAME_EXISTS',
    );
  }
}

async function assertClubNameAvailable(organizationId, name, excludeId, transaction) {
  const rows = await db.Club.findAll({
    attributes: ['id', 'name'],
    lock: transaction.LOCK.UPDATE,
    transaction,
    where: { organizationId: Number(organizationId) },
  });
  if (rows.some((row) => Number(row.id) !== Number(excludeId) &&
    normalizeNameKey(row.name) === normalizeNameKey(name))) {
    throw managementError(
      'В этой организации уже есть клуб с таким названием',
      409,
      'CLUB_NAME_EXISTS',
    );
  }
}

async function assertReactivationAuthority(organizationId, transaction) {
  const memberships = await db.Membership.findAll({
    include: [{ attributes: ['id', 'role', 'staffId', 'status'], model: db.Account }],
    lock: transaction.LOCK.UPDATE,
    transaction,
    where: { organizationId, role: 'owner', status: 'active' },
  });
  for (const membership of memberships) {
    const account = membership.Account;
    if (!account || account.status !== 'active' || account.role !== 'owner') continue;
    if (membership.staffId == null && account.staffId == null) return;
    if (membership.staffId == null || account.staffId == null) continue;
    const staff = await db.Staff.findOne({
      lock: transaction.LOCK.UPDATE,
      transaction,
      where: {
        id: membership.staffId,
        organizationId,
        status: 'active',
      },
    });
    if (staff && Number(account.staffId) === Number(staff.id)) return;
  }
  throw managementError(
    'Сначала восстановите действующего владельца организации',
    409,
    'ORGANIZATION_OWNER_AUTHORITY_INVALID',
  );
}

async function recordMutationAudit({
  action,
  clubId,
  entityId,
  entityType,
  metadata,
  method = 'POST',
  operator,
  organizationId,
  path,
  summary,
}, transaction) {
  return auditService.recordInstallation({
    action,
    clubId: clubId || null,
    entityId: String(entityId),
    entityType,
    metadata: { ...metadata, operatorSessionId: operator.sessionId, operator: operator.username },
    method,
    organizationId,
    path,
    statusCode: 200,
    summary,
  }, transaction);
}

async function runMutation({
  action,
  clubId = null,
  input,
  mutate,
  operator,
  organizationId,
}) {
  const idempotencyKeyHash = sha256(input.idempotencyKey);
  const hash = payloadHash(action, { clubId, organizationId }, input);
  try {
    return await db.sequelize.transaction(async (transaction) => {
      const lockedOperator = await installationOperatorAuth.lockSessionAuthority(
        operator,
        transaction,
      );
      await assertTenantFoundationInitialized({ strict: true, transaction });
      const previous = await db.InstallationMutationOperation.findOne({
        lock: transaction.LOCK.UPDATE,
        transaction,
        where: { idempotencyKeyHash },
      });
      if (previous) {
        if (previous.payloadHash !== hash) {
          throw managementError(
            'Ключ повторной отправки уже использован с другими данными',
            409,
            'IDEMPOTENCY_PAYLOAD_MISMATCH',
          );
        }
        return {
          ...parseStoredJson(previous.response),
          idempotency: { operationId: previous.id, replayed: true },
        };
      }
      const result = await mutate(transaction);
      if (typeof result.beforeAudit === 'function') await result.beforeAudit();
      const audit = await recordMutationAudit({
        ...result.audit,
        action,
        clubId,
        operator: lockedOperator,
        organizationId,
      }, transaction);
      if (typeof result.finalize === 'function') await result.finalize();
      const responseBody = typeof result.response === 'function'
        ? result.response()
        : result.response;
      const response = { ...responseBody, auditLogId: audit.id };
      const operation = await db.InstallationMutationOperation.create({
        action,
        auditLogId: audit.id,
        clubId,
        idempotencyKeyHash,
        organizationId,
        payloadHash: hash,
        response,
      }, { transaction });
      return {
        ...response,
        idempotency: { operationId: operation.id, replayed: false },
      };
    });
  } catch (error) {
    if (error?.name !== 'SequelizeUniqueConstraintError') throw error;
    return db.sequelize.transaction(async (transaction) => {
      await installationOperatorAuth.lockSessionAuthority(operator, transaction);
      const previous = await db.InstallationMutationOperation.findOne({
        lock: transaction.LOCK.UPDATE,
        transaction,
        where: { idempotencyKeyHash },
      });
      if (!previous || previous.payloadHash !== hash) {
        throw managementError(
          'Ключ повторной отправки уже использован с другими данными',
          409,
          'IDEMPOTENCY_PAYLOAD_MISMATCH',
        );
      }
      return {
        ...parseStoredJson(previous.response),
        idempotency: { operationId: previous.id, replayed: true },
      };
    });
  }
}

function organizationProjection(row) {
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    updatedAt: row.updatedAt,
  };
}

function clubProjection(row) {
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    timezone: row.timezone,
    updatedAt: row.updatedAt,
  };
}

async function updateOrganization(organizationId, input, operator) {
  const name = normalizeName(input.name);
  return runMutation({
    action: 'installation.organization.update',
    input,
    operator,
    organizationId: Number(organizationId),
    mutate: async (transaction) => {
      const organization = await lockOrganization(organizationId, transaction);
      assertFresh(organization, input.expectedUpdatedAt, 'Организация');
      await assertOrganizationNameAvailable(name, organization.id, transaction);
      await organization.update({ name }, { transaction });
      return {
        audit: {
          entityId: organization.id,
          entityType: 'organization',
          metadata: { fields: ['name'] },
          method: 'PUT',
          path: `/api/installation/provisioning/organizations/${organization.id}`,
          summary: `Название организации изменено на «${organization.name}»`,
        },
        response: { organization: organizationProjection(organization) },
      };
    },
  });
}

async function setOrganizationLifecycle(organizationId, targetStatus, input, operator) {
  const actionName = targetStatus === 'archived' ? 'archive' : 'reactivate';
  return runMutation({
    action: `installation.organization.${actionName}`,
    input,
    operator,
    organizationId: Number(organizationId),
    mutate: async (transaction) => {
      const organization = await lockOrganization(organizationId, transaction);
      assertFresh(organization, input.expectedUpdatedAt, 'Организация');
      if (targetStatus === 'archived') {
        if (!input.confirmImpact) {
          throw managementError('Подтвердите архивирование организации', 409, 'IMPACT_CONFIRMATION_REQUIRED');
        }
      } else {
        await assertReactivationAuthority(organization.id, transaction);
      }
      const disabledIntegrations = targetStatus === 'archived'
        ? await disableScopedIntegrations({ organizationId: organization.id, transaction })
        : 0;
      return {
        audit: {
          entityId: organization.id,
          entityType: 'organization',
          metadata: { disabledIntegrations, status: targetStatus },
          path: `/api/installation/provisioning/organizations/${organization.id}/${actionName}`,
          summary: targetStatus === 'archived'
            ? `Организация «${organization.name}» архивирована`
            : `Организация «${organization.name}» восстановлена`,
        },
        beforeAudit: targetStatus === 'active'
          ? () => organization.update({ status: targetStatus }, { transaction })
          : null,
        finalize: targetStatus === 'archived'
          ? () => organization.update({ status: targetStatus }, { transaction })
          : null,
        response: () => ({ organization: organizationProjection(organization) }),
      };
    },
  }).finally(invalidateTenantFoundationGateCache);
}

async function updateClub(organizationId, clubId, input, operator) {
  const name = normalizeName(input.name);
  const timezone = canonicalTimezone(input.timezone);
  return runMutation({
    action: 'installation.club.update',
    clubId: Number(clubId),
    input,
    operator,
    organizationId: Number(organizationId),
    mutate: async (transaction) => {
      await lockOrganization(organizationId, transaction);
      const club = await lockClub(organizationId, clubId, transaction);
      assertFresh(club, input.expectedUpdatedAt, 'Клуб');
      await assertClubNameAvailable(organizationId, name, club.id, transaction);
      await club.update({ name, timezone }, { transaction });
      return {
        audit: {
          entityId: club.id,
          entityType: 'club',
          metadata: { fields: ['name', 'timezone'] },
          method: 'PUT',
          path: `/api/installation/provisioning/organizations/${organizationId}/clubs/${club.id}`,
          summary: `Настройки клуба «${club.name}» изменены`,
        },
        response: { club: clubProjection(club) },
      };
    },
  });
}

async function setClubLifecycle(organizationId, clubId, targetStatus, input, operator) {
  const actionName = targetStatus === 'archived' ? 'archive' : 'reactivate';
  return runMutation({
    action: `installation.club.${actionName}`,
    clubId: Number(clubId),
    input,
    operator,
    organizationId: Number(organizationId),
    mutate: async (transaction) => {
      const organization = await lockOrganization(organizationId, transaction);
      const club = await lockClub(organizationId, clubId, transaction);
      assertFresh(club, input.expectedUpdatedAt, 'Клуб');
      if (targetStatus === 'archived' && !input.confirmImpact) {
        throw managementError('Подтвердите архивирование клуба', 409, 'IMPACT_CONFIRMATION_REQUIRED');
      }
      if (targetStatus === 'active') {
        if (organization.status !== 'active') {
          throw managementError('Сначала восстановите организацию', 409, 'ORGANIZATION_INACTIVE');
        }
        await assertReactivationAuthority(organization.id, transaction);
      }
      const disabledIntegrations = targetStatus === 'archived'
        ? await disableScopedIntegrations({
            clubId: club.id,
            organizationId: organization.id,
            transaction,
          })
        : 0;
      return {
        audit: {
          entityId: club.id,
          entityType: 'club',
          metadata: { disabledIntegrations, status: targetStatus },
          path: `/api/installation/provisioning/organizations/${organizationId}/clubs/${club.id}/${actionName}`,
          summary: targetStatus === 'archived'
            ? `Клуб «${club.name}» архивирован`
            : `Клуб «${club.name}» восстановлен`,
        },
        beforeAudit: targetStatus === 'active'
          ? () => club.update({ status: targetStatus }, { transaction })
          : null,
        finalize: targetStatus === 'archived'
          ? () => club.update({ status: targetStatus }, { transaction })
          : null,
        response: () => ({ club: clubProjection(club) }),
      };
    },
  }).finally(invalidateTenantFoundationGateCache);
}

function beelineSettings(config = {}) {
  return Object.fromEntries(MUTABLE_BEELINE_SETTINGS.map((key) => [key, config[key]]));
}

function integrationProjection(row, provider = row?.provider) {
  if (!row) {
    return {
      configured: false,
      lastActivityAt: null,
      lastValidatedAt: null,
      provider,
      proxyConfigured: false,
      safeCallbackUrl: null,
      safeIdentity: null,
      secretUpdatedAt: null,
      settings: provider === 'beeline' ? {} : {},
      status: 'not_configured',
      updatedAt: null,
      validationStatus: 'not_tested',
    };
  }
  const metadata = parseStoredJson(row.metadata);
  const config = parseStoredJson(row.config);
  return {
    configured: true,
    lastActivityAt: dateIso(metadata.lastActivityAt),
    lastValidatedAt: dateIso(metadata.lastValidatedAt),
    provider,
    proxyConfigured: provider === 'telegram' && metadata.proxyConfigured === true,
    safeCallbackUrl: redactedSafeCallback(provider, metadata.safeCallbackUrl),
    safeIdentity: redactedSafeIdentity(provider, metadata.safeIdentity),
    secretUpdatedAt: dateIso(row.secretUpdatedAt),
    settings: provider === 'beeline' ? beelineSettings(config) : {},
    status: row.status,
    updatedAt: dateIso(row.updatedAt),
    validationStatus: ['verified', 'pending_event', 'failed', 'not_tested']
      .includes(metadata.validationStatus) ? metadata.validationStatus : 'not_tested',
  };
}

async function disableScopedIntegrations({ clubId = null, organizationId, transaction }) {
  const connections = await db.IntegrationConnection.unscoped().findAll({
    lock: transaction.LOCK.UPDATE,
    transaction,
    where: {
      ...(clubId ? { clubId: Number(clubId) } : {}),
      organizationId: Number(organizationId),
      status: 'active',
    },
  });
  for (const connection of connections) {
    await updateConnectionConfiguration(connection, { status: 'disabled' }, { transaction });
  }
  return connections.length;
}

async function listBotRunnerScopes(organizationId, clubId = null) {
  const scopes = [];
  for (const provider of ['telegram', 'vk']) {
    const rows = await db.IntegrationConnection.unscoped().findAll({
      attributes: ['clubId', 'organizationId', 'provider'],
      where: {
        ...(clubId ? { clubId: Number(clubId) } : {}),
        organizationId: Number(organizationId),
        provider,
      },
    });
    for (const row of rows) {
      scopes.push({
        clubId: Number(row.clubId),
        organizationId: Number(row.organizationId),
        provider: row.provider,
      });
    }
  }
  return scopes;
}

async function getScopedConnection(organizationId, clubId, provider, transaction, lock = false) {
  return db.IntegrationConnection.unscoped().findOne({
    lock: lock && transaction ? transaction.LOCK.UPDATE : undefined,
    transaction,
    where: {
      clubId: Number(clubId),
      connectionKey: 'default',
      organizationId: Number(organizationId),
      provider,
      purpose: PROVIDER_PURPOSE[provider],
    },
  });
}

function normalizeProviderConfig(provider, settings = {}) {
  if (provider !== 'beeline') return {};
  return {
    ...beelineSettings(settings),
    subscriptionPattern: settings.subscriptionPattern || null,
    webhookAuthMode: 'capability_uri',
  };
}

function safeCallbackUrl(provider, publicId, config) {
  if (provider === 'beeline') {
    return `${String(config.callbackBaseUrl).replace(/\/+$/u, '')}/${publicId}/[скрыто]`;
  }
  if (provider === 'evotor') {
    const base = String(
      process.env.INSTALLATION_PROVIDER_CALLBACK_BASE_URL || 'https://api.setly.tech',
    ).replace(/\/+$/u, '');
    return `${base}/api/webhooks/evotor/${publicId}`;
  }
  return null;
}

function candidateSecrets(provider, primarySecret, proxyUrl, current = null) {
  const next = current ? { ...current } : {};
  if (primarySecret) next[PRIMARY_SECRET_KEY[provider]] = primarySecret;
  if (provider === 'telegram' && proxyUrl) next.proxyUrl = proxyUrl;
  if (provider === 'telegram' && proxyUrl === null) delete next.proxyUrl;
  if (provider === 'beeline' && !next.callbackToken) next.callbackToken = generateCallbackToken();
  return next;
}

async function prepareCandidate(organizationId, clubId, provider, input, operation) {
  if (!PROVIDERS.includes(provider)) {
    throw managementError('Провайдер не поддерживается', 404, 'INTEGRATION_PROVIDER_INVALID');
  }
  const existing = await getScopedConnection(organizationId, clubId, provider);
  if (existing?.status === 'revoked' && operation !== 'rotate') {
    throw managementError(
      'Сначала замените отозванные учётные данные',
      409,
      'INTEGRATION_CREDENTIAL_REVOKED',
    );
  }
  if (existing && !input.expectedUpdatedAt) {
    throw managementError('Обновите страницу и повторите действие', 409, 'INSTALLATION_STALE_STATE');
  }
  if (!existing && input.expectedUpdatedAt) {
    throw managementError('Подключение уже изменилось', 409, 'INSTALLATION_STALE_STATE');
  }
  const current = existing ? contextWithSecrets(existing) : null;
  const primarySecret = String(input.credential || '').trim();
  if (!current && !primarySecret) {
    throw managementError('Укажите учётные данные провайдера', 400, 'INTEGRATION_CREDENTIAL_REQUIRED');
  }
  const config = input.settings === undefined && current
    ? current.config
    : normalizeProviderConfig(provider, input.settings);
  const secrets = candidateSecrets(
    provider,
    primarySecret,
    input.proxyUrl === undefined ? undefined : input.proxyUrl,
    current?.secrets,
  );
  const validation = await validateProviderCandidate(provider, { config, secrets });
  if (validation.identityKey && ['telegram', 'vk'].includes(provider)) {
    const peers = await db.IntegrationConnection.unscoped().findAll({ where: { provider } });
    for (const peer of peers) {
      if (Number(peer.id) === Number(existing?.id) || peer.providerIdentityFingerprint) continue;
      try {
        const peerContext = contextWithSecrets(peer);
        const peerValidation = await validateProviderCandidate(provider, {
          config: peerContext.config,
          secrets: peerContext.secrets,
        });
        if (peerValidation.identityKey === validation.identityKey) {
          throw managementError(
            'Этот аккаунт провайдера уже подключён к другому клубу',
            409,
            'INTEGRATION_CREDENTIAL_DUPLICATE',
          );
        }
      } catch (error) {
        if (error?.code === 'INTEGRATION_CREDENTIAL_DUPLICATE') throw error;
      }
    }
  }
  const secretChanged = Boolean(primarySecret) || input.proxyUrl !== undefined || !existing;
  return {
    config,
    existing,
    primarySecret: secrets[PRIMARY_SECRET_KEY[provider]],
    secretChanged,
    secrets,
    validation,
  };
}

async function configureIntegration(
  organizationId,
  clubId,
  provider,
  input,
  operator,
  operation = 'configure',
) {
  await installationOperatorAuth.revalidateSessionAuthority(operator);
  const candidate = await prepareCandidate(
    organizationId,
    clubId,
    provider,
    input,
    operation,
  );
  return runMutation({
    action: `installation.integration.${provider}.${operation}`,
    clubId: Number(clubId),
    input,
    operator,
    organizationId: Number(organizationId),
    mutate: async (transaction) => {
      const organization = await lockOrganization(organizationId, transaction);
      const club = await lockClub(organizationId, clubId, transaction);
      if (organization.status !== 'active' || club.status !== 'active') {
        throw managementError('Сначала восстановите организацию и клуб', 409, 'TENANT_INACTIVE');
      }
      let connection = await getScopedConnection(organizationId, clubId, provider, transaction, true);
      if (connection) assertFresh(connection, input.expectedUpdatedAt, 'Подключение');
      else if (input.expectedUpdatedAt) {
        throw managementError('Подключение уже изменилось', 409, 'INSTALLATION_STALE_STATE');
      }
      const fingerprints = await assertUniqueFingerprints({
        credential: candidate.primarySecret,
        excludeConnectionId: connection?.id,
        identity: candidate.validation.identityKey,
        provider,
        transaction,
      });
      const publicId = connection?.publicId || generatePublicId();
      const metadata = {
        ...(connection ? parseStoredJson(connection.metadata) : {}),
        lastValidatedAt: candidate.validation.validatedAt.toISOString(),
        proxyConfigured: provider === 'telegram' && Boolean(candidate.secrets.proxyUrl),
        safeCallbackUrl: safeCallbackUrl(provider, publicId, candidate.config),
        safeIdentity: candidate.validation.safeIdentity,
        validationStatus: candidate.validation.validationStatus,
      };
      if (connection) {
        connection = await updateConnectionConfiguration(connection, {
          ...fingerprints,
          config: candidate.config,
          metadata,
          ...(candidate.secretChanged ? { secrets: candidate.secrets } : {}),
          ...(operation === 'rotate' && connection.status === 'revoked'
            ? { status: 'disabled' }
            : {}),
        }, { transaction });
      } else {
        connection = await createConnection({
          ...fingerprints,
          clubId: Number(clubId),
          config: candidate.config,
          metadata,
          organizationId: Number(organizationId),
          provider,
          publicId,
          secrets: candidate.secrets,
          status: 'disabled',
        }, { transaction });
      }
      return {
        audit: {
          entityId: connection.publicId,
          entityType: 'integration_connection',
          metadata: { provider, validationStatus: candidate.validation.validationStatus },
          method: 'PUT',
          path: `/api/installation/provisioning/organizations/${organizationId}/clubs/${clubId}/integrations/${provider}`,
          summary: operation === 'rotate'
            ? `Учётные данные ${provider} заменены для клуба «${club.name}»`
            : `${provider} настроен для клуба «${club.name}»`,
        },
        response: { integration: integrationProjection(connection) },
      };
    },
  });
}

async function rotateIntegrationCredential(organizationId, clubId, provider, input, operator) {
  return configureIntegration(
    organizationId,
    clubId,
    provider,
    { ...input, settings: undefined },
    operator,
    'rotate',
  );
}

async function restartIntegration(organizationId, clubId, provider, input, operator) {
  if (!['telegram', 'vk'].includes(provider)) {
    throw managementError('Перезапуск для этого провайдера недоступен', 400, 'INTEGRATION_ACTION_INVALID');
  }
  return runMutation({
    action: `installation.integration.${provider}.restart`,
    clubId: Number(clubId),
    input,
    operator,
    organizationId: Number(organizationId),
    mutate: async (transaction) => {
      await lockOrganization(organizationId, transaction);
      const club = await lockClub(organizationId, clubId, transaction);
      const connection = await getScopedConnection(organizationId, clubId, provider, transaction, true);
      if (!connection || connection.status !== 'active') {
        throw managementError('Сначала включите подключение', 409, 'INTEGRATION_INACTIVE');
      }
      assertFresh(connection, input.expectedUpdatedAt, 'Подключение');
      return {
        audit: {
          entityId: connection.publicId,
          entityType: 'integration_connection',
          metadata: { provider },
          path: `/api/installation/provisioning/organizations/${organizationId}/clubs/${clubId}/integrations/${provider}/restart`,
          summary: `${provider} перезапущен для клуба «${club.name}»`,
        },
        response: { integration: integrationProjection(connection) },
      };
    },
  });
}

function previewBeelineResult(action) {
  const now = new Date().toISOString();
  if (action === 'check') return { lastCheckedAt: now, status: 'active' };
  if (action === 'renew') return { action: 'renewed', expiresAt: new Date(Date.now() + 3600000).toISOString() };
  return { action: 'cutover', completedAt: now };
}

async function runBeelineAction(organizationId, clubId, action, input, operator) {
  if (!['check', 'renew', 'cutover'].includes(action)) {
    throw managementError('Действие Билайн недоступно', 400, 'INTEGRATION_ACTION_INVALID');
  }
  await installationOperatorAuth.revalidateSessionAuthority(operator);
  const candidate = await getScopedConnection(organizationId, clubId, 'beeline');
  if (!candidate || candidate.status !== 'active') {
    throw managementError('Сначала включите подключение Билайн', 409, 'INTEGRATION_INACTIVE');
  }
  assertFresh(candidate, input.expectedUpdatedAt, 'Подключение');
  const context = contextWithSecrets(candidate);
  return withProviderConnectionLock(context, () => runMutation({
    action: `installation.integration.beeline.${action}`,
    clubId: Number(clubId),
    input,
    operator,
    organizationId: Number(organizationId),
    mutate: async (transaction) => {
      await lockOrganization(organizationId, transaction);
      const club = await lockClub(organizationId, clubId, transaction);
      const connection = await getScopedConnection(
        organizationId,
        clubId,
        'beeline',
        transaction,
        true,
      );
      if (!connection || connection.status !== 'active') {
        throw managementError('Подключение Билайн отключено', 409, 'INTEGRATION_INACTIVE');
      }
      assertFresh(connection, input.expectedUpdatedAt, 'Подключение');
      let providerResult;
      let secretUpdate;
      if (process.env.INSTALLATION_PROVIDER_VALIDATION_MODE === 'preview') {
        providerResult = previewBeelineResult(action);
        if (action === 'cutover') {
          secretUpdate = { ...context.secrets, callbackToken: generateCallbackToken() };
        }
      } else if (action === 'check') {
        providerResult = await telephonyService.checkEventSubscription(null, context);
      } else if (action === 'renew') {
        providerResult = await telephonyService.maintainEventSubscription({
          connection: context,
          force: true,
        });
        if (providerResult.action === 'failed') {
          throw managementError('Билайн не обновил подписку', 409, 'BEELINE_SUBSCRIPTION_FAILED');
        }
      } else {
        const nextSecrets = { ...context.secrets, callbackToken: generateCallbackToken() };
        const candidateContext = Object.freeze({ ...context, secrets: Object.freeze(nextSecrets) });
        providerResult = await telephonyService.subscribeToEvents({}, null, candidateContext);
        secretUpdate = nextSecrets;
      }
      const metadata = {
        ...parseStoredJson(connection.metadata),
        lastValidatedAt: new Date().toISOString(),
        validationStatus: 'verified',
      };
      await updateConnectionConfiguration(
        connection,
        { metadata, ...(secretUpdate ? { secrets: secretUpdate } : {}) },
        { transaction },
      );
      return {
        audit: {
          entityId: connection.publicId,
          entityType: 'integration_connection',
          metadata: { action, provider: 'beeline' },
          path: `/api/installation/provisioning/organizations/${organizationId}/clubs/${clubId}/integrations/beeline/${action}`,
          summary: action === 'check'
            ? `Подписка Билайн проверена для клуба «${club.name}»`
            : action === 'renew'
              ? `Подписка Билайн обновлена для клуба «${club.name}»`
              : `Callback Билайн безопасно переключён для клуба «${club.name}»`,
        },
        response: {
          integration: integrationProjection(connection),
          providerResult,
        },
      };
    },
  }));
}

async function setIntegrationStatus(
  organizationId,
  clubId,
  provider,
  targetStatus,
  input,
  operator,
) {
  await installationOperatorAuth.revalidateSessionAuthority(operator);
  let validation = null;
  const candidateRow = await getScopedConnection(organizationId, clubId, provider);
  if (!candidateRow) throw managementError('Подключение не настроено', 404, 'INTEGRATION_NOT_FOUND');
  if (targetStatus === 'active') {
    if (candidateRow.status === 'revoked') {
      throw managementError(
        'Сначала замените отозванные учётные данные',
        409,
        'INTEGRATION_CREDENTIAL_REVOKED',
      );
    }
    const context = contextWithSecrets(candidateRow);
    validation = await validateProviderCandidate(provider, {
      config: context.config,
      secrets: context.secrets,
    });
  }
  return runMutation({
    action: `installation.integration.${provider}.${targetStatus}`,
    clubId: Number(clubId),
    input,
    operator,
    organizationId: Number(organizationId),
    mutate: async (transaction) => {
      const organization = await lockOrganization(organizationId, transaction);
      const club = await lockClub(organizationId, clubId, transaction);
      if (targetStatus === 'active' &&
        (organization.status !== 'active' || club.status !== 'active')) {
        throw managementError('Сначала восстановите организацию и клуб', 409, 'TENANT_INACTIVE');
      }
      const connection = await getScopedConnection(organizationId, clubId, provider, transaction, true);
      if (!connection) throw managementError('Подключение не настроено', 404, 'INTEGRATION_NOT_FOUND');
      assertFresh(connection, input.expectedUpdatedAt, 'Подключение');
      const metadata = parseStoredJson(connection.metadata);
      if (validation) {
        const context = contextWithSecrets(connection);
        const fingerprints = await assertUniqueFingerprints({
          credential: context.secrets[PRIMARY_SECRET_KEY[provider]],
          excludeConnectionId: connection.id,
          identity: validation.identityKey,
          provider,
          transaction,
        });
        metadata.lastValidatedAt = validation.validatedAt.toISOString();
        metadata.safeIdentity = validation.safeIdentity;
        metadata.validationStatus = validation.validationStatus;
        await updateConnectionConfiguration(
          connection,
          { ...fingerprints, metadata, status: targetStatus },
          { transaction },
        );
      } else {
        await updateConnectionConfiguration(connection, { metadata, status: targetStatus }, { transaction });
      }
      return {
        audit: {
          entityId: connection.publicId,
          entityType: 'integration_connection',
          metadata: { provider, status: targetStatus },
          path: `/api/installation/provisioning/organizations/${organizationId}/clubs/${clubId}/integrations/${provider}/${targetStatus}`,
          summary: targetStatus === 'active'
            ? `${provider} включён для клуба «${club.name}»`
            : targetStatus === 'disabled'
              ? `${provider} отключён для клуба «${club.name}»`
              : `Доступ ${provider} отозван для клуба «${club.name}»`,
        },
        response: { integration: integrationProjection(connection) },
      };
    },
  });
}

async function validateIntegration(organizationId, clubId, provider, input, operator) {
  await installationOperatorAuth.revalidateSessionAuthority(operator);
  const candidate = await getScopedConnection(organizationId, clubId, provider);
  if (!candidate) throw managementError('Подключение не настроено', 404, 'INTEGRATION_NOT_FOUND');
  if (candidate.status === 'revoked') {
    throw managementError(
      'Сначала замените отозванные учётные данные',
      409,
      'INTEGRATION_CREDENTIAL_REVOKED',
    );
  }
  let validation;
  try {
    const context = contextWithSecrets(candidate);
    validation = await validateProviderCandidate(provider, {
      config: context.config,
      secrets: context.secrets,
    });
  } catch (error) {
    validation = { safeIdentity: null, validatedAt: new Date(), validationStatus: 'failed' };
  }
  return runMutation({
    action: `installation.integration.${provider}.validate`,
    clubId: Number(clubId),
    input,
    operator,
    organizationId: Number(organizationId),
    mutate: async (transaction) => {
      await lockOrganization(organizationId, transaction);
      const club = await lockClub(organizationId, clubId, transaction);
      const connection = await getScopedConnection(organizationId, clubId, provider, transaction, true);
      if (!connection) throw managementError('Подключение не настроено', 404, 'INTEGRATION_NOT_FOUND');
      assertFresh(connection, input.expectedUpdatedAt, 'Подключение');
      const metadata = {
        ...parseStoredJson(connection.metadata),
        lastValidatedAt: validation.validatedAt.toISOString(),
        validationStatus: validation.validationStatus,
      };
      if (validation.safeIdentity) metadata.safeIdentity = validation.safeIdentity;
      let fingerprintUpdates = {};
      if (validation.validationStatus !== 'failed') {
        const context = contextWithSecrets(connection);
        fingerprintUpdates = await assertUniqueFingerprints({
          credential: context.secrets[PRIMARY_SECRET_KEY[provider]],
          excludeConnectionId: connection.id,
          identity: validation.identityKey,
          provider,
          transaction,
        });
      }
      await updateConnectionConfiguration(
        connection,
        { ...fingerprintUpdates, metadata },
        { transaction },
      );
      return {
        audit: {
          entityId: connection.publicId,
          entityType: 'integration_connection',
          metadata: { provider, validationStatus: validation.validationStatus },
          path: `/api/installation/provisioning/organizations/${organizationId}/clubs/${clubId}/integrations/${provider}/validate`,
          summary: validation.validationStatus === 'failed'
            ? `${provider}: проверка не пройдена`
            : `${provider}: проверка пройдена`,
        },
        response: { integration: integrationProjection(connection) },
      };
    },
  });
}

async function getInstallationOrganization(organizationId, operator) {
  return db.sequelize.transaction(async (transaction) => {
    await installationOperatorAuth.lockSessionAuthority(operator, transaction);
    await assertTenantFoundationInitialized({ strict: true, transaction });
    const organization = await db.Organization.findByPk(Number(organizationId), {
      attributes: ['createdAt', 'id', 'name', 'status', 'updatedAt'],
      include: [{
        attributes: ['id', 'name', 'status', 'timezone', 'updatedAt'],
        model: db.Club,
        required: false,
      }],
      transaction,
    });
    if (!organization) {
      throw managementError('Организация не найдена', 404, 'INSTALLATION_ORGANIZATION_NOT_FOUND');
    }
    const connections = await db.IntegrationConnection.unscoped().findAll({
      attributes: [
        'clubId', 'config', 'metadata', 'provider', 'secretUpdatedAt', 'status', 'updatedAt',
      ],
      order: [['clubId', 'ASC'], ['provider', 'ASC'], ['id', 'ASC']],
      transaction,
      where: { organizationId: organization.id },
    });
    const slots = new Map();
    for (const connection of connections) {
      const key = `${connection.clubId}:${connection.provider}`;
      if (!slots.has(key)) slots.set(key, connection);
    }
    return {
      clubs: (organization.Clubs || []).sort((a, b) => a.id - b.id).map((club) => ({
        ...clubProjection(club),
        integrations: PROVIDERS.map((provider) => integrationProjection(
          slots.get(`${club.id}:${provider}`),
          provider,
        )),
      })),
      createdAt: organization.createdAt,
      ...organizationProjection(organization),
    };
  });
}

module.exports = {
  _private: {
    canonicalTimezone,
    integrationProjection,
    normalizeNameKey,
    payloadHash,
    runMutation,
  },
  configureIntegration,
  getInstallationOrganization,
  listBotRunnerScopes,
  rotateIntegrationCredential,
  restartIntegration,
  runBeelineAction,
  setClubLifecycle,
  setIntegrationStatus,
  setOrganizationLifecycle,
  updateClub,
  updateOrganization,
  validateIntegration,
};
