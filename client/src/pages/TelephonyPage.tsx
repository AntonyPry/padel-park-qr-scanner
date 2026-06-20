import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CheckCircle2,
  Clock,
  Copy,
  EyeOff,
  FileAudio,
  LinkIcon,
  PhoneCall,
  PhoneIncoming,
  RefreshCw,
  RotateCw,
  Save,
  Settings,
  TriangleAlert,
  UserPlus,
} from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
import { toast } from '@/components/ui/toast';
import { listClients, type ClientListItem } from '@/api/clients';
import {
  HelpTooltip,
  MetricCard,
  MetricLabel,
} from '@/components/dashboard-metric';
import {
  checkBeelineSubscription,
  completeTelephonyCall,
  createTelephonyCallClient,
  getTelephonyCall,
  getTelephonyCalls,
  getTelephonyConfig,
  getTelephonyRawEvents,
  getTelephonyReport,
  getTelephonyStats,
  ignoreTelephonyCall,
  linkTelephonyCallClient,
  refreshTelephonyRecordingReference,
  reprocessTelephonyRawEvent,
  subscribeBeelineEvents,
  syncBeelineRecordings,
  syncBeelineStatistics,
  type CompleteTelephonyCallPayload,
  type TelephonyCall,
  type TelephonyDirection,
  type TelephonyInterest,
  type TelephonyProcessingStatus,
  type TelephonyResult,
} from '@/api/telephony';
import { queryKeys } from '@/api/query-keys';
import { fetchReferences } from '@/lib/references';
import {
  canManageTelephony,
  canWorkTelephony,
} from '@/lib/permissions';
import { getApiErrorMessage } from '@/lib/api';
import { useAuth } from '@/lib/useAuth';

const PAGE_SIZE = 20;
const RECORDING_LINK_REFRESH_MS = 2 * 60 * 1000;

const PROCESSING_LABELS: Record<TelephonyProcessingStatus, string> = {
  ignored: 'Скрыт',
  in_progress: 'В обработке',
  new: 'Новый',
  processed: 'Обработан',
};

const DIRECTION_LABELS: Record<TelephonyDirection, string> = {
  inbound: 'Входящий',
  outbound: 'Исходящий',
  unknown: 'Неизвестно',
};

const RESULT_LABELS: Record<TelephonyResult, string> = {
  booked: 'Записался',
  callback: 'Перезвонить',
  complaint: 'Жалоба',
  corporate: 'Корпоратив',
  no_answer: 'Не взял трубку',
  other: 'Другое',
  refused: 'Отказ',
  thinking: 'Думает',
};

const INTEREST_LABELS: Record<TelephonyInterest, string> = {
  corporate: 'Корпоратив',
  game: 'Игра',
  master_class: 'Мастер-класс',
  other: 'Другое',
  tournament: 'Турнир',
  training: 'Тренировка',
};

const RECORDING_LABELS: Record<TelephonyCall['recordingStatus'], string> = {
  available: 'Есть',
  missing: 'Нет',
  pending: 'Готовится',
  unknown: 'Неизвестно',
};

const SUBSCRIPTION_LABELS = {
  active: 'Активна',
  disabled: 'Выключена',
  expired: 'Истекла',
  failed: 'Ошибка',
  unknown: 'Неизвестно',
} as const;

const RAW_EVENT_STATUS_LABELS = {
  failed: 'Ошибка',
  new: 'Новое',
  processed: 'Обработано',
} as const;

interface CompletionForm {
  interest: TelephonyInterest | 'none';
  nextActionAt: string;
  nextActionText: string;
  result: TelephonyResult;
  summary: string;
}

interface ClientCallForm {
  name: string;
  note: string;
  sourceId: string;
}

const EMPTY_FORM: CompletionForm = {
  interest: 'none',
  nextActionAt: '',
  nextActionText: '',
  result: 'booked',
  summary: '',
};

const EMPTY_CLIENT_FORM: ClientCallForm = {
  name: '',
  note: '',
  sourceId: '',
};

function formatDateTime(value?: string | null) {
  if (!value) return 'Не указано';
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    month: '2-digit',
    year: '2-digit',
  }).format(new Date(value));
}

function formatDuration(seconds?: number | null) {
  if (seconds === null || seconds === undefined) return 'Длительность неизвестна';
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}:${String(rest).padStart(2, '0')}`;
}

function formatDurationCompact(seconds?: number | null) {
  if (seconds === null || seconds === undefined) return 'длит. неизвестна';
  return formatDuration(seconds);
}

function formatPercent(value?: number | null) {
  return `${Math.round(Number(value || 0) * 100)}%`;
}

function toDateInputValue(value: Date) {
  return [
    value.getFullYear(),
    String(value.getMonth() + 1).padStart(2, '0'),
    String(value.getDate()).padStart(2, '0'),
  ].join('-');
}

function toDateTimeInputValue(value?: string | null) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const offsetDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return offsetDate.toISOString().slice(0, 16);
}

function dateTimeInputToIso(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function getDefaultReportRange() {
  const to = new Date();
  const from = new Date(to);
  from.setDate(from.getDate() - 29);
  return {
    from: toDateInputValue(from),
    to: toDateInputValue(to),
  };
}

function formatFileSize(bytes?: number | null) {
  if (!bytes) return null;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} КБ`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
}

function getStatusVariant(status: TelephonyProcessingStatus) {
  if (status === 'processed') return 'default';
  if (status === 'ignored') return 'secondary';
  if (status === 'in_progress') return 'outline';
  return 'destructive';
}

function getRawEventStatusVariant(status: keyof typeof RAW_EVENT_STATUS_LABELS) {
  if (status === 'processed') return 'outline';
  if (status === 'failed') return 'destructive';
  return 'secondary';
}

function formatPayloadPreview(payload: unknown) {
  const formatted = JSON.stringify(payload, null, 2) || '';
  return formatted.length > 900 ? `${formatted.slice(0, 900)}...` : formatted;
}

function shouldRefreshRecordingLink(call: TelephonyCall) {
  if (!call.recordingUrl) return true;
  if (!call.recordingExpiresAt) return false;

  const expiresAt = new Date(call.recordingExpiresAt).getTime();
  return Number.isFinite(expiresAt) && expiresAt <= Date.now() + RECORDING_LINK_REFRESH_MS;
}

function buildPayload(form: CompletionForm): CompleteTelephonyCallPayload {
  return {
    interest: form.interest === 'none' ? null : form.interest,
    nextActionAt: dateTimeInputToIso(form.nextActionAt),
    nextActionText: form.nextActionText || null,
    result: form.result,
    summary: form.summary || null,
  };
}

function getDefaultForm(call: TelephonyCall | null): CompletionForm {
  if (!call) return EMPTY_FORM;

  return {
    interest: call.interest || 'none',
    nextActionAt: toDateTimeInputValue(call.nextActionAt),
    nextActionText: call.nextActionText || '',
    result: call.result || (call.callStatus === 'missed' ? 'no_answer' : 'booked'),
    summary: call.summary || '',
  };
}

function getClientSearchValue(call: TelephonyCall) {
  return call.clientPhone || call.client?.phone || call.client?.name || '';
}

