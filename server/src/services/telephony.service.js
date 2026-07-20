const axios = require('axios');
const crypto = require('node:crypto');
const { Op } = require('sequelize');
const db = require('../../models');
const clientsService = require('./clients.service');
const {
  callTaskTenantWhere,
  resolveEligibleCallTaskAccount,
  resolveStoredCallTaskContext,
} = require('./call-task-access-context.service');
const {
  bookingTenantWhere,
  resolveBookingAccessContext,
} = require('./booking-access-context.service');
const {
  assertTenantFoundationInitialized,
} = require('./tenant-foundation.service');
const {
  isTenantFilesWorkersEnabled,
  isTenantBookingsCourtsEnabled,
  isTenantProviderIntegrationsEnabled,
} = require('../tenant-context/capabilities');
const {
  listActiveConnections,
  resolveConnectionForTenantById,
  resolveOptionalTenantConnection,
  resolveTenantConnection,
} = require('../provider-integrations/connection-service');
const {
  buildProviderIdempotencyKey,
  buildProviderNamespace,
} = require('../provider-integrations/idempotency');
const {
  withProviderConnectionLock,
} = require('../provider-integrations/locks');
const {
  assertLegacyDownstreamReady,
  requireConnectionSecret,
} = require('../provider-integrations/runtime');
const {
  BEELINE_WEBHOOK_AUTH_MODES,
  buildCapabilityCallbackUrl,
  redactCapabilityValue,
} = require('../provider-integrations/beeline-callback');
const {
  requireAuthenticatedIngressContext,
} = require('../provider-integrations/ingress-context');
const {
  redactProviderCredentials,
  redactProviderValue,
} = require('../provider-integrations/redaction');
const {
  runIsolatedProviderConnections,
} = require('../provider-integrations/runner');
const {
  resolveLegacyProviderContext,
} = require('../provider-integrations/rollout');
const {
  isProviderCredentialKey,
} = require('../provider-integrations/credential-keys');
const {
  BACKGROUND_COMPONENTS,
  assertBackgroundComponentCanRun,
} = require('../files-workers/background-run-context');
const {
  getExactDefaultTenant,
  normalizeTenantIds,
  resolveTrustedTenantAttribution,
  tenantRoutingMetadata,
} = require('../files-workers/tenant-context');
const {
  WORKER_PROTOCOL_VERSION,
  assertActiveLease,
  createLease,
  getLeaseDurationMs,
  publicLease,
} = require('../files-workers/transcription-lease');
const {
  formatRussianPhone,
  getPhoneLookupDigits,
  normalizedPhoneColumn,
} = require('../utils/phone');

const CALL_RESULTS = new Set([
  'booked',
  'refused',
  'thinking',
  'callback',
  'complaint',
  'corporate',
  'no_answer',
  'other',
]);
const CALL_INTERESTS = new Set([
  'game',
  'training',
  'tournament',
  'master_class',
  'corporate',
  'other',
]);
const PROCESSING_STATUSES = new Set([
  'new',
  'in_progress',
  'processed',
  'ignored',
]);
const TRANSCRIPTION_STATUSES = new Set(['queued', 'processing', 'completed', 'failed']);
const TRANSCRIPT_SPEAKERS = new Set(['administrator', 'client', 'unknown']);
const SUBSCRIPTION_TYPES = new Set(['BASIC_CALL', 'ADVANCED_CALL']);
const DEFAULT_MISSED_CALL_DEADLINE_MINUTES = 15;
const DEFAULT_SUBSCRIPTION_RENEW_BEFORE_SECONDS = 10 * 60;
const DEFAULT_REPORT_DAYS = 30;
const SUBSCRIPTION_LOCK_NAME = 'padel_park_beeline_xsi_subscription';
const DEFAULT_TRANSCRIPTION_BACKFILL_LIMIT = 50;

function tenantJobWhere(tenant) {
  if (!isTenantFilesWorkersEnabled()) return {};
  return normalizeTenantIds(tenant);
}

function withTenantJobWhere(where, tenant) {
  return { ...(where || {}), ...tenantJobWhere(tenant) };
}

function assertPlatformWorker(worker) {
  if (
    worker?.scope !== 'platform' ||
    !worker?.credentialId ||
    Number(worker?.protocolVersion) !== WORKER_PROTOCOL_VERSION
  ) {
    const error = appError('Unauthorized worker', 401);
    error.code = 'WORKER_CREDENTIAL_INVALID';
    throw error;
  }
  return worker;
}

const RESULT_LABELS = {
  booked: 'Записался',
  callback: 'Перезвонить',
  complaint: 'Жалоба',
  corporate: 'Корпоратив',
  no_answer: 'Не взял трубку',
  other: 'Другое',
  refused: 'Отказ',
  thinking: 'Думает',
};

const INTEREST_LABELS = {
  corporate: 'Корпоратив',
  game: 'Игра',
  master_class: 'Мастер-класс',
  other: 'Другое',
  tournament: 'Турнир',
  training: 'Тренировка',
};

const PROCESSING_LABELS = {
  ignored: 'Скрыт',
  in_progress: 'В обработке',
  new: 'Новый',
  processed: 'Обработан',
};

function appError(message, statusCode = 400, details = undefined) {
  const error = new Error(message);
  error.statusCode = statusCode;
  if (details) error.details = details;
  return error;
}

function normalizeText(value) {
  const normalized = String(value || '').trim();
  return normalized || null;
}

