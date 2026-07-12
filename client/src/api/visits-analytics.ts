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

export interface RateMetric { count: number; eligibleCount: number; rate: number | null }
export interface SourceQualityRow {
  sourceId: number | null; source: string; newClients: number;
  oneVisit30: RateMetric; repeat30: RateMetric; repeat60: RateMetric; repeat90: RateMetric; threePlus90: RateMetric;
  averageVisits90: number | null; medianDaysToSecondVisit: number | null;
  sampleSize: { eligible30: number; eligible60: number; eligible90: number }; lowSample: boolean;
}
export interface SourceQualityAnalytics { from: string; to: string; asOf: string; timeZone: string; sources: SourceQualityRow[] }
export function getSourceQuality(params: { from: string; to: string; sources?: number[] }) {
  const query = new URLSearchParams({ from: params.from, to: params.to });
  if (params.sources?.length) query.set('sources', params.sources.join(','));
  return apiRequest<SourceQualityAnalytics>(`/api/analytics/visits/source-quality?${query}`, {}, 'Не удалось загрузить качество источников');
}
