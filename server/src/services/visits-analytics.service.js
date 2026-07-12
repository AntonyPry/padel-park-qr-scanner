const XLSX = require('xlsx');
const db = require('../../models');

const CLUB_TIME_ZONE = 'Europe/Moscow';
const CLUB_UTC_OFFSET = '+03:00';
const DAY_MS = 24 * 60 * 60 * 1000;

function parseDateOnly(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
  return match ? { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) } : null;
}

function clubDateToUtc(value, end = false) {
  const parts = parseDateOnly(value);
  if (!parts) return new Date(value);
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day, end ? 20 : -3, end ? 59 : 0, end ? 59 : 0, end ? 999 : 0));
}

function utcSql(date) {
  return date.toISOString().slice(0, 23).replace('T', ' ');
}

function clubDateString(date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: CLUB_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function resolvePeriod(from, to, now = new Date()) {
  const currentClubDay = clubDateString(now);
  const periodStart = clubDateToUtc(from || '1970-01-01');
  const periodEnd = clubDateToUtc(to || currentClubDay, true);
  const days = Math.max(1, Math.round((Date.UTC(
    Number((to || currentClubDay).slice(0, 4)), Number((to || currentClubDay).slice(5, 7)) - 1,
    Number((to || currentClubDay).slice(8, 10)),
  ) - Date.UTC(
    Number((from || '1970-01-01').slice(0, 4)), Number((from || '1970-01-01').slice(5, 7)) - 1,
    Number((from || '1970-01-01').slice(8, 10)),
  )) / DAY_MS) + 1);
  const previousEnd = new Date(periodStart.getTime() - 1);
  const previousStart = new Date(periodStart.getTime() - days * DAY_MS);
  return {
    from: periodStart, to: periodEnd, previousFrom: previousStart, previousTo: previousEnd,
    fromSql: utcSql(periodStart), toSql: utcSql(periodEnd),
    previousFromSql: utcSql(previousStart), previousToSql: utcSql(previousEnd),
  };
}

const CANONICAL_CLIENTS_CTE = `
  WITH RECURSIVE client_chain AS (
    SELECT id AS originUserId, id AS currentUserId, mergedIntoUserId,
      CAST(CONCAT(',', id, ',') AS CHAR(2048)) AS path, 0 AS depth
    FROM Users
    UNION ALL
    SELECT chain.originUserId, parent.id, parent.mergedIntoUserId,
      CONCAT(chain.path, parent.id, ','), chain.depth + 1
    FROM client_chain chain
    JOIN Users parent ON parent.id = chain.mergedIntoUserId
    WHERE chain.depth < 63
      AND LOCATE(CONCAT(',', parent.id, ','), chain.path) = 0
  ), canonical_clients AS (
    SELECT originUserId,
      COALESCE(MAX(CASE WHEN mergedIntoUserId IS NULL THEN currentUserId END), MIN(currentUserId)) AS canonicalUserId
    FROM client_chain
    GROUP BY originUserId
  )
`;

const VALID_VISIT_SQL = `COALESCE(v.isTraining, 0) = 0
  AND COALESCE(origin.isTraining, 0) = 0
  AND v.duplicateOfVisitId IS NULL`;

function number(value) { return Number(value || 0); }

function metricFromRow(row = {}) {
  const totalVisits = number(row.totalVisits);
  const uniqueGuests = number(row.uniqueGuests);
  return {
    totalVisits, uniqueGuests, newGuests: number(row.newGuests), returningGuests: number(row.returningGuests),
    repeatVisits: Math.max(0, totalVisits - uniqueGuests),
    averageVisitsPerGuest: uniqueGuests ? totalVisits / uniqueGuests : 0,
    repeatRate30: number(row.repeatRate30),
    repeatRate30EligibleGuests: number(row.repeatRate30EligibleGuests),
    repeatRate30RepeatedGuests: number(row.repeatRate30RepeatedGuests),
  };
}

function calculateChanges(current, previous) {
  return Object.fromEntries(['totalVisits', 'uniqueGuests', 'newGuests', 'returningGuests', 'repeatVisits', 'averageVisitsPerGuest', 'repeatRate30'].map((key) => [key, {
    absolute: current[key] - previous[key],
    percent: previous[key] === 0 ? null : ((current[key] - previous[key]) / previous[key]) * 100,
  }]));
}

async function queryMetrics(period, now) {
  const rows = await db.sequelize.query(`${CANONICAL_CLIENTS_CTE},
    first_visits AS (
      SELECT cc.canonicalUserId, MIN(v.visitedAt) AS firstVisitAt
      FROM Visits v FORCE INDEX (idx_visits_user_visited_at)
      JOIN Users origin ON origin.id = v.userId
      JOIN canonical_clients cc ON cc.originUserId = v.userId
      WHERE ${VALID_VISIT_SQL}
      GROUP BY cc.canonicalUserId
    ), second_visits AS (
      SELECT cc.canonicalUserId, MIN(v.visitedAt) AS secondVisitAt
      FROM Visits v FORCE INDEX (idx_visits_user_visited_at)
      JOIN Users origin ON origin.id = v.userId
      JOIN canonical_clients cc ON cc.originUserId = v.userId
      JOIN first_visits fv ON fv.canonicalUserId = cc.canonicalUserId AND v.visitedAt > fv.firstVisitAt
      WHERE ${VALID_VISIT_SQL}
      GROUP BY cc.canonicalUserId
    ), period_counts AS (
      SELECT 'current' AS periodKey, cc.canonicalUserId, COUNT(*) AS visits
      FROM Visits v FORCE INDEX (idx_visits_visited_at)
      JOIN Users origin ON origin.id = v.userId JOIN canonical_clients cc ON cc.originUserId = v.userId
      WHERE ${VALID_VISIT_SQL} AND v.visitedAt BETWEEN :from AND :to GROUP BY cc.canonicalUserId
      UNION ALL
      SELECT 'previous', cc.canonicalUserId, COUNT(*)
      FROM Visits v FORCE INDEX (idx_visits_visited_at)
      JOIN Users origin ON origin.id = v.userId JOIN canonical_clients cc ON cc.originUserId = v.userId
      WHERE ${VALID_VISIT_SQL} AND v.visitedAt BETWEEN :previousFrom AND :previousTo GROUP BY cc.canonicalUserId
    )
    SELECT pc.periodKey, SUM(pc.visits) totalVisits, COUNT(*) uniqueGuests,
      SUM(fv.firstVisitAt BETWEEN CASE WHEN pc.periodKey='current' THEN :from ELSE :previousFrom END AND CASE WHEN pc.periodKey='current' THEN :to ELSE :previousTo END) newGuests,
      SUM(fv.firstVisitAt < CASE WHEN pc.periodKey='current' THEN :from ELSE :previousFrom END) returningGuests,
      SUM(fv.firstVisitAt BETWEEN CASE WHEN pc.periodKey='current' THEN :from ELSE :previousFrom END AND CASE WHEN pc.periodKey='current' THEN :to ELSE :previousTo END AND DATE_ADD(fv.firstVisitAt, INTERVAL 30 DAY) <= :now) repeatRate30EligibleGuests,
      SUM(fv.firstVisitAt BETWEEN CASE WHEN pc.periodKey='current' THEN :from ELSE :previousFrom END AND CASE WHEN pc.periodKey='current' THEN :to ELSE :previousTo END AND DATE_ADD(fv.firstVisitAt, INTERVAL 30 DAY) <= :now AND sv.secondVisitAt <= DATE_ADD(fv.firstVisitAt, INTERVAL 30 DAY)) repeatRate30RepeatedGuests
    FROM period_counts pc JOIN first_visits fv ON fv.canonicalUserId=pc.canonicalUserId
    LEFT JOIN second_visits sv ON sv.canonicalUserId=pc.canonicalUserId GROUP BY pc.periodKey`, {
    replacements: { from: period.fromSql, to: period.toSql, previousFrom: period.previousFromSql, previousTo: period.previousToSql, now: utcSql(now) },
    type: db.Sequelize.QueryTypes.SELECT,
  });
  const byKey = new Map(rows.map((row) => [row.periodKey, row]));
  const finalize = (key) => {
    const metric = metricFromRow(byKey.get(key));
    metric.repeatRate30 = metric.repeatRate30EligibleGuests ? metric.repeatRate30RepeatedGuests / metric.repeatRate30EligibleGuests * 100 : 0;
    return metric;
  };
  return { current: finalize('current'), previous: finalize('previous') };
}

async function queryDashboardAggregates(period) {
  const replacements = { from: period.fromSql, to: period.toSql };
  const base = `${CANONICAL_CLIENTS_CTE}`;
  const common = `FROM Visits v FORCE INDEX (idx_visits_visited_at) JOIN Users origin ON origin.id=v.userId JOIN canonical_clients cc ON cc.originUserId=v.userId JOIN Users root ON root.id=cc.canonicalUserId WHERE ${VALID_VISIT_SQL} AND v.visitedAt BETWEEN :from AND :to`;
  const [sources, categories, topGuests, heatRows] = await Promise.all([
    db.sequelize.query(`${base} SELECT COALESCE(NULLIF(root.source,''),'Не указан') name, COUNT(*) value ${common} GROUP BY root.source ORDER BY value DESC`, { replacements, type: db.Sequelize.QueryTypes.SELECT }),
    db.sequelize.query(`${base} SELECT COALESCE(NULLIF(v.category,''),'Не указана') category, COUNT(*) value ${common} GROUP BY v.category`, { replacements, type: db.Sequelize.QueryTypes.SELECT }),
    db.sequelize.query(`${base} SELECT root.name, root.phone, COUNT(*) visits ${common} GROUP BY cc.canonicalUserId,root.name,root.phone ORDER BY visits DESC LIMIT 10`, { replacements, type: db.Sequelize.QueryTypes.SELECT }),
    db.sequelize.query(`${base} SELECT WEEKDAY(CONVERT_TZ(v.visitedAt,'+00:00','${CLUB_UTC_OFFSET}'))+1 day,HOUR(CONVERT_TZ(v.visitedAt,'+00:00','${CLUB_UTC_OFFSET}')) hour,COUNT(*) value ${common} GROUP BY day,hour`, { replacements, type: db.Sequelize.QueryTypes.SELECT }),
  ]);
  const categoryMap = new Map();
  categories.forEach((row) => String(row.category).split(',').map((item) => item.trim()).filter(Boolean).forEach((item) => categoryMap.set(item, (categoryMap.get(item) || 0) + number(row.value))));
  const heatMap = Object.fromEntries(heatRows.map((row) => [`${row.day}-${row.hour}`, number(row.value)]));
  return {
    sources: sources.map((row) => ({ name: row.name, value: number(row.value) })),
    categories: [...categoryMap].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value),
    topGuests: topGuests.map((row) => ({ name: row.name, phone: row.phone, visits: number(row.visits) })), heatMap,
  };
}

