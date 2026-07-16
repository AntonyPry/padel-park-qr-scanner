const XLSX = require('xlsx');
const db = require('../../models');
const {
  isTenantVisitsScannerEnabled,
} = require('../tenant-context/capabilities');
const {
  resolveVisitAccessContext,
} = require('./visit-access-context.service');

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

async function resolveAnalyticsVisitContext(options = {}) {
  if (options.visitContext) return options.visitContext;
  if (!isTenantVisitsScannerEnabled()) return null;
  return resolveVisitAccessContext(options.tenant || null);
}

function canonicalClientsCte(context) {
  if (!context) return CANONICAL_CLIENTS_CTE;
  return `
  WITH RECURSIVE client_chain AS (
    SELECT id AS originUserId, id AS currentUserId, mergedIntoUserId,
      CAST(CONCAT(',', id, ',') AS CHAR(2048)) AS path, 0 AS depth
    FROM Users
    WHERE organizationId = :visitOrganizationId
    UNION ALL
    SELECT chain.originUserId, parent.id, parent.mergedIntoUserId,
      CONCAT(chain.path, parent.id, ','), chain.depth + 1
    FROM client_chain chain
    JOIN Users parent
      ON parent.id = chain.mergedIntoUserId
     AND parent.organizationId = :visitOrganizationId
    WHERE chain.depth < 63
      AND LOCATE(CONCAT(',', parent.id, ','), chain.path) = 0
  ), canonical_clients AS (
    SELECT originUserId,
      COALESCE(MAX(CASE WHEN mergedIntoUserId IS NULL THEN currentUserId END), MIN(currentUserId)) AS canonicalUserId
    FROM client_chain
    GROUP BY originUserId
  )
`;
}

function visitScopeSql(context, alias = 'v') {
  return context
    ? ` AND ${alias}.organizationId = :visitOrganizationId AND ${alias}.clubId = :visitClubId`
    : '';
}

function visitScopeReplacements(context) {
  return context
    ? {
        visitClubId: context.clubId,
        visitOrganizationId: context.organizationId,
      }
    : {};
}

function visitIndex(context, legacyName, tenantName) {
  return context ? tenantName : legacyName;
}

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

