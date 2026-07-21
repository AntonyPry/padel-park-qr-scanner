import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  CalendarClock,
  CalendarDays,
  Loader2,
  Pencil,
  PhoneCall,
  Repeat2,
  Ticket,
  UserRound,
  WalletCards,
} from 'lucide-react';
import { apiFetch, getApiErrorMessage, readApiError } from '@/lib/api';
import { fetchReferences, type ReferenceItem } from '@/lib/references';
import { formatClientPhone } from '@/lib/phone';
import {
  ClientProfileOverview,
  type ClientProfileOverviewClient,
} from '@/components/client-profile-overview';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from '@/components/ui/toast';

interface ClientProfile extends ClientProfileOverviewClient {
  birthDate?: string | null;
  id: number;
  name: string;
  note?: string | null;
  phone: string;
  source: string;
  sourceId?: number | null;
  stats: {
    firstVisitAt?: string | null;
    lastVisitAt?: string | null;
    visitCount: number;
  };
}

interface ClientVisit {
  categories?: Array<{ id: number; name: string }>;
  category?: string | null;
  id: number;
  keyNumber?: string | null;
  scannedAt: string;
}

interface ClientSubscription {
  expiresAt?: string | null;
  id: number;
  isUnlimited: boolean;
  remainingSessions: number | null;
  saleAmount: number;
  sessionsTotal: number | null;
  sessionsUsed: number;
  startsAt: string;
  status: string;
  trainingKind?: string | null;
  typeName: string;
}

interface ClientCertificate {
  amountRemaining?: number | null;
  amountTotal?: number | null;
  certificateType: 'money' | 'service';
  code: string;
  expiresAt?: string | null;
  id: number;
  saleAmount: number;
  serviceName?: string | null;
  startsAt: string;
  status: string;
  title: string;
  unitsRemaining?: number | null;
  unitsTotal?: number | null;
}

interface ClientBooking {
  bookingSeriesId?: number | null;
  cancellationReason?: string | null;
  comment?: string | null;
  court?: { id: number; name: string } | null;
  durationMinutes: number;
  id: number;
  paidAmount: number;
  paymentMethod: string;
  paymentStatus: string;
  price: number;
  startsAt: string;
  status: string;
}

interface ClientBookingSeries {
  court?: { id: number; name: string } | null;
  durationMinutes: number;
  endsOn: string;
  id: number;
  name: string;
  price?: number | null;
  startTime: string;
  startsOn: string;
  status: string;
  weekday: number;
}

interface ClientTimelineItem {
  actor?: { name: string } | null;
  description?: string | null;
  id: string;
  occurredAt: string;
  title: string;
  type: string;
}

interface ClientActiveCallTask {
  assignedTo?: { name: string } | null;
  clientBase?: { name: string } | null;
  deadlineAt?: string | null;
  id: number;
  status: string;
  summary?: string | null;
  title: string;
}

interface ClientProfileResponse {
  activeCallTasks?: ClientActiveCallTask[];
  bookingSeries?: ClientBookingSeries[];
  bookingStats?: {
    activeCount: number;
    canceledCount: number;
    nextBookingAt?: string | null;
    paidAmount: number;
    plannedAmount: number;
    totalCount: number;
    upcomingCount: number;
  };
  bookings?: ClientBooking[];
  client: ClientProfile;
  clientCertificates?: ClientCertificate[];
  clientSubscriptions?: ClientSubscription[];
  duplicateCandidates?: ClientProfile[];
  timeline?: ClientTimelineItem[];
  visits?: ClientVisit[];
}

interface NormalizedClientProfileResponse extends ClientProfileResponse {
  activeCallTasks: ClientActiveCallTask[];
  bookingSeries: ClientBookingSeries[];
  bookingStats: NonNullable<ClientProfileResponse['bookingStats']>;
  bookings: ClientBooking[];
  clientCertificates: ClientCertificate[];
  clientSubscriptions: ClientSubscription[];
  duplicateCandidates: ClientProfile[];
  timeline: ClientTimelineItem[];
  visits: ClientVisit[];
}

const SUBSCRIPTION_STATUS_LABELS: Record<string, string> = {
  active: 'Активен',
  canceled: 'Отменен',
  expired: 'Истек',
  used: 'Использован',
};