async function getVisitsAnalytics(from, to, options = {}) {
  const now = options.now ? new Date(options.now) : new Date();
  const period = resolvePeriod(from, to, now);
  const [metricSets, aggregates] = await Promise.all([queryMetrics(period, now), queryDashboardAggregates(period)]);
  return { ...metricSets.current, previousPeriod: { from: period.previousFrom, to: period.previousTo, metrics: metricSets.previous }, changes: calculateChanges(metricSets.current, metricSets.previous), ...aggregates, timeZone: CLUB_TIME_ZONE };
}

function rateMetric(count, eligibleCount) {
  return { count: number(count), eligibleCount: number(eligibleCount), rate: number(eligibleCount) ? number(count) / number(eligibleCount) * 100 : null };
}

function sourceQualityFromRow(row) {
  const eligible90 = number(row.eligible90);
  return {
    sourceId: row.sourceId === null || row.sourceId === undefined ? null : number(row.sourceId),
    source: row.source || row.sourceName || 'Не указан',
    newClients: number(row.newClients),
    oneVisit30: rateMetric(row.oneVisit30, row.eligible30),
    repeat30: rateMetric(row.repeat30, row.eligible30),
    repeat60: rateMetric(row.repeat60, row.eligible60),
    repeat90: rateMetric(row.repeat90, eligible90),
    threePlus90: rateMetric(row.threePlus90, eligible90),
    averageVisits90: eligible90 ? number(row.visits90Total) / eligible90 : null,
    medianDaysToSecondVisit: row.medianDaysToSecondVisit === null || row.medianDaysToSecondVisit === undefined ? null : Number(row.medianDaysToSecondVisit),
    sampleSize: { eligible30: number(row.eligible30), eligible60: number(row.eligible60), eligible90 },
    lowSample: Math.max(number(row.eligible30), number(row.eligible60), eligible90) < 10,
  };
}

