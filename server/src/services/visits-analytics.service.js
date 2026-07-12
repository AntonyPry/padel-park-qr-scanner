const XLSX = require('xlsx');
const db = require('../../models');

const CLUB_TIME_ZONE = 'Europe/Moscow';
const CLUB_UTC_OFFSET = '+03:00';
const DAY_MS = 24 * 60 * 60 * 1000;
const SEGMENT_ALGORITHM_VERSION = 'visits_analytics_segment_v1';
const SEGMENT_CANONICAL_RULE = 'recursive_merged_root_v1';
const LIFECYCLE_STATUSES = [
  { key: 'new', label: 'Новый', formula: '1 визит за всю историю; первый и последний визит были не более 30 дней назад.' },
  { key: 'developing', label: 'Развивающийся', formula: '2–3 визита за всю историю; последний визит был не более 30 дней назад.' },
  { key: 'regular', label: 'Постоянный', formula: '4 и более визитов за всю историю; последний визит был не более 30 дней назад.' },
  { key: 'atRisk', label: 'Под риском', formula: 'Последний визит был более 30, но не более 60 дней назад.' },
  { key: 'sleeping', label: 'Спящий', formula: 'Последний визит был более 60, но не более 90 дней назад.' },
  { key: 'lost', label: 'Потерянный', formula: 'Последний визит был более 90 дней назад.' },
];

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

function analyticsDateTimeSql(value, { endOfDate = false } = {}) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) {
    return utcSql(clubDateToUtc(value, endOfDate));
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return utcSql(date);
}