function readBooleanEnv(name, defaultValue = false) {
  const value = process.env[name];
  if (value === undefined || value === null || value === '') return defaultValue;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function connectionConfig(connection, key, envName, fallback = null) {
  if (connection) {
    const value = connection.config?.[key];
    return value === undefined || value === null || value === '' ? fallback : value;
  }
  const value = process.env[envName];
  return value === undefined || value === null || value === '' ? fallback : value;
}

function connectionAttribution(connection) {
  if (!connection) {
    return { providerNamespace: buildProviderNamespace(null) };
  }
  return {
    clubId: connection.clubId,
    integrationConnectionId: connection.connectionId || null,
    organizationId: connection.organizationId,
    providerNamespace: buildProviderNamespace(connection),
  };
}

function rawEventConnection(rawEvent) {
  if (!rawEvent?.organizationId || !rawEvent?.clubId) return null;
  return Object.freeze({
    clubId: Number(rawEvent.clubId),
    connectionId: rawEvent.integrationConnectionId
      ? Number(rawEvent.integrationConnectionId)
      : null,
    legacy: !rawEvent.integrationConnectionId,
    organizationId: Number(rawEvent.organizationId),
    provider: rawEvent.provider,
  });
}

async function resolveBeelineWriteContext(connection = null) {
  return connection || resolveLegacyProviderContext('beeline');
}

async function resolveBeelineTenantConnection(tenant, supplied = null) {
  if (supplied) return supplied;
  if (!isTenantProviderIntegrationsEnabled()) {
    const targetTenant = tenant || await getExactDefaultTenant();
    return resolveOptionalTenantConnection({
      connectionKey: 'default',
      provider: 'beeline',
      tenant: targetTenant,
    });
  }
  return resolveTenantConnection({ connectionKey: 'default', provider: 'beeline', tenant });
}

function getSubscriptionExpiresSeconds(connection = null) {
  const value = Number(connectionConfig(
    connection,
    'subscriptionExpiresSeconds',
    'BEELINE_SUBSCRIPTION_EXPIRES',
    3600,
  ));
  return Number.isFinite(value) && value > 0 ? value : 3600;
}

function getSubscriptionRenewBeforeSeconds(connection = null) {
  const value = Number(connectionConfig(
    connection,
    'subscriptionRenewBeforeSeconds',
    'BEELINE_SUBSCRIPTION_RENEW_BEFORE_SECONDS',
    null,
  ));
  if (Number.isFinite(value) && value >= 60) return value;

  return Math.min(
    DEFAULT_SUBSCRIPTION_RENEW_BEFORE_SECONDS,
    Math.max(60, Math.floor(getSubscriptionExpiresSeconds(connection) / 3)),
  );
}

function isSubscriptionAutoRenewEnabled(connection = null) {
  if (connection) return Boolean(connection.config?.subscriptionAutoRenewEnabled);
  return readBooleanEnv('BEELINE_SUBSCRIPTION_AUTORENEW_ENABLED', false);
}

function isWebhookSecretRequired() {
  return readBooleanEnv(
    'BEELINE_WEBHOOK_REQUIRE_SECRET',
    process.env.NODE_ENV === 'production',
  );
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function getHeaderValue(headers = {}, name) {
  const wanted = String(name).toLowerCase();
  const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === wanted);
  const value = entry?.[1];
  return Array.isArray(value) ? value.join(', ') : normalizeText(value);
}

function parseJsonField(value) {
  if (!value || typeof value !== 'string') return value;

  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function getBeelineErrorMessage(error, fallback = 'Билайн отклонил запрос') {
  const data = error?.response?.data;
  const payload = asObject(data);
  const description =
    normalizeText(payload.description) ||
    normalizeText(payload.message) ||
    normalizeText(payload.error) ||
    normalizeText(error?.message);

  return description ? `${fallback}: ${description}` : fallback;
}

function sanitizeHeaders(headers = {}) {
  const sanitized = {};

  Object.entries(headers).forEach(([key, value]) => {
    if (isProviderCredentialKey(key)) {
      sanitized[key] = '[hidden]';
      return;
    }

    sanitized[key] = Array.isArray(value) ? value.join(', ') : String(value);
  });

  return sanitized;
}

function sanitizeQuery(query = {}) {
  const sanitized = {};

  Object.entries(asObject(query)).forEach(([key, value]) => {
    if (isProviderCredentialKey(key)) {
      sanitized[key] = '[hidden]';
      return;
    }

    sanitized[key] = Array.isArray(value) ? value.join(', ') : String(value);
  });

  return sanitized;
}

function decodeXmlEntities(value) {
  return String(value || '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .trim();
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getXmlTagText(xml, tagNames) {
  for (const tagName of tagNames) {
    const escaped = escapeRegExp(tagName);
    const pattern = new RegExp(
      `<(?:[\\w.-]+:)?${escaped}\\b[^>]*>([\\s\\S]*?)<\\/(?:[\\w.-]+:)?${escaped}>`,
      'i',
    );
    const match = String(xml || '').match(pattern);
    if (match?.[1]) {
      return decodeXmlEntities(match[1].replace(/<[^>]+>/g, ' '));
    }
  }

  return null;
}

function getXmlElementBlock(xml, tagNames) {
  for (const tagName of tagNames) {
    const escaped = escapeRegExp(tagName);
    const pattern = new RegExp(
      `<(?:[\\w.-]+:)?${escaped}\\b[^>]*>([\\s\\S]*?)<\\/(?:[\\w.-]+:)?${escaped}>`,
      'i',
    );
    const match = String(xml || '').match(pattern);
    if (match?.[1]) return match[1];
  }

  return null;
}

function getXmlTagTextInBlock(xml, blockTags, valueTags) {
  const block = getXmlElementBlock(xml, blockTags);
  return block ? getXmlTagText(block, valueTags) : null;
}

function getXmlAttributeInBlock(xml, blockTags, attributeNames) {
  const block = getXmlElementBlock(xml, blockTags);
  return block ? getXmlAttribute(block, attributeNames) : null;
}

function getXmlTagAttribute(xml, tagNames, attributeNames) {
  for (const tagName of tagNames) {
    const escaped = escapeRegExp(tagName);
    const pattern = new RegExp(`<(?:[\\w.-]+:)?${escaped}\\b[^>]*>`, 'i');
    const match = String(xml || '').match(pattern);
    if (match?.[0]) return getXmlAttribute(match[0], attributeNames);
  }

  return null;
}

function getXmlAttribute(xml, attributeNames) {
  for (const attributeName of attributeNames) {
    const escaped = escapeRegExp(attributeName);
    const pattern = new RegExp(
      `(?:^|\\s|:)${escaped}\\s*=\\s*["']([^"']+)["']`,
      'i',
    );
    const match = String(xml || '').match(pattern);
    if (match?.[1]) return decodeXmlEntities(match[1]);
  }

  return null;
}

function normalizeXmlPhone(value) {
  const text = normalizeText(value);
  if (!text) return null;
  return text
    .replace(/^sip:/i, '')
    .replace(/^tel:/i, '')
    .replace(/@.+$/, '')
    .trim();
}

function parseBeelineXmlPayload(xml, headers = {}) {
  const rawBody = String(xml || '');
  const eventBlock = getXmlElementBlock(rawBody, ['eventData']) || rawBody;
  const eventType =
    getXmlTagAttribute(rawBody, ['eventData'], ['type']) ||
    getXmlAttributeInBlock(rawBody, ['eventData'], ['type']) ||
    getXmlTagText(eventBlock, ['eventType', 'eventDataType']) ||
    'xsi.xml';
  const state = getXmlTagText(eventBlock, ['state', 'status']);
  const personality = getXmlTagText(eventBlock, ['personality', 'callType']);
  const lowerEventType = String(eventType || '').toLowerCase();
  const direction =
    String(personality || '').toLowerCase() === 'originator'
      ? 'outbound'
      : String(personality || '').toLowerCase() === 'terminator'
        ? 'inbound'
        : lowerEventType.includes('originated')
          ? 'outbound'
          : lowerEventType.includes('received')
            ? 'inbound'
            : undefined;
  const remotePhone = normalizeXmlPhone(
    getXmlTagTextInBlock(eventBlock, ['remoteParty', 'remoteEndpoint'], [
      'address',
      'addressOfRecord',
      'phoneNumber',
      'phone',
    ]) ||
      getXmlTagText(eventBlock, [
        'remoteAddress',
        'remotePartyAddress',
        'remotePhoneNumber',
        'remotePhone',
      ]),
  );
  const localPhone = normalizeXmlPhone(
    getXmlTagTextInBlock(eventBlock, ['endpoint', 'localParty', 'localEndpoint'], [
      'address',
      'addressOfRecord',
      'primaryPhoneNumber',
      'phoneNumber',
      'phone',
    ]) ||
      getXmlTagText(eventBlock, ['localAddress', 'addressOfRecord', 'primaryPhoneNumber']),
  );

  return {
    rawBody,
    contentType: getHeaderValue(headers, 'content-type'),
    eventType,
    status: state || eventType,
    direction,
    callId: getXmlTagText(eventBlock, ['callId', 'callID', 'call_id']),
    externalEventId: getXmlTagText(eventBlock, ['eventID', 'eventId', 'event_id']),
    externalTrackingId: getXmlTagText(eventBlock, [
      'externalTrackingId',
      'extTrackingId',
      'trackingId',
    ]),
    startDate: getXmlTagText(eventBlock, ['startTime', 'startDate', 'startedAt', 'timestamp']),
    endedAt: getXmlTagText(eventBlock, ['endTime', 'endDate', 'endedAt']),
    duration: getXmlTagText(eventBlock, ['duration', 'callDuration']),
    phone: remotePhone,
    employeePhone: localPhone,
    extension: getXmlTagText(eventBlock, ['extension', 'ext']),
    userId: getXmlTagText(eventBlock, ['userId', 'targetId', 'subscriberId']),
  };
}

function parseIncomingBeelinePayload(body, headers = {}) {
  if (Array.isArray(body)) return body;
  if (body && typeof body === 'object') return [body];

  const text = Buffer.isBuffer(body) ? body.toString('utf8') : String(body || '').trim();
  if (!text) return [{}];

  if (text.startsWith('<')) {
    return [parseBeelineXmlPayload(text, headers)];
  }

  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return [{
      rawBody: text,
      contentType: getHeaderValue(headers, 'content-type'),
      eventType: 'beeline.raw',
    }];
  }
}

async function getConfig(tenant = null) {
  const connection = await resolveBeelineTenantConnection(tenant);
  if (connection) {
    const capabilityMode = connection.config.webhookAuthMode ===
      BEELINE_WEBHOOK_AUTH_MODES.CAPABILITY_URI;
    return {
      apiBaseUrl: connection.config.apiBaseUrl || null,
      apiTokenConfigured: Boolean(connection.secrets.apiToken),
      callbackUrl: capabilityMode
        ? redactCapabilityValue(buildCapabilityCallbackUrl(connection))
        : connection.config.callbackUrl || null,
      connectionConfigured: true,
      connectionPublicId: connection.publicId,
      latestSubscription: await getLatestSubscription({ connection }),
      recordsPath: connection.config.recordsPath || '/records',
      statisticsPath: connection.config.statisticsPath || '/v2/statistics',
      subscriptionAutoRenewEnabled: isSubscriptionAutoRenewEnabled(connection),
      subscriptionRenewBeforeSeconds: getSubscriptionRenewBeforeSeconds(connection),
      subscriptionPath: connection.config.subscriptionPath || '/subscription',
      webhookSecretRequired: !capabilityMode,
      webhookSecretConfigured: capabilityMode
        ? false
        : Boolean(connection.secrets.webhookSecret),
    };
  }
  return {
    apiBaseUrl: normalizeText(process.env.BEELINE_API_BASE_URL),
    apiTokenConfigured: Boolean(normalizeText(process.env.BEELINE_API_TOKEN)),
    callbackUrl: normalizeText(process.env.BEELINE_CALLBACK_URL),
    latestSubscription: await getLatestSubscription(),
    recordsPath: normalizeText(process.env.BEELINE_RECORDS_PATH) || '/records',
    statisticsPath: normalizeText(process.env.BEELINE_STATISTICS_PATH) || '/v2/statistics',
    subscriptionAutoRenewEnabled: isSubscriptionAutoRenewEnabled(),
    subscriptionRenewBeforeSeconds: getSubscriptionRenewBeforeSeconds(),
    subscriptionPath: normalizeText(process.env.BEELINE_SUBSCRIPTION_PATH) || '/subscription',
    webhookSecretRequired: isWebhookSecretRequired(),
    webhookSecretConfigured: Boolean(normalizeText(process.env.BEELINE_WEBHOOK_SECRET)),
  };
}

function getByPath(source, path) {
  return String(path)
    .split('.')
    .reduce((current, key) => {
      if (!current || typeof current !== 'object') return undefined;
      return current[key];
    }, source);
}

function findByKey(source, keys, depth = 0) {
  if (!source || typeof source !== 'object' || depth > 6) return undefined;
  const wanted = new Set(keys.map((key) => String(key).toLowerCase()));

  for (const [key, value] of Object.entries(source)) {
    if (wanted.has(String(key).toLowerCase()) && value !== undefined && value !== null && value !== '') {
      return value;
    }
  }

  for (const value of Object.values(source)) {
    if (value && typeof value === 'object') {
      const nested = findByKey(value, keys, depth + 1);
      if (nested !== undefined && nested !== null && nested !== '') return nested;
    }
  }

  return undefined;
}

function pickValue(source, paths = [], keys = []) {
  for (const path of paths) {
    const value = getByPath(source, path);
    if (value !== undefined && value !== null && value !== '') return value;
  }

  return findByKey(source, keys);
}

function normalizeDirection(value) {
  const normalized = String(value || '').toLowerCase();
  if (['inbound', 'incoming', 'in', 'входящий'].includes(normalized)) return 'inbound';
  if (['outbound', 'outgoing', 'out', 'placed', 'исходящий'].includes(normalized)) return 'outbound';
  if (normalized.includes('callreceivedevent')) return 'inbound';
  if (normalized.includes('calloriginatedevent')) return 'outbound';
  return 'unknown';
}

function inferDirection(raw, statusValue) {
  const explicit = normalizeDirection(
    pickValue(raw, ['direction', 'call.direction'], ['direction', 'callDirection']),
  );
  if (explicit !== 'unknown') return explicit;

  const status = String(statusValue || '').toLowerCase();
  if (['placed'].includes(status) || status.includes('calloriginatedevent')) return 'outbound';
  if (
    ['recieved', 'received', 'missed'].includes(status) ||
    status.includes('callreceivedevent') ||
    status.includes('callnotansweredevent')
  ) return 'inbound';

  if (pickValue(raw, ['phone_from'], ['phone_from']) && pickValue(raw, ['phone_to'], ['phone_to'])) {
    return raw.abonent ? 'inbound' : 'unknown';
  }

  return 'unknown';
}

function normalizeCallStatus(value, direction = 'unknown') {
  const normalized = String(value || '').toLowerCase();
  if (
    ['ringing', 'alerting', 'incoming', 'originating'].includes(normalized) ||
    normalized.includes('callreceivedevent') ||
    normalized.includes('calloriginatedevent')
  ) return 'ringing';
  if (
    ['active', 'established', 'answered', 'received', 'recieved'].includes(normalized) ||
    normalized.includes('callansweredevent') ||
    normalized.includes('callheldevent') ||
    normalized.includes('callresumedevent')
  ) return 'answered';
  if (
    ['completed', 'complete', 'ended', 'finished', 'redirected', 'released', 'disconnected'].includes(normalized) ||
    normalized.includes('callreleasedevent') ||
    normalized.includes('callcompletedevent')
  ) {
    return 'completed';
  }
  if (
    ['missed', 'no_answer', 'notanswered', 'not_answered'].includes(normalized) ||
    normalized.includes('callnotansweredevent')
  ) return 'missed';
  if (['failed', 'busy', 'rejected', 'cancelled', 'canceled'].includes(normalized)) return 'failed';
  if (direction === 'outbound' && normalized === 'placed') return 'completed';
  return 'unknown';
}

function parseDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseReportDate(value, { endOfDay = false } = {}) {
  if (!value) return null;
  const raw = String(value).trim();
  const date = /^\d{4}-\d{2}-\d{2}$/.test(raw)
    ? new Date(`${raw}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}`)
    : new Date(raw);

  return Number.isNaN(date.getTime()) ? null : date;
}

function getReportRange(query = {}) {
  const now = new Date();
  const fallbackFrom = new Date(now);
  fallbackFrom.setDate(fallbackFrom.getDate() - (DEFAULT_REPORT_DAYS - 1));
  fallbackFrom.setHours(0, 0, 0, 0);

  const from = parseReportDate(query.from) || fallbackFrom;
  const to = parseReportDate(query.to, { endOfDay: true }) || now;

  if (from > to) {
    throw appError('Дата начала отчета не может быть позже даты окончания');
  }

  return { from, to };
}

function normalizeDurationSeconds(value, { unit = 'auto' } = {}) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return null;

  if (unit === 'milliseconds') return Math.round(number / 1000);
  return number > 1000 ? Math.round(number / 1000) : Math.round(number);
}

function isStatisticsPayload(payload, statusValue) {
  const raw = asObject(payload);
  const eventType = String(raw.eventType || raw.event || '').toLowerCase();
  if (eventType === 'statistics') return true;

  const status = String(statusValue || '').toLowerCase();
  return Boolean(
    typeof raw.startDate === 'number' &&
      raw.abonent &&
      ['placed', 'recieved', 'received', 'missed'].includes(status),
  );
}

function getPhoneFromPayload(payload, direction) {
  const directPhone = pickValue(
    payload,
    ['phone', 'client.phone', 'customer.phone'],
    [
      'clientPhone',
      'customerPhone',
      'remotePhone',
      'remoteNumber',
      'callingNumber',
      'callerNumber',
      'phoneNumber',
      'phone',
    ],
  );
  const phoneFrom = pickValue(payload, ['phone_from', 'from.phone', 'caller.phone'], ['phone_from']);
  const phoneTo = pickValue(payload, ['phone_to', 'to.phone', 'callee.phone'], ['phone_to']);

  if (direction === 'outbound') return phoneTo || directPhone;
  if (direction === 'inbound') return phoneFrom || directPhone;
  return directPhone || phoneFrom || phoneTo;
}

function getEmployeePhoneFromPayload(payload, direction) {
  const abonentPhone = pickValue(
    payload,
    ['abonent.phone', 'abonent.number', 'employeePhone'],
    ['abonentPhone', 'employeePhone'],
  );
  const phoneFrom = pickValue(payload, ['phone_from'], ['phone_from']);
  const phoneTo = pickValue(payload, ['phone_to'], ['phone_to']);

  if (abonentPhone) return abonentPhone;
  if (direction === 'outbound') return phoneFrom || null;
  if (direction === 'inbound') return phoneTo || null;
  return null;
}

function normalizePayload(payload) {
  const raw = asObject(payload);
  const statusValue = pickValue(raw, ['status', 'eventType', 'event', 'state'], [
    'status',
    'eventType',
    'event',
    'state',
  ]);
  const direction = inferDirection(raw, statusValue);
  const callStatus = normalizeCallStatus(statusValue, direction);
  const startedAt = parseDate(
    pickValue(raw, ['startDate', 'startedAt', 'date', 'call.startDate'], [
      'startDate',
      'startedAt',
      'startTime',
      'date',
    ]),
  );
  const answeredAt = parseDate(
    pickValue(raw, ['answeredAt', 'answerDate', 'establishedAt'], [
      'answeredAt',
      'answerDate',
      'establishedAt',
    ]),
  );
  const durationSeconds = normalizeDurationSeconds(
    pickValue(raw, ['duration', 'durationMs', 'callDuration'], [
      'duration',
      'durationMs',
      'callDuration',
    ]),
    { unit: isStatisticsPayload(raw, statusValue) ? 'milliseconds' : 'auto' },
  );
  const endedAt = parseDate(
    pickValue(raw, ['endedAt', 'endDate', 'completedAt'], [
      'endedAt',
      'endDate',
      'completedAt',
    ]),
  ) || (startedAt && durationSeconds ? new Date(startedAt.getTime() + durationSeconds * 1000) : null);
  const clientPhone = getPhoneFromPayload(raw, direction);
  const clientPhoneNormalized = getPhoneLookupDigits(clientPhone);
  const employeePhone = getEmployeePhoneFromPayload(raw, direction);
  const externalTrackingId = normalizeText(
    pickValue(raw, ['externalTrackingId', 'extTrackingId'], [
      'externalTrackingId',
      'extTrackingId',
      'trackingId',
    ]),
  );
  const externalCallId = normalizeText(
    pickValue(raw, ['callId', 'call.id'], ['callId', 'callID', 'call_id']),
  );
  const recordId = normalizeText(
    pickValue(raw, ['recordId', 'record.id'], ['recordId', 'record_id']),
  );
  const eventType = normalizeText(
    pickValue(raw, ['eventType', 'event', 'status'], ['eventType', 'event', 'status']),
  );

  return {
    abonentExtension: normalizeText(
      pickValue(raw, ['abonent.extension', 'extension'], ['extension']),
    ),
    answeredAt,
    beelineUserId: normalizeText(
      pickValue(raw, ['abonent.userId', 'userId'], ['userId', 'abonentId']),
    ),
    callStatus,
    clientPhone: clientPhone ? formatRussianPhone(clientPhone) : null,
    clientPhoneNormalized:
      clientPhoneNormalized.length === 10 ? clientPhoneNormalized : null,
    direction,
    durationSeconds,
    employeePhone: employeePhone ? String(employeePhone).trim() : null,
    endedAt,
    eventType,
    externalCallId,
    externalEventId: normalizeText(
      pickValue(raw, ['eventId', 'externalEventId'], ['eventId', 'externalEventId']),
    ),
    externalTrackingId,
    recordExternalId: normalizeText(
      pickValue(raw, ['recordExternalId', 'externalId'], [
        'recordExternalId',
        'externalId',
      ]),
    ),
    recordId,
    recordingStatus: recordId ? 'available' : 'unknown',
    startedAt,
  };
}

function normalizeRecordingPayload(payload) {
  const raw = asObject(payload);
  const direction = normalizeDirection(raw.direction);
  const startedAt = parseDate(raw.date || raw.startDate || raw.startedAt);
  const clientPhone = getPhoneFromPayload(raw, direction);
  const clientPhoneNormalized = getPhoneLookupDigits(clientPhone);
  const durationSeconds = normalizeDurationSeconds(raw.duration, {
    unit: 'milliseconds',
  });

  return {
    abonentExtension: normalizeText(
      pickValue(raw, ['abonent.extension', 'extension'], ['extension']),
    ),
    beelineUserId: normalizeText(
      pickValue(raw, ['abonent.userId', 'userId'], ['userId', 'abonentId']),
    ),
    callStatus: durationSeconds && durationSeconds > 0 ? 'completed' : 'unknown',
    clientPhone: clientPhone ? formatRussianPhone(clientPhone) : null,
    clientPhoneNormalized:
      clientPhoneNormalized.length === 10 ? clientPhoneNormalized : null,
    direction,
    durationSeconds,
    endedAt:
      startedAt && durationSeconds
        ? new Date(startedAt.getTime() + durationSeconds * 1000)
        : null,
    eventType: 'recording',
    externalCallId: normalizeText(raw.callId),
    externalTrackingId: null,
    recordExternalId: normalizeText(raw.externalId),
    recordingFileSize:
      Number.isFinite(Number(raw.fileSize)) && Number(raw.fileSize) >= 0
        ? Number(raw.fileSize)
        : null,
    recordingStatus: normalizeText(raw.id) ? 'available' : 'unknown',
    recordId: normalizeText(raw.id),
    startedAt,
  };
}

function callInclude() {
  return [
    {
      model: db.User,
      as: 'client',
      attributes: ['id', 'name', 'phone', 'phoneNormalized', 'source', 'status'],
    },
    {
      model: db.Staff,
      as: 'staff',
      attributes: ['id', 'name', 'role', 'phone', 'status'],
    },
    {
      model: db.Account,
      as: 'processedByAccount',
      attributes: ['id', 'email', 'role', 'staffId'],
      include: [{ model: db.Staff, attributes: ['id', 'name'] }],
    },
    {
      model: db.CallTask,
      as: 'followUpCallTask',
      attributes: ['id', 'title', 'status', 'dueAt'],
    },
  ];
}

function mapAccount(account) {
  if (!account) return null;
  const raw = account.toJSON ? account.toJSON() : account;
  return {
    email: raw.email,
    id: raw.id,
    name: raw.Staff?.name || raw.email,
    role: raw.role,
  };
}

function canAccessRecordingUrl(actor = null) {
  return ['owner', 'manager', 'admin'].includes(actor?.role);
}

function canAccessTranscription(actor = null) {
  return ['owner', 'manager', 'admin'].includes(actor?.role);
}

function mapTranscriptSegment(row) {
  if (!row) return null;
  const raw = row.toJSON ? row.toJSON() : row;

  return {
    channel: raw.channel || null,
    confidence: raw.confidence == null ? null : Number(raw.confidence),
    endMs: raw.endMs,
    id: raw.id,
    sortOrder: raw.sortOrder,
    speaker: raw.speaker,
    startMs: raw.startMs,
    text: raw.text,
  };
}

function buildTranscriptTextFromSegments(segments = []) {
  const text = (segments || [])
    .map((segment) => normalizeText(segment?.text))
    .filter(Boolean)
    .join('\n');
  return text || null;
}

function compareTranscriptSegments(left, right) {
  const leftHasStart =
    left?.startMs !== null &&
    left?.startMs !== undefined &&
    left?.startMs !== '' &&
    Number.isFinite(Number(left.startMs));
  const rightHasStart =
    right?.startMs !== null &&
    right?.startMs !== undefined &&
    right?.startMs !== '' &&
    Number.isFinite(Number(right.startMs));
  const leftStart = Number(left?.startMs);
  const rightStart = Number(right?.startMs);

  if (leftHasStart && rightHasStart && leftStart !== rightStart) {
    return leftStart - rightStart;
  }
  if (leftHasStart !== rightHasStart) {
    return leftHasStart ? -1 : 1;
  }

  const sortOrderDiff = Number(left?.sortOrder || 0) - Number(right?.sortOrder || 0);
  if (sortOrderDiff !== 0) return sortOrderDiff;

  return Number(left?.id || 0) - Number(right?.id || 0);
}

function mapTranscriptionJob(row, options = {}) {
  if (!row) return null;
  const raw = row.toJSON ? row.toJSON() : row;
  const mapped = {
    attemptCount: raw.attemptCount,
    clubId: raw.clubId,
    claimedAt: raw.claimedAt,
    completedAt: raw.completedAt,
    createdAt: raw.createdAt,
    errorMessage: raw.errorMessage,
    failedAt: raw.failedAt,
    id: raw.id,
    organizationId: raw.organizationId,
    language: raw.language,
    aiCorrections: Array.isArray(raw.aiCorrections) ? raw.aiCorrections : [],
    aiMetadata: raw.aiMetadata || null,
    aiTranscriptSegments: Array.isArray(raw.aiTranscriptSegments)
      ? raw.aiTranscriptSegments
      : [],
    aiTranscriptText: raw.aiTranscriptText || null,
    corrections: Array.isArray(raw.corrections) ? raw.corrections : [],
    metadata: parseJsonField(raw.metadata),
    rawTranscriptText: raw.rawTranscriptText || null,
    status: raw.status,
    telephonyCallId: raw.telephonyCallId,
    transcriptText: raw.transcriptText,
    updatedAt: raw.updatedAt,
  };

  if (options.includeSegments) {
    mapped.segments = (raw.segments || [])
      .map(mapTranscriptSegment)
      .filter(Boolean)
      .sort(compareTranscriptSegments);
    mapped.transcriptText = buildTranscriptTextFromSegments(mapped.segments) || mapped.transcriptText;
  }

  return mapped;
}

function mapTranscriptionCall(row) {
  if (!row) return null;
  const raw = row.toJSON ? row.toJSON() : row;

  return {
    callStatus: raw.callStatus,
    client: raw.client
      ? {
          id: raw.client.id,
          name: raw.client.name,
          phone: raw.client.phone,
          status: raw.client.status,
        }
      : null,
    clientPhone: raw.clientPhone,
    direction: raw.direction,
    durationSeconds: raw.durationSeconds,
    id: raw.id,
    recordingStatus: raw.recordingStatus,
    staff: raw.staff
      ? {
          id: raw.staff.id,
          name: raw.staff.name,
          role: raw.staff.role,
        }
      : null,
    startedAt: raw.startedAt,
  };
}

function mapUserTranscriptionJob(row, options = {}) {
  if (!row) return null;
  const raw = row.toJSON ? row.toJSON() : row;
  const mapped = mapTranscriptionJob(raw, options);
  mapped.call = mapTranscriptionCall(raw.call);
  return mapped;
}

function mapWorkerTranscriptionJob(row, options = {}) {
  if (!row) return null;
  const raw = row.toJSON ? row.toJSON() : row;
  const mapped = mapTranscriptionJob(raw, options);
  mapped.workerId = raw.workerId || null;
  if (isTenantFilesWorkersEnabled()) {
    mapped.tenant = tenantRoutingMetadata(raw);
  }
  if (options.includeLeaseStatus) {
    mapped.claim = {
      attempt: Number(raw.attemptCount || 0),
      claimId: raw.claimId || null,
      expiresAt: raw.claimExpiresAt || null,
      protocolVersion: raw.workerProtocolVersion || null,
    };
  }
  if (options.minimal) {
    delete mapped.aiCorrections;
    delete mapped.aiMetadata;
    delete mapped.aiTranscriptSegments;
    delete mapped.aiTranscriptText;
    delete mapped.corrections;
    delete mapped.rawTranscriptText;
    delete mapped.transcriptText;
  }
  mapped.call = raw.call
    ? {
        callStatus: raw.call.callStatus,
        ...(options.includeSensitiveRelations
          ? {
              client: raw.call.client
                ? {
                    id: raw.call.client.id,
                    name: raw.call.client.name,
                    phone: raw.call.client.phone,
                    status: raw.call.client.status,
                  }
                : null,
              clientPhone: raw.call.clientPhone,
              staff: raw.call.staff
                ? {
                    id: raw.call.staff.id,
                    name: raw.call.staff.name,
                    role: raw.call.staff.role,
                  }
                : null,
            }
          : {}),
        direction: raw.call.direction,
        durationSeconds: raw.call.durationSeconds,
        id: raw.call.id,
        recordingStatus: raw.call.recordingStatus,
        startedAt: raw.call.startedAt,
      }
    : null;

  return mapped;
}

function workerQueueCallInclude(options = {}) {
  const includeSensitiveRelations = Boolean(options.includeSensitiveRelations);
  return {
    model: db.TelephonyCall,
    as: 'call',
    attributes: [
      'callStatus',
      ...(includeSensitiveRelations ? ['clientPhone'] : []),
      'direction',
      'durationSeconds',
      'id',
      'recordingStatus',
      'startedAt',
    ],
    include: includeSensitiveRelations
      ? [
          {
            model: db.User,
            as: 'client',
            attributes: ['id', 'name', 'phone', 'status'],
          },
          {
            model: db.Staff,
            as: 'staff',
            attributes: ['id', 'name', 'role'],
          },
        ]
      : [],
    required: true,
  };
}

function mapCall(row, actor = null, options = {}) {
  if (!row) return null;
  const raw = row.toJSON ? row.toJSON() : row;
  const transcriptionJob =
    options.transcriptionJob ||
    (Array.isArray(raw.transcriptionJobs) ? raw.transcriptionJobs[0] : null);
  const mapped = {
    ...raw,
    client: raw.client || null,
    isNewClient: Boolean(
      raw.direction === 'inbound' &&
        raw.clientPhoneNormalized &&
        !raw.userId &&
        !raw.client,
    ),
    processedByAccount: mapAccount(raw.processedByAccount),
  };

  delete mapped.rawSnapshot;
  delete mapped.providerNamespace;
  delete mapped.integrationConnectionId;
  delete mapped.transcriptionJobs;
  delete mapped.transcriptSegments;
  if (!canAccessRecordingUrl(actor)) {
    delete mapped.recordingStatus;
    delete mapped.recordingUrl;
    delete mapped.recordingExpiresAt;
    delete mapped.recordingFileSize;
    delete mapped.recordingFileType;
    delete mapped.recordingSyncedAt;
    delete mapped.recordId;
    delete mapped.recordExternalId;
  }
  if (canAccessTranscription(actor)) {
    mapped.transcription = mapTranscriptionJob(transcriptionJob, {
      includeSegments: Boolean(options.includeTranscriptSegments),
    });
  } else {
    delete mapped.transcription;
  }

  return mapped;
}

function mapRawEvent(row) {
  if (!row) return null;
  const raw = row.toJSON ? row.toJSON() : row;

  const mapped = {
    ...raw,
    headers: parseJsonField(raw.headers),
    payload: parseJsonField(raw.payload),
    query: parseJsonField(raw.query),
  };
  delete mapped.idempotencyKey;
  delete mapped.integrationConnectionId;
  return mapped;
}

async function findClientByPhone(clientPhoneNormalized, tenant = null) {
  if (!clientPhoneNormalized) return null;
  return clientsService.findActiveByPhone(clientPhoneNormalized, tenant);
}

async function findStaffByPayload(normalized) {
  if (normalized.employeePhone) {
    const employeeLookup = getPhoneLookupDigits(normalized.employeePhone);
    if (employeeLookup.length === 10) {
      return db.Staff.findOne({
        where: {
          [Op.and]: db.Sequelize.where(normalizedPhoneColumn('phone'), {
            [Op.like]: `%${employeeLookup}`,
          }),
          status: { [Op.ne]: 'archived' },
        },
        order: [['updatedAt', 'DESC']],
      });
    }
  }

  return null;
}

async function findExistingCall(normalized, transaction = undefined, connection = null) {
  const or = [];
  if (normalized.externalTrackingId) {
    or.push({ externalTrackingId: normalized.externalTrackingId });
  }
  if (normalized.externalCallId) {
    or.push({ externalCallId: normalized.externalCallId });
  }
  if (normalized.recordId) {
    or.push({ recordId: normalized.recordId });
  }
  if (normalized.recordExternalId) {
    or.push({ recordExternalId: normalized.recordExternalId });
  }
  if (normalized.clientPhoneNormalized && normalized.startedAt) {
    or.push({
      clientPhoneNormalized: normalized.clientPhoneNormalized,
      startedAt: normalized.startedAt,
    });
  }

  if (or.length === 0) return null;

  return db.TelephonyCall.findOne({
    where: {
      [Op.or]: or,
      providerNamespace: buildProviderNamespace(connection),
    },
    transaction,
  });
}

function hasStableCallIdentity(normalized) {
  return Boolean(
    normalized.externalTrackingId ||
      normalized.externalCallId ||
      normalized.recordId ||
      normalized.recordExternalId ||
      (normalized.clientPhoneNormalized && normalized.startedAt),
  );
}

function isServiceXsiEvent(normalized, payload = {}) {
  const eventType = String(normalized.eventType || payload.eventType || '').toLowerCase();
  const contentType = String(payload.contentType || '').toLowerCase();

  return Boolean(
    eventType.includes('subscription') ||
      eventType.includes('channel') ||
      eventType.includes('heartbeat') ||
      eventType.includes('keepalive') ||
      (payload.rawBody && contentType.includes('xml') && !hasStableCallIdentity(normalized)),
  );
}

function compactCallPayload(payload, { forUpdate = false } = {}) {
  const compacted = {};

  Object.entries(payload).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;
    if (
      forUpdate &&
      ((key === 'direction' && value === 'unknown') ||
        (key === 'callStatus' && value === 'unknown') ||
        (key === 'recordingStatus' && value === 'unknown'))
    ) {
      return;
    }

    compacted[key] = value;
  });

  return compacted;
}