async function getSourceQuality(from, to, options = {}) {
  const now = options.now ? new Date(options.now) : new Date();
  const period = resolvePeriod(from, to, now);
  const sourceIds = (options.sourceIds || []).map(Number).filter(Number.isInteger);
  const rows = await db.sequelize.query(`${CANONICAL_CLIENTS_CTE},
    valid_visits AS (
      SELECT cc.canonicalUserId, v.visitedAt
      FROM Visits v FORCE INDEX (idx_visits_user_visited_at)
      JOIN Users origin ON origin.id=v.userId
      JOIN canonical_clients cc ON cc.originUserId=v.userId
      WHERE ${VALID_VISIT_SQL}
    ), ranked_visits AS (
      SELECT canonicalUserId, visitedAt,
        ROW_NUMBER() OVER (PARTITION BY canonicalUserId ORDER BY visitedAt, canonicalUserId) visitNumber,
        MIN(visitedAt) OVER (PARTITION BY canonicalUserId) firstVisitAt
      FROM valid_visits
    ), cohort AS (
      SELECT rv.canonicalUserId, MIN(rv.firstVisitAt) firstVisitAt,
        MIN(CASE WHEN rv.visitNumber=2 THEN rv.visitedAt END) secondVisitAt,
        SUM(rv.visitedAt <= DATE_ADD(rv.firstVisitAt, INTERVAL 90 DAY)) visits90
      FROM ranked_visits rv
      GROUP BY rv.canonicalUserId
      HAVING firstVisitAt BETWEEN :from AND :to
    ), cohort_metrics AS (
      SELECT c.*, root.sourceId,
        COALESCE(NULLIF(cs.name,''),NULLIF(root.source,''),'Не указан') sourceName,
        DATE_ADD(c.firstVisitAt,INTERVAL 30 DAY)<=:now eligible30,
        DATE_ADD(c.firstVisitAt,INTERVAL 60 DAY)<=:now eligible60,
        DATE_ADD(c.firstVisitAt,INTERVAL 90 DAY)<=:now eligible90,
        c.secondVisitAt<=DATE_ADD(c.firstVisitAt,INTERVAL 30 DAY) repeated30,
        c.secondVisitAt<=DATE_ADD(c.firstVisitAt,INTERVAL 60 DAY) repeated60,
        c.secondVisitAt<=DATE_ADD(c.firstVisitAt,INTERVAL 90 DAY) repeated90,
        TIMESTAMPDIFF(SECOND,c.firstVisitAt,c.secondVisitAt)/86400 daysToSecond
      FROM cohort c JOIN Users root ON root.id=c.canonicalUserId
      LEFT JOIN ClientSources cs ON cs.id=root.sourceId
      WHERE (:filterSources = 0 OR root.sourceId IN (:sourceIds))
    ), grouped AS (
      SELECT sourceId,sourceName,COUNT(*) newClients,
        SUM(eligible30) eligible30,SUM(eligible60) eligible60,SUM(eligible90) eligible90,
        SUM(eligible30 AND NOT COALESCE(repeated30,0)) oneVisit30,
        SUM(eligible30 AND repeated30) repeat30,SUM(eligible60 AND repeated60) repeat60,
        SUM(eligible90 AND repeated90) repeat90,SUM(eligible90 AND visits90>=3) threePlus90,
        SUM(CASE WHEN eligible90 THEN visits90 ELSE 0 END) visits90Total
      FROM cohort_metrics GROUP BY sourceId,sourceName
    ), second_ranked AS (
      SELECT sourceId,sourceName,daysToSecond,
        ROW_NUMBER() OVER(PARTITION BY sourceId,sourceName ORDER BY daysToSecond) rn,
        COUNT(*) OVER(PARTITION BY sourceId,sourceName) cnt
      FROM cohort_metrics WHERE secondVisitAt IS NOT NULL
    ), medians AS (
      SELECT sourceId,sourceName,AVG(daysToSecond) medianDaysToSecondVisit FROM second_ranked
      WHERE rn IN (FLOOR((cnt+1)/2),FLOOR((cnt+2)/2)) GROUP BY sourceId,sourceName
    )
    SELECT g.*,m.medianDaysToSecondVisit FROM grouped g LEFT JOIN medians m
      ON m.sourceId<=>g.sourceId AND m.sourceName=g.sourceName ORDER BY newClients DESC,sourceName`, {
    replacements: { from: period.fromSql, to: period.toSql, now: utcSql(now), filterSources: sourceIds.length ? 1 : 0, sourceIds: sourceIds.length ? sourceIds : [0] },
    type: db.Sequelize.QueryTypes.SELECT,
  });
  return { from: period.from, to: period.to, asOf: now, timeZone: CLUB_TIME_ZONE, sources: rows.map(sourceQualityFromRow) };
}

