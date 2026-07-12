import { useCallback, useEffect, useRef, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import type { ColumnDef } from '@tanstack/react-table';
import {
  Archive,
  ArchiveRestore,
  Ellipsis,
  Eye,
  Pencil,
  PhoneCall,
  Plus,
  Repeat2,
  Save,
  Trash2,
  Users,
} from 'lucide-react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/toast';
import {
  ConfirmActionDialog,
  type ConfirmAction,
} from '@/components/confirm-action-dialog';
import { HelpTooltip } from '@/components/dashboard-metric';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { DataTable } from '@/components/data-table';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { apiFetch, getApiErrorMessage } from '@/lib/api';
import type { ReferenceItem } from '@/lib/references';
import { fetchReferences } from '@/lib/references';
import { useRealtimeRefresh } from '@/lib/realtime';
import { useNavigate, useSearchParams } from 'react-router-dom';

type ClientBaseStatus = 'active' | 'archived';
type ClientSegment = 'all' | 'new' | 'regular' | 'inactive' | 'no_visits';
type RecurringInterval = 'none' | 'daily' | 'weekly';
type RecurringScopeType = 'snapshot' | 'dynamic';

interface ClientBaseFilters {
  q?: string;
  segment?: ClientSegment;
  source?: string;
  sourceId?: number;
  status?: 'active' | 'archived' | 'all';
  visitCategory?: string;
  visitCategoryId?: number;
  visitCountMin?: number;
  visitCountMax?: number;
  lastVisitDaysFrom?: number;
  lastVisitDaysTo?: number;
  visitsAnalytics?: {
    asOf: string;
    firstVisitFrom?: string;
    firstVisitMonth?: string;
    firstVisitTo?: string;
    lifecycleStatus?: 'new' | 'developing' | 'regular' | 'atRisk' | 'sleeping' | 'lost';
    sourceKeys: string[];
    timeZone: 'Europe/Moscow';
  };
}

interface ClientBase {
  id: number;
  name: string;
  description: string;
  filters: ClientBaseFilters;
  origin?: 'visits_analytics' | null;
  originMetadata?: {
    criteria?: { kind?: string; lifecycleStatus?: string | null; cohortMonth?: string | null };
    period?: { from?: string; to?: string };
    sourceFilters?: { labels?: string[] };
  } | null;
  status: ClientBaseStatus;
  currentClientCount: number;
  deltaSinceLastTask: number | null;
  lastCalculatedAt?: string | null;
  lastTaskClientCount?: number | null;
  lastTaskCreatedAt?: string | null;
  slaDays?: number | null;
  recurrence?: {
    assignedTo?: {
      id: number;
      email: string;
      name: string;
    } | null;
    assignedToAccountId?: number | null;
    description?: string;
    dueDays?: number | string | null;
    enabled: boolean;
    interval: RecurringInterval;
    lastRunAt?: string | null;
    nextRunAt?: string | null;
    scopeType: RecurringScopeType;
    time?: string;
    title?: string;
    weekday?: number | null;
  };
  createdAt: string;
  updatedAt: string;
}

interface ClientPreview {
  id: number;
  name: string;
  phone: string;
  source: string;
  segment: string;
  stats: {
    lastVisitAt?: string | null;
    visitCount: number;
  };
}

interface ClientsResponse {
  items: ClientPreview[];
  total: number;
}

interface AccountOption {
  id: number;
  email: string;
  role: string;
  status?: string;
  Staff?: {
    name: string;
  } | null;
}

interface BaseFormState {
  description: string;
  lastVisitDaysFrom: string;
  lastVisitDaysTo: string;
  name: string;
  q: string;
  recurringAssignedToAccountId: string;
  recurringDescription: string;
  recurringDueDays: string;
  recurringEnabled: boolean;
  recurringInterval: RecurringInterval;
  recurringScopeType: RecurringScopeType;
  recurringTime: string;
  recurringTitle: string;
  recurringWeekday: string;
  segment: ClientSegment;
  slaDays: string;
  source: string;
  sourceId: string;
  status: 'active' | 'archived' | 'all';
  visitCategory: string;
  visitCategoryId: string;
  visitCountMax: string;
  visitCountMin: string;
}

interface CallTaskFormState {
  assignedToAccountId: string;
  description: string;
  dueAt: string;
  scriptText: string;
  scopeType: 'snapshot' | 'dynamic';
  title: string;
}

type PendingAction = ConfirmAction & {
  onConfirm: () => Promise<void>;
};

const EMPTY_FORM: BaseFormState = {
  description: '',
  lastVisitDaysFrom: '',
  lastVisitDaysTo: '',
  name: '',
  q: '',
  recurringAssignedToAccountId: 'none',
  recurringDescription: '',
  recurringDueDays: '',
  recurringEnabled: false,
  recurringInterval: 'weekly',
  recurringScopeType: 'snapshot',
  recurringTime: '10:00',
  recurringTitle: '',
  recurringWeekday: '1',
  segment: 'all',
  slaDays: '',
  source: '',
  sourceId: '',
  status: 'active',
  visitCategory: '',
  visitCategoryId: '',
  visitCountMax: '',
  visitCountMin: '',
};

const EMPTY_CALL_TASK_FORM: CallTaskFormState = {
  assignedToAccountId: 'none',
  description: '',
  dueAt: '',
  scriptText: '',
  scopeType: 'snapshot',
  title: '',
};
const numberString = (label: string, allowZero = false) =>
  z.string().refine(
    (value) => {
      if (!value.trim()) return true;
      const number = Number(value);
      return Number.isFinite(number) && (allowZero ? number >= 0 : number > 0);
    },
    {
      message: allowZero
        ? `${label}: укажите число не меньше 0`
        : `${label}: укажите число больше 0`,
    },
  );
const baseFormSchema = z
  .object({
    description: z.string(),
    lastVisitDaysFrom: numberString('Не были от'),
    lastVisitDaysTo: numberString('Не были до'),
    name: z.string().trim().min(2, 'Введите название базы не короче 2 символов.'),
    q: z.string(),
    recurringAssignedToAccountId: z.string(),
    recurringDescription: z.string(),
    recurringDueDays: numberString('Дней на обработку', true),
    recurringEnabled: z.boolean(),
    recurringInterval: z.enum(['none', 'daily', 'weekly']),
    recurringScopeType: z.enum(['snapshot', 'dynamic']),
    recurringTime: z.string(),
    recurringTitle: z.string(),
    recurringWeekday: numberString('День недели'),
    segment: z.enum(['all', 'new', 'regular', 'inactive', 'no_visits']),
    slaDays: numberString('Срок прозвона', true),
    source: z.string(),
    sourceId: z.string(),
    status: z.enum(['active', 'archived', 'all']),
    visitCategory: z.string(),
    visitCategoryId: z.string(),
    visitCountMax: numberString('Визитов до', true),
    visitCountMin: numberString('Визитов от'),
  })
  .superRefine((value, ctx) => {
    if (value.recurringEnabled && value.status !== 'active') {
      ctx.addIssue({
        code: 'custom',
        message: 'Автозадачи можно включить только для базы с активными клиентами.',
        path: ['recurringEnabled'],
      });
    }
  });
const callTaskFormSchema = z.object({
  assignedToAccountId: z.string(),
  description: z.string(),
  dueAt: z.string(),
  scriptText: z.string(),
  scopeType: z.enum(['snapshot', 'dynamic']),
  title: z.string().trim().min(2, 'Введите название задачи'),
});

const SEGMENT_LABELS: Record<ClientSegment, string> = {
  all: 'Все сегменты',
  inactive: 'Давно не были',
  new: 'Новые',
  no_visits: 'Без визитов',
  regular: 'Постоянные',
};

const WEEKDAY_LABELS: Record<string, string> = {
  '1': 'Понедельник',
  '2': 'Вторник',
  '3': 'Среда',
  '4': 'Четверг',
  '5': 'Пятница',
  '6': 'Суббота',
  '7': 'Воскресенье',
};

function formatDateTime(value?: string | null) {
  if (!value) return '-';
  return new Intl.DateTimeFormat('ru-RU', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value));
}

