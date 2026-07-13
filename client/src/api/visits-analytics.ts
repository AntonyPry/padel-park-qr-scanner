import { apiRequest } from '@/lib/api';

export interface ChartDatum {
  name: string;
  value: number;
}

export interface TopGuest {
  name: string;
  phone?: string;
  visits: number;
}

export interface VisitsAnalytics {
  totalVisits: number;
  uniqueGuests: number;
  newGuests: number;
  returningGuests: number;
  repeatVisits: number;
  averageVisitsPerGuest: number;
  repeatRate30: number;
  repeatRate30EligibleGuests: number;
  repeatRate30RepeatedGuests: number;
  changes: Record<string, { absolute: number; percent: number | null }>;
  previousPeriod: {
    from: string;
    to: string;
    metrics: Pick<VisitsAnalytics, 'totalVisits' | 'uniqueGuests' | 'newGuests' | 'returningGuests' | 'repeatVisits' | 'averageVisitsPerGuest' | 'repeatRate30'>;
  };
  sources: ChartDatum[];
  categories: ChartDatum[];
  topGuests: TopGuest[];
  heatMap: Record<string, number>;
}

export function getVisitsAnalytics(params: { from: string; to: string }) {
  const query = new URLSearchParams({
    from: params.from,
    to: params.to,
  });

  return apiRequest<VisitsAnalytics>(
    `/api/analytics/visits?${query.toString()}`,
    {},
    'Не удалось загрузить аналитику посещений',
  );
}

export interface RateMetric { count: number; eligibleCount: number; rate: number | null; lowSample: boolean }
export interface SourceQualityRow {
  sourceId: number | null; sourceKey: string; source: string; newClients: number;
  actionableCount: number;
  oneVisit30: RateMetric; repeat30: RateMetric; repeat60: RateMetric; repeat90: RateMetric; threePlus90: RateMetric;
  averageVisits90: number | null; averageVisits90EligibleCount: number; medianDaysToSecondVisit: number | null;
  sampleSize: { eligible30: number; eligible60: number; eligible90: number };
}
export interface SourceQualityAnalytics { from: string; to: string; asOf: string; timeZone: string; sources: SourceQualityRow[] }
export function getSourceQuality(params: { from: string; to: string; sources?: string[] }) {
  const query = new URLSearchParams({ from: params.from, to: params.to });
  if (params.sources?.length) query.set('sources', params.sources.join(','));
  return apiRequest<SourceQualityAnalytics>(`/api/analytics/visits/source-quality?${query}`, {}, 'Не удалось загрузить качество источников');
}

export type CohortMetric = RateMetric;
export interface RetentionMetric {
  monthIndex: number;
  count: number | null;
  eligibleCount: number;
  rate: number | null;
  isMature: boolean;
  windowEnd: string;
}
export interface CohortRow {
  cohortMonth: string;
  cohortSize: number;
  actionableCount: number;
  repeat30: CohortMetric;
  repeat60: CohortMetric;
  repeat90: CohortMetric;
  retention: RetentionMetric[];
}
export interface LifecycleStatus {
  key: 'new' | 'developing' | 'regular' | 'atRisk' | 'sleeping' | 'lost';
  label: string;
  formula: string;
  count: number;
  actionableCount: number;
  share: number;
  previousCount: number;
  change: { absolute: number; percent: number | null };
}
export interface VisitsAnalyticsSourceOption {
  sourceId: number | null;
  sourceKey: string;
  source: string;
  clientCount: number;
  actionableCount: number;
}
export interface CohortsLifecycleAnalytics {
  from: string;
  to: string;
  asOf: string;
  timeZone: string;
  appliedSourceKeys: string[];
  availableSources: VisitsAnalyticsSourceOption[];
  retentionMonths: number[];
  cohorts: CohortRow[];
  lifecycle: {
    totalClassified: number;
    actionableTotal: number;
    previousTotalClassified: number;
    previousPeriod: { from: string; to: string; asOf: string };
    statuses: LifecycleStatus[];
  };
}
export function getCohortsLifecycle(params: { from: string; to: string; sources?: string[] }) {
  const query = new URLSearchParams({ from: params.from, to: params.to });
  if (params.sources?.length) query.set('sources', params.sources.join(','));
  return apiRequest<CohortsLifecycleAnalytics>(`/api/analytics/visits/cohorts-lifecycle?${query}`, {}, 'Не удалось загрузить когорты и жизненный цикл');
}

