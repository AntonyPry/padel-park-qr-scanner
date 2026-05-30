const crypto = require('crypto');
const { Op } = require('sequelize');
const db = require('../../models');
const {
  formatRussianPhone,
  getPhoneLookupDigits,
} = require('../utils/phone');
const referencesService = require('./references.service');

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
  'q',
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
    ...raw,
    statusLabel: getClientStatus(raw),
    segment: getClientSegment(stats),
    stats,
    training,
  };
}

function isTrainer(account) {
  return account?.role === 'trainer';
}

function canViewTrainingNotes(account) {
  return ['owner', 'manager', 'trainer'].includes(account?.role);
}

function sanitizeClientForAccount(client, account) {
  if (!client) return client;
  if (!isTrainer(account)) return client;

  return {
    ...client,
    telegramId: null,
    vkId: null,
    webId: null,
    phone: 'Скрыт',
    phoneNormalized: null,
    mergedIntoUserId: null,
    mergedByAccountId: null,
    note: null,
  };
}

function sanitizeClientsForAccount(clients, account) {
  return clients.map((client) => sanitizeClientForAccount(client, account));
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

  if (query.includeMerged !== 'true') {
    where.push('u.mergedIntoUserId IS NULL');
  }

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
        WHERE vcid.userId = u.id AND vca.visitCategoryId = :visitCategoryId
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
        WHERE vc.userId = u.id AND vc.category LIKE :visitCategory
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

    where.push(`(${searchParts.join(' OR ')})`);
  }

  if (query.duplicateOnly === 'true') {
    where.push(`
      u.phoneNormalized IS NOT NULL
      AND u.phoneNormalized IN (
        SELECT phoneNormalized
      FROM Users
        WHERE status = 'active'
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

  const visitCountMin = Number(query.visitCountMin);
  if (Number.isFinite(visitCountMin) && visitCountMin > 0) {
    having.push('visitCount >= :visitCountMin');
    replacements.visitCountMin = visitCountMin;
  }

  const visitCountMax = Number(query.visitCountMax);
  if (Number.isFinite(visitCountMax) && visitCountMax >= 0) {
    having.push('visitCount <= :visitCountMax');
    replacements.visitCountMax = visitCountMax;
  }

  const lastVisitDaysFrom = Number(query.lastVisitDaysFrom);
  if (Number.isFinite(lastVisitDaysFrom) && lastVisitDaysFrom > 0) {
    having.push('lastVisitAt IS NOT NULL');
    having.push('lastVisitAt <= DATE_SUB(NOW(), INTERVAL :lastVisitDaysFrom DAY)');
    replacements.lastVisitDaysFrom = lastVisitDaysFrom;
  }

  const lastVisitDaysTo = Number(query.lastVisitDaysTo);
  if (Number.isFinite(lastVisitDaysTo) && lastVisitDaysTo > 0) {
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
        WHERE tn.userId = u.id
        ORDER BY tn.trainedAt DESC, tn.createdAt DESC
        LIMIT 1
      ) AS latestTrainingLevel,
      (
        SELECT tn.trainedAt
        FROM TrainingNotes tn
        WHERE tn.userId = u.id
        ORDER BY tn.trainedAt DESC, tn.createdAt DESC
        LIMIT 1
      ) AS latestTrainingAt,
      (
        SELECT COUNT(*)
        FROM TrainingNotes tn_count
        WHERE tn_count.userId = u.id
      ) AS trainingNotesCount
    FROM Users u
    LEFT JOIN Visits v ON v.userId = u.id
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

async function listClients(query = {}, account = null) {
  const paging = parsePaging(query);
  const sqlOptions = { includePhoneSearch: !isTrainer(account) };
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
    getSources(),
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
  const limit = Math.min(
    20000,
    Math.max(1, Number.parseInt(options.limit, 10) || 5000),
  );
  const listQuery = buildClientListSql(query, { limit, offset: 0 });
  const rows = await db.sequelize.query(listQuery.sql, {
    replacements: listQuery.replacements,
    type: db.Sequelize.QueryTypes.SELECT,
  });

  return rows.map(mapClient);
}

async function countClients(query = {}) {
  const paging = parsePaging({ ...query, page: 1, pageSize: 10 });
  const countQuery = buildClientListSql(query, paging, true);
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

async function listSavedViews(account) {
  assertSavedViewsAccount(account);
  const views = await db.ClientSavedView.findAll({
    order: [['name', 'ASC']],
    where: { accountId: account.id },
  });

  return views.map(mapSavedView);
}

async function getSavedViewOrFail(account, id) {
  assertSavedViewsAccount(account);
  const view = await db.ClientSavedView.findOne({
    where: {
      accountId: account.id,
      id: Number(id),
    },
  });

  if (!view) throw appError('Представление клиентов не найдено', 404);
  return view;
}

async function createSavedView(account, data) {
  assertSavedViewsAccount(account);
  const name = normalizeSavedViewName(data.name);
  const filters = normalizeClientViewFilters(data.filters);

  try {
    const view = await db.ClientSavedView.create({
      accountId: account.id,
      filters,
      name,
    });

    return mapSavedView(view);
  } catch (error) {
    if (error.name === 'SequelizeUniqueConstraintError') {
      throw appError('Представление с таким названием уже существует', 409);
    }
    throw error;
  }
}

async function updateSavedView(account, id, data) {
  const view = await getSavedViewOrFail(account, id);
  const payload = {};

  if ('name' in data) payload.name = normalizeSavedViewName(data.name);
  if ('filters' in data) payload.filters = normalizeClientViewFilters(data.filters);

  try {
    await view.update(payload);
  } catch (error) {
    if (error.name === 'SequelizeUniqueConstraintError') {
      throw appError('Представление с таким названием уже существует', 409);
    }
    throw error;
  }

  return mapSavedView(view);
}

async function deleteSavedView(account, id) {
  const view = await getSavedViewOrFail(account, id);
  await view.destroy();
  return { success: true };
}

async function getSources() {
  const rows = await referencesService.list('client-sources', {
    status: 'active',
  });

  return rows.map((row) => row.name).filter(Boolean);
}

async function getClientStats(clientId) {
  const stats = await db.Visit.findOne({
    attributes: [
      [db.Sequelize.fn('COUNT', db.Sequelize.col('id')), 'visitCount'],
      [db.Sequelize.fn('MIN', db.Sequelize.col('scannedAt')), 'firstVisitAt'],
      [db.Sequelize.fn('MAX', db.Sequelize.col('scannedAt')), 'lastVisitAt'],
    ],
    where: { userId: clientId },
    raw: true,
  });

  return {
    firstVisitAt: stats?.firstVisitAt || null,
    lastVisitAt: stats?.lastVisitAt || null,
    visitCount: Number(stats?.visitCount || 0),
  };
}

async function getClientOrFail(id, { includeMerged = false } = {}) {
  const where = { id };
  if (!includeMerged) {
    where.mergedIntoUserId = null;
  }

  const client = await db.User.findOne({
    attributes: CLIENT_ATTRIBUTES,
    where,
  });

  if (!client) throw appError('Клиент не найден', 404);
  return client;
}

async function getDuplicateCandidates(client) {
  const conditions = [];
  if (client.phoneNormalized) conditions.push({ phoneNormalized: client.phoneNormalized });
  CLIENT_IDENTITY_FIELDS.forEach((field) => {
    if (client[field]) conditions.push({ [field]: client[field] });
  });
  if (conditions.length === 0) return [];

  const candidates = await db.User.findAll({
    attributes: CLIENT_ATTRIBUTES,
    where: {
      id: {
        [Op.ne]: client.id,
      },
      [Op.or]: conditions,
      status: { [Op.in]: ['active', 'archived'] },
      mergedIntoUserId: null,
    },
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

async function listTrainingNotes(clientId) {
  const notes = await db.TrainingNote.findAll({
    where: { userId: clientId },
    include: [
      {
        model: db.Account,
        as: 'trainerAccount',
        attributes: ['id', 'role', 'staffId'],
        include: [{ model: db.Staff, attributes: ['id', 'name'] }],
      },
    ],
    order: [
      ['trainedAt', 'DESC'],
      ['createdAt', 'DESC'],
    ],
    limit: 50,
  });

  return notes.map((note) => {
    const raw = note.toJSON();
    const trainer = raw.trainerAccount;

    return {
      id: raw.id,
      trainedAt: raw.trainedAt,
      level: raw.level,
      exercises: raw.exercises || '',
      note: raw.note || '',
      createdAt: raw.createdAt,
      updatedAt: raw.updatedAt,
      trainer: trainer
        ? {
            id: trainer.id,
            name: trainer.Staff?.name || 'Тренер',
            role: trainer.role,
          }
        : null,
    };
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

async function getClientDetails(id, account = null) {
  const client = await getClientOrFail(id, { includeMerged: true });
  if (client.mergedIntoUserId) {
    const includeOperationalHistory = !isTrainer(account);
    const trainingNotes = canViewTrainingNotes(account)
      ? await listTrainingNotes(client.id)
      : [];
    const [bookings, bookingSeries, bookingStats, telephonyCalls] = includeOperationalHistory
      ? await Promise.all([
          listClientBookings(client.id, { limit: 50 }),
          listClientBookingSeries(client.id, { limit: 30 }),
          getClientBookingStats(client.id),
          listClientTelephonyCalls(client.id, account, { limit: 30 }),
        ])
      : [[], [], getEmptyBookingStats(), []];

    return {
      bookingSeries,
      bookingStats,
      bookings,
      activeCallTasks: includeOperationalHistory
        ? await listClientActiveCallTasks(client.id, account)
        : [],
      client: sanitizeClientForAccount(mapClient(client), account),
      mergedInto: sanitizeClientForAccount(
        mapClient(await db.User.findByPk(client.mergedIntoUserId)),
        account,
      ),
      visits: [],
      duplicateCandidates: [],
      timeline: includeOperationalHistory
        ? await listClientTimeline(client.id, {
            bookingSeries,
            bookings,
            account,
            trainingNotes,
            telephonyCalls,
            visits: [],
          })
        : [],
      telephonyCalls,
      trainingNotes,
    };
  }

  const includeOperationalHistory = !isTrainer(account);
  const [
    stats,
    visits,
    duplicateCandidates,
    trainingNotes,
    bookings,
    bookingSeries,
    bookingStats,
    activeCallTasks,
    telephonyCalls,
  ] = await Promise.all([
    getClientStats(client.id),
    includeOperationalHistory ? listClientVisits(client.id, { limit: 50 }) : [],
    isTrainer(account) ? [] : getDuplicateCandidates(client),
    canViewTrainingNotes(account) ? listTrainingNotes(client.id) : [],
    includeOperationalHistory ? listClientBookings(client.id, { limit: 50 }) : [],
    includeOperationalHistory ? listClientBookingSeries(client.id, { limit: 30 }) : [],
    includeOperationalHistory ? getClientBookingStats(client.id) : getEmptyBookingStats(),
    includeOperationalHistory ? listClientActiveCallTasks(client.id, account) : [],
    includeOperationalHistory ? listClientTelephonyCalls(client.id, account, { limit: 30 }) : [],
  ]);

  return {
    activeCallTasks,
    bookingSeries,
    bookingStats,
    bookings,
    client: sanitizeClientForAccount(
      mapClient({ ...client.toJSON(), ...stats }),
      account,
    ),
    duplicateCandidates: sanitizeClientsForAccount(duplicateCandidates, account),
    timeline: includeOperationalHistory
      ? await listClientTimeline(client.id, {
          account,
          bookingSeries,
          bookings,
          trainingNotes,
          telephonyCalls,
          visits,
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

async function getClientBookingStats(clientId) {
  if (!db.Booking) return getEmptyBookingStats();

  const now = new Date();
  const activeWhere = {
    userId: clientId,
    status: { [Op.ne]: 'canceled' },
  };
  const [totalCount, activeCount, upcomingCount, canceledCount, paidAmount, plannedAmount, nextBooking] =
    await Promise.all([
      db.Booking.count({ where: { userId: clientId } }),
      db.Booking.count({ where: activeWhere }),
      db.Booking.count({
        where: {
          ...activeWhere,
          startsAt: { [Op.gte]: now },
        },
      }),
      db.Booking.count({
        where: {
          userId: clientId,
          status: 'canceled',
        },
      }),
      db.Booking.sum('paidAmount', { where: activeWhere }),
      db.Booking.sum('price', { where: activeWhere }),
      db.Booking.findOne({
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

async function listClientBookings(clientId, options = {}) {
  if (!db.Booking) return [];

  const limit = Math.min(200, Number(options.limit) || 50);
  const bookings = await db.Booking.findAll({
    where: { userId: clientId },
    include: [
      db.Court,
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

async function listClientBookingSeries(clientId, options = {}) {
  if (!db.BookingSeries) return [];

  const limit = Math.min(100, Number(options.limit) || 30);
  const rows = await db.BookingSeries.findAll({
    where: { userId: clientId },
    include: [db.Court],
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

async function listClientCallTimeline(clientId, account) {
  if (!canViewCallTimeline(account)) return [];

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
      },
      {
        model: db.CallTaskAttempt,
        as: 'attempts',
        include: [
          {
            model: db.Account,
            as: 'actorAccount',
            attributes: ['id', 'email', 'role', 'staffId'],
            include: [{ model: db.Staff, attributes: ['id', 'name'] }],
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
          actor: mapAccount(attempt.actorAccount),
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

async function listClientActiveCallTasks(clientId, account) {
  if (!canViewCallTimeline(account)) return [];

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
            include: [{ model: db.Staff, attributes: ['id', 'name'] }],
          },
        ],
        required: true,
        where: {
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
      assignedTo: mapAccount(task?.assignedToAccount),
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

async function listClientTimeline(
  clientId,
  { account, bookingSeries, bookings, visits, trainingNotes, telephonyCalls } = {},
) {
  const [callItems, auditItems] = await Promise.all([
    listClientCallTimeline(clientId, account),
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

async function mapClientWithCurrentStats(client, account = null) {
  if (!client) return null;
  const stats = await getClientStats(client.id);
  return sanitizeClientForAccount(
    mapClient({ ...client.toJSON(), ...stats }),
    account,
  );
}

async function lookupByPhone(
  phone,
  excludeClientId = null,
  account = null,
  options = {},
) {
  if (isTrainer(account)) {
    throw appError('Тренеру недоступен поиск клиентов по телефону', 403);
  }

  const phoneNormalized = getPhoneLookupDigits(phone);
  if (phoneNormalized.length !== 10) return null;

  const where = {
    phoneNormalized,
    mergedIntoUserId: null,
  };
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
  return mapClientWithCurrentStats(client, account);
}

async function findExistingByIdentity(field, value, excludeClientId = null) {
  const normalizedValue = normalizeOptionalIdentity(value);
  if (!normalizedValue) return null;

  const where = {
    [field]: normalizedValue,
    mergedIntoUserId: null,
  };
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

  return client ? resolveCanonicalClient(client) : null;
}

async function findExistingByPhone(phoneNormalized, excludeClientId = null) {
  const where = {
    phoneNormalized,
    mergedIntoUserId: null,
  };
  if (excludeClientId) {
    where.id = { [Op.ne]: Number(excludeClientId) };
  }

  return db.User.findOne({
    attributes: CLIENT_ATTRIBUTES,
    where,
    order: [
      [db.Sequelize.literal("CASE WHEN status = 'active' THEN 0 ELSE 1 END"), 'ASC'],
      ['createdAt', 'DESC'],
    ],
  });
}

async function assertIdentityAvailable(data, excludeClientId = null) {
  for (const field of CLIENT_IDENTITY_FIELDS) {
    if (!(field in data)) continue;
    const value = normalizeOptionalIdentity(data[field]);
    if (!value) continue;

    const existing = await findExistingByIdentity(field, value, excludeClientId);
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

async function generateWebId() {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const webId = `web_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    const existing = await findExistingByIdentity('webId', webId);
    if (!existing) return webId;
  }

  throw appError('Не удалось сгенерировать уникальный WEB ID клиента');
}

