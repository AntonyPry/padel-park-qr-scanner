import { apiFetch } from '@/lib/api';

export type ReferenceStatus = 'active' | 'archived';
export type ReferenceType = 'client-sources' | 'visit-categories';

export interface ReferenceItem {
  id: number;
  name: string;
  status: ReferenceStatus;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export async function fetchReferences(
  type: ReferenceType,
  status: ReferenceStatus | 'all' = 'active',
) {
  const params = new URLSearchParams({ status });
  const res = await apiFetch(`/api/references/${type}?${params.toString()}`);
  if (!res.ok) throw new Error('Не удалось загрузить справочник');
  return (await res.json()) as ReferenceItem[];
}

export function getReferenceName(items: ReferenceItem[], id?: number | null) {
  return items.find((item) => item.id === id)?.name || '';
}