function formatDate(value?: string | null) {
  if (!value) return '-';
  return new Intl.DateTimeFormat('ru-RU', {
    dateStyle: 'short',
  }).format(new Date(value));
}

async function readError(response: Response, fallback: string) {
  try {
    const data = (await response.json()) as { error?: string };
    return data.error || fallback;
  } catch {
    return fallback;
  }
}

function toNumber(value: string, options: { allowZero?: boolean } = {}) {
  const trimmed = value.trim();
  if (!trimmed) return undefined;

  const number = Number(trimmed);
  const isValid = options.allowZero ? number >= 0 : number > 0;
  return Number.isFinite(number) && isValid ? number : undefined;
}

function buildFilters(form: BaseFormState): ClientBaseFilters {
  return {
    q: form.q.trim() || undefined,
    segment: form.segment,
    source: form.source.trim() || undefined,
    sourceId: toNumber(form.sourceId),
    status: form.status,
    visitCategory: form.visitCategory.trim() || undefined,
    visitCategoryId: toNumber(form.visitCategoryId),
    visitCountMin: toNumber(form.visitCountMin),
    visitCountMax: toNumber(form.visitCountMax, { allowZero: true }),
    lastVisitDaysFrom: toNumber(form.lastVisitDaysFrom),
    lastVisitDaysTo: toNumber(form.lastVisitDaysTo),
  };
}

function buildRecurrence(form: BaseFormState) {
  return {
    assignedToAccountId:
      form.recurringAssignedToAccountId === 'none'
        ? null
        : Number(form.recurringAssignedToAccountId),
    description: form.recurringDescription.trim(),
    dueDays: toNumber(form.recurringDueDays, { allowZero: true }),
    enabled: form.recurringEnabled,
    interval: form.recurringInterval,
    scopeType: form.recurringScopeType,
    time: form.recurringTime || '10:00',
    title: form.recurringTitle.trim(),
    weekday: toNumber(form.recurringWeekday),
  };
}

function formFromBase(base: ClientBase): BaseFormState {
  const filters = base.filters || {};
  return {
    description: base.description || '',
    lastVisitDaysFrom: String(filters.lastVisitDaysFrom ?? ''),
    lastVisitDaysTo: String(filters.lastVisitDaysTo ?? ''),
    name: base.name,
    q: filters.q || '',
    recurringAssignedToAccountId: base.recurrence?.assignedToAccountId
      ? String(base.recurrence.assignedToAccountId)
      : 'none',
    recurringDescription: base.recurrence?.description || '',
    recurringDueDays:
      base.recurrence?.dueDays === null ||
      base.recurrence?.dueDays === undefined
        ? ''
        : String(base.recurrence.dueDays),
    recurringEnabled: Boolean(base.recurrence?.enabled),
    recurringInterval: base.recurrence?.interval || 'weekly',
    recurringScopeType: base.recurrence?.scopeType || 'snapshot',
    recurringTime: base.recurrence?.time || '10:00',
    recurringTitle: base.recurrence?.title || '',
    recurringWeekday: base.recurrence?.weekday
      ? String(base.recurrence.weekday)
      : '1',
    segment: filters.segment || 'all',
    slaDays: base.slaDays === null || base.slaDays === undefined ? '' : String(base.slaDays),
    source: filters.source || '',
    sourceId: String(filters.sourceId ?? ''),
    status: filters.status || 'active',
    visitCategory: filters.visitCategory || '',
    visitCategoryId: String(filters.visitCategoryId ?? ''),
    visitCountMax: String(filters.visitCountMax ?? ''),
    visitCountMin: String(filters.visitCountMin ?? ''),
  };
}

function describeFilters(filters: ClientBaseFilters) {
  const parts = [];

  if (filters.visitsAnalytics) {
    const analytics = filters.visitsAnalytics;
    if (analytics.lifecycleStatus) {
      const labels: Record<string, string> = { new: 'Новый', developing: 'Развивающийся', regular: 'Постоянный', atRisk: 'Под риском', sleeping: 'Спящий', lost: 'Потерянный' };
      parts.push(`жизненный статус: ${labels[analytics.lifecycleStatus] || analytics.lifecycleStatus}`);
    }
    if (analytics.firstVisitMonth) parts.push(`когорта: ${analytics.firstVisitMonth}`);
    if (analytics.firstVisitFrom || analytics.firstVisitTo) parts.push(`первый визит: ${analytics.firstVisitFrom || '…'} — ${analytics.firstVisitTo || '…'}`);
    parts.push(analytics.sourceKeys.length ? `источников: ${analytics.sourceKeys.length}` : 'все источники');
    parts.push(`asOf: ${analytics.asOf.slice(0, 10)}`);
    return parts.join(' · ');
  }

  if (filters.segment && filters.segment !== 'all') {
    parts.push(SEGMENT_LABELS[filters.segment]);
  }
  if (filters.visitCountMin !== undefined || filters.visitCountMax !== undefined) {
    const min = filters.visitCountMin ?? 0;
    const max = filters.visitCountMax;
    parts.push(max === undefined ? `визитов от ${min}` : `визитов ${min}-${max}`);
  }
  if (
    filters.lastVisitDaysFrom !== undefined ||
    filters.lastVisitDaysTo !== undefined
  ) {
    const from = filters.lastVisitDaysFrom ?? 0;
    const to = filters.lastVisitDaysTo;
    parts.push(
      to === undefined
        ? `не были от ${from} дней`
        : `не были ${from}-${to} дней`,
    );
  }
  if (filters.visitCategory) parts.push(`визит: ${filters.visitCategory}`);
  if (filters.source) parts.push(`источник: ${filters.source}`);
  if (filters.q) parts.push(`поиск: ${filters.q}`);
  if (filters.status === 'archived') parts.push('архивные клиенты');
  if (filters.status === 'all') parts.push('активные и архивные');

  return parts.length > 0 ? parts.join(' · ') : 'Все активные клиенты';
}

