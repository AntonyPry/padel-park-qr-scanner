const axios = require('axios');
const { Op } = require('sequelize');
const db = require('../../models');
const clientsService = require('./clients.service');
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
const TRANSCRIPTION_ACTIVE_STATUSES = new Set(['queued', 'processing']);
const TRANSCRIPT_SPEAKERS = new Set(['administrator', 'client', 'unknown']);
const SUBSCRIPTION_TYPES = new Set(['BASIC_CALL', 'ADVANCED_CALL']);
const DEFAULT_MISSED_CALL_DEADLINE_MINUTES = 15;
const DEFAULT_SUBSCRIPTION_RENEW_BEFORE_SECONDS = 10 * 60;
const DEFAULT_REPORT_DAYS = 30;
const SUBSCRIPTION_LOCK_NAME = 'padel_park_beeline_xsi_subscription';

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

function getSubscriptionExpiresSeconds() {
  const value = Number(process.env.BEELINE_SUBSCRIPTION_EXPIRES || 3600);
  return Number.isFinite(value) && value > 0 ? value : 3600;
}

function getSubscriptionRenewBeforeSeconds() {
  const value = Number(process.env.BEELINE_SUBSCRIPTION_RENEW_BEFORE_SECONDS);
  if (Number.isFinite(value) && value >= 60) return value;

  return Math.min(
    DEFAULT_SUBSCRIPTION_RENEW_BEFORE_SECONDS,
    Math.max(60, Math.floor(getSubscriptionExpiresSeconds() / 3)),
  );
}

