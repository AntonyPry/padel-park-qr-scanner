import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Building2,
  CalendarClock,
  CircleDollarSign,
  ExternalLink,
  Gift,
  Link2,
  PackageCheck,
  RotateCcw,
  Search,
  SlidersHorizontal,
  TrendingDown,
  WalletCards,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ModuleSwitch } from '@/components/module-switch';
import { ClientProfileDialog } from '@/components/client-profile-dialog';
import { ManualPrepaymentIssueDialog } from '@/components/manual-prepayment-issue-dialog';
import { PrepaymentsMetricsSkeleton } from '@/components/prepayments-page-shell';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { ErrorState } from '@/components/error-state';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { apiFetch, getApiErrorMessage, readApiError } from '@/lib/api';
import { useRealtimeRefresh } from '@/lib/realtime';
import { selectAuthorizationRole } from '@/lib/authorization';
import { useAuth } from '@/lib/useAuth';
import {
  PREPAYMENTS_METRIC_GRID_CLASS,
  PREPAYMENTS_SWITCH_ITEMS,
} from '@/lib/prepayments-layout';

type DashboardType =
  | 'all'
  | 'pending_sales'
  | 'subscriptions'
  | 'certificates'
  | 'corporate_balances';
type DashboardStatus =
  | 'all'
  | 'pending'
  | 'linked'
  | 'ignored'
  | 'active'
  | 'expiring_soon'
  | 'low_balance'
  | 'expired'
  | 'used'
  | 'redeemed'
  | 'canceled'
  | 'archived';
type ExpiryFilter = 'all' | 'expiring_soon' | 'expired' | 'valid';
type BadgeVariant = 'default' | 'secondary' | 'destructive' | 'outline';

interface DashboardClient {
  id: number;
  name: string;
  phone?: string | null;
  status?: string | null;
}

interface DashboardSection<T> {
  available: boolean;
  hiddenReason?: string;
  items: T[];
  total: number;
}

interface DashboardFlags {
  expiringSoon?: boolean;
  lowBalance?: boolean;
  lowRemaining?: boolean;
  needsAttention?: boolean;
  problem?: boolean;
}

interface PendingSaleItem {
  actionHref: string;
  amount: number;
  category?: string | null;
  client?: DashboardClient | null;
  createdAt?: string | null;
  evotorId?: string | null;
  flags: DashboardFlags;
  id: number;
  itemName: string;
  receiptDateTime?: string | null;
  saleIntent: 'subscription' | 'certificate' | string;
  status: string;
}

interface SubscriptionItem {
  actionHref: string;
  client?: DashboardClient | null;
  clientId: number;
  expiresAt?: string | null;
  flags: DashboardFlags;
  id: number;
  isUnlimited: boolean;
  remainingSessions: number | null;
  saleAmount: number;
  sessionsTotal: number | null;
  sessionsUsed: number;
  startsAt?: string | null;
  status: string;
  typeName: string;
}

interface CertificateItem {
  actionHref: string;
  amountRemaining?: number | null;
  amountTotal?: number | null;
  certificateType: 'money' | 'service' | string;
  client?: DashboardClient | null;
  code: string;
  expiresAt?: string | null;
  flags: DashboardFlags;
  id: number;
  saleAmount: number;
  serviceName?: string | null;
  status: string;
  title: string;
  unitsRemaining?: number | null;
  unitsTotal?: number | null;
}

interface CorporateBalanceItem {
  actionHref: string;
  balance: number;
  contactName?: string | null;
  contactPhone?: string | null;
  flags: DashboardFlags;
  id: number;
  name: string;
  status: string;
}

interface DashboardSummary {
  activeCertificates: {
    amountRemaining: number;
    count: number;
    lowBalance: number;
    serviceUnitsRemaining: number;
  };
  activeSubscriptions: {
    count: number;
    expiringSoon: number;
    lowRemaining: number;
    saleAmount: number;
  };
  corporateBalances: {
    count: number;
    lowBalance: number;
    totalBalance: number;
  };
  expiringSoon: {
    certificates: number;
    subscriptions: number;
    total: number;
  };
  pendingSales: {
    amount: number;
    count: number;
  };
}

