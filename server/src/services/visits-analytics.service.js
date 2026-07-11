const XLSX = require('xlsx');
const db = require('../../models');

const DAY_MS = 24 * 60 * 60 * 1000;

function endOfDay(value) {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(value))
    ? new Date(`${value}T00:00:00`)
    : new Date(value);
  date.setHours(23, 59, 59, 999);
  return date;
}

function startOfDay(value) {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(value))
    ? new Date(`${value}T00:00:00`)
    : new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
}

function resolvePeriod(from, to) {
  const periodEnd = to ? endOfDay(to) : new Date();
  const periodStart = from ? startOfDay(from) : new Date(0);
  const durationMs = Math.max(DAY_MS, periodEnd.getTime() - periodStart.getTime() + 1);
  return {
    from: periodStart,
    to: periodEnd,
    previousFrom: new Date(periodStart.getTime() - durationMs),
    previousTo: new Date(periodStart.getTime() - 1),
  };
}

const NORMALIZED_VISITS_CTE = `
  WITH normalized_visits AS (
    SELECT
      v.id,
      COALESCE(u.mergedIntoUserId, v.userId) AS canonicalUserId,
      COALESCE(v.scannedAt, v.createdAt) AS visitedAt,
      v.keyNumber,
      v.category,
      COALESCE(NULLIF(canonical.source, ''), NULLIF(u.source, ''), 'Не указан') AS source,
      COALESCE(NULLIF(canonical.name, ''), NULLIF(u.name, ''), 'Неизвестный') AS name,
      COALESCE(canonical.phone, u.phone, '') AS phone
    FROM Visits v
    INNER JOIN Users u ON u.id = v.userId
    LEFT JOIN Users canonical ON canonical.id = u.mergedIntoUserId
    WHERE COALESCE(v.isTraining, 0) = 0
      AND COALESCE(u.isTraining, 0) = 0
      AND v.duplicateOfVisitId IS NULL
  ),
  visit_history AS (
    SELECT
      nv.*,
      ROW_NUMBER() OVER (PARTITION BY canonicalUserId ORDER BY visitedAt, id) AS visitNumber,
      MIN(visitedAt) OVER (PARTITION BY canonicalUserId) AS firstVisitAt
    FROM normalized_visits nv
  )
`;

function number(value) {
  return Number(value || 0);
}

function metricFromRow(row = {}) {
  const totalVisits = number(row.totalVisits);
  const uniqueGuests = number(row.uniqueGuests);
  return {
    totalVisits,
    uniqueGuests,
    newGuests: number(row.newGuests),
    returningGuests: number(row.returningGuests),
    repeatVisits: Math.max(0, totalVisits - uniqueGuests),
    averageVisitsPerGuest: uniqueGuests ? totalVisits / uniqueGuests : 0,
    repeatRate30: number(row.repeatRate30),
    repeatRate30EligibleGuests: number(row.repeatRate30EligibleGuests),
    repeatRate30RepeatedGuests: number(row.repeatRate30RepeatedGuests),
  };
}

async function queryMetrics(from, to, now) {
  const [row = {}] = await db.sequelize.query(
    `${NORMALIZED_VISITS_CTE}
      , client_history AS (
        SELECT
          canonicalUserId,
          MIN(visitedAt) AS firstVisitAt,
          MIN(CASE WHEN visitNumber = 2 THEN visitedAt END) AS secondVisitAt
        FROM visit_history
        GROUP BY canonicalUserId
      ), period_visits AS (
        SELECT * FROM visit_history WHERE visitedAt BETWEEN :from AND :to
      )
      SELECT
        COUNT(pv.id) AS totalVisits,
        COUNT(DISTINCT pv.canonicalUserId) AS uniqueGuests,
        COUNT(DISTINCT CASE WHEN ch.firstVisitAt BETWEEN :from AND :to THEN pv.canonicalUserId END) AS newGuests,
        COUNT(DISTINCT CASE WHEN ch.firstVisitAt < :from THEN pv.canonicalUserId END) AS returningGuests,
        COUNT(DISTINCT CASE
          WHEN ch.firstVisitAt BETWEEN :from AND :to
            AND DATE_ADD(ch.firstVisitAt, INTERVAL 30 DAY) <= :now
          THEN ch.canonicalUserId END) AS repeatRate30EligibleGuests,
        COUNT(DISTINCT CASE
          WHEN ch.firstVisitAt BETWEEN :from AND :to
            AND DATE_ADD(ch.firstVisitAt, INTERVAL 30 DAY) <= :now
            AND ch.secondVisitAt <= DATE_ADD(ch.firstVisitAt, INTERVAL 30 DAY)
          THEN ch.canonicalUserId END) AS repeatRate30RepeatedGuests,
        CASE WHEN COUNT(DISTINCT CASE
          WHEN ch.firstVisitAt BETWEEN :from AND :to
            AND DATE_ADD(ch.firstVisitAt, INTERVAL 30 DAY) <= :now
          THEN ch.canonicalUserId END) = 0 THEN 0 ELSE
          100 * COUNT(DISTINCT CASE
            WHEN ch.firstVisitAt BETWEEN :from AND :to
              AND DATE_ADD(ch.firstVisitAt, INTERVAL 30 DAY) <= :now
              AND ch.secondVisitAt <= DATE_ADD(ch.firstVisitAt, INTERVAL 30 DAY)
            THEN ch.canonicalUserId END)
          / COUNT(DISTINCT CASE
            WHEN ch.firstVisitAt BETWEEN :from AND :to
              AND DATE_ADD(ch.firstVisitAt, INTERVAL 30 DAY) <= :now
            THEN ch.canonicalUserId END)
        END AS repeatRate30
      FROM period_visits pv
      LEFT JOIN client_history ch ON ch.canonicalUserId = pv.canonicalUserId`,
    { replacements: { from, to, now }, type: db.Sequelize.QueryTypes.SELECT },
  );
  return metricFromRow(row);
}

