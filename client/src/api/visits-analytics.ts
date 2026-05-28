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
