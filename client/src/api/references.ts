import { apiRequest } from '@/lib/api';
import type {
  ReferenceItem,
  ReferenceStatus,
  ReferenceType,
} from '@/lib/references';

interface ReferencePayload {
  name: string;
  sortOrder?: number;
}

export function listReferences(
  type: ReferenceType,
  status: ReferenceStatus | 'all' = 'active',
) {
  const params = new URLSearchParams({ status });
  return apiRequest<ReferenceItem[]>(
    `/api/references/${type}?${params.toString()}`,
    {},
    'Не удалось загрузить справочник',
  );
}

export function createReference(type: ReferenceType, payload: ReferencePayload) {
  return apiRequest<ReferenceItem>(
    `/api/references/${type}`,
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
    'Не удалось сохранить значение',
  );
}

export function updateReference(
  type: ReferenceType,
  id: number,
  payload: ReferencePayload,
) {
  return apiRequest<ReferenceItem>(
    `/api/references/${type}/${id}`,
    {
      method: 'PUT',
      body: JSON.stringify(payload),
    },
    'Не удалось сохранить значение',
  );
}

export function updateReferenceStatus(
  type: ReferenceType,
  id: number,
  status: ReferenceStatus,
) {
  const action = status === 'archived' ? 'archive' : 'restore';
  return apiRequest<ReferenceItem>(
    `/api/references/${type}/${id}/${action}`,
    { method: 'POST' },
    'Не удалось изменить статус',
  );
}

export function deleteArchivedReference(type: ReferenceType, id: number) {
  return apiRequest<{ success: boolean }>(
    `/api/references/${type}/${id}/permanent`,
    { method: 'DELETE' },
    'Не удалось удалить значение из архива',
  );
}