async function createMissedCallTask(call, transaction = undefined) {
  if (
    call.callStatus !== 'missed' ||
    call.direction !== 'inbound' ||
    call.followUpCallTaskId
  ) {
    return null;
  }

  const referenceDate = call.startedAt ? new Date(call.startedAt) : new Date();
  const ageMs = Date.now() - referenceDate.getTime();
  if (
    Number.isFinite(ageMs) &&
    ageMs > DEFAULT_MISSED_CALL_DEADLINE_MINUTES * 60 * 1000
  ) {
    return null;
  }

  const dueAt = new Date(referenceDate.getTime() + DEFAULT_MISSED_CALL_DEADLINE_MINUTES * 60 * 1000);
  const context = await resolveStoredCallTaskContext(call, { transaction });
  const client = call.userId
    ? await db.User.findOne({
        transaction,
        where: {
          id: call.userId,
          organizationId: context.organizationId,
        },
      })
    : null;
  if (call.userId && !client) {
    throw appError('Клиент звонка не принадлежит организации клуба', 409);
  }
  const fallbackName = call.clientPhone || 'Новый клиент';
  const taskTitleName = client?.name || fallbackName;

  const task = await db.CallTask.create(
    {
      assignedToAccountId: null,
      clubId: context.clubId,
      clientBaseId: null,
      createdByAccountId: null,
      description: [
        `Автоматически создано из пропущенного звонка ${call.clientPhone || ''}`.trim(),
        client ? null : 'Номер не найден в клиентской базе CRM.',
      ].filter(Boolean).join(' '),
      dueAt,
      organizationId: context.organizationId,
      scopeType: 'snapshot',
      snapshotClientCount: 1,
      status: 'backlog',
      title: `Перезвонить: ${taskTitleName}`,
    },
    { transaction },
  );

  await db.CallTaskClient.create(
    {
      callTaskId: task.id,
      clientName: client?.name || fallbackName,
      clientPhone: client?.phone || call.clientPhone || null,
      deadlineAt: dueAt,
      source: client?.source || 'Новый номер из звонка',
      status: 'new',
      userId: client?.id || null,
      visitCount: 0,
    },
    { transaction },
  );

  await call.update({ followUpCallTaskId: task.id }, { transaction });
  return task;
}

async function upsertCallFromNormalized(
  normalized,
  transaction = undefined,
  connection = null,
) {
  if (!hasStableCallIdentity(normalized)) {
    throw appError(
      'В событии Билайна нет стабильного идентификатора звонка или пары телефон+время',
      422,
    );
  }

  const existing = await findExistingCall(normalized, transaction, connection);
  const client = await findClientByPhone(
    normalized.clientPhoneNormalized,
    connection,
  );
  const staff = await findStaffByPayload(normalized);
  const payload = compactCallPayload(
    {
      abonentExtension: normalized.abonentExtension,
      answeredAt: normalized.answeredAt,
      beelineUserId: normalized.beelineUserId,
      callStatus: normalized.callStatus,
      clientPhone: normalized.clientPhone,
      clientPhoneNormalized: normalized.clientPhoneNormalized,
      direction: normalized.direction,
      durationSeconds: normalized.durationSeconds,
      employeePhone: normalized.employeePhone,
      endedAt: normalized.endedAt,
      externalCallId: normalized.externalCallId,
      externalTrackingId: normalized.externalTrackingId,
      ...connectionAttribution(connection),
      provider: 'beeline',
      rawSnapshot: normalized,
      recordExternalId: normalized.recordExternalId,
      recordId: normalized.recordId,
      recordingFileSize: normalized.recordingFileSize,
      recordingSyncedAt: normalized.recordId ? new Date() : null,
      recordingStatus: normalized.recordingStatus,
      staffId: staff?.id || null,
      startedAt: normalized.startedAt,
      userId: client?.id || null,
    },
    { forUpdate: Boolean(existing) },
  );
  if (existing?.userId) {
    payload.userId = existing.userId;
  }

  let call;
  try {
    call = existing
      ? await existing.update(payload, { transaction })
      : await db.TelephonyCall.create(payload, { transaction });
  } catch (error) {
    if (error.name !== 'SequelizeUniqueConstraintError') throw error;

    const duplicate = await findExistingCall(normalized, transaction, connection);
    if (!duplicate) throw error;
    const updatePayload = compactCallPayload(payload, { forUpdate: true });
    if (duplicate.userId) {
      updatePayload.userId = duplicate.userId;
    }
    call = await duplicate.update(updatePayload, { transaction });
  }

  await createMissedCallTask(call, transaction);
  return call;
}

async function findLikelyCallForRecording(
  recording,
  transaction = undefined,
  connection = null,
) {
  if (!recording.clientPhoneNormalized || !recording.startedAt) return null;

  const from = new Date(recording.startedAt.getTime() - 10 * 60 * 1000);
  const to = new Date(recording.startedAt.getTime() + 10 * 60 * 1000);
  const where = {
    clientPhoneNormalized: recording.clientPhoneNormalized,
    provider: 'beeline',
    providerNamespace: buildProviderNamespace(connection),
    startedAt: { [Op.between]: [from, to] },
  };
  if (recording.direction !== 'unknown') where.direction = recording.direction;

  const candidates = await db.TelephonyCall.findAll({
    limit: 30,
    order: [['startedAt', 'DESC']],
    transaction,
    where,
  });
  if (candidates.length === 0) return null;

  const scored = candidates
    .map((call) => {
      const timeScore = Math.abs(
        Number(new Date(call.startedAt).getTime()) - recording.startedAt.getTime(),
      ) / 1000;
      const durationScore =
        call.durationSeconds !== null && recording.durationSeconds !== null
          ? Math.abs(Number(call.durationSeconds) - Number(recording.durationSeconds))
          : 0;

      return { call, score: timeScore + durationScore * 2 };
    })
    .sort((left, right) => left.score - right.score);

  return scored[0]?.score <= 900 ? scored[0].call : null;
}

async function upsertCallFromRecording(
  recording,
  transaction = undefined,
  connection = null,
) {
  const existing =
    (await findExistingCall(recording, transaction, connection)) ||
    (await findLikelyCallForRecording(recording, transaction, connection));

  if (existing) {
    await existing.update(
      compactCallPayload(
        {
          externalCallId: recording.externalCallId || existing.externalCallId,
          rawSnapshot: {
            ...(asObject(existing.rawSnapshot)),
            recording,
          },
          recordExternalId: recording.recordExternalId,
          recordId: recording.recordId,
          recordingFileSize: recording.recordingFileSize,
          recordingStatus: 'available',
          recordingSyncedAt: new Date(),
        },
        { forUpdate: true },
      ),
      { transaction },
    );
    return existing;
  }

  return upsertCallFromNormalized(recording, transaction, connection);
}

async function saveRawEvent(rawEventPayload) {
  const where = { idempotencyKey: rawEventPayload.idempotencyKey };
  const existing = await db.TelephonyRawEvent.findOne({ where });
  if (existing) {
    await existing.update({
      deliveryCount: Number(existing.deliveryCount || 1) + 1,
      lastReceivedAt: rawEventPayload.receivedAt,
    });
    return existing;
  }

  try {
    return await db.TelephonyRawEvent.create(rawEventPayload);
  } catch (error) {
    if (error.name !== 'SequelizeUniqueConstraintError') throw error;

    const duplicate = await db.TelephonyRawEvent.findOne({ where });
    if (!duplicate) throw error;
    await duplicate.update({
      deliveryCount: Number(duplicate.deliveryCount || 1) + 1,
      lastReceivedAt: rawEventPayload.receivedAt,
    });
    return duplicate;
  }
}

async function persistBeelineEvent({
  body,
  connection = null,
  headers,
  ip,
  query,
}) {
  const writeContext = await resolveBeelineWriteContext(connection);
  const items = parseIncomingBeelinePayload(body, headers);
  const results = [];

  for (const item of items) {
    const payload = asObject(item);
    const callbackToken = connection?.secrets?.callbackToken || null;
    const normalized = normalizePayload(payload);
    const externalEventId = normalized.externalEventId || `delivery:${crypto.randomUUID()}`;
    const idempotencyKey = buildProviderIdempotencyKey(writeContext, externalEventId);
    const attribution = connectionAttribution(writeContext);
    const rawEventPayload = {
      clubId: attribution.clubId || null,
      integrationConnectionId: attribution.integrationConnectionId || null,
      organizationId: attribution.organizationId || null,
      idempotencyKey,
      deliveryCount: 1,
      eventType: normalized.eventType || 'beeline.event',
      externalEventId: normalized.externalEventId,
      headers: redactCapabilityValue(sanitizeHeaders(headers), callbackToken),
      // Phone and email are downstream call-matching data; only provider
      // credentials are stripped before the immutable raw event is stored.
      payload: redactProviderCredentials(
        redactCapabilityValue(payload, callbackToken),
      ),
      processingStatus: 'new',
      provider: 'beeline',
      query: redactCapabilityValue(sanitizeQuery(query), callbackToken),
      receivedAt: new Date(),
      lastReceivedAt: new Date(),
      sourceIp: ip || null,
    };
    const rawEvent = await saveRawEvent(rawEventPayload);

    try {
      const result = await db.sequelize.transaction(async (transaction) => {
        return processRawEvent(rawEvent, transaction);
      });

      if (result.callId) {
        await autoEnqueueTranscriptionJob(result.callId, {
          tenant: writeContext,
        });
      }
      results.push(result);
    } catch (error) {
      await rawEvent.update({
        processingStatus: 'failed',
        processingError: error.message,
      });
      results.push({
        error: error.message,
        rawEventId: rawEvent.id,
        status: 'failed',
      });
    }
  }

  return {
    processed: results.length,
    results,
  };
}

async function receiveBeelineEvent({
  body,
  headers,
  ingressContext,
  ip,
  query,
}) {
  const connection = requireAuthenticatedIngressContext(ingressContext, 'beeline');
  await assertLegacyDownstreamReady(connection);
  return withProviderConnectionLock(connection, () => persistBeelineEvent({
      body,
      connection,
      headers,
      ip,
      query,
    }));
}

