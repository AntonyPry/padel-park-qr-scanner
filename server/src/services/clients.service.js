const crypto = require('crypto');
const { Op } = require('sequelize');
const db = require('../../models');
const {
  formatRussianPhone,
  getPhoneLookupDigits,
} = require('../utils/phone');
const onboardingService = require('./onboarding.service');
const referencesService = require('./references.service');
const clientSkillMapService = require('./client-skill-map.service');
const certificatesService = require('./certificates.service');
const subscriptionsService = require('./subscriptions.service');
const trainingNotesService = require('./training-notes.service');
const {
  resolveClientAccessContext,
} = require('./client-access-context.service');
const {
  bookingTenantWhere,
  resolveBookingAccessContext,
} = require('./booking-access-context.service');
const {
  resolveCallTaskAccessContext,
} = require('./call-task-access-context.service');
const {
  isTenantBookingsCourtsEnabled,
  isTenantClientBasesCallTasksEnabled,
} = require('../tenant-context/capabilities');
const { ACCESS_MATRIX } = require('../constants/access-matrix');

const CLIENT_ATTRIBUTES = [
  'id',
  'telegramId',
  'vkId',
  'webId',
  'name',
  'phone',
  'phoneNormalized',
  'source',
  'sourceId',
  'note',
  'status',
  'mergedIntoUserId',
  'mergedAt',
  'mergedByAccountId',
  'createdAt',
  'updatedAt',
];

const SEGMENT_VALUES = new Set([
  'all',
  'new',
  'regular',
  'inactive',
  'no_visits',
]);
const TRAINING_LEVELS = new Set(['D', 'D+', 'C', 'C+', 'B', 'B+', 'A']);
const CLIENT_VIEW_FILTER_KEYS = new Set([
  'lastVisitDaysFrom',
  'lastVisitDaysTo',
  'lastVisitFrom',
  'lastVisitTo',
  'segment',
  'source',
  'sourceId',
  'status',
  'trainingLevel',
  'visitCategory',
  'visitCategoryId',
  'visitCountMax',
  'visitCountMin',
]);
const CLIENT_IDENTITY_FIELDS = ['telegramId', 'vkId', 'webId'];
const TRAINER_HIDDEN_CLIENT_FIELDS = new Set([
  'phone',
  'phoneNormalized',
  ...CLIENT_IDENTITY_FIELDS,
]);
const CALL_CLIENT_STATUS_WEIGHT = {
  new: 0,
  no_answer: 1,
  callback: 2,
  doubting: 3,
  refused: 4,
  booked: 5,
};
const DUPLICATE_GROUPS = [
  { field: 'phoneNormalized', label: 'Телефон', type: 'phone' },
  { field: 'telegramId', label: 'Telegram', type: 'telegram' },
  { field: 'vkId', label: 'VK', type: 'vk' },
  { field: 'webId', label: 'WEB', type: 'web' },
];
const BOOKING_STATUS_LABELS = {
  arrived: 'Клиент пришел',
  canceled: 'Отменена',
  confirmed: 'Подтверждена',
  new: 'Новая',
  no_show: 'Не пришел',
};
const PAYMENT_STATUS_LABELS = {
  paid: 'Оплачено',
  partial: 'Частично оплачено',
  refunded: 'Возврат',
  unpaid: 'Не оплачено',
};
const SERIES_WEEKDAY_LABELS = {
  1: 'Понедельник',
  2: 'Вторник',
  3: 'Среда',
  4: 'Четверг',
  5: 'Пятница',
  6: 'Суббота',
  7: 'Воскресенье',
};
const TELEPHONY_DIRECTION_LABELS = {
  inbound: 'Входящий',
  outbound: 'Исходящий',
  unknown: 'Звонок',
};
const TELEPHONY_CALL_STATUS_LABELS = {
  answered: 'Принят',
  completed: 'Завершен',
  failed: 'Ошибка',
  missed: 'Пропущен',
  new: 'Новый',
  ringing: 'Звонит',
  unknown: 'Неизвестно',
};
const TELEPHONY_PROCESSING_STATUS_LABELS = {
  ignored: 'Скрыт',
  in_progress: 'В обработке',
  new: 'Новый',
  processed: 'Обработан',
};
const TELEPHONY_RESULT_LABELS = {
  booked: 'Записался',
  callback: 'Перезвонить',
  complaint: 'Жалоба',
  corporate: 'Корпоратив',
  no_answer: 'Не взял трубку',
  other: 'Другое',
  refused: 'Отказ',
  thinking: 'Думает',
};

function appError(message, statusCode = 400, details = {}) {
  const error = new Error(message);
  error.statusCode = statusCode;
  Object.assign(error, details);
  return error;
}

function normalizeClientName(name) {
  const normalized = String(name || '').trim().replace(/\s+/g, ' ');
  if (normalized.length < 2) {
    throw appError('Имя клиента должно быть не короче 2 символов');
  }

  return normalized;
}

function normalizeStatus(status = 'active') {
  if (!['active', 'archived'].includes(status)) {
    throw appError('Некорректный статус клиента');
  }

  return status;
}

function normalizeNote(note) {
  const value = String(note || '').trim();
  return value || null;
}

function normalizeOptionalIdentity(value) {
  const normalized = String(value || '').trim();
  return normalized || null;
}

function normalizePhonePayload(phone) {
  const phoneNormalized = getPhoneLookupDigits(phone);
  if (phoneNormalized.length !== 10) {
    throw appError('Телефон клиента должен содержать 10 цифр после кода страны');
  }

  return {
    phone: formatRussianPhone(phone),
    phoneNormalized,
  };
}

function normalizeReferenceName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function isSameClientSource(client, data) {
  if (data.sourceId && Number(data.sourceId) === Number(client.sourceId)) {
    return true;
  }

  return (
    !data.sourceId &&
    data.source &&
    normalizeReferenceName(data.source).toLowerCase() ===
      normalizeReferenceName(client.source).toLowerCase()
  );
}

function getClientStatus(client) {
  if (client.status === 'archived') return 'В архиве';
  return 'Активен';
}

function getClientSegment(stats) {
  if (!stats.visitCount) return 'Без визитов';
  if (stats.visitCount === 1) return 'Новый';
  if (stats.lastVisitAt) {
    const daysSinceLastVisit =
      (Date.now() - new Date(stats.lastVisitAt).getTime()) / 86400000;
    if (daysSinceLastVisit >= 60) return 'Давно не был';
  }
  if (stats.visitCount >= 3) return 'Постоянный';
  return 'Повторный';
}

function mapClient(row) {
  if (!row) return null;
  const raw = row.toJSON ? row.toJSON() : row;
  const { organizationId: _organizationId, ...publicRaw } = raw;
  const visitCount = Number(raw.visitCount || 0);
  const stats = {
    firstVisitAt: raw.firstVisitAt || null,
    lastVisitAt: raw.lastVisitAt || null,
    visitCount,
  };
  const training = {
    latestAt: raw.latestTrainingAt || null,
    latestLevel: raw.latestTrainingLevel || null,
    notesCount: Number(raw.trainingNotesCount || 0),
  };

  return {
    ...publicRaw,
    statusLabel: getClientStatus(raw),
    segment: getClientSegment(stats),
    stats,
    training,
  };
}

function clientWhere(context, where = {}) {
  return context.scoped
    ? { ...where, organizationId: context.organizationId }
    : where;
}

function isTrainer(account) {
  return account?.role === 'trainer';
}

function canViewTrainingNotes(account) {
  return ['owner', 'manager', 'trainer'].includes(account?.role);
}

function canViewClientSubscriptions(account) {
  return ACCESS_MATRIX.clientSubscriptionsView.includes(account?.role);
}

function canViewCertificates(account) {
  return ACCESS_MATRIX.certificatesView.includes(account?.role);
}

function toDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function daysUntil(value, now = new Date()) {
  const date = toDate(value);
  if (!date) return null;
  return Math.ceil((date.getTime() - now.getTime()) / 86400000);
}

function formatShortDate(value) {
  const date = toDate(value);
  if (!date) return 'без даты';
  return date.toLocaleDateString('ru-RU');
}

function buildSubscriptionWarning(subscription, now = new Date()) {
  if (!subscription) return null;
  if (subscription.status === 'expired') {
    return {
      id: `subscription-${subscription.id}-expired`,
      level: 'danger',
      text: `${subscription.typeName} истек ${formatShortDate(subscription.expiresAt)}`,
      type: 'expired',
    };
  }
  if (subscription.status === 'used') {
    return {
      id: `subscription-${subscription.id}-used`,
      level: 'danger',
      text: `${subscription.typeName} закончился`,
      type: 'used',
    };
  }
  if (subscription.status === 'canceled') {
    return {
      id: `subscription-${subscription.id}-canceled`,
      level: 'muted',
      text: `${subscription.typeName} отменен`,
      type: 'canceled',
    };
  }

  const daysLeft = daysUntil(subscription.expiresAt, now);
  if (daysLeft !== null && daysLeft >= 0 && daysLeft <= 14) {
    return {
      id: `subscription-${subscription.id}-expiring`,
      level: 'warning',
      text: `${subscription.typeName} истекает через ${daysLeft} дн.`,
      type: 'expiring_soon',
    };
  }

  if (
    subscription.remainingSessions !== null &&
    subscription.remainingSessions !== undefined &&
    Number(subscription.remainingSessions) <= 1
  ) {
    return {
      id: `subscription-${subscription.id}-low`,
      level: 'warning',
      text: `${subscription.typeName}: осталось ${subscription.remainingSessions} занятий`,
      type: 'low_remaining',
    };
  }

  return null;
}

function buildCertificateWarning(certificate, now = new Date()) {
  if (!certificate) return null;
  if (certificate.status === 'expired') {
    return {
      id: `certificate-${certificate.id}-expired`,
      level: 'danger',
      text: `Сертификат ${certificate.code} истек ${formatShortDate(certificate.expiresAt)}`,
      type: 'expired',
    };
  }
  if (certificate.status === 'redeemed') {
    return {
      id: `certificate-${certificate.id}-redeemed`,
      level: 'muted',
      text: `Сертификат ${certificate.code} погашен`,
      type: 'redeemed',
    };
  }
  if (certificate.status === 'canceled') {
    return {
      id: `certificate-${certificate.id}-canceled`,
      level: 'muted',
      text: `Сертификат ${certificate.code} отменен`,
      type: 'canceled',
    };
  }

  const daysLeft = daysUntil(certificate.expiresAt, now);
  if (daysLeft !== null && daysLeft >= 0 && daysLeft <= 14) {
    return {
      id: `certificate-${certificate.id}-expiring`,
      level: 'warning',
      text: `Сертификат ${certificate.code} истекает через ${daysLeft} дн.`,
      type: 'expiring_soon',
    };
  }

  return null;
}

function buildClientPrepaymentSummary({
  certificates = [],
  subscriptions = [],
} = {}) {
  const now = new Date();
  const activeSubscriptions = subscriptions.filter(
    (subscription) => subscription.status === 'active',
  );
  const activeCertificates = certificates.filter(
    (certificate) => certificate.status === 'active',
  );
  const subscriptionWarnings = subscriptions
    .map((subscription) => buildSubscriptionWarning(subscription, now))
    .filter(Boolean);
  const certificateWarnings = certificates
    .map((certificate) => buildCertificateWarning(certificate, now))
    .filter(Boolean);

  return {
    activeCertificatesCount: activeCertificates.length,
    activeSubscriptionsCount: activeSubscriptions.length,
    certificateWarnings,
    hasActiveCertificate: activeCertificates.length > 0,
    hasActiveSubscription: activeSubscriptions.length > 0,
    subscriptionWarnings,
  };
}

function buildEmptyClientPrepaymentContext() {
  return {
    clientCertificates: [],
    clientSubscriptions: [],
    prepaymentSummary: buildClientPrepaymentSummary(),
  };
}

async function getClientPrepaymentContext(clientId, account = null) {
  const canSubscriptions = canViewClientSubscriptions(account);
  const canCertificates = canViewCertificates(account);
  const [clientSubscriptions, clientCertificates] = await Promise.all([
    canSubscriptions
      ? subscriptionsService.listClientSubscriptions(clientId)
      : [],
    canCertificates
      ? certificatesService.listClientCertificates(clientId, {
          withRedemptions: true,
        })
      : [],
  ]);

  return {
    clientCertificates,
    clientSubscriptions,
    prepaymentSummary: buildClientPrepaymentSummary({
      certificates: clientCertificates,
      subscriptions: clientSubscriptions,
    }),
  };
}