export interface LtvMetric {
  eligibleCount: number;
  lowSample: boolean;
  revenue: number;
  value: number | null;
}
export interface RevenueLtvSourceRow {
  sourceId: number | null;
  sourceKey: string;
  source: string;
  acquiredClients: number;
  payingClients: number;
  payerConversion: number | null;
  attributedRevenue: number;
  averageRevenuePerAcquiredClient: number | null;
  averageRevenuePerPayingClient: number | null;
  ltv30: LtvMetric;
  ltv60: LtvMetric;
  ltv90: LtvMetric;
  lifetimeLtv: LtvMetric;
  matureSample: { days30: number; days60: number; days90: number };
  reliability: { key: string; label: string };
}
export interface RevenueCohortValue {
  isMature: boolean;
  monthIndex: number;
  revenue: number | null;
  value: number | null;
  windowEnd: string;
}
export interface RevenueLtvAnalytics {
  from: string;
  to: string;
  asOf: string;
  timeZone: string;
  appliedSourceKeys: string[];
  availableSources: VisitsAnalyticsSourceOption[];
  summary: {
    attributedRevenue: number;
    cohortAttributedRevenue: number;
    acquiredClients: number;
    payingClients: number;
    payerConversion: number | null;
    averageRevenuePerAcquiredClient: number | null;
    averageRevenuePerPayingClient: number | null;
    ltv30: LtvMetric;
    ltv60: LtvMetric;
    ltv90: LtvMetric;
    lifetimeLtv: LtvMetric;
    coveragePercent: number | null;
  };
  sources: RevenueLtvSourceRow[];
  cohorts: {
    months: number[];
    rows: Array<{ cohortMonth: string; cohortSize: number; values: RevenueCohortValue[] }>;
  };
  coverage: {
    cashNetRevenue: number;
    cashMovementAmount: number;
    attributedCashRevenue: number;
    attributedCashMovementAmount: number;
    allAttributedCashRevenue: number;
    allAttributedCashMovementAmount: number;
    unlinkedCashRevenue: number;
    unlinkedCashMovementAmount: number;
    outsideSelectedSourcesCashRevenue: number;
    coveragePercent: number | null;
    selectedCashSharePercent: number | null;
    paybackCount: number;
    unlinkedPaybackCount: number;
    unlinkedPaybackAmount: number;
    unknownClientAmount: number;
    ambiguousClientAmount: number;
    duplicateRiskAmount: number;
    receiptItemReconciliationDifference: number;
    periodAttributedRevenue: number;
    legacySales: { amount: number; count: number };
    bookingPaymentsReference: number;
    manualFinanceWithoutClient: number;
    corporateLedgerExcludedAmount: number;
    sourceFilterScope: 'all_sources' | 'selected_sources_vs_all_cash';
  };
}
export function getRevenueLtv(params: { from: string; to: string; sources?: string[] }) {
  const query = new URLSearchParams({ from: params.from, to: params.to });
  if (params.sources?.length) query.set('sources', params.sources.join(','));
  return apiRequest<RevenueLtvAnalytics>(
    `/api/analytics/visits/revenue-ltv?${query}`,
    {},
    'Не удалось загрузить выручку и LTV',
  );
}

export interface VisitsAnalyticsSegmentSelection {
  asOf?: string;
  cohortMonth?: string;
  expectedCount?: number;
  from: string;
  kind: 'source' | 'lifecycle' | 'cohort' | 'filters';
  lifecycleStatus?: LifecycleStatus['key'];
  sourceKeys?: string[];
  to: string;
}

export interface VisitsAnalyticsSegmentPreview {
  asOf: string;
  count: number;
  description: string;
  filters: Record<string, unknown>;
  name: string;
  origin: 'visits_analytics';
  originMetadata: Record<string, unknown>;
  period: { from: string; to: string };
  sourceLabels: string[];
  timeZone: string;
}

export function previewVisitsAnalyticsSegment(selection: VisitsAnalyticsSegmentSelection) {
  const body = visitsAnalyticsSelectionBody(selection);
  return apiRequest<VisitsAnalyticsSegmentPreview>(
    '/api/analytics/visits/client-base-preview',
    { method: 'POST', body: JSON.stringify(body) },
    'Не удалось рассчитать клиентскую базу',
  );
}

function visitsAnalyticsSelectionBody(selection: VisitsAnalyticsSegmentSelection) {
  return Object.fromEntries(
    Object.entries(selection).filter(([key]) => key !== 'expectedCount'),
  );
}

export function createVisitsAnalyticsClientBase(
  selection: VisitsAnalyticsSegmentSelection,
  values: { name: string; description: string },
) {
  return apiRequest<{ id: number; name: string }>(
    '/api/analytics/visits/client-bases',
    {
      method: 'POST',
      body: JSON.stringify({
        description: values.description,
        name: values.name,
        selection: visitsAnalyticsSelectionBody(selection),
      }),
    },
    'Не удалось создать клиентскую базу',
  );
}
