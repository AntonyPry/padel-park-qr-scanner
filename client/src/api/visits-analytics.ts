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
  const body = Object.fromEntries(
    Object.entries(selection).filter(([key]) => key !== 'expectedCount'),
  );
  return apiRequest<VisitsAnalyticsSegmentPreview>(
    '/api/analytics/visits/client-base-preview',
    { method: 'POST', body: JSON.stringify(body) },
    'Не удалось рассчитать клиентскую базу',
  );
}