async function createClient(data) {
  const name = normalizeClientName(data.name);
  const sourceRef = await referencesService.getClientSourceByInput(data);
  const { phone, phoneNormalized } = normalizePhonePayload(data.phone);
  return withClientIdentityLocks(
    getClientIdentityLockKeys(data, phoneNormalized),
    async () => {
      const existing = await findExistingByPhone(phoneNormalized);
      await assertIdentityAvailable(data);

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
      if (!identityPayload.webId) identityPayload.webId = await generateWebId();

      const client = await db.User.create({
        ...identityPayload,
        name,
        phone,
        phoneNormalized,
        source: sourceRef.name,
        sourceId: sourceRef.id,
        note: normalizeNote(data.note),
        status: 'active',
      });

      return getClientDetails(client.id);
    },
  );
}

async function registerClientFromMessenger({
  externalId,
  messenger,
  name,
  phone: rawPhone,
  source,
}) {
  const messengerField = messenger === 'telegram' ? 'telegramId' : 'vkId';
  if (!externalId) throw appError('Не указан идентификатор мессенджера');

  const fullName = normalizeClientName(name);
  const sourceRef = await referencesService.getClientSourceByInput({ source });
  const { phone, phoneNormalized } = normalizePhonePayload(rawPhone);
  const externalIdValue = String(externalId);

  return withClientIdentityLocks(
    getClientIdentityLockKeys(
      { [messengerField]: externalIdValue },
      phoneNormalized,
    ),
    async () => {
      const [byPhone, byMessengerRaw] = await Promise.all([
        findExistingByPhone(phoneNormalized),
        db.User.findOne({
          attributes: CLIENT_ATTRIBUTES,
          where: { [messengerField]: externalIdValue },
          order: [['createdAt', 'DESC']],
        }),
      ]);
      const byMessenger = byMessengerRaw
        ? await resolveCanonicalClient(byMessengerRaw)
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

        await existing.update({
          [messengerField]: externalIdValue,
          name: fullName,
          phone,
          phoneNormalized,
          source: sourceRef.name,
          sourceId: sourceRef.id,
          status: 'active',
        });

        return getClientDetails(existing.id);
      }

      const client = await db.User.create({
        [messengerField]: externalIdValue,
        name: fullName,
        phone,
        phoneNormalized,
        source: sourceRef.name,
        sourceId: sourceRef.id,
        status: 'active',
      });

      return getClientDetails(client.id);
    },
  );
}