function getClientVisitSummary(client: ClientListItem) {
  const visitCount = client.stats?.visitCount ?? 0;
  const lastVisit = client.stats?.lastVisitAt
    ? formatDateTime(client.stats.lastVisitAt)
    : 'визитов не было';

  return `${visitCount} визитов · последний: ${lastVisit}`;
}

export default function TelephonyPage() {
  const { account } = useAuth();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialQuery = searchParams.get('q') || '';
  const initialStatus = searchParams.get('status') || 'active';
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState(
    ['active', 'all', 'ignored', 'in_progress', 'missed', 'new', 'processed']
      .includes(initialStatus)
      ? initialStatus
      : 'active',
  );
  const [callStatus, setCallStatus] = useState('all');
  const [recordingStatus, setRecordingStatus] = useState('all');
  const [direction, setDirection] = useState('all');
  const [query, setQuery] = useState(initialQuery.trim());
  const [searchInput, setSearchInput] = useState(initialQuery);
  const [reportRange, setReportRange] = useState(getDefaultReportRange);
  const [selectedCall, setSelectedCall] = useState<TelephonyCall | null>(null);
  const openedCallIdRef = useRef<number | null>(null);
  const [form, setForm] = useState<CompletionForm>(EMPTY_FORM);
  const [clientDialogCall, setClientDialogCall] = useState<TelephonyCall | null>(null);
  const [clientSearch, setClientSearch] = useState('');
  const [clientSearchInput, setClientSearchInput] = useState('');
  const [clientForm, setClientForm] = useState<ClientCallForm>(EMPTY_CLIENT_FORM);

  const canManage = canManageTelephony(account?.role);
  const canWork = canWorkTelephony(account?.role);

  const listParams = useMemo(
    () => ({
      direction: direction === 'all' ? undefined : direction,
      callStatus: callStatus === 'all' ? undefined : callStatus,
      recordingStatus: recordingStatus === 'all' ? undefined : recordingStatus,
      page,
      pageSize: PAGE_SIZE,
      q: query,
      status,
    }),
    [callStatus, direction, page, query, recordingStatus, status],
  );

  const callsQuery = useQuery({
    queryKey: queryKeys.telephony.calls(listParams),
    queryFn: () => getTelephonyCalls(listParams),
  });
  const reportParams = useMemo(
    () => ({
      from: reportRange.from,
      to: reportRange.to,
    }),
    [reportRange.from, reportRange.to],
  );
  const reportQuery = useQuery({
    queryKey: queryKeys.telephony.report(reportParams),
    queryFn: () => getTelephonyReport(reportParams),
  });
  const statsQuery = useQuery({
    queryKey: queryKeys.telephony.stats(),
    queryFn: getTelephonyStats,
  });
  const configQuery = useQuery({
    enabled: canManage,
    queryKey: queryKeys.telephony.config(),
    queryFn: getTelephonyConfig,
  });
  const rawEventsQuery = useQuery({
    enabled: canManage,
    queryKey: queryKeys.telephony.rawEvents({ page: 1, pageSize: 5, status: 'all' }),
    queryFn: () => getTelephonyRawEvents({ page: 1, pageSize: 5, status: 'all' }),
  });
  const clientSourcesQuery = useQuery({
    enabled: canWork && Boolean(clientDialogCall),
    queryKey: queryKeys.references.list('client-sources', 'active'),
    queryFn: () => fetchReferences('client-sources', 'active'),
  });
  const clientSearchParams = useMemo(
    () => ({
      page: 1,
      pageSize: 8,
      q: clientSearch,
      status: 'active' as const,
    }),
    [clientSearch],
  );
  const clientSearchQuery = useQuery({
    enabled: canWork && Boolean(clientDialogCall) && clientSearch.trim().length > 0,
    queryKey: queryKeys.clients.list(clientSearchParams),
    queryFn: () => listClients(clientSearchParams),
  });
  const beelineApiReady = Boolean(
    configQuery.data?.apiTokenConfigured && configQuery.data?.apiBaseUrl,
  );
  const beelineXsiReady = Boolean(beelineApiReady && configQuery.data?.callbackUrl);

  useEffect(() => {
    const requestedCallId = Number(searchParams.get('callId') || 0);
    if (!requestedCallId || selectedCall?.id === requestedCallId || !canWork) return;
    if (openedCallIdRef.current === requestedCallId) return;

    let cancelled = false;
    openedCallIdRef.current = requestedCallId;
    getTelephonyCall(requestedCallId)
      .then((call) => {
        if (cancelled) return;
        setSelectedCall(call);
        setForm(getDefaultForm(call));
      })
      .catch((error) => {
        if (!cancelled) {
          toast.error(getApiErrorMessage(error, 'Не удалось открыть звонок'));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [canWork, searchParams, selectedCall?.id]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      const nextQuery = searchInput.trim();
      setPage(1);
      setQuery(nextQuery);

      if ((searchParams.get('q') || '') !== nextQuery) {
        const nextSearchParams = new URLSearchParams(searchParams);
        if (nextQuery) {
          nextSearchParams.set('q', nextQuery);
        } else {
          nextSearchParams.delete('q');
        }
        setSearchParams(nextSearchParams, { replace: true });
      }
    }, 250);

    return () => window.clearTimeout(timeout);
  }, [searchInput, searchParams, setSearchParams]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setClientSearch(clientSearchInput.trim());
    }, 250);

    return () => window.clearTimeout(timeout);
  }, [clientSearchInput]);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.telephony.all });
    void queryClient.invalidateQueries({ queryKey: queryKeys.clients.all });
    void queryClient.invalidateQueries({ queryKey: ['callTasks'] });
  };

  const completeMutation = useMutation({
    mutationFn: ({ callId, payload }: { callId: number; payload: CompleteTelephonyCallPayload }) =>
      completeTelephonyCall(callId, payload),
    onError: (error) => {
      toast.error(getApiErrorMessage(error, 'Не удалось завершить обработку'));
    },
    onSuccess: () => {
      toast.success('Звонок обработан');
      setSelectedCall(null);
      invalidate();
    },
  });

  const ignoreMutation = useMutation({
    mutationFn: ({ callId, summary }: { callId: number; summary?: string }) =>
      ignoreTelephonyCall(callId, summary),
    onError: (error) => {
      toast.error(getApiErrorMessage(error, 'Не удалось скрыть звонок'));
    },
    onSuccess: () => {
      toast.success('Звонок скрыт из активной очереди');
      setSelectedCall(null);
      invalidate();
    },
  });

  const linkClientMutation = useMutation({
    mutationFn: ({ callId, clientId }: { callId: number; clientId: number }) =>
      linkTelephonyCallClient(callId, clientId),
    onError: (error) => {
      toast.error(getApiErrorMessage(error, 'Не удалось привязать клиента'));
    },
    onSuccess: (call) => {
      toast.success('Клиент привязан к звонку');
      setClientDialogCall(null);
      setSelectedCall((current) => (current?.id === call.id ? call : current));
      invalidate();
    },
  });

  const createClientMutation = useMutation({
    mutationFn: ({
      callId,
      payload,
    }: {
      callId: number;
      payload: { name: string; note?: string; source?: string; sourceId?: number };
    }) => createTelephonyCallClient(callId, payload),
    onError: (error) => {
      toast.error(getApiErrorMessage(error, 'Не удалось создать клиента'));
    },
    onSuccess: (call) => {
      toast.success('Клиент создан и привязан к звонку');
      setClientDialogCall(null);
      setClientForm(EMPTY_CLIENT_FORM);
      setSelectedCall((current) => (current?.id === call.id ? call : current));
      invalidate();
    },
  });

  const syncMutation = useMutation({
    mutationFn: syncBeelineStatistics,
    onError: (error) => {
      toast.error(getApiErrorMessage(error, 'Синхронизация не удалась'));
    },
    onSuccess: (result) => {
      toast.success(`Импортировано звонков: ${result.imported}`);
      invalidate();
    },
  });

  const syncRecordingsMutation = useMutation({
    mutationFn: syncBeelineRecordings,
    onError: (error) => {
      toast.error(getApiErrorMessage(error, 'Сверка записей не удалась'));
    },
    onSuccess: (result) => {
      toast.success(`Найдено записей: ${result.imported}, связано со звонками: ${result.linked}`);
      invalidate();
    },
  });

  const recordingReferenceMutation = useMutation({
    mutationFn: refreshTelephonyRecordingReference,
    onError: (error) => {
      toast.error(getApiErrorMessage(error, 'Не удалось получить ссылку на запись'));
    },
    onSuccess: (call) => {
      toast.success('Ссылка на запись обновлена');
      setSelectedCall((current) => (current?.id === call.id ? call : current));
      invalidate();
    },
  });

  const subscribeMutation = useMutation({
    mutationFn: subscribeBeelineEvents,
    onError: (error) => {
      toast.error(getApiErrorMessage(error, 'Не удалось создать подписку'));
    },
    onSuccess: () => {
      toast.success('Запрос на подписку Билайна выполнен');
      invalidate();
    },
  });

  const checkSubscriptionMutation = useMutation({
    mutationFn: checkBeelineSubscription,
    onError: (error) => {
      toast.error(getApiErrorMessage(error, 'Не удалось проверить подписку'));
      invalidate();
    },
    onSuccess: () => {
      toast.success('Статус XSI-подписки обновлен');
      invalidate();
    },
  });

  const reprocessRawEventMutation = useMutation({
    mutationFn: reprocessTelephonyRawEvent,
    onError: (error) => {
      toast.error(getApiErrorMessage(error, 'Не удалось повторно обработать событие'));
    },
    onSuccess: () => {
      toast.success('Webhook-событие обработано повторно');
      invalidate();
    },
  });

  const totalPages = Math.max(
    1,
    Math.ceil((callsQuery.data?.total || 0) / PAGE_SIZE),
  );

  const openCompletion = async (call: TelephonyCall) => {
    if (!canWork) return;
    setSelectedCall(call);
    setForm(getDefaultForm(call));
  };

  const openClientDialog = (call: TelephonyCall) => {
    if (!canWork) return;
    const searchValue = getClientSearchValue(call);
    setClientDialogCall(call);
    setClientSearchInput(searchValue);
    setClientSearch(searchValue);
    setClientForm(EMPTY_CLIENT_FORM);
  };

  const openRecording = async (call: TelephonyCall) => {
    if (call.recordingUrl && !shouldRefreshRecordingLink(call)) {
      window.open(call.recordingUrl, '_blank', 'noopener,noreferrer');
      return;
    }

    try {
      const updatedCall = await recordingReferenceMutation.mutateAsync(call.id);
      if (updatedCall.recordingUrl) {
        window.open(updatedCall.recordingUrl, '_blank', 'noopener,noreferrer');
      }
    } catch {
      // Error is shown by the mutation handler.
    }
  };

  const submitCompletion = () => {
    if (!selectedCall) return;
    completeMutation.mutate({
      callId: selectedCall.id,
      payload: buildPayload(form),
    });
  };

  const submitClientCreate = () => {
    if (!clientDialogCall) return;
    const source = clientSourcesQuery.data?.find(
      (item) => String(item.id) === selectedClientSourceId,
    );

    createClientMutation.mutate({
      callId: clientDialogCall.id,
      payload: {
        name: clientForm.name.trim(),
        note: clientForm.note.trim() || undefined,
        source: source?.name || undefined,
        sourceId: selectedClientSourceId ? Number(selectedClientSourceId) : undefined,
      },
    });
  };

  const copyCallbackUrl = async () => {
    const callbackUrl = configQuery.data?.callbackUrl;
    if (!callbackUrl) return;

    await navigator.clipboard.writeText(callbackUrl);
    toast.success('Callback URL скопирован');
  };

  const stats = statsQuery.data;
  const report = reportQuery.data;
  const reportTotals = report?.totals;
  const latestSubscription = configQuery.data?.latestSubscription;
  const clientCandidates = clientSearchQuery.data?.items || [];
  const activeClientSources = clientSourcesQuery.data || [];
  const selectedClientSourceId =
    clientForm.sourceId || (activeClientSources[0]?.id ? String(activeClientSources[0].id) : '');
  const canCreateClientFromCall = Boolean(
    clientDialogCall?.clientPhone &&
      clientForm.name.trim().length >= 2 &&
      selectedClientSourceId,
  );
  const clientCreateBlockReason = !clientDialogCall?.clientPhone
    ? 'В событии звонка нет распознанного телефона, поэтому клиента нельзя создать автоматически.'
    : clientForm.name.trim().length < 2
      ? 'Введите имя клиента минимум из двух символов.'
      : clientSourcesQuery.isLoading
        ? 'Загружаем источники клиентов.'
        : activeClientSources.length === 0
          ? 'Нет активных источников клиентов в справочниках.'
          : !selectedClientSourceId
            ? 'Выберите источник клиента.'
            : null;

  return (
    <div className="min-w-0 space-y-4 p-4 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Телефония</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Звонки из Билайна, ручная обработка итогов и контроль пропущенных.
          </p>
        </div>
        {canManage && (
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() => syncMutation.mutate({})}
              disabled={syncMutation.isPending || !beelineApiReady}
              title={
                beelineApiReady
                  ? 'Сверить звонки со статистикой Билайна'
                  : 'Сначала задайте BEELINE_API_BASE_URL на сервере'
              }
            >
              <RefreshCw className="h-4 w-4" />
              Сверить статистику
            </Button>
            <Button
              variant="outline"
              onClick={() => syncRecordingsMutation.mutate({})}
              disabled={syncRecordingsMutation.isPending || !beelineApiReady}
              title={
                beelineApiReady
                  ? 'Сверить список записей разговоров и связать их со звонками'
                  : 'Сначала задайте BEELINE_API_BASE_URL на сервере'
              }
            >
              <FileAudio className="h-4 w-4" />
              Сверить записи
            </Button>
            <Button
              variant="outline"
              onClick={() => subscribeMutation.mutate({})}
              disabled={subscribeMutation.isPending || !beelineXsiReady}
              title={
                beelineXsiReady
                  ? 'Создать или обновить XSI-подписку'
                  : 'Сначала задайте BEELINE_API_BASE_URL и BEELINE_CALLBACK_URL на сервере'
              }
            >
              <RotateCw className="h-4 w-4" />
              Подписка XSI
            </Button>
            <Button
              variant="outline"
              onClick={() => checkSubscriptionMutation.mutate()}
              disabled={checkSubscriptionMutation.isPending || !beelineXsiReady}
              title={
                beelineXsiReady
                  ? 'Проверить текущий статус XSI-подписки в Билайне'
                  : 'Сначала задайте BEELINE_API_BASE_URL и BEELINE_CALLBACK_URL на сервере'
              }
            >
              <RefreshCw className="h-4 w-4" />
              Проверить XSI
            </Button>
          </div>
        )}
      </div>

      <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-7">
        <MetricCard
          icon={<PhoneCall className="h-3.5 w-3.5" />}
          label="Всего"
          tooltip="Все звонки, которые CRM уже получила из webhook или сверки статистики Билайна."
          value={stats?.total ?? '...'}
        />
        <MetricCard
          icon={<Clock className="h-3.5 w-3.5" />}
          label="В работе"
          tooltip="Звонки, которые еще не закрыты пользователем итогом обработки."
          value={stats?.active ?? '...'}
          valueClassName={(stats?.active || 0) > 0 ? 'text-orange-400' : ''}
        />
        <MetricCard
          icon={<PhoneIncoming className="h-3.5 w-3.5" />}
          label="Пропущенные"
          tooltip="Звонки со статусом missed. CRM создает задачу перезвона для каждого свежего пропущенного входящего звонка, даже если номер еще не заведен как клиент."
          value={stats?.missed ?? '...'}
          valueClassName={(stats?.missed || 0) > 0 ? 'text-destructive' : ''}
        />
        <MetricCard
          icon={<CheckCircle2 className="h-3.5 w-3.5" />}
          label="Обработаны"
          tooltip="Пользователь открыл звонок, выбрал результат и нажал «Завершить обработку»."
          value={stats?.processed ?? '...'}
        />
        <MetricCard
          icon={<EyeOff className="h-3.5 w-3.5" />}
          label="Скрыты"
          tooltip="Технические или нецелевые звонки, которые убрали из активной очереди."
          value={stats?.ignored ?? '...'}
        />
        <MetricCard
          icon={<FileAudio className="h-3.5 w-3.5" />}
          label="С записью"
          tooltip="Звонки, для которых CRM уже нашла запись разговора в Билайне."
          value={stats?.recordingsAvailable ?? '...'}
        />
        <MetricCard
          icon={<Settings className="h-3.5 w-3.5" />}
          label="Без клиента"
          tooltip="Номер из звонка пока не найден в клиентской базе CRM."
          value={stats?.unknownClients ?? '...'}
        />
      </div>

      <div className="space-y-3">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <h2 className="text-xl font-semibold">Контроль обработки</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Итоги звонков за период: результаты, просроченные действия и работа операторов.
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <div className="w-[155px]">
              <Label htmlFor="telephony-report-from">С</Label>
              <Input
                id="telephony-report-from"
                type="date"
                value={reportRange.from}
                onChange={(event) =>
                  setReportRange((current) => ({
                    ...current,
                    from: event.target.value,
                  }))
                }
              />
            </div>
            <div className="w-[155px]">
              <Label htmlFor="telephony-report-to">По</Label>
              <Input
                id="telephony-report-to"
                type="date"
                value={reportRange.to}
                onChange={(event) =>
                  setReportRange((current) => ({
                    ...current,
                    to: event.target.value,
                  }))
                }
              />
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={() => void reportQuery.refetch()}
              disabled={reportQuery.isFetching}
            >
              <RefreshCw className="h-4 w-4" />
              Обновить
            </Button>
          </div>
        </div>

        {reportQuery.isError && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            {getApiErrorMessage(reportQuery.error, 'Не удалось получить отчет телефонии')}
          </div>
        )}

        <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
          <div className="rounded-md border p-3">
            <MetricLabel tooltip="Все звонки, попавшие в выбранный период. Если у звонка нет времени начала, берется дата создания записи в CRM.">
              Звонков
            </MetricLabel>
            <div className="mt-1 text-2xl font-semibold">
              {reportQuery.isLoading ? '...' : reportTotals?.total ?? 0}
            </div>
          </div>
          <div className="rounded-md border p-3">
            <MetricLabel tooltip="Доля звонков, по которым пользователь уже завершил обработку и указал итог.">
              Обработано
            </MetricLabel>
            <div className="mt-1 text-2xl font-semibold">
              {reportQuery.isLoading ? '...' : formatPercent(reportTotals?.processingRate)}
            </div>
            {!reportQuery.isLoading && (
              <div className="mt-1 text-xs text-muted-foreground">
                {reportTotals?.processed ?? 0} из {reportTotals?.total ?? 0}
              </div>
            )}
          </div>
          <div className="rounded-md border p-3">
            <MetricLabel tooltip="Доля обработанных звонков с итогом «Записался». Считается от обработанных, а не от всех звонков.">
              В запись
            </MetricLabel>
            <div className="mt-1 text-2xl font-semibold">
              {reportQuery.isLoading ? '...' : formatPercent(reportTotals?.bookingConversion)}
            </div>
          </div>
          <div className="rounded-md border p-3">
            <MetricLabel tooltip="Пропущенные звонки в выбранном периоде. Это зона контроля перезвона.">
              Пропущено
            </MetricLabel>
            <div className="mt-1 text-2xl font-semibold text-destructive">
              {reportQuery.isLoading ? '...' : reportTotals?.missed ?? 0}
            </div>
          </div>
          <div className="rounded-md border p-3">
            <MetricLabel tooltip="Обработанные звонки с просроченным следующим действием. Если к звонку создана задача и она не закрыта, звонок остается в этой метрике.">
              Просрочено
            </MetricLabel>
            <div className="mt-1 text-2xl font-semibold text-orange-400">
              {reportQuery.isLoading ? '...' : reportTotals?.overdueNextActions ?? 0}
            </div>
          </div>
          <div className="rounded-md border p-3">
            <MetricLabel tooltip="Звонки, которые пока не связаны с клиентской карточкой. Их стоит привязать, чтобы история не терялась.">
              Без клиента
            </MetricLabel>
            <div className="mt-1 text-2xl font-semibold">
              {reportQuery.isLoading ? '...' : reportTotals?.unknownClients ?? 0}
            </div>
          </div>
        </div>

        <div className="grid gap-3 xl:grid-cols-2">
          <div className="rounded-md border">
            <div className="border-b px-3 py-2">
              <div className="flex items-center gap-2 font-medium">
                Итоги звонков
                <HelpTooltip>
                  Показывает, чем завершались обработанные звонки: запись, отказ,
                  сомнение, перезвон и другие исходы.
                </HelpTooltip>
              </div>
            </div>
            <div className="divide-y">
              {(report?.byResult || []).length === 0 ? (
                <div className="p-4 text-sm text-muted-foreground">
                  Итогов за период пока нет.
                </div>
              ) : (
                report?.byResult.map((item) => {
                  const width =
                    reportTotals?.processed && reportTotals.processed > 0
                      ? `${Math.round((item.count / reportTotals.processed) * 100)}%`
                      : '0%';

                  return (
                    <div key={item.key} className="p-3">
                      <div className="flex items-center justify-between gap-3 text-sm">
                        <span className="font-medium">{item.label}</span>
                        <span className="text-muted-foreground">{item.count}</span>
                      </div>
                      <div className="mt-2 h-1.5 rounded-full bg-muted">
                        <div
                          className="h-1.5 rounded-full bg-primary"
                          style={{ width }}
                        />
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          <div className="rounded-md border">
            <div className="border-b px-3 py-2">
              <div className="flex items-center gap-2 font-medium">
                По обработчикам
                <HelpTooltip>
                  Считается по аккаунту, который завершил обработку звонка. Если
                  звонок еще не назначен, он попадает в строку «Не назначен».
                </HelpTooltip>
              </div>
            </div>
            <div className="divide-y">
              {(report?.byOperator || []).length === 0 ? (
                <div className="p-4 text-sm text-muted-foreground">
                  Обработчиков за период пока нет.
                </div>
              ) : (
                report?.byOperator.slice(0, 8).map((item) => (
                  <div
                    key={item.key}
                    className="grid gap-2 p-3 text-sm sm:grid-cols-[1fr_80px_90px_90px] sm:items-center"
                  >
                    <div className="min-w-0">
                      <div className="truncate font-medium">{item.label}</div>
                      <div className="text-xs text-muted-foreground">
                        {item.key === 'none' ? 'ожидает обработки' : item.account?.role || 'без аккаунта'}
                      </div>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Всего:</span>{' '}
                      {item.count}
                    </div>
                    <div>
                      <span className="text-muted-foreground">Закрыто:</span>{' '}
                      {item.processed}
                    </div>
                    <div>
                      <span className="text-muted-foreground">Запись:</span>{' '}
                      {formatPercent(item.bookingConversion)}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>

      {canManage && (
        <div className="rounded-md border bg-card p-3 text-sm">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 font-medium">
              Интеграция Билайн
              <HelpTooltip>
                Callback URL нужен для XSI-events. Если Билайн не принимает HTTP,
                повесьте CRM на HTTPS-домен и обновите BEELINE_CALLBACK_URL.
              </HelpTooltip>
            </div>
            {!beelineApiReady && (
              <Badge variant="destructive" className="gap-1">
                <TriangleAlert className="h-3 w-3" />
                API URL не задан
              </Badge>
            )}
          </div>
          {!beelineApiReady && (
            <p className="mb-3 text-xs text-muted-foreground">
              Кнопки сверки и XSI-подписки включатся после заполнения
              BEELINE_API_BASE_URL на сервере. Webhook для приема событий уже
              доступен по callback URL.
            </p>
          )}
          <div className="grid gap-2 text-muted-foreground md:grid-cols-2 xl:grid-cols-4">
            <div>
              <span className="text-foreground">Токен:</span>{' '}
              {configQuery.data?.apiTokenConfigured ? 'настроен' : 'не настроен'}
            </div>
            <div>
              <span className="text-foreground">API URL:</span>{' '}
              {configQuery.data?.apiBaseUrl || 'не задан'}
            </div>
            <div className="min-w-0 xl:col-span-2">
              <span className="text-foreground">Callback:</span>{' '}
              <span className="inline-flex max-w-full items-center gap-1 align-middle">
                <span className="min-w-0 truncate">
                  {configQuery.data?.callbackUrl || 'не задан'}
                </span>
                {configQuery.data?.callbackUrl && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    onClick={copyCallbackUrl}
                    aria-label="Скопировать callback URL"
                  >
                    <Copy className="h-3 w-3" />
                  </Button>
                )}
              </span>
            </div>
            <div>
              <span className="text-foreground">Webhook secret:</span>{' '}
              {configQuery.data?.webhookSecretConfigured ? (
                'включен'
              ) : configQuery.data?.webhookSecretRequired ? (
                <Badge variant="destructive">обязателен</Badge>
              ) : (
                <Badge variant="destructive">выключен</Badge>
              )}
            </div>
            <div>
              <span className="text-foreground">XSI:</span>{' '}
              {latestSubscription ? (
                <Badge
                  variant={latestSubscription.status === 'active' ? 'outline' : 'destructive'}
                >
                  {SUBSCRIPTION_LABELS[latestSubscription.status]}
                </Badge>
              ) : (
                'не создавалась'
              )}
            </div>
            <div>
              <span className="text-foreground">Проверка XSI:</span>{' '}
              {latestSubscription?.lastCheckedAt
                ? formatDateTime(latestSubscription.lastCheckedAt)
                : 'нет данных'}
            </div>
            <div>
              <span className="text-foreground">Автопродление:</span>{' '}
              {configQuery.data?.subscriptionAutoRenewEnabled ? (
                <Badge variant="outline">включено</Badge>
              ) : (
                <Badge variant="destructive">выключено</Badge>
              )}
            </div>
            <div>
              <span className="text-foreground">Истекает:</span>{' '}
              {latestSubscription?.expiresAt
                ? formatDateTime(latestSubscription.expiresAt)
                : 'неизвестно'}
            </div>
            {latestSubscription?.lastError && (
              <div className="min-w-0 md:col-span-2 xl:col-span-4">
                <span className="text-foreground">Ошибка подписки:</span>{' '}
                <span className="break-words text-destructive">
                  {latestSubscription.lastError}
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[220px] flex-1">
          <Label htmlFor="telephony-search">Поиск</Label>
          <Input
            id="telephony-search"
            value={searchInput}
            onChange={(event) => {
              setSearchInput(event.target.value);
            }}
            placeholder="Имя или телефон"
          />
        </div>
        <div className="w-[210px]">
          <Label>Статус обработки</Label>
          <Select
            value={status}
            onValueChange={(value) => {
              setPage(1);
              setStatus(value);
            }}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="active">Активные</SelectItem>
              <SelectItem value="processed">Обработанные</SelectItem>
              <SelectItem value="ignored">Скрытые</SelectItem>
              <SelectItem value="all">Все</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="w-[190px]">
          <Label>Статус звонка</Label>
          <Select
            value={callStatus}
            onValueChange={(value) => {
              setPage(1);
              setCallStatus(value);
            }}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все</SelectItem>
              <SelectItem value="missed">Пропущенные</SelectItem>
              <SelectItem value="completed">Завершенные</SelectItem>
              <SelectItem value="answered">Принятые</SelectItem>
              <SelectItem value="failed">Ошибка</SelectItem>
              <SelectItem value="unknown">Неизвестно</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="w-[190px]">
          <Label>Запись</Label>
          <Select
            value={recordingStatus}
            onValueChange={(value) => {
              setPage(1);
              setRecordingStatus(value);
            }}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все</SelectItem>
              <SelectItem value="available">С записью</SelectItem>
              <SelectItem value="unknown">Неизвестно</SelectItem>
              <SelectItem value="missing">Без записи</SelectItem>
              <SelectItem value="pending">Готовится</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="w-[190px]">
          <Label>Направление</Label>
          <Select
            value={direction}
            onValueChange={(value) => {
              setPage(1);
              setDirection(value);
            }}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все</SelectItem>
              <SelectItem value="inbound">Входящие</SelectItem>
              <SelectItem value="outbound">Исходящие</SelectItem>
              <SelectItem value="unknown">Неизвестно</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {callsQuery.isError && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {getApiErrorMessage(callsQuery.error, 'Не удалось получить звонки')}
        </div>
      )}

      {!canWork && (
        <div className="rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground">
          У вас режим просмотра: звонки доступны для контроля, но обработку
          выполняют owner, manager или admin.
        </div>
      )}

      <div className="space-y-3 md:hidden">
        {callsQuery.isLoading &&
          Array.from({ length: 4 }).map((_, index) => (
            <div key={`mobile-loading-${index}`} className="h-32 animate-pulse rounded-md border bg-muted" />
          ))}
        {callsQuery.data?.items.map((call) => (
          <div key={call.id} className="rounded-md border bg-card p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="font-medium">{formatDateTime(call.startedAt)}</div>
                <div className="text-xs text-muted-foreground">
                  {formatDuration(call.durationSeconds)} · {DIRECTION_LABELS[call.direction]}
                </div>
              </div>
              <Badge variant={getStatusVariant(call.processingStatus)}>
                {PROCESSING_LABELS[call.processingStatus]}
              </Badge>
            </div>

            <div className="mt-3 min-w-0">
              <div className="truncate font-medium">
                {call.client ? (
                  <Link
                    className="hover:underline"
                    to={`/admin/clients?q=${encodeURIComponent(call.client.phone || call.client.name)}`}
                  >
                    {call.client.name}
                  </Link>
                ) : (
                  'Неизвестный номер'
                )}
              </div>
                <div className="text-xs text-muted-foreground">
                  {call.client?.phone || call.clientPhone || 'Телефон не распознан'}
                </div>
                {call.isNewClient && (
                  <Badge variant="secondary" className="mt-2">
                    Новый номер
                  </Badge>
                )}
              </div>

            <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
              <div>
                <div className="text-xs text-muted-foreground">Итог</div>
                <div>{call.result ? RESULT_LABELS[call.result] : 'Не указан'}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Запись</div>
                <div>{RECORDING_LABELS[call.recordingStatus]}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Ответственный</div>
                <div className="truncate">{call.staff?.name || call.processedByAccount?.name || 'Не назначен'}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Следующий шаг</div>
                <div className="truncate">
                  {call.followUpCallTask?.title ||
                    (call.nextActionAt ? formatDateTime(call.nextActionAt) : 'Нет')}
                </div>
              </div>
            </div>

            {canWork && (
              <div className="mt-3 flex flex-wrap justify-end gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => openClientDialog(call)}
                >
                  <UserPlus className="h-4 w-4" />
                  Клиент
                </Button>
                {call.recordingStatus === 'available' && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void openRecording(call)}
                    disabled={recordingReferenceMutation.isPending}
                  >
                    <LinkIcon className="h-4 w-4" />
                    Запись
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void openCompletion(call)}
                >
                  <PhoneCall className="h-4 w-4" />
                  Обработать
                </Button>
              </div>
            )}
          </div>
        ))}
        {!callsQuery.isLoading && !callsQuery.isError && callsQuery.data?.items.length === 0 && (
          <div className="rounded-md border p-8 text-center text-sm text-muted-foreground">
            Звонков по текущему фильтру нет.
          </div>
        )}
      </div>

      <div className="hidden overflow-x-auto rounded-md border md:block">
        <Table className="min-w-[1240px] table-fixed">
          <TableHeader>
            <TableRow>
              <TableHead className="w-[125px]">
                <MetricLabel tooltip="Дата начала звонка по данным Билайна или статистики.">
                  Время
                </MetricLabel>
              </TableHead>
              <TableHead className="w-[190px]">Клиент</TableHead>
              <TableHead className="w-[95px]">Тип</TableHead>
              <TableHead className="w-[95px]">Статус</TableHead>
              <TableHead className="w-[110px]">Итог</TableHead>
              <TableHead className="w-[115px]">Запись</TableHead>
              <TableHead className="w-[145px]">Ответственный</TableHead>
              <TableHead className="w-[135px]">Следующий шаг</TableHead>
              {canWork && <TableHead className="w-[125px] text-right">Действия</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {callsQuery.isLoading &&
              Array.from({ length: 4 }).map((_, index) => (
                <TableRow key={`loading-${index}`}>
                  <TableCell colSpan={canWork ? 9 : 8}>
                    <div className="h-8 animate-pulse rounded-md bg-muted" />
                  </TableCell>
                </TableRow>
              ))}
            {callsQuery.data?.items.map((call) => (
              <TableRow key={call.id}>
                <TableCell>
                  <div className="font-medium">{formatDateTime(call.startedAt)}</div>
                  <div className="text-xs text-muted-foreground">
                    {formatDurationCompact(call.durationSeconds)}
                  </div>
                </TableCell>
                <TableCell className="min-w-0 whitespace-normal">
                  <div className="min-w-0 truncate font-medium">
                    {call.client ? (
                      <Link
                        className="hover:underline"
                        to={`/admin/clients?q=${encodeURIComponent(call.client.phone || call.client.name)}`}
                      >
                        {call.client.name}
                      </Link>
                    ) : (
                      'Неизвестный номер'
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {call.client?.phone || call.clientPhone || 'Телефон не распознан'}
                  </div>
                  {call.isNewClient && (
                    <Badge variant="secondary" className="mt-1">
                      Новый номер
                    </Badge>
                  )}
                </TableCell>
                <TableCell>
                  <div>{DIRECTION_LABELS[call.direction]}</div>
                  {call.callStatus === 'missed' && (
                    <Badge variant="destructive" className="mt-1">
                      Пропущен
                    </Badge>
                  )}
                </TableCell>
                <TableCell>
                  <Badge variant={getStatusVariant(call.processingStatus)}>
                    {PROCESSING_LABELS[call.processingStatus]}
                  </Badge>
                </TableCell>
                <TableCell>
                  {call.result ? RESULT_LABELS[call.result] : 'Не указан'}
                  {call.interest && (
                    <div className="text-xs text-muted-foreground">
                      {INTEREST_LABELS[call.interest]}
                    </div>
                  )}
                </TableCell>
                <TableCell>
                  <Badge variant={call.recordingStatus === 'available' ? 'outline' : 'secondary'}>
                    {RECORDING_LABELS[call.recordingStatus]}
                  </Badge>
                  {call.recordingFileSize && (
                    <div className="mt-1 text-xs text-muted-foreground">
                      {formatFileSize(call.recordingFileSize)}
                    </div>
                  )}
                </TableCell>
                <TableCell className="min-w-0">
                  <div className="truncate">
                    {call.staff?.name || call.processedByAccount?.name || 'Не назначен'}
                  </div>
                </TableCell>
                <TableCell className="whitespace-normal">
                  {call.followUpCallTask ? (
                    <div className="min-w-0">
                      <Link
                        className="block truncate font-medium hover:underline"
                        to="/admin/call-tasks"
                      >
                        {call.followUpCallTask.title}
                      </Link>
                      <div className="text-xs text-muted-foreground">
                        {formatDateTime(call.followUpCallTask.dueAt)}
                      </div>
                    </div>
                  ) : call.nextActionAt ? (
                    formatDateTime(call.nextActionAt)
                  ) : (
                    'Нет'
                  )}
                </TableCell>
                {canWork && (
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="outline"
                        size="icon-sm"
                        onClick={() => openClientDialog(call)}
                        aria-label="Привязать клиента к звонку"
                        title={
                          call.client
                            ? 'Проверить или сменить клиента звонка'
                            : 'Найти или создать клиента по номеру звонка'
                        }
                      >
                        <UserPlus className="h-4 w-4" />
                      </Button>
                      {call.recordingStatus === 'available' && (
                        <Button
                          variant="outline"
                          size="icon-sm"
                          onClick={() => void openRecording(call)}
                          disabled={recordingReferenceMutation.isPending}
                          aria-label="Открыть запись звонка"
                          title="Открыть временную ссылку на запись из Билайна"
                        >
                          <LinkIcon className="h-4 w-4" />
                        </Button>
                      )}
                      <Button
                        variant="outline"
                        size="icon-sm"
                        onClick={() => void openCompletion(call)}
                        aria-label="Обработать звонок"
                        title="Обработать звонок"
                      >
                        <PhoneCall className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                )}
              </TableRow>
            ))}
            {!callsQuery.isLoading && !callsQuery.isError && callsQuery.data?.items.length === 0 && (
              <TableRow>
                <TableCell colSpan={canWork ? 9 : 8} className="h-28 text-center text-muted-foreground">
                  Звонков по текущему фильтру нет.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <Pagination>
        <PaginationContent>
          <PaginationItem>
            <PaginationPrevious
              onClick={() => setPage((current) => Math.max(1, current - 1))}
              aria-disabled={page <= 1}
              className={page <= 1 ? 'pointer-events-none opacity-50' : ''}
            />
          </PaginationItem>
          <PaginationItem>
            <span className="px-3 text-sm text-muted-foreground">
              {page} / {totalPages}
            </span>
          </PaginationItem>
          <PaginationItem>
            <PaginationNext
              onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
              aria-disabled={page >= totalPages}
              className={page >= totalPages ? 'pointer-events-none opacity-50' : ''}
            />
          </PaginationItem>
        </PaginationContent>
      </Pagination>

      {canManage && (
        <div className="rounded-md border bg-card">
          <div className="border-b p-3">
            <div className="flex items-center gap-2 font-medium">
              Диагностика webhook
              <HelpTooltip>
                Последние сырые события Билайна. Если звонок не появился в
                таблице, здесь видно payload и ошибку обработки.
              </HelpTooltip>
            </div>
          </div>
          <div className="divide-y">
            {rawEventsQuery.isLoading &&
              Array.from({ length: 3 }).map((_, index) => (
                <div key={`raw-loading-${index}`} className="p-3">
                  <div className="h-10 animate-pulse rounded-md bg-muted" />
                </div>
              ))}
            {rawEventsQuery.data?.items.map((event) => (
              <details key={event.id} className="group p-3">
                <summary className="grid cursor-pointer list-none gap-2 text-sm md:grid-cols-[160px_130px_1fr_120px_130px] md:items-center">
                  <div className="font-medium">{formatDateTime(event.receivedAt)}</div>
                  <Badge variant={getRawEventStatusVariant(event.processingStatus)}>
                    {RAW_EVENT_STATUS_LABELS[event.processingStatus]}
                  </Badge>
                  <div className="min-w-0 text-muted-foreground">
                    <span className="text-foreground">{event.eventType || 'event'}</span>
                    {event.processingError && (
                      <span className="ml-2 text-destructive">
                        {event.processingError}
                      </span>
                    )}
                  </div>
                  <div className="text-muted-foreground">
                    {event.call ? `Звонок #${event.call.id}` : 'Без звонка'}
                  </div>
                  <div className="flex justify-start md:justify-end">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={(clickEvent) => {
                        clickEvent.preventDefault();
                        clickEvent.stopPropagation();
                        reprocessRawEventMutation.mutate(event.id);
                      }}
                      disabled={reprocessRawEventMutation.isPending}
                    >
                      <RotateCw className="h-4 w-4" />
                      Повторить
                    </Button>
                  </div>
                </summary>
                <pre className="mt-3 max-h-80 overflow-auto rounded-md bg-muted p-3 text-xs">
                  {formatPayloadPreview(event.payload)}
                </pre>
              </details>
            ))}
            {!rawEventsQuery.isLoading && rawEventsQuery.data?.items.length === 0 && (
              <div className="p-6 text-center text-sm text-muted-foreground">
                Webhook-событий пока нет.
              </div>
            )}
            {rawEventsQuery.isError && (
              <div className="p-3 text-sm text-destructive">
                {getApiErrorMessage(rawEventsQuery.error, 'Не удалось получить события webhook')}
              </div>
            )}
          </div>
        </div>
      )}

      <Dialog open={Boolean(clientDialogCall)} onOpenChange={(open) => !open && setClientDialogCall(null)}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Клиент звонка</DialogTitle>
            <DialogDescription>
              Привяжите звонок к существующему клиенту или создайте нового из номера звонка.
            </DialogDescription>
          </DialogHeader>

          {clientDialogCall && (
            <div className="space-y-4">
              <div className="rounded-md border p-3 text-sm">
	                <div className="flex flex-wrap items-center gap-2">
	                  <span className="font-medium">
	                    {clientDialogCall.client?.name || 'Клиент пока не привязан'}
	                  </span>
	                  {clientDialogCall.isNewClient && (
	                    <Badge variant="secondary">Новый номер</Badge>
	                  )}
	                </div>
                <div className="text-muted-foreground">
                  {clientDialogCall.clientPhone || 'Телефон в событии не распознан'}
                  {' · '}
                  {formatDateTime(clientDialogCall.startedAt)}
                  {' · '}
                  {DIRECTION_LABELS[clientDialogCall.direction]}
                </div>
                {clientDialogCall.client && (
                  <div className="mt-2">
                    <Button asChild variant="outline" size="sm">
                      <Link
                        to={`/admin/clients?q=${encodeURIComponent(
                          clientDialogCall.client.phone || clientDialogCall.client.name,
                        )}`}
                      >
                        Открыть карточку
                      </Link>
                    </Button>
                  </div>
                )}
              </div>

              <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
                <div className="space-y-3">
                  <div>
                    <Label htmlFor="telephony-client-search">Найти клиента</Label>
                    <Input
                      id="telephony-client-search"
                      value={clientSearchInput}
                      onChange={(event) => setClientSearchInput(event.target.value)}
                      placeholder="Телефон или имя"
                    />
                  </div>

                  <div className="max-h-[340px] space-y-2 overflow-auto rounded-md border p-2">
                    {clientSearchQuery.isLoading && (
                      <div className="rounded-md bg-muted p-3 text-sm text-muted-foreground">
                        Ищем клиентов...
                      </div>
                    )}
                    {clientSearchQuery.isError && (
                      <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                        <div>
                          {getApiErrorMessage(clientSearchQuery.error, 'Не удалось найти клиентов')}
                        </div>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="mt-2"
                          onClick={() => void clientSearchQuery.refetch()}
                        >
                          Повторить поиск
                        </Button>
                      </div>
                    )}
                    {!clientSearchQuery.isError &&
                      clientCandidates.map((client) => {
                        const isCurrentClient = client.id === clientDialogCall.client?.id;

                        return (
                          <div
                            key={client.id}
                            className="flex flex-wrap items-center justify-between gap-3 rounded-md border bg-card p-3"
                          >
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <div className="truncate font-medium">{client.name}</div>
                                {isCurrentClient && (
                                  <Badge variant="outline">Уже привязан</Badge>
                                )}
                              </div>
                              <div className="text-sm text-muted-foreground">
                                {client.phone} · {client.source}
                              </div>
                              <div className="text-xs text-muted-foreground">
                                {getClientVisitSummary(client)}
                              </div>
                            </div>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() =>
                                linkClientMutation.mutate({
                                  callId: clientDialogCall.id,
                                  clientId: client.id,
                                })
                              }
                              disabled={
                                isCurrentClient ||
                                linkClientMutation.isPending ||
                                createClientMutation.isPending
                              }
                            >
                              {isCurrentClient ? 'Текущий' : 'Привязать'}
                            </Button>
                          </div>
                        );
                      })}
                    {!clientSearchQuery.isLoading &&
                      !clientSearchQuery.isError &&
                      clientSearch.trim() &&
                      clientCandidates.length === 0 && (
                        <div className="rounded-md bg-muted p-3 text-sm text-muted-foreground">
                          Активных клиентов по этому запросу не найдено.
                        </div>
                      )}
                    {!clientSearch.trim() && (
                      <div className="rounded-md bg-muted p-3 text-sm text-muted-foreground">
                        Введите телефон или имя, чтобы найти клиента в базе.
                      </div>
                    )}
                  </div>
                </div>

                <div className="space-y-3 rounded-md border p-3">
                  <div>
                    <div className="font-medium">Создать клиента</div>
                    <div className="text-sm text-muted-foreground">
                      {clientDialogCall.clientPhone
                        ? 'Телефон возьмем из звонка, чтобы не вводить его вручную.'
                        : 'Создание доступно только если Билайн передал телефон клиента.'}
                    </div>
                  </div>
                  <div>
                    <Label>Телефон</Label>
                    <Input value={clientDialogCall.clientPhone || ''} disabled />
                  </div>
                  <div>
                    <Label htmlFor="telephony-client-name">Имя</Label>
                    <Input
                      id="telephony-client-name"
                      value={clientForm.name}
                      onChange={(event) =>
                        setClientForm((current) => ({
                          ...current,
                          name: event.target.value,
                        }))
                      }
                      placeholder="Имя клиента"
                    />
                  </div>
                  <div>
                    <Label>Источник</Label>
                    <Select
                      value={selectedClientSourceId}
                      onValueChange={(sourceId) =>
                        setClientForm((current) => ({ ...current, sourceId }))
                      }
                      disabled={clientSourcesQuery.isLoading || activeClientSources.length === 0}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Выберите источник" />
                      </SelectTrigger>
                      <SelectContent>
                        {activeClientSources.map((source) => (
                          <SelectItem key={source.id} value={String(source.id)}>
                            {source.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {activeClientSources.length === 0 && !clientSourcesQuery.isLoading && (
                      <div className="mt-1 text-xs text-destructive">
                        Сначала добавьте активный источник клиента в справочниках.
                      </div>
                    )}
                  </div>
                  <div>
                    <Label htmlFor="telephony-client-note">Заметка</Label>
                    <textarea
                      id="telephony-client-note"
                      className="min-h-[86px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                      value={clientForm.note}
                      onChange={(event) =>
                        setClientForm((current) => ({
                          ...current,
                          note: event.target.value,
                        }))
                      }
                      placeholder="Что известно после звонка"
                    />
                  </div>
                  <Button
                    type="button"
                    className="w-full"
                    onClick={submitClientCreate}
                    disabled={
                      !canCreateClientFromCall ||
                      createClientMutation.isPending ||
                      linkClientMutation.isPending
                    }
                  >
                    <UserPlus className="h-4 w-4" />
                    Создать и привязать
                  </Button>
                  {clientCreateBlockReason && (
                    <div className="text-xs text-muted-foreground">
                      {clientCreateBlockReason}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(selectedCall)} onOpenChange={(open) => !open && setSelectedCall(null)}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Обработка звонка</DialogTitle>
            <DialogDescription>
              Выберите итог вручную. Без транскрибации CRM не угадывает смысл разговора,
              а фиксирует результат, следующий шаг и задачу.
            </DialogDescription>
          </DialogHeader>

          {selectedCall && (
            <div className="space-y-4">
              <div className="rounded-md border p-3 text-sm">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="font-medium">
                      {selectedCall.client?.name || 'Неизвестный номер'}
                    </div>
                    <div className="text-muted-foreground">
                      {selectedCall.client?.phone || selectedCall.clientPhone || 'Телефон не распознан'}
                      {' · '}
                      {formatDateTime(selectedCall.startedAt)}
                      {' · '}
                      {DIRECTION_LABELS[selectedCall.direction]}
                    </div>
                  </div>
                  {selectedCall.recordingStatus === 'available' && (
                    <div className="flex flex-wrap justify-end gap-2">
                      {selectedCall.recordingUrl && !shouldRefreshRecordingLink(selectedCall) ? (
                        <Button asChild variant="outline" size="sm">
                          <a
                            href={selectedCall.recordingUrl}
                            target="_blank"
                            rel="noreferrer"
                          >
                            <LinkIcon className="h-4 w-4" />
                            Открыть запись
                          </a>
                        </Button>
                      ) : (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => recordingReferenceMutation.mutate(selectedCall.id)}
                          disabled={recordingReferenceMutation.isPending}
                        >
                          <LinkIcon className="h-4 w-4" />
                          Получить запись
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <Label>Результат</Label>
                  <Select
                    value={form.result}
                    onValueChange={(value) =>
                      setForm((current) => ({
                        ...current,
                        result: value as TelephonyResult,
                      }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(RESULT_LABELS).map(([value, label]) => (
                        <SelectItem key={value} value={value}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Интерес</Label>
                  <Select
                    value={form.interest}
                    onValueChange={(value) =>
                      setForm((current) => ({
                        ...current,
                        interest: value as TelephonyInterest | 'none',
                      }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Не указан</SelectItem>
                      {Object.entries(INTEREST_LABELS).map(([value, label]) => (
                        <SelectItem key={value} value={value}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div>
                <Label htmlFor="call-summary">Комментарий</Label>
                <textarea
                  id="call-summary"
                  className="min-h-[96px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  value={form.summary}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      summary: event.target.value,
                    }))
                  }
                  placeholder="Например: хочет персональную тренировку вечером, попросил перезвонить завтра"
                />
              </div>

              <div className="grid gap-3 md:grid-cols-[220px_1fr]">
                <div>
                  <Label htmlFor="next-action-at">Дата перезвона</Label>
                  <Input
                    id="next-action-at"
                    type="datetime-local"
                    value={form.nextActionAt}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        nextActionAt: event.target.value,
                      }))
                    }
                  />
                </div>
                <div>
                  <Label htmlFor="next-action-text">Следующий шаг</Label>
                  <Input
                    id="next-action-text"
                    value={form.nextActionText}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        nextActionText: event.target.value,
                      }))
                    }
                    placeholder="Что нужно сделать после звонка"
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setSelectedCall(null)}
                >
                  Отмена
                </Button>
                <div className="flex flex-wrap justify-end gap-2">
                  <Button
                    variant="destructive"
                    onClick={() => {
                      if (!window.confirm('Скрыть звонок из активной очереди?')) {
                        return;
                      }
                      ignoreMutation.mutate({
                        callId: selectedCall.id,
                        summary: form.summary,
                      });
                    }}
                    disabled={ignoreMutation.isPending || completeMutation.isPending}
                  >
                    <EyeOff className="h-4 w-4" />
                    Скрыть
                  </Button>
                  <Button
                    onClick={submitCompletion}
                    disabled={completeMutation.isPending || ignoreMutation.isPending}
                  >
                    <Save className="h-4 w-4" />
                    Завершить обработку
                  </Button>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
