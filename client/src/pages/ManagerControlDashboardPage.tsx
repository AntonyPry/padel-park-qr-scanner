import { useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowRight,
  Banknote,
  Building2,
  CalendarClock,
  CalendarDays,
  CheckCircle2,
  Gift,
  Link2,
  ListChecks,
  PhoneMissed,
  RefreshCw,
  TicketCheck,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { ErrorState } from '@/components/error-state';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { apiFetch, getApiErrorMessage, readApiError } from '@/lib/api';
import { cn } from '@/lib/utils';

interface DashboardSection<T> {
  items: T[];
  total: number;
}

interface QueueItemBase {
  actionHref: string;
  actionLabel: string;
  id: number;
  meta?: string | null;
  reason: string;
  title: string;
}

interface PendingSaleItem extends QueueItemBase {
  amount: number;
  createdAt?: string | null;
  type: string;
}

interface ExpiringItem extends QueueItemBase {
  expiresAt?: string | null;
}

interface CorporateItem extends QueueItemBase {
  balance: number;
  contact?: string | null;
}

interface CallTaskItem extends QueueItemBase {
  dueAt?: string | null;
}

interface MissedCallItem extends QueueItemBase {
  startedAt?: string | null;
}

interface ProblemBookingItem extends QueueItemBase {
  paymentStatus: string;
  problemTypes: string[];
  reasons: string[];
  startsAt?: string | null;
  status: string;
}

interface ManagerControlDashboard {
  filters: {
    date: string;
    expiringDays: number;
    limit: number;
    lowBalanceThreshold: number;
  };
  generatedAt: string;
  range: {
    date: string;
    expiringUntil: string;
  };
  sections: {
    expiringCertificates: DashboardSection<ExpiringItem>;
    expiringSubscriptions: DashboardSection<ExpiringItem>;
    lowCorporateBalances: DashboardSection<CorporateItem>;
    missedCalls: DashboardSection<MissedCallItem>;
    overdueCallTasks: DashboardSection<CallTaskItem>;
    pendingSales: DashboardSection<PendingSaleItem>;
    problemBookings: DashboardSection<ProblemBookingItem>;
  };
  summary: {
    attentionTotal: number;
    bookings: number;
    calls: number;
    prepayments: number;
  };
}

const today = new Date().toISOString().slice(0, 10);

function formatDateTime(value?: string | null) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    month: '2-digit',
  }).format(date);
}

function formatDate(value?: string | null) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return new Intl.DateTimeFormat('ru-RU').format(date);
}

function formatMoney(value?: number | string | null) {
  return new Intl.NumberFormat('ru-RU', {
    currency: 'RUB',
    maximumFractionDigits: 0,
    style: 'currency',
  }).format(Number(value || 0));
}

function getProblemLabel(type: string) {
  if (type === 'conflict') return 'Конфликт';
  if (type === 'unpaid') return 'Оплата';
  if (type === 'canceled') return 'Отмена';
  return type;
}

async function fetchDashboard(filters: {
  date: string;
  expiringDays: string;
  lowBalanceThreshold: string;
}) {
  const params = new URLSearchParams({
    date: filters.date,
    expiringDays: filters.expiringDays,
    lowBalanceThreshold: filters.lowBalanceThreshold,
  });
  const response = await apiFetch(`/api/manager-control/dashboard?${params.toString()}`);
  if (!response.ok) {
    const error = await readApiError(response, 'Не удалось загрузить контроль менеджера');
    throw new Error(error.message);
  }
  return (await response.json()) as ManagerControlDashboard;
}

function MetricCard({
  icon,
  label,
  value,
  tone = 'default',
}: {
  icon: ReactNode;
  label: string;
  value: ReactNode;
  tone?: 'default' | 'danger';
}) {
  return (
    <div className="rounded-md border bg-card p-3">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        {icon}
        <span className="truncate">{label}</span>
      </div>
      <div
        className={cn(
          'mt-1 text-2xl font-semibold',
          tone === 'danger' && 'text-destructive',
        )}
      >
        {value}
      </div>
    </div>
  );
}