async function updateClient(id, data) {
  const normalizedPhonePayload = 'phone' in data ? normalizePhonePayload(data.phone) : null;

  return withClientIdentityLocks(
    getClientIdentityLockKeys(data, normalizedPhonePayload?.phoneNormalized),
    async () => updateClientAfterIdentityLock(id, data, normalizedPhonePayload),
  );
}

async function updateClientAfterIdentityLock(id, data, normalizedPhonePayload = null) {
  const client = await getClientOrFail(id);
  const payload = {};

  if ('name' in data) payload.name = normalizeClientName(data.name);
  if ('source' in data || 'sourceId' in data) {
    const allowArchived = isSameClientSource(client, data);
    const sourceRef = await referencesService.getClientSourceByInput({
      ...data,
      allowArchived,
    });
    payload.source = sourceRef.name;
    payload.sourceId = sourceRef.id;
  }
  if ('note' in data) payload.note = normalizeNote(data.note);
  if ('status' in data) payload.status = normalizeStatus(data.status);

  await assertIdentityAvailable(data, client.id);
  CLIENT_IDENTITY_FIELDS.forEach((field) => {
    if (field in data) payload[field] = normalizeOptionalIdentity(data[field]);
  });

  if ('phone' in data) {
    const { phone, phoneNormalized } =
      normalizedPhonePayload || normalizePhonePayload(data.phone);
    const existing = await findExistingByPhone(phoneNormalized, client.id);
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
    const existing = await findExistingByPhone(client.phoneNormalized, client.id);
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

  await client.update(payload);
  return getClientDetails(client.id);
}

async function resolveCanonicalClient(client) {
  if (!client) return null;
  if (!client.mergedIntoUserId) return client;

  return db.User.findByPk(client.mergedIntoUserId);
}

async function findActiveByPhone(phone) {
  const phoneNormalized = getPhoneLookupDigits(phone);
  if (phoneNormalized.length !== 10) return null;

  return db.User.findOne({
    where: { phoneNormalized, status: 'active', mergedIntoUserId: null },
    order: [['createdAt', 'DESC']],
  });
}

async function findCanonicalByQr(qr) {
  let client = null;

  if (qr.startsWith('vk_')) {
    client = await db.User.findOne({ where: { vkId: qr.replace('vk_', '') } });
  } else if (qr.startsWith('web_')) {
    client = await db.User.findOne({ where: { webId: qr } });
  } else {
    client = await db.User.findOne({
      where: {
        [Op.or]: [{ telegramId: qr }, { telegramId: `@${qr}` }],
      },
    });
  }

  return resolveCanonicalClient(client);
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
    where: { userId: clientId },
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

async function mergeClients(primaryClientId, duplicateClientIds, actor) {
  const primaryId = Number(primaryClientId);
  const duplicateIds = Array.from(
    new Set((duplicateClientIds || []).map((id) => Number(id))),
  ).filter((id) => Number.isInteger(id) && id !== primaryId);

  if (!Number.isInteger(primaryId) || duplicateIds.length === 0) {
    throw appError('Выберите основного клиента и дубли для объединения');
  }

  await db.sequelize.transaction(async (transaction) => {
    const primary = await db.User.findByPk(primaryId, { transaction });
    if (!primary || primary.status !== 'active' || primary.mergedIntoUserId) {
      throw appError('Основной клиент не найден', 404);
    }

    const duplicates = await db.User.findAll({
      where: {
        id: {
          [Op.in]: duplicateIds,
        },
        status: 'active',
        mergedIntoUserId: null,
      },
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
            where: { userId: duplicate.id },
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
            where: { userId: duplicate.id },
            transaction,
          },
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

  return getClientDetails(primaryId, actor);
}

async function getDuplicateGroups() {
  const duplicateGroups = [];

  for (const group of DUPLICATE_GROUPS) {
    const rows = await db.sequelize.query(
      `
        SELECT ${group.field} AS value, COUNT(*) AS count
        FROM Users
        WHERE status = 'active'
          AND mergedIntoUserId IS NULL
          AND ${group.field} IS NOT NULL
          AND ${group.field} <> ''
        GROUP BY ${group.field}
        HAVING COUNT(*) > 1
        ORDER BY count DESC, ${group.field} ASC
      `,
      { type: db.Sequelize.QueryTypes.SELECT },
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
    where: {
      [Op.or]: conditions,
      status: 'active',
      mergedIntoUserId: null,
    },
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

async function removeArchivedClient(id) {
  const client = await getClientOrFail(id);
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
    mergedClientsCount,
  ] =
    await Promise.all([
      db.Visit.count({ where: { userId: client.id } }),
      db.TrainingNote.count({ where: { userId: client.id } }),
      db.CallTaskClient.count({ where: { userId: client.id } }),
      db.TelephonyCall ? db.TelephonyCall.count({ where: { userId: client.id } }) : 0,
      db.Booking ? db.Booking.count({ where: { userId: client.id } }) : 0,
      db.BookingSeries ? db.BookingSeries.count({ where: { userId: client.id } }) : 0,
      db.User.count({ where: { mergedIntoUserId: client.id } }),
    ]);

  if (
    visitsCount > 0 ||
    trainingNotesCount > 0 ||
    callTaskClientsCount > 0 ||
    telephonyCallsCount > 0 ||
    bookingCount > 0 ||
    bookingSeriesCount > 0 ||
    mergedClientsCount > 0
  ) {
    throw appError(
      'Клиента нельзя удалить безвозвратно: есть визиты, бронирования, постоянки, дневник тренировок, задачи обзвона, звонки или связанные дубли. Оставьте его в архиве.',
      409,
    );
  }

  await client.destroy();
  return { success: true };
}

module.exports = {
  countClients,
  createClient,
  createSavedView,
  deleteSavedView,
  findActiveByPhone,
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
};