async function ingestTrustedStatisticsRow(row, connection = null) {
  return persistBeelineEvent({
    body: { ...row, eventType: 'statistics' },
    connection,
    headers: {},
    ip: null,
    query: { source: 'manual-sync' },
  });
}

async function processRawEvent(rawEvent, transaction = undefined) {
  const payload = asObject(parseJsonField(rawEvent.payload));
  const normalized = normalizePayload(payload);
  let connection = rawEventConnection(rawEvent);
  if (isTenantProviderIntegrationsEnabled() && !connection?.connectionId) {
    throw appError('Provider attribution is missing', 409);
  }
  if (!isTenantProviderIntegrationsEnabled() && connection && !connection.connectionId) {
    const legacyContext = await resolveLegacyProviderContext('beeline');
    if (
      connection.provider !== 'beeline' ||
      Number(connection.organizationId) !== Number(legacyContext.organizationId) ||
      Number(connection.clubId) !== Number(legacyContext.clubId)
    ) {
      throw appError('Legacy provider attribution does not match the singleton tenant', 409);
    }
    connection = legacyContext;
  }

  if (!hasStableCallIdentity(normalized) && isServiceXsiEvent(normalized, payload)) {
    await rawEvent.update(
      {
        eventType: normalized.eventType || rawEvent.eventType || 'xsi.service',
        externalEventId: normalized.externalEventId || rawEvent.externalEventId,
        processingError: null,
        processingStatus: 'processed',
        telephonyCallId: null,
      },
      { transaction },
    );

    return {
      callId: null,
      rawEventId: rawEvent.id,
      status: 'processed',
      type: 'service_event',
    };
  }

  const call = await upsertCallFromNormalized(normalized, transaction, connection);

  await rawEvent.update(
    {
      eventType: normalized.eventType || rawEvent.eventType || 'beeline.event',
      externalEventId: normalized.externalEventId || rawEvent.externalEventId,
      processingError: call ? null : 'Не удалось нормализовать звонок',
      processingStatus: call ? 'processed' : 'failed',
      telephonyCallId: call?.id || null,
    },
    { transaction },
  );

  return { callId: call?.id || null, rawEventId: rawEvent.id, status: 'processed' };
}

async function reprocessRawEvent(id, tenant = null) {
  const where = { id };
  if (isTenantProviderIntegrationsEnabled()) {
    where.organizationId = Number(tenant?.organizationId);
    where.clubId = Number(tenant?.clubId);
  }
  const rawEvent = await db.TelephonyRawEvent.findOne({ where });
  if (!rawEvent) throw appError('Webhook-событие не найдено', 404);
  if (isTenantProviderIntegrationsEnabled()) {
    await assertLegacyDownstreamReady(rawEventConnection(rawEvent));
  }

  try {
    const result = await db.sequelize.transaction(async (transaction) => {
      await rawEvent.update(
        {
          processingError: null,
          processingStatus: 'new',
        },
        { transaction },
      );

      return processRawEvent(rawEvent, transaction);
    });

    return {
      ...result,
      item: mapRawEvent(
        await db.TelephonyRawEvent.findByPk(rawEvent.id, {
          include: [{ model: db.TelephonyCall, as: 'call', attributes: ['id', 'callStatus'] }],
        }),
      ),
    };
  } catch (error) {
    await rawEvent.update({
      processingError: error.message,
      processingStatus: 'failed',
    });
    throw error;
  }
}

function buildCallWhere(query = {}, actor = null) {
  const where = {};
  const status = query.status || 'active';

  if (status === 'active') {
    where.processingStatus = { [Op.in]: ['new', 'in_progress'] };
  } else if (status === 'missed') {
    where.callStatus = 'missed';
  } else if (status !== 'all') {
    if (!PROCESSING_STATUSES.has(status)) {
      throw appError('Некорректный статус обработки звонка');
    }
    where.processingStatus = status;
  }

  if (query.callStatus && status !== 'missed') {
    where.callStatus = query.callStatus;
  }
  if (query.direction) {
    where.direction = query.direction;
  }
  if (query.recordingStatus) {
    where.recordingStatus = query.recordingStatus;
  }
  if (query.from || query.to) {
    where.startedAt = {};
    const from = parseDate(query.from);
    const to = parseDate(query.to);
    if (from) where.startedAt[Op.gte] = from;
    if (to) where.startedAt[Op.lte] = to;
  }
  const searchValue = query.search || query.q;
  if (searchValue) {
    const search = String(searchValue).trim();
    const phone = getPhoneLookupDigits(search);
    const searchConditions = [
      { clientPhone: { [Op.like]: `%${search}%` } },
      { '$client.name$': { [Op.like]: `%${search}%` } },
    ];
    if (phone.length >= 3) {
      searchConditions.push({ clientPhoneNormalized: { [Op.like]: `%${phone}%` } });
    }
    appendWhereAnd(where, { [Op.or]: searchConditions });
  }

  applyActorScope(where, actor);
  return where;
}

function combineWhere(baseWhere, extraWhere = {}) {
  if (!extraWhere || Object.keys(extraWhere).length === 0) return baseWhere;
  return {
    [Op.and]: [baseWhere, extraWhere],
  };
}

function buildCallDateRangeWhere(from, to) {
  const range = { [Op.gte]: from, [Op.lte]: to };
  return {
    [Op.or]: [
      { startedAt: range },
      {
        [Op.and]: [
          { startedAt: null },
          { createdAt: range },
        ],
      },
    ],
  };
}

function buildReportWhere(actor, query = {}) {
  const { from, to } = getReportRange(query);
  const where = buildCallDateRangeWhere(from, to);

  if (query.direction) {
    where.direction = query.direction;
  }
  if (query.callStatus) {
    where.callStatus = query.callStatus;
  }
  if (query.recordingStatus) {
    where.recordingStatus = query.recordingStatus;
  }
  if (query.status && query.status !== 'all') {
    if (!PROCESSING_STATUSES.has(query.status)) {
      throw appError('Некорректный статус обработки звонка');
    }
    where.processingStatus = query.status;
  }

  applyActorScope(where, actor);
  return { from, to, where };
}

async function countCalls(where, extra = {}, options = {}) {
  return db.TelephonyCall.count({
    distinct: true,
    include: options.include || [],
    where: combineWhere(where, extra),
  });
}

async function groupCallsByField(where, field, labels, extra = {}) {
  const rows = await db.TelephonyCall.findAll({
    attributes: [
      [db.Sequelize.col(field), 'key'],
      [db.Sequelize.fn('COUNT', db.Sequelize.col('TelephonyCall.id')), 'count'],
    ],
    group: [field],
    order: [[db.Sequelize.literal('count'), 'DESC']],
    raw: true,
    where: combineWhere(where, extra),
  });

  return rows.map((row) => {
    const key = row.key || 'none';
    return {
      count: Number(row.count || 0),
      key,
      label: row.key ? labels[row.key] || row.key : 'Не указан',
    };
  });
}

function appendWhereAnd(where, condition) {
  where[Op.and] = [...(where[Op.and] || []), condition];
}

function applyActorScope(where, actor = null) {
  if (actor?.role === 'admin' && actor?.Staff?.id) {
    appendWhereAnd(where, {
      [Op.or]: [{ staffId: actor.Staff.id }, { staffId: null }],
    });
  } else if (actor?.role === 'admin') {
    appendWhereAnd(where, { staffId: null });
  }

  return where;
}

async function listCalls(actor, query = {}, tenant = null) {
  const page = Math.max(Number(query.page) || 1, 1);
  const pageSize = Math.min(Math.max(Number(query.pageSize) || 20, 1), 100);
  const where = buildCallWhere(query, actor);

  const { count, rows } = await db.TelephonyCall.findAndCountAll({
    distinct: true,
    include: callInclude(),
    limit: pageSize,
    offset: (page - 1) * pageSize,
    order: [
      ['startedAt', 'DESC'],
      ['createdAt', 'DESC'],
    ],
    where,
  });
  const transcriptionJobs = await getLatestTranscriptionJobsForCallIds(
    rows.map((row) => row.id),
    { tenant },
  );

  return {
    items: rows.map((row) =>
      mapCall(row, actor, {
        transcriptionJob: transcriptionJobs.get(Number(row.id)),
      }),
    ),
    page,
    pageSize,
    total: count,
  };
}

async function getCallOrFail(actor, id, options = {}) {
  const where = { id };
  applyActorScope(where, actor);

  const call = await db.TelephonyCall.findOne({
    include: callInclude(),
    transaction: options.transaction,
    where,
  });
  if (!call) throw appError('Звонок не найден', 404);
  return call;
}

function transcriptionJobInclude(options = {}) {
  const include = [];
  if (options.includeSegments) {
    include.push({
      model: db.TelephonyTranscriptSegment,
      as: 'segments',
      attributes: [
        'channel',
        'confidence',
        'endMs',
        'id',
        'sortOrder',
        'speaker',
        'startMs',
        'text',
      ],
      separate: true,
      order: [
        ['startMs', 'ASC'],
        ['sortOrder', 'ASC'],
        ['id', 'ASC'],
      ],
    });
  }

  if (options.includeCall) {
    include.push({
      model: db.TelephonyCall,
      as: 'call',
      attributes: [
        'callStatus',
        'direction',
        'durationSeconds',
        'id',
        'recordingStatus',
        'startedAt',
      ],
    });
  }

  return include;
}

function scopedTranscriptionCallInclude(actor, options = {}) {
  const where = {};
  applyActorScope(where, actor);

  return {
    model: db.TelephonyCall,
    as: 'call',
    attributes: options.attributes || [
      'callStatus',
      'clientPhone',
      'direction',
      'durationSeconds',
      'id',
      'recordingStatus',
      'startedAt',
    ],
    include: options.includeRelations
      ? [
          {
            model: db.User,
            as: 'client',
            attributes: ['id', 'name', 'phone', 'status'],
          },
          {
            model: db.Staff,
            as: 'staff',
            attributes: ['id', 'name', 'role'],
          },
        ]
      : [],
    required: true,
    where,
  };
}

function scopedTranscriptionJobInclude(actor, options = {}) {
  return [
    ...transcriptionJobInclude({ includeSegments: options.includeSegments }),
    scopedTranscriptionCallInclude(actor, {
      attributes: options.callAttributes,
      includeRelations: Boolean(options.includeCallRelations),
    }),
  ];
}

const TRANSCRIPTION_JOB_LIST_ATTRIBUTES = [
  'attemptCount',
  'clubId',
  'claimedAt',
  'completedAt',
  'createdAt',
  'errorMessage',
  'failedAt',
  'id',
  'language',
  'metadata',
  'organizationId',
  'status',
  'telephonyCallId',
  'updatedAt',
];

const TRANSCRIPTION_WORKER_LIST_ATTRIBUTES = [
  ...TRANSCRIPTION_JOB_LIST_ATTRIBUTES,
  'claimExpiresAt',
  'claimId',
  'workerId',
  'workerProtocolVersion',
];

async function getLatestTranscriptionJobsForCallIds(callIds, options = {}) {
  const ids = [...new Set(callIds.map(Number).filter((id) => Number.isInteger(id) && id > 0))];
  const latest = new Map();
  if (ids.length === 0) return latest;

  const tenant = isTenantFilesWorkersEnabled()
    ? await resolveTrustedTenantAttribution(options.tenant)
    : null;
  const jobs = await db.TelephonyTranscriptionJob.findAll({
    ...(options.includeSegments ? {} : { attributes: TRANSCRIPTION_JOB_LIST_ATTRIBUTES }),
    include: transcriptionJobInclude(options),
    order: [
      ['createdAt', 'DESC'],
      ['id', 'DESC'],
    ],
    where: withTenantJobWhere(
      { telephonyCallId: { [Op.in]: ids } },
      tenant,
    ),
  });

  jobs.forEach((job) => {
    if (!latest.has(Number(job.telephonyCallId))) {
      latest.set(Number(job.telephonyCallId), job);
    }
  });

  return latest;
}

async function getLatestTranscriptionJobForCallId(callId, options = {}) {
  const latest = await getLatestTranscriptionJobsForCallIds([callId], options);
  return latest.get(Number(callId)) || null;
}

async function getCall(actor, id, tenant = null) {
  const call = await getCallOrFail(actor, id);
  const transcriptionJob = await getLatestTranscriptionJobForCallId(call.id, {
    includeSegments: true,
    tenant,
  });

  return mapCall(call, actor, {
    includeTranscriptSegments: true,
    transcriptionJob,
  });
}

async function getActiveClientForCall(
  clientId,
  transaction = undefined,
  tenant = null,
) {
  const id = Number(clientId);
  if (!Number.isInteger(id) || id <= 0) {
    throw appError('Некорректный клиент для звонка');
  }

  const client = await clientsService.findCanonicalById(id, tenant, {
    lock: transaction?.LOCK.UPDATE,
    transaction,
  });
  if (
    !client ||
    Number(client.id) !== id ||
    client.status !== 'active' ||
    client.mergedIntoUserId
  ) {
    throw appError('Активный клиент для звонка не найден', 404);
  }

  return client;
}

async function syncFollowUpTaskClient(call, client, transaction = undefined) {
  if (!call.followUpCallTaskId) return null;

  const context = await resolveStoredCallTaskContext(call, { transaction });
  if (Number(client.organizationId) !== Number(context.organizationId)) {
    throw appError('Клиент звонка не принадлежит организации клуба', 409);
  }
  const task = await db.CallTask.findOne({
    transaction,
    where: callTaskTenantWhere(
      context,
      { id: call.followUpCallTaskId },
      { force: true },
    ),
  });
  if (!task) throw appError('Связанная задача обзвона не найдена', 404);

  const payload = {
    clientName: client.name,
    clientPhone: client.phone,
    source: client.source,
    userId: client.id,
  };
  const taskClient = await db.CallTaskClient.findOne({
    order: [['createdAt', 'ASC']],
    transaction,
    where: { callTaskId: task.id },
  });

  if (taskClient) {
    await taskClient.update(payload, { transaction });
  } else {
    await db.CallTaskClient.create(
      {
        ...payload,
        callTaskId: task.id,
        deadlineAt: task.dueAt,
        status: 'new',
        visitCount: 0,
      },
      { transaction },
    );
  }

  await task.update(
    {
      snapshotClientCount: 1,
      title: `Перезвонить: ${client.name}`,
    },
    { transaction },
  );

  return task;
}

async function attachCallToClient(call, client, transaction = undefined) {
  await call.update(
    {
      clientPhone: call.clientPhone || client.phone,
      clientPhoneNormalized: call.clientPhoneNormalized || client.phoneNormalized || null,
      userId: client.id,
    },
    { transaction },
  );

  if (call.followUpCallTaskId) {
    await syncFollowUpTaskClient(call, client, transaction);
  } else {
    await createMissedCallTask(call, transaction);
  }

  return call;
}

async function linkCallClient(actor, id, data = {}, tenant = null) {
  const callId = await db.sequelize.transaction(async (transaction) => {
    const call = await getCallOrFail(actor, id, { transaction });
    const client = await getActiveClientForCall(
      data.clientId,
      transaction,
      tenant,
    );

    await attachCallToClient(call, client, transaction);

    return call.id;
  });

  return getCall(actor, callId, tenant);
}

async function createClientForCall(actor, id, data = {}, tenant = null) {
  const call = await getCallOrFail(actor, id);
  if (!call.clientPhoneNormalized || !call.clientPhone) {
    throw appError('В звонке нет телефона для создания клиента', 409);
  }

  const client = await clientsService.createClient(
    {
      ...data,
      phone: call.clientPhone,
      status: 'active',
    },
    actor,
    tenant,
  );
  const clientId = client.client?.id || client.id;
  let attached = false;

  try {
    const callId = await db.sequelize.transaction(async (transaction) => {
      const freshCall = await getCallOrFail(actor, call.id, { transaction });
      const freshClient = await getActiveClientForCall(
        clientId,
        transaction,
        tenant,
      );

      await attachCallToClient(freshCall, freshClient, transaction);
      return freshCall.id;
    });
    attached = true;

    return getCall(actor, callId, tenant);
  } catch (error) {
    if (!attached && clientId) {
      await db.User.destroy({ where: { id: clientId } }).catch(() => null);
    }
    throw error;
  }
}

function normalizeResult(value) {
  if (!value) return null;
  if (!CALL_RESULTS.has(value)) throw appError('Некорректный результат звонка');
  return value;
}

function normalizeInterest(value) {
  if (!value) return null;
  if (!CALL_INTERESTS.has(value)) throw appError('Некорректный интерес клиента');
  return value;
}