interface DashboardResponse {
  filters: {
    expiringDays: number;
    expiry: ExpiryFilter;
    limit: number;
    lowBalanceThreshold: number;
    q: string;
    status: DashboardStatus;
    type: DashboardType;
  };
  generatedAt: string;
  permissions: {
    certificates: boolean;
    corporateBalances: boolean;
    pendingSales: boolean;
    subscriptions: boolean;
  };
  sections: {
    certificates: DashboardSection<CertificateItem>;
    corporateBalances: DashboardSection<CorporateBalanceItem>;
    pendingSales: DashboardSection<PendingSaleItem>;
    subscriptions: DashboardSection<SubscriptionItem>;
  };
  summary: DashboardSummary;
}

interface DashboardRefreshError {
  message: string;
  requestChanged: boolean;
}

const TYPE_LABELS: Record<DashboardType, string> = {
  all: 'Все типы',
  certificates: 'Сертификаты',
  corporate_balances: 'Корпоративные',
  pending_sales: 'Очередь продаж',
  subscriptions: 'Абонементы',
};

const STATUS_LABELS: Record<DashboardStatus, string> = {
  active: 'Активные',
  all: 'Все статусы',
  archived: 'Архив',
  canceled: 'Отменены',
  expiring_soon: 'Скоро истекают',
  expired: 'Истекли',
  ignored: 'Игнорированы',
  linked: 'Привязаны',
  low_balance: 'Низкий остаток',
  pending: 'Ожидают',
  redeemed: 'Погашены',
  used: 'Использованы',
};

const EXPIRY_LABELS: Record<ExpiryFilter, string> = {
  all: 'Любой срок',
  expired: 'Истекшие',
  expiring_soon: 'Скоро истекают',
  valid: 'Действующие',
};

const SALE_INTENT_LABELS: Record<string, string> = {
  certificate: 'Сертификат',
  subscription: 'Абонемент',
};

const CERTIFICATE_TYPE_LABELS: Record<string, string> = {
  money: 'Деньги',
  service: 'Услуга',
};

const PENDING_SALES_SECTION_LABELS: Partial<Record<DashboardStatus, string>> = {
  all: 'Все продажи из очереди',
  canceled: 'Отмененные продажи',
  ignored: 'Игнорированные продажи',
  linked: 'Привязанные продажи',
  pending: 'Ожидают привязки',
};

function formatMoney(value?: number | string | null) {
  return new Intl.NumberFormat('ru-RU', {
    currency: 'RUB',
    maximumFractionDigits: 0,
    style: 'currency',
  }).format(Number(value || 0));
}

function formatDate(value?: string | null) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return new Intl.DateTimeFormat('ru-RU').format(date);
}

async function readError(response: Response, fallback: string) {
  const error = await readApiError(response, fallback);
  return error.message;
}

function getStatusVariant(status: string): BadgeVariant {
  if (['active', 'pending'].includes(status)) return 'default';
  if (['expired', 'canceled'].includes(status)) return 'destructive';
  if (['used', 'redeemed', 'linked'].includes(status)) return 'secondary';
  return 'outline';
}

function getStatusLabel(status: string) {
  return STATUS_LABELS[status as DashboardStatus] || status;
}

function balanceText(certificate: CertificateItem) {
  if (certificate.certificateType === 'money') {
    return `${formatMoney(certificate.amountRemaining)} / ${formatMoney(
      certificate.amountTotal,
    )}`;
  }
  return `${certificate.unitsRemaining ?? 0} / ${certificate.unitsTotal ?? 0}`;
}

function clientLabel(client?: DashboardClient | null) {
  if (!client) return 'Клиент не выбран';
  return client.phone ? `${client.name} · ${client.phone}` : client.name;
}

function EmptySection({ text }: { text: string }) {
  return (
    <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
      {text}
    </div>
  );
}

function MetricCard({
  icon: Icon,
  label,
  sublabel,
  value,
}: {
  icon: typeof WalletCards;
  label: string;
  sublabel: string;
  value: string;
}) {
  const isMoney = value.includes('₽');

  return (
    <Card
      size="sm"
      className="min-h-[140px] [container-type:inline-size]"
      data-testid="prepayments-metric-card"
    >
      <CardHeader className="grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1">
        <CardDescription className="min-h-9 min-w-0 whitespace-normal leading-[1.125rem]">
          {label}
        </CardDescription>
        <CardTitle className="flex h-8 min-w-0 items-center leading-none">
          <span
            className={
              isMoney
                ? 'block max-w-full whitespace-nowrap [font-size:clamp(1rem,7cqw,1.5rem)] tabular-nums'
                : 'block whitespace-nowrap text-2xl tabular-nums'
            }
          >
            {value}
          </span>
        </CardTitle>
        <CardAction className="flex size-9 items-center justify-center rounded-md border bg-muted">
          <Icon className="h-4 w-4" />
        </CardAction>
      </CardHeader>
      <CardContent className="min-h-8 text-xs leading-4 text-muted-foreground">
        {sublabel}
      </CardContent>
    </Card>
  );
}