function sanitizeClientForAccount(client, account) {
  if (!client) return client;
  if (!isTrainer(account)) return client;

  const safeClient = Object.fromEntries(
    Object.entries(client).filter(([key]) => !TRAINER_HIDDEN_CLIENT_FIELDS.has(key)),
  );

  return {
    ...safeClient,
    mergedIntoUserId: null,
    mergedByAccountId: null,
    note: null,
  };
}

function sanitizeClientsForAccount(clients, account) {
  return clients.map((client) => sanitizeClientForAccount(client, account));
}

function buildTrainerClientDetailsResponse({
  client,
  mergedInto = null,
  skillMap = [],
  trainingNotes = [],
}) {
  const response = {
    client: sanitizeClientForAccount(client, { role: 'trainer' }),
    skillMap,
    trainingNotes,
  };
  if (mergedInto) {
    response.mergedInto = sanitizeClientForAccount(mergedInto, { role: 'trainer' });
  }
  return response;
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

function toNumber(value) {
  const numberValue = Number(value || 0);
  return Number.isFinite(numberValue) ? numberValue : 0;
}

function buildClientIdentityLockName(key) {
  const hash = crypto.createHash('sha1').update(String(key)).digest('hex');
  return `client:${hash.slice(0, 50)}`;
}

function getClientIdentityLockKeys(data = {}, phoneNormalized = null) {
  const keys = [];
  if (phoneNormalized) keys.push(`phone:${phoneNormalized}`);

  CLIENT_IDENTITY_FIELDS.forEach((field) => {
    if (!(field in data)) return;
    const value = normalizeOptionalIdentity(data[field]);
    if (value) keys.push(`${field}:${value}`);
  });

  return Array.from(new Set(keys));
}

function scopeClientIdentityLockKeys(keys, context) {
  if (!context.scoped) return keys;
  return keys.map((key) => `organization:${context.organizationId}:${key}`);
}

async function withClientIdentityLocks(keys, callback) {
  const lockNames = Array.from(new Set(keys.filter(Boolean))).map(
    buildClientIdentityLockName,
  );
  if (lockNames.length === 0) return callback();

  return db.sequelize.transaction(async (transaction) => {
    const acquiredLocks = [];

    try {
      for (const lockName of lockNames) {
        const [row] = await db.sequelize.query(
          'SELECT GET_LOCK(:lockName, 5) AS acquired',
          {
            replacements: { lockName },
            transaction,
            type: db.Sequelize.QueryTypes.SELECT,
          },
        );

        if (Number(row?.acquired) !== 1) {
          throw appError(
            'Не удалось заблокировать проверку дублей. Попробуйте еще раз',
            409,
          );
        }

        acquiredLocks.push(lockName);
      }

      return await callback();
    } finally {
      for (const lockName of acquiredLocks.reverse()) {
        await db.sequelize.query('SELECT RELEASE_LOCK(:lockName)', {
          replacements: { lockName },
          transaction,
          type: db.Sequelize.QueryTypes.SELECT,
        });
      }
    }
  });
}

function getLatestDate(...values) {
  return values
    .filter(Boolean)
    .map((value) => new Date(value))
    .filter((value) => !Number.isNaN(value.getTime()))
    .sort((a, b) => b.getTime() - a.getTime())[0] || null;
}

function mapCourt(court) {
  if (!court) return null;
  const raw = court.toJSON ? court.toJSON() : court;
  return {
    id: raw.id,
    name: raw.name,
    type: raw.type,
  };
}

function mapClientBooking(booking) {
  const raw = booking.toJSON ? booking.toJSON() : booking;
  return {
    id: raw.id,
    bookingSeriesId: raw.bookingSeriesId || null,
    series: raw.series
      ? {
          id: raw.series.id,
          name: raw.series.name,
          status: raw.series.status,
        }
      : null,
    court: mapCourt(raw.Court),
    courtId: raw.courtId,
    startsAt: raw.startsAt,
    endsAt: raw.endsAt,
    durationMinutes: raw.durationMinutes,
    status: raw.status,
    paymentStatus: raw.paymentStatus,
    paymentMethod: raw.paymentMethod,
    price: toNumber(raw.price),
    paidAmount: toNumber(raw.paidAmount),
    source: raw.source,
    comment: raw.comment || '',
    cancellationReason: raw.cancellationReason || '',
    canceledAt: raw.canceledAt || null,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  };
}

function mapClientBookingSeries(series) {
  const raw = series.toJSON ? series.toJSON() : series;
  return {
    id: raw.id,
    name: raw.name,
    court: mapCourt(raw.Court),
    courtId: raw.courtId,
    weekday: raw.weekday,
    startTime: raw.startTime,
    durationMinutes: raw.durationMinutes,
    startsOn: raw.startsOn,
    endsOn: raw.endsOn,
    status: raw.status,
    paymentStatus: raw.paymentStatus,
    paymentMethod: raw.paymentMethod,
    price: raw.price === null || raw.price === undefined ? null : toNumber(raw.price),
    comment: raw.comment || '',
    archiveReason: raw.archiveReason || '',
    archivedAt: raw.archivedAt || null,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  };
}

function getEmptyBookingStats() {
  return {
    activeCount: 0,
    canceledCount: 0,
    nextBookingAt: null,
    paidAmount: 0,
    plannedAmount: 0,
    totalCount: 0,
    upcomingCount: 0,
  };
}

function normalizeClientViewFilters(filters = {}) {
  const normalized = {};
  Object.entries(filters || {}).forEach(([key, value]) => {
    if (!CLIENT_VIEW_FILTER_KEYS.has(key)) return;
    if (value === undefined || value === null || value === '' || value === 'all') {
      if (key === 'status' || key === 'segment') normalized[key] = 'all';
      return;
    }

    if (
      [
        'lastVisitDaysFrom',
        'lastVisitDaysTo',
        'sourceId',
        'visitCategoryId',
        'visitCountMax',
        'visitCountMin',
      ].includes(key)
    ) {
      const numberValue = Number(value);
      if (Number.isFinite(numberValue) && numberValue >= 0) {
        normalized[key] = numberValue;
      }
      return;
    }

    normalized[key] = String(value).trim();
  });

  return {
    segment: normalized.segment || 'all',
    status: normalized.status || 'active',
    ...normalized,
  };
}

function parseNonNegativeNumberFilter(value) {
  if (value === undefined || value === null) return null;

  const normalized = String(value).trim();
  if (!normalized) return null;

  const numberValue = Number(normalized);
  return Number.isFinite(numberValue) && numberValue >= 0 ? numberValue : null;
}

function parsePaging(query) {
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const pageSize = Math.min(
    100,
    Math.max(10, Number.parseInt(query.pageSize, 10) || 25),
  );

  return {
    limit: pageSize,
    offset: (page - 1) * pageSize,
    page,
    pageSize,
  };
}

function buildClientListSql(query, paging, countOnly = false, options = {}) {
  const where = [];
  const having = [];
  const replacements = {};
  const includePhoneSearch = options.includePhoneSearch !== false;
  const status = ['active', 'archived', 'all'].includes(query.status)
    ? query.status
    : 'active';
  const segment = SEGMENT_VALUES.has(query.segment) ? query.segment : 'all';
  const trainingLevel = String(query.trainingLevel || '').trim().toUpperCase();

  where.push('COALESCE(u.isTraining, 0) = 0');

  if (options.context?.scoped) {
    where.push('u.organizationId = :organizationId');
    replacements.organizationId = options.context.organizationId;
  }

  // Merged rows are technical tombstones. They never represent clients in list/search.
  where.push('u.mergedIntoUserId IS NULL');

  if (status !== 'all') {
    where.push('u.status = :status');
    replacements.status = status;
  }

  const sourceId = Number(query.sourceId);
  if (Number.isInteger(sourceId) && sourceId > 0) {
    where.push('u.sourceId = :sourceId');
    replacements.sourceId = sourceId;
  }

  if (!(Number.isInteger(sourceId) && sourceId > 0) && query.source) {
    where.push('u.source = :source');
    replacements.source = query.source;
  }

  const visitCategoryId = Number(query.visitCategoryId);
  if (Number.isInteger(visitCategoryId) && visitCategoryId > 0) {
    where.push(`
      EXISTS (
        SELECT 1
        FROM Visits vcid
        JOIN VisitCategoryAssignments vca ON vca.visitId = vcid.id
        WHERE vcid.userId = u.id
          AND COALESCE(vcid.isTraining, 0) = 0
          AND vca.visitCategoryId = :visitCategoryId
      )
    `);
    replacements.visitCategoryId = visitCategoryId;
  }

  const visitCategory = String(query.visitCategory || '').trim();
  if (!(Number.isInteger(visitCategoryId) && visitCategoryId > 0) && visitCategory) {
    where.push(`
      EXISTS (
        SELECT 1
        FROM Visits vc
        WHERE vc.userId = u.id
          AND COALESCE(vc.isTraining, 0) = 0
          AND vc.category LIKE :visitCategory
      )
    `);
    replacements.visitCategory = `%${visitCategory}%`;
  }

  const q = String(query.q || '').trim();
  const phoneDigits = getPhoneLookupDigits(q);
  if (q) {
    const searchParts = ['u.name LIKE :q'];
    replacements.q = `%${q}%`;

    if (includePhoneSearch) {
      searchParts.push('u.phone LIKE :q');
    }

    if (includePhoneSearch && phoneDigits.length >= 2) {
      searchParts.push('u.phoneNormalized LIKE :phoneQ');
      replacements.phoneQ = `%${phoneDigits}%`;
    }

    searchParts.push(`EXISTS (
      SELECT 1
      FROM Users merged_alias
      WHERE merged_alias.mergedIntoUserId = u.id
        AND merged_alias.organizationId = u.organizationId
        AND (
          merged_alias.name LIKE :q
          ${includePhoneSearch ? 'OR merged_alias.phone LIKE :q' : ''}
          ${includePhoneSearch && phoneDigits.length >= 2 ? 'OR merged_alias.phoneNormalized LIKE :phoneQ' : ''}
        )
    )`);

    where.push(`(${searchParts.join(' OR ')})`);
  }

  if (query.duplicateOnly === 'true') {
    where.push(`
      u.phoneNormalized IS NOT NULL
      AND u.phoneNormalized IN (
        SELECT phoneNormalized
      FROM Users
        WHERE status = 'active'
          AND organizationId = u.organizationId
          AND COALESCE(isTraining, 0) = 0
          AND mergedIntoUserId IS NULL
          AND phoneNormalized IS NOT NULL
        GROUP BY phoneNormalized
        HAVING COUNT(*) > 1
      )
    `);
  }

  if (query.lastVisitFrom) {
    having.push('lastVisitAt >= :lastVisitFrom');
    replacements.lastVisitFrom = `${query.lastVisitFrom} 00:00:00`;
  }

  if (query.lastVisitTo) {
    having.push('lastVisitAt <= :lastVisitTo');
    replacements.lastVisitTo = `${query.lastVisitTo} 23:59:59`;
  }

  const visitCountMin = parseNonNegativeNumberFilter(query.visitCountMin);
  if (visitCountMin !== null && visitCountMin > 0) {
    having.push('visitCount >= :visitCountMin');
    replacements.visitCountMin = visitCountMin;
  }

  const visitCountMax = parseNonNegativeNumberFilter(query.visitCountMax);
  if (visitCountMax !== null) {
    having.push('visitCount <= :visitCountMax');
    replacements.visitCountMax = visitCountMax;
  }

  const lastVisitDaysFrom = parseNonNegativeNumberFilter(query.lastVisitDaysFrom);
  if (lastVisitDaysFrom !== null && lastVisitDaysFrom > 0) {
    having.push('lastVisitAt IS NOT NULL');
    having.push('lastVisitAt <= DATE_SUB(NOW(), INTERVAL :lastVisitDaysFrom DAY)');
    replacements.lastVisitDaysFrom = lastVisitDaysFrom;
  }

  const lastVisitDaysTo = parseNonNegativeNumberFilter(query.lastVisitDaysTo);
  if (lastVisitDaysTo !== null && lastVisitDaysTo > 0) {
    having.push('lastVisitAt IS NOT NULL');
    having.push('lastVisitAt >= DATE_SUB(NOW(), INTERVAL :lastVisitDaysTo DAY)');
    replacements.lastVisitDaysTo = lastVisitDaysTo;
  }

  if (segment === 'new') having.push('visitCount = 1');
  if (segment === 'regular') having.push('visitCount >= 3');
  if (segment === 'no_visits') having.push('visitCount = 0');
  if (segment === 'inactive') {
    having.push('visitCount > 0');
    having.push('lastVisitAt < DATE_SUB(NOW(), INTERVAL 60 DAY)');
  }
  if (TRAINING_LEVELS.has(trainingLevel)) {
    having.push('latestTrainingLevel = :trainingLevel');
    replacements.trainingLevel = trainingLevel;
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const havingSql = having.length ? `HAVING ${having.join(' AND ')}` : '';

  const baseSql = `
    SELECT
      u.*,
      COUNT(v.id) AS visitCount,
      MIN(v.scannedAt) AS firstVisitAt,
      MAX(v.scannedAt) AS lastVisitAt,
      (
        SELECT tn.level
        FROM TrainingNotes tn
        WHERE tn.userId = u.id AND COALESCE(tn.isTraining, 0) = 0
        ORDER BY tn.trainedAt DESC, tn.createdAt DESC
        LIMIT 1
      ) AS latestTrainingLevel,
      (
        SELECT tn.trainedAt
        FROM TrainingNotes tn
        WHERE tn.userId = u.id AND COALESCE(tn.isTraining, 0) = 0
        ORDER BY tn.trainedAt DESC, tn.createdAt DESC
        LIMIT 1
      ) AS latestTrainingAt,
      (
        SELECT COUNT(*)
        FROM TrainingNotes tn_count
        WHERE tn_count.userId = u.id AND COALESCE(tn_count.isTraining, 0) = 0
      ) AS trainingNotesCount,
      (
        SELECT merged_user.name
        FROM Users merged_user
        WHERE merged_user.id = u.mergedIntoUserId
        LIMIT 1
      ) AS mergedIntoName
    FROM Users u
    LEFT JOIN Visits v ON v.userId = u.id AND COALESCE(v.isTraining, 0) = 0
    ${whereSql}
    GROUP BY u.id
    ${havingSql}
  `;

  if (countOnly) {
    return {
      sql: `SELECT COUNT(*) AS total FROM (${baseSql}) clients`,
      replacements,
    };
  }

  return {
    sql: `
      SELECT *
      FROM (${baseSql}) clients
      ORDER BY
        CASE WHEN clients.lastVisitAt IS NULL THEN 1 ELSE 0 END,
        clients.lastVisitAt DESC,
        clients.createdAt DESC
      LIMIT :limit OFFSET :offset
    `,
    replacements: {
      ...replacements,
      limit: paging.limit,
      offset: paging.offset,
    },
  };
}

async function listClients(query = {}, account = null, tenant = null) {
  const context = await resolveClientAccessContext(tenant);
  const paging = parsePaging(query);
  const sqlOptions = {
    context,
    includePhoneSearch: !isTrainer(account),
  };
  const [listQuery, countQuery] = [
    buildClientListSql(query, paging, false, sqlOptions),
    buildClientListSql(query, paging, true, sqlOptions),
  ];

  const [rows, countRows, sources] = await Promise.all([
    db.sequelize.query(listQuery.sql, {
      replacements: listQuery.replacements,
      type: db.Sequelize.QueryTypes.SELECT,
    }),
    db.sequelize.query(countQuery.sql, {
      replacements: countQuery.replacements,
      type: db.Sequelize.QueryTypes.SELECT,
    }),
    getSources(tenant),
  ]);

  const total = Number(countRows[0]?.total || 0);
  return {
    items: sanitizeClientsForAccount(rows.map(mapClient), account),
    page: paging.page,
    pageSize: paging.pageSize,
    sources,
    total,
    totalPages: Math.max(1, Math.ceil(total / paging.pageSize)),
  };
}

async function listClientsForSnapshot(query = {}, options = {}) {
  const context = options.context || await resolveClientAccessContext(options.tenant || null);
  const limit = Math.min(
    20000,
    Math.max(1, Number.parseInt(options.limit, 10) || 5000),
  );
  const listQuery = buildClientListSql(query, { limit, offset: 0 }, false, {
    context,
  });
  const rows = await db.sequelize.query(listQuery.sql, {
    replacements: listQuery.replacements,
    type: db.Sequelize.QueryTypes.SELECT,
  });

  return rows.map(mapClient);
}

async function countClients(query = {}, tenant = null, options = {}) {
  const context = options.context || await resolveClientAccessContext(tenant);
  const paging = parsePaging({ ...query, page: 1, pageSize: 10 });
  const countQuery = buildClientListSql(query, paging, true, { context });
  const rows = await db.sequelize.query(countQuery.sql, {
    replacements: countQuery.replacements,
    type: db.Sequelize.QueryTypes.SELECT,
  });

  return Number(rows[0]?.total || 0);
}

function normalizeSavedViewName(name) {
  const normalized = String(name || '').trim().replace(/\s+/g, ' ');
  if (normalized.length < 2) {
    throw appError('Название представления должно быть не короче 2 символов');
  }
  if (normalized.length > 80) {
    throw appError('Название представления должно быть не длиннее 80 символов');
  }

  return normalized;
}

function assertSavedViewsAccount(account) {
  if (!account?.id) {
    throw appError('Нужна авторизация для работы с представлениями', 401);
  }
}

function mapSavedView(row) {
  const raw = row.toJSON ? row.toJSON() : row;
  return {
    createdAt: raw.createdAt,
    filters: normalizeClientViewFilters(raw.filters),
    id: raw.id,
    name: raw.name,
    updatedAt: raw.updatedAt,
  };
}

async function resolveSavedViewContext(account, tenant, options = {}) {
  assertSavedViewsAccount(account);
  const context = await resolveCallTaskAccessContext(tenant, {
    ...options,
    accountId: account.id,
  });
  if (context.readScoped && Number(context.accountId) !== Number(account.id)) {
    throw appError('Представление клиентов не найдено', 404);
  }
  if (!context.membershipId) {
    throw appError('Представление клиентов недоступно', 404);
  }
  return context;
}

function savedViewWhere(account, context, values = {}) {
  const where = { ...values, accountId: account.id };
  if (!context.readScoped) return where;
  return {
    ...where,
    clubId: context.clubId,
    membershipId: context.membershipId,
    organizationId: context.organizationId,
  };
}

async function listSavedViews(account, tenant = null) {
  assertSavedViewsAccount(account);
  const context = await resolveSavedViewContext(account, tenant);
  const views = await db.ClientSavedView.findAll({
    order: [['name', 'ASC']],
    where: savedViewWhere(account, context),
  });

  return views.map(mapSavedView);
}

async function getSavedViewOrFail(account, id, tenant = null, options = {}) {
  assertSavedViewsAccount(account);
  const context = options.context || await resolveSavedViewContext(
    account,
    tenant,
    options,
  );
  const view = await db.ClientSavedView.findOne({
    lock: options.lock,
    transaction: options.transaction,
    where: savedViewWhere(account, context, {
      id: Number(id),
    }),
  });

  if (!view) throw appError('Представление клиентов не найдено', 404);
  return view;
}

async function createSavedView(account, data, tenant = null) {
  assertSavedViewsAccount(account);
  const name = normalizeSavedViewName(data.name);
  const filters = normalizeClientViewFilters(data.filters);

  try {
    const view = await db.sequelize.transaction(async (transaction) => {
      const context = await resolveSavedViewContext(account, tenant, {
        lock: true,
        transaction,
      });
      return db.ClientSavedView.create({
        accountId: account.id,
        clubId: context.clubId,
        filters,
        membershipId: context.membershipId,
        name,
        organizationId: context.organizationId,
      }, { transaction });
    });

    return mapSavedView(view);
  } catch (error) {
    if (error.name === 'SequelizeUniqueConstraintError') {
      throw appError('Представление с таким названием уже существует', 409);
    }
    throw error;
  }
}

async function updateSavedView(account, id, data, tenant = null) {
  try {
    const view = await db.sequelize.transaction(async (transaction) => {
      const context = await resolveSavedViewContext(account, tenant, {
        lock: true,
        transaction,
      });
      const lockedView = await getSavedViewOrFail(account, id, tenant, {
        context,
        lock: transaction.LOCK.UPDATE,
        transaction,
      });
      const payload = {};
      if ('name' in data) payload.name = normalizeSavedViewName(data.name);
      if ('filters' in data) {
        payload.filters = normalizeClientViewFilters(data.filters);
      }
      await lockedView.update(payload, { transaction });
      return lockedView;
    });
    return mapSavedView(view);
  } catch (error) {
    if (error.name === 'SequelizeUniqueConstraintError') {
      throw appError('Представление с таким названием уже существует', 409);
    }
    throw error;
  }

}

async function deleteSavedView(account, id, tenant = null) {
  await db.sequelize.transaction(async (transaction) => {
    const context = await resolveSavedViewContext(account, tenant, {
      lock: true,
      transaction,
    });
    const view = await getSavedViewOrFail(account, id, tenant, {
      context,
      lock: transaction.LOCK.UPDATE,
      transaction,
    });
    await view.destroy({ transaction });
  });
  return { success: true };
}

async function getSources(tenant = null) {
  const rows = await referencesService.list('client-sources', {
    status: 'active',
  }, tenant);

  return rows.map((row) => row.name).filter(Boolean);
}

async function getClientStats(clientId) {
  const stats = await db.Visit.findOne({
    attributes: [
      [db.Sequelize.fn('COUNT', db.Sequelize.col('id')), 'visitCount'],
      [db.Sequelize.fn('MIN', db.Sequelize.col('scannedAt')), 'firstVisitAt'],
      [db.Sequelize.fn('MAX', db.Sequelize.col('scannedAt')), 'lastVisitAt'],
    ],
    where: { userId: clientId, isTraining: false },
    raw: true,
  });

  return {
    firstVisitAt: stats?.firstVisitAt || null,
    lastVisitAt: stats?.lastVisitAt || null,
    visitCount: Number(stats?.visitCount || 0),
  };
}

async function getClientOrFail(id, context, options = {}) {
  const where = clientWhere(context, { id });
  where.mergedIntoUserId = null;

  const client = await db.User.findOne({
    attributes: CLIENT_ATTRIBUTES,
    lock: options.lock,
    transaction: options.transaction,
    where,
  });

  if (!client) throw appError('Клиент не найден', 404);
  return client;
}

async function getDuplicateCandidates(client, context) {
  const conditions = [];
  if (client.phoneNormalized) conditions.push({ phoneNormalized: client.phoneNormalized });
  CLIENT_IDENTITY_FIELDS.forEach((field) => {
    if (client[field]) conditions.push({ [field]: client[field] });
  });
  if (conditions.length === 0) return [];

  const candidates = await db.User.findAll({
    attributes: CLIENT_ATTRIBUTES,
    where: clientWhere(context, {
      id: {
        [Op.ne]: client.id,
      },
      [Op.or]: conditions,
      status: { [Op.in]: ['active', 'archived'] },
      mergedIntoUserId: null,
    }),
    order: [
      [db.Sequelize.literal("CASE WHEN status = 'active' THEN 0 ELSE 1 END"), 'ASC'],
      ['createdAt', 'DESC'],
    ],
  });

  const statsByClientId = await getStatsByClientIds(
    candidates.map((item) => item.id),
  );

  return candidates.map((candidate) => ({
    ...mapClient({
      ...candidate.toJSON(),
      ...(statsByClientId.get(candidate.id) || {
        firstVisitAt: null,
        lastVisitAt: null,
        visitCount: 0,
      }),
    }),
  }));
}

function mapClientWithStats(client, statsByClientId) {
  return mapClient({
    ...client.toJSON(),
    ...(statsByClientId.get(client.id) || {
      firstVisitAt: null,
      lastVisitAt: null,
      visitCount: 0,
    }),
  });
}

async function getStatsByClientIds(ids) {
  if (ids.length === 0) return new Map();

  const rows = await db.Visit.findAll({
    attributes: [
      'userId',
      [db.Sequelize.fn('COUNT', db.Sequelize.col('id')), 'visitCount'],
      [db.Sequelize.fn('MIN', db.Sequelize.col('scannedAt')), 'firstVisitAt'],
      [db.Sequelize.fn('MAX', db.Sequelize.col('scannedAt')), 'lastVisitAt'],
    ],
    where: {
      userId: {
        [Op.in]: ids,
      },
    },
    group: ['userId'],
    raw: true,
  });

  return new Map(
    rows.map((row) => [
      Number(row.userId),
      {
        firstVisitAt: row.firstVisitAt || null,
        lastVisitAt: row.lastVisitAt || null,
        visitCount: Number(row.visitCount || 0),
      },
    ]),
  );
}

async function listTrainingNotes(clientId, tenant = null) {
  return trainingNotesService.listByClient(clientId, {
    limit: 50,
    skipClientCheck: true,
    tenant,
  });
}

async function listClientTelephonyCalls(clientId, account, options = {}) {
  if (!canViewCallTimeline(account) || !db.TelephonyCall) return [];

  const limit = Math.min(100, Number(options.limit) || 30);
  const rows = await db.TelephonyCall.findAll({
    include: [
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
    ],
    limit,
    order: [
      ['startedAt', 'DESC'],
      ['createdAt', 'DESC'],
    ],
    where: { userId: clientId },
  });

  return rows.map((row) => {
    const raw = row.toJSON();

    return {
      id: raw.id,
      callStatus: raw.callStatus,
      direction: raw.direction,
      durationSeconds: raw.durationSeconds,
      endedAt: raw.endedAt,
      followUpCallTask: raw.followUpCallTask
        ? {
            dueAt: raw.followUpCallTask.dueAt || null,
            id: raw.followUpCallTask.id,
            status: raw.followUpCallTask.status,
            title: raw.followUpCallTask.title,
          }
        : null,
      interest: raw.interest || null,
      nextActionAt: raw.nextActionAt || null,
      nextActionText: raw.nextActionText || '',
      processedAt: raw.processedAt || null,
      processedByAccount: mapAccount(raw.processedByAccount),
      processingStatus: raw.processingStatus,
      recordingFileSize: raw.recordingFileSize || null,
      recordingStatus: raw.recordingStatus,
      result: raw.result || null,
      staff: raw.staff
        ? {
            id: raw.staff.id,
            name: raw.staff.name,
            role: raw.staff.role,
            status: raw.staff.status,
          }
        : null,
      startedAt: raw.startedAt,
      summary: raw.summary || '',
      createdAt: raw.createdAt,
    };
  });
}

async function getClientDetails(id, account = null, tenant = null) {
  const context = await resolveClientAccessContext(tenant);
  let bookingContext = null;
  if (isTenantBookingsCourtsEnabled()) {
    if (tenant?.scope === 'club') {
      bookingContext = await resolveBookingAccessContext(tenant);
    }
  }
  const client = await getClientOrFail(id, context);

  await onboardingService.recordEventSafe(account, 'client.viewed', {
    entityId: client.id,
    entityType: 'client',
    payload: {
      clientId: client.id,
      isMerged: Boolean(client.mergedIntoUserId),
    },
  });

  const includeOperationalHistory = !isTrainer(account);
  const [
    stats,
    visits,
    duplicateCandidates,
    trainingNotes,
    skillMap,
    bookings,
    bookingSeries,
    bookingStats,
    activeCallTasks,
    telephonyCalls,
    prepaymentContext,
  ] = await Promise.all([
    getClientStats(client.id),
    includeOperationalHistory ? listClientVisits(client.id, { limit: 50 }) : [],
    isTrainer(account) ? [] : getDuplicateCandidates(client, context),
    canViewTrainingNotes(account) ? listTrainingNotes(client.id, tenant) : [],
    canViewTrainingNotes(account)
      ? clientSkillMapService.listForClient(client.id, account, { tenant })
      : [],
    includeOperationalHistory && (!isTenantBookingsCourtsEnabled() || bookingContext)
      ? listClientBookings(client.id, { limit: 50 }, bookingContext)
      : [],
    includeOperationalHistory && (!isTenantBookingsCourtsEnabled() || bookingContext)
      ? listClientBookingSeries(client.id, { limit: 30 }, bookingContext)
      : [],
    includeOperationalHistory && (!isTenantBookingsCourtsEnabled() || bookingContext)
      ? getClientBookingStats(client.id, bookingContext)
      : getEmptyBookingStats(),
    includeOperationalHistory
      ? listClientActiveCallTasks(client.id, account, context)
      : [],
    includeOperationalHistory ? listClientTelephonyCalls(client.id, account, { limit: 30 }) : [],
    includeOperationalHistory
      ? getClientPrepaymentContext(client.id, account)
      : buildEmptyClientPrepaymentContext(),
  ]);
  const { clientCertificates, clientSubscriptions, prepaymentSummary } =
    prepaymentContext;
  const safeClient = sanitizeClientForAccount(
    mapClient({ ...client.toJSON(), ...stats }),
    account,
  );

  if (isTrainer(account)) {
    return buildTrainerClientDetailsResponse({
      client: safeClient,
      skillMap,
      trainingNotes,
    });
  }

  return {
    activeCallTasks,
    bookingSeries,
    bookingStats,
    bookings,
    client: safeClient,
    clientCertificates,
    clientSubscriptions,
    duplicateCandidates: sanitizeClientsForAccount(duplicateCandidates, account),
    prepaymentSummary,
    skillMap,
    timeline: includeOperationalHistory
      ? await listClientTimeline(client.id, {
          account,
          bookingSeries,
          bookings,
          clientCertificates,
          clientSubscriptions,
          trainingNotes,
          telephonyCalls,
          visits,
          clientContext: context,
        })
      : [],
    telephonyCalls,
    trainingNotes,
    visits: includeOperationalHistory ? visits : [],
  };
}

async function listClientVisits(clientId, options = {}) {
  const limit = Math.min(200, Number(options.limit) || 50);
  const visits = await db.Visit.findAll({
    where: { userId: clientId },
    include: [
      {
        model: db.VisitCategory,
        as: 'categories',
        attributes: ['id', 'name'],
        through: { attributes: [] },
      },
    ],
    order: [['scannedAt', 'DESC']],
    limit,
  });

  return visits.map((visit) => {
    const categories = visit.categories || [];
    return {
      id: visit.id,
      scannedAt: visit.scannedAt,
      keyNumber: visit.keyNumber,
      category: visit.category,
      categoryIds: categories.map((category) => category.id),
      categories: categories.map((category) => ({
        id: category.id,
        name: category.name,
      })),
      createdAt: visit.createdAt,
    };
  });
}

async function getClientBookingStats(clientId, context = null) {
  if (!db.Booking) return getEmptyBookingStats();

  const now = new Date();
  const activeWhere = bookingTenantWhere(context, {
    isTraining: false,
    userId: clientId,
    status: { [Op.ne]: 'canceled' },
  }, { force: Boolean(context) });
  const [totalCount, activeCount, upcomingCount, canceledCount, paidAmount, plannedAmount, nextBooking] =
    await Promise.all([
      db.Booking.count({
        where: bookingTenantWhere(
          context,
          { userId: clientId, isTraining: false },
          { force: Boolean(context) },
        ),
      }),
      db.Booking.count({ where: activeWhere }),
      db.Booking.count({
        where: {
          ...activeWhere,
          startsAt: { [Op.gte]: now },
        },
      }),
      db.Booking.count({
        where: bookingTenantWhere(context, {
          userId: clientId,
          status: 'canceled',
          isTraining: false,
        }, { force: Boolean(context) }),
      }),
      db.Booking.sum('paidAmount', { where: activeWhere }),
      db.Booking.sum('price', { where: activeWhere }),
      db.Booking.findOne({
        attributes: ['startsAt'],
        where: {
          ...activeWhere,
          startsAt: { [Op.gte]: now },
        },
        order: [['startsAt', 'ASC']],
      }),
    ]);

  return {
    activeCount: Number(activeCount || 0),
    canceledCount: Number(canceledCount || 0),
    nextBookingAt: nextBooking?.startsAt || null,
    paidAmount: toNumber(paidAmount),
    plannedAmount: toNumber(plannedAmount),
    totalCount: Number(totalCount || 0),
    upcomingCount: Number(upcomingCount || 0),
  };
}

async function listClientBookings(clientId, options = {}, context = null) {
  if (!db.Booking) return [];

  const limit = Math.min(200, Number(options.limit) || 50);
  const bookings = await db.Booking.findAll({
    attributes: {
      exclude: [
        'organizationId',
        'clubId',
        'creationKeyHash',
        'creationPayloadHash',
        'lastMutationKeyHash',
        'lastMutationPayloadHash',
      ],
    },
    where: bookingTenantWhere(
      context,
      { userId: clientId },
      { force: Boolean(context) },
    ),
    include: [
      {
        attributes: { exclude: ['organizationId', 'clubId'] },
        model: db.Court,
      },
      {
        as: 'series',
        model: db.BookingSeries,
        attributes: ['id', 'name', 'status'],
      },
    ].filter((item) => item.model !== undefined || item.name !== undefined),
    order: [['startsAt', 'DESC']],
    limit,
  });

  return bookings.map(mapClientBooking);
}

async function listClientBookingSeries(clientId, options = {}, context = null) {
  if (!db.BookingSeries) return [];

  const limit = Math.min(100, Number(options.limit) || 30);
  const rows = await db.BookingSeries.findAll({
    attributes: {
      exclude: [
        'organizationId',
        'clubId',
        'creationKeyHash',
        'creationPayloadHash',
        'lastMutationKeyHash',
        'lastMutationPayloadHash',
      ],
    },
    where: bookingTenantWhere(
      context,
      { userId: clientId },
      { force: Boolean(context) },
    ),
    include: [{
      attributes: { exclude: ['organizationId', 'clubId'] },
      model: db.Court,
    }],
    order: [
      ['status', 'ASC'],
      ['weekday', 'ASC'],
      ['startTime', 'ASC'],
      ['id', 'DESC'],
    ],
    limit,
  });

  return rows.map(mapClientBookingSeries);
}

function createTimelineItem({
  actor = null,
  description = '',
  id,
  meta = {},
  occurredAt,
  title,
  type,
}) {
  return {
    actor,
    description,
    id: String(id),
    meta,
    occurredAt,
    title,
    type,
  };
}

function canViewCallTimeline(account) {
  return ['owner', 'manager', 'admin', 'viewer'].includes(account?.role);
}

function canViewClientAuditTimeline(account) {
  return ['owner', 'manager'].includes(account?.role);
}

const CLIENT_CHANGE_FIELD_LABELS = {
  name: 'имя',
  note: 'заметка',
  phone: 'телефон',
  source: 'источник',
  sourceId: 'источник',
  status: 'статус',
  telegramId: 'Telegram ID',
  vkId: 'VK ID',
  webId: 'WEB ID',
};

function parseJsonValue(value) {
  if (!value || typeof value !== 'string') return value || null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function summarizeClientAudit(raw) {
  const metadata = parseJsonValue(raw.metadata);
  const body = metadata?.body || {};
  const fields = Object.keys(body)
    .filter((key) => CLIENT_CHANGE_FIELD_LABELS[key])
    .map((key) => CLIENT_CHANGE_FIELD_LABELS[key]);

  if (fields.length === 0) return raw.summary || '';

  return `Изменены поля: ${Array.from(new Set(fields)).join(', ')}`;
}

async function resolveClientCallTaskWhere(clientContext) {
  if (!isTenantClientBasesCallTasksEnabled()) return {};
  if (!clientContext?.scoped || !clientContext.membershipId) {
    const error = appError('Контекст организации недоступен', 404);
    error.code = 'TENANT_CONTEXT_DENIED';
    throw error;
  }

  const membership = await db.Membership.findOne({
    attributes: ['id', 'role'],
    where: {
      id: clientContext.membershipId,
      organizationId: clientContext.organizationId,
      status: 'active',
    },
  });
  if (!membership) throw appError('Контекст организации недоступен', 404);

  let clubIds = [];
  if (membership.role === 'owner') {
    const clubs = await db.Club.findAll({
      attributes: ['id'],
      raw: true,
      where: {
        organizationId: clientContext.organizationId,
        status: 'active',
      },
    });
    clubIds = clubs.map((club) => Number(club.id));
  } else {
    const accesses = await db.MembershipClubAccess.findAll({
      attributes: ['clubId'],
      include: [
        {
          as: 'Club',
          attributes: [],
          model: db.Club,
          required: true,
          where: {
            organizationId: clientContext.organizationId,
            status: 'active',
          },
        },
      ],
      raw: true,
      where: {
        membershipId: membership.id,
        organizationId: clientContext.organizationId,
        status: 'active',
      },
    });
    clubIds = accesses.map((access) => Number(access.clubId));
  }

  return {
    clubId: { [Op.in]: clubIds.length > 0 ? clubIds : [-1] },
    organizationId: clientContext.organizationId,
  };
}

function accountMembershipInclude(organizationId) {
  return [
    {
      model: db.Membership,
      attributes: ['id', 'staffId'],
      required: false,
      where: { organizationId, status: 'active' },
      include: [
        {
          model: db.Staff,
          attributes: ['id', 'name'],
          required: false,
        },
      ],
    },
  ];
}

function mapTenantAccount(account) {
  if (!account) return null;
  const raw = account.toJSON ? account.toJSON() : account;
  const staff = (raw.Memberships || [])[0]?.Staff || null;
  return mapAccount({ ...raw, Staff: staff });
}

async function listClientCallTimeline(clientId, account, clientContext = null) {
  if (!canViewCallTimeline(account)) return [];
  const taskWhere = await resolveClientCallTaskWhere(clientContext);

  const rows = await db.CallTaskClient.findAll({
    include: [
      {
        model: db.CallTask,
        as: 'callTask',
        attributes: ['id', 'title', 'status', 'dueAt', 'updatedAt'],
        include: [
          {
            model: db.ClientBase,
            as: 'clientBase',
            attributes: ['id', 'name'],
          },
        ],
        required: true,
        where: taskWhere,
      },
      {
        model: db.CallTaskAttempt,
        as: 'attempts',
        include: [
          {
            model: db.Account,
            as: 'actorAccount',
            attributes: ['id', 'email', 'role', 'staffId'],
            include: accountMembershipInclude(clientContext?.organizationId),
          },
        ],
      },
    ],
    limit: 25,
    order: [
      ['updatedAt', 'DESC'],
      [{ model: db.CallTaskAttempt, as: 'attempts' }, 'createdAt', 'DESC'],
    ],
    where: { userId: clientId },
  });

  return rows.flatMap((row) => {
    const raw = row.toJSON();
    const task = raw.callTask;
    const items = [
      createTimelineItem({
        description: raw.summary || task?.clientBase?.name || '',
        id: `call-task-client-${raw.id}`,
        meta: {
          deadlineAt: raw.deadlineAt,
          status: raw.status,
          taskId: task?.id || raw.callTaskId,
          taskStatus: task?.status || null,
        },
        occurredAt: raw.contactedAt || raw.updatedAt || raw.createdAt,
        title: task?.title || 'Задача обзвона',
        type: 'call_task',
      }),
    ];

    (raw.attempts || []).forEach((attempt) => {
      items.push(
        createTimelineItem({
          actor: mapTenantAccount(attempt.actorAccount),
          description: attempt.summary || '',
          id: `call-attempt-${attempt.id}`,
          meta: {
            deadlineAt: attempt.deadlineAt,
            status: attempt.status,
            taskId: task?.id || raw.callTaskId,
          },
          occurredAt: attempt.createdAt,
          title: `Попытка обзвона: ${task?.title || 'задача'}`,
          type: 'call_attempt',
        }),
      );
    });

    return items;
  });
}

async function listClientActiveCallTasks(clientId, account, clientContext = null) {
  if (!canViewCallTimeline(account)) return [];
  const taskWhere = await resolveClientCallTaskWhere(clientContext);

  const rows = await db.CallTaskClient.findAll({
    include: [
      {
        model: db.CallTask,
        as: 'callTask',
        attributes: [
          'id',
          'assignedToAccountId',
          'clientBaseId',
          'description',
          'dueAt',
          'status',
          'title',
          'updatedAt',
        ],
        include: [
          {
            model: db.ClientBase,
            as: 'clientBase',
            attributes: ['id', 'name'],
          },
          {
            model: db.Account,
            as: 'assignedToAccount',
            attributes: ['id', 'email', 'role', 'staffId'],
            include: accountMembershipInclude(clientContext?.organizationId),
          },
        ],
        required: true,
        where: {
          ...taskWhere,
          status: { [Op.in]: ['backlog', 'in_progress'] },
        },
      },
    ],
    limit: 8,
    order: [
      [
        db.Sequelize.literal(
          'CASE WHEN `CallTaskClient`.`deadlineAt` IS NULL THEN 1 ELSE 0 END',
        ),
        'ASC',
      ],
      ['deadlineAt', 'ASC'],
      ['updatedAt', 'DESC'],
    ],
    where: {
      userId: clientId,
      status: { [Op.in]: ['new', 'no_answer', 'callback', 'doubting'] },
    },
  });

  return rows.map((row) => {
    const raw = row.toJSON();
    const task = raw.callTask;

    return {
      assignedTo: mapTenantAccount(task?.assignedToAccount),
      clientBase: task?.clientBase
        ? {
            id: task.clientBase.id,
            name: task.clientBase.name,
          }
        : null,
      contactedAt: raw.contactedAt || null,
      deadlineAt: raw.deadlineAt || task?.dueAt || null,
      description: task?.description || '',
      id: task?.id || raw.callTaskId,
      status: raw.status,
      summary: raw.summary || '',
      taskClientId: raw.id,
      taskStatus: task?.status || null,
      title: task?.title || 'Задача обзвона',
      updatedAt: raw.updatedAt || task?.updatedAt || null,
    };
  });
}

async function listClientAuditTimeline(clientId, account) {
  if (!canViewClientAuditTimeline(account)) return [];

  const logs = await db.AuditLog.findAll({
    include: [
      {
        model: db.Account,
        as: 'account',
        attributes: ['id', 'email', 'role', 'staffId'],
        include: [{ model: db.Staff, attributes: ['id', 'name'] }],
      },
    ],
    limit: 25,
    order: [['createdAt', 'DESC']],
    where: {
      entityId: String(clientId),
      entityType: 'client',
    },
  });

  return logs.map((log) => {
    const raw = log.toJSON();
    return createTimelineItem({
      actor: mapAccount(raw.account),
      description: summarizeClientAudit(raw),
      id: `audit-${raw.id}`,
      meta: {
        action: raw.action,
        method: raw.method,
        path: raw.path,
        statusCode: raw.statusCode,
      },
      occurredAt: raw.createdAt,
      title: 'Изменение клиента',
      type: 'client_change',
    });
  });
}

function formatSubscriptionTimelineValue(subscription) {
  if (subscription.isUnlimited) return 'Безлимит';
  return `${subscription.remainingSessions ?? 0} из ${subscription.sessionsTotal ?? 0} занятий`;
}

function formatCertificateTimelineValue(certificate) {
  if (certificate.certificateType === 'money') {
    return `${toNumber(certificate.amountRemaining).toLocaleString('ru-RU')} из ${toNumber(certificate.amountTotal).toLocaleString('ru-RU')} ₽`;
  }
  return `${certificate.unitsRemaining ?? 0} из ${certificate.unitsTotal ?? 0} услуг`;
}

function listClientPrepaymentTimeline({ certificates = [], subscriptions = [] } = {}) {
  const subscriptionItems = subscriptions.flatMap((subscription) => {
    const items = [
      createTimelineItem({
        actor: subscription.createdBy || null,
        description: [
          formatSubscriptionTimelineValue(subscription),
          subscription.saleAmount
            ? `Продажа: ${toNumber(subscription.saleAmount).toLocaleString('ru-RU')} ₽`
            : '',
        ].filter(Boolean).join('\n'),
        id: `subscription-sale-${subscription.id}`,
        meta: {
          prepaymentKind: 'subscription',
          status: subscription.status,
          subscriptionId: subscription.id,
        },
        occurredAt: subscription.startsAt || subscription.createdAt,
        title: `Продажа абонемента: ${subscription.typeName}`,
        type: 'prepayment_sale',
      }),
      createTimelineItem({
        actor: subscription.createdBy || null,
        description: formatSubscriptionTimelineValue(subscription),
        id: `subscription-link-${subscription.id}`,
        meta: {
          prepaymentKind: 'subscription',
          status: subscription.status,
          subscriptionId: subscription.id,
        },
        occurredAt: subscription.createdAt,
        title: `Абонемент привязан: ${subscription.typeName}`,
        type: 'prepayment_link',
      }),
    ];

    (subscription.redemptions || []).forEach((redemption) => {
      items.push(
        createTimelineItem({
          actor: redemption.redeemedBy || null,
          description: [
            `${redemption.quantity || 1} занятий`,
            redemption.comment,
          ].filter(Boolean).join('\n'),
          id: `subscription-redemption-${redemption.id}`,
          meta: {
            prepaymentKind: 'subscription',
            status: redemption.status,
            subscriptionId: subscription.id,
          },
          occurredAt: redemption.redeemedAt,
          title: `Списание абонемента: ${subscription.typeName}`,
          type: 'prepayment_redemption',
        }),
      );
      if (redemption.status === 'reversed' && redemption.reversedAt) {
        items.push(
          createTimelineItem({
            actor: redemption.reversedBy || null,
            description: redemption.reversalReason || '',
            id: `subscription-redemption-reversal-${redemption.id}`,
            meta: {
              prepaymentKind: 'subscription',
              status: 'reversed',
              subscriptionId: subscription.id,
            },
            occurredAt: redemption.reversedAt,
            title: `Отмена списания абонемента: ${subscription.typeName}`,
            type: 'prepayment_reversal',
          }),
        );
      }
    });

    return items;
  });

  const certificateItems = certificates.flatMap((certificate) => {
    const items = [
      createTimelineItem({
        actor: certificate.createdBy || null,
        description: [
          formatCertificateTimelineValue(certificate),
          certificate.saleAmount
            ? `Продажа: ${toNumber(certificate.saleAmount).toLocaleString('ru-RU')} ₽`
            : '',
        ].filter(Boolean).join('\n'),
        id: `certificate-sale-${certificate.id}`,
        meta: {
          certificateId: certificate.id,
          prepaymentKind: 'certificate',
          status: certificate.status,
        },
        occurredAt: certificate.startsAt || certificate.createdAt,
        title: `Продажа сертификата: ${certificate.code}`,
        type: 'prepayment_sale',
      }),
      createTimelineItem({
        actor: certificate.createdBy || null,
        description: [certificate.title, formatCertificateTimelineValue(certificate)]
          .filter(Boolean)
          .join('\n'),
        id: `certificate-link-${certificate.id}`,
        meta: {
          certificateId: certificate.id,
          prepaymentKind: 'certificate',
          status: certificate.status,
        },
        occurredAt: certificate.createdAt,
        title: `Сертификат привязан: ${certificate.code}`,
        type: 'prepayment_link',
      }),
    ];

    (certificate.redemptions || []).forEach((redemption) => {
      items.push(
        createTimelineItem({
          actor: redemption.redeemedBy || null,
          description: [
            certificate.certificateType === 'money'
              ? `${toNumber(redemption.amount).toLocaleString('ru-RU')} ₽`
              : `${redemption.quantity || 1} услуг`,
            redemption.comment,
          ].filter(Boolean).join('\n'),
          id: `certificate-redemption-${redemption.id}`,
          meta: {
            certificateId: certificate.id,
            prepaymentKind: 'certificate',
            status: redemption.status,
          },
          occurredAt: redemption.redeemedAt,
          title: `Списание сертификата: ${certificate.code}`,
          type: 'prepayment_redemption',
        }),
      );
      if (redemption.status === 'reversed' && redemption.reversedAt) {
        items.push(
          createTimelineItem({
            actor: redemption.reversedBy || null,
            description: redemption.reversalReason || '',
            id: `certificate-redemption-reversal-${redemption.id}`,
            meta: {
              certificateId: certificate.id,
              prepaymentKind: 'certificate',
              status: 'reversed',
            },
            occurredAt: redemption.reversedAt,
            title: `Отмена списания сертификата: ${certificate.code}`,
            type: 'prepayment_reversal',
          }),
        );
      }
    });

    return items;
  });

  return [...subscriptionItems, ...certificateItems];
}

async function listClientTimeline(
  clientId,
  {
    account,
    bookingSeries,
    bookings,
    clientCertificates,
    clientSubscriptions,
    visits,
    trainingNotes,
    telephonyCalls,
    clientContext,
  } = {},
) {
  const [callItems, auditItems] = await Promise.all([
    listClientCallTimeline(clientId, account, clientContext),
    listClientAuditTimeline(clientId, account),
  ]);
  const visitItems = (visits || []).map((visit) =>
    createTimelineItem({
      description: formatVisitCategorySummary(visit),
      id: `visit-${visit.id}`,
      meta: {
        keyNumber: visit.keyNumber || null,
        visitId: visit.id,
      },
      occurredAt: visit.scannedAt || visit.createdAt,
      title: 'Визит',
      type: 'visit',
    }),
  );
  const trainingItems = (trainingNotes || []).map((note) =>
    createTimelineItem({
      actor: note.trainer || null,
      description: [note.exercises, note.note].filter(Boolean).join('\n'),
      id: `training-${note.id}`,
      meta: {
        level: note.level,
      },
      occurredAt: note.trainedAt || note.createdAt,
      title: 'Тренировка',
      type: 'training',
    }),
  );
  const bookingItems = (bookings || []).map((booking) =>
    createTimelineItem({
      description: [
        booking.court?.name,
        `${BOOKING_STATUS_LABELS[booking.status] || booking.status}`,
        `${PAYMENT_STATUS_LABELS[booking.paymentStatus] || booking.paymentStatus} · ${toNumber(booking.paidAmount).toLocaleString('ru-RU')} из ${toNumber(booking.price).toLocaleString('ru-RU')} ₽`,
        booking.comment,
        booking.cancellationReason ? `Причина отмены: ${booking.cancellationReason}` : '',
      ].filter(Boolean).join('\n'),
      id: `booking-${booking.id}`,
      meta: {
        bookingId: booking.id,
        bookingSeriesId: booking.bookingSeriesId || null,
        courtName: booking.court?.name || '',
        durationMinutes: booking.durationMinutes,
        paymentStatus: booking.paymentStatus,
        status: booking.status,
      },
      occurredAt: booking.startsAt,
      title: booking.bookingSeriesId ? 'Постоянная бронь' : 'Бронь корта',
      type: 'booking',
    }),
  );
  const seriesItems = (bookingSeries || []).map((series) =>
    createTimelineItem({
      description: [
        series.court?.name,
        `${SERIES_WEEKDAY_LABELS[series.weekday] || series.weekday} ${series.startTime}`,
        `${series.durationMinutes} мин · ${series.status === 'active' ? 'активна' : 'архив'}`,
        series.comment,
        series.archiveReason ? `Причина архива: ${series.archiveReason}` : '',
      ].filter(Boolean).join('\n'),
      id: `booking-series-${series.id}`,
      meta: {
        bookingSeriesId: series.id,
        courtName: series.court?.name || '',
        status: series.status,
      },
      occurredAt: series.createdAt,
      title: `Серия броней: ${series.name}`,
      type: 'booking_series',
    }),
  );
  const telephonyItems = (telephonyCalls || []).map((call) => {
    const directionLabel =
      TELEPHONY_DIRECTION_LABELS[call.direction] || TELEPHONY_DIRECTION_LABELS.unknown;
    const statusLabel =
      TELEPHONY_CALL_STATUS_LABELS[call.callStatus] || call.callStatus;
    const processingLabel =
      TELEPHONY_PROCESSING_STATUS_LABELS[call.processingStatus] ||
      call.processingStatus;
    const resultLabel = call.result
      ? TELEPHONY_RESULT_LABELS[call.result] || call.result
      : '';

    return createTimelineItem({
      actor: call.processedByAccount || null,
      description: [
        call.summary,
        call.nextActionText ? `Следующий шаг: ${call.nextActionText}` : '',
        call.followUpCallTask ? `Задача: ${call.followUpCallTask.title}` : '',
      ].filter(Boolean).join('\n'),
      id: `telephony-call-${call.id}`,
      meta: {
        callStatus: call.callStatus,
        direction: call.direction,
        durationSeconds: call.durationSeconds,
        processingStatus: call.processingStatus,
        recordingStatus: call.recordingStatus,
        result: call.result || '',
        status: call.callStatus,
      },
      occurredAt: call.startedAt || call.processedAt || call.createdAt,
      title: [directionLabel, statusLabel, processingLabel, resultLabel]
        .filter(Boolean)
        .join(' · '),
      type: 'telephony_call',
    });
  });

  return [
    ...visitItems,
    ...bookingItems,
    ...seriesItems,
    ...trainingItems,
    ...telephonyItems,
    ...listClientPrepaymentTimeline({
      certificates: clientCertificates,
      subscriptions: clientSubscriptions,
    }),
    ...callItems,
    ...auditItems,
  ]
    .filter((item) => item.occurredAt)
    .sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime())
    .slice(0, 120);
}

function formatVisitCategorySummary(visit) {
  const names = visit.categories?.map((category) => category.name).filter(Boolean);
  if (names && names.length > 0) return names.join(', ');
  return visit.category || '';
}

async function mapClientWithCurrentStats(client, account = null, options = {}) {
  if (!client) return null;
  const stats = await getClientStats(client.id);
  const mappedClient = sanitizeClientForAccount(
    mapClient({ ...client.toJSON(), ...stats }),
    account,
  );
  if (!options.includePrepaymentSummary) return mappedClient;

  const { prepaymentSummary } = await getClientPrepaymentContext(
    client.id,
    account,
  );
  return {
    ...mappedClient,
    prepaymentSummary,
  };
}

async function lookupByPhone(
  phone,
  excludeClientId = null,
  account = null,
  options = {},
  tenant = null,
) {
  if (isTrainer(account)) {
    throw appError('Тренеру недоступен поиск клиентов по телефону', 403);
  }

  const phoneNormalized = getPhoneLookupDigits(phone);
  if (phoneNormalized.length !== 10) return null;
  const context = await resolveClientAccessContext(tenant);

  const where = clientWhere(context, {
    isTraining: false,
    phoneNormalized,
    mergedIntoUserId: null,
  });
  if (options.includeArchived) {
    where.status = { [Op.in]: ['active', 'archived'] };
  } else {
    where.status = 'active';
  }
  if (excludeClientId) {
    where.id = { [Op.ne]: Number(excludeClientId) };
  }

  const client = await db.User.findOne({
    attributes: CLIENT_ATTRIBUTES,
    where,
    order: [
      [db.Sequelize.literal("CASE WHEN status = 'active' THEN 0 ELSE 1 END"), 'ASC'],
      ['createdAt', 'DESC'],
    ],
  });

  if (!client) return null;
  return mapClientWithCurrentStats(client, account, {
    includePrepaymentSummary: true,
  });
}

async function findExistingByIdentity(
  field,
  value,
  excludeClientId = null,
  context,
  transaction = undefined,
) {
  const normalizedValue = normalizeOptionalIdentity(value);
  if (!normalizedValue) return null;

  const where = clientWhere(context, {
    [field]: normalizedValue,
    isTraining: false,
    mergedIntoUserId: null,
  });
  if (excludeClientId) {
    where.id = { [Op.ne]: Number(excludeClientId) };
  }

  const client = await db.User.findOne({
    attributes: CLIENT_ATTRIBUTES,
    transaction,
    where,
    order: [
      [db.Sequelize.literal("CASE WHEN status = 'active' THEN 0 ELSE 1 END"), 'ASC'],
      ['createdAt', 'DESC'],
    ],
  });

  return client
    ? resolveCanonicalClient(client, context, { transaction })
    : null;
}

async function findExistingByPhone(
  phoneNormalized,
  excludeClientId = null,
  context,
  transaction = undefined,
) {
  const where = clientWhere(context, {
    isTraining: false,
    phoneNormalized,
    mergedIntoUserId: null,
  });
  if (excludeClientId) {
    where.id = { [Op.ne]: Number(excludeClientId) };
  }

  return db.User.findOne({
    attributes: CLIENT_ATTRIBUTES,
    transaction,
    where,
    order: [
      [db.Sequelize.literal("CASE WHEN status = 'active' THEN 0 ELSE 1 END"), 'ASC'],
      ['createdAt', 'DESC'],
    ],
  });
}

async function assertIdentityAvailable(
  data,
  excludeClientId = null,
  context,
  transaction = undefined,
) {
  for (const field of CLIENT_IDENTITY_FIELDS) {
    if (!(field in data)) continue;
    const value = normalizeOptionalIdentity(data[field]);
    if (!value) continue;

    const existing = await findExistingByIdentity(
      field,
      value,
      excludeClientId,
      context,
      transaction,
    );
    if (!existing) continue;

    const isArchived = existing.status === 'archived';
    const label =
      field === 'telegramId' ? 'Telegram' : field === 'vkId' ? 'VK' : 'WEB ID';

    throw appError(
      isArchived
        ? `Клиент с таким ${label} уже есть в архиве. Восстановите его вместо повторной регистрации`
        : `Клиент с таким ${label} уже существует`,
      409,
      {
        code: isArchived
          ? 'CLIENT_ARCHIVED_CONFLICT'
          : 'CLIENT_ACTIVE_CONFLICT',
        client: await mapClientWithCurrentStats(existing),
      },
    );
  }
}

async function generateWebId(context, transaction = undefined) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const webId = `web_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    const existing = await findExistingByIdentity(
      'webId',
      webId,
      null,
      context,
      transaction,
    );
    if (!existing) return webId;
  }

  throw appError('Не удалось сгенерировать уникальный WEB ID клиента');
}

async function resolveClientSourceForMutation(
  data,
  context,
  transaction,
  { allowArchived = false } = {},
) {
  const where = { organizationId: context.organizationId };
  if (data.sourceId) {
    where.id = Number(data.sourceId);
  } else {
    where.name = String(data.source || 'Ресепшн (Админ)')
      .trim()
      .replace(/\s+/g, ' ');
  }
  if (!allowArchived) where.status = 'active';

  const source = await db.ClientSource.findOne({
    lock: transaction.LOCK.UPDATE,
    transaction,
    where,
  });
  if (!source) throw appError('Источник клиента не найден в справочнике', 404);
  return source;
}

async function createClient(data, actor = null, tenant = null) {
  const context = await resolveClientAccessContext(tenant);
  const name = normalizeClientName(data.name);
  const { phone, phoneNormalized } = normalizePhonePayload(data.phone);
  const trainingMarker = await onboardingService.getTrainingDataMarker(actor);
  const client = await withClientIdentityLocks(
    scopeClientIdentityLockKeys(
      getClientIdentityLockKeys(data, phoneNormalized),
      context,
    ),
    () => db.sequelize.transaction(async (transaction) => {
      const writeContext = await resolveClientAccessContext(tenant, {
        lock: true,
        transaction,
      });
      const sourceRef = await resolveClientSourceForMutation(
        data,
        writeContext,
        transaction,
      );
      const existing = await findExistingByPhone(
        phoneNormalized,
        null,
        writeContext,
        transaction,
      );
      await assertIdentityAvailable(
        data,
        null,
        writeContext,
        transaction,
      );

      if (existing) {
        const isArchived = existing.status === 'archived';
        throw appError(
          isArchived
            ? 'Клиент с таким телефоном уже есть в архиве. Восстановите его вместо повторной регистрации'
            : 'Клиент с таким телефоном уже существует',
          409,
          {
            code: isArchived
              ? 'CLIENT_ARCHIVED_CONFLICT'
              : 'CLIENT_ACTIVE_CONFLICT',
            client: await mapClientWithCurrentStats(existing),
          },
        );
      }

      const identityPayload = {};
      CLIENT_IDENTITY_FIELDS.forEach((field) => {
        if (field in data) identityPayload[field] = normalizeOptionalIdentity(data[field]);
      });
      if (!identityPayload.webId) {
        identityPayload.webId = await generateWebId(writeContext, transaction);
      }

      return db.User.create(
        {
          ...identityPayload,
          organizationId: writeContext.organizationId,
          name,
          phone,
          phoneNormalized,
          source: sourceRef.name,
          sourceId: sourceRef.id,
          note: normalizeNote(data.note),
          status: 'active',
          ...trainingMarker,
        },
        { transaction },
      );
    }),
  );

  await clientSkillMapService.syncActiveSkillsForClient(client, { tenant });
  const result = await getClientDetails(client.id, actor, tenant);
  await onboardingService.recordEventSafe(actor, 'client.created', {
    entityId: result.client?.id || client.id,
    entityType: 'client',
    payload: result.client || result,
  });
  return result;
}

async function registerClientFromMessenger({
  externalId,
  messenger,
  name,
  phone: rawPhone,
  source,
  tenant = null,
}) {
  const context = await resolveClientAccessContext(tenant);
  const messengerField = messenger === 'telegram' ? 'telegramId' : 'vkId';
  if (!externalId) throw appError('Не указан идентификатор мессенджера');

  const fullName = normalizeClientName(name);
  const { phone, phoneNormalized } = normalizePhonePayload(rawPhone);
  const externalIdValue = String(externalId);

  const result = await withClientIdentityLocks(
    scopeClientIdentityLockKeys(
      getClientIdentityLockKeys(
        { [messengerField]: externalIdValue },
        phoneNormalized,
      ),
      context,
    ),
    () => db.sequelize.transaction(async (transaction) => {
      const writeContext = await resolveClientAccessContext(tenant, {
        lock: true,
        transaction,
      });
      const sourceRef = await resolveClientSourceForMutation(
        { source },
        writeContext,
        transaction,
      );
      const [byPhone, byMessengerRaw] = await Promise.all([
        findExistingByPhone(
          phoneNormalized,
          null,
          writeContext,
          transaction,
        ),
        db.User.findOne({
          attributes: CLIENT_ATTRIBUTES,
          transaction,
          where: clientWhere(writeContext, {
            [messengerField]: externalIdValue,
          }),
          order: [['createdAt', 'DESC']],
        }),
      ]);
      const byMessenger = byMessengerRaw
        ? await resolveCanonicalClient(byMessengerRaw, writeContext, {
          transaction,
        })
        : null;

      if (byMessenger?.status === 'archived') {
        throw appError(
          'Клиент с этим аккаунтом уже есть в архиве. Восстановите его в CRM.',
          409,
          {
            code: 'CLIENT_ARCHIVED_CONFLICT',
            client: await mapClientWithCurrentStats(byMessenger),
          },
        );
      }

      if (byPhone?.status === 'archived') {
        throw appError(
          'Клиент с таким телефоном уже есть в архиве. Восстановите его в CRM.',
          409,
          {
            code: 'CLIENT_ARCHIVED_CONFLICT',
            client: await mapClientWithCurrentStats(byPhone),
          },
        );
      }

      if (byPhone && byMessenger && byPhone.id !== byMessenger.id) {
        throw appError(
          'Телефон уже привязан к другому клиенту. Проверьте карточки в CRM.',
          409,
          {
            code: 'CLIENT_ACTIVE_CONFLICT',
            client: await mapClientWithCurrentStats(byPhone),
          },
        );
      }

      const existing = byPhone || byMessenger;
      if (existing) {
        const currentMessengerId = existing[messengerField];
        if (currentMessengerId && String(currentMessengerId) !== externalIdValue) {
          throw appError(
            'Этот клиент уже привязан к другому аккаунту мессенджера',
            409,
            {
              code: 'CLIENT_ACTIVE_CONFLICT',
              client: await mapClientWithCurrentStats(existing),
            },
          );
        }

        await existing.update(
          {
            [messengerField]: externalIdValue,
            name: fullName,
            phone,
            phoneNormalized,
            source: sourceRef.name,
            sourceId: sourceRef.id,
            status: 'active',
          },
          { transaction },
        );

        return { client: existing, created: false };
      }

      const client = await db.User.create(
        {
          [messengerField]: externalIdValue,
          organizationId: writeContext.organizationId,
          name: fullName,
          phone,
          phoneNormalized,
          source: sourceRef.name,
          sourceId: sourceRef.id,
          status: 'active',
        },
        { transaction },
      );

      return { client, created: true };
    }),
  );

  if (result.created) {
    await clientSkillMapService.syncActiveSkillsForClient(result.client, { tenant });
  }
  return getClientDetails(result.client.id, null, tenant);
}

async function updateClient(id, data, actor = null, tenant = null) {
  const context = await resolveClientAccessContext(tenant);
  const normalizedPhonePayload = 'phone' in data ? normalizePhonePayload(data.phone) : null;

  const clientId = await withClientIdentityLocks(
    scopeClientIdentityLockKeys(
      getClientIdentityLockKeys(data, normalizedPhonePayload?.phoneNormalized),
      context,
    ),
    () => db.sequelize.transaction(async (transaction) => {
      const writeContext = await resolveClientAccessContext(tenant, {
        lock: true,
        transaction,
      });
      return updateClientAfterIdentityLock(
        id,
        data,
        normalizedPhonePayload,
        writeContext,
        transaction,
      );
    }),
  );
  return getClientDetails(clientId, actor, tenant);
}

async function updateClientAfterIdentityLock(
  id,
  data,
  normalizedPhonePayload = null,
  context,
  transaction,
) {
  const client = await getClientOrFail(id, context, {
    lock: transaction.LOCK.UPDATE,
    transaction,
  });
  const payload = {};

  if ('name' in data) payload.name = normalizeClientName(data.name);
  if ('source' in data || 'sourceId' in data) {
    const allowArchived = isSameClientSource(client, data);
    const sourceRef = await resolveClientSourceForMutation(
      data,
      context,
      transaction,
      { allowArchived },
    );
    payload.source = sourceRef.name;
    payload.sourceId = sourceRef.id;
  }
  if ('note' in data) payload.note = normalizeNote(data.note);
  if ('status' in data) payload.status = normalizeStatus(data.status);

  await assertIdentityAvailable(
    data,
    client.id,
    context,
    transaction,
  );
  CLIENT_IDENTITY_FIELDS.forEach((field) => {
    if (field in data) payload[field] = normalizeOptionalIdentity(data[field]);
  });

  if ('phone' in data) {
    const { phone, phoneNormalized } =
      normalizedPhonePayload || normalizePhonePayload(data.phone);
    const existing = await findExistingByPhone(
      phoneNormalized,
      client.id,
      context,
      transaction,
    );
    if (existing) {
      const isArchived = existing.status === 'archived';
      throw appError(
        isArchived
          ? 'Клиент с таким телефоном уже есть в архиве. Восстановите его вместо повторной регистрации'
          : 'Клиент с таким телефоном уже существует',
        409,
        {
          code: isArchived
            ? 'CLIENT_ARCHIVED_CONFLICT'
            : 'CLIENT_ACTIVE_CONFLICT',
          client: await mapClientWithCurrentStats(existing),
        },
      );
    }
    payload.phone = phone;
    payload.phoneNormalized = phoneNormalized;
  }

  if (
    payload.status === 'active' &&
    client.status === 'archived' &&
    !payload.phoneNormalized &&
    client.phoneNormalized
  ) {
    const existing = await findExistingByPhone(
      client.phoneNormalized,
      client.id,
      context,
      transaction,
    );
    if (existing) {
      const isArchived = existing.status === 'archived';
      throw appError(
        isArchived
          ? 'Клиент с таким телефоном уже есть в архиве. Восстановите его вместо повторной регистрации'
          : 'Клиент с таким телефоном уже существует',
        409,
        {
          code: isArchived
            ? 'CLIENT_ARCHIVED_CONFLICT'
            : 'CLIENT_ACTIVE_CONFLICT',
          client: await mapClientWithCurrentStats(existing),
        },
      );
    }
  }

  await client.update(payload, { transaction });
  return client.id;
}

async function resolveCanonicalClient(client, context, options = {}) {
  if (!client) return null;
  if (!client.mergedIntoUserId) return client;

  return db.User.findOne({
    transaction: options.transaction,
    where: clientWhere(context, { id: client.mergedIntoUserId }),
  });
}

async function findActiveByPhone(phone, tenant = null) {
  const phoneNormalized = getPhoneLookupDigits(phone);
  if (phoneNormalized.length !== 10) return null;
  const context = await resolveClientAccessContext(tenant);

  return db.User.findOne({
    where: clientWhere(context, {
      phoneNormalized,
      status: 'active',
      isTraining: false,
      mergedIntoUserId: null,
    }),
    order: [['createdAt', 'DESC']],
  });
}

async function findCanonicalById(id, tenant = null, options = {}) {
  const context = await resolveClientAccessContext(tenant, {
    lock: Boolean(options.lock),
    transaction: options.transaction,
  });
  let client = await db.User.findOne({
    lock: options.lock,
    transaction: options.transaction,
    where: clientWhere(context, { id: Number(id) }),
  });
  if (!client) return null;
  if (client.mergedIntoUserId) {
    client = await resolveCanonicalClient(client, context);
  }
  return client;
}

async function findCanonicalByQr(qr, tenant = null) {
  const context = await resolveClientAccessContext(tenant);
  let client = null;

  if (qr.startsWith('vk_')) {
    client = await db.User.findOne({
      where: clientWhere(context, {
        vkId: qr.replace('vk_', ''),
        isTraining: false,
      }),
    });
  } else if (qr.startsWith('web_')) {
    client = await db.User.findOne({
      where: clientWhere(context, { webId: qr, isTraining: false }),
    });
  } else {
    client = await db.User.findOne({
      where: clientWhere(context, {
        isTraining: false,
        [Op.or]: [{ telegramId: qr }, { telegramId: `@${qr}` }],
      }),
    });
  }

  return resolveCanonicalClient(client, context);
}

function chooseCallTaskClientStatus(currentStatus, duplicateStatus) {
  const currentWeight = CALL_CLIENT_STATUS_WEIGHT[currentStatus] ?? 0;
  const duplicateWeight = CALL_CLIENT_STATUS_WEIGHT[duplicateStatus] ?? 0;
  return duplicateWeight > currentWeight ? duplicateStatus : currentStatus;
}

function mergeTextNotes(primaryText, duplicateText, duplicateName) {
  const current = String(primaryText || '').trim();
  const next = String(duplicateText || '').trim();
  if (!next) return current || null;
  const prefixed = `Из объединенного клиента ${duplicateName}: ${next}`;
  if (!current) return prefixed;
  if (current.includes(prefixed)) return current;
  return `${current}\n\n${prefixed}`;
}

async function getClientStatsSnapshot(clientId, transaction) {
  const stats = await db.Visit.findOne({
    attributes: [
      [db.Sequelize.fn('COUNT', db.Sequelize.col('id')), 'visitCount'],
      [db.Sequelize.fn('MAX', db.Sequelize.col('scannedAt')), 'lastVisitAt'],
    ],
    raw: true,
    transaction,
    where: { userId: clientId, isTraining: false },
  });

  return {
    lastVisitAt: stats?.lastVisitAt || null,
    visitCount: Number(stats?.visitCount || 0),
  };
}

async function refreshCallTaskClientCounters(taskIds, transaction) {
  const uniqueTaskIds = Array.from(new Set(taskIds.map(Number))).filter(Boolean);
  for (const taskId of uniqueTaskIds) {
    const count = await db.CallTaskClient.count({
      transaction,
      where: { callTaskId: taskId },
    });
    await db.CallTask.update(
      { snapshotClientCount: count },
      { transaction, where: { id: taskId } },
    );
  }
}

async function mergeCallTaskClientsForDuplicate(primary, duplicate, transaction) {
  const duplicateRows = await db.CallTaskClient.findAll({
    transaction,
    where: { userId: duplicate.id },
  });
  if (duplicateRows.length === 0) return;

  const stats = await getClientStatsSnapshot(primary.id, transaction);
  const affectedTaskIds = [];

  for (const duplicateRow of duplicateRows) {
    affectedTaskIds.push(duplicateRow.callTaskId);

    const primaryRow = await db.CallTaskClient.findOne({
      transaction,
      where: {
        callTaskId: duplicateRow.callTaskId,
        userId: primary.id,
      },
    });

    if (!primaryRow) {
      await duplicateRow.update(
        {
          clientName: primary.name,
          clientPhone: primary.phone,
          lastVisitAt: stats.lastVisitAt,
          source: primary.source,
          userId: primary.id,
          visitCount: stats.visitCount,
        },
        { transaction },
      );
      continue;
    }

    await db.CallTaskAttempt.update(
      { callTaskClientId: primaryRow.id },
      {
        transaction,
        where: { callTaskClientId: duplicateRow.id },
      },
    );

    await primaryRow.update(
      {
        clientName: primary.name,
        clientPhone: primary.phone,
        contactedAt: getLatestDate(
          primaryRow.contactedAt,
          duplicateRow.contactedAt,
        ),
        deadlineAt: primaryRow.deadlineAt || duplicateRow.deadlineAt || null,
        lastVisitAt: stats.lastVisitAt,
        source: primary.source,
        status: chooseCallTaskClientStatus(
          primaryRow.status,
          duplicateRow.status,
        ),
        summary: mergeTextNotes(
          primaryRow.summary,
          duplicateRow.summary,
          duplicate.name,
        ),
        visitCount: stats.visitCount,
      },
      { transaction },
    );

    await duplicateRow.destroy({ transaction });
  }

  await refreshCallTaskClientCounters(affectedTaskIds, transaction);
}

function getComparableDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function shouldUseDuplicateSkillMapText(primaryRow, duplicateRow) {
  const primaryDate = getComparableDate(primaryRow.lastTrainedAt);
  const duplicateDate = getComparableDate(duplicateRow.lastTrainedAt);

  if (!primaryDate && duplicateDate) return true;
  if (primaryDate && duplicateDate && duplicateDate > primaryDate) return true;
  return false;
}

async function mergeSkillMapForDuplicate(
  primary,
  duplicate,
  actor,
  transaction,
  tenant,
) {
  if (!db.ClientTrainingSkill) return;

  await clientSkillMapService.syncActiveSkillsForClient(primary, {
    tenant,
    transaction,
  });
  const duplicateRows = await db.ClientTrainingSkill.findAll({
    transaction,
    where: { userId: duplicate.id },
  });
  if (duplicateRows.length === 0) return;

  for (const duplicateRow of duplicateRows) {
    const primaryRow = await db.ClientTrainingSkill.findOne({
      transaction,
      where: {
        trainingSkillId: duplicateRow.trainingSkillId,
        userId: primary.id,
      },
    });

    if (!primaryRow) {
      await duplicateRow.update(
        {
          userId: primary.id,
          updatedByAccountId: actor?.id || duplicateRow.updatedByAccountId || null,
        },
        { transaction },
      );
      if (db.ClientTrainingSkillHistory) {
        await db.ClientTrainingSkillHistory.update(
          { userId: primary.id },
          {
            transaction,
            where: { clientTrainingSkillId: duplicateRow.id },
          },
        );
      }
      continue;
    }

    const useDuplicateText = shouldUseDuplicateSkillMapText(
      primaryRow,
      duplicateRow,
    );
    await primaryRow.update(
      {
        lastTrainedAt: getLatestDate(
          primaryRow.lastTrainedAt,
          duplicateRow.lastTrainedAt,
        ) || null,
        latestAssessment: useDuplicateText
          ? duplicateRow.latestAssessment || primaryRow.latestAssessment || null
          : primaryRow.latestAssessment || duplicateRow.latestAssessment || null,
        latestExercises: useDuplicateText
          ? duplicateRow.latestExercises || primaryRow.latestExercises || null
          : primaryRow.latestExercises || duplicateRow.latestExercises || null,
        level: Math.max(Number(primaryRow.level || 0), Number(duplicateRow.level || 0)),
        nextEStep: useDuplicateText
          ? duplicateRow.nextEStep || primaryRow.nextEStep || null
          : primaryRow.nextEStep || duplicateRow.nextEStep || null,
        repeatFlag: Boolean(primaryRow.repeatFlag || duplicateRow.repeatFlag),
        updatedByAccountId: actor?.id || primaryRow.updatedByAccountId || null,
      },
      { transaction },
    );

    if (db.ClientTrainingSkillHistory) {
      await db.ClientTrainingSkillHistory.update(
        {
          clientTrainingSkillId: primaryRow.id,
          userId: primary.id,
        },
        {
          transaction,
          where: { clientTrainingSkillId: duplicateRow.id },
        },
      );
    }

    await duplicateRow.destroy({ transaction });
  }
}

async function mergeClients(
  primaryClientId,
  duplicateClientIds,
  actor,
  tenant = null,
) {
  const primaryId = Number(primaryClientId);
  const duplicateIds = Array.from(
    new Set((duplicateClientIds || []).map((id) => Number(id))),
  ).filter((id) => Number.isInteger(id) && id !== primaryId);

  if (!Number.isInteger(primaryId) || duplicateIds.length === 0) {
    throw appError('Выберите основного клиента и дубли для объединения');
  }

  await db.sequelize.transaction(async (transaction) => {
    const context = await resolveClientAccessContext(tenant, {
      lock: true,
      transaction,
    });
    const primary = await db.User.findOne({
      lock: transaction.LOCK.UPDATE,
      transaction,
      where: clientWhere(context, { id: primaryId }),
    });
    if (!primary || primary.status !== 'active' || primary.mergedIntoUserId) {
      throw appError('Основной клиент не найден', 404);
    }

    const duplicates = await db.User.findAll({
      lock: transaction.LOCK.UPDATE,
      where: clientWhere(context, {
        id: {
          [Op.in]: duplicateIds,
        },
        status: 'active',
        mergedIntoUserId: null,
      }),
      transaction,
    });

    if (duplicates.length !== duplicateIds.length) {
      throw appError('Один или несколько дублей не найдены', 404);
    }

    for (const duplicate of duplicates) {
      await db.Visit.update(
        { userId: primary.id },
        {
          where: { userId: duplicate.id },
          transaction,
        },
      );
      await db.TrainingNote.update(
        { userId: primary.id },
        {
          where: { userId: duplicate.id },
          transaction,
        },
      );
      if (db.Booking) {
        await db.Booking.update(
          {
            clientName: primary.name,
            clientPhone: primary.phone,
            userId: primary.id,
          },
          {
            where: {
              userId: duplicate.id,
              ...(isTenantBookingsCourtsEnabled()
                ? { organizationId: context.organizationId }
                : {}),
            },
            transaction,
          },
        );
      }
      if (db.BookingSeries) {
        await db.BookingSeries.update(
          {
            clientName: primary.name,
            clientPhone: primary.phone,
            userId: primary.id,
          },
          {
            where: {
              userId: duplicate.id,
              ...(isTenantBookingsCourtsEnabled()
                ? { organizationId: context.organizationId }
                : {}),
            },
            transaction,
          },
        );
      }
      if (db.BookingParticipant && isTenantBookingsCourtsEnabled()) {
        const bookingRows = await db.Booking.findAll({
          attributes: ['id'],
          raw: true,
          transaction,
          where: { organizationId: context.organizationId },
        });
        const bookingIds = bookingRows.map((row) => Number(row.id)).filter(Boolean);
        if (bookingIds.length > 0) {
          await db.BookingParticipant.update(
            { userId: primary.id },
            {
              transaction,
              where: {
                bookingId: { [Op.in]: bookingIds },
                userId: duplicate.id,
              },
            },
          );
        }
      } else if (db.BookingParticipant) {
        await db.BookingParticipant.update(
          { userId: primary.id },
          { transaction, where: { userId: duplicate.id } },
        );
      }
      if (db.TelephonyCall) {
        await db.TelephonyCall.update(
          { userId: primary.id },
          {
            where: { userId: duplicate.id },
            transaction,
          },
        );
      }
      const directClientRelations = [
        ['Certificate', 'clientId'],
        ['CertificateRedemption', 'clientId'],
        ['ClientSubscription', 'clientId'],
        ['ClientSubscriptionRedemption', 'clientId'],
        ['PendingSale', 'clientId'],
        ['ScannerEvent', 'userId'],
        ['TrainingPlanParticipant', 'userId'],
      ];
      for (const [modelName, foreignKey] of directClientRelations) {
        if (!db[modelName]) continue;
        await db[modelName].update(
          { [foreignKey]: primary.id },
          { where: { [foreignKey]: duplicate.id }, transaction },
        );
      }
      await mergeSkillMapForDuplicate(
        primary,
        duplicate,
        actor,
        transaction,
        tenant,
      );
      await mergeCallTaskClientsForDuplicate(primary, duplicate, transaction);

      const primaryUpdates = {};
      if (!primary.note && duplicate.note) {
        primaryUpdates.note = duplicate.note;
      } else if (primary.note && duplicate.note) {
        primaryUpdates.note = `${primary.note}\n\nИз объединенного клиента ${duplicate.name}: ${duplicate.note}`;
      }

      if (Object.keys(primaryUpdates).length > 0) {
        await primary.update(primaryUpdates, { transaction });
        Object.assign(primary, primaryUpdates);
      }

      await duplicate.update(
        {
          status: 'archived',
          mergedIntoUserId: primary.id,
          mergedAt: new Date(),
          mergedByAccountId: actor?.id || null,
        },
        { transaction },
      );
    }
  });

  return getClientDetails(primaryId, actor, tenant);
}

async function getDuplicateGroups(tenant = null) {
  const context = await resolveClientAccessContext(tenant);
  const duplicateGroups = [];
  const tenantPredicate = context.scoped
    ? 'AND organizationId = :organizationId'
    : '';

  for (const group of DUPLICATE_GROUPS) {
    const rows = await db.sequelize.query(
      `
        SELECT ${group.field} AS value, COUNT(*) AS count
        FROM Users
        WHERE status = 'active'
          ${tenantPredicate}
          AND COALESCE(isTraining, 0) = 0
          AND mergedIntoUserId IS NULL
          AND ${group.field} IS NOT NULL
          AND ${group.field} <> ''
        GROUP BY ${group.field}
        HAVING COUNT(*) > 1
        ORDER BY count DESC, ${group.field} ASC
      `,
      {
        replacements: context.scoped
          ? { organizationId: context.organizationId }
          : {},
        type: db.Sequelize.QueryTypes.SELECT,
      },
    );

    for (const row of rows) {
      duplicateGroups.push({
        count: Number(row.count),
        field: group.field,
        key: `${group.type}:${row.value}`,
        label: group.label,
        type: group.type,
        value: row.value,
      });
    }
  }

  if (duplicateGroups.length === 0) return [];

  const clientsByGroupKey = new Map();
  const conditions = duplicateGroups.map((group) => ({
    [group.field]: group.value,
  }));
  const clients = await db.User.findAll({
    attributes: CLIENT_ATTRIBUTES,
    where: clientWhere(context, {
      [Op.or]: conditions,
      status: 'active',
      isTraining: false,
      mergedIntoUserId: null,
    }),
    order: [['createdAt', 'DESC']],
  });
  const statsByClientId = await getStatsByClientIds(
    clients.map((client) => client.id),
  );

  duplicateGroups.forEach((group) => {
    clientsByGroupKey.set(
      group.key,
      clients
        .filter((client) => String(client[group.field]) === String(group.value))
        .map((client) => mapClientWithStats(client, statsByClientId)),
    );
  });

  return duplicateGroups
    .map((group) => ({
      ...group,
      clients: clientsByGroupKey.get(group.key) || [],
    }))
    .filter((group) => group.clients.length > 1)
    .sort((a, b) => b.clients.length - a.clients.length || a.key.localeCompare(b.key));
}

async function removeArchivedClient(id, tenant = null) {
  await db.sequelize.transaction(async (transaction) => {
    const context = await resolveClientAccessContext(tenant, {
      lock: true,
      transaction,
    });
    const client = await getClientOrFail(id, context, {
      lock: transaction.LOCK.UPDATE,
      transaction,
    });
    if (client.status !== 'archived') {
      throw appError('Удалять безвозвратно можно только клиентов из архива', 409);
    }

    const [
      visitsCount,
      trainingNotesCount,
      callTaskClientsCount,
      telephonyCallsCount,
      bookingCount,
      bookingSeriesCount,
      clientSubscriptionsCount,
      certificatesCount,
      mergedClientsCount,
    ] = await Promise.all([
      db.Visit.count({ transaction, where: { userId: client.id } }),
      db.TrainingNote.count({ transaction, where: { userId: client.id } }),
      db.CallTaskClient.count({ transaction, where: { userId: client.id } }),
      db.TelephonyCall
        ? db.TelephonyCall.count({ transaction, where: { userId: client.id } })
        : 0,
      db.Booking
        ? db.Booking.count({
            transaction,
            where: {
              userId: client.id,
              ...(isTenantBookingsCourtsEnabled()
                ? { organizationId: context.organizationId }
                : {}),
            },
          })
        : 0,
      db.BookingSeries
        ? db.BookingSeries.count({
            transaction,
            where: {
              userId: client.id,
              ...(isTenantBookingsCourtsEnabled()
                ? { organizationId: context.organizationId }
                : {}),
            },
          })
        : 0,
      db.ClientSubscription
        ? db.ClientSubscription.count({
            transaction,
            where: { clientId: client.id },
          })
        : 0,
      db.Certificate
        ? db.Certificate.count({ transaction, where: { clientId: client.id } })
        : 0,
      db.User.count({
        transaction,
        where: clientWhere(context, { mergedIntoUserId: client.id }),
      }),
    ]);

    if (
      visitsCount > 0 ||
      trainingNotesCount > 0 ||
      callTaskClientsCount > 0 ||
      telephonyCallsCount > 0 ||
      bookingCount > 0 ||
      bookingSeriesCount > 0 ||
      clientSubscriptionsCount > 0 ||
      certificatesCount > 0 ||
      mergedClientsCount > 0
    ) {
      throw appError(
        'Клиента нельзя удалить безвозвратно: есть визиты, бронирования, постоянки, абонементы, сертификаты, дневник тренировок, задачи обзвона, звонки или связанные дубли. Оставьте его в архиве.',
        409,
      );
    }

    await client.destroy({ transaction });
  });
  return { success: true };
}

module.exports = {
  countClients,
  createClient,
  createSavedView,
  deleteSavedView,
  findActiveByPhone,
  findCanonicalById,
  findCanonicalByQr,
  getClientDetails,
  getDuplicateGroups,
  listClientVisits,
  listClients,
  listClientsForSnapshot,
  listSavedViews,
  lookupByPhone,
  mergeClients,
  removeArchivedClient,
  registerClientFromMessenger,
  updateClient,
  updateSavedView,
  __testing: {
    buildClientListSql,
    buildClientPrepaymentSummary,
    buildTrainerClientDetailsResponse,
    clientWhere,
    listClientPrepaymentTimeline,
    sanitizeClientForAccount,
  },
};