async function completeCall(actor, id, data = {}, tenant = null) {
  const result = normalizeResult(data.result);
  const interest = normalizeInterest(data.interest);
  const nextActionAt = parseDate(data.nextActionAt);

  if (!result) {
    throw appError('Укажите результат звонка');
  }

  const callId = await db.sequelize.transaction(async (transaction) => {
    const call = await getCallOrFail(actor, id, { transaction });
    const linkedBookingId = await normalizeLinkedBookingId(
      data.linkedBookingId,
      call,
      transaction,
      tenant,
    );

    await call.update(
      {
        interest,
        linkedBookingId,
        nextActionAt,
        nextActionText: normalizeText(data.nextActionText),
        processedAt: new Date(),
        processedByAccountId: actor?.id || null,
        processingStatus: 'processed',
        result,
        summary: normalizeText(data.summary),
      },
      { transaction },
    );

    if (nextActionAt && call.userId && !call.followUpCallTaskId) {
      const task = await createFollowUpTaskFromCall(call, actor, nextActionAt, transaction);
      await call.update({ followUpCallTaskId: task.id }, { transaction });
    }

    return call.id;
  });

  return getCall(actor, callId, tenant);
}

async function startProcessing(actor, id) {
  const call = await getCallOrFail(actor, id);
  if (call.processingStatus === 'processed') return mapCall(call, actor);

  await call.update({
    processedByAccountId: actor?.id || call.processedByAccountId || null,
    processingStatus: 'in_progress',
  });

  return getCall(actor, call.id);
}

async function ignoreCall(actor, id, data = {}) {
  const call = await getCallOrFail(actor, id);
  await call.update({
    processedAt: new Date(),
    processedByAccountId: actor?.id || null,
    processingStatus: 'ignored',
    summary: normalizeText(data.summary) || call.summary,
  });

  return getCall(actor, call.id);
}

async function normalizeLinkedBookingId(
  linkedBookingId,
  call,
  transaction = undefined,
  tenant = null,
) {
  if (!linkedBookingId) return null;

  const bookingId = Number(linkedBookingId);
  if (!Number.isInteger(bookingId)) {
    throw appError('Некорректная бронь для звонка');
  }

  const context = isTenantBookingsCourtsEnabled()
    ? await resolveBookingAccessContext(tenant, { transaction })
    : null;
  const booking = await db.Booking.findOne({
    transaction,
    where: bookingTenantWhere(context, { id: bookingId }, { force: Boolean(context) }),
  });
  if (!booking) throw appError('Бронь для звонка не найдена', 404);
  if (call.userId && booking.userId && Number(booking.userId) !== Number(call.userId)) {
    throw appError('Бронь принадлежит другому клиенту', 409);
  }

  return bookingId;
}

async function createFollowUpTaskFromCall(call, actor, dueAt, transaction = undefined) {
  const context = await resolveStoredCallTaskContext(call, { transaction });
  const client = await db.User.findOne({
    transaction,
    where: {
      id: call.userId,
      organizationId: context.organizationId,
    },
  });
  if (!client) throw appError('Клиент для задачи не найден', 404);
  const assignedToAccountId = actor?.id
    ? await resolveEligibleCallTaskAccount(actor.id, context, { transaction })
    : null;

  const task = await db.CallTask.create(
    {
      assignedToAccountId,
      clubId: context.clubId,
      clientBaseId: null,
      createdByAccountId: assignedToAccountId,
      description: call.nextActionText || `Следующий шаг по звонку ${call.clientPhone || ''}`,
      dueAt,
      organizationId: context.organizationId,
      scopeType: 'snapshot',
      snapshotClientCount: 1,
      status: 'backlog',
      title: `Перезвонить: ${client.name}`,
    },
    { transaction },
  );

  await db.CallTaskClient.create(
    {
      callTaskId: task.id,
      clientName: client.name,
      clientPhone: client.phone,
      deadlineAt: dueAt,
      source: client.source,
      status: 'new',
      userId: client.id,
      visitCount: 0,
    },
    { transaction },
  );

  return task;
}

async function getStats(actor = null) {
  const scopedWhere = (extra = {}) => {
    const where = { ...extra };
    applyActorScope(where, actor);
    return where;
  };
  const [total, active, missed, processed, ignored, unknownClients, recordingsAvailable] = await Promise.all([
    db.TelephonyCall.count({ where: scopedWhere() }),
    db.TelephonyCall.count({
      where: scopedWhere({ processingStatus: { [Op.in]: ['new', 'in_progress'] } }),
    }),
    db.TelephonyCall.count({ where: scopedWhere({ callStatus: 'missed' }) }),
    db.TelephonyCall.count({ where: scopedWhere({ processingStatus: 'processed' }) }),
    db.TelephonyCall.count({ where: scopedWhere({ processingStatus: 'ignored' }) }),
    db.TelephonyCall.count({ where: scopedWhere({ userId: null }) }),
    db.TelephonyCall.count({ where: scopedWhere({ recordingStatus: 'available' }) }),
  ]);

  return {
    active,
    ignored,
    missed,
    processed,
    recordingsAvailable,
    total,
    unknownClients,
  };
}

async function getReport(actor = null, query = {}) {
  const { from, to, where } = buildReportWhere(actor, query);
  const now = new Date();

  const [
    total,
    inbound,
    outbound,
    missed,
    processed,
    active,
    ignored,
    unknownClients,
    recordingsAvailable,
    booked,
    overdueNextActions,
    avgDurationRows,
    byResult,
    byInterest,
    byProcessing,
    operatorRows,
  ] = await Promise.all([
    countCalls(where),
    countCalls(where, { direction: 'inbound' }),
    countCalls(where, { direction: 'outbound' }),
    countCalls(where, { callStatus: 'missed' }),
    countCalls(where, { processingStatus: 'processed' }),
    countCalls(where, { processingStatus: { [Op.in]: ['new', 'in_progress'] } }),
    countCalls(where, { processingStatus: 'ignored' }),
    countCalls(where, { userId: null }),
    countCalls(where, { recordingStatus: 'available' }),
    countCalls(where, { result: 'booked' }),
    countCalls(where, {
      nextActionAt: { [Op.lt]: now },
      processingStatus: 'processed',
      [Op.or]: [
        { followUpCallTaskId: null },
        { '$followUpCallTask.status$': { [Op.ne]: 'done' } },
      ],
    }, {
      include: [
        {
          model: db.CallTask,
          as: 'followUpCallTask',
          attributes: [],
          required: false,
        },
      ],
    }),
    db.TelephonyCall.findAll({
      attributes: [
        [
          db.Sequelize.fn('AVG', db.Sequelize.col('durationSeconds')),
          'averageDurationSeconds',
        ],
      ],
      raw: true,
      where: combineWhere(where, {
        durationSeconds: { [Op.ne]: null },
      }),
    }),
    groupCallsByField(where, 'result', RESULT_LABELS, {
      processingStatus: 'processed',
      result: { [Op.ne]: null },
    }),
    groupCallsByField(where, 'interest', INTEREST_LABELS, {
      interest: { [Op.ne]: null },
      processingStatus: 'processed',
    }),
    groupCallsByField(where, 'processingStatus', PROCESSING_LABELS),
    db.TelephonyCall.findAll({
      attributes: [
        ['processedByAccountId', 'accountId'],
        [db.Sequelize.fn('COUNT', db.Sequelize.col('TelephonyCall.id')), 'count'],
        [
          db.Sequelize.fn(
            'SUM',
            db.Sequelize.literal("CASE WHEN `TelephonyCall`.`processingStatus` = 'processed' THEN 1 ELSE 0 END"),
          ),
          'processed',
        ],
        [
          db.Sequelize.fn(
            'SUM',
            db.Sequelize.literal("CASE WHEN `TelephonyCall`.`result` = 'booked' THEN 1 ELSE 0 END"),
          ),
          'booked',
        ],
      ],
      group: ['processedByAccountId'],
      order: [[db.Sequelize.literal('count'), 'DESC']],
      raw: true,
      where,
    }),
  ]);

  const accountIds = operatorRows
    .map((row) => Number(row.accountId))
    .filter((id) => Number.isInteger(id) && id > 0);
  const accounts = accountIds.length
    ? await db.Account.findAll({
        attributes: ['id', 'email', 'role', 'staffId'],
        include: [{ model: db.Staff, attributes: ['id', 'name'] }],
        where: { id: { [Op.in]: accountIds } },
      })
    : [];
  const accountsById = new Map(
    accounts.map((account) => [Number(account.id), mapAccount(account)]),
  );
  const averageDurationSeconds = Math.round(
    Number(avgDurationRows[0]?.averageDurationSeconds || 0),
  );

  return {
    generatedAt: new Date().toISOString(),
    range: {
      from: from.toISOString(),
      to: to.toISOString(),
    },
    totals: {
      active,
      booked,
      bookingConversion: processed > 0 ? booked / processed : 0,
      ignored,
      inbound,
      missed,
      outbound,
      overdueNextActions,
      processed,
      processingRate: total > 0 ? processed / total : 0,
      recordingsAvailable,
      recordingCoverage: total > 0 ? recordingsAvailable / total : 0,
      total,
      unknownClients,
      unknownClientRate: total > 0 ? unknownClients / total : 0,
      averageDurationSeconds,
    },
    byInterest,
    byOperator: operatorRows.map((row) => {
      const accountId = row.accountId ? Number(row.accountId) : null;
      const account = accountId ? accountsById.get(accountId) || null : null;
      const count = Number(row.count || 0);
      const processedCount = Number(row.processed || 0);
      const bookedCount = Number(row.booked || 0);

      return {
        account,
        booked: bookedCount,
        bookingConversion: processedCount > 0 ? bookedCount / processedCount : 0,
        count,
        key: accountId ? String(accountId) : 'none',
        label: account?.name || 'Без обработчика',
        processed: processedCount,
      };
    }),
    byProcessing,
    byResult,
  };
}

function getBeelineClient(connection = null) {
  const token = connection
    ? normalizeText(requireConnectionSecret(connection, 'apiToken'))
    : normalizeText(process.env.BEELINE_API_TOKEN);
  const baseURL = normalizeText(connectionConfig(
    connection,
    'apiBaseUrl',
    'BEELINE_API_BASE_URL',
    null,
  ));

  if (!token) throw appError('BEELINE_API_TOKEN не настроен', 409);
  if (!baseURL) throw appError('BEELINE_API_BASE_URL не настроен', 409);

  return axios.create({
    baseURL,
    headers: {
      'X-MPBX-API-AUTH-TOKEN': token,
    },
    timeout: Number(connectionConfig(
      connection,
      'apiTimeoutMs',
      'BEELINE_API_TIMEOUT_MS',
      15000,
    )),
  });
}

function unwrapApiList(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.items)) return data.items;
  if (Array.isArray(data?.data)) return data.data;
  if (Array.isArray(data?.records)) return data.records;
  return [];
}

async function syncStatisticsForConnection(
  { dateFrom, dateTo, pageSize = 100 } = {},
  connection = null,
) {
  const client = getBeelineClient(connection);
  const statisticsPath = normalizeText(connectionConfig(
    connection,
    'statisticsPath',
    'BEELINE_STATISTICS_PATH',
    '/v2/statistics',
  ));
  const from = parseDate(dateFrom) || new Date(Date.now() - 24 * 60 * 60 * 1000);
  const to = parseDate(dateTo) || new Date();
  const normalizedPageSize = Math.min(
    Math.max(Number(pageSize) || 100, 10),
    100,
  );
  let page = 0;
  let imported = 0;
  let hasMore = true;

  while (hasMore) {
    const response = await client.get(statisticsPath, {
      params: {
        dateFrom: from.toISOString(),
        dateTo: to.toISOString(),
        page,
        pageSize: normalizedPageSize,
      },
    });
    const rows = unwrapApiList(response.data);

    for (const row of rows) {
      await ingestTrustedStatisticsRow(row, connection);
      imported += 1;
    }

    hasMore = rows.length === normalizedPageSize;
    page += 1;
    if (page > 100) break;
  }

  return {
    dateFrom: from.toISOString(),
    dateTo: to.toISOString(),
    imported,
  };
}

async function syncStatistics(data = {}, tenant = null, suppliedConnection = null) {
  const connection = await resolveBeelineTenantConnection(tenant, suppliedConnection);
  if (!connection) return syncStatisticsForConnection(data);
  await assertLegacyDownstreamReady(connection);
  return withProviderConnectionLock(
    connection,
    () => syncStatisticsForConnection(data, connection),
  );
}

async function syncRecordingsForConnection(
  { dateFrom, dateTo, id, userId } = {},
  connection = null,
) {
  const writeContext = await resolveBeelineWriteContext(connection);
  const client = getBeelineClient(connection);
  const recordsPath = normalizeText(connectionConfig(
    connection,
    'recordsPath',
    'BEELINE_RECORDS_PATH',
    '/records',
  ));
  const from = parseDate(dateFrom) || new Date(Date.now() - 24 * 60 * 60 * 1000);
  const to = parseDate(dateTo) || new Date();
  const response = await client.get(recordsPath, {
    params: {
      dateFrom: from.toISOString(),
      dateTo: to.toISOString(),
      id: normalizeText(id) || undefined,
      userId: normalizeText(userId) || undefined,
    },
  });
  const rows = unwrapApiList(response.data);
  let imported = 0;
  let linked = 0;
  const errors = [];

  for (const row of rows) {
    try {
      const recording = normalizeRecordingPayload(row);
      const callId = await db.sequelize.transaction(async (transaction) => {
        const call = await upsertCallFromRecording(recording, transaction, writeContext);
        if (call) linked += 1;
        return call?.id || null;
      });
      if (callId) {
        await autoEnqueueTranscriptionJob(callId, {
          tenant: writeContext,
        });
      }
      imported += 1;
    } catch (error) {
      errors.push({
        error: error.message,
        recordId: normalizeText(row?.id),
      });
    }
  }

  return {
    dateFrom: from.toISOString(),
    dateTo: to.toISOString(),
    errors,
    imported,
    linked,
  };
}

async function syncRecordings(data = {}, tenant = null, suppliedConnection = null) {
  const connection = await resolveBeelineTenantConnection(tenant, suppliedConnection);
  if (!connection) return syncRecordingsForConnection(data);
  await assertLegacyDownstreamReady(connection);
  return withProviderConnectionLock(
    connection,
    () => syncRecordingsForConnection(data, connection),
  );
}

function normalizeRecordingReference(data) {
  const payload = asObject(data);
  const url = normalizeText(
    payload.url || payload.reference || payload.link || payload.downloadUrl,
  );
  if (!url) throw appError('Билайн не вернул ссылку на запись', 502, payload);

  return {
    fileSize:
      Number.isFinite(Number(payload.fileSize)) && Number(payload.fileSize) >= 0
        ? Number(payload.fileSize)
        : null,
    fileType: normalizeText(payload.fileType),
    recordingExpiresAt: parseDate(payload.expirationDate),
    recordingUrl: url,
  };
}

function normalizeTranscriptSpeaker(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return 'unknown';
  if (
    [
      'admin',
      'administrator',
      'operator',
      'employee',
      'staff',
      'agent',
      'manager',
      'администратор',
      'оператор',
      'сотрудник',
      'менеджер',
    ].includes(normalized)
  ) {
    return 'administrator';
  }
  if (
    [
      'client',
      'customer',
      'user',
      'guest',
      'клиент',
      'гость',
      'пользователь',
    ].includes(normalized)
  ) {
    return 'client';
  }
  if (TRANSCRIPT_SPEAKERS.has(normalized)) return normalized;

  return 'unknown';
}

function normalizeOptionalInteger(value) {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return null;
  return Math.round(number);
}

function normalizeTranscriptTimeMs(segment, baseName) {
  const msValue = normalizeOptionalInteger(segment[`${baseName}Ms`]);
  if (msValue !== null) return msValue;

  const secondsValue = Number(segment[`${baseName}Seconds`] ?? segment[baseName]);
  if (!Number.isFinite(secondsValue) || secondsValue < 0) return null;

  return secondsValue <= 36 * 60 * 60
    ? Math.round(secondsValue * 1000)
    : Math.round(secondsValue);
}

function normalizeTranscriptConfidence(value) {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.max(0, Math.min(1, number));
}

function normalizeTranscriptChannel(value) {
  const channel = normalizeText(value);
  return channel ? channel.slice(0, 255) : null;
}

function normalizeCorrections(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => asObject(item))
    .filter((item) => Object.keys(item).length > 0);
}

function normalizeCollapsedText(value) {
  const normalized = String(value || '').replace(/\s+/g, ' ').trim();
  return normalized || null;
}

function transcriptSegmentId(index) {
  return `s${index + 1}`;
}

function flattenStringValues(value, output = []) {
  if (typeof value === 'string') {
    const text = normalizeCollapsedText(value);
    if (text) output.push(text);
  } else if (Array.isArray(value)) {
    value.forEach((item) => flattenStringValues(item, output));
  }
  return output;
}

function normalizeAiStringList(value, maxItems = 12) {
  return [...new Set(flattenStringValues(value))].slice(0, maxItems);
}

function normalizeAiConfidence(value) {
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    return ['high', 'medium', 'low'].includes(normalized) ? normalized : null;
  }
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0 || number > 1) return null;
  return number;
}

function hasForbiddenAiArtifact(text) {
  const normalized = normalizeCollapsedText(text)?.toLowerCase().replace(/ё/g, 'е') || '';
  if (!normalized) return true;
  if (normalized.includes('продолжение следует')) return true;
  if (/^контекст(?=$|[\s:;,.!?-])/u.test(normalized)) return true;
  if (/^редактор(?=$|[\s:;,.!?-])/u.test(normalized)) return true;
  if (/^корректор(?=$|[\s:;,.!?-])/u.test(normalized)) return true;
  return false;
}

