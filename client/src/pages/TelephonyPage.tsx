import { useEffect, useMemo, useRef, useState } from 'react';
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import {
  CheckCircle2,
  Clock,
  Copy,
  EyeOff,
  FileAudio,
  FileText,
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
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';
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
  createTelephonyTranscriptionJob,
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
  retryTelephonyTranscriptionJob,
  subscribeBeelineEvents,
  syncBeelineRecordings,
  syncBeelineStatistics,
  type CompleteTelephonyCallPayload,
  type TelephonyAiTranscriptSegment,
  type TelephonyCall,
  type TelephonyDirection,
  type TelephonyInterest,
  type TelephonyProcessingStatus,
  type TelephonyResult,
  type TelephonyTranscriptSegment,
  type TelephonyTranscriptSpeaker,
  type TelephonyTranscriptionQualityWarning,
  type TelephonyTranscriptionStatus,
} from '@/api/telephony';
import { queryKeys } from '@/api/query-keys';
import { fetchReferences } from '@/lib/references';
import {
  canManageTelephony,
  canWorkTelephony,
} from '@/lib/permissions';
import { getApiErrorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
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

const TRANSCRIPTION_LABELS: Record<TelephonyTranscriptionStatus, string> = {
  completed: 'Готово',
  failed: 'Ошибка',
  processing: 'Обрабатывается',
  queued: 'В очереди',
};

type TranscriptionViewState = TelephonyTranscriptionStatus | 'no_recording' | 'not_started';

const TRANSCRIPTION_VIEW_LABELS: Record<TranscriptionViewState, string> = {
  ...TRANSCRIPTION_LABELS,
  no_recording: 'Нет записи',
  not_started: 'Нет транскрипции',
};

const TRANSCRIPT_SPEAKER_LABELS: Record<TelephonyTranscriptSpeaker, string> = {
  administrator: 'Администратор',
  client: 'Клиент',
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

function getTranscriptionViewState(call: TelephonyCall): TranscriptionViewState {
  if (call.transcription?.status) return call.transcription.status;
  return call.recordingStatus === 'available' ? 'not_started' : 'no_recording';
}

function getTranscriptionStatusVariant(status?: TranscriptionViewState) {
  if (status === 'completed') return 'outline';
  if (status === 'failed') return 'destructive';
  return 'secondary';
}

function isTranscriptionPending(status?: TelephonyTranscriptionStatus) {
  return status === 'queued' || status === 'processing';
}

function getTranscriptionQualityWarnings(
  warnings?: TelephonyTranscriptionQualityWarning[],
) {
  return Array.isArray(warnings) ? warnings.filter((warning) => warning?.message) : [];
}

function formatTranscriptTime(ms?: number | null) {
  if (ms === null || ms === undefined) return null;
  return formatDuration(Math.max(0, Math.round(ms / 1000)));
}

function sortTranscriptSegments(segments?: TelephonyTranscriptSegment[]) {
  return [...(segments || [])].sort((left, right) => {
    const leftHasStart =
      left.startMs !== null &&
      left.startMs !== undefined &&
      Number.isFinite(Number(left.startMs));
    const rightHasStart =
      right.startMs !== null &&
      right.startMs !== undefined &&
      Number.isFinite(Number(right.startMs));
    const leftStart = Number(left.startMs);
    const rightStart = Number(right.startMs);

    if (leftHasStart && rightHasStart && leftStart !== rightStart) {
      return leftStart - rightStart;
    }
    if (leftHasStart !== rightHasStart) {
      return leftHasStart ? -1 : 1;
    }

    const sortOrderDiff = Number(left.sortOrder || 0) - Number(right.sortOrder || 0);
    if (sortOrderDiff !== 0) return sortOrderDiff;

    return Number(left.id || 0) - Number(right.id || 0);
  });
}

function sortAiTranscriptSegments(segments?: TelephonyAiTranscriptSegment[]) {
  return [...(segments || [])].sort((left, right) => {
    const leftHasStart =
      left.startMs !== null &&
      left.startMs !== undefined &&
      Number.isFinite(Number(left.startMs));
    const rightHasStart =
      right.startMs !== null &&
      right.startMs !== undefined &&
      Number.isFinite(Number(right.startMs));
    const leftStart = Number(left.startMs);
    const rightStart = Number(right.startMs);

    if (leftHasStart && rightHasStart && leftStart !== rightStart) {
      return leftStart - rightStart;
    }
    if (leftHasStart !== rightHasStart) {
      return leftHasStart ? -1 : 1;
    }

    const sortOrderDiff = Number(left.sortOrder || 0) - Number(right.sortOrder || 0);
    if (sortOrderDiff !== 0) return sortOrderDiff;

    return String(left.segmentId || '').localeCompare(String(right.segmentId || ''));
  });
}

function getTranscriptSegmentTone(speaker: TelephonyTranscriptSpeaker) {
  if (speaker === 'administrator') {
    return 'border-l-4 border-l-sky-500 bg-sky-50/70 dark:bg-sky-950/20';
  }
  if (speaker === 'client') {
    return 'border-l-4 border-l-emerald-500 bg-emerald-50/70 dark:bg-emerald-950/20';
  }

  return 'border-l-4 border-l-muted-foreground/50 bg-muted/40';
}

function formatTranscriptCorrection(correction: Record<string, unknown>, index: number) {
  const original = typeof correction.original === 'string' ? correction.original : null;
  const normalized = typeof correction.normalized === 'string' ? correction.normalized : null;
  const rule = typeof correction.rule === 'string' ? correction.rule : null;
  const type = typeof correction.type === 'string' ? correction.type : null;
  const label = original && normalized ? `${original} -> ${normalized}` : type || `Правка ${index + 1}`;
  return rule ? `${label} (${rule})` : label;
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
  const [transcriptDialogCall, setTranscriptDialogCall] = useState<TelephonyCall | null>(null);
  const openedCallIdRef = useRef<number | null>(null);
  const [form, setForm] = useState<CompletionForm>(EMPTY_FORM);
  const [clientDialogCall, setClientDialogCall] = useState<TelephonyCall | null>(null);
  const [clientSearch, setClientSearch] = useState('');
  const [clientSearchInput, setClientSearchInput] = useState('');
  const [clientForm, setClientForm] = useState<ClientCallForm>(EMPTY_CLIENT_FORM);

  const canManage = canManageTelephony(account?.role);
  const canWork = canWorkTelephony(account?.role);
  const canAccessCallRecordings = canWork;
  const callsTableColumnCount = canWork ? 10 : 7;

  const listParams = useMemo(
    () => ({
      direction: direction === 'all' ? undefined : direction,
      callStatus: callStatus === 'all' ? undefined : callStatus,
      recordingStatus:
        canAccessCallRecordings && recordingStatus !== 'all'
          ? recordingStatus
          : undefined,
      page,
      pageSize: PAGE_SIZE,
      q: query,
      status,
    }),
    [callStatus, canAccessCallRecordings, direction, page, query, recordingStatus, status],
  );

  const callsQuery = useQuery({
    placeholderData: keepPreviousData,
    queryKey: queryKeys.telephony.calls(listParams),
    queryFn: () => getTelephonyCalls(listParams),
  });
  const visibleCalls = callsQuery.isError ? [] : callsQuery.data?.items || [];
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
  const selectedCallId = selectedCall?.id ?? null;
  const selectedCallDetailQuery = useQuery({
    enabled: canWork && Boolean(selectedCallId),
    queryKey: queryKeys.telephony.call(selectedCallId),
    queryFn: () => getTelephonyCall(selectedCallId as number),
    refetchInterval: (query) =>
      isTranscriptionPending(
        query.state.data?.transcription?.status || selectedCall?.transcription?.status,
      )
        ? 5000
        : false,
  });
  const selectedCallForView =
    selectedCallDetailQuery.data?.id === selectedCall?.id
      ? selectedCallDetailQuery.data
      : selectedCall;
  const transcriptDialogCallId = transcriptDialogCall?.id ?? null;
  const transcriptDetailQuery = useQuery({
    enabled: canWork && Boolean(transcriptDialogCallId),
    queryKey: queryKeys.telephony.call(transcriptDialogCallId),
    queryFn: () => getTelephonyCall(transcriptDialogCallId as number),
    refetchInterval: (query) =>
      isTranscriptionPending(
        query.state.data?.transcription?.status || transcriptDialogCall?.transcription?.status,
      )
        ? 5000
        : false,
  });
  const transcriptCallForView =
    transcriptDetailQuery.data?.id === transcriptDialogCall?.id
      ? transcriptDetailQuery.data
      : transcriptDialogCall;
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
      if (openedCallIdRef.current === requestedCallId) {
        openedCallIdRef.current = null;
      }
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
      setTranscriptDialogCall((current) => (current?.id === call.id ? call : current));
      invalidate();
    },
  });

  const createTranscriptionMutation = useMutation({
    mutationFn: createTelephonyTranscriptionJob,
    onError: (error) => {
      toast.error(getApiErrorMessage(error, 'Не удалось поставить звонок на транскрибацию'));
    },
    onSuccess: (call) => {
      toast.success('Звонок поставлен на транскрибацию');
      setSelectedCall((current) => (current?.id === call.id ? call : current));
      setTranscriptDialogCall((current) => (current?.id === call.id ? call : current));
      invalidate();
    },
  });

  const retryTranscriptionMutation = useMutation({
    mutationFn: retryTelephonyTranscriptionJob,
    onError: (error) => {
      toast.error(getApiErrorMessage(error, 'Не удалось повторить транскрибацию'));
    },
    onSuccess: (call) => {
      toast.success('Транскрибация снова в очереди');
      setSelectedCall((current) => (current?.id === call.id ? call : current));
      setTranscriptDialogCall((current) => (current?.id === call.id ? call : current));
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

  const openTranscriptDialog = (call: TelephonyCall) => {
    if (!canWork) return;
    setTranscriptDialogCall(call);
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

  const startTranscription = (call: TelephonyCall) => {
    if (!canWork || call.recordingStatus !== 'available') return;
    createTranscriptionMutation.mutate(call.id);
  };

  const retryTranscription = (call: TelephonyCall) => {
    if (!canWork || !call.transcription?.id) return;
    retryTranscriptionMutation.mutate(call.transcription.id);
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
  const transcriptionActionPending =
    createTranscriptionMutation.isPending || retryTranscriptionMutation.isPending;
  const renderTranscriptionAction = (call: TelephonyCall, iconOnly = false) => {
    const transcription = call.transcription;
    if (call.recordingStatus !== 'available') return null;
    if (isTranscriptionPending(transcription?.status)) {
      return null;
    }

    if (transcription?.status === 'completed') {
      return (
        <Button
          variant="outline"
          size={iconOnly ? 'icon-sm' : 'sm'}
          onClick={() => retryTranscription(call)}
          disabled={transcriptionActionPending}
          aria-label="Пересчитать транскрибацию"
          title="Пересчитать транскрибацию"
        >
          <RefreshCw className="h-4 w-4" />
          {!iconOnly && 'Пересчитать'}
        </Button>
      );
    }

    if (transcription?.status === 'failed') {
      return (
        <Button
          variant="outline"
          size={iconOnly ? 'icon-sm' : 'sm'}
          onClick={() => retryTranscription(call)}
          disabled={transcriptionActionPending}
          aria-label="Повторить транскрибацию"
          title="Повторить транскрибацию"
        >
          <RefreshCw className="h-4 w-4" />
          {!iconOnly && 'Повторить'}
        </Button>
      );
    }

    return (
      <Button
        variant="outline"
        size={iconOnly ? 'icon-sm' : 'sm'}
        onClick={() => startTranscription(call)}
        disabled={transcriptionActionPending}
        aria-label="Транскрибировать звонок"
        title="Транскрибировать звонок"
      >
        <FileText className="h-4 w-4" />
        {!iconOnly && 'Транскрибировать'}
      </Button>
    );
  };
  const renderTranscriptOpenAction = (call: TelephonyCall, iconOnly = false) => {
    const viewState = getTranscriptionViewState(call);

    return (
      <Button
        variant={viewState === 'completed' ? 'default' : 'outline'}
        size={iconOnly ? 'icon-sm' : 'sm'}
        onClick={() => openTranscriptDialog(call)}
        aria-label="Открыть транскрипцию"
        title="Транскрипция"
      >
        <FileText className="h-4 w-4" />
        {!iconOnly && 'Транскрипция'}
      </Button>
    );
  };
  const renderTranscriptContent = (call: TelephonyCall, isFetching = false) => {
    const viewState = getTranscriptionViewState(call);
    const transcription = call.transcription;
    const segments = sortTranscriptSegments(transcription?.segments);
    const aiSegments = sortAiTranscriptSegments(transcription?.aiTranscriptSegments);
    const corrections = transcription?.corrections || [];
    const aiCorrections = transcription?.aiCorrections || [];
    const aiMetadata = transcription?.aiMetadata || null;
    const qualityWarnings = getTranscriptionQualityWarnings(
      transcription?.metadata?.qualityWarnings,
    );
    const segmentTranscriptText = segments
      .map((segment) => segment.text.trim())
      .filter(Boolean)
      .join('\n');
    const normalizedText = segmentTranscriptText || transcription?.transcriptText || '';
    const aiText = aiSegments.length > 0
      ? aiSegments.map((segment) => segment.text.trim()).filter(Boolean).join('\n')
      : transcription?.aiTranscriptText || '';
    const defaultTranscriptTab = aiText ? 'ai' : 'normalized';
    const renderSegmentCards = (
      items: Array<TelephonyTranscriptSegment | TelephonyAiTranscriptSegment>,
    ) => (
      <div className="space-y-2">
        {items.map((segment, index) => {
          const timeLabel = formatTranscriptTime(segment.startMs);
          const endTimeLabel = formatTranscriptTime(segment.endMs);
          const speakerLabel = TRANSCRIPT_SPEAKER_LABELS[segment.speaker];
          const segmentKey =
            'id' in segment && segment.id
              ? segment.id
              : 'segmentId' in segment
                ? segment.segmentId
                : `${segment.startMs || 'segment'}-${index}`;

          return (
            <div
              key={segmentKey}
              className={`rounded-md border p-3 ${getTranscriptSegmentTone(segment.speaker)}`}
            >
              <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">{speakerLabel}</span>
                {timeLabel && (
                  <span>
                    {timeLabel}
                    {endTimeLabel ? `-${endTimeLabel}` : ''}
                  </span>
                )}
                {segment.channel && <span>Канал: {segment.channel}</span>}
              </div>
              <div className="whitespace-pre-wrap break-words text-sm leading-relaxed">
                {segment.text}
              </div>
            </div>
          );
        })}
      </div>
    );
    const renderCorrections = (items: Record<string, unknown>[], emptyText: string) => {
      if (items.length === 0) {
        return <div className="text-sm text-muted-foreground">{emptyText}</div>;
      }

      return (
        <div className="space-y-1 text-xs text-muted-foreground">
          {items.slice(0, 36).map((correction, index) => (
            <div key={`${formatTranscriptCorrection(correction, index)}-${index}`}>
              {formatTranscriptCorrection(correction, index)}
            </div>
          ))}
          {items.length > 36 && (
            <div>Еще {items.length - 36} правок скрыто в компактном просмотре.</div>
          )}
        </div>
      );
    };

    if (viewState === 'no_recording') {
      return (
        <div className="rounded-md bg-muted p-4 text-sm text-muted-foreground">
          У звонка нет доступной записи, поэтому транскрибация пока недоступна.
        </div>
      );
    }

    if (viewState === 'not_started') {
      return (
        <div className="space-y-3 rounded-md bg-muted p-4 text-sm text-muted-foreground">
          <div>Транскрипция еще не запускалась. Запись есть, можно поставить задачу в очередь.</div>
          {renderTranscriptionAction(call)}
        </div>
      );
    }

    if (viewState === 'queued' || viewState === 'processing') {
      return (
        <div className="rounded-md bg-muted p-4 text-sm text-muted-foreground">
          {viewState === 'queued'
            ? 'Задача ожидает свободный worker.'
            : 'Worker обрабатывает запись.'}
          {isFetching && <span className="ml-2">Обновляем статус...</span>}
        </div>
      );
    }

    if (viewState === 'failed') {
      return (
        <div className="space-y-3">
          <div className="rounded-md border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
            {transcription?.errorMessage || 'Worker вернул ошибку транскрибации.'}
          </div>
          {renderTranscriptionAction(call)}
        </div>
      );
    }

    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          {qualityWarnings.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {qualityWarnings.map((warning) => (
                <Badge
                  key={`${warning.code}-${warning.message}`}
                  variant={warning.severity === 'warning' ? 'destructive' : 'secondary'}
                  className="max-w-full whitespace-normal text-left"
                >
                  {warning.message}
                </Badge>
              ))}
            </div>
          ) : (
            <span className="text-sm text-muted-foreground">
              Автоматических предупреждений качества нет.
            </span>
          )}
          {renderTranscriptionAction(call)}
        </div>

        <Tabs defaultValue={defaultTranscriptTab} className="gap-3">
          <TabsList className="grid h-auto w-full grid-cols-2 items-stretch sm:inline-flex sm:w-fit">
            <TabsTrigger value="ai" className="h-auto min-h-8 w-full whitespace-normal px-2 py-1 text-center text-xs sm:h-8 sm:w-auto sm:text-sm">
              AI-редактура
            </TabsTrigger>
            <TabsTrigger value="normalized" className="h-auto min-h-8 w-full whitespace-normal px-2 py-1 text-center text-xs sm:h-8 sm:w-auto sm:text-sm">
              Очищенная транскрибация
            </TabsTrigger>
            <TabsTrigger value="raw" className="h-auto min-h-8 w-full whitespace-normal px-2 py-1 text-center text-xs sm:h-8 sm:w-auto sm:text-sm">
              Raw ASR
            </TabsTrigger>
            <TabsTrigger value="corrections" className="h-auto min-h-8 w-full whitespace-normal px-2 py-1 text-center text-xs sm:h-8 sm:w-auto sm:text-sm">
              Автоматические правки
            </TabsTrigger>
          </TabsList>

          <TabsContent value="ai" className="space-y-3">
            {aiText ? (
              aiSegments.length > 0 ? (
                renderSegmentCards(aiSegments)
              ) : (
                <div className="whitespace-pre-wrap break-words rounded-md border bg-card p-3 text-sm leading-relaxed">
                  {aiText}
                </div>
              )
            ) : (
              <div className="rounded-md bg-muted p-4 text-sm text-muted-foreground">
                {aiMetadata?.status === 'failed'
                  ? `AI-редактура недоступна: ${aiMetadata.error || 'LLM не ответила.'}`
                  : 'AI-редактура для этой транскрибации не сохранена.'}
              </div>
            )}
            {aiMetadata?.status === 'completed' && aiMetadata.model && (
              <div className="text-xs text-muted-foreground">
                Модель: {aiMetadata.model}
              </div>
            )}
          </TabsContent>

          <TabsContent value="normalized" className="space-y-3">
            {segments.length > 0 ? (
              renderSegmentCards(segments)
            ) : normalizedText ? (
              <div className="whitespace-pre-wrap break-words rounded-md border bg-card p-3 text-sm leading-relaxed">
                {normalizedText}
              </div>
            ) : (
              <div className="rounded-md bg-muted p-4 text-sm text-muted-foreground">
                Worker завершил задачу без сегментов.
              </div>
            )}
          </TabsContent>

          <TabsContent value="raw">
            {transcription?.rawTranscriptText ? (
              <div className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-md border bg-muted/30 p-3 text-sm leading-relaxed text-muted-foreground">
                {transcription.rawTranscriptText}
              </div>
            ) : (
              <div className="rounded-md bg-muted p-4 text-sm text-muted-foreground">
                Raw ASR для этой задачи не сохранен.
              </div>
            )}
          </TabsContent>

          <TabsContent value="corrections" className="space-y-4">
            <div className="rounded-md border bg-card p-3">
              <div className="mb-2 text-sm font-medium">AI-правки</div>
              {renderCorrections(aiCorrections, 'AI-правок нет.')}
            </div>
            <div className="rounded-md border bg-card p-3">
              <div className="mb-2 text-sm font-medium">Очищенная транскрибация</div>
              {renderCorrections(corrections, 'Правок очищающего слоя нет.')}
            </div>
          </TabsContent>
        </Tabs>

        {call.summary && (
          <div className="rounded-md border bg-muted/40 p-3">
            <div className="mb-2 text-sm font-medium">Summary обработки</div>
            <div className="whitespace-pre-wrap break-words text-sm leading-relaxed text-muted-foreground">
              {call.summary}
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <h1 className="sr-only">Телефония</h1>
      {canManage && (
        <div className="flex flex-wrap justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
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
              size="sm"
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
              size="sm"
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
              size="sm"
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
        {canAccessCallRecordings && (
          <MetricCard
            icon={<FileAudio className="h-3.5 w-3.5" />}
            label="С записью"
            tooltip="Звонки, для которых CRM уже нашла запись разговора в Билайне."
            value={stats?.recordingsAvailable ?? '...'}
          />
        )}
        <MetricCard
          icon={<Settings className="h-3.5 w-3.5" />}
          label="Без клиента"
          tooltip="Номер из звонка пока не найден в клиентской базе CRM."
          value={stats?.unknownClients ?? '...'}
        />
      </div>

      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-end gap-2">
          <h2 className="sr-only">Контроль обработки</h2>
          <div className="flex flex-wrap items-center gap-2 rounded-2xl border bg-card/80 p-2 shadow-sm shadow-foreground/5">
            <span className="px-2 text-xs font-medium text-muted-foreground">
              Период
            </span>
            <div>
              <Label htmlFor="telephony-report-from" className="sr-only">
                Начало периода
              </Label>
              <Input
                id="telephony-report-from"
                type="date"
                className="h-9 w-[150px]"
                value={reportRange.from}
                onChange={(event) =>
                  setReportRange((current) => ({
                    ...current,
                    from: event.target.value,
                  }))
                }
              />
            </div>
            <div>
              <Label htmlFor="telephony-report-to" className="sr-only">
                Конец периода
              </Label>
              <Input
                id="telephony-report-to"
                type="date"
                className="h-9 w-[150px]"
                value={reportRange.to}
                onChange={(event) =>
                  setReportRange((current) => ({
                    ...current,
                    to: event.target.value,
                  }))
                }
              />
            </div>
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

      <div
        className={cn(
          'grid gap-2 rounded-2xl border bg-card/80 p-2 shadow-sm shadow-foreground/5 md:grid-cols-2',
          canAccessCallRecordings
            ? 'xl:grid-cols-[minmax(220px,1fr)_180px_170px_170px_170px]'
            : 'xl:grid-cols-[minmax(220px,1fr)_180px_170px_170px]',
        )}
      >
        <div className="space-y-1">
          <Label htmlFor="telephony-search" className="text-xs text-muted-foreground">
            Поиск
          </Label>
          <Input
            id="telephony-search"
            className="h-9"
            value={searchInput}
            onChange={(event) => {
              setSearchInput(event.target.value);
            }}
            placeholder="Имя или телефон"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Статус обработки</Label>
          <Select
            value={status}
            onValueChange={(value) => {
              setPage(1);
              setStatus(value);
            }}
          >
            <SelectTrigger className="h-9">
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
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Статус звонка</Label>
          <Select
            value={callStatus}
            onValueChange={(value) => {
              setPage(1);
              setCallStatus(value);
            }}
          >
            <SelectTrigger className="h-9">
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
        {canAccessCallRecordings && (
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Запись</Label>
            <Select
              value={recordingStatus}
              onValueChange={(value) => {
                setPage(1);
                setRecordingStatus(value);
              }}
            >
              <SelectTrigger className="h-9">
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
        )}
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Направление</Label>
          <Select
            value={direction}
            onValueChange={(value) => {
              setPage(1);
              setDirection(value);
            }}
          >
            <SelectTrigger className="h-9">
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
        {visibleCalls.map((call) => (
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
              {canAccessCallRecordings && (
                <div>
                  <div className="text-xs text-muted-foreground">Запись</div>
                  <div>{RECORDING_LABELS[call.recordingStatus]}</div>
                </div>
              )}
              {canWork && (
                <div>
                  <div className="text-xs text-muted-foreground">Транскрипт</div>
                  <Badge variant={getTranscriptionStatusVariant(getTranscriptionViewState(call))}>
                    {TRANSCRIPTION_VIEW_LABELS[getTranscriptionViewState(call)]}
                  </Badge>
                </div>
              )}
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
                {canAccessCallRecordings && call.recordingStatus === 'available' && (
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
                {renderTranscriptOpenAction(call)}
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
        {!callsQuery.isLoading && !callsQuery.isError && visibleCalls.length === 0 && (
          <div className="rounded-md border p-8 text-center text-sm text-muted-foreground">
            Звонков по текущему фильтру нет.
          </div>
        )}
      </div>

      <div className="hidden overflow-x-auto rounded-md border md:block">
        <Table
          className={cn(
            'table-fixed [&_td]:py-4 [&_th]:py-3',
            canAccessCallRecordings ? 'min-w-[1390px]' : 'min-w-[1010px]',
          )}
        >
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
              {canAccessCallRecordings && <TableHead className="w-[115px]">Запись</TableHead>}
              {canWork && <TableHead className="w-[145px]">Транскрипт</TableHead>}
              <TableHead className="w-[145px]">Ответственный</TableHead>
              <TableHead className="w-[135px]">Следующий шаг</TableHead>
              {canWork && <TableHead className="w-[125px] text-right">Действия</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {callsQuery.isLoading &&
              Array.from({ length: 4 }).map((_, index) => (
                <TableRow key={`loading-${index}`}>
                  <TableCell colSpan={callsTableColumnCount}>
                    <div className="h-8 animate-pulse rounded-md bg-muted" />
                  </TableCell>
                </TableRow>
              ))}
            {visibleCalls.map((call) => (
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
                {canAccessCallRecordings && (
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
                )}
                {canWork && (
                  <TableCell>
                    <div className="space-y-1">
                      <Badge variant={getTranscriptionStatusVariant(getTranscriptionViewState(call))}>
                        {TRANSCRIPTION_VIEW_LABELS[getTranscriptionViewState(call)]}
                      </Badge>
                      {call.transcription?.status === 'failed' && call.transcription.errorMessage && (
                        <div className="line-clamp-2 text-xs text-destructive">
                          {call.transcription.errorMessage}
                        </div>
                      )}
                    </div>
                  </TableCell>
                )}
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
                      {canAccessCallRecordings && call.recordingStatus === 'available' && (
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
                      {renderTranscriptOpenAction(call, true)}
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
            {!callsQuery.isLoading && !callsQuery.isError && visibleCalls.length === 0 && (
              <TableRow>
                <TableCell colSpan={callsTableColumnCount} className="h-28 text-center text-muted-foreground">
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

      <Dialog
        open={Boolean(transcriptDialogCall)}
        onOpenChange={(open) => !open && setTranscriptDialogCall(null)}
      >
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              {transcriptCallForView
                ? `${formatDateTime(transcriptCallForView.startedAt)} · ${
                    transcriptCallForView.client?.name ||
                    transcriptCallForView.clientPhone ||
                    'Неизвестный номер'
                  }`
                : 'Транскрипция звонка'}
            </DialogTitle>
            <DialogDescription>
              {transcriptCallForView
                ? `${
                    transcriptCallForView.client?.phone ||
                    transcriptCallForView.clientPhone ||
                    'Телефон не распознан'
                  } · ${formatDuration(transcriptCallForView.durationSeconds)}`
                : 'Загружаем звонок'}
            </DialogDescription>
          </DialogHeader>

          {transcriptCallForView && (
            <div className="space-y-4">
              <div className="rounded-md border p-3 text-sm">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-medium">
                      {transcriptCallForView.client?.name || 'Неизвестный номер'}
                    </div>
                    <div className="break-words text-muted-foreground">
                      {transcriptCallForView.client?.phone ||
                        transcriptCallForView.clientPhone ||
                        'Телефон не распознан'}
                      {' · '}
                      {DIRECTION_LABELS[transcriptCallForView.direction]}
                      {' · '}
                      {formatDuration(transcriptCallForView.durationSeconds)}
                    </div>
                  </div>
                  <Badge variant={getTranscriptionStatusVariant(getTranscriptionViewState(transcriptCallForView))}>
                    {TRANSCRIPTION_VIEW_LABELS[getTranscriptionViewState(transcriptCallForView)]}
                  </Badge>
                </div>
              </div>

              {transcriptDetailQuery.isLoading && !transcriptDetailQuery.data ? (
                <div className="h-24 animate-pulse rounded-md bg-muted" />
              ) : (
                renderTranscriptContent(transcriptCallForView, transcriptDetailQuery.isFetching)
              )}
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

          {selectedCallForView && (
            <div className="space-y-4">
              <div className="rounded-md border p-3 text-sm">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="font-medium">
                      {selectedCallForView.client?.name || 'Неизвестный номер'}
                    </div>
                    <div className="text-muted-foreground">
                      {selectedCallForView.client?.phone || selectedCallForView.clientPhone || 'Телефон не распознан'}
                      {' · '}
                      {formatDateTime(selectedCallForView.startedAt)}
                      {' · '}
                      {DIRECTION_LABELS[selectedCallForView.direction]}
                    </div>
                  </div>
                  {selectedCallForView.recordingStatus === 'available' && (
                    <div className="flex flex-wrap justify-end gap-2">
                      {selectedCallForView.recordingUrl && !shouldRefreshRecordingLink(selectedCallForView) ? (
                        <Button asChild variant="outline" size="sm">
                          <a
                            href={selectedCallForView.recordingUrl}
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
                          onClick={() => recordingReferenceMutation.mutate(selectedCallForView.id)}
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

              <div className="rounded-md border p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 font-medium">
                    <FileText className="h-4 w-4" />
                    Транскрипт
                    <Badge variant={getTranscriptionStatusVariant(getTranscriptionViewState(selectedCallForView))}>
                      {TRANSCRIPTION_VIEW_LABELS[getTranscriptionViewState(selectedCallForView)]}
                    </Badge>
                  </div>
                </div>

                <div className="mt-3">
                  {renderTranscriptContent(selectedCallForView, selectedCallDetailQuery.isFetching)}
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
                        callId: selectedCallForView.id,
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
