import { apiRequest } from '@/lib/api';

export type AuditAction =
  | 'all'
  | 'create'
  | 'update'
  | 'archive_or_delete'
  | 'restore'
  | 'delete_permanent'
  | 'sync'
  | 'create_attempt'
  | 'run_recurring';

export interface AuditLogItem {
  id: number;
  account?: {
    id: number;
    email: string;
    name: string;
    role: string;
  } | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  method: string;
  path: string;
  statusCode: number;
  summary?: string | null;
  createdAt: string;
}

export interface AuditLogResponse {
  items: AuditLogItem[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export function listAuditLogs(params: {
  action: AuditAction;
  page: number;
  pageSize: number;
}) {
  const query = new URLSearchParams({
    page: String(params.page),
    pageSize: String(params.pageSize),
  });

  if (params.action !== 'all') query.set('action', params.action);

  return apiRequest<AuditLogResponse>(
    `/api/audit-logs?${query.toString()}`,
    {},
    'Не удалось загрузить журнал действий',
  );
}