function calculateChanges(current, previous) {
  return Object.fromEntries(
    ['totalVisits', 'uniqueGuests', 'newGuests', 'returningGuests', 'repeatVisits', 'averageVisitsPerGuest', 'repeatRate30'].map((key) => {
      const currentValue = current[key];
      const previousValue = previous[key];
      return [key, {
        absolute: currentValue - previousValue,
        percent: previousValue === 0 ? null : ((currentValue - previousValue) / previousValue) * 100,
      }];
    }),
  );
}

async function getVisitsAnalytics(from, to, options = {}) {
  const period = resolvePeriod(from, to);
  const now = options.now ? new Date(options.now) : new Date();
  const [metrics, previousMetrics, detailRows] = await Promise.all([
    queryMetrics(period.from, period.to, now),
    queryMetrics(period.previousFrom, period.previousTo, now),
    db.sequelize.query(
      `${NORMALIZED_VISITS_CTE}
       SELECT * FROM visit_history WHERE visitedAt BETWEEN :from AND :to ORDER BY visitedAt DESC`,
      { replacements: period, type: db.Sequelize.QueryTypes.SELECT },
    ),
  ]);

  const sources = new Map();
  const categories = new Map();
  const guests = new Map();
  const heatMap = {};
  detailRows.forEach((visit) => {
    sources.set(visit.source, (sources.get(visit.source) || 0) + 1);
    String(visit.category || 'Не указана').split(',').map((item) => item.trim()).filter(Boolean)
      .forEach((item) => categories.set(item, (categories.get(item) || 0) + 1));
    const guest = guests.get(visit.canonicalUserId) || { name: visit.name, phone: visit.phone, visits: 0 };
    guest.visits += 1;
    guests.set(visit.canonicalUserId, guest);
    const date = new Date(visit.visitedAt);
    const day = date.getDay() === 0 ? 7 : date.getDay();
    const key = `${day}-${date.getHours()}`;
    heatMap[key] = (heatMap[key] || 0) + 1;
  });
  const sortMap = (map) => [...map].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);

  return {
    ...metrics,
    previousPeriod: { from: period.previousFrom, to: period.previousTo, metrics: previousMetrics },
    changes: calculateChanges(metrics, previousMetrics),
    sources: sortMap(sources),
    categories: sortMap(categories),
    topGuests: [...guests.values()].sort((a, b) => b.visits - a.visits).slice(0, 10),
    heatMap,
  };
}

async function createVisitsExportBuffer(from, to) {
  const analytics = await getVisitsAnalytics(from, to);
  const period = resolvePeriod(from, to);
  const visits = await db.sequelize.query(
    `${NORMALIZED_VISITS_CTE}
     SELECT id, visitedAt, name, phone, source, category, keyNumber, canonicalUserId
     FROM visit_history WHERE visitedAt BETWEEN :from AND :to ORDER BY visitedAt DESC`,
    { replacements: period, type: db.Sequelize.QueryTypes.SELECT },
  );
  const workbook = XLSX.utils.book_new();
  const summaryData = [
    ['Метрика', 'Текущий период', 'Предыдущий период'],
    ['Всего визитов', analytics.totalVisits, analytics.previousPeriod.metrics.totalVisits],
    ['Уникальные гости', analytics.uniqueGuests, analytics.previousPeriod.metrics.uniqueGuests],
    ['Новые гости', analytics.newGuests, analytics.previousPeriod.metrics.newGuests],
    ['Вернувшиеся гости', analytics.returningGuests, analytics.previousPeriod.metrics.returningGuests],
    ['Повторные визиты', analytics.repeatVisits, analytics.previousPeriod.metrics.repeatVisits],
    ['Среднее визитов на гостя', analytics.averageVisitsPerGuest, analytics.previousPeriod.metrics.averageVisitsPerGuest],
    ['Повторный визит за 30 дней, %', analytics.repeatRate30, analytics.previousPeriod.metrics.repeatRate30],
  ];
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(summaryData), 'Сводка');
  const exportData = visits.map((visit) => ({
    'ID визита': visit.id,
    'Дата и Время': new Date(visit.visitedAt).toLocaleString('ru-RU'),
    Гость: visit.name,
    Телефон: visit.phone,
    Источник: visit.source,
    'Цель визита': visit.category || 'Не указана',
    'Номер ключа': visit.keyNumber || '-',
  }));
  const worksheet = XLSX.utils.json_to_sheet(exportData);
  worksheet['!cols'] = [{ wch: 10 }, { wch: 20 }, { wch: 30 }, { wch: 15 }, { wch: 20 }, { wch: 25 }, { wch: 15 }];
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Визиты');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
}

module.exports = { calculateChanges, createVisitsExportBuffer, getVisitsAnalytics, metricFromRow, resolvePeriod };
