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

async function getVisitsAnalytics(from, to) {
  const visits = await db.Visit.findAll({
    where: buildVisitDateFilter(from, to),
    include: [{ model: db.User }],
  });

  const uniqueUsers = new Set();
  const sourcesMap = {};
  const topGuestsMap = {};
  const heatMap = {};
  const categoriesMap = {};

  visits.forEach((visit) => {
    const user = visit.User || {
      name: 'Неизвестный',
      phone: '',
      source: 'Не указан',
    };

    uniqueUsers.add(user.id || visit.userId);

    const source = user.source || 'Не указан';
    sourcesMap[source] = (sourcesMap[source] || 0) + 1;

    const categories = (visit.category || 'Не указана')
      .split(',')
      .map((category) => category.trim())
      .filter(Boolean);

    categories.forEach((category) => {
      categoriesMap[category] = (categoriesMap[category] || 0) + 1;
    });

    if (!topGuestsMap[user.name]) {
      topGuestsMap[user.name] = {
        name: user.name,
        phone: user.phone,
        visits: 0,
      };
    }
    topGuestsMap[user.name].visits++;

    const scannedAt = new Date(visit.createdAt);
    const day = scannedAt.getDay() === 0 ? 7 : scannedAt.getDay();
    const hour = scannedAt.getHours();
    const heatKey = `${day}-${hour}`;
    heatMap[heatKey] = (heatMap[heatKey] || 0) + 1;
  });

  const mapToSortedArray = (map) =>
    Object.keys(map)
      .map((name) => ({ name, value: map[name] }))
      .sort((a, b) => b.value - a.value);

  return {
    totalVisits: visits.length,
    uniqueGuests: uniqueUsers.size,
    sources: mapToSortedArray(sourcesMap),
    categories: mapToSortedArray(categoriesMap),
    topGuests: Object.values(topGuestsMap)
      .sort((a, b) => b.visits - a.visits)
      .slice(0, 10),
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