async function queryMetrics(
  period,
  now,
  sourceFilter = { sql: '', replacements: {} },
  context = null,
) {
  const rows = await db.sequelize.query(`${canonicalClientsCte(context)},
    first_visits AS (
      SELECT cc.canonicalUserId, MIN(v.visitedAt) AS firstVisitAt
      FROM Visits v FORCE INDEX (${visitIndex(context, 'idx_visits_user_visited_at', 'idx_visits_tenant_user_visited')})
      JOIN Users origin ON origin.id = v.userId
      JOIN canonical_clients cc ON cc.originUserId = v.userId
      JOIN Users root ON root.id=cc.canonicalUserId
      WHERE ${VALID_VISIT_SQL}${visitScopeSql(context)} ${sourceFilter.sql}
      GROUP BY cc.canonicalUserId
    ), second_visits AS (
      SELECT cc.canonicalUserId, MIN(v.visitedAt) AS secondVisitAt
      FROM Visits v FORCE INDEX (${visitIndex(context, 'idx_visits_user_visited_at', 'idx_visits_tenant_user_visited')})
      JOIN Users origin ON origin.id = v.userId
      JOIN canonical_clients cc ON cc.originUserId = v.userId
      JOIN first_visits fv ON fv.canonicalUserId = cc.canonicalUserId AND v.visitedAt > fv.firstVisitAt
      WHERE ${VALID_VISIT_SQL}${visitScopeSql(context)}
      GROUP BY cc.canonicalUserId
    ), period_counts AS (
      SELECT 'current' AS periodKey, cc.canonicalUserId, COUNT(*) AS visits
      FROM Visits v FORCE INDEX (${visitIndex(context, 'idx_visits_visited_at', 'idx_visits_tenant_visited')})
      JOIN Users origin ON origin.id = v.userId JOIN canonical_clients cc ON cc.originUserId = v.userId
      WHERE ${VALID_VISIT_SQL}${visitScopeSql(context)} AND v.visitedAt BETWEEN :from AND :to GROUP BY cc.canonicalUserId
      UNION ALL
      SELECT 'previous', cc.canonicalUserId, COUNT(*)
      FROM Visits v FORCE INDEX (${visitIndex(context, 'idx_visits_visited_at', 'idx_visits_tenant_visited')})
      JOIN Users origin ON origin.id = v.userId JOIN canonical_clients cc ON cc.originUserId = v.userId
      WHERE ${VALID_VISIT_SQL}${visitScopeSql(context)} AND v.visitedAt BETWEEN :previousFrom AND :previousTo GROUP BY cc.canonicalUserId
    )
    SELECT pc.periodKey, SUM(pc.visits) totalVisits, COUNT(*) uniqueGuests,
      SUM(fv.firstVisitAt BETWEEN CASE WHEN pc.periodKey='current' THEN :from ELSE :previousFrom END AND CASE WHEN pc.periodKey='current' THEN :to ELSE :previousTo END) newGuests,
      SUM(fv.firstVisitAt < CASE WHEN pc.periodKey='current' THEN :from ELSE :previousFrom END) returningGuests,
      SUM(fv.firstVisitAt BETWEEN CASE WHEN pc.periodKey='current' THEN :from ELSE :previousFrom END AND CASE WHEN pc.periodKey='current' THEN :to ELSE :previousTo END AND DATE_ADD(fv.firstVisitAt, INTERVAL 30 DAY) <= :now) repeatRate30EligibleGuests,
      SUM(fv.firstVisitAt BETWEEN CASE WHEN pc.periodKey='current' THEN :from ELSE :previousFrom END AND CASE WHEN pc.periodKey='current' THEN :to ELSE :previousTo END AND DATE_ADD(fv.firstVisitAt, INTERVAL 30 DAY) <= :now AND sv.secondVisitAt <= DATE_ADD(fv.firstVisitAt, INTERVAL 30 DAY)) repeatRate30RepeatedGuests
    FROM period_counts pc JOIN first_visits fv ON fv.canonicalUserId=pc.canonicalUserId
    LEFT JOIN second_visits sv ON sv.canonicalUserId=pc.canonicalUserId GROUP BY pc.periodKey`, {
    replacements: { from: period.fromSql, to: period.toSql, previousFrom: period.previousFromSql, previousTo: period.previousToSql, now: utcSql(now), ...sourceFilter.replacements, ...visitScopeReplacements(context) },
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

async function queryDashboardAggregates(
  period,
  sourceFilter = { sql: '', replacements: {} },
  context = null,
) {
  const replacements = { from: period.fromSql, to: period.toSql, ...sourceFilter.replacements, ...visitScopeReplacements(context) };
  const base = `${canonicalClientsCte(context)}`;
  const common = `FROM Visits v FORCE INDEX (${visitIndex(context, 'idx_visits_visited_at', 'idx_visits_tenant_visited')}) JOIN Users origin ON origin.id=v.userId JOIN canonical_clients cc ON cc.originUserId=v.userId JOIN Users root ON root.id=cc.canonicalUserId WHERE ${VALID_VISIT_SQL}${visitScopeSql(context)} AND v.visitedAt BETWEEN :from AND :to ${sourceFilter.sql}`;
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
  const context = await resolveAnalyticsVisitContext(options);
  const now = options.now ? new Date(options.now) : new Date();
  const period = resolvePeriod(from, to, now);
  const sourceFilter = buildSourceFilter(options.sourceKeys);
  const [metricSets, aggregates] = await Promise.all([queryMetrics(period, now, sourceFilter, context), queryDashboardAggregates(period, sourceFilter, context)]);
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
  const context = await resolveAnalyticsVisitContext(options);
  const now = options.now ? new Date(options.now) : new Date();
  const period = resolvePeriod(from, to, now);
  const sourceFilter = buildSourceFilter(options.sourceKeys);
  const rows = await db.sequelize.query(`${canonicalClientsCte(context)},
    valid_visits AS (
      SELECT cc.canonicalUserId, v.visitedAt
      FROM Visits v FORCE INDEX (${visitIndex(context, 'idx_visits_user_visited_at', 'idx_visits_tenant_user_visited')})
      JOIN Users origin ON origin.id=v.userId
      JOIN canonical_clients cc ON cc.originUserId=v.userId
      WHERE ${VALID_VISIT_SQL}${visitScopeSql(context)}
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
    replacements: { from: period.fromSql, to: period.toSql, now: utcSql(now), ...sourceFilter.replacements, ...visitScopeReplacements(context) },
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

function ltvMetric(revenue, eligibleCount) {
  const eligible = number(eligibleCount);
  const amount = number(revenue);
  return {
    eligibleCount: eligible,
    lowSample: eligible > 0 && eligible < 10,
    revenue: amount,
    value: eligible ? amount / eligible : null,
  };
}

function revenueAttributionCte(sourceFilterSql = '', context = null) {
  return `${canonicalClientsCte(context)},
    valid_visits AS (
      SELECT cc.canonicalUserId,v.visitedAt
      FROM Visits v FORCE INDEX (${visitIndex(context, 'idx_visits_user_visited_at', 'idx_visits_tenant_user_visited')})
      JOIN Users origin ON origin.id=v.userId
      JOIN canonical_clients cc ON cc.originUserId=v.userId
      WHERE ${VALID_VISIT_SQL}${visitScopeSql(context)} AND v.visitedAt<=:asOf
    ), client_facts AS (
      SELECT canonicalUserId,MIN(visitedAt) firstVisitAt
      FROM valid_visits GROUP BY canonicalUserId
    ), cohort_clients AS (
      SELECT facts.canonicalUserId,facts.firstVisitAt,root.sourceId,
        COALESCE(NULLIF(cs.name,''),NULLIF(root.source,''),'Не указан') sourceName,
        DATE_FORMAT(CONVERT_TZ(facts.firstVisitAt,'+00:00','${CLUB_UTC_OFFSET}'),'%Y-%m') cohortMonth
      FROM client_facts facts
      JOIN Users root ON root.id=facts.canonicalUserId
      LEFT JOIN ClientSources cs ON cs.id=root.sourceId
      WHERE facts.firstVisitAt BETWEEN :from AND :to
        AND COALESCE(root.isTraining,0)=0 ${sourceFilterSql}
    ), receipt_item_candidates AS (
      SELECT ps.receiptItemId,ps.clientId
      FROM PendingSales ps
      WHERE ps.clientId IS NOT NULL AND ps.status='linked'
      UNION ALL
      SELECT subscriptions.sourceReceiptItemId,subscriptions.clientId
      FROM ClientSubscriptions subscriptions
      WHERE subscriptions.sourceReceiptItemId IS NOT NULL
        AND subscriptions.status<>'canceled'
      UNION ALL
      SELECT certificates.sourceReceiptItemId,certificates.clientId
      FROM Certificates certificates
      WHERE certificates.sourceReceiptItemId IS NOT NULL
        AND certificates.status<>'canceled'
        AND certificates.source<>'legacy_stn_google_sheet'
    ), receipt_item_candidate_roots AS (
      SELECT candidates.receiptItemId,cc.canonicalUserId
      FROM receipt_item_candidates candidates
      JOIN Users origin ON origin.id=candidates.clientId
      JOIN canonical_clients cc ON cc.originUserId=candidates.clientId
      JOIN Users root ON root.id=cc.canonicalUserId
      WHERE COALESCE(origin.isTraining,0)=0 AND COALESCE(root.isTraining,0)=0
    ), receipt_item_links AS (
      SELECT receiptItemId,COUNT(DISTINCT canonicalUserId) candidateCount,
        MIN(canonicalUserId) canonicalUserId
      FROM receipt_item_candidate_roots GROUP BY receiptItemId
    ), receipt_events AS (
      SELECT CONCAT('receipt:',items.id) eventKey,receipts.id receiptId,
        receipts.type receiptType,receipts.dateTime eventDate,
        CASE WHEN receipts.type='PAYBACK' THEN -ABS(CASE WHEN COALESCE(items.sumPrice,0)<>0 THEN items.sumPrice ELSE items.sum END)
          ELSE ABS(CASE WHEN COALESCE(items.sumPrice,0)<>0 THEN items.sumPrice ELSE items.sum END) END amount,
        COALESCE(links.candidateCount,0) candidateCount,links.canonicalUserId,
        'receipt_item' eventSource
      FROM ReceiptItems items
      JOIN Receipts receipts ON receipts.id=items.receiptId
      LEFT JOIN receipt_item_links links ON links.receiptItemId=items.id
      WHERE receipts.dateTime<=:asOf
    ), manual_subscription_events AS (
      SELECT CONCAT('subscription:',subscriptions.id) eventKey,subscriptions.startsAt eventDate,
        subscriptions.saleAmount amount,1 candidateCount,cc.canonicalUserId,
        'manual_subscription' eventSource
      FROM ClientSubscriptions subscriptions
      JOIN Users origin ON origin.id=subscriptions.clientId
      JOIN canonical_clients cc ON cc.originUserId=subscriptions.clientId
      JOIN Users root ON root.id=cc.canonicalUserId
      WHERE subscriptions.sourceReceiptItemId IS NULL
        AND subscriptions.sourceReceiptId IS NULL
        AND subscriptions.pendingSaleId IS NULL
        AND subscriptions.status<>'canceled'
        AND subscriptions.startsAt<=:asOf
        AND COALESCE(subscriptions.saleAmount,0)<>0
        AND COALESCE(origin.isTraining,0)=0 AND COALESCE(root.isTraining,0)=0
    ), manual_certificate_events AS (
      SELECT CONCAT('certificate:',certificates.id) eventKey,certificates.startsAt eventDate,
        certificates.saleAmount amount,1 candidateCount,cc.canonicalUserId,
        'manual_certificate' eventSource
      FROM Certificates certificates
      JOIN Users origin ON origin.id=certificates.clientId
      JOIN canonical_clients cc ON cc.originUserId=certificates.clientId
      JOIN Users root ON root.id=cc.canonicalUserId
      WHERE certificates.sourceReceiptItemId IS NULL
        AND certificates.sourceReceiptId IS NULL
        AND certificates.pendingSaleId IS NULL
        AND certificates.status<>'canceled'
        AND certificates.source<>'legacy_stn_google_sheet'
        AND certificates.startsAt<=:asOf
        AND COALESCE(certificates.saleAmount,0)<>0
        AND COALESCE(origin.isTraining,0)=0 AND COALESCE(root.isTraining,0)=0
    ), attributed_events AS (
      SELECT eventKey,eventDate,amount,canonicalUserId,eventSource
      FROM receipt_events WHERE candidateCount=1
      UNION ALL
      SELECT eventKey,eventDate,amount,canonicalUserId,eventSource FROM manual_subscription_events
      UNION ALL
      SELECT eventKey,eventDate,amount,canonicalUserId,eventSource FROM manual_certificate_events
    )`;
}

function sourceRevenueFromRow(row) {
  const acquiredClients = number(row.acquiredClients);
  const payingClients = number(row.payingClients);
  return {
    sourceId: row.sourceId === null || row.sourceId === undefined ? null : number(row.sourceId),
    sourceKey: sourceKeyFromRow({ sourceId: row.sourceId, sourceName: row.sourceName }),
    source: row.sourceName || 'Не указан',
    acquiredClients,
    payingClients,
    payerConversion: acquiredClients ? payingClients / acquiredClients * 100 : null,
    attributedRevenue: number(row.attributedRevenue),
    averageRevenuePerAcquiredClient: acquiredClients ? number(row.attributedRevenue) / acquiredClients : null,
    averageRevenuePerPayingClient: payingClients ? number(row.attributedRevenue) / payingClients : null,
    ltv30: ltvMetric(row.revenue30, row.mature30),
    ltv60: ltvMetric(row.revenue60, row.mature60),
    ltv90: ltvMetric(row.revenue90, row.mature90),
    lifetimeLtv: ltvMetric(row.attributedRevenue, acquiredClients),
    matureSample: {
      days30: number(row.mature30),
      days60: number(row.mature60),
      days90: number(row.mature90),
    },
  };
}

async function queryRevenueBySource(period, sourceFilter, context = null) {
  const rows = await db.sequelize.query(`${revenueAttributionCte(sourceFilter.sql, context)},
    client_revenue AS (
      SELECT cohort.canonicalUserId,cohort.sourceId,cohort.sourceName,cohort.firstVisitAt,
        SUM(CASE WHEN events.eventDate>=cohort.firstVisitAt AND events.eventDate<=:asOf THEN events.amount ELSE 0 END) lifetimeRevenue,
        SUM(CASE WHEN events.eventDate>=cohort.firstVisitAt AND events.eventDate<=DATE_ADD(cohort.firstVisitAt,INTERVAL 30 DAY) THEN events.amount ELSE 0 END) revenue30,
        SUM(CASE WHEN events.eventDate>=cohort.firstVisitAt AND events.eventDate<=DATE_ADD(cohort.firstVisitAt,INTERVAL 60 DAY) THEN events.amount ELSE 0 END) revenue60,
        SUM(CASE WHEN events.eventDate>=cohort.firstVisitAt AND events.eventDate<=DATE_ADD(cohort.firstVisitAt,INTERVAL 90 DAY) THEN events.amount ELSE 0 END) revenue90,
        SUM(events.eventDate>=cohort.firstVisitAt AND events.eventDate<=:asOf AND events.amount>0) positiveEvents
      FROM cohort_clients cohort
      LEFT JOIN attributed_events events ON events.canonicalUserId=cohort.canonicalUserId
      GROUP BY cohort.canonicalUserId,cohort.sourceId,cohort.sourceName,cohort.firstVisitAt
    )
    SELECT sourceId,sourceName,COUNT(*) acquiredClients,SUM(positiveEvents>0) payingClients,
      SUM(lifetimeRevenue) attributedRevenue,
      SUM(DATE_ADD(firstVisitAt,INTERVAL 30 DAY)<=:asOf) mature30,
      SUM(CASE WHEN DATE_ADD(firstVisitAt,INTERVAL 30 DAY)<=:asOf THEN revenue30 ELSE 0 END) revenue30,
      SUM(DATE_ADD(firstVisitAt,INTERVAL 60 DAY)<=:asOf) mature60,
      SUM(CASE WHEN DATE_ADD(firstVisitAt,INTERVAL 60 DAY)<=:asOf THEN revenue60 ELSE 0 END) revenue60,
      SUM(DATE_ADD(firstVisitAt,INTERVAL 90 DAY)<=:asOf) mature90,
      SUM(CASE WHEN DATE_ADD(firstVisitAt,INTERVAL 90 DAY)<=:asOf THEN revenue90 ELSE 0 END) revenue90
    FROM client_revenue GROUP BY sourceId,sourceName ORDER BY attributedRevenue DESC,sourceName`, {
    replacements: {
      asOf: period.toSql,
      from: period.fromSql,
      to: period.toSql,
      ...sourceFilter.replacements,
      ...visitScopeReplacements(context),
    },
    type: db.Sequelize.QueryTypes.SELECT,
  });
  return rows.map(sourceRevenueFromRow);
}

async function queryRevenueCohorts(period, sourceFilter, context = null) {
  return db.sequelize.query(`${revenueAttributionCte(sourceFilter.sql, context)},
    cohort_sizes AS (
      SELECT cohortMonth,COUNT(*) cohortSize FROM cohort_clients GROUP BY cohortMonth
    ), cohort_month_revenue AS (
      SELECT cohort.cohortMonth,
        PERIOD_DIFF(DATE_FORMAT(CONVERT_TZ(events.eventDate,'+00:00','${CLUB_UTC_OFFSET}'),'%Y%m'),
          DATE_FORMAT(CONVERT_TZ(cohort.firstVisitAt,'+00:00','${CLUB_UTC_OFFSET}'),'%Y%m')) revenueMonth,
        SUM(events.amount) revenue
      FROM cohort_clients cohort
      JOIN attributed_events events ON events.canonicalUserId=cohort.canonicalUserId
        AND events.eventDate>=cohort.firstVisitAt AND events.eventDate<=:asOf
      GROUP BY cohort.cohortMonth,revenueMonth HAVING revenueMonth>=0
    )
    SELECT sizes.cohortMonth,sizes.cohortSize,revenue.revenueMonth,revenue.revenue
    FROM cohort_sizes sizes LEFT JOIN cohort_month_revenue revenue ON revenue.cohortMonth=sizes.cohortMonth
    ORDER BY sizes.cohortMonth,revenue.revenueMonth`, {
    replacements: {
      asOf: period.toSql,
      from: period.fromSql,
      to: period.toSql,
      ...sourceFilter.replacements,
      ...visitScopeReplacements(context),
    },
    type: db.Sequelize.QueryTypes.SELECT,
  });
}

function buildRevenueCohorts(rows, asOfDate) {
  const cohortMonths = Array.from(new Set(rows.map((row) => row.cohortMonth).filter(Boolean)));
  if (!cohortMonths.length) return { months: [0, 1, 2, 3], rows: [] };
  const asOfMonth = asOfDate.slice(0, 7);
  const lastCompletedMonth = monthIndex(asOfMonth) - (asOfDate === endOfMonthDate(asOfMonth) ? 0 : 1);
  const maximumMonth = Math.max(3, lastCompletedMonth - monthIndex(cohortMonths[0]));
  const months = Array.from({ length: maximumMonth + 1 }, (_, index) => index);
  const revenueByCohort = new Map();
  for (const row of rows) {
    const key = row.cohortMonth;
    if (!revenueByCohort.has(key)) revenueByCohort.set(key, new Map());
    if (row.revenueMonth !== null && row.revenueMonth !== undefined) {
      revenueByCohort.get(key).set(number(row.revenueMonth), number(row.revenue));
    }
  }
  return {
    months,
    rows: cohortMonths.map((cohortMonth) => {
      const firstRow = rows.find((row) => row.cohortMonth === cohortMonth);
      const cohortSize = number(firstRow?.cohortSize);
      let cumulativeRevenue = 0;
      const values = months.map((index) => {
        cumulativeRevenue += number(revenueByCohort.get(cohortMonth)?.get(index));
        const targetMonth = monthFromIndex(monthIndex(cohortMonth) + index);
        const windowEnd = endOfMonthDate(targetMonth);
        const isMature = windowEnd <= asOfDate;
        return {
          isMature,
          monthIndex: index,
          revenue: isMature ? cumulativeRevenue : null,
          value: isMature && cohortSize ? cumulativeRevenue / cohortSize : null,
          windowEnd,
        };
      });
      return { cohortMonth, cohortSize, values };
    }),
  };
}

async function queryRevenueCoverage(period, sourceFilter, context = null) {
  const rows = await db.sequelize.query(`${revenueAttributionCte('', context)}
    SELECT
      (SELECT COALESCE(SUM(CASE WHEN type='PAYBACK' THEN -ABS(totalAmount) ELSE ABS(totalAmount) END),0)
        FROM Receipts WHERE dateTime BETWEEN :from AND :to) cashNetRevenue,
      (SELECT COALESCE(SUM(ABS(totalAmount)),0)
        FROM Receipts WHERE dateTime BETWEEN :from AND :to) cashMovementAmount,
      (SELECT COUNT(*) FROM Receipts WHERE type='PAYBACK' AND dateTime BETWEEN :from AND :to) paybackCount,
      (SELECT COALESCE(SUM(events.amount),0) FROM receipt_events events
        JOIN Users root ON root.id=events.canonicalUserId
        WHERE events.candidateCount=1 AND events.eventDate BETWEEN :from AND :to ${sourceFilter.sql}) attributedCashRevenue,
      (SELECT COALESCE(SUM(ABS(events.amount)),0) FROM receipt_events events
        JOIN Users root ON root.id=events.canonicalUserId
        WHERE events.candidateCount=1 AND events.eventDate BETWEEN :from AND :to ${sourceFilter.sql}) attributedCashMovementAmount,
      (SELECT COALESCE(SUM(events.amount),0) FROM receipt_events events
        WHERE events.candidateCount=1 AND events.eventDate BETWEEN :from AND :to) allAttributedCashRevenue,
      (SELECT COALESCE(SUM(ABS(events.amount)),0) FROM receipt_events events
        WHERE events.candidateCount=1 AND events.eventDate BETWEEN :from AND :to) allAttributedCashMovementAmount,
      (SELECT COALESCE(SUM(events.amount),0) FROM receipt_events events
        WHERE events.eventDate BETWEEN :from AND :to) receiptItemsNetRevenue,
      (SELECT COALESCE(SUM(ABS(events.amount)),0) FROM receipt_events events
        WHERE events.candidateCount=0 AND events.eventDate BETWEEN :from AND :to) unknownClientAmount,
      (SELECT COALESCE(SUM(ABS(events.amount)),0) FROM receipt_events events
        WHERE events.candidateCount>1 AND events.eventDate BETWEEN :from AND :to) ambiguousClientAmount,
      (SELECT COUNT(DISTINCT events.receiptId) FROM receipt_events events
        WHERE events.receiptType='PAYBACK' AND events.candidateCount<>1
          AND events.eventDate BETWEEN :from AND :to) unlinkedPaybackCount,
      (SELECT COALESCE(SUM(ABS(events.amount)),0) FROM receipt_events events
        WHERE events.receiptType='PAYBACK' AND events.candidateCount<>1
          AND events.eventDate BETWEEN :from AND :to) unlinkedPaybackAmount,
      (SELECT COALESCE(SUM(events.amount),0) FROM attributed_events events
        JOIN Users root ON root.id=events.canonicalUserId
        WHERE events.eventDate BETWEEN :from AND :to ${sourceFilter.sql}) periodAttributedRevenue,
      (SELECT COALESCE(SUM(subscriptions.saleAmount),0) FROM ClientSubscriptions subscriptions
        JOIN Users subscription_origin ON subscription_origin.id=subscriptions.clientId
        JOIN canonical_clients subscription_clients ON subscription_clients.originUserId=subscriptions.clientId
        JOIN Users root ON root.id=subscription_clients.canonicalUserId
        WHERE (subscriptions.sourceReceiptItemId IS NOT NULL OR subscriptions.sourceReceiptId IS NOT NULL OR subscriptions.pendingSaleId IS NOT NULL)
          AND subscriptions.status<>'canceled'
          AND subscriptions.startsAt BETWEEN :from AND :to
          AND COALESCE(subscription_origin.isTraining,0)=0 AND COALESCE(root.isTraining,0)=0 ${sourceFilter.sql}) subscriptionReceiptDuplicateRisk,
      (SELECT COALESCE(SUM(certificates.saleAmount),0) FROM Certificates certificates
        JOIN Users certificate_origin ON certificate_origin.id=certificates.clientId
        JOIN canonical_clients certificate_clients ON certificate_clients.originUserId=certificates.clientId
        JOIN Users root ON root.id=certificate_clients.canonicalUserId
        WHERE (certificates.sourceReceiptItemId IS NOT NULL OR certificates.sourceReceiptId IS NOT NULL OR certificates.pendingSaleId IS NOT NULL)
          AND certificates.status<>'canceled'
          AND certificates.startsAt BETWEEN :from AND :to
          AND COALESCE(certificate_origin.isTraining,0)=0 AND COALESCE(root.isTraining,0)=0 ${sourceFilter.sql}) certificateReceiptDuplicateRisk,
      (SELECT COUNT(*) FROM Certificates certificates
        JOIN Users legacy_origin ON legacy_origin.id=certificates.clientId
        JOIN canonical_clients legacy_clients ON legacy_clients.originUserId=certificates.clientId
        JOIN Users root ON root.id=legacy_clients.canonicalUserId
        WHERE certificates.source='legacy_stn_google_sheet'
          AND certificates.status<>'canceled'
          AND COALESCE(legacy_origin.isTraining,0)=0 AND COALESCE(root.isTraining,0)=0 ${sourceFilter.sql}) legacySalesCount,
      (SELECT COALESCE(SUM(ABS(certificates.saleAmount)),0) FROM Certificates certificates
        JOIN Users legacy_origin ON legacy_origin.id=certificates.clientId
        JOIN canonical_clients legacy_clients ON legacy_clients.originUserId=certificates.clientId
        JOIN Users root ON root.id=legacy_clients.canonicalUserId
        WHERE certificates.source='legacy_stn_google_sheet'
          AND certificates.status<>'canceled'
          AND COALESCE(legacy_origin.isTraining,0)=0 AND COALESCE(root.isTraining,0)=0 ${sourceFilter.sql}) legacySalesAmount,
      (SELECT COALESCE(SUM(bookings.paidAmount),0) FROM Bookings bookings
        JOIN canonical_clients booking_clients ON booking_clients.originUserId=bookings.userId
        JOIN Users root ON root.id=booking_clients.canonicalUserId
        WHERE bookings.startsAt BETWEEN :from AND :to AND bookings.status<>'canceled'
          AND COALESCE(bookings.isTraining,0)=0 AND COALESCE(root.isTraining,0)=0 ${sourceFilter.sql}) bookingPaymentsReference,
      (SELECT COALESCE(SUM(finance.amount),0) FROM Finances finance
        WHERE finance.date BETWEEN :fromDate AND :toDate AND finance.type='income'
          AND COALESCE(finance.isTraining,0)=0
          AND NOT EXISTS (SELECT 1 FROM CorporateLedgerEntries ledger WHERE ledger.financeId=finance.id)) manualFinanceWithoutClient,
      (SELECT COALESCE(SUM(ABS(ledger.amount)),0) FROM CorporateLedgerEntries ledger
        WHERE ledger.date BETWEEN :fromDate AND :toDate AND ledger.status='active'
          AND COALESCE(ledger.isTraining,0)=0) corporateLedgerExcludedAmount
    `, {
    replacements: {
      asOf: period.toSql,
      from: period.fromSql,
      fromDate: clubDateString(period.from),
      to: period.toSql,
      toDate: clubDateString(period.to),
      ...sourceFilter.replacements,
      ...visitScopeReplacements(context),
    },
    type: db.Sequelize.QueryTypes.SELECT,
  });
  const row = rows[0] || {};
  const cashNetRevenue = number(row.cashNetRevenue);
  const cashMovementAmount = number(row.cashMovementAmount);
  const attributedCashRevenue = number(row.attributedCashRevenue);
  const attributedCashMovementAmount = number(row.attributedCashMovementAmount);
  const allAttributedCashRevenue = number(row.allAttributedCashRevenue);
  const allAttributedCashMovementAmount = number(row.allAttributedCashMovementAmount);
  const duplicateRiskAmount = number(row.ambiguousClientAmount)
    + Math.abs(number(row.subscriptionReceiptDuplicateRisk))
    + Math.abs(number(row.certificateReceiptDuplicateRisk));
  return {
    cashNetRevenue,
    cashMovementAmount,
    attributedCashRevenue,
    attributedCashMovementAmount,
    allAttributedCashRevenue,
    allAttributedCashMovementAmount,
    unlinkedCashRevenue: cashNetRevenue - allAttributedCashRevenue,
    unlinkedCashMovementAmount: cashMovementAmount - allAttributedCashMovementAmount,
    outsideSelectedSourcesCashRevenue: allAttributedCashRevenue - attributedCashRevenue,
    coveragePercent: cashMovementAmount > 0
      ? allAttributedCashMovementAmount / cashMovementAmount * 100
      : null,
    selectedCashSharePercent: cashMovementAmount > 0
      ? attributedCashMovementAmount / cashMovementAmount * 100
      : null,
    paybackCount: number(row.paybackCount),
    unlinkedPaybackCount: number(row.unlinkedPaybackCount),
    unlinkedPaybackAmount: number(row.unlinkedPaybackAmount),
    unknownClientAmount: number(row.unknownClientAmount),
    ambiguousClientAmount: number(row.ambiguousClientAmount),
    duplicateRiskAmount,
    receiptItemReconciliationDifference: cashNetRevenue - number(row.receiptItemsNetRevenue),
    periodAttributedRevenue: number(row.periodAttributedRevenue),
    legacySales: { amount: number(row.legacySalesAmount), count: number(row.legacySalesCount) },
    bookingPaymentsReference: number(row.bookingPaymentsReference),
    manualFinanceWithoutClient: number(row.manualFinanceWithoutClient),
    corporateLedgerExcludedAmount: number(row.corporateLedgerExcludedAmount),
    sourceFilterScope: sourceFilter.sql ? 'selected_sources_vs_all_cash' : 'all_sources',
  };
}

function revenueReliability(coveragePercent, mature90) {
  if (!mature90) return { key: 'insufficient_time', label: 'Недостаточно времени' };
  if (mature90 < 10) return { key: 'low_sample', label: 'Мало данных' };
  if (coveragePercent === null || coveragePercent < 50 || coveragePercent > 105) return { key: 'low', label: 'Низкая' };
  if (coveragePercent < 80) return { key: 'medium', label: 'Средняя' };
  return { key: 'high', label: 'Высокая' };
}

async function getRevenueLtv(from, to, options = {}) {
  const context = await resolveAnalyticsVisitContext(options);
  const period = resolvePeriod(from, to, options.now ? new Date(options.now) : new Date());
  const sourceFilter = buildSourceFilter(options.sourceKeys);
  const [sources, cohortRows, coverage, availableSources] = await Promise.all([
    queryRevenueBySource(period, sourceFilter, context),
    queryRevenueCohorts(period, sourceFilter, context),
    queryRevenueCoverage(period, sourceFilter, context),
    queryAvailableSources(period.toSql, context),
  ]);
  const acquiredClients = sources.reduce((sum, row) => sum + row.acquiredClients, 0);
  const payingClients = sources.reduce((sum, row) => sum + row.payingClients, 0);
  const attributedRevenue = sources.reduce((sum, row) => sum + row.attributedRevenue, 0);
  const aggregateMetric = (key) => ltvMetric(
    sources.reduce((sum, row) => sum + row[key].revenue, 0),
    sources.reduce((sum, row) => sum + row[key].eligibleCount, 0),
  );
  const sourcesWithReliability = sources.map((row) => ({
    ...row,
    reliability: revenueReliability(coverage.coveragePercent, row.matureSample.days90),
  }));
  return {
    from: period.from,
    to: period.to,
    asOf: period.to,
    timeZone: CLUB_TIME_ZONE,
    appliedSourceKeys: Array.isArray(options.sourceKeys) ? options.sourceKeys : [],
    availableSources,
    summary: {
      attributedRevenue: coverage.periodAttributedRevenue,
      cohortAttributedRevenue: attributedRevenue,
      acquiredClients,
      payingClients,
      payerConversion: acquiredClients ? payingClients / acquiredClients * 100 : null,
      averageRevenuePerAcquiredClient: acquiredClients ? attributedRevenue / acquiredClients : null,
      averageRevenuePerPayingClient: payingClients ? attributedRevenue / payingClients : null,
      ltv30: aggregateMetric('ltv30'),
      ltv60: aggregateMetric('ltv60'),
      ltv90: aggregateMetric('ltv90'),
      lifetimeLtv: ltvMetric(attributedRevenue, acquiredClients),
      coveragePercent: coverage.coveragePercent,
    },
    sources: sourcesWithReliability,
    cohorts: buildRevenueCohorts(cohortRows, clubDateString(period.to)),
    coverage,
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

function cohortFactsCte(sourceFilterSql = '', context = null) {
  return `${canonicalClientsCte(context)},
    valid_visits AS (
      SELECT cc.canonicalUserId,v.visitedAt
      FROM Visits v FORCE INDEX (${visitIndex(context, 'idx_visits_user_visited_at', 'idx_visits_tenant_user_visited')})
      JOIN Users origin ON origin.id=v.userId
      JOIN canonical_clients cc ON cc.originUserId=v.userId
      WHERE ${VALID_VISIT_SQL}${visitScopeSql(context)} AND v.visitedAt<=:asOf
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

async function queryCohorts(period, sourceFilter, context = null) {
  const replacements = {
    from: period.fromSql,
    to: period.toSql,
    asOf: period.toSql,
    ...sourceFilter.replacements,
    ...visitScopeReplacements(context),
  };
  const [summaryRows, retentionRows] = await Promise.all([
    db.sequelize.query(`${cohortFactsCte(sourceFilter.sql, context)}
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
    db.sequelize.query(`${cohortFactsCte(sourceFilter.sql, context)}
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

async function queryLifecycle(asOfSql, sourceFilter, context = null) {
  const rows = await db.sequelize.query(`${canonicalClientsCte(context)},
    valid_visits AS (
      SELECT cc.canonicalUserId,v.visitedAt
      FROM Visits v FORCE INDEX (${visitIndex(context, 'idx_visits_user_visited_at', 'idx_visits_tenant_user_visited')})
      JOIN Users origin ON origin.id=v.userId
      JOIN canonical_clients cc ON cc.originUserId=v.userId
      WHERE ${VALID_VISIT_SQL}${visitScopeSql(context)} AND v.visitedAt<=:asOf
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
    replacements: {
      asOf: asOfSql,
      ...sourceFilter.replacements,
      ...visitScopeReplacements(context),
    },
    type: db.Sequelize.QueryTypes.SELECT,
  });
  return new Map(rows.map((row) => [row.statusKey, {
    actionableCount: number(row.actionableCount),
    count: number(row.count),
  }]));
}

async function queryAvailableSources(asOfSql, context = null) {
  const rows = await db.sequelize.query(`${canonicalClientsCte(context)},
    visited_clients AS (
      SELECT DISTINCT cc.canonicalUserId FROM Visits v FORCE INDEX (${visitIndex(context, 'idx_visits_user_visited_at', 'idx_visits_tenant_user_visited')})
      JOIN Users origin ON origin.id=v.userId JOIN canonical_clients cc ON cc.originUserId=v.userId
      WHERE ${VALID_VISIT_SQL}${visitScopeSql(context)} AND v.visitedAt<=:asOf
    )
    SELECT root.sourceId,COALESCE(NULLIF(cs.name,''),NULLIF(root.source,''),'Не указан') sourceName,
      COUNT(*) clientCount,
      SUM(root.status='active' AND NOT COALESCE(root.isTraining,0)) actionableCount
    FROM visited_clients clients JOIN Users root ON root.id=clients.canonicalUserId
    LEFT JOIN ClientSources cs ON cs.id=root.sourceId
    GROUP BY root.sourceId,sourceName ORDER BY clientCount DESC,sourceName`, {
    replacements: { asOf: asOfSql, ...visitScopeReplacements(context) },
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
  const context = await resolveAnalyticsVisitContext(options);
  const period = resolvePeriod(from, to, new Date());
  const sourceFilter = buildSourceFilter(options.sourceKeys);
  const asOfDate = clubDateString(period.to);
  const [cohortData, currentLifecycle, previousLifecycle, availableSources] = await Promise.all([
    queryCohorts(period, sourceFilter, context),
    queryLifecycle(period.toSql, sourceFilter, context),
    queryLifecycle(period.previousToSql, sourceFilter, context),
    queryAvailableSources(period.toSql, context),
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
  const context = await resolveAnalyticsVisitContext(options);
  const filters = normalizeVisitAnalyticsSegmentFilters(filtersInput);
  const sourceFilter = buildSourceFilter(filters.sourceKeys.length ? filters.sourceKeys : undefined);
  const criteria = buildSegmentCriteria(filters);
  const where = [
    "root.status='active'",
    'COALESCE(root.isTraining,0)=0',
    ...criteria.having,
  ];
  const baseSql = `${canonicalClientsCte(context)},
    valid_visits AS (
      SELECT cc.canonicalUserId,v.visitedAt
      FROM Visits v FORCE INDEX (${visitIndex(context, 'idx_visits_user_visited_at', 'idx_visits_tenant_user_visited')})
      JOIN Users origin ON origin.id=v.userId
      JOIN canonical_clients cc ON cc.originUserId=v.userId
      WHERE ${VALID_VISIT_SQL}${visitScopeSql(context)} AND v.visitedAt<=:asOf
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
  const replacements = {
    ...criteria.replacements,
    ...sourceFilter.replacements,
    ...visitScopeReplacements(context),
  };
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

async function countVisitAnalyticsSegmentClients(filters, options = {}) {
  return (await queryVisitAnalyticsSegment(filters, { ...options, countOnly: true })).total;
}

async function listVisitAnalyticsSegmentClients(filters, options = {}) {
  return queryVisitAnalyticsSegment(filters, options);
}

function getLifecycleLabel(key) {
  return LIFECYCLE_STATUSES.find((status) => status.key === key)?.label || key;
}

async function previewVisitAnalyticsSegment(selection = {}, options = {}) {
  const context = await resolveAnalyticsVisitContext(options);
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
  const availableSources = await queryAvailableSources(analyticsDateTimeSql(filters.asOf), context);
  const sourceLabels = sourceKeys.map((key) => availableSources.find((source) => source.sourceKey === key)?.source || key);
  const count = await countVisitAnalyticsSegmentClients(filters, { visitContext: context });
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

function appendRevenueLtvSheets(workbook, analytics) {
  const summaryRows = [
    ['Период', `${clubDateString(new Date(analytics.from))} — ${clubDateString(new Date(analytics.to))}`, 'Дата денежного события; Europe/Moscow'],
    ['Надежно атрибутированная выручка', analytics.summary.attributedRevenue, 'Сумма уникальных денежных событий периода с однозначной canonical client связью'],
    ['Привлечено клиентов', analytics.summary.acquiredClients, 'Canonical-клиенты, чей первый реальный визит попал в период'],
    ['Платящих клиентов', analytics.summary.payingClients, 'Клиенты когорты хотя бы с одним положительным надежно атрибутированным событием после первого визита'],
    ['Конверсия в оплату, %', analytics.summary.payerConversion, 'Платящие клиенты / привлеченные клиенты × 100'],
    ['Средняя выручка на привлеченного', analytics.summary.averageRevenuePerAcquiredClient, 'Накопленная выручка когорты / привлеченные клиенты'],
    ['Средняя выручка на платящего', analytics.summary.averageRevenuePerPayingClient, 'Накопленная выручка когорты / платящие клиенты'],
    ['LTV 30', analytics.summary.ltv30.value, 'Выручка первых 30 дней зрелых клиентов / mature30'],
    ['LTV 60', analytics.summary.ltv60.value, 'Выручка первых 60 дней зрелых клиентов / mature60'],
    ['LTV 90', analytics.summary.ltv90.value, 'Выручка первых 90 дней зрелых клиентов / mature90'],
    ['Lifetime LTV', analytics.summary.lifetimeLtv.value, 'Накопленная выручка от первого визита до даты среза / размер когорты'],
    ['Покрытие кассовых движений, %', analytics.summary.coveragePercent, 'Модули надежно привязанных позиций чеков / модули всех чеков × 100; PAYBACK не ломает знаменатель'],
  ];
  const summarySheet = XLSX.utils.aoa_to_sheet([['Метрика', 'Значение', 'Формула и ограничение'], ...summaryRows]);
  summarySheet['!cols'] = [{ wch: 38 }, { wch: 24 }, { wch: 100 }];
  XLSX.utils.book_append_sheet(workbook, summarySheet, 'Выручка и LTV');

  const sourceRows = analytics.sources.map((row) => ({
    Источник: row.source,
    'Stable source key': row.sourceKey,
    'Привлечено клиентов': row.acquiredClients,
    'Платящих клиентов': row.payingClients,
    'Конверсия в оплату, %': row.payerConversion,
    'Атрибутированная выручка': row.attributedRevenue,
    'LTV 30': row.ltv30.value,
    'Mature 30': row.ltv30.eligibleCount,
    'LTV 60': row.ltv60.value,
    'Mature 60': row.ltv60.eligibleCount,
    'LTV 90': row.ltv90.value,
    'Mature 90': row.ltv90.eligibleCount,
    'Lifetime LTV': row.lifetimeLtv.value,
    'Надежность': row.reliability.label,
  }));
  const sourceSheet = XLSX.utils.json_to_sheet(sourceRows);
  sourceSheet['!cols'] = Object.keys(sourceRows[0] || { Источник: '' }).map((key) => ({ wch: Math.max(16, Math.min(32, key.length + 2)) }));
  XLSX.utils.book_append_sheet(workbook, sourceSheet, 'LTV по источникам');

  const cohortRows = analytics.cohorts.rows.map((cohort) => {
    const row = { 'Месяц первого визита': cohort.cohortMonth, 'Размер когорты': cohort.cohortSize };
    cohort.values.forEach((metric) => {
      row[`M${metric.monthIndex} cumulative LTV`] = metric.value;
      row[`M${metric.monthIndex} cumulative revenue`] = metric.revenue;
      row[`M${metric.monthIndex} окно`] = metric.isMature ? `Созрело ${metric.windowEnd}` : `Недостаточно времени; созреет ${metric.windowEnd}`;
    });
    return row;
  });
  const cohortSheet = XLSX.utils.json_to_sheet(cohortRows);
  cohortSheet['!cols'] = Object.keys(cohortRows[0] || { 'Месяц первого визита': '' }).map((key) => ({ wch: Math.max(18, Math.min(38, key.length + 2)) }));
  XLSX.utils.book_append_sheet(workbook, cohortSheet, 'LTV по когортам');

  const coverage = analytics.coverage;
  const coverageRows = [
    ['Общая кассовая net-выручка', coverage.cashNetRevenue, 'SELL положительно, PAYBACK отрицательно'],
    ['Надежно привязано к выбранным источникам', coverage.attributedCashRevenue, 'Уникальные позиции чеков с одной canonical client связью; source-фильтр применяется к этой сумме'],
    ['Надежно привязано по всем источникам', coverage.allAttributedCashRevenue, 'Используется для расчета истинно непривязанной net-суммы'],
    ['Истинно не привязано', coverage.unlinkedCashRevenue, 'Кассовая net-выручка минус надежно привязанные позиции всех источников'],
    ['Вне выбранных источников', coverage.outsideSelectedSourcesCashRevenue, 'Надежно привязанная сумма скрытых source-фильтром клиентов'],
    ['Покрытие кассовых движений, %', coverage.coveragePercent, 'Модули всех надежно привязанных позиций / модули всех чеков × 100'],
    ['Доля выбранных источников в кассовых движениях, %', coverage.selectedCashSharePercent, 'Модули надежно привязанных позиций выбранных источников / модули всех чеков × 100'],
    ['Количество PAYBACK', coverage.paybackCount, 'Все кассовые возвраты периода'],
    ['Непривязанный PAYBACK, количество', coverage.unlinkedPaybackCount, 'Возвратные чеки хотя бы с одной позицией без единственной canonical client связи'],
    ['Непривязанный PAYBACK, сумма позиций', coverage.unlinkedPaybackAmount, 'Модули возвратных позиций, не включенных в LTV'],
    ['Неизвестный клиент', coverage.unknownClientAmount, 'Позиции чеков без прямой клиентской связи'],
    ['Неоднозначный клиент', coverage.ambiguousClientAmount, 'Позиции чеков со связями к разным canonical-клиентам'],
    ['Предотвращенный риск двойного учета', coverage.duplicateRiskAmount, 'Не включенные повторно saleAmount receipt-backed сущностей плюс неоднозначные позиции'],
    ['Расхождение чек / позиции', coverage.receiptItemReconciliationDifference, 'Кассовая net-выручка минус net-сумма сохраненных позиций'],
    ['Legacy-продажи без надежной даты', coverage.legacySales.amount, `${coverage.legacySales.count} сертификатов legacy_stn_google_sheet`],
    ['Booking payments (справочно)', coverage.bookingPaymentsReference, 'Не входят в LTV: отдельный от кассы платеж не доказан'],
    ['Ручные Finance без clientId', coverage.manualFinanceWithoutClient, 'Не входят в индивидуальный LTV'],
    ['Corporate ledger исключен', coverage.corporateLedgerExcludedAmount, 'Движение предоплаченного баланса, не новый cash event; не входит в индивидуальный LTV'],
  ];
  const coverageSheet = XLSX.utils.aoa_to_sheet([['Показатель', 'Сумма / количество', 'Ограничение'], ...coverageRows]);
  coverageSheet['!cols'] = [{ wch: 48 }, { wch: 24 }, { wch: 100 }];
  XLSX.utils.book_append_sheet(workbook, coverageSheet, 'Покрытие данных');
}

async function createVisitsExportBuffer(from, to, options = {}) {
  const context = await resolveAnalyticsVisitContext(options);
  const now = options.now ? new Date(options.now) : new Date();
  const period = resolvePeriod(from, to, now);
  const sourceFilter = buildSourceFilter(options.sourceKeys);
  const [analytics, cohortsLifecycle, revenueLtv] = await Promise.all([
    getVisitsAnalytics(from, to, { now, sourceKeys: options.sourceKeys, visitContext: context }),
    getCohortsLifecycle(from, to, { ...options, visitContext: context }),
    getRevenueLtv(from, to, { ...options, now, visitContext: context }),
  ]);
  const visits = await db.sequelize.query(`${canonicalClientsCte(context)}
    SELECT v.id,v.visitedAt,v.keyNumber,v.category,root.name,root.phone,
      COALESCE(NULLIF(cs.name,''),NULLIF(root.source,''),'Не указан') source
    FROM Visits v FORCE INDEX (${visitIndex(context, 'idx_visits_visited_at', 'idx_visits_tenant_visited')}) JOIN Users origin ON origin.id=v.userId
    JOIN canonical_clients cc ON cc.originUserId=v.userId JOIN Users root ON root.id=cc.canonicalUserId
    LEFT JOIN ClientSources cs ON cs.id=root.sourceId
    WHERE ${VALID_VISIT_SQL}${visitScopeSql(context)} AND v.visitedAt BETWEEN :from AND :to ${sourceFilter.sql}
    ORDER BY v.visitedAt DESC`, {
    replacements: {
      from: period.fromSql,
      to: period.toSql,
      ...sourceFilter.replacements,
      ...visitScopeReplacements(context),
    },
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
  appendRevenueLtvSheets(workbook, revenueLtv);
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
}

async function explainPeriodIndex(from, to, options = {}) {
  const context = await resolveAnalyticsVisitContext(options);
  const period = resolvePeriod(from, to, options.now ? new Date(options.now) : new Date());
  return db.sequelize.query(`EXPLAIN SELECT v.id FROM Visits v FORCE INDEX (${visitIndex(context, 'idx_visits_visited_at', 'idx_visits_tenant_visited')})
    WHERE v.visitedAt BETWEEN :from AND :to AND COALESCE(v.isTraining,0)=0 AND v.duplicateOfVisitId IS NULL${visitScopeSql(context)}`, {
    replacements: {
      from: period.fromSql,
      to: period.toSql,
      ...visitScopeReplacements(context),
    }, type: db.Sequelize.QueryTypes.SELECT,
  });
}

module.exports = { CANONICAL_CLIENTS_CTE, CLUB_TIME_ZONE, LIFECYCLE_STATUSES, SEGMENT_ALGORITHM_VERSION, appendRevenueLtvSheets, buildRevenueCohorts, buildSourceFilter, calculateChanges, classifyLifecycleFacts, cohortFromRows, countVisitAnalyticsSegmentClients, createSourceQualityExportBuffer, createVisitsExportBuffer, explainPeriodIndex, formatClubDateTime, getCohortsLifecycle, getRevenueLtv, getSourceQuality, getVisitsAnalytics, listVisitAnalyticsSegmentClients, ltvMetric, metricFromRow, normalizeVisitAnalyticsSegmentFilters, parseSourceKeys, previewVisitAnalyticsSegment, rateMetric, resolvePeriod, retentionMetric, retentionMonthCountForAsOf, sourceKeyFromRow, sourceQualityFromRow, sourceRevenueFromRow };