function isSubscriptionAutoRenewEnabled() {
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
    const lowerKey = key.toLowerCase();
    if (
      lowerKey.includes('token') ||
      lowerKey.includes('authorization') ||
      lowerKey.includes('secret')
    ) {
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
    const lowerKey = key.toLowerCase();
    if (
      lowerKey.includes('token') ||
      lowerKey.includes('authorization') ||
      lowerKey.includes('secret')
    ) {
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

async function getConfig() {
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

function assertWebhookAllowed(headers = {}, query = {}) {
  const secret = normalizeText(process.env.BEELINE_WEBHOOK_SECRET);
  if (!secret) {
    if (isWebhookSecretRequired()) {
      throw appError('BEELINE_WEBHOOK_SECRET не настроен', 503);
    }
    return;
  }

  const provided =
    normalizeText(headers['x-beeline-webhook-secret']) ||
    normalizeText(headers['x-webhook-secret']) ||
    normalizeText(headers['x-integration-secret']) ||
    normalizeText(query.secret);

  if (provided !== secret) {
    throw appError('Некорректный секрет webhooks Билайна', 401);
  }
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
    claimedAt: raw.claimedAt,
    completedAt: raw.completedAt,
    createdAt: raw.createdAt,
    errorMessage: raw.errorMessage,
    failedAt: raw.failedAt,
    id: raw.id,
    language: raw.language,
    corrections: Array.isArray(raw.corrections) ? raw.corrections : [],
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
  mapped.call = raw.call
    ? {
        callStatus: raw.call.callStatus,
        client: raw.call.client
          ? {
              id: raw.call.client.id,
              name: raw.call.client.name,
              phone: raw.call.client.phone,
              status: raw.call.client.status,
            }
          : null,
        clientPhone: raw.call.clientPhone,
        direction: raw.call.direction,
        durationSeconds: raw.call.durationSeconds,
        id: raw.call.id,
        recordingStatus: raw.call.recordingStatus,
        startedAt: raw.call.startedAt,
      }
    : null;

  return mapped;
}

function workerQueueCallInclude() {
  return {
    model: db.TelephonyCall,
    as: 'call',
    attributes: [
      'callStatus',
      'clientPhone',
      'direction',
      'durationSeconds',
      'id',
      'recordingStatus',
      'startedAt',
    ],
    include: [
      {
        model: db.User,
        as: 'client',
        attributes: ['id', 'name', 'phone', 'status'],
      },
    ],
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

  return {
    ...raw,
    headers: parseJsonField(raw.headers),
    payload: parseJsonField(raw.payload),
    query: parseJsonField(raw.query),
  };
}

async function findClientByPhone(clientPhoneNormalized) {
  if (!clientPhoneNormalized) return null;
  return clientsService.findActiveByPhone(clientPhoneNormalized);
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

async function findExistingCall(normalized, transaction = undefined) {
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
    where: { [Op.or]: or },
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
  const client = call.userId
    ? await db.User.findByPk(call.userId, { transaction })
    : null;
  const fallbackName = call.clientPhone || 'Новый клиент';
  const taskTitleName = client?.name || fallbackName;

  const task = await db.CallTask.create(
    {
      assignedToAccountId: null,
      clientBaseId: null,
      createdByAccountId: null,
      description: [
        `Автоматически создано из пропущенного звонка ${call.clientPhone || ''}`.trim(),
        client ? null : 'Номер не найден в клиентской базе CRM.',
      ].filter(Boolean).join(' '),
      dueAt,
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

async function upsertCallFromNormalized(normalized, transaction = undefined) {
  if (!hasStableCallIdentity(normalized)) {
    throw appError(
      'В событии Билайна нет стабильного идентификатора звонка или пары телефон+время',
      422,
    );
  }

  const existing = await findExistingCall(normalized, transaction);
  const client = await findClientByPhone(normalized.clientPhoneNormalized);
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

    const duplicate = await findExistingCall(normalized, transaction);
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

async function findLikelyCallForRecording(recording, transaction = undefined) {
  if (!recording.clientPhoneNormalized || !recording.startedAt) return null;

  const from = new Date(recording.startedAt.getTime() - 10 * 60 * 1000);
  const to = new Date(recording.startedAt.getTime() + 10 * 60 * 1000);
  const where = {
    clientPhoneNormalized: recording.clientPhoneNormalized,
    provider: 'beeline',
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

async function upsertCallFromRecording(recording, transaction = undefined) {
  const existing =
    (await findExistingCall(recording, transaction)) ||
    (await findLikelyCallForRecording(recording, transaction));

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

  return upsertCallFromNormalized(recording, transaction);
}

async function saveRawEvent(rawEventPayload) {
  if (!rawEventPayload.externalEventId) {
    return db.TelephonyRawEvent.create(rawEventPayload);
  }

  const where = {
    externalEventId: rawEventPayload.externalEventId,
    provider: 'beeline',
  };
  const existing = await db.TelephonyRawEvent.findOne({ where });
  if (existing) return existing.update(rawEventPayload);

  try {
    return await db.TelephonyRawEvent.create(rawEventPayload);
  } catch (error) {
    if (error.name !== 'SequelizeUniqueConstraintError') throw error;

    const duplicate = await db.TelephonyRawEvent.findOne({ where });
    if (!duplicate) throw error;
    return duplicate.update(rawEventPayload);
  }
}

async function receiveBeelineEvent({
  body,
  headers,
  ip,
  query,
  skipSecret = false,
}) {
  if (!skipSecret) assertWebhookAllowed(headers, query);

  const items = parseIncomingBeelinePayload(body, headers);
  const results = [];

  for (const item of items) {
    const payload = asObject(item);
    const normalized = normalizePayload(payload);
    const rawEventPayload = {
      eventType: normalized.eventType || 'beeline.event',
      externalEventId: normalized.externalEventId,
      headers: sanitizeHeaders(headers),
      payload,
      processingStatus: 'new',
      provider: 'beeline',
      query: sanitizeQuery(query),
      receivedAt: new Date(),
      sourceIp: ip || null,
    };
    const rawEvent = await saveRawEvent(rawEventPayload);

    try {
      const result = await db.sequelize.transaction(async (transaction) => {
        return processRawEvent(rawEvent, transaction);
      });

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

async function processRawEvent(rawEvent, transaction = undefined) {
  const payload = asObject(parseJsonField(rawEvent.payload));
  const normalized = normalizePayload(payload);

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

  const call = await upsertCallFromNormalized(normalized, transaction);

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

async function reprocessRawEvent(id) {
  const rawEvent = await db.TelephonyRawEvent.findByPk(id);
  if (!rawEvent) throw appError('Webhook-событие не найдено', 404);

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

async function listCalls(actor, query = {}) {
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

async function getLatestTranscriptionJobsForCallIds(callIds, options = {}) {
  const ids = [...new Set(callIds.map(Number).filter((id) => Number.isInteger(id) && id > 0))];
  const latest = new Map();
  if (ids.length === 0) return latest;

  const jobs = await db.TelephonyTranscriptionJob.findAll({
    include: transcriptionJobInclude(options),
    order: [
      ['createdAt', 'DESC'],
      ['id', 'DESC'],
    ],
    where: { telephonyCallId: { [Op.in]: ids } },
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

async function getCall(actor, id) {
  const call = await getCallOrFail(actor, id);
  const transcriptionJob = await getLatestTranscriptionJobForCallId(call.id, {
    includeSegments: true,
  });

  return mapCall(call, actor, {
    includeTranscriptSegments: true,
    transcriptionJob,
  });
}

async function getActiveClientForCall(clientId, transaction = undefined) {
  const id = Number(clientId);
  if (!Number.isInteger(id) || id <= 0) {
    throw appError('Некорректный клиент для звонка');
  }

  const client = await db.User.findOne({
    where: {
      id,
      mergedIntoUserId: null,
      status: 'active',
    },
    transaction,
  });
  if (!client) {
    throw appError('Активный клиент для звонка не найден', 404);
  }

  return client;
}

async function syncFollowUpTaskClient(call, client, transaction = undefined) {
  if (!call.followUpCallTaskId) return null;

  const task = await db.CallTask.findByPk(call.followUpCallTaskId, {
    transaction,
  });
  if (!task) return null;

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

async function linkCallClient(actor, id, data = {}) {
  const callId = await db.sequelize.transaction(async (transaction) => {
    const call = await getCallOrFail(actor, id, { transaction });
    const client = await getActiveClientForCall(data.clientId, transaction);

    await attachCallToClient(call, client, transaction);

    return call.id;
  });

  return getCall(actor, callId);
}

async function createClientForCall(actor, id, data = {}) {
  const call = await getCallOrFail(actor, id);
  if (!call.clientPhoneNormalized || !call.clientPhone) {
    throw appError('В звонке нет телефона для создания клиента', 409);
  }

  const client = await clientsService.createClient({
    ...data,
    phone: call.clientPhone,
    status: 'active',
  }, actor);
  const clientId = client.client?.id || client.id;
  let attached = false;

  try {
    const callId = await db.sequelize.transaction(async (transaction) => {
      const freshCall = await getCallOrFail(actor, call.id, { transaction });
      const freshClient = await getActiveClientForCall(clientId, transaction);

      await attachCallToClient(freshCall, freshClient, transaction);
      return freshCall.id;
    });
    attached = true;

    return getCall(actor, callId);
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

async function completeCall(actor, id, data = {}) {
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

  return getCall(actor, callId);
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

async function normalizeLinkedBookingId(linkedBookingId, call, transaction = undefined) {
  if (!linkedBookingId) return null;

  const bookingId = Number(linkedBookingId);
  if (!Number.isInteger(bookingId)) {
    throw appError('Некорректная бронь для звонка');
  }

  const booking = await db.Booking.findByPk(bookingId, { transaction });
  if (!booking) throw appError('Бронь для звонка не найдена', 404);
  if (call.userId && booking.userId && Number(booking.userId) !== Number(call.userId)) {
    throw appError('Бронь принадлежит другому клиенту', 409);
  }

  return bookingId;
}

async function createFollowUpTaskFromCall(call, actor, dueAt, transaction = undefined) {
  const client = await db.User.findByPk(call.userId, { transaction });
  if (!client) throw appError('Клиент для задачи не найден', 404);

  const task = await db.CallTask.create(
    {
      assignedToAccountId: actor?.id || null,
      clientBaseId: null,
      createdByAccountId: actor?.id || null,
      description: call.nextActionText || `Следующий шаг по звонку ${call.clientPhone || ''}`,
      dueAt,
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

function getBeelineClient() {
  const token = normalizeText(process.env.BEELINE_API_TOKEN);
  const baseURL = normalizeText(process.env.BEELINE_API_BASE_URL);

  if (!token) throw appError('BEELINE_API_TOKEN не настроен', 409);
  if (!baseURL) throw appError('BEELINE_API_BASE_URL не настроен', 409);

  return axios.create({
    baseURL,
    headers: {
      'X-MPBX-API-AUTH-TOKEN': token,
    },
    timeout: Number(process.env.BEELINE_API_TIMEOUT_MS || 15000),
  });
}

function unwrapApiList(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.items)) return data.items;
  if (Array.isArray(data?.data)) return data.data;
  if (Array.isArray(data?.records)) return data.records;
  return [];
}

async function syncStatistics({ dateFrom, dateTo, pageSize = 100 } = {}) {
  const client = getBeelineClient();
  const statisticsPath = normalizeText(process.env.BEELINE_STATISTICS_PATH) || '/v2/statistics';
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
      await receiveBeelineEvent({
        body: {
          ...row,
          eventType: 'statistics',
        },
        headers: {},
        ip: null,
        query: { source: 'manual-sync' },
        skipSecret: true,
      });
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

async function syncRecordings({ dateFrom, dateTo, id, userId } = {}) {
  const client = getBeelineClient();
  const recordsPath = normalizeText(process.env.BEELINE_RECORDS_PATH) || '/records';
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
      await db.sequelize.transaction(async (transaction) => {
        const call = await upsertCallFromRecording(recording, transaction);
        if (call) linked += 1;
      });
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

  return {
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

async function refreshRecordingReferenceForCall(call) {
  const client = getBeelineClient();
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

function buildSubscriptionRequestPayload(data = {}) {
  const callbackUrl = normalizeText(data.url) || normalizeText(process.env.BEELINE_CALLBACK_URL);
  if (!callbackUrl) throw appError('BEELINE_CALLBACK_URL не настроен', 409);

  return {
    expires: data.expires || getSubscriptionExpiresSeconds(),
    pattern: normalizeText(data.pattern || process.env.BEELINE_SUBSCRIPTION_PATTERN) || undefined,
    subscriptionType:
      normalizeSubscriptionType(data.subscriptionType || process.env.BEELINE_SUBSCRIPTION_TYPE),
    url: callbackUrl,
  };
}

function subscriptionMatchesDesired(subscription, desired) {
  if (!subscription) return false;

  return (
    normalizeText(subscription.callbackUrl) === normalizeText(desired.url) &&
    normalizeText(subscription.pattern) === normalizeText(desired.pattern) &&
    normalizeSubscriptionType(subscription.subscriptionType) ===
      normalizeSubscriptionType(desired.subscriptionType)
  );
}

async function refreshRecordingReference(actor, id) {
  const call = await getCallOrFail(actor, id);
  await refreshRecordingReferenceForCall(call);

  return getCall(actor, call.id);
}

async function createTranscriptionJob(actor, callId) {
  const call = await getCallOrFail(actor, callId);
  if (call.recordingStatus !== 'available') {
    throw appError('Транскрибация доступна только для звонков с записью', 409);
  }

  const latestJob = await getLatestTranscriptionJobForCallId(call.id);
  if (
    latestJob &&
    (TRANSCRIPTION_ACTIVE_STATUSES.has(latestJob.status) || latestJob.status === 'completed')
  ) {
    return getCall(actor, call.id);
  }

  await db.TelephonyTranscriptionJob.create({
    createdByAccountId: actor?.id || null,
    status: 'queued',
    telephonyCallId: call.id,
  });

  return getCall(actor, call.id);
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

async function listTranscriptionJobs(actor, query = {}) {
  const { page, pageSize, where } = normalizeTranscriptionJobQuery(query);
  const { count, rows } = await db.TelephonyTranscriptionJob.findAndCountAll({
    distinct: true,
    include: scopedTranscriptionJobInclude(actor, {
      includeCallRelations: true,
      includeSegments: true,
    }),
    limit: pageSize,
    offset: (page - 1) * pageSize,
    order: [
      ['createdAt', 'DESC'],
      ['id', 'DESC'],
    ],
    where,
  });

  return {
    items: rows.map((row) => mapUserTranscriptionJob(row, { includeSegments: true })),
    page,
    pageSize,
    total: count,
  };
}

async function listCallTranscriptionJobs(actor, callId, query = {}) {
  const call = await getCallOrFail(actor, callId);
  return listTranscriptionJobs(actor, {
    ...query,
    callId: call.id,
  });
}

async function getTranscriptionJob(actor, id) {
  const jobId = Number(id);
  if (!Number.isInteger(jobId) || jobId <= 0) {
    throw appError('Некорректная задача транскрибации');
  }

  const job = await db.TelephonyTranscriptionJob.findOne({
    include: scopedTranscriptionJobInclude(actor, {
      includeCallRelations: true,
      includeSegments: true,
    }),
    where: { id: jobId },
  });
  if (!job) throw appError('Задача транскрибации не найдена', 404);

  return { job: mapUserTranscriptionJob(job, { includeSegments: true }) };
}

async function getTranscriptionStats(actor) {
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
      include: [
        ...transcriptionJobInclude({ includeSegments: true }),
        workerQueueCallInclude(),
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
      .map((job) => mapWorkerTranscriptionJob(job, { includeSegments: true })),
    totals,
  };
}

async function getTranscriptionJobOrFail(id, options = {}) {
  const job = await db.TelephonyTranscriptionJob.findByPk(id, {
    include: transcriptionJobInclude({
      includeCall: options.includeCall,
      includeSegments: options.includeSegments,
    }),
    lock: options.lock,
    transaction: options.transaction,
  });
  if (!job) throw appError('Задача транскрибации не найдена', 404);
  return job;
}

async function getUserTranscriptionJobOrFail(actor, id, options = {}) {
  const job = await getTranscriptionJobOrFail(id, options);
  await getCallOrFail(actor, job.telephonyCallId, {
    transaction: options.transaction,
  });
  return job;
}

async function claimTranscriptionJob(data = {}) {
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
        errorMessage: null,
        failedAt: null,
        status: 'processing',
        workerId: normalizeText(data.workerId),
      },
      { transaction },
    );

    return job.id;
  });

  if (!jobId) return { job: null };

  const job = await getTranscriptionJobOrFail(jobId, { includeCall: true });
  return { job: mapWorkerTranscriptionJob(job) };
}

async function getTranscriptionJobAudioReference(jobId) {
  const job = await getTranscriptionJobOrFail(jobId, { includeCall: true });
  if (job.status !== 'processing') {
    throw appError('Получить аудио можно только для задачи в обработке', 409);
  }

  const call = await db.TelephonyCall.findByPk(job.telephonyCallId);
  if (!call) throw appError('Звонок для транскрибации не найден', 404);
  if (call.recordingStatus !== 'available') {
    throw appError('У звонка нет доступной записи для транскрибации', 409);
  }

  const audio = await refreshRecordingReferenceForCall(call);
  return {
    audio,
    job: mapWorkerTranscriptionJob(job),
  };
}

async function completeTranscriptionJob(jobId, data = {}) {
  const normalized = normalizeTranscriptSegments(data);
  if (!normalized.transcriptText && normalized.segments.length === 0) {
    throw appError('Передайте текст транскрибации или segments', 400);
  }

  const savedJobId = await db.sequelize.transaction(async (transaction) => {
    const job = await getTranscriptionJobOrFail(jobId, {
      lock: transaction.LOCK.UPDATE,
      transaction,
    });
    if (job.status !== 'processing') {
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
        completedAt: new Date(),
        errorMessage: null,
        failedAt: null,
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
    includeSegments: true,
  });
  return { job: mapWorkerTranscriptionJob(job, { includeSegments: true }) };
}

async function failTranscriptionJob(jobId, data = {}) {
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

async function retryTranscriptionJob(actor, jobId) {
  const job = await getUserTranscriptionJobOrFail(actor, jobId);
  if (job.status === 'queued' || job.status === 'processing') {
    return getCall(actor, job.telephonyCallId);
  }
  if (job.status === 'completed') {
    throw appError('Завершенную транскрибацию нельзя повторить через retry', 409);
  }

  await db.sequelize.transaction(async (transaction) => {
    const lockedJob = await getUserTranscriptionJobOrFail(actor, job.id, {
      lock: transaction.LOCK.UPDATE,
      transaction,
    });
    if (lockedJob.status !== 'failed') {
      throw appError('Повторить можно только задачу с ошибкой', 409);
    }

    await db.TelephonyTranscriptSegment.destroy({
      transaction,
      where: { transcriptionJobId: lockedJob.id },
    });
    await lockedJob.update(
      {
        claimedAt: null,
        completedAt: null,
        errorMessage: null,
        failedAt: null,
        corrections: null,
        rawAsrJson: null,
        rawTranscriptText: null,
        status: 'queued',
        workerId: null,
      },
      { transaction },
    );
  });

  return getCall(actor, job.telephonyCallId);
}

async function retryTranscriptionJobForWorker(jobId, data = {}) {
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
        corrections: null,
        rawAsrJson: null,
        rawTranscriptText: null,
        claimedAt: new Date(),
        status: 'processing',
        workerId: normalizeText(data.workerId),
      },
      { transaction },
    );

    return lockedJob.id;
  });

  const freshJob = await getTranscriptionJobOrFail(savedJobId, { includeCall: true });
  return { job: mapWorkerTranscriptionJob(freshJob) };
}

async function subscribeToEvents(data = {}) {
  const client = getBeelineClient();
  const subscriptionPath = normalizeText(process.env.BEELINE_SUBSCRIPTION_PATH) || '/subscription';
  const requestPayload = buildSubscriptionRequestPayload(data);
  const callbackUrl = requestPayload.url;

  if (isWebhookSecretRequired() && !normalizeText(process.env.BEELINE_WEBHOOK_SECRET)) {
    throw appError('BEELINE_WEBHOOK_SECRET не настроен для XSI callback', 409);
  }

  try {
    const response = await client.put(subscriptionPath, requestPayload);
    const normalized = normalizeSubscriptionResponse(response.data, requestPayload);
    const existing = normalized.subscriptionId
      ? await db.TelephonySubscription.findOne({
          where: {
            provider: 'beeline',
            subscriptionId: normalized.subscriptionId,
          },
        })
      : await db.TelephonySubscription.findOne({
          order: [['createdAt', 'DESC']],
          where: {
            callbackUrl,
            provider: 'beeline',
          },
        });

    const row = existing
      ? await existing.update({
          ...normalized,
          callbackUrl,
          lastCheckedAt: new Date(),
          lastError: null,
          lastRequest: requestPayload,
          lastResponse: response.data,
          provider: 'beeline',
        })
      : await db.TelephonySubscription.create({
          ...normalized,
          callbackUrl,
          lastCheckedAt: new Date(),
          lastRequest: requestPayload,
          lastResponse: response.data,
          provider: 'beeline',
        });

    return mapSubscription(row);
  } catch (error) {
    const message = getBeelineErrorMessage(error, 'Билайн не создал XSI-подписку');
    await db.TelephonySubscription.create({
      callbackUrl,
      expiresSeconds: requestPayload.expires,
      lastCheckedAt: new Date(),
      lastError: message,
      lastRequest: requestPayload,
      lastResponse: error.response?.data || null,
      pattern: normalizeText(requestPayload.pattern),
      provider: 'beeline',
      status: 'failed',
      subscriptionType: requestPayload.subscriptionType,
    });
    throw appError(message, 409, error.response?.data);
  }
}

async function checkEventSubscription() {
  const client = getBeelineClient();
  const subscriptionPath = normalizeText(process.env.BEELINE_SUBSCRIPTION_PATH) || '/subscription';
  const callbackUrl = normalizeText(process.env.BEELINE_CALLBACK_URL) || '';
  const latest = await getLatestSubscription({ preferActive: true });

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
      expires: latest?.expiresSeconds || Number(process.env.BEELINE_SUBSCRIPTION_EXPIRES || 3600),
      pattern: latest?.pattern || process.env.BEELINE_SUBSCRIPTION_PATTERN || undefined,
      subscriptionType:
        latest?.subscriptionType || process.env.BEELINE_SUBSCRIPTION_TYPE || 'BASIC_CALL',
    });
    const where = normalized.subscriptionId
      ? { provider: 'beeline', subscriptionId: normalized.subscriptionId }
      : latest?.id
        ? { id: latest.id }
        : { callbackUrl, provider: 'beeline' };
    const existing = await db.TelephonySubscription.findOne({ where });
    const row = existing
      ? await existing.update({
          ...normalized,
          callbackUrl: existing.callbackUrl || callbackUrl || latest?.callbackUrl,
          lastCheckedAt: new Date(),
          lastError: null,
          lastResponse: response.data,
          provider: 'beeline',
        })
      : await db.TelephonySubscription.create({
          ...normalized,
          callbackUrl: callbackUrl || latest?.callbackUrl || 'unknown',
          lastCheckedAt: new Date(),
          lastResponse: response.data,
          provider: 'beeline',
        });

    return mapSubscription(row);
  } catch (error) {
    const message = getBeelineErrorMessage(error, 'Билайн не проверил XSI-подписку');
    if (latest?.id) {
      const row = await db.TelephonySubscription.findByPk(latest.id);
      if (row) {
        await row.update({
          lastCheckedAt: new Date(),
          lastError: message,
          lastResponse: error.response?.data || null,
          status: 'failed',
        });
      }
    }
    throw appError(message, 409, error.response?.data);
  }
}

async function maintainEventSubscription({ force = false } = {}) {
  if (!isSubscriptionAutoRenewEnabled()) {
    return { action: 'skipped', reason: 'disabled' };
  }

  if (
    !normalizeText(process.env.BEELINE_API_TOKEN) ||
    !normalizeText(process.env.BEELINE_API_BASE_URL) ||
    !normalizeText(process.env.BEELINE_CALLBACK_URL)
  ) {
    return { action: 'skipped', reason: 'not_configured' };
  }

  return withSubscriptionMaintenanceLock(async () => {
    const latest = await getLatestSubscription({ preferActive: true });
    const desired = buildSubscriptionRequestPayload({});
    const renewBeforeMs = getSubscriptionRenewBeforeSeconds() * 1000;
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
      const subscription = await subscribeToEvents({});
      return {
        action: latest?.subscriptionId ? 'renewed' : 'created',
        subscription,
      };
    } catch (error) {
      return {
        action: 'failed',
        error: error.message,
        details: error.details,
      };
    }
  });
}

async function withSubscriptionMaintenanceLock(callback) {
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

async function getActiveSubscriptionCandidate() {
  const activeRow = await db.TelephonySubscription.findOne({
    order: [['updatedAt', 'DESC']],
    where: {
      provider: 'beeline',
      status: 'active',
      subscriptionId: { [Op.ne]: null },
    },
  });

  return mapSubscription(activeRow);
}

async function getLatestSubscription({ preferActive = false } = {}) {
  if (preferActive) {
    const active = await getActiveSubscriptionCandidate();
    if (active) return active;
  }

  const row = await db.TelephonySubscription.findOne({
    order: [['updatedAt', 'DESC']],
    where: {
      provider: 'beeline',
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

async function listRawEvents(query = {}) {
  const page = Math.max(Number(query.page) || 1, 1);
  const pageSize = Math.min(Math.max(Number(query.pageSize) || 20, 1), 100);
  const where = {};
  if (query.status && query.status !== 'all') {
    where.processingStatus = query.status;
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
  createClientForCall,
  createTranscriptionJob,
  failTranscriptionJob,
  claimTranscriptionJob,
  getTranscriptionJobAudioReference,
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