const CERTIFICATE_STATUS_LABELS: Record<string, string> = {
  active: 'Активен',
  canceled: 'Отменен',
  expired: 'Истек',
  redeemed: 'Погашен',
};

const BOOKING_STATUS_LABELS: Record<string, string> = {
  arrived: 'Клиент пришел',
  canceled: 'Отменена',
  confirmed: 'Подтверждена',
  new: 'Новая',
  no_show: 'Не пришел',
};

const PAYMENT_STATUS_LABELS: Record<string, string> = {
  paid: 'Оплачено',
  partial: 'Частично',
  refunded: 'Возврат',
  unpaid: 'Не оплачено',
};

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  cash: 'Наличные',
  cashless: 'Безнал',
  mixed: 'Смешанная',
  unknown: 'Не указан',
};

const TIMELINE_TYPE_LABELS: Record<string, string> = {
  booking: 'Бронь',
  booking_series: 'Постоянка',
  call_attempt: 'Попытка звонка',
  call_task: 'Обзвон',
  client_change: 'Изменение',
  prepayment_link: 'Привязка',
  prepayment_redemption: 'Списание',
  prepayment_reversal: 'Отмена списания',
  prepayment_sale: 'Продажа',
  telephony_call: 'Звонок',
  training: 'Тренировка',
  visit: 'Визит',
};

const WEEKDAY_LABELS: Record<number, string> = {
  1: 'Пн',
  2: 'Вт',
  3: 'Ср',
  4: 'Чт',
  5: 'Пт',
  6: 'Сб',
  7: 'Вс',
};

