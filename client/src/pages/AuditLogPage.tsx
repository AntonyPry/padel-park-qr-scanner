import { useMemo, useState } from 'react';
import { type ColumnDef } from '@tanstack/react-table';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { listAuditLogs, type AuditAction, type AuditLogItem } from '@/api/audit';
import { queryKeys } from '@/api/query-keys';
import { DataTable } from '@/components/data-table';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationNext,
  PaginationPrevious,
} from '@/components/ui/pagination';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { getApiErrorMessage } from '@/lib/api';

const ACTION_LABELS: Record<string, string> = {
  all: 'Все действия',
  archive_or_delete: 'Архивирование',
  create: 'Создание',
  create_attempt: 'Попытка звонка',
  delete_permanent: 'Удаление навсегда',
  restore: 'Восстановление',
  run_recurring: 'Автозадачи',
  sync: 'Синхронизация',
  update: 'Изменение',
};

const actionOptions: AuditAction[] = [
  'all',
  'create',
  'update',
  'archive_or_delete',
  'restore',
  'delete_permanent',
  'sync',
  'create_attempt',
  'run_recurring',
];

function formatDate(value: string) {
  return format(new Date(value), 'dd.MM.yyyy HH:mm:ss');
}

function getActionLabel(action: string) {
  if (action.endsWith('.failed')) return 'Ошибка';
  return ACTION_LABELS[action] || action;
}

export default function AuditLogPage() {
  const [action, setAction] = useState<AuditAction>('all');
  const [page, setPage] = useState(1);
  const pageSize = 25;
  const auditParams = useMemo(
    () => ({ action, page, pageSize }),
    [action, page],
  );
  const auditQuery = useQuery({
    queryFn: () => listAuditLogs(auditParams),
    queryKey: queryKeys.audit.list(auditParams),
  });
  const items = auditQuery.data?.items || [];
  const total = auditQuery.data?.total || 0;
  const totalPages = auditQuery.data?.totalPages || 1;
  const loading = auditQuery.isLoading || auditQuery.isFetching;
  const errorText = auditQuery.isError
    ? getApiErrorMessage(auditQuery.error, 'Не удалось загрузить журнал действий')
    : undefined;
  const auditColumns = useMemo<ColumnDef<AuditLogItem>[]>(
    () => [
      {
        accessorKey: 'createdAt',
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">
            {formatDate(row.original.createdAt)}
          </span>
        ),
        header: 'Время',
        size: 150,
      },
      {
        accessorKey: 'action',
        cell: ({ row }) => (
          <Badge
            variant={
              row.original.statusCode >= 400 ? 'destructive' : 'outline'
            }
          >
            {getActionLabel(row.original.action)}
          </Badge>
        ),
        header: 'Действие',
        size: 140,
      },
      {
        id: 'account',
        cell: ({ row }) => (
          <>
            <div className="truncate font-medium">
              {row.original.account?.name || 'Система'}
            </div>
            {row.original.account?.email && (
              <div className="truncate text-xs text-muted-foreground">
                {row.original.account.email}
              </div>
            )}
          </>
        ),
        header: 'Пользователь',
        size: 180,
      },
      {
        id: 'entity',
        cell: ({ row }) => (
          <>
            <div className="truncate">{row.original.entityType}</div>
            {row.original.entityId && (
              <div className="text-xs text-muted-foreground">
                ID {row.original.entityId}
              </div>
            )}
          </>
        ),
        header: 'Сущность',
        size: 170,
      },
      {
        id: 'route',
        cell: ({ row }) => (
          <>
            <div className="truncate font-mono text-xs">
              {row.original.method} {row.original.path}
            </div>
            {row.original.summary && (
              <div className="mt-1 line-clamp-1 text-xs text-muted-foreground">
                {row.original.summary}
              </div>
            )}
          </>
        ),
        header: 'Маршрут',
        size: 260,
      },
      {
        accessorKey: 'statusCode',
        cell: ({ row }) => (
          <div className="text-right">{row.original.statusCode}</div>
        ),
        header: () => <div className="text-right">Статус</div>,
        size: 90,
      },
    ],
    [],
  );

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3 rounded-xl border bg-card/60 p-3 sm:flex-row sm:items-center sm:justify-between">
        <Badge variant="outline" className="w-fit">
          {total.toLocaleString('ru-RU')} событий
        </Badge>
        <div className="flex gap-2">
          <Select
            value={action}
            onValueChange={(value) => {
              setAction(value as AuditAction);
              setPage(1);
            }}
          >
            <SelectTrigger className="w-[190px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {actionOptions.map((option) => (
                <SelectItem key={option} value={option}>
                  {ACTION_LABELS[option]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <Card>
        <CardContent className="px-0 pt-0">
          <DataTable
            columns={auditColumns}
            data={items}
            emptyText="Записей пока нет."
            errorText={errorText}
            loading={loading}
            loadingText="Загрузка журнала..."
            minWidthClassName="min-w-[980px]"
            onRetry={() => void auditQuery.refetch()}
            tableClassName="table-fixed"
          />
          <div className="flex items-center justify-between gap-3 border-t px-4 py-3 text-sm text-muted-foreground">
            <span className="whitespace-nowrap">
              Страница {page} из {totalPages}
            </span>
            <Pagination className="justify-end">
              <PaginationContent>
                <PaginationItem>
                  <PaginationPrevious
                    disabled={page <= 1}
                    onClick={() => setPage((value) => Math.max(1, value - 1))}
                  />
                </PaginationItem>
                <PaginationItem>
                  <PaginationNext
                    disabled={page >= totalPages}
                    onClick={() =>
                      setPage((value) => Math.min(totalPages, value + 1))
                    }
                  />
                </PaginationItem>
              </PaginationContent>
            </Pagination>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