function normalizeAiTranscriptLayer(data = {}, baseSegments = []) {
  const rawSegments = Array.isArray(data.aiTranscriptSegments)
    ? data.aiTranscriptSegments
    : Array.isArray(data.aiSegments)
      ? data.aiSegments
      : [];
  const rawCorrections = Array.isArray(data.aiCorrections) ? data.aiCorrections : [];
  const rawMetadata = asObject(data.aiMetadata);
  const overlays = new Map();
  const ignoredUnknownSegmentIds = [];
  const rejectedSegmentIds = [];
  const metadataList = (name) =>
    Array.isArray(rawMetadata[name]) ? rawMetadata[name].filter(Boolean) : [];

  if (rawSegments.length === 0) {
    return {
      aiCorrections: normalizeCorrections(rawCorrections),
      aiMetadata: Object.keys(rawMetadata).length > 0 ? rawMetadata : null,
      aiTranscriptSegments: [],
      aiTranscriptText: normalizeText(data.aiTranscriptText),
    };
  }

  rawSegments.forEach((item) => {
    const payload = asObject(item);
    const segmentId = normalizeCollapsedText(payload.segmentId);
    if (!segmentId || !baseSegments.some((_segment, index) => transcriptSegmentId(index) === segmentId)) {
      if (segmentId) ignoredUnknownSegmentIds.push(segmentId);
      return;
    }
    const text = normalizeCollapsedText(payload.editedText || payload.text);
    if (!text || hasForbiddenAiArtifact(text)) {
      rejectedSegmentIds.push(segmentId);
      return;
    }
    overlays.set(segmentId, {
      changes: normalizeAiStringList(payload.changes),
      confidence: normalizeAiConfidence(payload.confidence),
      text,
      warnings: normalizeAiStringList(payload.warnings),
    });
  });

  const aiTranscriptSegments = baseSegments.map((segment, index) => {
    const segmentId = transcriptSegmentId(index);
    const sourceText = normalizeCollapsedText(segment.text) || '';
    const overlay = overlays.get(segmentId) || {};
    const text = overlay.text || sourceText;
    return {
      channel: segment.channel || null,
      changes: overlay.changes || [],
      confidence: overlay.confidence || null,
      editedText: text,
      endMs: segment.endMs,
      segmentId,
      sortOrder: index,
      sourceText,
      speaker: segment.speaker,
      startMs: segment.startMs,
      text,
      warnings: overlay.warnings || [],
    };
  });

  const derivedCorrections = aiTranscriptSegments
    .filter((segment) =>
      segment.sourceText !== segment.text ||
      segment.changes.length > 0 ||
      segment.warnings.length > 0)
    .map((segment) => ({
      channel: segment.channel,
      changes: segment.changes,
      confidence: segment.confidence,
      endMs: segment.endMs,
      original: segment.sourceText,
      normalized: segment.text,
      segmentId: segment.segmentId,
      speaker: segment.speaker,
      startMs: segment.startMs,
      type: 'llm_edit',
      warnings: segment.warnings,
    }));
  const aiCorrections = derivedCorrections;
  const acceptedSegmentIds = [...overlays.keys()];
  const aiMetadata = {
    ...rawMetadata,
    acceptedSegmentIds,
    ignoredUnknownSegmentIds: [
      ...new Set([
        ...ignoredUnknownSegmentIds,
        ...metadataList('ignoredUnknownSegmentIds'),
      ]),
    ],
    missingSegmentIds: baseSegments
      .map((_segment, index) => transcriptSegmentId(index))
      .filter((segmentId) => !overlays.has(segmentId)),
    rejectedSegmentIds: [
      ...new Set([
        ...rejectedSegmentIds,
        ...metadataList('rejectedSegmentIds'),
      ]),
    ],
  };

  return {
    aiCorrections,
    aiMetadata,
    aiTranscriptSegments,
    aiTranscriptText:
      buildTranscriptTextFromSegments(aiTranscriptSegments) ||
      normalizeText(data.aiTranscriptText),
  };
}

function normalizeRawAsrJson(data = {}) {
  if (data.rawAsrJson && typeof data.rawAsrJson === 'object') return data.rawAsrJson;
  if (data.rawAsrResult && typeof data.rawAsrResult === 'object') return data.rawAsrResult;
  if (data.raw && typeof data.raw === 'object') return data.raw;
  return null;
}

function normalizeRawTranscriptText(data = {}) {
  return normalizeText(
    data.rawTranscriptText ||
      data.rawText ||
      data.rawTranscript ||
      data.raw?.transcriptText ||
      data.raw?.text,
  );
}

function normalizeTranscriptSegments(data = {}) {
  const rawSegments = Array.isArray(data.segments) ? data.segments : [];
  const segments = rawSegments
    .map((segment, index) => {
      const payload = asObject(segment);
      const text = normalizeText(payload.text || payload.transcript || payload.phrase);
      if (!text) return null;

      return {
        channel: normalizeTranscriptChannel(
          payload.channel ?? payload.audioChannel ?? payload.track,
        ),
        confidence: normalizeTranscriptConfidence(payload.confidence),
        endMs: normalizeTranscriptTimeMs(payload, 'end'),
        sortOrder: normalizeOptionalInteger(payload.sortOrder) ?? index,
        speaker: normalizeTranscriptSpeaker(payload.speaker || payload.role),
        startMs: normalizeTranscriptTimeMs(payload, 'start'),
        text,
      };
    })
    .filter(Boolean)
    .sort(compareTranscriptSegments)
    .map((segment, index) => ({
      ...segment,
      sortOrder: index,
    }));
  const transcriptText =
    buildTranscriptTextFromSegments(segments) ||
    normalizeText(data.transcriptText || data.text || data.transcript);

  if (segments.length === 0 && transcriptText) {
    segments.push({
      channel: null,
      confidence: null,
      endMs: null,
      sortOrder: 0,
      speaker: 'unknown',
      startMs: null,
      text: transcriptText,
    });
  }
  const aiLayer = normalizeAiTranscriptLayer(data, segments);

  return {
    ...aiLayer,
    corrections: normalizeCorrections(data.corrections),
    language: normalizeText(data.language),
    metadata: asObject(data.metadata),
    rawAsrJson: normalizeRawAsrJson(data),
    rawTranscriptText: normalizeRawTranscriptText(data),
    segments,
    transcriptText: transcriptText || null,
  };
}

function buildRecordingReferencePath(call) {
  if (call.recordId) {
    return `/records/${encodeURIComponent(call.recordId)}/reference`;
  }
  if (call.recordExternalId && call.beelineUserId) {
    return `/records/${encodeURIComponent(call.recordExternalId)}/${encodeURIComponent(call.beelineUserId)}/reference`;
  }
  if (call.externalTrackingId && call.beelineUserId) {
    return `/records/${encodeURIComponent(call.externalTrackingId)}/${encodeURIComponent(call.beelineUserId)}/reference`;
  }

  return null;
}

async function refreshRecordingReferenceForCall(call, options = {}) {
  const currentExpiresAt = parseDate(call.recordingExpiresAt);
  if (
    normalizeText(call.recordingUrl) &&
    currentExpiresAt &&
    currentExpiresAt.getTime() > Date.now() + 30 * 1000
  ) {
    return {
      downloadUrl: call.recordingUrl,
      expiresAt: currentExpiresAt,
      fileSize: call.recordingFileSize || null,
      fileType: call.recordingFileType || null,
    };
  }
  let connection = null;
  if (isTenantProviderIntegrationsEnabled()) {
    connection = call.integrationConnectionId
      ? await resolveConnectionForTenantById({
          connectionId: call.integrationConnectionId,
          provider: 'beeline',
          tenant: options.tenant,
        })
      : await resolveBeelineTenantConnection(options.tenant);
  }
  const client = getBeelineClient(connection);
  const path = buildRecordingReferencePath(call);

  if (!path) {
    throw appError('У звонка пока нет идентификатора записи Билайна', 409);
  }

  const response = await client.get(path);
  const reference = normalizeRecordingReference(response.data);
  await call.update({
    recordingExpiresAt: reference.recordingExpiresAt,
    recordingFileSize: reference.fileSize || call.recordingFileSize,
    recordingFileType: reference.fileType || call.recordingFileType,
    recordingStatus: 'available',
    recordingSyncedAt: new Date(),
    recordingUrl: reference.recordingUrl,
  });
  await autoEnqueueTranscriptionJob(call.id, { tenant: options.tenant });

  return {
    downloadUrl: reference.recordingUrl,
    expiresAt: reference.recordingExpiresAt,
    fileSize: reference.fileSize || call.recordingFileSize || null,
    fileType: reference.fileType || call.recordingFileType || null,
  };
}

function normalizeSubscriptionResponse(data, requestPayload = {}) {
  const payload = asObject(data);
  const expiresSeconds = Number(requestPayload.expires || requestPayload.expiresSeconds);
  const expiresAt =
    parseDate(payload.expiresAt || payload.expirationDate || payload.expireDate) ||
    (Number.isFinite(expiresSeconds) && expiresSeconds > 0
      ? new Date(Date.now() + expiresSeconds * 1000)
      : null);

  return {
    expiresAt,
    expiresSeconds: Number.isFinite(expiresSeconds) ? expiresSeconds : null,
    pattern:
      normalizeText(payload.pattern) ||
      normalizeText(requestPayload.pattern) ||
      null,
    status: normalizeSubscriptionStatus(payload.status),
    subscriptionId:
      normalizeText(payload.subscriptionId) ||
      normalizeText(payload.id) ||
      normalizeText(payload.uid) ||
      null,
    subscriptionType: normalizeSubscriptionType(
      payload.subscriptionType || requestPayload.subscriptionType,
    ),
  };
}

function normalizeSubscriptionStatus(value) {
  const normalized = String(value || '').toLowerCase();
  if (['active', 'enabled', 'ok', 'success', 'created', 'updated'].includes(normalized)) {
    return 'active';
  }
  if (['disabled', 'deleted', 'inactive'].includes(normalized)) return 'disabled';
  if (['expired'].includes(normalized)) return 'expired';
  if (['failed', 'error'].includes(normalized)) return 'failed';
  return 'active';
}

function normalizeSubscriptionType(value) {
  const normalized = String(value || '').trim().toUpperCase();
  return SUBSCRIPTION_TYPES.has(normalized) ? normalized : 'BASIC_CALL';
}

function buildSubscriptionRequestPayload(data = {}, connection = null) {
  const capabilityMode = connection?.config?.webhookAuthMode ===
    BEELINE_WEBHOOK_AUTH_MODES.CAPABILITY_URI;
  if (capabilityMode && normalizeText(data.url)) {
    const error = appError('Capability callback URL is server-owned', 400);
    error.code = 'BEELINE_CALLBACK_OVERRIDE_FORBIDDEN';
    throw error;
  }
  const callbackUrl = capabilityMode
    ? buildCapabilityCallbackUrl(connection)
    : normalizeText(data.url) || normalizeText(connectionConfig(
      connection,
      'callbackUrl',
      'BEELINE_CALLBACK_URL',
      null,
    ));
  if (!callbackUrl) throw appError('BEELINE_CALLBACK_URL не настроен', 409);
  if (connection && !callbackUrl.includes(`/${connection.publicId}`)) {
    const error = appError('Provider connection is not configured', 409);
    error.code = 'PROVIDER_CALLBACK_CONNECTION_MISMATCH';
    throw error;
  }

  return {
    expires: data.expires || getSubscriptionExpiresSeconds(connection),
    pattern: normalizeText(data.pattern || connectionConfig(
      connection,
      'subscriptionPattern',
      'BEELINE_SUBSCRIPTION_PATTERN',
      null,
    )) || undefined,
    subscriptionType:
      normalizeSubscriptionType(data.subscriptionType || connectionConfig(
        connection,
        'subscriptionType',
        'BEELINE_SUBSCRIPTION_TYPE',
        null,
      )),
    url: callbackUrl,
  };
}

function subscriptionMatchesDesired(subscription, desired) {
  if (!subscription) return false;

  return (
    normalizeText(subscription.callbackUrl) ===
      normalizeText(redactCapabilityValue(desired.url)) &&
    normalizeText(subscription.pattern) === normalizeText(desired.pattern) &&
    normalizeSubscriptionType(subscription.subscriptionType) ===
      normalizeSubscriptionType(desired.subscriptionType)
  );
}

async function refreshRecordingReference(actor, id, tenant = null) {
  const call = await getCallOrFail(actor, id);
  await refreshRecordingReferenceForCall(call, { tenant });

  return getCall(actor, call.id, tenant);
}

async function createTranscriptionJob(actor, callId, tenant = null) {
  const call = await getCallOrFail(actor, callId);
  if (call.recordingStatus !== 'available') {
    throw appError('Транскрибация доступна только для звонков с записью', 409);
  }

  await autoEnqueueTranscriptionJob(call.id, {
    autoEnqueued: false,
    createdByAccountId: actor?.id || null,
    source: 'manual_fallback',
    tenant,
  });

  return getCall(actor, call.id, tenant);
}

async function autoEnqueueTranscriptionJob(callId, options = {}) {
  const tenant = await resolveTrustedTenantAttribution(options.tenant);
  return db.sequelize.transaction(async (transaction) => {
    const call = await db.TelephonyCall.findByPk(callId, {
      lock: transaction.LOCK.UPDATE,
      transaction,
    });
    if (!call || call.recordingStatus !== 'available') return null;

    const latestJob = await db.TelephonyTranscriptionJob.findOne({
      attributes: ['id', 'status'],
      order: [['createdAt', 'DESC'], ['id', 'DESC']],
      transaction,
      where: {
        clubId: tenant.clubId,
        organizationId: tenant.organizationId,
        telephonyCallId: call.id,
      },
    });
    if (latestJob) return null;

    return db.TelephonyTranscriptionJob.create({
      clubId: tenant.clubId,
      createdByAccountId: options.createdByAccountId || null,
      metadata: {
        autoEnqueued: options.autoEnqueued !== false,
        progress: { message: 'Ожидает worker', percent: 0, stage: 'queued', updatedAt: new Date().toISOString() },
        source: options.source || 'recording_available',
      },
      status: 'queued',
      telephonyCallId: call.id,
      organizationId: tenant.organizationId,
    }, { transaction });
  });
}

async function queueMissingTranscriptionJobs(actor, data = {}, tenant = null) {
  const limit = Math.min(Math.max(Number(data.limit) || DEFAULT_TRANSCRIPTION_BACKFILL_LIMIT, 1), 200);
  const jobTenant = isTenantFilesWorkersEnabled() ? normalizeTenantIds(tenant) : null;
  const calls = await db.TelephonyCall.findAll({
    attributes: ['id'],
    include: [{
      as: 'transcriptionJobs',
      attributes: ['id'],
      model: db.TelephonyTranscriptionJob,
      required: false,
      ...(jobTenant ? { where: jobTenant } : {}),
    }],
    limit,
    order: [['startedAt', 'DESC'], ['id', 'DESC']],
    where: {
      recordingStatus: 'available',
      '$transcriptionJobs.id$': null,
    },
    subQuery: false,
  });
  let queued = 0;
  for (const call of calls) {
    const job = await autoEnqueueTranscriptionJob(call.id, {
      createdByAccountId: actor?.id || null,
      source: 'manual_backfill',
      tenant,
    });
    if (job) queued += 1;
  }
  return { limit, queued, scanned: calls.length, hasMore: calls.length === limit };
}

function normalizeTranscriptionJobQuery(query = {}) {
  const page = Math.max(Number(query.page) || 1, 1);
  const pageSize = Math.min(Math.max(Number(query.pageSize) || 20, 1), 100);
  const where = {};

  if (query.status && query.status !== 'all') {
    if (!TRANSCRIPTION_STATUSES.has(query.status)) {
      throw appError('Некорректный статус транскрибации');
    }
    where.status = query.status;
  }

  if (query.callId) {
    const callId = Number(query.callId);
    if (!Number.isInteger(callId) || callId <= 0) {
      throw appError('Некорректный звонок для транскрибации');
    }
    where.telephonyCallId = callId;
  }

  return { page, pageSize, where };
}

async function listTranscriptionJobs(actor, query = {}, tenant = null) {
  const { page, pageSize, where } = normalizeTranscriptionJobQuery(query);
  const { count, rows } = await db.TelephonyTranscriptionJob.findAndCountAll({
    attributes: TRANSCRIPTION_JOB_LIST_ATTRIBUTES,
    distinct: true,
    include: scopedTranscriptionJobInclude(actor, {
      includeCallRelations: true,
      includeSegments: false,
    }),
    limit: pageSize,
    offset: (page - 1) * pageSize,
    order: [
      ['createdAt', 'DESC'],
      ['id', 'DESC'],
    ],
    where: withTenantJobWhere(where, tenant),
  });

  return {
    items: rows.map((row) => mapUserTranscriptionJob(row)),
    page,
    pageSize,
    total: count,
  };
}

async function listCallTranscriptionJobs(actor, callId, query = {}, tenant = null) {
  const call = await getCallOrFail(actor, callId);
  return listTranscriptionJobs(actor, {
    ...query,
    callId: call.id,
  }, tenant);
}