function normalizeProfile(data: ClientProfileResponse): NormalizedClientProfileResponse {
  return {
    ...data,
    activeCallTasks: data.activeCallTasks || [],
    bookingSeries: data.bookingSeries || [],
    bookingStats: data.bookingStats || {
      activeCount: 0,
      canceledCount: 0,
      nextBookingAt: null,
      paidAmount: 0,
      plannedAmount: 0,
      totalCount: 0,
      upcomingCount: 0,
    },
    bookings: data.bookings || [],
    clientCertificates: data.clientCertificates || [],
    clientSubscriptions: data.clientSubscriptions || [],
    duplicateCandidates: data.duplicateCandidates || [],
    timeline: data.timeline || [],
    visits: data.visits || [],
  };
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

function formatCurrency(value?: number | null) {
  return `${Number(value || 0).toLocaleString('ru-RU')} ₽`;
}

function formatVisitCategories(visit: ClientVisit) {
  const categories = visit.categories?.map((category) => category.name).filter(Boolean);
  return categories && categories.length > 0 ? categories.join(', ') : visit.category || '-';
}

function getPhoneHref(value: string) {
  const digits = value.replace(/\D/g, '');
  const local = digits.length > 10 ? digits.slice(-10) : digits;
  return local.length === 10 ? `tel:+7${local}` : undefined;
}

function formatSubscriptionRemaining(subscription: ClientSubscription) {
  if (subscription.isUnlimited) return 'Безлимит';
  return `${subscription.remainingSessions ?? 0} из ${subscription.sessionsTotal ?? 0}`;
}

function formatCertificateBalance(certificate: ClientCertificate) {
  if (certificate.certificateType === 'money') {
    return `${formatCurrency(certificate.amountRemaining)} из ${formatCurrency(certificate.amountTotal)}`;
  }
  return `${certificate.unitsRemaining ?? 0} из ${certificate.unitsTotal ?? 0}`;
}

function EmptySection({ children }: { children: string }) {
  return (
    <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}

export function ClientProfileDialog({
  clientId,
  onOpenChange,
}: {
  clientId: number | null;
  onOpenChange: (open: boolean) => void;
}) {
  const [details, setDetails] = useState<NormalizedClientProfileResponse | null>(null);
  const [sources, setSources] = useState<ReferenceItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    birthDate: '',
    name: '',
    note: '',
    phone: '',
    sourceId: '',
  });

  const load = useCallback(async () => {
    if (!clientId) return;
    setLoading(true);
    setError('');
    try {
      const [response, referenceItems] = await Promise.all([
        apiFetch(`/api/clients/${clientId}`),
        fetchReferences('client-sources'),
      ]);
      if (!response.ok) {
        const apiError = await readApiError(response, 'Не удалось открыть карточку клиента');
        setError(apiError.message);
        return;
      }
      const data = normalizeProfile((await response.json()) as ClientProfileResponse);
      setDetails(data);
      setSources(referenceItems);
      setForm({
        birthDate: data.client.birthDate || '',
        name: data.client.name,
        note: data.client.note || '',
        phone: data.client.phone,
        sourceId: data.client.sourceId ? String(data.client.sourceId) : '',
      });
    } catch (loadError) {
      setError(getApiErrorMessage(loadError, 'Не удалось открыть карточку клиента'));
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  useEffect(() => {
    if (!clientId) {
      setDetails(null);
      setEditing(false);
      setError('');
      return;
    }
    void load();
  }, [clientId, load]);

  const activeSubscriptions = useMemo(
    () => details?.clientSubscriptions.filter((item) => item.status === 'active') || [],
    [details],
  );
  const activeCertificates = useMemo(
    () => details?.clientCertificates.filter((item) => item.status === 'active') || [],
    [details],
  );

  const save = async () => {
    if (!clientId || form.name.trim().length < 2) return;
    setSaving(true);
    try {
      const response = await apiFetch(`/api/clients/${clientId}`, {
        body: JSON.stringify({
          birthDate: form.birthDate || null,
          name: form.name.trim(),
          note: form.note.trim(),
          phone: form.phone,
          sourceId: form.sourceId ? Number(form.sourceId) : undefined,
        }),
        method: 'PUT',
      });
      if (!response.ok) {
        const apiError = await readApiError(response, 'Не удалось сохранить клиента');
        toast.error(apiError.message);
        return;
      }
      setEditing(false);
      await load();
      toast.success('Карточка клиента обновлена');
    } catch (saveError) {
      toast.error(getApiErrorMessage(saveError, 'Не удалось сохранить клиента'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={Boolean(clientId)} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-1rem)] max-w-[calc(100vw-1rem)] overflow-y-auto p-3 sm:max-w-[980px] sm:p-4">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 pr-8">
            <UserRound className="h-5 w-5 text-primary" />
            {details?.client.name || 'Карточка клиента'}
          </DialogTitle>
          <DialogDescription>
            Данные клиента, предоплаты, бронирования и история визитов.
          </DialogDescription>
        </DialogHeader>

        {loading && !details ? (
          <div className="flex min-h-48 items-center justify-center text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Загрузка...
          </div>
        ) : error ? (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
            {error}
          </div>
        ) : details && editing ? (
          <div className="grid gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="monitor-client-name">Имя и фамилия</Label>
                <Input
                  id="monitor-client-name"
                  value={form.name}
                  onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="monitor-client-phone">Телефон</Label>
                <Input
                  id="monitor-client-phone"
                  value={form.phone}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      phone: formatClientPhone(event.target.value),
                    }))
                  }
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="monitor-client-birth-date">Дата рождения</Label>
                <Input
                  id="monitor-client-birth-date"
                  max={new Date().toISOString().slice(0, 10)}
                  type="date"
                  value={form.birthDate}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, birthDate: event.target.value }))
                  }
                />
              </div>
              <div className="grid gap-1.5">
                <Label>Откуда о нас узнал клиент</Label>
                <Select
                  value={form.sourceId}
                  onValueChange={(sourceId) => setForm((current) => ({ ...current, sourceId }))}
                >
                  <SelectTrigger><SelectValue placeholder="Выберите источник" /></SelectTrigger>
                  <SelectContent>
                    {sources.map((source) => (
                      <SelectItem key={source.id} value={String(source.id)}>
                        {source.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="monitor-client-note">Заметка</Label>
              <textarea
                id="monitor-client-note"
                className="min-h-28 rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                value={form.note}
                onChange={(event) => setForm((current) => ({ ...current, note: event.target.value }))}
              />
            </div>
          </div>
        ) : details ? (
          <Tabs defaultValue="overview" className="min-w-0 max-w-full overflow-hidden">
            <div className="sticky top-0 z-20 min-w-0 border-b bg-background/95 py-2 backdrop-blur">
              <TabsList className="w-full justify-start overflow-x-auto">
                <TabsTrigger value="overview">Обзор</TabsTrigger>
                <TabsTrigger value="prepayments">
                  Предоплаты
                  {(activeSubscriptions.length + activeCertificates.length) > 0 && (
                    <Badge variant="secondary" className="ml-1 px-1.5 py-0 text-[10px]">
                      {activeSubscriptions.length + activeCertificates.length}
                    </Badge>
                  )}
                </TabsTrigger>
                <TabsTrigger value="bookings">Бронирования</TabsTrigger>
                <TabsTrigger value="history">История</TabsTrigger>
              </TabsList>
            </div>

            <TabsContent value="overview" className="min-w-0 max-w-full space-y-4">
              <ClientProfileOverview
                client={details.client}
                actions={
                  <>
                    {getPhoneHref(details.client.phone) && (
                      <Button asChild type="button" variant="outline" size="sm">
                        <a href={getPhoneHref(details.client.phone)}>
                          <PhoneCall className="mr-2 h-4 w-4" /> Позвонить
                        </a>
                      </Button>
                    )}
                    <Button type="button" variant="outline" size="sm" onClick={() => setEditing(true)}>
                      <Pencil className="mr-2 h-4 w-4" /> Изменить
                    </Button>
                  </>
                }
              />

              <div className="rounded-lg border">
                <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
                  <div>
                    <div className="font-medium">Активные задачи</div>
                    <div className="text-sm text-muted-foreground">Текущие задачи по работе с клиентом.</div>
                  </div>
                  <Badge variant="outline">{details.activeCallTasks.length}</Badge>
                </div>
                <div className="space-y-2 p-3">
                  {details.activeCallTasks.length === 0 ? (
                    <EmptySection>Активных задач по клиенту нет.</EmptySection>
                  ) : details.activeCallTasks.map((task) => (
                    <div key={task.id} className="rounded-lg border p-3 text-sm">
                      <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                        <div className="font-medium">{task.title}</div>
                        <Badge variant="outline">{task.status}</Badge>
                      </div>
                      <div className="mt-2 text-muted-foreground">
                        {task.clientBase?.name || 'Без базы'} · до {formatDateTime(task.deadlineAt)}
                      </div>
                      {task.assignedTo?.name && (
                        <div className="mt-1 text-muted-foreground">Ответственный: {task.assignedTo.name}</div>
                      )}
                      {task.summary && <div className="mt-2 whitespace-pre-wrap">{task.summary}</div>}
                    </div>
                  ))}
                </div>
              </div>

              {details.duplicateCandidates.length > 0 && (
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4">
                  <div className="font-medium">Возможные дубли</div>
                  <div className="mt-1 text-sm text-muted-foreground">
                    Найдено похожих карточек: {details.duplicateCandidates.length}. Объединение доступно владельцу или менеджеру в разделе «Клиенты».
                  </div>
                </div>
              )}
            </TabsContent>

            <TabsContent value="prepayments" className="min-w-0 max-w-full space-y-4">
              <div className="rounded-lg border">
                <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
                  <div className="flex items-center gap-2 font-medium">
                    <Ticket className="h-4 w-4 text-muted-foreground" /> Абонементы
                  </div>
                  <Badge variant="outline">{activeSubscriptions.length} активных</Badge>
                </div>
                <div className="grid gap-3 p-3 md:grid-cols-2">
                  {details.clientSubscriptions.length === 0 ? (
                    <div className="md:col-span-2"><EmptySection>Абонементов пока нет.</EmptySection></div>
                  ) : details.clientSubscriptions.map((subscription) => (
                    <div key={subscription.id} className="rounded-lg border p-3 text-sm">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 font-medium">{subscription.typeName}</div>
                        <Badge variant={subscription.status === 'active' ? 'default' : 'outline'}>
                          {SUBSCRIPTION_STATUS_LABELS[subscription.status] || subscription.status}
                        </Badge>
                      </div>
                      <div className="mt-3 text-lg font-semibold">{formatSubscriptionRemaining(subscription)}</div>
                      <div className="text-xs text-muted-foreground">осталось · использовано {subscription.sessionsUsed}</div>
                      <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                        <div>С {formatDate(subscription.startsAt)}</div>
                        <div>До {formatDate(subscription.expiresAt)}</div>
                        <div className="col-span-2">Оплата: {formatCurrency(subscription.saleAmount)}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-lg border">
                <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
                  <div className="flex items-center gap-2 font-medium">
                    <WalletCards className="h-4 w-4 text-muted-foreground" /> Сертификаты
                  </div>
                  <Badge variant="outline">{activeCertificates.length} активных</Badge>
                </div>
                <div className="grid gap-3 p-3 md:grid-cols-2">
                  {details.clientCertificates.length === 0 ? (
                    <div className="md:col-span-2"><EmptySection>Сертификатов пока нет.</EmptySection></div>
                  ) : details.clientCertificates.map((certificate) => (
                    <div key={certificate.id} className="rounded-lg border p-3 text-sm">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="font-medium">{certificate.title}</div>
                          <div className="mt-1 font-mono text-xs text-muted-foreground">{certificate.code}</div>
                        </div>
                        <Badge variant={certificate.status === 'active' ? 'default' : 'outline'}>
                          {CERTIFICATE_STATUS_LABELS[certificate.status] || certificate.status}
                        </Badge>
                      </div>
                      <div className="mt-3 text-lg font-semibold">{formatCertificateBalance(certificate)}</div>
                      <div className="text-xs text-muted-foreground">
                        {certificate.certificateType === 'money' ? 'денежный' : certificate.serviceName || 'услуга'}
                      </div>
                      <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                        <div>С {formatDate(certificate.startsAt)}</div>
                        <div>До {formatDate(certificate.expiresAt)}</div>
                        <div className="col-span-2">Оплата: {formatCurrency(certificate.saleAmount)}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </TabsContent>

            <TabsContent value="bookings" className="min-w-0 max-w-full space-y-4">
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <div className="rounded-lg border p-3">
                  <div className="text-xs text-muted-foreground">Активных</div>
                  <div className="mt-1 text-xl font-semibold">{details.bookingStats.activeCount}</div>
                </div>
                <div className="rounded-lg border p-3">
                  <div className="text-xs text-muted-foreground">Следующая</div>
                  <div className="mt-1 text-sm font-medium">{formatDateTime(details.bookingStats.nextBookingAt)}</div>
                </div>
                <div className="rounded-lg border p-3">
                  <div className="text-xs text-muted-foreground">План</div>
                  <div className="mt-1 text-xl font-semibold">{formatCurrency(details.bookingStats.plannedAmount)}</div>
                </div>
                <div className="rounded-lg border p-3">
                  <div className="text-xs text-muted-foreground">Оплачено</div>
                  <div className="mt-1 text-xl font-semibold">{formatCurrency(details.bookingStats.paidAmount)}</div>
                </div>
              </div>

              {details.bookingSeries.length > 0 && (
                <div className="rounded-lg border">
                  <div className="flex items-center gap-2 border-b px-4 py-3 font-medium">
                    <Repeat2 className="h-4 w-4 text-muted-foreground" /> Постоянки клиента
                  </div>
                  <div className="divide-y">
                    {details.bookingSeries.slice(0, 5).map((series) => (
                      <div key={series.id} className="flex flex-col gap-2 p-3 text-sm sm:flex-row sm:items-center sm:justify-between">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-medium">{series.name}</span>
                            <Badge variant="outline">{series.status === 'active' ? 'Активна' : 'Архив'}</Badge>
                          </div>
                          <div className="mt-1 text-muted-foreground">
                            {series.court?.name || 'Корт не указан'} · {WEEKDAY_LABELS[series.weekday] || series.weekday} {series.startTime} · {series.durationMinutes} мин
                          </div>
                        </div>
                        <div className="shrink-0 text-muted-foreground">
                          {series.price == null ? 'По тарифам' : formatCurrency(series.price)}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="min-w-0 max-w-full overflow-hidden rounded-lg border">
                <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
                  <div className="flex items-center gap-2 font-medium">
                    <CalendarClock className="h-4 w-4 text-muted-foreground" /> Бронирования
                  </div>
                  <Badge variant="outline">{details.bookingStats.totalCount} всего</Badge>
                </div>
                <div className="min-w-0 max-w-full overflow-hidden">
                  <Table className="min-w-[720px]" containerClassName="max-w-full">
                    <TableHeader>
                      <TableRow>
                        <TableHead>Дата</TableHead><TableHead>Корт</TableHead><TableHead>Статус</TableHead><TableHead>Оплата</TableHead><TableHead>Комментарий</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {details.bookings.length === 0 ? (
                        <TableRow><TableCell colSpan={5} className="py-8 text-center text-muted-foreground">Бронирований пока нет</TableCell></TableRow>
                      ) : details.bookings.slice(0, 12).map((booking) => (
                        <TableRow key={booking.id}>
                          <TableCell><div className="font-medium">{formatDateTime(booking.startsAt)}</div><div className="text-xs text-muted-foreground">{booking.durationMinutes} мин</div></TableCell>
                          <TableCell>{booking.court?.name || '-'}</TableCell>
                          <TableCell><Badge variant="outline">{BOOKING_STATUS_LABELS[booking.status] || booking.status}</Badge></TableCell>
                          <TableCell><div>{PAYMENT_STATUS_LABELS[booking.paymentStatus] || booking.paymentStatus}</div><div className="text-xs text-muted-foreground">{formatCurrency(booking.paidAmount)} из {formatCurrency(booking.price)} · {PAYMENT_METHOD_LABELS[booking.paymentMethod] || booking.paymentMethod}</div></TableCell>
                          <TableCell className="max-w-56 truncate text-muted-foreground">{booking.comment || booking.cancellationReason || '-'}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="history" className="min-w-0 max-w-full space-y-4">
              <div className="min-w-0 max-w-full overflow-hidden rounded-lg border">
                <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
                  <div className="flex items-center gap-2 font-medium">
                    <Activity className="h-4 w-4 text-muted-foreground" /> Лента клиента
                  </div>
                  <Badge variant="outline">{details.timeline.length} событий</Badge>
                </div>
                <div className="max-h-[420px] space-y-2 overflow-y-auto p-3">
                  {details.timeline.length === 0 ? (
                    <EmptySection>История клиента пока пустая.</EmptySection>
                  ) : details.timeline.map((item) => (
                    <div key={item.id} className="rounded-lg border p-3 text-sm">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge variant="outline">{TIMELINE_TYPE_LABELS[item.type] || item.type}</Badge>
                            <span className="font-medium">{item.title}</span>
                          </div>
                          {item.actor?.name && <div className="mt-1 text-xs text-muted-foreground">{item.actor.name}</div>}
                        </div>
                        <div className="shrink-0 text-muted-foreground">{formatDateTime(item.occurredAt)}</div>
                      </div>
                      {item.description && <div className="mt-2 whitespace-pre-wrap break-words text-muted-foreground">{item.description}</div>}
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-lg border">
                <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
                  <div className="flex items-center gap-2 font-medium">
                    <CalendarDays className="h-4 w-4 text-muted-foreground" /> История визитов
                  </div>
                  <Badge variant="outline">{details.visits.length}</Badge>
                </div>
                <div className="min-w-0 max-w-full overflow-hidden">
                  <Table className="min-w-[620px]" containerClassName="max-w-full">
                    <TableHeader><TableRow><TableHead>Дата</TableHead><TableHead>Цель визита</TableHead><TableHead>Ключ</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {details.visits.length === 0 ? (
                        <TableRow><TableCell colSpan={3} className="py-8 text-center text-muted-foreground">Визитов пока нет</TableCell></TableRow>
                      ) : details.visits.map((visit) => (
                        <TableRow key={visit.id}>
                          <TableCell>{formatDateTime(visit.scannedAt)}</TableCell>
                          <TableCell className="text-muted-foreground">{formatVisitCategories(visit)}</TableCell>
                          <TableCell>{visit.keyNumber ? <Badge variant="outline">№{visit.keyNumber}</Badge> : '-'}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            </TabsContent>
          </Tabs>
        ) : null}

        {details && editing && (
          <DialogFooter>
            <Button type="button" variant="outline" disabled={saving} onClick={() => setEditing(false)}>
              Отмена
            </Button>
            <Button type="button" disabled={saving || form.name.trim().length < 2} onClick={() => void save()}>
              {saving ? 'Сохраняем...' : 'Сохранить'}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
