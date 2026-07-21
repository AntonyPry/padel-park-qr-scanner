import type { ReactNode } from 'react';
import { CalendarDays, Phone } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

export interface ClientProfileOverviewClient {
  birthDate?: string | null;
  createdAt?: string | null;
  name: string;
  note?: string | null;
  phone: string;
  segment?: string | null;
  source?: string | null;
  status?: 'active' | 'archived' | string;
  statusLabel?: string | null;
  telegramId?: string | null;
  training?: {
    latestLevel?: string | null;
  } | null;
  vkId?: string | null;
  webId?: string | null;
  stats?: {
    firstVisitAt?: string | null;
    lastVisitAt?: string | null;
    visitCount?: number;
  } | null;
}

function formatDate(value?: string | null) {
  if (!value) return '-';
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(value.slice(0, 10))
    ? `${value.slice(0, 10)}T00:00:00`
    : value;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return '-';
  return new Intl.DateTimeFormat('ru-RU').format(date);
}

function formatDateTime(value?: string | null) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return new Intl.DateTimeFormat('ru-RU', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(date);
}

export function ClientProfileOverview({
  actions,
  client,
  hidePhone = false,
  showStatus = true,
}: {
  actions?: ReactNode;
  client: ClientProfileOverviewClient;
  hidePhone?: boolean;
  showStatus?: boolean;
}) {
  const externalIds = [
    client.telegramId && `TG: ${client.telegramId}`,
    client.vkId && `VK: ${client.vkId}`,
    client.webId && `WEB: ${client.webId}`,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="space-y-4" data-testid="client-profile-overview">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {showStatus && client.statusLabel && (
            <Badge
              variant="outline"
              className={
                client.status === 'active'
                  ? 'border-transparent bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300'
                  : 'bg-muted text-muted-foreground'
              }
            >
              {client.statusLabel}
            </Badge>
          )}
          {showStatus && client.segment && (
            <span className="text-sm text-muted-foreground">{client.segment}</span>
          )}
          {showStatus && client.training?.latestLevel && (
            <Badge variant="outline">Уровень {client.training.latestLevel}</Badge>
          )}
        </div>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>

      <div
        className={`grid grid-cols-1 gap-3 ${hidePhone ? 'sm:grid-cols-2' : 'sm:grid-cols-3'}`}
      >
        {!hidePhone && (
          <div className="min-w-0 rounded-lg border p-3">
            <div className="text-xs text-muted-foreground">Телефон</div>
            <div className="mt-1 flex min-w-0 items-center gap-2 font-medium">
              <Phone className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="break-words">{client.phone || '-'}</span>
            </div>
          </div>
        )}
        <div className="min-w-0 rounded-lg border p-3">
          <div className="text-xs text-muted-foreground">Визитов</div>
          <div className="mt-1 text-2xl font-bold">{client.stats?.visitCount || 0}</div>
        </div>
        <div className="min-w-0 rounded-lg border p-3">
          <div className="text-xs text-muted-foreground">Последний визит</div>
          <div className="mt-1 flex min-w-0 items-center gap-2 font-medium">
            <CalendarDays className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="break-words">{formatDateTime(client.stats?.lastVisitAt)}</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className="min-w-0 rounded-lg border p-4">
          <div className="mb-3 font-medium">Данные клиента</div>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between gap-3">
              <span className="text-muted-foreground">Откуда о нас узнал клиент</span>
              <span className="min-w-0 break-words text-right">{client.source || '-'}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-muted-foreground">Дата рождения</span>
              <span className="min-w-0 break-words text-right">{formatDate(client.birthDate)}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-muted-foreground">Первый визит</span>
              <span className="min-w-0 break-words text-right">
                {formatDateTime(client.stats?.firstVisitAt)}
              </span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-muted-foreground">Создан</span>
              <span className="min-w-0 break-words text-right">
                {formatDateTime(client.createdAt)}
              </span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-muted-foreground">Внешние ID</span>
              <span className="min-w-0 break-all text-right text-xs">{externalIds || '-'}</span>
            </div>
          </div>
        </div>

        <div className="min-w-0 rounded-lg border p-4">
          <div className="mb-2 font-medium">Заметка</div>
          <div className="min-h-28 whitespace-pre-wrap break-words text-sm text-muted-foreground">
            {client.note || 'Заметка пока не заполнена.'}
          </div>
        </div>
      </div>
    </div>
  );
}