async function getTranscriptionJob(actor, id, tenant = null) {
  const jobId = Number(id);
  if (!Number.isInteger(jobId) || jobId <= 0) {
    throw appError('Некорректная задача транскрибации');
  }

  const job = await db.TelephonyTranscriptionJob.findOne({
    include: scopedTranscriptionJobInclude(actor, {
      includeCallRelations: true,
      includeSegments: true,
    }),
    where: withTenantJobWhere({ id: jobId }, tenant),
  });
  if (!job) throw appError('Задача транскрибации не найдена', 404);

  return { job: mapUserTranscriptionJob(job, { includeSegments: true }) };
}

async function getTranscriptionStats(actor, tenant = null) {
  const rows = await db.TelephonyTranscriptionJob.findAll({
    attributes: [
      'status',
      [db.Sequelize.fn('COUNT', db.Sequelize.col('TelephonyTranscriptionJob.id')), 'count'],
    ],
    group: ['TelephonyTranscriptionJob.status'],
    include: [
      scopedTranscriptionCallInclude(actor, {
        attributes: [],
        includeRelations: false,
      }),
    ],
    raw: true,
    where: withTenantJobWhere({}, tenant),
  });
  const totals = {
    completed: 0,
    failed: 0,
    processing: 0,
    queued: 0,
    total: 0,
  };

  rows.forEach((row) => {
    const status = row.status;
    const count = Number(row.count || 0);
    if (TRANSCRIPTION_STATUSES.has(status)) {
      totals[status] = count;
      totals.total += count;
    }
  });

  return {
    generatedAt: new Date().toISOString(),
    totals,
  };
}

async function getWorkerTranscriptionQueue(query = {}) {
  const isolated = isTenantFilesWorkersEnabled();
  const pageSize = Math.min(Math.max(Number(query.pageSize) || 50, 1), 100);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const activeStatuses = ['queued', 'processing', 'failed'];

  const [statusRows, completedToday, jobs] = await Promise.all([
    db.TelephonyTranscriptionJob.findAll({
      attributes: [
        'status',
        [db.Sequelize.fn('COUNT', db.Sequelize.col('id')), 'count'],
      ],
      group: ['status'],
      raw: true,
    }),
    db.TelephonyTranscriptionJob.count({
      where: {
        completedAt: { [Op.gte]: today },
        status: 'completed',
      },
    }),
    db.TelephonyTranscriptionJob.findAll({
      ...(isolated ? { attributes: TRANSCRIPTION_WORKER_LIST_ATTRIBUTES } : {}),
      include: isolated
        ? [workerQueueCallInclude()]
        : [
            ...transcriptionJobInclude({ includeSegments: true }),
            workerQueueCallInclude({ includeSensitiveRelations: true }),
          ],
      limit: pageSize,
      order: [
        ['createdAt', 'ASC'],
        ['id', 'ASC'],
      ],
      where: {
        [Op.or]: [
          { status: { [Op.in]: activeStatuses } },
          {
            completedAt: { [Op.gte]: today },
            status: 'completed',
          },
        ],
      },
    }),
  ]);

  const totals = {
    completedToday,
    failed: 0,
    processing: 0,
    queued: 0,
    total: 0,
    untranscribedInCrm: 0,
  };
  statusRows.forEach((row) => {
    const status = row.status;
    const count = Number(row.count || 0);
    if (TRANSCRIPTION_STATUSES.has(status)) {
      totals[status] = count;
      totals.total += count;
    }
  });
  totals.untranscribedInCrm = totals.queued + totals.processing + totals.failed;

  return {
    generatedAt: new Date().toISOString(),
    items: jobs
      .sort((left, right) => {
        const rank = { processing: 0, queued: 1, failed: 2, completed: 3 };
        const statusDiff = (rank[left.status] ?? 9) - (rank[right.status] ?? 9);
        if (statusDiff !== 0) return statusDiff;
        return Number(left.id || 0) - Number(right.id || 0);
      })
      .map((job) => mapWorkerTranscriptionJob(job, {
        includeLeaseStatus: isolated,
        includeSegments: !isolated,
        includeSensitiveRelations: !isolated,
        minimal: isolated,
      })),
    totals,
  };
}

async function getTranscriptionJobOrFail(id, options = {}) {
  const include = options.includeWorkerCall
    ? [
        ...transcriptionJobInclude({
          includeSegments: options.includeSegments,
        }),
        workerQueueCallInclude({
          includeSensitiveRelations: !isTenantFilesWorkersEnabled(),
        }),
      ]
    : transcriptionJobInclude({
        includeCall: options.includeCall,
        includeSegments: options.includeSegments,
      });
  const job = await db.TelephonyTranscriptionJob.findByPk(id, {
    include,
    lock: options.lock,
    transaction: options.transaction,
  });
  if (!job) throw appError('Задача транскрибации не найдена', 404);
  return job;
}

async function getUserTranscriptionJobOrFail(actor, id, options = {}) {
  const job = isTenantFilesWorkersEnabled()
    ? await db.TelephonyTranscriptionJob.findOne({
        include: transcriptionJobInclude({
          includeCall: options.includeCall,
          includeSegments: options.includeSegments,
        }),
        lock: options.lock,
        transaction: options.transaction,
        where: withTenantJobWhere({ id }, options.tenant),
      })
    : await getTranscriptionJobOrFail(id, options);
  if (!job) throw appError('Задача транскрибации не найдена', 404);
  await getCallOrFail(actor, job.telephonyCallId, {
    transaction: options.transaction,
  });
  return job;
}

async function claimTranscriptionJobLegacy(data = {}) {
  const jobId = await db.sequelize.transaction(async (transaction) => {
    const job = await db.TelephonyTranscriptionJob.findOne({
      lock: transaction.LOCK.UPDATE,
      order: [
        ['createdAt', 'ASC'],
        ['id', 'ASC'],
      ],
      transaction,
      where: { status: 'queued' },
    });

    if (!job) return null;

    await job.update(
      {
        attemptCount: Number(job.attemptCount || 0) + 1,
        claimedAt: new Date(),
        aiCorrections: null,
        aiMetadata: null,
        aiTranscriptSegments: null,
        aiTranscriptText: null,
        corrections: null,
        errorMessage: null,
        failedAt: null,
        language: null,
        metadata: {
          ...(asObject(job.metadata)),
          progress: { message: 'Worker начал обработку', percent: 5, stage: 'claimed', updatedAt: new Date().toISOString() },
        },
        rawAsrJson: null,
        rawTranscriptText: null,
        status: 'processing',
        transcriptText: null,
        workerId: normalizeText(data.workerId),
      },
      { transaction },
    );

    return job.id;
  });

  if (!jobId) return { job: null };

  const job = await getTranscriptionJobOrFail(jobId, { includeWorkerCall: true });
  return {
    job: mapWorkerTranscriptionJob(job, { includeSensitiveRelations: true }),
  };
}

function buildWorkerClaimResponse(job, lease) {
  const tenant = tenantRoutingMetadata(job);
  return {
    job: mapWorkerTranscriptionJob(job, { minimal: true }),
    lease: publicLease(lease, job.attemptCount),
    protocolVersion: WORKER_PROTOCOL_VERSION,
    tenant,
  };
}

async function claimTranscriptionJob(data = {}, worker = null) {
  if (!isTenantFilesWorkersEnabled()) return claimTranscriptionJobLegacy(data);
  assertPlatformWorker(worker);

  const now = new Date();
  const lease = createLease(now);
  const jobId = await db.sequelize.transaction(async (transaction) => {
    const job = await db.TelephonyTranscriptionJob.findOne({
      lock: transaction.LOCK.UPDATE,
      order: [
        ['organizationId', 'ASC'],
        ['clubId', 'ASC'],
        ['createdAt', 'ASC'],
        ['id', 'ASC'],
      ],
      transaction,
      where: {
        [Op.or]: [
          { status: 'queued' },
          {
            status: 'processing',
            [Op.or]: [
              { claimExpiresAt: { [Op.lt]: now } },
              { claimExpiresAt: null },
              { claimId: null },
            ],
          },
        ],
      },
    });
    if (!job) return null;

    await job.update(
      {
        aiCorrections: null,
        aiMetadata: null,
        aiTranscriptSegments: null,
        aiTranscriptText: null,
        attemptCount: Number(job.attemptCount || 0) + 1,
        claimedAt: now,
        claimExpiresAt: lease.claimExpiresAt,
        claimId: lease.claimId,
        claimTokenHash: lease.claimTokenHash,
        claimWorkerCredentialId: worker?.credentialId,
        corrections: null,
        errorMessage: null,
        failedAt: null,
        language: null,
        metadata: {
          ...asObject(job.metadata),
          progress: {
            message: 'Worker начал обработку',
            percent: 5,
            stage: 'claimed',
            updatedAt: now.toISOString(),
          },
        },
        rawAsrJson: null,
        rawTranscriptText: null,
        status: 'processing',
        transcriptText: null,
        workerId: worker?.instanceId || normalizeText(data.workerId),
        workerProtocolVersion: WORKER_PROTOCOL_VERSION,
      },
      { transaction },
    );
    return job.id;
  });

  if (!jobId) {
    return { job: null, protocolVersion: WORKER_PROTOCOL_VERSION };
  }
  const job = await getTranscriptionJobOrFail(jobId, { includeWorkerCall: true });
  return buildWorkerClaimResponse(job, lease);
}

async function updateTranscriptionJobProgress(jobId, data = {}, worker = null) {
  if (isTenantFilesWorkersEnabled()) {
    const savedJobId = await db.sequelize.transaction(async (transaction) => {
      const job = await getTranscriptionJobOrFail(jobId, {
        lock: transaction.LOCK.UPDATE,
        transaction,
      });
      assertActiveLease(job, data, worker);
      const metadata = asObject(job.metadata);
      await job.update({
        claimExpiresAt: new Date(Date.now() + getLeaseDurationMs()),
        metadata: {
          ...metadata,
          progress: {
            message: normalizeText(data.message),
            percent: Number(data.progress),
            stage: data.stage,
            updatedAt: new Date().toISOString(),
          },
        },
      }, { transaction });
      return job.id;
    });
    const job = await getTranscriptionJobOrFail(savedJobId);
    return { job: mapTranscriptionJob(job) };
  }

  const job = await getTranscriptionJobOrFail(jobId);
  if (job.status !== 'processing') {
    throw appError('Прогресс можно обновлять только для задачи в обработке', 409);
  }
  const metadata = asObject(job.metadata);
  await job.update({
    metadata: {
      ...metadata,
      progress: {
        message: normalizeText(data.message),
        percent: Number(data.progress),
        stage: data.stage,
        updatedAt: new Date().toISOString(),
      },
    },
  });
  return { job: mapTranscriptionJob(job) };
}

async function getTranscriptionJobAudioReference(jobId, data = {}, worker = null) {
  if (isTenantFilesWorkersEnabled()) {
    await db.sequelize.transaction(async (transaction) => {
      const lockedJob = await getTranscriptionJobOrFail(jobId, {
        lock: transaction.LOCK.UPDATE,
        transaction,
      });
      assertActiveLease(lockedJob, data, worker);
      await lockedJob.update(
        { claimExpiresAt: new Date(Date.now() + getLeaseDurationMs()) },
        { transaction },
      );
    });
  }
  const job = await getTranscriptionJobOrFail(jobId, { includeCall: true });
  if (job.status !== 'processing') {
    throw appError('Получить аудио можно только для задачи в обработке', 409);
  }

  const call = await db.TelephonyCall.findByPk(job.telephonyCallId);
  if (!call) throw appError('Звонок для транскрибации не найден', 404);
  if (call.recordingStatus !== 'available') {
    throw appError('У звонка нет доступной записи для транскрибации', 409);
  }

  const audio = await refreshRecordingReferenceForCall(call, { tenant: job });
  return {
    audio,
    job: mapWorkerTranscriptionJob(job, {
      includeSensitiveRelations: !isTenantFilesWorkersEnabled(),
      minimal: isTenantFilesWorkersEnabled(),
    }),
  };
}

async function completeTranscriptionJob(jobId, data = {}, worker = null) {
  const normalized = normalizeTranscriptSegments(data);
  if (!normalized.transcriptText && normalized.segments.length === 0) {
    throw appError('Передайте текст транскрибации или segments', 400);
  }

  const savedJobId = await db.sequelize.transaction(async (transaction) => {
    const job = await getTranscriptionJobOrFail(jobId, {
      lock: transaction.LOCK.UPDATE,
      transaction,
    });
    if (isTenantFilesWorkersEnabled()) {
      assertActiveLease(job, data, worker);
    } else if (job.status !== 'processing') {
      throw appError('Завершить можно только задачу в обработке', 409);
    }

    await db.TelephonyTranscriptSegment.destroy({
      transaction,
      where: { transcriptionJobId: job.id },
    });
    if (normalized.segments.length > 0) {
      await db.TelephonyTranscriptSegment.bulkCreate(
        normalized.segments.map((segment) => ({
          ...segment,
          telephonyCallId: job.telephonyCallId,
          transcriptionJobId: job.id,
        })),
        { transaction },
      );
    }

    await job.update(
      {
        claimExpiresAt: isTenantFilesWorkersEnabled() ? new Date() : job.claimExpiresAt,
        completedAt: new Date(),
        errorMessage: null,
        failedAt: null,
        aiCorrections: normalized.aiCorrections,
        aiMetadata: normalized.aiMetadata,
        aiTranscriptSegments: normalized.aiTranscriptSegments,
        aiTranscriptText: normalized.aiTranscriptText,
        language: normalized.language,
        metadata: normalized.metadata,
        corrections: normalized.corrections,
        rawAsrJson: normalized.rawAsrJson,
        rawTranscriptText: normalized.rawTranscriptText,
        status: 'completed',
        transcriptText: normalized.transcriptText,
      },
      { transaction },
    );

    return job.id;
  });

  const job = await getTranscriptionJobOrFail(savedJobId, {
    includeCall: true,
    includeSegments: !isTenantFilesWorkersEnabled(),
  });
  return {
    job: mapWorkerTranscriptionJob(job, {
      includeSegments: !isTenantFilesWorkersEnabled(),
      minimal: isTenantFilesWorkersEnabled(),
    }),
  };
}

async function failTranscriptionJob(jobId, data = {}, worker = null) {
  if (isTenantFilesWorkersEnabled()) {
    const savedJobId = await db.sequelize.transaction(async (transaction) => {
      const job = await getTranscriptionJobOrFail(jobId, {
        lock: transaction.LOCK.UPDATE,
        transaction,
      });
      assertActiveLease(job, data, worker);
      await job.update({
        claimExpiresAt: new Date(),
        errorMessage: normalizeText(data.errorMessage || data.error) || 'Worker failed',
        failedAt: new Date(),
        status: 'failed',
      }, { transaction });
      return job.id;
    });
    const freshJob = await getTranscriptionJobOrFail(savedJobId, { includeCall: true });
    return { job: mapWorkerTranscriptionJob(freshJob, { minimal: true }) };
  }

  const job = await getTranscriptionJobOrFail(jobId);
  if (job.status !== 'processing') {
    throw appError('Пометить ошибку можно только для задачи в обработке', 409);
  }

  await job.update({
    errorMessage: normalizeText(data.errorMessage || data.error) || 'Worker failed',
    failedAt: new Date(),
    status: 'failed',
  });

  const freshJob = await getTranscriptionJobOrFail(job.id, { includeCall: true });
  return { job: mapWorkerTranscriptionJob(freshJob) };
}

async function retryTranscriptionJob(actor, jobId, tenant = null) {
  const job = await getUserTranscriptionJobOrFail(actor, jobId, { tenant });
  if (job.status === 'queued' || job.status === 'processing') {
    return getCall(actor, job.telephonyCallId, tenant);
  }

  await db.sequelize.transaction(async (transaction) => {
    const lockedJob = await getUserTranscriptionJobOrFail(actor, job.id, {
      lock: transaction.LOCK.UPDATE,
      tenant,
      transaction,
    });
    if (!['completed', 'failed'].includes(lockedJob.status)) {
      throw appError('Повторить можно только завершенную или ошибочную задачу', 409);
    }

    await db.TelephonyTranscriptSegment.destroy({
      transaction,
      where: { transcriptionJobId: lockedJob.id },
    });
    await lockedJob.update(
      {
        claimedAt: null,
        claimExpiresAt: null,
        claimId: null,
        claimTokenHash: null,
        claimWorkerCredentialId: null,
        completedAt: null,
        errorMessage: null,
        failedAt: null,
        aiCorrections: null,
        aiMetadata: null,
        aiTranscriptSegments: null,
        aiTranscriptText: null,
        corrections: null,
        language: null,
        metadata: null,
        rawAsrJson: null,
        rawTranscriptText: null,
        status: 'queued',
        transcriptText: null,
        workerId: null,
        workerProtocolVersion: null,
      },
      { transaction },
    );
  });

  return getCall(actor, job.telephonyCallId, tenant);
}

