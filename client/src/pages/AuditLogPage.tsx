import { useCallback, useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';
import { RefreshCw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { apiFetch } from '@/lib/api';

type AuditAction =
  | 'all'
  | 'create'
  | 'update'
  | 'archive_or_delete'
  | 'restore'
  | 'delete_permanent'
  | 'sync'
  | 'create_attempt'
  | 'run_recurring';

interface AuditLogItem {
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

interface AuditLogResponse {
  items: AuditLogItem[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

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
  const [items, setItems] = useState<AuditLogItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [action, setAction] = useState<AuditAction>('all');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);

  const query = useMemo(() => {
    const params = new URLSearchParams({
      page: String(page),
      pageSize: '25',
    });
    if (action !== 'all') params.set('action', action);
    return params.toString();
  }, [action, page]);

  const fetchAudit = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch(`/api/audit-logs?${query}`);
      if (!res.ok) return;
      const data = (await res.json()) as AuditLogResponse;
      setItems(data.items || []);
      setTotal(data.total || 0);
      setTotalPages(data.totalPages || 1);
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    void fetchAudit();
  }, [fetchAudit]);

  return (
    <div className="mx-auto flex max-w-[1200px] flex-col gap-6 p-6 md:p-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Журнал действий</h1>
          <p className="mt-1 text-muted-foreground">
            Изменения данных, архивы, восстановления, удаления и ошибки доступа.
          </p>
        </div>
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
          <Button
            variant="outline"
            size="icon"
            onClick={() => void fetchAudit()}
            aria-label="Обновить журнал"
            title="Обновить"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between border-b py-3">
          <CardTitle className="text-lg">События</CardTitle>
          <Badge variant="outline">{total.toLocaleString('ru-RU')}</Badge>
        </CardHeader>
        <CardContent className="px-0 pt-0">
          <div className="overflow-x-auto">
            <Table className="min-w-[980px] table-fixed">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[150px]">Время</TableHead>
                  <TableHead className="w-[140px]">Действие</TableHead>
                  <TableHead className="w-[180px]">Пользователь</TableHead>
                  <TableHead className="w-[170px]">Сущность</TableHead>
                  <TableHead>Маршрут</TableHead>
                  <TableHead className="w-[90px] text-right">Статус</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading && items.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={6}
                      className="py-10 text-center text-muted-foreground"
                    >
                      Загрузка журнала...
                    </TableCell>
                  </TableRow>
                )}
                {!loading && items.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={6}
                      className="py-10 text-center text-muted-foreground"
                    >
                      Записей пока нет.
                    </TableCell>
                  </TableRow>
                )}
                {items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatDate(item.createdAt)}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={item.statusCode >= 400 ? 'destructive' : 'outline'}
                      >
                        {getActionLabel(item.action)}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="truncate font-medium">
                        {item.account?.name || 'Система'}
                      </div>
                      {item.account?.email && (
                        <div className="truncate text-xs text-muted-foreground">
                          {item.account.email}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="truncate">{item.entityType}</div>
                      {item.entityId && (
                        <div className="text-xs text-muted-foreground">
                          ID {item.entityId}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="truncate font-mono text-xs">
                        {item.method} {item.path}
                      </div>
                      {item.summary && (
                        <div className="mt-1 line-clamp-1 text-xs text-muted-foreground">
                          {item.summary}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {item.statusCode}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="flex items-center justify-between gap-3 border-t px-4 py-3 text-sm text-muted-foreground">
            <span>
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
