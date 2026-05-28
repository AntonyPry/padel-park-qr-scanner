const { Op } = require('sequelize');
const XLSX = require('xlsx');
const db = require('../../models');

function buildVisitDateFilter(from, to) {
  const where = {};

  if (from || to) {
    where.createdAt = {};
    if (from) where.createdAt[Op.gte] = new Date(from);
    if (to) {
      const toDate = new Date(to);
      toDate.setHours(23, 59, 59, 999);
      where.createdAt[Op.lte] = toDate;
    }
  }

  return where;
}

function buildVisitDateSql(from, to) {
  const where = [];
  const replacements = {};

  if (from) {
    where.push('v.createdAt >= :from');
    replacements.from = new Date(from);
  }

  if (to) {
    const toDate = new Date(to);
    toDate.setHours(23, 59, 59, 999);
    where.push('v.createdAt <= :to');
    replacements.to = toDate;
  }

  return {
    replacements,
    whereSql: where.length > 0 ? `WHERE ${where.join(' AND ')}` : '',
  };
}

function mapToSortedArray(map) {
  return Object.keys(map)
    .map((name) => ({ name, value: map[name] }))
    .sort((a, b) => b.value - a.value);
}

async function getVisitsAnalytics(from, to) {
  const { replacements, whereSql } = buildVisitDateSql(from, to);
  const categoriesMap = {};

  const [summaryRows, sourceRows, categoryRows, topGuests, heatRows] =
    await Promise.all([
      db.sequelize.query(
        `
          SELECT COUNT(*) AS totalVisits, COUNT(DISTINCT v.userId) AS uniqueGuests
          FROM Visits v
          ${whereSql}
        `,
        {
          replacements,
          type: db.Sequelize.QueryTypes.SELECT,
        },
      ),
      db.sequelize.query(
        `
          SELECT COALESCE(NULLIF(u.source, ''), 'Не указан') AS name, COUNT(*) AS value
          FROM Visits v
          LEFT JOIN Users u ON u.id = v.userId
          ${whereSql}
          GROUP BY COALESCE(NULLIF(u.source, ''), 'Не указан')
          ORDER BY value DESC
        `,
        {
          replacements,
          type: db.Sequelize.QueryTypes.SELECT,
        },
      ),
      db.sequelize.query(
        `
          SELECT COALESCE(NULLIF(v.category, ''), 'Не указана') AS category, COUNT(*) AS value
          FROM Visits v
          ${whereSql}
          GROUP BY COALESCE(NULLIF(v.category, ''), 'Не указана')
        `,
        {
          replacements,
          type: db.Sequelize.QueryTypes.SELECT,
        },
      ),
      db.sequelize.query(
        `
          SELECT
            COALESCE(NULLIF(u.name, ''), 'Неизвестный') AS name,
            COALESCE(u.phone, '') AS phone,
            COUNT(*) AS visits
          FROM Visits v
          LEFT JOIN Users u ON u.id = v.userId
          ${whereSql}
          GROUP BY v.userId, u.name, u.phone
          ORDER BY visits DESC
          LIMIT 10
        `,
        {
          replacements,
          type: db.Sequelize.QueryTypes.SELECT,
        },
      ),
      db.sequelize.query(
        `
          SELECT
            CASE WHEN DAYOFWEEK(v.createdAt) = 1 THEN 7 ELSE DAYOFWEEK(v.createdAt) - 1 END AS day,
            HOUR(v.createdAt) AS hour,
            COUNT(*) AS value
          FROM Visits v
          ${whereSql}
          GROUP BY
            CASE WHEN DAYOFWEEK(v.createdAt) = 1 THEN 7 ELSE DAYOFWEEK(v.createdAt) - 1 END,
            HOUR(v.createdAt)
        `,
        {
          replacements,
          type: db.Sequelize.QueryTypes.SELECT,
        },
      ),
    ]);

  categoryRows.forEach((row) => {
    const categories = String(row.category || 'Не указана')
      .split(',')
      .map((category) => category.trim())
      .filter(Boolean);

    categories.forEach((category) => {
      categoriesMap[category] =
        (categoriesMap[category] || 0) + Number(row.value || 0);
    });
  });

  const heatMap = {};
  heatRows.forEach((row) => {
    heatMap[`${row.day}-${row.hour}`] = Number(row.value || 0);
  });

  const summary = summaryRows[0] || {};

  return {
    totalVisits: Number(summary.totalVisits || 0),
    uniqueGuests: Number(summary.uniqueGuests || 0),
    sources: sourceRows.map((row) => ({
      name: row.name,
      value: Number(row.value || 0),
    })),
    categories: mapToSortedArray(categoriesMap),
    topGuests: topGuests.map((guest) => ({
      name: guest.name,
      phone: guest.phone,
      visits: Number(guest.visits || 0),
    })),
    heatMap,
  };
}

async function createVisitsExportBuffer(from, to) {
  const visits = await db.Visit.findAll({
    where: buildVisitDateFilter(from, to),
    include: [{ model: db.User }],
    order: [['createdAt', 'DESC']],
  });

  const exportData = visits.map((visit) => ({
    'ID визита': visit.id,
    'Дата и Время': new Date(visit.createdAt).toLocaleString('ru-RU'),
    Гость: visit.User?.name || 'Неизвестный',
    Телефон: visit.User?.phone || '',
    Источник: visit.User?.source || 'Не указан',
    'Цель визита': visit.category || 'Не указана',
    'Номер ключа': visit.keyNumber || '-',
  }));

  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.json_to_sheet(exportData);
  worksheet['!cols'] = [
    { wch: 10 },
    { wch: 20 },
    { wch: 30 },
    { wch: 15 },
    { wch: 20 },
    { wch: 25 },
    { wch: 15 },
  ];

  XLSX.utils.book_append_sheet(workbook, worksheet, 'Визиты');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
}

module.exports = {
  getVisitsAnalytics,
  createVisitsExportBuffer,
};