function Section<T extends QueueItemBase>({
  children,
  emptyText,
  icon,
  section,
  title,
}: {
  children: (item: T) => ReactNode;
  emptyText: string;
  icon: ReactNode;
  section: DashboardSection<T>;
  title: string;
}) {
  return (
    <Card className="rounded-md">
      <CardHeader className="space-y-0 pb-3">
        <CardTitle className="flex min-w-0 items-center gap-2 text-base">
          {icon}
          <span className="min-w-0 flex-1 truncate">{title}</span>
          <Badge variant={section.total > 0 ? 'destructive' : 'secondary'}>
            {section.total}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {section.items.length === 0 && (
          <div className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
            {emptyText}
          </div>
        )}
        {section.items.map((item) => (
          <div key={item.id}>{children(item)}</div>
        ))}
        {section.total > section.items.length && (
          <div className="text-xs text-muted-foreground">
            Еще {section.total - section.items.length} в разделе
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function QueueRow({
  actionHref,
  actionLabel,
  badges,
  meta,
  reason,
  title,
}: {
  actionHref: string;
  actionLabel: string;
  badges?: ReactNode;
  meta?: ReactNode;
  reason: string;
  title: string;
}) {
  return (
    <div className="rounded-md border bg-background p-3">
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <div className="min-w-0 truncate font-medium">{title}</div>
            {badges}
          </div>
          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
            <span className="truncate">{reason}</span>
            {meta && <span className="truncate">{meta}</span>}
          </div>
        </div>
        <Button asChild size="sm" className="shrink-0">
          <Link to={actionHref}>
            {actionLabel}
            <ArrowRight className="ml-2 h-4 w-4" />
          </Link>
        </Button>
      </div>
    </div>
  );
}

export default function ManagerControlDashboardPage() {
  const [date, setDate] = useState(today);
  const [expiringDays, setExpiringDays] = useState('14');
  const [lowBalanceThreshold, setLowBalanceThreshold] = useState('5000');
  const filters = useMemo(
    () => ({ date, expiringDays, lowBalanceThreshold }),
    [date, expiringDays, lowBalanceThreshold],
  );
  const dashboardQuery = useQuery({
    queryKey: ['manager-control-dashboard', filters],
    queryFn: () => fetchDashboard(filters),
  });
  const dashboard = dashboardQuery.data;

  return (
    <div className="min-h-screen bg-muted/30 px-4 py-5 md:px-6">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              <ListChecks className="h-6 w-6 text-primary" />
              <h1 className="truncate text-2xl font-semibold tracking-normal">
                Контроль менеджера
              </h1>
            </div>
            <div className="mt-1 text-sm text-muted-foreground">
              {dashboard
                ? `Обновлено ${formatDateTime(dashboard.generatedAt)}`
                : 'Рабочая очередь загружается'}
            </div>
          </div>

          <div className="grid gap-2 sm:grid-cols-[160px_140px_180px_auto] sm:items-end">
            <div className="grid gap-1">
              <Label className="text-xs text-muted-foreground" htmlFor="manager-control-date">
                Дата броней
              </Label>
              <Input
                id="manager-control-date"
                type="date"
                value={date}
                onChange={(event) => setDate(event.target.value || today)}
              />
            </div>
            <div className="grid gap-1">
              <Label className="text-xs text-muted-foreground" htmlFor="manager-control-expiring">
                Истекают, дней
              </Label>
              <Input
                id="manager-control-expiring"
                inputMode="numeric"
                min={1}
                type="number"
                value={expiringDays}
                onChange={(event) => setExpiringDays(event.target.value)}
              />
            </div>
            <div className="grid gap-1">
              <Label className="text-xs text-muted-foreground" htmlFor="manager-control-balance">
                Баланс ниже
              </Label>
              <Input
                id="manager-control-balance"
                inputMode="numeric"
                min={0}
                type="number"
                value={lowBalanceThreshold}
                onChange={(event) => setLowBalanceThreshold(event.target.value)}
              />
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={() => dashboardQuery.refetch()}
              disabled={dashboardQuery.isFetching}
            >
              <RefreshCw
                className={cn(
                  'mr-2 h-4 w-4',
                  dashboardQuery.isFetching && 'animate-spin',
                )}
              />
              Обновить
            </Button>
          </div>
        </div>

        {dashboardQuery.error && (
          <ErrorState
            message={getApiErrorMessage(
              dashboardQuery.error,
              'Не удалось загрузить контроль менеджера',
            )}
            onRetry={() => dashboardQuery.refetch()}
          />
        )}

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard
            icon={<AlertTriangle className="h-4 w-4" />}
            label="Всего в очереди"
            value={dashboard?.summary.attentionTotal ?? '...'}
            tone={(dashboard?.summary.attentionTotal || 0) > 0 ? 'danger' : 'default'}
          />
          <MetricCard
            icon={<Banknote className="h-4 w-4" />}
            label="Предоплаты"
            value={dashboard?.summary.prepayments ?? '...'}
          />
          <MetricCard
            icon={<PhoneMissed className="h-4 w-4" />}
            label="Звонки и обзвон"
            value={dashboard?.summary.calls ?? '...'}
          />
          <MetricCard
            icon={<CalendarDays className="h-4 w-4" />}
            label={`Брони ${formatDate(dashboard?.range.date || date)}`}
            value={dashboard?.summary.bookings ?? '...'}
          />
        </div>

        {dashboardQuery.isLoading && (
          <div className="rounded-md border bg-card p-6 text-sm text-muted-foreground">
            Загружаем очередь...
          </div>
        )}

        {dashboard && (
          <div className="grid items-start gap-4 xl:grid-cols-2">
            <Section
              emptyText="Нет продаж без клиента"
              icon={<Link2 className="h-4 w-4 text-destructive" />}
              section={dashboard.sections.pendingSales}
              title="Pending sales без клиента"
            >
              {(sale) => (
                <QueueRow
                  actionHref={sale.actionHref}
                  actionLabel={sale.actionLabel}
                  badges={<Badge variant="outline">{sale.type}</Badge>}
                  meta={formatMoney(sale.amount)}
                  reason={sale.reason}
                  title={sale.title}
                />
              )}
            </Section>

            <Section
              emptyText="Нет просроченных задач обзвона"
              icon={<PhoneMissed className="h-4 w-4 text-destructive" />}
              section={dashboard.sections.overdueCallTasks}
              title="Просроченные задачи обзвона"
            >
              {(task) => (
                <QueueRow
                  actionHref={task.actionHref}
                  actionLabel={task.actionLabel}
                  meta={task.dueAt ? `дедлайн ${formatDateTime(task.dueAt)}` : task.meta}
                  reason={task.reason}
                  title={task.title}
                />
              )}
            </Section>

            <Section
              emptyText="Нет пропущенных звонков без результата"
              icon={<PhoneMissed className="h-4 w-4 text-destructive" />}
              section={dashboard.sections.missedCalls}
              title="Пропущенные звонки"
            >
              {(call) => (
                <QueueRow
                  actionHref={call.actionHref}
                  actionLabel={call.actionLabel}
                  meta={call.startedAt ? formatDateTime(call.startedAt) : call.meta}
                  reason={call.reason}
                  title={call.title}
                />
              )}
            </Section>

            <Section
              emptyText="Нет проблемных броней на выбранную дату"
              icon={<CalendarClock className="h-4 w-4 text-destructive" />}
              section={dashboard.sections.problemBookings}
              title="Проблемные брони"
            >
              {(booking) => (
                <QueueRow
                  actionHref={booking.actionHref}
                  actionLabel={booking.actionLabel}
                  badges={booking.problemTypes.map((type) => (
                    <Badge key={type} variant={type === 'conflict' ? 'destructive' : 'outline'}>
                      {getProblemLabel(type)}
                    </Badge>
                  ))}
                  meta={booking.startsAt ? formatDateTime(booking.startsAt) : booking.meta}
                  reason={booking.reasons.join(', ')}
                  title={booking.title}
                />
              )}
            </Section>

            <Section
              emptyText="Нет абонементов, истекающих в выбранный период"
              icon={<TicketCheck className="h-4 w-4 text-amber-600" />}
              section={dashboard.sections.expiringSubscriptions}
              title="Истекающие абонементы"
            >
              {(subscription) => (
                <QueueRow
                  actionHref={subscription.actionHref}
                  actionLabel={subscription.actionLabel}
                  meta={`до ${formatDate(subscription.expiresAt)} · ${subscription.meta}`}
                  reason={subscription.reason}
                  title={subscription.title}
                />
              )}
            </Section>

            <Section
              emptyText="Нет сертификатов, истекающих в выбранный период"
              icon={<Gift className="h-4 w-4 text-amber-600" />}
              section={dashboard.sections.expiringCertificates}
              title="Истекающие сертификаты"
            >
              {(certificate) => (
                <QueueRow
                  actionHref={certificate.actionHref}
                  actionLabel={certificate.actionLabel}
                  meta={`до ${formatDate(certificate.expiresAt)} · ${certificate.meta}`}
                  reason={certificate.reason}
                  title={certificate.title}
                />
              )}
            </Section>

            <Section
              emptyText="Нет корпоративных клиентов с низким балансом"
              icon={<Building2 className="h-4 w-4 text-amber-600" />}
              section={dashboard.sections.lowCorporateBalances}
              title="Низкий корпоративный баланс"
            >
              {(client) => (
                <QueueRow
                  actionHref={client.actionHref}
                  actionLabel={client.actionLabel}
                  badges={<Badge variant="outline">{formatMoney(client.balance)}</Badge>}
                  meta={client.contact}
                  reason={client.reason}
                  title={client.title}
                />
              )}
            </Section>

            {dashboard.summary.attentionTotal === 0 && (
              <div className="rounded-md border bg-card p-5 text-sm text-muted-foreground xl:col-span-2">
                <div className="flex items-center gap-2 font-medium text-foreground">
                  <CheckCircle2 className="h-4 w-4 text-green-600" />
                  Очередь пуста
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