function SectionHeader({
  badge,
  icon: Icon,
  title,
}: {
  badge: number;
  icon: typeof WalletCards;
  title: string;
}) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-center gap-2">
        <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
        <h2 className="truncate text-base font-semibold">{title}</h2>
      </div>
      <Badge variant="outline">{badge}</Badge>
    </div>
  );
}

export default function PrepaymentsPage() {
  const { account, tenantContext, tenantContextEnabled } = useAuth();
  const authority = useMemo(
    () => ({
      accountRole: account?.role,
      tenantContext,
      tenantContextEnabled,
    }),
    [account?.role, tenantContext, tenantContextEnabled],
  );
  const clubRole = selectAuthorizationRole(authority, 'club');
  const [dashboard, setDashboard] = useState<DashboardResponse | null>(null);
  const [initialLoading, setInitialLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [errorText, setErrorText] = useState('');
  const [refreshError, setRefreshError] =
    useState<DashboardRefreshError | null>(null);
  const [searchInput, setSearchInput] = useState('');
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<DashboardType>('all');
  const [statusFilter, setStatusFilter] = useState<DashboardStatus>('all');
  const [expiryFilter, setExpiryFilter] = useState<ExpiryFilter>('all');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [profileClientId, setProfileClientId] = useState<number | null>(null);
  const dashboardRef = useRef<DashboardResponse | null>(null);
  const lastSuccessfulRequestKeyRef = useRef<string | null>(null);
  const latestRequestIdRef = useRef(0);

  const loadDashboard = useCallback(async () => {
    const requestId = latestRequestIdRef.current + 1;
    latestRequestIdRef.current = requestId;
    const hasDashboard = dashboardRef.current !== null;

    if (hasDashboard) {
      setRefreshing(true);
    } else {
      setInitialLoading(true);
      setErrorText('');
      setRefreshError(null);
    }

    const params = new URLSearchParams({ limit: '12' });
    if (query.trim()) params.set('q', query.trim());
    if (typeFilter !== 'all') params.set('type', typeFilter);
    if (statusFilter !== 'all') params.set('status', statusFilter);
    if (expiryFilter !== 'all') params.set('expiry', expiryFilter);
    const requestKey = params.toString();

    try {
      const response = await apiFetch(
        `/api/prepayments/dashboard?${requestKey}`,
      );
      if (requestId !== latestRequestIdRef.current) return;

      if (!response.ok) {
        const message = await readError(response, 'Не удалось загрузить предоплаты');
        if (requestId !== latestRequestIdRef.current) return;
        if (hasDashboard) {
          setRefreshError({
            message,
            requestChanged: lastSuccessfulRequestKeyRef.current !== requestKey,
          });
        } else {
          setErrorText(message);
        }
        return;
      }
      const nextDashboard = (await response.json()) as DashboardResponse;
      if (requestId !== latestRequestIdRef.current) return;
      dashboardRef.current = nextDashboard;
      lastSuccessfulRequestKeyRef.current = requestKey;
      setDashboard(nextDashboard);
      setErrorText('');
      setRefreshError(null);
    } catch (error) {
      if (requestId !== latestRequestIdRef.current) {
        return;
      }
      const message = getApiErrorMessage(error, 'Не удалось загрузить предоплаты');
      if (hasDashboard) {
        setRefreshError({
          message,
          requestChanged: lastSuccessfulRequestKeyRef.current !== requestKey,
        });
      } else {
        setErrorText(message);
      }
    } finally {
      if (requestId === latestRequestIdRef.current) {
        setInitialLoading(false);
        setRefreshing(false);
      }
    }
  }, [expiryFilter, query, statusFilter, typeFilter]);

  useEffect(() => {
    void loadDashboard();
    return () => {
      latestRequestIdRef.current += 1;
    };
  }, [loadDashboard]);

  useRealtimeRefresh(
    [
      'prepayments',
      'prepaymentSales',
      'clientSubscriptions',
      'certificates',
      'corporateClients',
      'catalog',
      'finance',
    ],
    () => {
      void loadDashboard();
    },
  );

  const summaryCards = useMemo(() => {
    if (!dashboard) return [];
    return [
      {
        available: dashboard.sections.pendingSales.available,
        icon: Link2,
        label: 'Ожидают привязки',
        sublabel: `${formatMoney(dashboard.summary.pendingSales.amount)} без клиента`,
        value: String(dashboard.summary.pendingSales.count),
      },
      {
        available: dashboard.sections.subscriptions.available,
        icon: PackageCheck,
        label: 'Активные абонементы',
        sublabel: `${dashboard.summary.activeSubscriptions.expiringSoon} скоро истекают, ${dashboard.summary.activeSubscriptions.lowRemaining} с низким остатком`,
        value: String(dashboard.summary.activeSubscriptions.count),
      },
      {
        available:
          dashboard.sections.subscriptions.available ||
          dashboard.sections.certificates.available,
        icon: CalendarClock,
        label: 'Скоро истекают',
        sublabel: `${dashboard.summary.expiringSoon.subscriptions} абонементов, ${dashboard.summary.expiringSoon.certificates} сертификатов`,
        value: String(dashboard.summary.expiringSoon.total),
      },
      {
        available: dashboard.sections.certificates.available,
        icon: Gift,
        label: 'Активные сертификаты',
        sublabel: `${formatMoney(dashboard.summary.activeCertificates.amountRemaining)} и ${dashboard.summary.activeCertificates.serviceUnitsRemaining} услуг`,
        value: String(dashboard.summary.activeCertificates.count),
      },
      {
        available: dashboard.sections.corporateBalances.available,
        icon: Building2,
        label: 'Корпоративные балансы',
        sublabel: `${dashboard.summary.corporateBalances.lowBalance} с низким остатком`,
        value: formatMoney(dashboard.summary.corporateBalances.totalBalance),
      },
    ].filter((card) => card.available);
  }, [dashboard]);

  const applySearch = () => {
    setQuery(searchInput.trim());
  };

  const resetFilters = () => {
    setSearchInput('');
    setQuery('');
    setTypeFilter('all');
    setStatusFilter('all');
    setExpiryFilter('all');
  };

  const hasFilters =
    query || typeFilter !== 'all' || statusFilter !== 'all' || expiryFilter !== 'all';
  const activeFiltersCount = [typeFilter, statusFilter, expiryFilter].filter(
    (value) => value !== 'all',
  ).length;
  const pendingSalesSectionTitle =
    PENDING_SALES_SECTION_LABELS[statusFilter] || 'Продажи из очереди';

  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-2 rounded-xl border bg-card/60 p-3 xl:grid-cols-[auto_minmax(280px,1fr)_auto_auto] xl:items-center">
        <ModuleSwitch
          authority={authority}
          items={PREPAYMENTS_SWITCH_ITEMS}
          className="shrink-0"
        />
        <div className="flex min-w-0 gap-2">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') applySearch();
              }}
              placeholder="Клиент, сертификат или компания"
            />
          </div>
          <Button type="button" onClick={applySearch} className="shrink-0">
            <Search className="mr-2 h-4 w-4" />
            Найти
          </Button>
        </div>

        <Dialog open={filtersOpen} onOpenChange={setFiltersOpen}>
          <DialogTrigger asChild>
            <Button type="button" variant="outline">
              <SlidersHorizontal className="mr-2 h-4 w-4" />
              Фильтры
              {activeFiltersCount > 0 && (
                <Badge variant="secondary" className="ml-1 rounded-full px-1.5">
                  {activeFiltersCount}
                </Badge>
              )}
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[520px]">
            <DialogHeader>
              <DialogTitle>Фильтры предоплат</DialogTitle>
              <DialogDescription className="sr-only">
                Настройте тип, статус и срок предоплат.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-3 pt-2">
              <Select
                value={typeFilter}
                onValueChange={(value) => setTypeFilter(value as DashboardType)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(TYPE_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select
                value={statusFilter}
                onValueChange={(value) => setStatusFilter(value as DashboardStatus)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(STATUS_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select
                value={expiryFilter}
                onValueChange={(value) => setExpiryFilter(value as ExpiryFilter)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(EXPIRY_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={resetFilters}
                disabled={!hasFilters && !searchInput}
              >
                <RotateCcw className="mr-2 h-4 w-4" />
                Сбросить
              </Button>
              <Button type="button" onClick={() => setFiltersOpen(false)}>
                Готово
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <div className="flex justify-end gap-2">
          <ManualPrepaymentIssueDialog
            authorizationRole={clubRole}
            onIssued={() => void loadDashboard()}
          />
          <Button
            type="button"
            variant="ghost"
            onClick={resetFilters}
            disabled={!hasFilters && !searchInput}
          >
            <RotateCcw className="mr-2 h-4 w-4" />
            Сброс
          </Button>
        </div>
      </div>

      {errorText && (
        <ErrorState
          message={errorText}
          onRetry={() => void loadDashboard()}
          title="Не удалось загрузить сводку"
        />
      )}

      {refreshError && dashboard && (
        <div role="alert" data-testid="prepayments-stale-notice">
          <ErrorState
            compact
            message={
              refreshError.requestChanged
                ? `Показана последняя успешно загруженная сводка. ${refreshError.message}`
                : `Показаны последние успешно загруженные данные. ${refreshError.message}`
            }
            onRetry={() => {
              if (!refreshing) void loadDashboard();
            }}
            title={
              refreshError.requestChanged
                ? 'Поиск и фильтры не применены'
                : 'Сводка не обновлена'
            }
          />
        </div>
      )}

      {initialLoading && !dashboard ? (
        <PrepaymentsMetricsSkeleton />
      ) : (
        <div
          aria-busy={refreshing}
          className={PREPAYMENTS_METRIC_GRID_CLASS}
          data-testid="prepayments-metrics-grid"
        >
          {summaryCards.map((card) => (
            <MetricCard key={card.label} {...card} />
          ))}
        </div>
      )}
      {refreshing && (
        <span className="sr-only" role="status">
          Обновление сводки предоплат
        </span>
      )}

      {dashboard && (
        <div className="grid gap-4 xl:grid-cols-2">
          {dashboard.sections.pendingSales.available && (
            <Card>
            <CardHeader>
              <SectionHeader
                badge={dashboard.sections.pendingSales.total}
                icon={Link2}
                title={pendingSalesSectionTitle}
              />
            </CardHeader>
            <CardContent className="space-y-3">
              {dashboard.sections.pendingSales.items.length === 0 && (
                  <EmptySection text="Продаж по текущим фильтрам нет." />
                )}
              {dashboard.sections.pendingSales.items.map((sale) => (
                <div
                  key={sale.id}
                  className="flex flex-col gap-3 rounded-md border p-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{sale.itemName}</span>
                      <Badge variant={getStatusVariant(sale.status)}>
                        {getStatusLabel(sale.status)}
                      </Badge>
                      <Badge variant="outline">
                        {SALE_INTENT_LABELS[sale.saleIntent] || sale.saleIntent}
                      </Badge>
                    </div>
                    <div className="text-sm text-muted-foreground">
                      {formatMoney(sale.amount)} · {formatDate(sale.receiptDateTime)}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {sale.evotorId || sale.category || `#${sale.id}`}
                    </div>
                  </div>
                  <Button asChild size="sm" className="shrink-0">
                    <Link to={sale.actionHref}>
                      <ExternalLink className="mr-2 h-4 w-4" />
                      {sale.status === 'pending' ? 'Привязать' : 'Открыть'}
                    </Link>
                  </Button>
                </div>
              ))}
            </CardContent>
            </Card>
          )}

          {dashboard.sections.subscriptions.available && (
            <Card>
            <CardHeader>
              <SectionHeader
                badge={dashboard.sections.subscriptions.total}
                icon={PackageCheck}
                title="Абонементы клиентов"
              />
            </CardHeader>
            <CardContent className="space-y-3">
              {dashboard.sections.subscriptions.items.length === 0 && (
                  <EmptySection text="Абонементов по текущим фильтрам нет." />
                )}
              {dashboard.sections.subscriptions.items.map((subscription) => (
                <div
                  key={subscription.id}
                  className="flex flex-col gap-3 rounded-md border p-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{subscription.typeName}</span>
                      <Badge variant={getStatusVariant(subscription.status)}>
                        {getStatusLabel(subscription.status)}
                      </Badge>
                      {subscription.flags.expiringSoon && (
                        <Badge variant="destructive">Срок</Badge>
                      )}
                      {subscription.flags.lowRemaining && (
                        <Badge variant="outline">Остаток</Badge>
                      )}
                    </div>
                    <div className="text-sm text-muted-foreground">
                      {clientLabel(subscription.client)}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {subscription.isUnlimited
                        ? 'Безлимит'
                        : `${subscription.remainingSessions ?? 0} из ${subscription.sessionsTotal ?? 0}`}
                      {' · до '}
                      {formatDate(subscription.expiresAt)}
                    </div>
                  </div>
                  {clubRole === 'admin' ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="shrink-0"
                      onClick={() => setProfileClientId(subscription.clientId)}
                    >
                      Клиент
                    </Button>
                  ) : (
                    <Button asChild size="sm" variant="outline" className="shrink-0">
                      <Link to={subscription.actionHref}>
                        <ExternalLink className="mr-2 h-4 w-4" />
                        Клиент
                      </Link>
                    </Button>
                  )}
                </div>
              ))}
            </CardContent>
            </Card>
          )}

          {dashboard.sections.certificates.available && (
            <Card>
            <CardHeader>
              <SectionHeader
                badge={dashboard.sections.certificates.total}
                icon={Gift}
                title="Сертификаты"
              />
            </CardHeader>
            <CardContent className="space-y-3">
              {dashboard.sections.certificates.items.length === 0 && (
                  <EmptySection text="Сертификатов по текущим фильтрам нет." />
                )}
              {dashboard.sections.certificates.items.map((certificate) => (
                <div
                  key={certificate.id}
                  className="flex flex-col gap-3 rounded-md border p-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{certificate.code}</span>
                      <Badge variant={getStatusVariant(certificate.status)}>
                        {getStatusLabel(certificate.status)}
                      </Badge>
                      <Badge variant="outline">
                        {CERTIFICATE_TYPE_LABELS[certificate.certificateType] ||
                          certificate.certificateType}
                      </Badge>
                      {certificate.flags.expiringSoon && (
                        <Badge variant="destructive">Срок</Badge>
                      )}
                      {certificate.flags.lowBalance && (
                        <Badge variant="outline">Остаток</Badge>
                      )}
                    </div>
                    <div className="text-sm text-muted-foreground">
                      {certificate.title} · {clientLabel(certificate.client)}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {balanceText(certificate)} · до {formatDate(certificate.expiresAt)}
                    </div>
                  </div>
                  <Button asChild size="sm" variant="outline" className="shrink-0">
                    <Link to={certificate.actionHref}>
                      <ExternalLink className="mr-2 h-4 w-4" />
                      Списать
                    </Link>
                  </Button>
                </div>
              ))}
            </CardContent>
            </Card>
          )}

          {dashboard.sections.corporateBalances.available && (
            <Card>
            <CardHeader>
              <SectionHeader
                badge={dashboard.sections.corporateBalances.total}
                icon={Building2}
                title="Корпоративные балансы"
              />
            </CardHeader>
            <CardContent className="space-y-3">
              {dashboard.sections.corporateBalances.items.length === 0 && (
                  <EmptySection text="Компаний по текущим фильтрам нет." />
                )}
              {dashboard.sections.corporateBalances.items.map((client) => (
                <div
                  key={client.id}
                  className="flex flex-col gap-3 rounded-md border p-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{client.name}</span>
                      <Badge variant={getStatusVariant(client.status)}>
                        {getStatusLabel(client.status)}
                      </Badge>
                      {client.flags.lowBalance && (
                        <Badge variant="destructive">
                          <TrendingDown className="h-3 w-3" />
                          Остаток
                        </Badge>
                      )}
                    </div>
                    <div className="text-sm text-muted-foreground">
                      {client.contactName || client.contactPhone || `#${client.id}`}
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <CircleDollarSign className="h-3.5 w-3.5" />
                      {formatMoney(client.balance)}
                    </div>
                  </div>
                  <Button asChild size="sm" variant="outline" className="shrink-0">
                    <Link to={client.actionHref}>
                      <ExternalLink className="mr-2 h-4 w-4" />
                      Детали
                    </Link>
                  </Button>
                </div>
              ))}
            </CardContent>
            </Card>
          )}
        </div>
      )}

      <ClientProfileDialog
        clientId={profileClientId}
        onOpenChange={(open) => {
          if (!open) setProfileClientId(null);
        }}
      />

    </div>
  );
}
