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