function clubDateString(date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: CLUB_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function monthIndex(month) {
  const [year, value] = String(month).split('-').map(Number);
  return year * 12 + value - 1;
}

function monthFromIndex(index) {
  const year = Math.floor(index / 12);
  const month = index % 12;
  return `${year}-${String(month + 1).padStart(2, '0')}`;
}

function endOfMonthDate(month) {
  const [year, value] = String(month).split('-').map(Number);
  return `${year}-${String(value).padStart(2, '0')}-${String(new Date(Date.UTC(year, value, 0)).getUTCDate()).padStart(2, '0')}`;
}

function retentionMonthCountForAsOf(oldestCohort, asOfDate) {
  if (!oldestCohort) return 3;
  const asOfMonth = asOfDate.slice(0, 7);
  const lastCompletedMonth = monthIndex(asOfMonth) - (asOfDate === endOfMonthDate(asOfMonth) ? 0 : 1);
  return Math.max(3, lastCompletedMonth - monthIndex(oldestCohort));
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

async function queryMetrics(period, now, sourceFilter = { sql: '', replacements: {} }) {
  const rows = await db.sequelize.query(`${CANONICAL_CLIENTS_CTE},
    first_visits AS (
      SELECT cc.canonicalUserId, MIN(v.visitedAt) AS firstVisitAt
      FROM Visits v FORCE INDEX (idx_visits_user_visited_at)
      JOIN Users origin ON origin.id = v.userId
      JOIN canonical_clients cc ON cc.originUserId = v.userId
      JOIN Users root ON root.id=cc.canonicalUserId
      WHERE ${VALID_VISIT_SQL} ${sourceFilter.sql}
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
    replacements: { from: period.fromSql, to: period.toSql, previousFrom: period.previousFromSql, previousTo: period.previousToSql, now: utcSql(now), ...sourceFilter.replacements },
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

async function queryDashboardAggregates(period, sourceFilter = { sql: '', replacements: {} }) {
  const replacements = { from: period.fromSql, to: period.toSql, ...sourceFilter.replacements };
  const base = `${CANONICAL_CLIENTS_CTE}`;
  const common = `FROM Visits v FORCE INDEX (idx_visits_visited_at) JOIN Users origin ON origin.id=v.userId JOIN canonical_clients cc ON cc.originUserId=v.userId JOIN Users root ON root.id=cc.canonicalUserId WHERE ${VALID_VISIT_SQL} AND v.visitedAt BETWEEN :from AND :to ${sourceFilter.sql}`;
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
  const sourceFilter = buildSourceFilter(options.sourceKeys);
  const [metricSets, aggregates] = await Promise.all([queryMetrics(period, now, sourceFilter), queryDashboardAggregates(period, sourceFilter)]);
  return { ...metricSets.current, previousPeriod: { from: period.previousFrom, to: period.previousTo, metrics: metricSets.previous }, changes: calculateChanges(metricSets.current, metricSets.previous), ...aggregates, timeZone: CLUB_TIME_ZONE };
}

function rateMetric(count, eligibleCount) {
  const eligible = number(eligibleCount);
  return { count: number(count), eligibleCount: eligible, rate: eligible ? number(count) / eligible * 100 : null, lowSample: eligible > 0 && eligible < 10 };
}

function sourceKeyFromRow(row) {
  if (row.sourceId !== null && row.sourceId !== undefined) return `id:${number(row.sourceId)}`;
  const source = row.source || row.sourceName;
  if (!source || source === 'Не указан') return 'unspecified';
  return `legacy:${Buffer.from(String(source)).toString('base64url')}`;
}

function parseSourceKeys(sourceKeys) {
  const parsed = { sourceIds: [], legacySources: [], includeUnspecified: false };
  for (const key of sourceKeys || []) {
    if (/^id:\d+$/.test(key)) parsed.sourceIds.push(Number(key.slice(3)));
    else if (key === 'unspecified') parsed.includeUnspecified = true;
    else if (/^legacy:[A-Za-z0-9_-]+$/.test(key)) parsed.legacySources.push(Buffer.from(key.slice(7), 'base64url').toString());
  }
  return parsed;
}

function normalizeSourceKeys(sourceKeys) {
  const values = Array.isArray(sourceKeys) ? sourceKeys : [];
  return Array.from(new Set(values.map((value) => String(value || '').trim()).filter((value) => (
    /^id:\d+$/.test(value) || /^legacy:[A-Za-z0-9_-]+$/.test(value) || value === 'unspecified'
  ))));
}

function buildSourceFilter(sourceKeys, alias = 'root') {
  const hasSourceFilter = Array.isArray(sourceKeys);
  const parsedSources = parseSourceKeys(sourceKeys);
  const predicates = [];
  const replacements = {};
  if (parsedSources.sourceIds.length) {
    predicates.push(`${alias}.sourceId IN (:sourceIds)`);
    replacements.sourceIds = parsedSources.sourceIds;
  }
  if (parsedSources.legacySources.length) {
    predicates.push(`(${alias}.sourceId IS NULL AND ${alias}.source IN (:legacySources))`);
    replacements.legacySources = parsedSources.legacySources;
  }
  if (parsedSources.includeUnspecified) {
    predicates.push(`(${alias}.sourceId IS NULL AND (${alias}.source IS NULL OR ${alias}.source=''))`);
  }
  return {
    sql: hasSourceFilter ? `AND (${predicates.join(' OR ') || '1=0'})` : '',
    replacements,
  };
}

function sourceQualityFromRow(row) {
  const eligible90 = number(row.eligible90);
  return {
    sourceId: row.sourceId === null || row.sourceId === undefined ? null : number(row.sourceId),
    sourceKey: sourceKeyFromRow(row),
    source: row.source || row.sourceName || 'Не указан',
    newClients: number(row.newClients),
    actionableCount: number(row.actionableCount),
    oneVisit30: rateMetric(row.oneVisit30, row.eligible30),
    repeat30: rateMetric(row.repeat30, row.eligible30),
    repeat60: rateMetric(row.repeat60, row.eligible60),
    repeat90: rateMetric(row.repeat90, eligible90),
    threePlus90: rateMetric(row.threePlus90, eligible90),
    averageVisits90: eligible90 ? number(row.visits90Total) / eligible90 : null,
    averageVisits90EligibleCount: eligible90,
    medianDaysToSecondVisit: row.medianDaysToSecondVisit === null || row.medianDaysToSecondVisit === undefined ? null : Number(row.medianDaysToSecondVisit),
    sampleSize: { eligible30: number(row.eligible30), eligible60: number(row.eligible60), eligible90 },
  };
}

async function getSourceQuality(from, to, options = {}) {
  const now = options.now ? new Date(options.now) : new Date();
  const period = resolvePeriod(from, to, now);
  const sourceFilter = buildSourceFilter(options.sourceKeys);
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
      SELECT c.*, root.sourceId, root.status clientStatus,
        COALESCE(root.isTraining,0) rootIsTraining,
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
      WHERE 1=1 ${sourceFilter.sql}
    ), grouped AS (
      SELECT sourceId,sourceName,COUNT(*) newClients,
        SUM(clientStatus='active' AND NOT rootIsTraining) actionableCount,
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
    replacements: { from: period.fromSql, to: period.toSql, now: utcSql(now), ...sourceFilter.replacements },
    type: db.Sequelize.QueryTypes.SELECT,
  });
  return { from: period.from, to: period.to, asOf: now, timeZone: CLUB_TIME_ZONE, sources: rows.map(sourceQualityFromRow) };
}

function retentionMetric(count, cohortSize, cohortMonth, retentionMonth, asOfDate) {
  const targetMonth = monthFromIndex(monthIndex(cohortMonth) + retentionMonth);
  const windowEnd = endOfMonthDate(targetMonth);
  const isMature = windowEnd <= asOfDate;
  return {
    monthIndex: retentionMonth,
    count: isMature ? number(count) : null,
    eligibleCount: isMature ? number(cohortSize) : 0,
    rate: isMature && number(cohortSize) ? number(count) / number(cohortSize) * 100 : null,
    isMature,
    windowEnd,
  };
}

function cohortFromRows(row, retentionCounts, retentionMonths, asOfDate) {
  const cohortSize = number(row.cohortSize);
  return {
    cohortMonth: row.cohortMonth,
    cohortSize,
    actionableCount: number(row.actionableCount),
    repeat30: rateMetric(row.repeat30, row.eligible30),
    repeat60: rateMetric(row.repeat60, row.eligible60),
    repeat90: rateMetric(row.repeat90, row.eligible90),
    retention: retentionMonths.map((index) => retentionMetric(
      retentionCounts.get(`${row.cohortMonth}:${index}`), cohortSize, row.cohortMonth, index, asOfDate,
    )),
  };
}

function classifyLifecycleFacts({ firstVisitAt, lastVisitAt, visitCount }, asOf) {
  const first = new Date(firstVisitAt).getTime();
  const last = new Date(lastVisitAt).getTime();
  const boundary30 = asOf.getTime() - 30 * DAY_MS;
  const boundary60 = asOf.getTime() - 60 * DAY_MS;
  const boundary90 = asOf.getTime() - 90 * DAY_MS;
  if (last >= boundary30) {
    if (number(visitCount) === 1 && first >= boundary30) return 'new';
    if (number(visitCount) <= 3) return 'developing';
    return 'regular';
  }
  if (last >= boundary60) return 'atRisk';
  if (last >= boundary90) return 'sleeping';
  return 'lost';
}

function lifecycleStatusCase() {
  return `CASE
    WHEN visitCount=1 AND firstVisitAt>=DATE_SUB(:asOf,INTERVAL 30 DAY) AND lastVisitAt>=DATE_SUB(:asOf,INTERVAL 30 DAY) THEN 'new'
    WHEN visitCount BETWEEN 2 AND 3 AND lastVisitAt>=DATE_SUB(:asOf,INTERVAL 30 DAY) THEN 'developing'
    WHEN visitCount>=4 AND lastVisitAt>=DATE_SUB(:asOf,INTERVAL 30 DAY) THEN 'regular'
    WHEN lastVisitAt>=DATE_SUB(:asOf,INTERVAL 60 DAY) THEN 'atRisk'
    WHEN lastVisitAt>=DATE_SUB(:asOf,INTERVAL 90 DAY) THEN 'sleeping'
    ELSE 'lost' END`;
}

function cohortFactsCte(sourceFilterSql = '') {
  return `${CANONICAL_CLIENTS_CTE},
    valid_visits AS (
      SELECT cc.canonicalUserId,v.visitedAt
      FROM Visits v FORCE INDEX (idx_visits_user_visited_at)
      JOIN Users origin ON origin.id=v.userId
      JOIN canonical_clients cc ON cc.originUserId=v.userId
      WHERE ${VALID_VISIT_SQL} AND v.visitedAt<=:asOf
    ), ranked_visits AS (
      SELECT canonicalUserId,visitedAt,
        ROW_NUMBER() OVER(PARTITION BY canonicalUserId ORDER BY visitedAt,canonicalUserId) visitNumber,
        MIN(visitedAt) OVER(PARTITION BY canonicalUserId) firstVisitAt
      FROM valid_visits
    ), client_facts AS (
      SELECT canonicalUserId,MIN(firstVisitAt) firstVisitAt,
        MIN(CASE WHEN visitNumber=2 THEN visitedAt END) secondVisitAt,
        MAX(visitedAt) lastVisitAt,COUNT(*) visitCount
      FROM ranked_visits GROUP BY canonicalUserId
    ), cohort_clients AS (
      SELECT facts.*,root.status clientStatus,COALESCE(root.isTraining,0) rootIsTraining,
        DATE_FORMAT(CONVERT_TZ(facts.firstVisitAt,'+00:00','${CLUB_UTC_OFFSET}'),'%Y-%m') cohortMonth
      FROM client_facts facts JOIN Users root ON root.id=facts.canonicalUserId
      WHERE facts.firstVisitAt BETWEEN :from AND :to ${sourceFilterSql}
    )`;
}

async function queryCohorts(period, sourceFilter) {
  const replacements = {
    from: period.fromSql,
    to: period.toSql,
    asOf: period.toSql,
    ...sourceFilter.replacements,
  };
  const [summaryRows, retentionRows] = await Promise.all([
    db.sequelize.query(`${cohortFactsCte(sourceFilter.sql)}
      SELECT cohortMonth,COUNT(*) cohortSize,
        SUM(clientStatus='active' AND NOT rootIsTraining) actionableCount,
        SUM(DATE_ADD(firstVisitAt,INTERVAL 30 DAY)<=:asOf) eligible30,
        SUM(DATE_ADD(firstVisitAt,INTERVAL 60 DAY)<=:asOf) eligible60,
        SUM(DATE_ADD(firstVisitAt,INTERVAL 90 DAY)<=:asOf) eligible90,
        SUM(DATE_ADD(firstVisitAt,INTERVAL 30 DAY)<=:asOf AND secondVisitAt<=DATE_ADD(firstVisitAt,INTERVAL 30 DAY)) repeat30,
        SUM(DATE_ADD(firstVisitAt,INTERVAL 60 DAY)<=:asOf AND secondVisitAt<=DATE_ADD(firstVisitAt,INTERVAL 60 DAY)) repeat60,
        SUM(DATE_ADD(firstVisitAt,INTERVAL 90 DAY)<=:asOf AND secondVisitAt<=DATE_ADD(firstVisitAt,INTERVAL 90 DAY)) repeat90
      FROM cohort_clients GROUP BY cohortMonth ORDER BY cohortMonth`, {
      replacements,
      type: db.Sequelize.QueryTypes.SELECT,
    }),
    db.sequelize.query(`${cohortFactsCte(sourceFilter.sql)}
      SELECT cohort.cohortMonth,
        PERIOD_DIFF(DATE_FORMAT(CONVERT_TZ(visits.visitedAt,'+00:00','${CLUB_UTC_OFFSET}'),'%Y%m'),DATE_FORMAT(CONVERT_TZ(cohort.firstVisitAt,'+00:00','${CLUB_UTC_OFFSET}'),'%Y%m')) retentionMonth,
        COUNT(DISTINCT cohort.canonicalUserId) retainedClients
      FROM cohort_clients cohort JOIN valid_visits visits ON visits.canonicalUserId=cohort.canonicalUserId
      WHERE visits.visitedAt>cohort.firstVisitAt
      GROUP BY cohort.cohortMonth,retentionMonth HAVING retentionMonth>=1
      ORDER BY cohort.cohortMonth,retentionMonth`, {
      replacements,
      type: db.Sequelize.QueryTypes.SELECT,
    }),
  ]);
  return { summaryRows, retentionRows };
}

async function queryLifecycle(asOfSql, sourceFilter) {
  const rows = await db.sequelize.query(`${CANONICAL_CLIENTS_CTE},
    valid_visits AS (
      SELECT cc.canonicalUserId,v.visitedAt
      FROM Visits v FORCE INDEX (idx_visits_user_visited_at)
      JOIN Users origin ON origin.id=v.userId
      JOIN canonical_clients cc ON cc.originUserId=v.userId
      WHERE ${VALID_VISIT_SQL} AND v.visitedAt<=:asOf
    ), client_facts AS (
      SELECT canonicalUserId,MIN(visitedAt) firstVisitAt,MAX(visitedAt) lastVisitAt,COUNT(*) visitCount
      FROM valid_visits GROUP BY canonicalUserId
    ), classified AS (
      SELECT ${lifecycleStatusCase()} statusKey,root.status clientStatus,
        COALESCE(root.isTraining,0) rootIsTraining
      FROM client_facts JOIN Users root ON root.id=client_facts.canonicalUserId
      WHERE 1=1 ${sourceFilter.sql}
    )
    SELECT statusKey,COUNT(*) count,
      SUM(clientStatus='active' AND NOT rootIsTraining) actionableCount
    FROM classified GROUP BY statusKey`, {
    replacements: { asOf: asOfSql, ...sourceFilter.replacements },
    type: db.Sequelize.QueryTypes.SELECT,
  });
  return new Map(rows.map((row) => [row.statusKey, {
    actionableCount: number(row.actionableCount),
    count: number(row.count),
  }]));
}

async function queryAvailableSources(asOfSql) {
  const rows = await db.sequelize.query(`${CANONICAL_CLIENTS_CTE},
    visited_clients AS (
      SELECT DISTINCT cc.canonicalUserId FROM Visits v FORCE INDEX (idx_visits_user_visited_at)
      JOIN Users origin ON origin.id=v.userId JOIN canonical_clients cc ON cc.originUserId=v.userId
      WHERE ${VALID_VISIT_SQL} AND v.visitedAt<=:asOf
    )
    SELECT root.sourceId,COALESCE(NULLIF(cs.name,''),NULLIF(root.source,''),'Не указан') sourceName,
      COUNT(*) clientCount,
      SUM(root.status='active' AND NOT COALESCE(root.isTraining,0)) actionableCount
    FROM visited_clients clients JOIN Users root ON root.id=clients.canonicalUserId
    LEFT JOIN ClientSources cs ON cs.id=root.sourceId
    GROUP BY root.sourceId,sourceName ORDER BY clientCount DESC,sourceName`, {
    replacements: { asOf: asOfSql },
    type: db.Sequelize.QueryTypes.SELECT,
  });
  return rows.map((row) => ({
    sourceId: row.sourceId === null || row.sourceId === undefined ? null : number(row.sourceId),
    sourceKey: sourceKeyFromRow(row),
    source: row.sourceName || 'Не указан',
    clientCount: number(row.clientCount),
    actionableCount: number(row.actionableCount),
  }));
}

async function getCohortsLifecycle(from, to, options = {}) {
  const period = resolvePeriod(from, to, new Date());
  const sourceFilter = buildSourceFilter(options.sourceKeys);
  const asOfDate = clubDateString(period.to);
  const [cohortData, currentLifecycle, previousLifecycle, availableSources] = await Promise.all([
    queryCohorts(period, sourceFilter),
    queryLifecycle(period.toSql, sourceFilter),
    queryLifecycle(period.previousToSql, sourceFilter),
    queryAvailableSources(period.toSql),
  ]);
  const retentionCounts = new Map(cohortData.retentionRows.map((row) => [
    `${row.cohortMonth}:${number(row.retentionMonth)}`, number(row.retainedClients),
  ]));
  const oldestCohort = cohortData.summaryRows[0]?.cohortMonth;
  const retentionMonthCount = retentionMonthCountForAsOf(oldestCohort, asOfDate);
  const retentionMonths = Array.from({ length: retentionMonthCount }, (_, index) => index + 1);
  const currentTotal = [...currentLifecycle.values()].reduce((sum, value) => sum + value.count, 0);
  const previousTotal = [...previousLifecycle.values()].reduce((sum, value) => sum + value.count, 0);
  const currentActionableTotal = [...currentLifecycle.values()].reduce((sum, value) => sum + value.actionableCount, 0);
  const statuses = LIFECYCLE_STATUSES.map((status) => {
    const currentFacts = currentLifecycle.get(status.key) || { actionableCount: 0, count: 0 };
    const previousFacts = previousLifecycle.get(status.key) || { actionableCount: 0, count: 0 };
    const count = currentFacts.count;
    const previousCount = previousFacts.count;
    return {
      ...status,
      count,
      actionableCount: currentFacts.actionableCount,
      share: currentTotal ? count / currentTotal * 100 : 0,
      previousCount,
      change: {
        absolute: count - previousCount,
        percent: previousCount ? (count - previousCount) / previousCount * 100 : null,
      },
    };
  });
  return {
    from: period.from,
    to: period.to,
    asOf: period.to,
    timeZone: CLUB_TIME_ZONE,
    appliedSourceKeys: Array.isArray(options.sourceKeys) ? options.sourceKeys : [],
    availableSources,
    retentionMonths,
    cohorts: cohortData.summaryRows.map((row) => cohortFromRows(row, retentionCounts, retentionMonths, asOfDate)),
    lifecycle: {
      totalClassified: currentTotal,
      actionableTotal: currentActionableTotal,
      previousTotalClassified: previousTotal,
      previousPeriod: { from: period.previousFrom, to: period.previousTo, asOf: period.previousTo },
      statuses,
    },
  };
}

function normalizeVisitAnalyticsSegmentFilters(input = {}) {
  const sourceKeys = normalizeSourceKeys(input.sourceKeys);
  const lifecycleStatus = LIFECYCLE_STATUSES.some((status) => status.key === input.lifecycleStatus)
    ? input.lifecycleStatus
    : undefined;
  const dateOnly = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))
    ? String(value)
    : undefined;
  const month = /^\d{4}-\d{2}$/.test(String(input.firstVisitMonth || ''))
    ? String(input.firstVisitMonth)
    : undefined;
  const numberFilter = (value) => {
    if (value === undefined || value === null || value === '') return undefined;
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
  };
  const asOfSql = analyticsDateTimeSql(input.asOf, { endOfDate: true });
  if (!asOfSql) throw Object.assign(new Error('Некорректная дата среза аналитики'), { statusCode: 400 });

  const normalized = {
    algorithmVersion: SEGMENT_ALGORITHM_VERSION,
    asOf: new Date(`${asOfSql.replace(' ', 'T')}Z`).toISOString(),
    canonicalClientRule: SEGMENT_CANONICAL_RULE,
    clientStatus: 'active',
    excludeDuplicateVisits: true,
    excludeTraining: true,
    sourceKeys,
    timeZone: CLUB_TIME_ZONE,
  };
  const optional = {
    firstVisitFrom: dateOnly(input.firstVisitFrom),
    firstVisitMonth: month,
    firstVisitTo: dateOnly(input.firstVisitTo),
    lastVisitFrom: dateOnly(input.lastVisitFrom),
    lastVisitTo: dateOnly(input.lastVisitTo),
    lifecycleStatus,
    visitCountMax: numberFilter(input.visitCountMax),
    visitCountMin: numberFilter(input.visitCountMin),
  };
  Object.entries(optional).forEach(([key, value]) => {
    if (value !== undefined) normalized[key] = value;
  });
  if (normalized.visitCountMin !== undefined && normalized.visitCountMax !== undefined && normalized.visitCountMin > normalized.visitCountMax) {
    throw Object.assign(new Error('Минимальное количество визитов не может быть больше максимального'), { statusCode: 400 });
  }
  return normalized;
}

function buildSegmentCriteria(filters) {
  const having = [];
  const replacements = { asOf: analyticsDateTimeSql(filters.asOf) };
  if (filters.firstVisitMonth) {
    having.push(`DATE_FORMAT(CONVERT_TZ(firstVisitAt,'+00:00','${CLUB_UTC_OFFSET}'),'%Y-%m')=:firstVisitMonth`);
    replacements.firstVisitMonth = filters.firstVisitMonth;
  }
  if (filters.firstVisitFrom) {
    having.push('firstVisitAt>=:firstVisitFrom');
    replacements.firstVisitFrom = analyticsDateTimeSql(filters.firstVisitFrom);
  }
  if (filters.firstVisitTo) {
    having.push('firstVisitAt<=:firstVisitTo');
    replacements.firstVisitTo = analyticsDateTimeSql(filters.firstVisitTo, { endOfDate: true });
  }
  if (filters.lastVisitFrom) {
    having.push('lastVisitAt>=:lastVisitFrom');
    replacements.lastVisitFrom = analyticsDateTimeSql(filters.lastVisitFrom);
  }
  if (filters.lastVisitTo) {
    having.push('lastVisitAt<=:lastVisitTo');
    replacements.lastVisitTo = analyticsDateTimeSql(filters.lastVisitTo, { endOfDate: true });
  }
  if (filters.visitCountMin !== undefined) {
    having.push('visitCount>=:visitCountMin');
    replacements.visitCountMin = filters.visitCountMin;
  }
  if (filters.visitCountMax !== undefined) {
    having.push('visitCount<=:visitCountMax');
    replacements.visitCountMax = filters.visitCountMax;
  }
  if (filters.lifecycleStatus) {
    having.push(`${lifecycleStatusCase()}=:lifecycleStatus`);
    replacements.lifecycleStatus = filters.lifecycleStatus;
  }
  return { having, replacements };
}

function mapSegmentClient(row) {
  const visitCount = number(row.visitCount);
  return {
    ...row,
    segment: row.lifecycleStatus || (visitCount === 1 ? 'Новый' : visitCount >= 4 ? 'Постоянный' : 'Развивающийся'),
    stats: {
      firstVisitAt: row.firstVisitAt || null,
      lastVisitAt: row.lastVisitAt || null,
      visitCount,
    },
  };
}

async function queryVisitAnalyticsSegment(filtersInput, options = {}) {
  const filters = normalizeVisitAnalyticsSegmentFilters(filtersInput);
  const sourceFilter = buildSourceFilter(filters.sourceKeys.length ? filters.sourceKeys : undefined);
  const criteria = buildSegmentCriteria(filters);
  const where = [
    "root.status='active'",
    'COALESCE(root.isTraining,0)=0',
    ...criteria.having,
  ];
  const baseSql = `${CANONICAL_CLIENTS_CTE},
    valid_visits AS (
      SELECT cc.canonicalUserId,v.visitedAt
      FROM Visits v FORCE INDEX (idx_visits_user_visited_at)
      JOIN Users origin ON origin.id=v.userId
      JOIN canonical_clients cc ON cc.originUserId=v.userId
      WHERE ${VALID_VISIT_SQL} AND v.visitedAt<=:asOf
    ), client_facts AS (
      SELECT canonicalUserId,MIN(visitedAt) firstVisitAt,MAX(visitedAt) lastVisitAt,COUNT(*) visitCount
      FROM valid_visits GROUP BY canonicalUserId
    ), selected_clients AS (
      SELECT root.*,facts.firstVisitAt,facts.lastVisitAt,facts.visitCount,
        ${lifecycleStatusCase()} lifecycleStatus,
        COALESCE(NULLIF(cs.name,''),NULLIF(root.source,''),'Не указан') resolvedSource
      FROM client_facts facts
      JOIN Users root ON root.id=facts.canonicalUserId
      LEFT JOIN ClientSources cs ON cs.id=root.sourceId
      WHERE ${where.join(' AND ')} ${sourceFilter.sql}
    )`;
  const replacements = { ...criteria.replacements, ...sourceFilter.replacements };
  const countRows = await db.sequelize.query(`${baseSql} SELECT COUNT(*) total FROM selected_clients`, {
    replacements,
    type: db.Sequelize.QueryTypes.SELECT,
  });
  const total = number(countRows[0]?.total);
  if (options.countOnly) return { filters, total };
  const limit = Math.min(20000, Math.max(1, Number(options.limit) || 20));
  const offset = Math.max(0, Number(options.offset) || 0);
  const rows = await db.sequelize.query(`${baseSql}
    SELECT selected_clients.*,resolvedSource source FROM selected_clients
    ORDER BY lastVisitAt DESC,id DESC LIMIT :limit OFFSET :offset`, {
    replacements: { ...replacements, limit, offset },
    type: db.Sequelize.QueryTypes.SELECT,
  });
  return { filters, items: rows.map(mapSegmentClient), total };
}

async function countVisitAnalyticsSegmentClients(filters) {
  return (await queryVisitAnalyticsSegment(filters, { countOnly: true })).total;
}

async function listVisitAnalyticsSegmentClients(filters, options = {}) {
  return queryVisitAnalyticsSegment(filters, options);
}

function getLifecycleLabel(key) {
  return LIFECYCLE_STATUSES.find((status) => status.key === key)?.label || key;
}

async function previewVisitAnalyticsSegment(selection = {}) {
  const kind = ['source', 'lifecycle', 'cohort', 'filters'].includes(selection.kind)
    ? selection.kind
    : 'filters';
  const from = String(selection.from || '');
  const to = String(selection.to || '');
  if (!parseDateOnly(from) || !parseDateOnly(to)) {
    throw Object.assign(new Error('Выберите период аналитики'), { statusCode: 400 });
  }
  const asOf = selection.asOf || to;
  const sourceKeys = normalizeSourceKeys(selection.sourceKeys);
  if (kind === 'source' && sourceKeys.length !== 1) {
    throw Object.assign(new Error('Выберите один источник'), { statusCode: 400 });
  }
  if (kind === 'lifecycle' && !LIFECYCLE_STATUSES.some((status) => status.key === selection.lifecycleStatus)) {
    throw Object.assign(new Error('Выберите жизненный статус'), { statusCode: 400 });
  }
  if (kind === 'cohort' && !/^\d{4}-\d{2}$/.test(String(selection.cohortMonth || ''))) {
    throw Object.assign(new Error('Выберите когорту первого визита'), { statusCode: 400 });
  }
  const filters = normalizeVisitAnalyticsSegmentFilters({
    asOf,
    sourceKeys,
    firstVisitFrom: kind === 'source' ? from : undefined,
    firstVisitTo: kind === 'source' ? to : undefined,
    firstVisitMonth: kind === 'cohort' ? selection.cohortMonth : undefined,
    lifecycleStatus: kind === 'lifecycle' ? selection.lifecycleStatus : undefined,
  });
  const period = { from, to };
  const availableSources = await queryAvailableSources(analyticsDateTimeSql(filters.asOf));
  const sourceLabels = sourceKeys.map((key) => availableSources.find((source) => source.sourceKey === key)?.source || key);
  const count = await countVisitAnalyticsSegmentClients(filters);
  const criterion = kind === 'lifecycle'
    ? `Жизненный статус «${getLifecycleLabel(filters.lifecycleStatus)}»`
    : kind === 'cohort'
      ? `Когорта первого визита ${filters.firstVisitMonth}`
      : kind === 'source'
        ? `Первый визит в периоде ${from} — ${to}`
        : 'Все активные клиенты текущего аналитического среза';
  const sourceDescription = sourceLabels.length ? `Источники: ${sourceLabels.join(', ')}` : 'Все источники';
  const name = kind === 'lifecycle'
    ? `${getLifecycleLabel(filters.lifecycleStatus)} · ${to}`
    : kind === 'cohort'
      ? `Когорта ${filters.firstVisitMonth}`
      : kind === 'source'
        ? `${sourceLabels[0] || 'Источник'} · новые ${from}—${to}`
        : `Аналитика посещений · ${to}`;
  return {
    count,
    description: `${criterion}. ${sourceDescription}. Срез на ${to}.`,
    filters: { status: 'active', visitsAnalytics: filters },
    name,
    origin: 'visits_analytics',
    originMetadata: {
      algorithmVersion: SEGMENT_ALGORITHM_VERSION,
      asOf: filters.asOf,
      criteria: {
        kind,
        cohortMonth: filters.firstVisitMonth || null,
        lifecycleStatus: filters.lifecycleStatus || null,
      },
      period,
      sourceFilters: { keys: sourceKeys, labels: sourceLabels },
      timeZone: CLUB_TIME_ZONE,
    },
    period,
    sourceLabels,
    timeZone: CLUB_TIME_ZONE,
    asOf: filters.asOf,
  };
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
  const period = resolvePeriod(from, to, now);
  const sourceFilter = buildSourceFilter(options.sourceKeys);
  const [analytics, cohortsLifecycle] = await Promise.all([
    getVisitsAnalytics(from, to, { now, sourceKeys: options.sourceKeys }),
    getCohortsLifecycle(from, to, options),
  ]);
  const visits = await db.sequelize.query(`${CANONICAL_CLIENTS_CTE}
    SELECT v.id,v.visitedAt,v.keyNumber,v.category,root.name,root.phone,
      COALESCE(NULLIF(cs.name,''),NULLIF(root.source,''),'Не указан') source
    FROM Visits v FORCE INDEX (idx_visits_visited_at) JOIN Users origin ON origin.id=v.userId
    JOIN canonical_clients cc ON cc.originUserId=v.userId JOIN Users root ON root.id=cc.canonicalUserId
    LEFT JOIN ClientSources cs ON cs.id=root.sourceId
    WHERE ${VALID_VISIT_SQL} AND v.visitedAt BETWEEN :from AND :to ${sourceFilter.sql}
    ORDER BY v.visitedAt DESC`, {
    replacements: { from: period.fromSql, to: period.toSql, ...sourceFilter.replacements },
    type: db.Sequelize.QueryTypes.SELECT,
  });
  const appliedSources = Array.isArray(options.sourceKeys)
    ? cohortsLifecycle.availableSources
      .filter((source) => options.sourceKeys.includes(source.sourceKey))
      .map((source) => source.source)
      .join(', ') || 'Нет совпадений'
    : 'Все источники';
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ['Выбранный период', `${from || clubDateString(period.from)} — ${to || clubDateString(period.to)}`, ''],
    ['Дата среза', clubDateString(period.to), ''],
    ['Часовой пояс', CLUB_TIME_ZONE, CLUB_TIME_ZONE],
    ['Примененные источники', appliedSources, ''],
    [],
    ['Метрика', 'Текущий период', 'Предыдущий период'], ['Всего визитов', analytics.totalVisits, analytics.previousPeriod.metrics.totalVisits],
    ['Уникальные гости', analytics.uniqueGuests, analytics.previousPeriod.metrics.uniqueGuests], ['Новые гости', analytics.newGuests, analytics.previousPeriod.metrics.newGuests],
    ['Вернувшиеся гости', analytics.returningGuests, analytics.previousPeriod.metrics.returningGuests], ['Повторные визиты', analytics.repeatVisits, analytics.previousPeriod.metrics.repeatVisits],
    ['Среднее визитов на гостя', analytics.averageVisitsPerGuest, analytics.previousPeriod.metrics.averageVisitsPerGuest], ['Повторный визит за 30 дней, %', analytics.repeatRate30, analytics.previousPeriod.metrics.repeatRate30],
  ]), 'Сводка');
  const worksheet = XLSX.utils.json_to_sheet(visits.map((visit) => ({ 'ID визита': visit.id, 'Дата и Время': formatClubDateTime(visit.visitedAt), Гость: visit.name, Телефон: visit.phone, Источник: visit.source, 'Цель визита': visit.category || 'Не указана', 'Номер ключа': visit.keyNumber || '-' })));
  worksheet['!cols'] = [{ wch: 10 }, { wch: 22 }, { wch: 30 }, { wch: 15 }, { wch: 20 }, { wch: 25 }, { wch: 15 }];
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Визиты');
  const cohortRows = cohortsLifecycle.cohorts.map((cohort) => {
    const row = {
      'Месяц первого визита': cohort.cohortMonth,
      'Размер когорты': cohort.cohortSize,
    };
    for (const [label, metric] of [['30', cohort.repeat30], ['60', cohort.repeat60], ['90', cohort.repeat90]]) {
      row[`Повтор ${label}, числитель`] = metric.rate === null ? null : metric.count;
      row[`Повтор ${label}, знаменатель`] = metric.eligibleCount;
      row[`Повтор ${label}, %`] = metric.rate;
      row[`Повтор ${label}, окно`] = metric.rate === null ? 'Недостаточно времени' : 'Созрело';
    }
    for (const metric of cohort.retention) {
      row[`M${metric.monthIndex}, числитель`] = metric.count;
      row[`M${metric.monthIndex}, знаменатель`] = metric.eligibleCount;
      row[`M${metric.monthIndex}, %`] = metric.rate;
      row[`M${metric.monthIndex}, окно`] = metric.isMature ? `Созрело ${metric.windowEnd}` : `Недостаточно времени; созреет ${metric.windowEnd}`;
    }
    return row;
  });
  const cohortsSheet = XLSX.utils.json_to_sheet(cohortRows);
  cohortsSheet['!cols'] = Object.keys(cohortRows[0] || { 'Месяц первого визита': '' }).map((key) => ({ wch: Math.max(16, Math.min(34, key.length + 2)) }));
  XLSX.utils.book_append_sheet(workbook, cohortsSheet, 'Когорты');
  const lifecycleRows = cohortsLifecycle.lifecycle.statuses.map((status) => ({
    'Статус': status.label,
    'Количество клиентов': status.count,
    'Знаменатель (классифицированная база)': cohortsLifecycle.lifecycle.totalClassified,
    'Доля, %': status.share,
    'Количество в предыдущем срезе': status.previousCount,
    'Изменение, клиентов': status.change.absolute,
    'Изменение, %': status.change.percent,
    'Формула': status.formula,
  }));
  const lifecycleSheet = XLSX.utils.json_to_sheet(lifecycleRows);
  lifecycleSheet['!cols'] = [{ wch: 20 }, { wch: 22 }, { wch: 38 }, { wch: 14 }, { wch: 32 }, { wch: 22 }, { wch: 18 }, { wch: 80 }];
  XLSX.utils.book_append_sheet(workbook, lifecycleSheet, 'Жизненный цикл');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
}

async function explainPeriodIndex(from, to, options = {}) {
  const period = resolvePeriod(from, to, options.now ? new Date(options.now) : new Date());
  return db.sequelize.query(`EXPLAIN SELECT v.id FROM Visits v FORCE INDEX (idx_visits_visited_at)
    WHERE v.visitedAt BETWEEN :from AND :to AND COALESCE(v.isTraining,0)=0 AND v.duplicateOfVisitId IS NULL`, {
    replacements: { from: period.fromSql, to: period.toSql }, type: db.Sequelize.QueryTypes.SELECT,
  });
}

module.exports = { CANONICAL_CLIENTS_CTE, CLUB_TIME_ZONE, LIFECYCLE_STATUSES, SEGMENT_ALGORITHM_VERSION, buildSourceFilter, calculateChanges, classifyLifecycleFacts, cohortFromRows, countVisitAnalyticsSegmentClients, createSourceQualityExportBuffer, createVisitsExportBuffer, explainPeriodIndex, formatClubDateTime, getCohortsLifecycle, getSourceQuality, getVisitsAnalytics, listVisitAnalyticsSegmentClients, metricFromRow, normalizeVisitAnalyticsSegmentFilters, parseSourceKeys, previewVisitAnalyticsSegment, rateMetric, resolvePeriod, retentionMetric, retentionMonthCountForAsOf, sourceKeyFromRow, sourceQualityFromRow };
