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

  return {
    ...raw,
    statusLabel: getClientStatus(raw),
    segment: getClientSegment(stats),
    stats,
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
  };
}

function sanitizeClientsForAccount(clients, account) {
  return clients.map((client) => sanitizeClientForAccount(client, account));
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

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const havingSql = having.length ? `HAVING ${having.join(' AND ')}` : '';

  const baseSql = `
    SELECT
      u.*,
      COUNT(v.id) AS visitCount,
      MIN(v.scannedAt) AS firstVisitAt,
      MAX(v.scannedAt) AS lastVisitAt
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
  if (!client.phoneNormalized) return [];

  const candidates = await db.User.findAll({
    attributes: CLIENT_ATTRIBUTES,
    where: {
      id: {
        [Op.ne]: client.id,
      },
      phoneNormalized: client.phoneNormalized,
      status: 'active',
      mergedIntoUserId: null,
    },
    order: [['createdAt', 'DESC']],
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
        attributes: ['id', 'email', 'role', 'staffId'],
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
            email: trainer.email,
            name: trainer.Staff?.name || trainer.email,
          }
        : null,
    };
  });
}

async function getClientDetails(id, account = null) {
  const client = await getClientOrFail(id, { includeMerged: true });
  if (client.mergedIntoUserId) {
    return {
      client: sanitizeClientForAccount(mapClient(client), account),
      mergedInto: sanitizeClientForAccount(
        mapClient(await db.User.findByPk(client.mergedIntoUserId)),
        account,
      ),
      visits: [],
      duplicateCandidates: [],
      trainingNotes: canViewTrainingNotes(account)
        ? await listTrainingNotes(client.id)
        : [],
    };
  }

  const [stats, visits, duplicateCandidates, trainingNotes] = await Promise.all([
    getClientStats(client.id),
    listClientVisits(client.id, { limit: 50 }),
    isTrainer(account) ? [] : getDuplicateCandidates(client),
    canViewTrainingNotes(account) ? listTrainingNotes(client.id) : [],
  ]);

  return {
    client: sanitizeClientForAccount(
      mapClient({ ...client.toJSON(), ...stats }),
      account,
    ),
    duplicateCandidates: sanitizeClientsForAccount(duplicateCandidates, account),
    trainingNotes,
    visits,
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

async function createClient(data) {
  const name = normalizeClientName(data.name);
  const sourceRef = await referencesService.getClientSourceByInput(data);
  const { phone, phoneNormalized } = normalizePhonePayload(data.phone);
  const existing = await findExistingByPhone(phoneNormalized);

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

  const client = await db.User.create({
    webId:
      data.webId ||
      `web_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    name,
    phone,
    phoneNormalized,
    source: sourceRef.name,
    sourceId: sourceRef.id,
    note: normalizeNote(data.note),
    status: 'active',
  });

  return getClientDetails(client.id);
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
}

async function updateClient(id, data) {
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

  if ('phone' in data) {
    const { phone, phoneNormalized } = normalizePhonePayload(data.phone);
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
  const rows = await db.sequelize.query(
    `
      SELECT phoneNormalized, COUNT(*) AS count
      FROM Users
      WHERE status = 'active'
        AND mergedIntoUserId IS NULL
        AND phoneNormalized IS NOT NULL
      GROUP BY phoneNormalized
      HAVING COUNT(*) > 1
      ORDER BY count DESC, phoneNormalized ASC
    `,
    { type: db.Sequelize.QueryTypes.SELECT },
  );

  if (rows.length === 0) return [];

  const clients = await db.User.findAll({
    attributes: CLIENT_ATTRIBUTES,
    where: {
      phoneNormalized: {
        [Op.in]: rows.map((row) => row.phoneNormalized),
      },
      status: 'active',
      mergedIntoUserId: null,
    },
    order: [
      ['phoneNormalized', 'ASC'],
      ['createdAt', 'DESC'],
    ],
  });
  const statsByClientId = await getStatsByClientIds(
    clients.map((client) => client.id),
  );

  return rows.map((row) => ({
    phoneNormalized: row.phoneNormalized,
    count: Number(row.count),
    clients: clients
      .filter((client) => client.phoneNormalized === row.phoneNormalized)
      .map((client) => mapClientWithStats(client, statsByClientId)),
  }));
}

async function removeArchivedClient(id) {
  const client = await getClientOrFail(id);
  if (client.status !== 'archived') {
    throw appError('Удалять безвозвратно можно только клиентов из архива', 409);
  }

  const [visitsCount, trainingNotesCount, callTaskClientsCount, mergedClientsCount] =
    await Promise.all([
      db.Visit.count({ where: { userId: client.id } }),
      db.TrainingNote.count({ where: { userId: client.id } }),
      db.CallTaskClient.count({ where: { userId: client.id } }),
      db.User.count({ where: { mergedIntoUserId: client.id } }),
    ]);

  if (
    visitsCount > 0 ||
    trainingNotesCount > 0 ||
    callTaskClientsCount > 0 ||
    mergedClientsCount > 0
  ) {
    throw appError(
      'Клиента нельзя удалить безвозвратно: есть визиты, дневник тренировок, задачи обзвона или связанные дубли. Оставьте его в архиве.',
      409,
    );
  }

  await client.destroy();
  return { success: true };
}

module.exports = {
  countClients,
  createClient,
  findActiveByPhone,
  findCanonicalByQr,
  getClientDetails,
  getDuplicateGroups,
  listClientVisits,
  listClients,
  listClientsForSnapshot,
  lookupByPhone,
  mergeClients,
  removeArchivedClient,
  registerClientFromMessenger,
  updateClient,
};