function buildClientsUrl(filters: ClientBaseFilters) {
  const params = new URLSearchParams();

  if (filters.q) params.set('q', filters.q);
  if (filters.segment && filters.segment !== 'all') {
    params.set('segment', filters.segment);
  }
  params.set('status', filters.status || 'active');
  if (filters.sourceId) params.set('sourceId', String(filters.sourceId));
  if (filters.visitCategoryId) {
    params.set('visitCategoryId', String(filters.visitCategoryId));
  }
  if (filters.visitCountMin !== undefined) {
    params.set('visitCountMin', String(filters.visitCountMin));
  }
  if (filters.visitCountMax !== undefined) {
    params.set('visitCountMax', String(filters.visitCountMax));
  }
  if (filters.lastVisitDaysFrom !== undefined) {
    params.set('lastVisitDaysFrom', String(filters.lastVisitDaysFrom));
  }
  if (filters.lastVisitDaysTo !== undefined) {
    params.set('lastVisitDaysTo', String(filters.lastVisitDaysTo));
  }

  return `/admin/clients?${params.toString()}`;
}

function describeRecurrence(base: ClientBase) {
  const recurrence = base.recurrence;
  if (!recurrence?.enabled) return 'Не настроена';

  const interval =
    recurrence.interval === 'daily'
      ? 'каждый день'
      : `${WEEKDAY_LABELS[String(recurrence.weekday || 1)].toLowerCase()}`;
  const mode =
    recurrence.scopeType === 'dynamic' ? 'автообновляемая' : 'фиксированная';

  return `${interval} в ${recurrence.time || '10:00'} · ${mode}`;
}

function describeCallDeadline(base: ClientBase) {
  if (base.slaDays === null || base.slaDays === undefined) {
    return 'Как у задачи';
  }
  if (base.slaDays === 0) return 'Сегодня';
  return `${base.slaDays} дн.`;
}

function baseTargetsOnlyActiveClients(base: ClientBase) {
  return (base.filters?.status || 'active') === 'active';
}

function getCallTaskBlockedReason(base: ClientBase) {
  if (base.status !== 'active') return 'Архивную базу сначала нужно восстановить';
  if (!baseTargetsOnlyActiveClients(base)) {
    return 'Задачи создаются только по базам с активными клиентами';
  }

  return '';
}

