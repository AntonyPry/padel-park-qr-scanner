import { apiRequest } from '@/lib/api';

export interface UtilizationRecord {
  date: string;
  booked1: number | string;
  booked2: number | string;
  sessions1?: number | string;
  sessions2?: number | string;
}

export function listUtilization() {
  return apiRequest<UtilizationRecord[]>(
    '/api/utilization',
    {},
    'Не удалось загрузить утилизацию кортов',
  );
}

export function saveUtilization(records: UtilizationRecord[]) {
  return apiRequest<UtilizationRecord[]>(
    '/api/utilization',
    {
      method: 'POST',
      body: JSON.stringify(records),
    },
    'Не удалось сохранить утилизацию кортов',
  );
}
