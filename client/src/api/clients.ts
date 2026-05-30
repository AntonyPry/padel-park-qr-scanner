import { apiRequest } from '@/lib/api';

export interface ClientListItem {
  createdAt: string;
  id: number;
  name: string;
  phone: string;
  phoneNormalized?: string | null;
  source: string;
  sourceId?: number | null;
  status: 'active' | 'archived';
  statusLabel?: string;
  stats?: {
    firstVisitAt?: string | null;
    lastVisitAt?: string | null;
    visitCount: number;
  };
  updatedAt: string;
}

export interface ClientsListResponse {
  items: ClientListItem[];
  page: number;
  pageSize: number;
  sources: string[];
  total: number;
  totalPages: number;
}

function toQueryString(params: object) {
  const searchParams = new URLSearchParams();
  Object.entries(params as Record<string, unknown>).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;
    searchParams.set(key, String(value));
  });

  const query = searchParams.toString();
  return query ? `?${query}` : '';
}

export function listClients(params: {
  page?: number;
  pageSize?: number;
  q?: string;
  status?: 'active' | 'archived' | 'all';
}) {
  return apiRequest<ClientsListResponse>(
    `/api/clients${toQueryString(params)}`,
    {},
    'Не удалось получить клиентов',
  );
}