async function retryTranscriptionJobForWorkerLegacy(jobId, data = {}) {
  const job = await getTranscriptionJobOrFail(jobId);
  if (job.status === 'processing') {
    return { job: mapWorkerTranscriptionJob(job) };
  }
  if (job.status === 'completed') {
    throw appError('Завершенную транскрибацию нельзя повторить через worker retry', 409);
  }

  const savedJobId = await db.sequelize.transaction(async (transaction) => {
    const lockedJob = await getTranscriptionJobOrFail(job.id, {
      lock: transaction.LOCK.UPDATE,
      transaction,
    });
    if (!['failed', 'queued'].includes(lockedJob.status)) {
      throw appError('Повторить можно только задачу с ошибкой', 409);
    }

    await db.TelephonyTranscriptSegment.destroy({
      transaction,
      where: { transcriptionJobId: lockedJob.id },
    });
    await lockedJob.update(
      {
        attemptCount: Number(lockedJob.attemptCount || 0) + 1,
        completedAt: null,
        errorMessage: null,
        failedAt: null,
        aiCorrections: null,
        aiMetadata: null,
        aiTranscriptSegments: null,
        aiTranscriptText: null,
        corrections: null,
        language: null,
        metadata: null,
        rawAsrJson: null,
        rawTranscriptText: null,
        claimedAt: new Date(),
        status: 'processing',
        transcriptText: null,
        workerId: normalizeText(data.workerId),
      },
      { transaction },
    );

    return lockedJob.id;
  });

  const freshJob = await getTranscriptionJobOrFail(savedJobId, { includeCall: true });
  return { job: mapWorkerTranscriptionJob(freshJob) };
}

async function retryTranscriptionJobForWorker(jobId, data = {}, worker = null) {
  if (!isTenantFilesWorkersEnabled()) {
    return retryTranscriptionJobForWorkerLegacy(jobId, data);
  }
  assertPlatformWorker(worker);

  const now = new Date();
  const lease = createLease(now);
  const savedJobId = await db.sequelize.transaction(async (transaction) => {
    const job = await getTranscriptionJobOrFail(jobId, {
      lock: transaction.LOCK.UPDATE,
      transaction,
    });
    if (!['failed', 'queued'].includes(job.status)) {
      const error = appError('Задача транскрибации не найдена', 404);
      error.code = 'WORKER_JOB_NOT_FOUND';
      throw error;
    }
    await db.TelephonyTranscriptSegment.destroy({
      transaction,
      where: { transcriptionJobId: job.id },
    });
    await job.update(
      {
        aiCorrections: null,
        aiMetadata: null,
        aiTranscriptSegments: null,
        aiTranscriptText: null,
        attemptCount: Number(job.attemptCount || 0) + 1,
        claimedAt: now,
        claimExpiresAt: lease.claimExpiresAt,
        claimId: lease.claimId,
        claimTokenHash: lease.claimTokenHash,
        claimWorkerCredentialId: worker?.credentialId,
        completedAt: null,
        corrections: null,
        errorMessage: null,
        failedAt: null,
        language: null,
        metadata: {
          progress: {
            message: 'Worker повторно начал обработку',
            percent: 5,
            stage: 'claimed',
            updatedAt: now.toISOString(),
          },
          source: 'worker_retry',
        },
        rawAsrJson: null,
        rawTranscriptText: null,
        status: 'processing',
        transcriptText: null,
        workerId: worker?.instanceId || normalizeText(data.workerId),
        workerProtocolVersion: WORKER_PROTOCOL_VERSION,
      },
      { transaction },
    );
    return job.id;
  });
  const job = await getTranscriptionJobOrFail(savedJobId, { includeWorkerCall: true });
  return buildWorkerClaimResponse(job, lease);
}

async function subscribeToEvents(data = {}, tenant = null, suppliedConnection = null) {
  const connection = await resolveBeelineTenantConnection(tenant, suppliedConnection);
  const writeContext = await resolveBeelineWriteContext(connection);
  const client = getBeelineClient(connection);
  const subscriptionPath = normalizeText(connectionConfig(
    connection,
    'subscriptionPath',
    'BEELINE_SUBSCRIPTION_PATH',
    '/subscription',
  ));
  const requestPayload = buildSubscriptionRequestPayload(data, connection);
  const callbackToken = connection?.secrets?.callbackToken || null;
  const callbackUrl = redactCapabilityValue(requestPayload.url, callbackToken);
  const persistedRequestPayload = redactProviderValue(
    redactCapabilityValue(requestPayload, callbackToken),
  );
  const attribution = connectionAttribution(writeContext);

  if (connection) {
    if (connection.config.webhookAuthMode === BEELINE_WEBHOOK_AUTH_MODES.CAPABILITY_URI) {
      requireConnectionSecret(connection, 'callbackToken');
    } else {
      requireConnectionSecret(connection, 'webhookSecret');
    }
  } else if (isWebhookSecretRequired() && !normalizeText(process.env.BEELINE_WEBHOOK_SECRET)) {
    throw appError('BEELINE_WEBHOOK_SECRET не настроен для XSI callback', 409);
  }

  try {
    const response = await client.put(subscriptionPath, requestPayload);
    const normalized = normalizeSubscriptionResponse(response.data, requestPayload);
    const existing = normalized.subscriptionId
      ? await db.TelephonySubscription.findOne({
          where: {
            providerNamespace: attribution.providerNamespace,
            subscriptionId: normalized.subscriptionId,
          },
        })
      : await db.TelephonySubscription.findOne({
          order: [['createdAt', 'DESC']],
          where: {
            callbackUrl,
            providerNamespace: attribution.providerNamespace,
          },
        });

    const row = existing
      ? await existing.update({
          ...normalized,
          callbackUrl,
          lastCheckedAt: new Date(),
          lastError: null,
          lastRequest: persistedRequestPayload,
          lastResponse: redactProviderValue(redactCapabilityValue(response.data, callbackToken)),
          provider: 'beeline',
        })
      : await db.TelephonySubscription.create({
          ...normalized,
          ...attribution,
          callbackUrl,
          lastCheckedAt: new Date(),
          lastRequest: persistedRequestPayload,
          lastResponse: redactProviderValue(redactCapabilityValue(response.data, callbackToken)),
          provider: 'beeline',
        });

    return mapSubscription(row);
  } catch (error) {
    const message = connection
      ? 'Билайн не создал XSI-подписку'
      : getBeelineErrorMessage(error, 'Билайн не создал XSI-подписку');
    await db.TelephonySubscription.create({
      ...attribution,
      callbackUrl,
      expiresSeconds: requestPayload.expires,
      lastCheckedAt: new Date(),
      lastError: message,
      lastRequest: persistedRequestPayload,
      lastResponse: redactProviderValue(
        redactCapabilityValue(error.response?.data || null, callbackToken),
      ),
      pattern: normalizeText(requestPayload.pattern),
      provider: 'beeline',
      status: 'failed',
      subscriptionType: requestPayload.subscriptionType,
    });
    throw appError(message, 409);
  }
}

async function checkEventSubscription(tenant = null, suppliedConnection = null) {
  const connection = await resolveBeelineTenantConnection(tenant, suppliedConnection);
  const callbackToken = connection?.secrets?.callbackToken || null;
  const writeContext = await resolveBeelineWriteContext(connection);
  const client = getBeelineClient(connection);
  const subscriptionPath = normalizeText(connectionConfig(
    connection,
    'subscriptionPath',
    'BEELINE_SUBSCRIPTION_PATH',
    '/subscription',
  ));
  const callbackUrl = connection?.config?.webhookAuthMode ===
    BEELINE_WEBHOOK_AUTH_MODES.CAPABILITY_URI
    ? redactCapabilityValue(buildCapabilityCallbackUrl(connection))
    : normalizeText(connectionConfig(
      connection,
      'callbackUrl',
      'BEELINE_CALLBACK_URL',
      '',
    ));
  const latest = await getLatestSubscription({ connection, preferActive: true });
  const attribution = connectionAttribution(writeContext);

  if (!latest?.subscriptionId) {
    throw appError('Сначала создайте XSI-подписку: у CRM пока нет subscriptionId для проверки', 409);
  }

  try {
    const response = await client.get(subscriptionPath, {
      params: {
        subscriptionId: latest.subscriptionId,
      },
    });
    const normalized = normalizeSubscriptionResponse(response.data, {
      expires: latest?.expiresSeconds || getSubscriptionExpiresSeconds(connection),
      pattern: latest?.pattern || connectionConfig(
        connection,
        'subscriptionPattern',
        'BEELINE_SUBSCRIPTION_PATTERN',
        undefined,
      ),
      subscriptionType:
        latest?.subscriptionType || connectionConfig(
          connection,
          'subscriptionType',
          'BEELINE_SUBSCRIPTION_TYPE',
          'BASIC_CALL',
        ),
    });
    const where = normalized.subscriptionId
      ? { providerNamespace: attribution.providerNamespace, subscriptionId: normalized.subscriptionId }
      : latest?.id
        ? { id: latest.id }
        : { callbackUrl, providerNamespace: attribution.providerNamespace };
    const existing = await db.TelephonySubscription.findOne({ where });
    const row = existing
      ? await existing.update({
          ...normalized,
          callbackUrl: existing.callbackUrl || callbackUrl || latest?.callbackUrl,
          lastCheckedAt: new Date(),
          lastError: null,
          lastResponse: redactProviderValue(redactCapabilityValue(response.data, callbackToken)),
          provider: 'beeline',
        })
      : await db.TelephonySubscription.create({
          ...normalized,
          ...attribution,
          callbackUrl: callbackUrl || latest?.callbackUrl || 'unknown',
          lastCheckedAt: new Date(),
          lastResponse: redactProviderValue(redactCapabilityValue(response.data, callbackToken)),
          provider: 'beeline',
        });

    return mapSubscription(row);
  } catch (error) {
    const message = connection
      ? 'Билайн не проверил XSI-подписку'
      : getBeelineErrorMessage(error, 'Билайн не проверил XSI-подписку');
    if (latest?.id) {
      const row = await db.TelephonySubscription.findByPk(latest.id);
      if (row) {
        await row.update({
          lastCheckedAt: new Date(),
          lastError: message,
          lastResponse: redactProviderValue(
            redactCapabilityValue(error.response?.data || null, callbackToken),
          ),
          status: 'failed',
        });
      }
    }
    throw appError(message, 409);
  }
}

async function maintainEventSubscription({ force = false, connection = null } = {}) {
  if (isTenantProviderIntegrationsEnabled() && !connection) {
    const error = appError('Provider connection is not configured', 503);
    error.code = 'PROVIDER_CONNECTION_REQUIRED';
    throw error;
  }
  if (!isSubscriptionAutoRenewEnabled(connection)) {
    return { action: 'skipped', reason: 'disabled' };
  }

  if (!connection && (
    !normalizeText(process.env.BEELINE_API_TOKEN) ||
    !normalizeText(process.env.BEELINE_API_BASE_URL) ||
    !normalizeText(process.env.BEELINE_CALLBACK_URL)
  )) {
    return { action: 'skipped', reason: 'not_configured' };
  }

  return withSubscriptionMaintenanceLock(connection, async () => {
    const latest = await getLatestSubscription({ connection, preferActive: true });
    const desired = buildSubscriptionRequestPayload({}, connection);
    const renewBeforeMs = getSubscriptionRenewBeforeSeconds(connection) * 1000;
    const expiresAt = latest?.expiresAt ? new Date(latest.expiresAt) : null;
    const expiresInMs = expiresAt && !Number.isNaN(expiresAt.getTime())
      ? expiresAt.getTime() - Date.now()
      : null;

    if (
      !force &&
      latest?.status === 'active' &&
      subscriptionMatchesDesired(latest, desired) &&
      expiresInMs !== null &&
      expiresInMs > renewBeforeMs
    ) {
      return {
        action: 'skipped',
        reason: 'fresh',
        expiresAt: latest.expiresAt,
        expiresInSeconds: Math.round(expiresInMs / 1000),
        subscriptionId: latest.subscriptionId,
      };
    }

    try {
      const subscription = await subscribeToEvents({}, null, connection);
      return {
        action: latest?.subscriptionId ? 'renewed' : 'created',
        subscription,
      };
    } catch (error) {
      return {
        action: 'failed',
        error: connection ? 'Provider subscription maintenance failed' : error.message,
      };
    }
  });
}

async function maintainAllEventSubscriptions({ force = false } = {}) {
  await assertTenantFoundationInitialized();
  assertBackgroundComponentCanRun(BACKGROUND_COMPONENTS.TELEPHONY_SUBSCRIPTION);
  const connections = await listActiveConnections({ provider: 'beeline' });
  if (!isTenantProviderIntegrationsEnabled() && connections.length === 0) {
    return { processed: 1, results: [await maintainEventSubscription({ force })] };
  }
  const settled = await runIsolatedProviderConnections(
    connections,
    (connection) => maintainEventSubscription({ connection, force }),
    { failureMessage: 'Provider subscription maintenance failed' },
  );
  return { processed: settled.length, results: settled };
}

async function withSubscriptionMaintenanceLock(connection, callback) {
  if (connection) return withProviderConnectionLock(connection, callback);
  if (db.sequelize.getDialect() !== 'mysql') {
    return callback();
  }

  return db.sequelize.transaction(async (transaction) => {
    const [rows] = await db.sequelize.query('SELECT GET_LOCK(:name, 0) AS locked', {
      replacements: { name: SUBSCRIPTION_LOCK_NAME },
      transaction,
    });
    const locked = Number(rows?.[0]?.locked) === 1;
    if (!locked) return { action: 'skipped', reason: 'locked' };

    try {
      return await callback();
    } finally {
      await db.sequelize.query('SELECT RELEASE_LOCK(:name)', {
        replacements: { name: SUBSCRIPTION_LOCK_NAME },
        transaction,
      });
    }
  });
}

async function getActiveSubscriptionCandidate(connection = null) {
  const activeRow = await db.TelephonySubscription.findOne({
    order: [['updatedAt', 'DESC']],
    where: {
      provider: 'beeline',
      providerNamespace: buildProviderNamespace(connection),
      status: 'active',
      subscriptionId: { [Op.ne]: null },
    },
  });

  return mapSubscription(activeRow);
}

async function getLatestSubscription({ connection = null, preferActive = false } = {}) {
  if (preferActive) {
    const active = await getActiveSubscriptionCandidate(connection);
    if (active) return active;
  }

  const row = await db.TelephonySubscription.findOne({
    order: [['updatedAt', 'DESC']],
    where: {
      provider: 'beeline',
      providerNamespace: buildProviderNamespace(connection),
    },
  });

  return mapSubscription(row);
}

function mapSubscription(row) {
  if (!row) return null;
  const raw = row.toJSON ? row.toJSON() : row;

  return {
    callbackUrl: raw.callbackUrl,
    createdAt: raw.createdAt,
    expiresAt: raw.expiresAt,
    expiresSeconds: raw.expiresSeconds,
    id: raw.id,
    lastCheckedAt: raw.lastCheckedAt,
    lastError: raw.lastError,
    pattern: raw.pattern,
    status: raw.status,
    subscriptionId: raw.subscriptionId,
    subscriptionType: raw.subscriptionType,
    updatedAt: raw.updatedAt,
  };
}

async function listRawEvents(query = {}, tenant = null) {
  const page = Math.max(Number(query.page) || 1, 1);
  const pageSize = Math.min(Math.max(Number(query.pageSize) || 20, 1), 100);
  const where = {};
  if (query.status && query.status !== 'all') {
    where.processingStatus = query.status;
  }
  if (isTenantProviderIntegrationsEnabled()) {
    where.organizationId = Number(tenant?.organizationId);
    where.clubId = Number(tenant?.clubId);
  }

  const { count, rows } = await db.TelephonyRawEvent.findAndCountAll({
    include: [{ model: db.TelephonyCall, as: 'call', attributes: ['id', 'callStatus'] }],
    limit: pageSize,
    offset: (page - 1) * pageSize,
    order: [['receivedAt', 'DESC']],
    where,
  });

  return {
    items: rows.map(mapRawEvent),
    page,
    pageSize,
    total: count,
  };
}

module.exports = {
  completeCall,
  completeTranscriptionJob,
  autoEnqueueTranscriptionJob,
  createClientForCall,
  createTranscriptionJob,
  queueMissingTranscriptionJobs,
  failTranscriptionJob,
  claimTranscriptionJob,
  getTranscriptionJobAudioReference,
  updateTranscriptionJobProgress,
  getCall,
  getConfig,
  getReport,
  getStats,
  getTranscriptionJob,
  getTranscriptionStats,
  getWorkerTranscriptionQueue,
  ignoreCall,
  linkCallClient,
  listCalls,
  listCallTranscriptionJobs,
  listRawEvents,
  mapCall,
  listTranscriptionJobs,
  mapTranscriptionJob,
  maintainEventSubscription,
  maintainAllEventSubscriptions,
  parseIncomingBeelinePayload,
  normalizeTranscriptSegments,
  normalizeRecordingPayload,
  normalizeSubscriptionResponse,
  normalizePayload,
  receiveBeelineEvent,
  refreshRecordingReference,
  reprocessRawEvent,
  retryTranscriptionJob,
  retryTranscriptionJobForWorker,
  startProcessing,
  checkEventSubscription,
  subscribeToEvents,
  syncRecordings,
  syncStatistics,
};
