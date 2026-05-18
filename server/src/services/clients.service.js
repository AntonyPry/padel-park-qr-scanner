const { Op } = require('sequelize');
const db = require('../../models');
const {
  formatRussianPhone,
  getPhoneLookupDigits,
} = require('../utils/phone');

const CLIENT_ATTRIBUTES = [
  'id',
  'telegramId',
  'vkId',
  'webId',
  'name',
  'phone',
  'phoneNormalized',
  'source',
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

function appError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function normalizeClientName(name) {
  const normalized = String(name || '').trim().replace(/\s+/g, ' ');
  if (normalized.length < 2) {
    throw appError('Имя клиента должно быть не короче 2 символов');
  }

  return normalized;
}

function normalizeSource(source) {
  return String(source || 'Ресепшн (Админ)').trim() || 'Ресепшн (Админ)';
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

function getClientStatus(client) {
  if (client.status === 'merged') return 'Объединен';
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

function buildClientListSql(query, paging, countOnly = false) {
  const where = [];
  const having = [];
  const replacements = {};
  const status = query.status || 'active';
  const segment = SEGMENT_VALUES.has(query.segment) ? query.segment : 'all';

  if (status !== 'all') {
    where.push('u.status = :status');
    replacements.status = status;
  }

  if (query.source) {
    where.push('u.source = :source');
    replacements.source = query.source;
  }

  const q = String(query.q || '').trim();
  const phoneDigits = getPhoneLookupDigits(q);
  if (q) {
    const searchParts = ['u.name LIKE :q', 'u.phone LIKE :q'];
    replacements.q = `%${q}%`;

    if (phoneDigits.length >= 2) {
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
        WHERE status = 'active' AND phoneNormalized IS NOT NULL
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

async function listClients(query = {}) {
  const paging = parsePaging(query);
  const [listQuery, countQuery] = [
    buildClientListSql(query, paging),
    buildClientListSql(query, paging, true),
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
    items: rows.map(mapClient),
    page: paging.page,
    pageSize: paging.pageSize,
    sources,
    total,
    totalPages: Math.max(1, Math.ceil(total / paging.pageSize)),
  };
}

async function getSources() {
  const rows = await db.User.findAll({
    attributes: ['source'],
    where: {
      source: {
        [Op.ne]: '',
      },
    },
    group: ['source'],
    order: [['source', 'ASC']],
    raw: true,
  });

  return rows.map((row) => row.source).filter(Boolean);
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
    where.status = {
      [Op.ne]: 'merged',
    };
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

async function getClientDetails(id) {
  const client = await getClientOrFail(id, { includeMerged: true });
  if (client.status === 'merged' && client.mergedIntoUserId) {
    return {
      client: mapClient(client),
      mergedInto: mapClient(await db.User.findByPk(client.mergedIntoUserId)),
      visits: [],
      duplicateCandidates: [],
    };
  }

  const [stats, visits, duplicateCandidates] = await Promise.all([
    getClientStats(client.id),
    listClientVisits(client.id, { limit: 50 }),
    getDuplicateCandidates(client),
  ]);

  return {
    client: mapClient({ ...client.toJSON(), ...stats }),
    duplicateCandidates,
    visits,
  };
}

async function listClientVisits(clientId, options = {}) {
  const limit = Math.min(200, Number(options.limit) || 50);
  const visits = await db.Visit.findAll({
    where: { userId: clientId },
    order: [['scannedAt', 'DESC']],
    limit,
  });

  return visits.map((visit) => ({
    id: visit.id,
    scannedAt: visit.scannedAt,
    keyNumber: visit.keyNumber,
    category: visit.category,
    createdAt: visit.createdAt,
  }));
}

async function lookupByPhone(phone, excludeClientId = null) {
  const phoneNormalized = getPhoneLookupDigits(phone);
  if (phoneNormalized.length !== 10) return null;

  const where = {
    phoneNormalized,
    status: 'active',
  };
  if (excludeClientId) {
    where.id = { [Op.ne]: Number(excludeClientId) };
  }

  const client = await db.User.findOne({
    attributes: CLIENT_ATTRIBUTES,
    where,
    order: [['createdAt', 'DESC']],
  });

  if (!client) return null;
  const stats = await getClientStats(client.id);
  return mapClient({ ...client.toJSON(), ...stats });
}

async function createClient(data) {
  const name = normalizeClientName(data.name);
  const source = normalizeSource(data.source);
  const { phone, phoneNormalized } = normalizePhonePayload(data.phone);
  const existing = await lookupByPhone(phoneNormalized);

  if (existing) {
    throw appError('Клиент с таким телефоном уже существует', 409);
  }

  const client = await db.User.create({
    webId:
      data.webId ||
      `web_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    name,
    phone,
    phoneNormalized,
    source,
    note: normalizeNote(data.note),
    status: 'active',
  });

  return getClientDetails(client.id);
}

async function updateClient(id, data) {
  const client = await getClientOrFail(id);
  const payload = {};

  if ('name' in data) payload.name = normalizeClientName(data.name);
  if ('source' in data) payload.source = normalizeSource(data.source);
  if ('note' in data) payload.note = normalizeNote(data.note);
  if ('status' in data) payload.status = normalizeStatus(data.status);

  if ('phone' in data) {
    const { phone, phoneNormalized } = normalizePhonePayload(data.phone);
    const existing = await lookupByPhone(phoneNormalized, client.id);
    if (existing) {
      throw appError('Клиент с таким телефоном уже существует', 409);
    }
    payload.phone = phone;
    payload.phoneNormalized = phoneNormalized;
  }

  await client.update(payload);
  return getClientDetails(client.id);
}

async function resolveCanonicalClient(client) {
  if (!client) return null;
  if (client.status !== 'merged' || !client.mergedIntoUserId) return client;

  return db.User.findByPk(client.mergedIntoUserId);
}

async function findActiveByPhone(phone) {
  const phoneNormalized = getPhoneLookupDigits(phone);
  if (phoneNormalized.length !== 10) return null;

  return db.User.findOne({
    where: { phoneNormalized, status: 'active' },
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
    if (!primary || primary.status === 'merged') {
      throw appError('Основной клиент не найден', 404);
    }

    const duplicates = await db.User.findAll({
      where: {
        id: {
          [Op.in]: duplicateIds,
        },
        status: {
          [Op.ne]: 'merged',
        },
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
          status: 'merged',
          mergedIntoUserId: primary.id,
          mergedAt: new Date(),
          mergedByAccountId: actor?.id || null,
        },
        { transaction },
      );
    }
  });

  return getClientDetails(primaryId);
}

async function getDuplicateGroups() {
  const rows = await db.sequelize.query(
    `
      SELECT phoneNormalized, COUNT(*) AS count
      FROM Users
      WHERE status = 'active' AND phoneNormalized IS NOT NULL
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

module.exports = {
  createClient,
  findActiveByPhone,
  findCanonicalByQr,
  getClientDetails,
  getDuplicateGroups,
  listClientVisits,
  listClients,
  lookupByPhone,
  mergeClients,
  updateClient,
};