export default function ClientBasesPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const handledDeepLink = useRef('');
  const [bases, setBases] = useState<ClientBase[]>([]);
  const [loading, setLoading] = useState(true);
  const [basesError, setBasesError] = useState('');
  const [baseStatus, setBaseStatus] = useState<ClientBaseStatus>('active');
  const [formOpen, setFormOpen] = useState(false);
  const [formError, setFormError] = useState('');
  const [editingBase, setEditingBase] = useState<ClientBase | null>(null);
  const [clientSources, setClientSources] = useState<ReferenceItem[]>([]);
  const [visitCategories, setVisitCategories] = useState<ReferenceItem[]>([]);
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [previewBase, setPreviewBase] = useState<ClientBase | null>(null);
  const [previewClients, setPreviewClients] = useState<ClientPreview[]>([]);
  const [previewTotal, setPreviewTotal] = useState(0);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const [callTaskBase, setCallTaskBase] = useState<ClientBase | null>(null);
  const [callTaskError, setCallTaskError] = useState('');
  const [callTaskSaving, setCallTaskSaving] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [pendingActionLoading, setPendingActionLoading] = useState(false);
  const [runningRecurring, setRunningRecurring] = useState(false);
  const baseForm = useForm<BaseFormState>({
    defaultValues: EMPTY_FORM,
    resolver: zodResolver(baseFormSchema),
  });
  const callTaskFormControl = useForm<CallTaskFormState>({
    defaultValues: EMPTY_CALL_TASK_FORM,
    resolver: zodResolver(callTaskFormSchema),
  });
  const form = baseForm.watch();
  const callTaskForm = callTaskFormControl.watch();
  const setForm = (nextForm: BaseFormState) => {
    baseForm.reset(nextForm, {
      keepDirty: true,
      keepErrors: true,
      keepTouched: true,
    });
  };
  const setCallTaskForm = (nextForm: CallTaskFormState) => {
    callTaskFormControl.reset(nextForm, {
      keepDirty: true,
      keepErrors: true,
      keepTouched: true,
    });
  };

  const fetchBases = useCallback(async () => {
    setLoading(true);
    setBasesError('');
    try {
      const res = await apiFetch(`/api/client-bases?status=${baseStatus}`);
      if (!res.ok) {
        const message = await readError(res, 'Не удалось загрузить базы');
        setBasesError(message);
        toast.error(message);
        return;
      }

      setBases((await res.json()) as ClientBase[]);
    } catch (error) {
      const message = getApiErrorMessage(error, 'Не удалось загрузить базы');
      setBasesError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }, [baseStatus]);

  const fetchReferencesData = useCallback(async () => {
    try {
      const [sources, categories] = await Promise.all([
        fetchReferences('client-sources'),
        fetchReferences('visit-categories'),
      ]);
      setClientSources(sources);
      setVisitCategories(categories);
    } catch {
      setClientSources([]);
      setVisitCategories([]);
    }
  }, []);

  const fetchAccounts = useCallback(async () => {
    try {
      const res = await apiFetch('/api/accounts');
      if (!res.ok) return;
      setAccounts((await res.json()) as AccountOption[]);
    } catch {
      setAccounts([]);
    }
  }, []);

  useEffect(() => {
    void fetchBases();
  }, [fetchBases]);

  useEffect(() => {
    void fetchReferencesData();
  }, [fetchReferencesData]);

  useEffect(() => {
    void fetchAccounts();
  }, [fetchAccounts]);

  useRealtimeRefresh(['clientBases', 'clients', 'callTasks', 'references'], () => {
    void fetchBases();
    void fetchReferencesData();
    void fetchAccounts();
  });

  const openCreate = () => {
    setEditingBase(null);
    baseForm.reset(EMPTY_FORM);
    setFormError('');
    setFormOpen(true);
  };

  const openEdit = (base: ClientBase) => {
    setEditingBase(base);
    const nextForm = formFromBase(base);
    if (!nextForm.sourceId && nextForm.source) {
      nextForm.sourceId = String(
        clientSources.find((source) => source.name === nextForm.source)?.id || '',
      );
    }
    if (!nextForm.visitCategoryId && nextForm.visitCategory) {
      nextForm.visitCategoryId = String(
        visitCategories.find((category) => category.name === nextForm.visitCategory)
          ?.id || '',
      );
    }
    baseForm.reset(nextForm);
    setFormError('');
    setFormOpen(true);
  };

  const handleSave = baseForm.handleSubmit(async (values) => {
    setFormError('');

    const payload = {
      description: values.description.trim(),
      filters: editingBase?.origin === 'visits_analytics'
        ? editingBase.filters
        : buildFilters(values),
      name: values.name.trim(),
      recurrence: buildRecurrence(values),
      slaDays: values.slaDays.trim() ? Number(values.slaDays) : null,
      status: editingBase?.status || 'active',
    };
    const res = await apiFetch(
      editingBase ? `/api/client-bases/${editingBase.id}` : '/api/client-bases',
      {
        method: editingBase ? 'PUT' : 'POST',
        body: JSON.stringify(payload),
      },
    );

    if (!res.ok) {
      setFormError(await readError(res, 'Не удалось сохранить базу'));
      return;
    }

    setFormOpen(false);
    await fetchBases();
    toast.success(editingBase ? 'База обновлена' : 'База создана');
  }, (errors) => {
    const firstError = Object.values(errors)[0];
    setFormError(firstError?.message || 'Проверьте поля базы');
  });

  const executeArchiveBase = async (base: ClientBase) => {
    const res = await apiFetch(`/api/client-bases/${base.id}`, {
      method: 'DELETE',
    });
    if (!res.ok) {
      toast.error(await readError(res, 'Не удалось архивировать базу'));
      return;
    }

    await fetchBases();
    toast.success('База отправлена в архив');
  };

  const executeRestoreBase = async (base: ClientBase) => {
    const res = await apiFetch(`/api/client-bases/${base.id}/restore`, {
      method: 'POST',
    });
    if (!res.ok) {
      toast.error(await readError(res, 'Не удалось восстановить базу'));
      return;
    }

    await fetchBases();
    toast.success('База восстановлена');
  };

  const requestBaseStatusChange = (base: ClientBase) => {
    const isArchive = base.status === 'active';

    setPendingAction({
      confirmLabel: isArchive ? 'В архив' : 'Восстановить',
      description: isArchive
        ? `База «${base.name}» исчезнет из активного списка. Клиенты и уже созданные задачи не удаляются. Восстановить можно из фильтра «Архив».`
        : `База «${base.name}» снова появится среди активных, и по ней можно будет создавать задачи обзвона.`,
      isDestructive: isArchive,
      onConfirm: () =>
        isArchive ? executeArchiveBase(base) : executeRestoreBase(base),
      title: isArchive ? 'Архивировать базу?' : 'Восстановить базу?',
    });
  };

  const executePermanentDelete = async (base: ClientBase) => {
    const res = await apiFetch(`/api/client-bases/${base.id}/permanent`, {
      method: 'DELETE',
    });
    if (!res.ok) {
      toast.error(await readError(res, 'Не удалось удалить базу из архива'));
      return;
    }

    await fetchBases();
    toast.success('База удалена из архива');
  };

  const requestPermanentDelete = (base: ClientBase) => {
    setPendingAction({
      confirmLabel: 'Удалить навсегда',
      description: `База «${base.name}» будет удалена без возможности восстановления. Сервер не даст удалить базу, если по ней уже есть задачи обзвона.`,
      isDestructive: true,
      onConfirm: () => executePermanentDelete(base),
      title: 'Удалить базу из архива?',
    });
  };

  const confirmPendingAction = async () => {
    if (!pendingAction) return;

    setPendingActionLoading(true);
    try {
      await pendingAction.onConfirm();
      setPendingAction(null);
    } finally {
      setPendingActionLoading(false);
    }
  };

  const openPreview = useCallback(async (base: ClientBase) => {
    setPreviewBase(base);
    setPreviewClients([]);
    setPreviewTotal(0);
    setPreviewError('');
    setPreviewLoading(true);
    try {
      const res = await apiFetch(
        `/api/client-bases/${base.id}/clients?page=1&pageSize=20`,
      );
      if (!res.ok) {
        const message = await readError(res, 'Не удалось открыть базу');
        setPreviewError(message);
        toast.error(message);
        return;
      }

      const data = (await res.json()) as ClientsResponse;
      setPreviewClients(data.items);
      setPreviewTotal(data.total);
    } catch (error) {
      const message = getApiErrorMessage(error, 'Не удалось открыть базу');
      setPreviewError(message);
      toast.error(message);
    } finally {
      setPreviewLoading(false);
    }
  }, []);

  const openCreateCallTask = useCallback((base: ClientBase) => {
    const blockedReason = getCallTaskBlockedReason(base);
    if (blockedReason) {
      setPendingAction({
        confirmLabel: 'Понятно',
        description:
          'Измените фильтр базы на статус клиентов «Активные» или восстановите базу, если она в архиве.',
        hideCancel: true,
        onConfirm: async () => {},
        title: blockedReason,
      });
      return;
    }

    setCallTaskBase(base);
    callTaskFormControl.reset({
      ...EMPTY_CALL_TASK_FORM,
      title: `${base.name}: обзвон`,
    });
    setCallTaskError('');
  }, [callTaskFormControl]);

  const runRecurringTasks = async () => {
    setRunningRecurring(true);
    try {
      const res = await apiFetch('/api/call-tasks/recurring/run', {
        method: 'POST',
      });
      if (!res.ok) {
        toast.error(await readError(res, 'Не удалось запустить автозадачи'));
        return;
      }
      const result = (await res.json()) as { processed: number };
      toast.success(`Проверено автозадач: ${result.processed}`);
      await fetchBases();
    } finally {
      setRunningRecurring(false);
    }
  };

  const handleCreateCallTask = callTaskFormControl.handleSubmit(async (values) => {
    if (!callTaskBase) return;

    setCallTaskSaving(true);
    setCallTaskError('');
    try {
      const res = await apiFetch(`/api/client-bases/${callTaskBase.id}/call-tasks`, {
        method: 'POST',
        body: JSON.stringify({
          assignedToAccountId:
            values.assignedToAccountId === 'none'
              ? null
              : Number(values.assignedToAccountId),
          description: values.description.trim(),
          dueAt: values.dueAt || null,
          scriptText: values.scriptText.trim(),
          scopeType: values.scopeType,
          title: values.title.trim(),
        }),
      });

      if (!res.ok) {
        setCallTaskError(await readError(res, 'Не удалось создать обзвон'));
        return;
      }

      setCallTaskBase(null);
      toast.success('Задача обзвона создана');
      navigate('/admin/call-tasks');
      void fetchBases().catch(() => {
        toast.error('Задача создана, но список баз не обновился');
      });
    } catch {
      setCallTaskError('Не удалось создать обзвон. Проверьте подключение к серверу.');
    } finally {
      setCallTaskSaving(false);
    }
  }, (errors) => {
    const firstError = Object.values(errors)[0];
    setCallTaskError(firstError?.message || 'Проверьте поля задачи');
  });

  const openBaseInClients = (base: ClientBase) => {
    if (base.origin === 'visits_analytics') {
      void openPreview(base);
      return;
    }
    navigate(buildClientsUrl(base.filters || {}));
  };

  useEffect(() => {
    const baseId = Number(searchParams.get('baseId'));
    if (!Number.isInteger(baseId) || loading) return;
    const action = searchParams.get('createCallTask') === '1' ? 'call-task' : 'preview';
    const key = `${baseId}:${action}`;
    if (handledDeepLink.current === key) return;
    const base = bases.find((item) => item.id === baseId);
    if (!base) return;
    handledDeepLink.current = key;
    if (action === 'call-task') openCreateCallTask(base);
    else void openPreview(base);
    setSearchParams({}, { replace: true });
  }, [bases, loading, openCreateCallTask, openPreview, searchParams, setSearchParams]);

  const renderBaseActions = (base: ClientBase) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Действия с базой ${base.name}`}
        >
          <Ellipsis className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Действия</DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => void openPreview(base)}>
          <Eye className="h-4 w-4" />
          Открыть базу
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => openBaseInClients(base)}>
          <Users className="h-4 w-4" />
          Открыть клиентов
        </DropdownMenuItem>
        {base.status === 'active' && (
          <DropdownMenuItem
            disabled={Boolean(getCallTaskBlockedReason(base))}
            onSelect={() => openCreateCallTask(base)}
          >
            <PhoneCall className="h-4 w-4" />
            Создать обзвон
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onSelect={() => openEdit(base)}>
          <Pencil className="h-4 w-4" />
          Редактировать
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {base.status === 'active' ? (
          <DropdownMenuItem onSelect={() => requestBaseStatusChange(base)}>
            <Archive className="h-4 w-4" />
            Архивировать
          </DropdownMenuItem>
        ) : (
          <>
            <DropdownMenuItem onSelect={() => requestBaseStatusChange(base)}>
              <ArchiveRestore className="h-4 w-4" />
              Восстановить
            </DropdownMenuItem>
            <DropdownMenuItem
              variant="destructive"
              onSelect={() => requestPermanentDelete(base)}
            >
              <Trash2 className="h-4 w-4" />
              Удалить навсегда
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const baseColumns: ColumnDef<ClientBase>[] = [
    {
      accessorKey: 'name',
      header: 'База',
      size: 170,
      meta: {
        cellClassName: 'whitespace-normal',
      },
      cell: ({ row }) => {
        const base = row.original;

        return (
          <div className="min-w-0">
            <div className="break-words font-medium">{base.name}</div>
            {base.description && (
              <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                {base.description}
              </div>
            )}
          </div>
        );
      },
    },
    {
      id: 'filters',
      header: 'Фильтр',
      size: 150,
      meta: {
        cellClassName: 'whitespace-normal text-muted-foreground',
      },
      cell: ({ row }) => (
        <div className="line-clamp-2 leading-5">
          {describeFilters(row.original.filters)}
        </div>
      ),
    },
    {
      accessorKey: 'currentClientCount',
      header: 'Клиентов',
      size: 70,
      meta: {
        cellClassName: 'text-right font-medium',
        headerClassName: 'text-right',
      },
      cell: ({ row }) =>
        row.original.currentClientCount.toLocaleString('ru-RU'),
    },
    {
      id: 'deadline',
      header: () => (
        <span className="inline-flex items-center gap-1.5">
          Срок прозвона
          <HelpTooltip>
            Сколько дней дается на обработку каждого клиента после создания
            задачи. Если срок не задан, используется общий дедлайн задачи.
          </HelpTooltip>
        </span>
      ),
      size: 110,
      meta: {
        cellClassName: 'whitespace-normal text-sm text-muted-foreground',
      },
      cell: ({ row }) => (
        <span title={describeCallDeadline(row.original)}>
          {describeCallDeadline(row.original)}
        </span>
      ),
    },
    {
      id: 'recurrence',
      header: 'Автозадача',
      size: 140,
      meta: {
        cellClassName: 'whitespace-normal',
      },
      cell: ({ row }) => {
        const base = row.original;

        return base.recurrence?.enabled ? (
          <div className="text-sm">
            <div className="truncate">{describeRecurrence(base)}</div>
            <div className="text-xs text-muted-foreground">
              след.: {formatDateTime(base.recurrence.nextRunAt)}
            </div>
          </div>
        ) : (
          <span className="text-sm text-muted-foreground">Не настроена</span>
        );
      },
    },
    {
      id: 'lastTask',
      header: 'Последняя задача',
      size: 145,
      meta: {
        cellClassName: 'whitespace-normal',
      },
      cell: ({ row }) => {
        const base = row.original;

        return base.lastTaskCreatedAt ? (
          <div className="text-sm">
            <div>{formatDateTime(base.lastTaskCreatedAt)}</div>
            <div className="text-xs text-muted-foreground">
              было {base.lastTaskClientCount || 0}, сейчас{' '}
              {base.deltaSinceLastTask === null
                ? '-'
                : base.deltaSinceLastTask >= 0
                  ? `+${base.deltaSinceLastTask}`
                  : base.deltaSinceLastTask}
            </div>
          </div>
        ) : (
          <span className="text-sm text-muted-foreground">
            Задач еще не было
          </span>
        );
      },
    },
    {
      id: 'actions',
      header: '',
      size: 56,
      meta: {
        cellClassName: 'text-right',
        headerClassName: 'text-right',
      },
      cell: ({ row }) => renderBaseActions(row.original),
    },
  ];
  const previewColumns: ColumnDef<ClientPreview>[] = [
    {
      accessorKey: 'name',
      header: 'Клиент',
      meta: {
        cellClassName: 'truncate font-medium',
      },
    },
    {
      accessorKey: 'phone',
      header: 'Телефон',
      meta: {
        cellClassName: 'truncate text-muted-foreground',
      },
    },
    {
      accessorKey: 'source',
      header: 'Источник',
      meta: {
        cellClassName: 'truncate text-muted-foreground',
      },
    },
    {
      id: 'visitCount',
      header: 'Визиты',
      meta: {
        cellClassName: 'text-right font-medium',
        headerClassName: 'text-right',
      },
      cell: ({ row }) => row.original.stats.visitCount,
    },
    {
      id: 'lastVisit',
      header: 'Последний визит',
      meta: {
        cellClassName: 'text-muted-foreground',
      },
      cell: ({ row }) => formatDate(row.original.stats.lastVisitAt),
    },
    {
      accessorKey: 'segment',
      header: 'Сегмент',
      cell: ({ row }) => <Badge variant="outline">{row.original.segment}</Badge>,
    },
    {
      id: 'actions',
      header: '',
      size: 56,
      meta: {
        cellClassName: 'text-right',
        headerClassName: 'text-right',
      },
      cell: ({ row }) => (
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => navigate(`/admin/clients?clientId=${row.original.id}`)}
          aria-label={`Открыть карточку клиента ${row.original.name}`}
          title="Открыть карточку"
        >
          <Eye className="h-4 w-4" />
        </Button>
      ),
    },
  ];

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <h1 className="sr-only">Базы клиентов</h1>
      <div className="flex flex-wrap items-center justify-end gap-2 rounded-2xl border bg-card/80 p-2 shadow-sm shadow-foreground/5">
          <Select
            value={baseStatus}
            onValueChange={(value) => setBaseStatus(value as ClientBaseStatus)}
          >
            <SelectTrigger className="h-9 w-[160px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="active">Активные</SelectItem>
              <SelectItem value="archived">Архив</SelectItem>
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void runRecurringTasks()}
            disabled={runningRecurring}
            title="Проверить базы с наступившим временем автозадачи"
          >
            <Repeat2
              className={`mr-2 h-4 w-4 ${runningRecurring ? 'animate-spin' : ''}`}
            />
            Автозадачи
          </Button>
          <Button size="sm" onClick={openCreate}>
            <Plus className="mr-2 h-4 w-4" /> База
          </Button>
      </div>

      <div className="rounded-md border bg-card">
        <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
          <div className="font-medium">
            {baseStatus === 'active' ? 'Активные базы' : 'Архив баз'}
          </div>
          <Badge variant="outline">{bases.length}</Badge>
        </div>
        <DataTable
          columns={baseColumns}
          data={bases}
          emptyText="Базы еще не созданы."
          errorText={basesError}
          loading={loading && bases.length === 0}
          loadingText="Загрузка баз..."
          onRetry={() => void fetchBases()}
          tableClassName="table-fixed"
          renderMobileCard={(row) => {
            const base = row.original;

            return (
              <div className="min-w-0 rounded-xl border bg-card p-4 shadow-sm">
                <div className="flex min-w-0 items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="break-words font-semibold">{base.name}</div>
                    {base.description && (
                      <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                        {base.description}
                      </div>
                    )}
                  </div>
                  {renderBaseActions(base)}
                </div>
                <div className="mt-4 grid min-w-0 grid-cols-2 gap-3 text-sm">
                  <div className="col-span-2 min-w-0">
                    <div className="text-xs text-muted-foreground">Фильтр</div>
                    <div className="mt-1 break-words">
                      {describeFilters(base.filters)}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">Клиентов</div>
                    <div className="mt-1 font-medium">
                      {base.currentClientCount.toLocaleString('ru-RU')}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">Срок прозвона</div>
                    <div className="mt-1">{describeCallDeadline(base)}</div>
                  </div>
                  <div className="col-span-2">
                    <div className="text-xs text-muted-foreground">Автозадача</div>
                    <div className="mt-1">
                      {base.recurrence?.enabled
                        ? describeRecurrence(base)
                        : 'Не настроена'}
                    </div>
                  </div>
                  <div className="col-span-2">
                    <div className="text-xs text-muted-foreground">Последняя задача</div>
                    <div className="mt-1">
                      {base.lastTaskCreatedAt
                        ? formatDateTime(base.lastTaskCreatedAt)
                        : 'Задач еще не было'}
                    </div>
                  </div>
                </div>
              </div>
            );
          }}
        />
      </div>

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-[820px]">
          <DialogHeader>
            <DialogTitle>
              {editingBase ? 'Редактировать базу' : 'Новая база'}
            </DialogTitle>
            <DialogDescription>
              База хранит фильтр, а не ручной список клиентов.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSave} className="space-y-4 pt-2">
            {editingBase?.origin === 'visits_analytics' && (
              <div className="rounded-md border border-sky-500/30 bg-sky-500/10 p-3 text-sm">
                Состав этой базы задан аналитикой посещений. Критерии, stable source keys и asOf сохраняются без изменений; здесь можно изменить название, описание, срок и настройки обзвона.
              </div>
            )}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-medium">Название</label>
                <Input
                  required
                  value={form.name}
                  onChange={(event) =>
                    setForm({ ...form, name: event.target.value })
                  }
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">
                  Поиск
                </label>
                <Input
                  value={form.q}
                  onChange={(event) => setForm({ ...form, q: event.target.value })}
                  placeholder="Имя или телефон"
                />
              </div>
            </div>

            {formError && (
              <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm font-medium text-destructive">
                {formError}
              </div>
            )}

            <div>
              <label className="mb-1 block text-xs font-medium">Описание</label>
              <textarea
                value={form.description}
                onChange={(event) =>
                  setForm({ ...form, description: event.target.value })
                }
                className="min-h-[80px] w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>

            <div className="rounded-md border p-3">
              <div className="text-sm font-medium">Срок прозвона</div>
              <div className="mt-1 text-xs text-muted-foreground">
                Сколько дней дается на обработку каждого клиента после создания
                задачи. Если пусто, используется общий дедлайн задачи.
              </div>
              <div className="mt-3 max-w-[220px]">
                <label className="mb-1 block text-xs font-medium">
                  Дней на обработку
                </label>
                <Input
                  inputMode="numeric"
                  value={form.slaDays}
                  onChange={(event) =>
                    setForm({ ...form, slaDays: event.target.value })
                  }
                  placeholder="2"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <div>
                <label className="mb-1 block text-xs font-medium">Сегмент</label>
                <Select
                  value={form.segment}
                  onValueChange={(value) =>
                    setForm({ ...form, segment: value as ClientSegment })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Все сегменты</SelectItem>
                    <SelectItem value="new">Новые</SelectItem>
                    <SelectItem value="regular">Постоянные</SelectItem>
                    <SelectItem value="inactive">Давно не были</SelectItem>
                    <SelectItem value="no_visits">Без визитов</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">Статус</label>
                <Select
                  value={form.status}
                  onValueChange={(value) =>
                    setForm({
                      ...form,
                      status: value as 'active' | 'archived' | 'all',
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Активные</SelectItem>
                    <SelectItem value="archived">Архив</SelectItem>
                    <SelectItem value="all">Все статусы</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">Источник</label>
                <Select
                  value={form.sourceId || 'all'}
                  onValueChange={(sourceId) => {
                    if (sourceId === 'all') {
                      setForm({ ...form, sourceId: '', source: '' });
                      return;
                    }
                    const source = clientSources.find(
                      (item) => String(item.id) === sourceId,
                    );
                    setForm({
                      ...form,
                      sourceId,
                      source: source?.name || '',
                    });
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Любой источник" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Любой источник</SelectItem>
                    {clientSources.map((source) => (
                      <SelectItem key={source.id} value={String(source.id)}>
                        {source.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <div>
                <label className="mb-1 block text-xs font-medium">
                  Категория визита
                </label>
                <Select
                  value={form.visitCategoryId || 'all'}
                  onValueChange={(visitCategoryId) => {
                    if (visitCategoryId === 'all') {
                      setForm({
                        ...form,
                        visitCategoryId: '',
                        visitCategory: '',
                      });
                      return;
                    }
                    const category = visitCategories.find(
                      (item) => String(item.id) === visitCategoryId,
                    );
                    setForm({
                      ...form,
                      visitCategoryId,
                      visitCategory: category?.name || '',
                    });
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Любая категория" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Любая категория</SelectItem>
                    {visitCategories.map((category) => (
                      <SelectItem key={category.id} value={String(category.id)}>
                        {category.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">
                  Визитов от
                </label>
                <Input
                  inputMode="numeric"
                  value={form.visitCountMin}
                  onChange={(event) =>
                    setForm({ ...form, visitCountMin: event.target.value })
                  }
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">
                  Визитов до
                </label>
                <Input
                  inputMode="numeric"
                  value={form.visitCountMax}
                  onChange={(event) =>
                    setForm({ ...form, visitCountMax: event.target.value })
                  }
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-medium">
                  Не были от, дней
                </label>
                <Input
                  inputMode="numeric"
                  value={form.lastVisitDaysFrom}
                  onChange={(event) =>
                    setForm({ ...form, lastVisitDaysFrom: event.target.value })
                  }
                  placeholder="7"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">
                  Не были до, дней
                </label>
                <Input
                  inputMode="numeric"
                  value={form.lastVisitDaysTo}
                  onChange={(event) =>
                    setForm({ ...form, lastVisitDaysTo: event.target.value })
                  }
                  placeholder="14"
                />
              </div>
            </div>

            <div className="rounded-md border p-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className="text-sm font-medium">Автозадача обзвона</div>
                  <div className="text-xs text-muted-foreground">
                    CRM сама создаст задачу по расписанию из этого фильтра.
                  </div>
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={form.recurringEnabled}
                    onChange={(event) =>
                      setForm({
                        ...form,
                        recurringEnabled: event.target.checked,
                      })
                    }
                    className="h-4 w-4"
                  />
                  Включить
                </label>
              </div>

              {form.recurringEnabled && (
                <div className="mt-4 space-y-3">
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
                    <div>
                      <label className="mb-1 block text-xs font-medium">
                        Период
                      </label>
                      <Select
                        value={form.recurringInterval}
                        onValueChange={(value) =>
                          setForm({
                            ...form,
                            recurringInterval: value as RecurringInterval,
                          })
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="daily">Ежедневно</SelectItem>
                          <SelectItem value="weekly">Еженедельно</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium">
                        День
                      </label>
                      <Select
                        value={form.recurringWeekday}
                        disabled={form.recurringInterval === 'daily'}
                        onValueChange={(value) =>
                          setForm({ ...form, recurringWeekday: value })
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {Object.entries(WEEKDAY_LABELS).map(([value, label]) => (
                            <SelectItem key={value} value={value}>
                              {label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium">
                        Время
                      </label>
                      <Input
                        type="time"
                        value={form.recurringTime}
                        onChange={(event) =>
                          setForm({ ...form, recurringTime: event.target.value })
                        }
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium">
                        Дедлайн, дней
                      </label>
                      <Input
                        inputMode="numeric"
                        placeholder="2"
                        value={form.recurringDueDays}
                        onChange={(event) =>
                          setForm({
                            ...form,
                            recurringDueDays: event.target.value,
                          })
                        }
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                      <label className="mb-1 block text-xs font-medium">
                        Режим задачи
                      </label>
                      <Select
                        value={form.recurringScopeType}
                        onValueChange={(value) =>
                          setForm({
                            ...form,
                            recurringScopeType: value as RecurringScopeType,
                          })
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="snapshot">
                            Фиксированный список
                          </SelectItem>
                          <SelectItem value="dynamic">
                            Автообновляемая
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium">
                        Исполнитель
                      </label>
                      <Select
                        value={form.recurringAssignedToAccountId}
                        onValueChange={(value) =>
                          setForm({
                            ...form,
                            recurringAssignedToAccountId: value,
                          })
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">Не назначен</SelectItem>
                          {accounts
                            .filter((item) =>
                              ['owner', 'manager', 'admin'].includes(item.role) &&
                              item.status === 'active',
                            )
                            .map((item) => (
                              <SelectItem key={item.id} value={String(item.id)}>
                                {item.Staff?.name || item.email}
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                      <label className="mb-1 block text-xs font-medium">
                        Название задачи
                      </label>
                      <Input
                        value={form.recurringTitle}
                        onChange={(event) =>
                          setForm({
                            ...form,
                            recurringTitle: event.target.value,
                          })
                        }
                        placeholder="По умолчанию: название базы + дата"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium">
                        Описание задачи
                      </label>
                      <Input
                        value={form.recurringDescription}
                        onChange={(event) =>
                          setForm({
                            ...form,
                            recurringDescription: event.target.value,
                          })
                        }
                        placeholder="Что нужно сказать клиентам"
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>

            <Button type="submit" className="w-full">
              <Save className="mr-2 h-4 w-4" />
              Сохранить
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(previewBase)} onOpenChange={(open) => !open && setPreviewBase(null)}>
        <DialogContent className="max-h-[calc(100dvh-1rem)] max-w-[calc(100vw-1rem)] overflow-y-auto p-3 sm:max-w-[980px] sm:p-4">
          <DialogHeader>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <DialogTitle className="flex items-center gap-2">
                  <Users className="h-5 w-5 text-muted-foreground" />
                  {previewBase?.name || 'База'}
                </DialogTitle>
                <DialogDescription>
                  Сейчас подходит клиентов: {previewTotal.toLocaleString('ru-RU')}.
                  Показаны первые 20.
                </DialogDescription>
              </div>
              {previewBase && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => openBaseInClients(previewBase)}
                >
                  <Users className="mr-2 h-4 w-4" />
                  Все в клиентах
                </Button>
              )}
            </div>
          </DialogHeader>

          <div className="rounded-md border">
            <DataTable
              columns={previewColumns}
              data={previewClients}
              emptyText="Клиенты не найдены."
              errorText={previewError}
              loading={previewLoading}
              loadingText="Загрузка..."
              onRetry={() => previewBase && void openPreview(previewBase)}
              tableClassName="table-fixed"
              renderMobileCard={(row) => {
                const client = row.original;

                return (
                  <button
                    type="button"
                    className="w-full min-w-0 rounded-xl border bg-card p-4 text-left shadow-sm transition hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={() => navigate(`/admin/clients?clientId=${client.id}`)}
                  >
                    <div className="break-words font-semibold">{client.name}</div>
                    <div className="mt-1 break-all text-sm text-muted-foreground">
                      {client.phone}
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                      <div>
                        <div className="text-xs text-muted-foreground">Источник</div>
                        <div className="mt-1 break-words">{client.source || '-'}</div>
                      </div>
                      <div>
                        <div className="text-xs text-muted-foreground">Сегмент</div>
                        <div className="mt-1">{client.segment}</div>
                      </div>
                      <div>
                        <div className="text-xs text-muted-foreground">Визиты</div>
                        <div className="mt-1 font-medium">{client.stats.visitCount}</div>
                      </div>
                      <div>
                        <div className="text-xs text-muted-foreground">Последний визит</div>
                        <div className="mt-1">{formatDate(client.stats.lastVisitAt)}</div>
                      </div>
                    </div>
                  </button>
                );
              }}
            />
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(callTaskBase)}
        onOpenChange={(open) => !open && setCallTaskBase(null)}
      >
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-[720px]">
          <DialogHeader>
            <DialogTitle>Создать обзвон</DialogTitle>
            <DialogDescription>
              Задача создается из базы «{callTaskBase?.name}». Для обычного
              обзвона список клиентов фиксируется на момент создания. Срок
              прозвона: {callTaskBase ? describeCallDeadline(callTaskBase) : '-'}.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleCreateCallTask} className="space-y-4 pt-2">
            <div>
              <label className="mb-1 block text-xs font-medium">Название</label>
              <Input
                required
                value={callTaskForm.title}
                onChange={(event) =>
                  setCallTaskForm({
                    ...callTaskForm,
                    title: event.target.value,
                  })
                }
              />
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div>
                <label className="mb-1 block text-xs font-medium">Режим</label>
                <Select
                  value={callTaskForm.scopeType}
                  onValueChange={(scopeType) =>
                    setCallTaskForm({
                      ...callTaskForm,
                      scopeType: scopeType as 'snapshot' | 'dynamic',
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="snapshot">Фиксированный список</SelectItem>
                    <SelectItem value="dynamic">Автообновляемая</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">
                  Исполнитель
                </label>
                <Select
                  value={callTaskForm.assignedToAccountId}
                  onValueChange={(assignedToAccountId) =>
                    setCallTaskForm({ ...callTaskForm, assignedToAccountId })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Не назначен</SelectItem>
                    {accounts
                      .filter((item) =>
                        ['owner', 'manager', 'admin'].includes(item.role) &&
                        item.status === 'active',
                      )
                      .map((item) => (
                        <SelectItem key={item.id} value={String(item.id)}>
                          {item.Staff?.name || item.email}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">Дедлайн</label>
                <Input
                  type="datetime-local"
                  value={callTaskForm.dueAt}
                  onChange={(event) =>
                    setCallTaskForm({ ...callTaskForm, dueAt: event.target.value })
                  }
                />
              </div>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium">Описание</label>
              <textarea
                value={callTaskForm.description}
                onChange={(event) =>
                  setCallTaskForm({
                    ...callTaskForm,
                    description: event.target.value,
                  })
                }
                className="min-h-[90px] w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                placeholder="Кого звоним и какой результат нужен"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium">
                Скрипт обзвона
              </label>
              <textarea
                value={callTaskForm.scriptText}
                onChange={(event) =>
                  setCallTaskForm({
                    ...callTaskForm,
                    scriptText: event.target.value,
                  })
                }
                className="min-h-[180px] w-full rounded-md border bg-background px-3 py-2 text-sm leading-6 outline-none focus-visible:ring-2 focus-visible:ring-ring"
                placeholder="Вставьте текст скрипта для администратора"
              />
            </div>

            {callTaskError && (
              <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm font-medium text-destructive">
                {callTaskError}
              </div>
            )}

            <Button type="submit" className="w-full" disabled={callTaskSaving}>
              <PhoneCall className="mr-2 h-4 w-4" />
              {callTaskSaving ? 'Создаем...' : 'Создать задачу обзвона'}
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmActionDialog
        action={pendingAction}
        loading={pendingActionLoading}
        onCancel={() => setPendingAction(null)}
        onConfirm={confirmPendingAction}
      />
    </div>
  );
}