async function createSourceQualityExportBuffer(from, to, options = {}) {
  const analytics = await getSourceQuality(from, to, options);
  const rows = analytics.sources.map((item) => ({
    'Источник': item.source, 'Новых клиентов': item.newClients,
    'Один визит 30, кол-во': item.oneVisit30.count, 'Один визит 30, eligible': item.oneVisit30.eligibleCount, 'Один визит 30, %': item.oneVisit30.rate,
    'Вернулись 30, кол-во': item.repeat30.count, 'Вернулись 30, eligible': item.repeat30.eligibleCount, 'Вернулись 30, %': item.repeat30.rate,
    'Вернулись 60, кол-во': item.repeat60.count, 'Вернулись 60, eligible': item.repeat60.eligibleCount, 'Вернулись 60, %': item.repeat60.rate,
    'Вернулись 90, кол-во': item.repeat90.count, 'Вернулись 90, eligible': item.repeat90.eligibleCount, 'Вернулись 90, %': item.repeat90.rate,
    '3+ визита 90, кол-во': item.threePlus90.count, '3+ визита 90, eligible': item.threePlus90.eligibleCount, '3+ визита 90, %': item.threePlus90.rate,
    'Среднее визитов 90': item.averageVisits90, 'Медиана дней до 2-го': item.medianDaysToSecondVisit,
    'eligible30': item.sampleSize.eligible30, 'eligible60': item.sampleSize.eligible60, 'eligible90': item.sampleSize.eligible90,
  }));
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.json_to_sheet(rows);
  sheet['!cols'] = Object.keys(rows[0] || { 'Источник': '' }).map((key) => ({ wch: Math.max(14, Math.min(32, key.length + 2)) }));
  XLSX.utils.book_append_sheet(workbook, sheet, 'Качество источников');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
}

