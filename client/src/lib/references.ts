import { listReferences } from '@/api/references';

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
  return listReferences(type, status);
}

export function getReferenceName(items: ReferenceItem[], id?: number | null) {
  return items.find((item) => item.id === id)?.name || '';
}