function formatClubDateTime(value) {
  return new Intl.DateTimeFormat('ru-RU', { timeZone: CLUB_TIME_ZONE, dateStyle: 'short', timeStyle: 'medium' }).format(new Date(value));
}

async function createVisitsExportBuffer(from, to, options = {}) {
  const now = options.now ? new Date(options.now) : new Date();
  const analytics = await getVisitsAnalytics(from, to, { now });
  const period = resolvePeriod(from, to, now);
  const visits = await db.sequelize.query(`${CANONICAL_CLIENTS_CTE}
    SELECT v.id,v.visitedAt,v.keyNumber,v.category,root.name,root.phone,COALESCE(NULLIF(root.source,''),'Не указан') source
    FROM Visits v FORCE INDEX (idx_visits_visited_at) JOIN Users origin ON origin.id=v.userId
    JOIN canonical_clients cc ON cc.originUserId=v.userId JOIN Users root ON root.id=cc.canonicalUserId
    WHERE ${VALID_VISIT_SQL} AND v.visitedAt BETWEEN :from AND :to ORDER BY v.visitedAt DESC`, { replacements: { from: period.fromSql, to: period.toSql }, type: db.Sequelize.QueryTypes.SELECT });
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ['Метрика', 'Текущий период', 'Предыдущий период'], ['Всего визитов', analytics.totalVisits, analytics.previousPeriod.metrics.totalVisits],
    ['Уникальные гости', analytics.uniqueGuests, analytics.previousPeriod.metrics.uniqueGuests], ['Новые гости', analytics.newGuests, analytics.previousPeriod.metrics.newGuests],
    ['Вернувшиеся гости', analytics.returningGuests, analytics.previousPeriod.metrics.returningGuests], ['Повторные визиты', analytics.repeatVisits, analytics.previousPeriod.metrics.repeatVisits],
    ['Среднее визитов на гостя', analytics.averageVisitsPerGuest, analytics.previousPeriod.metrics.averageVisitsPerGuest], ['Повторный визит за 30 дней, %', analytics.repeatRate30, analytics.previousPeriod.metrics.repeatRate30],
    ['Часовой пояс', CLUB_TIME_ZONE, CLUB_TIME_ZONE],
  ]), 'Сводка');
  const worksheet = XLSX.utils.json_to_sheet(visits.map((visit) => ({ 'ID визита': visit.id, 'Дата и Время': formatClubDateTime(visit.visitedAt), Гость: visit.name, Телефон: visit.phone, Источник: visit.source, 'Цель визита': visit.category || 'Не указана', 'Номер ключа': visit.keyNumber || '-' })));
  worksheet['!cols'] = [{ wch: 10 }, { wch: 22 }, { wch: 30 }, { wch: 15 }, { wch: 20 }, { wch: 25 }, { wch: 15 }];
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Визиты');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
}

async function explainPeriodIndex(from, to, options = {}) {
  const period = resolvePeriod(from, to, options.now ? new Date(options.now) : new Date());
  return db.sequelize.query(`EXPLAIN SELECT v.id FROM Visits v FORCE INDEX (idx_visits_visited_at)
    WHERE v.visitedAt BETWEEN :from AND :to AND COALESCE(v.isTraining,0)=0 AND v.duplicateOfVisitId IS NULL`, {
    replacements: { from: period.fromSql, to: period.toSql }, type: db.Sequelize.QueryTypes.SELECT,
  });
}

module.exports = { CANONICAL_CLIENTS_CTE, CLUB_TIME_ZONE, calculateChanges, createSourceQualityExportBuffer, createVisitsExportBuffer, explainPeriodIndex, formatClubDateTime, getSourceQuality, getVisitsAnalytics, metricFromRow, rateMetric, resolvePeriod, sourceQualityFromRow };
