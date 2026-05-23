import { useCallback, useEffect, useState } from 'react';
import {
  Archive,
  ArchiveRestore,
  Eye,
  Pencil,
  PhoneCall,
  Plus,
  RefreshCw,
  Repeat2,
  Save,
  Trash2,
  Users,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
import { Input } from '@/components/ui/input';
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
import type { ReferenceItem } from '@/lib/references';
import { fetchReferences } from '@/lib/references';
import { useNavigate } from 'react-router-dom';

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
}

interface ClientBase {
  id: number;
  name: string;
  description: string;
  filters: ClientBaseFilters;
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
  scopeType: 'snapshot',
  title: '',
};

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
  const [bases, setBases] = useState<ClientBase[]>([]);
  const [loading, setLoading] = useState(true);
  const [baseStatus, setBaseStatus] = useState<ClientBaseStatus>('active');
  const [formOpen, setFormOpen] = useState(false);
  const [formError, setFormError] = useState('');
  const [editingBase, setEditingBase] = useState<ClientBase | null>(null);
  const [form, setForm] = useState<BaseFormState>(EMPTY_FORM);
  const [clientSources, setClientSources] = useState<ReferenceItem[]>([]);
  const [visitCategories, setVisitCategories] = useState<ReferenceItem[]>([]);
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [previewBase, setPreviewBase] = useState<ClientBase | null>(null);
  const [previewClients, setPreviewClients] = useState<ClientPreview[]>([]);
  const [previewTotal, setPreviewTotal] = useState(0);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [callTaskBase, setCallTaskBase] = useState<ClientBase | null>(null);
  const [callTaskForm, setCallTaskForm] =
    useState<CallTaskFormState>(EMPTY_CALL_TASK_FORM);
  const [callTaskError, setCallTaskError] = useState('');
  const [callTaskSaving, setCallTaskSaving] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [pendingActionLoading, setPendingActionLoading] = useState(false);
  const [runningRecurring, setRunningRecurring] = useState(false);

  const fetchBases = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch(`/api/client-bases?status=${baseStatus}`);
      if (!res.ok) {
        alert(await readError(res, 'Не удалось загрузить базы'));
        return;
      }

      setBases((await res.json()) as ClientBase[]);
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

  const openCreate = () => {
    setEditingBase(null);
    setForm(EMPTY_FORM);
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
    setForm(nextForm);
    setFormError('');
    setFormOpen(true);
  };

  const handleSave = async (event: React.FormEvent) => {
    event.preventDefault();
    setFormError('');

    if (form.name.trim().length < 2) {
      setFormError('Введите название базы не короче 2 символов.');
      return;
    }
    if (form.recurringEnabled && form.status !== 'active') {
      setFormError(
        'Автозадачи можно включить только для базы с активными клиентами.',
      );
      return;
    }

    const payload = {
      description: form.description.trim(),
      filters: buildFilters(form),
      name: form.name.trim(),
      recurrence: buildRecurrence(form),
      slaDays: form.slaDays.trim() ? Number(form.slaDays) : null,
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
  };

  const executeArchiveBase = async (base: ClientBase) => {
    const res = await apiFetch(`/api/client-bases/${base.id}`, {
      method: 'DELETE',
    });
    if (!res.ok) {
      alert(await readError(res, 'Не удалось архивировать базу'));
      return;
    }

    await fetchBases();
  };

  const executeRestoreBase = async (base: ClientBase) => {
    const res = await apiFetch(`/api/client-bases/${base.id}/restore`, {
      method: 'POST',
    });
    if (!res.ok) {
      alert(await readError(res, 'Не удалось восстановить базу'));
      return;
    }

    await fetchBases();
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
      alert(await readError(res, 'Не удалось удалить базу из архива'));
      return;
    }

    await fetchBases();
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

  const openPreview = async (base: ClientBase) => {
    setPreviewBase(base);
    setPreviewClients([]);
    setPreviewTotal(0);
    setPreviewLoading(true);
    try {
      const res = await apiFetch(
        `/api/client-bases/${base.id}/clients?page=1&pageSize=20`,
      );
      if (!res.ok) {
        alert(await readError(res, 'Не удалось открыть базу'));
        return;
      }

      const data = (await res.json()) as ClientsResponse;
      setPreviewClients(data.items);
      setPreviewTotal(data.total);
    } finally {
      setPreviewLoading(false);
    }
  };

  const openCreateCallTask = (base: ClientBase) => {
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
    setCallTaskForm({
      ...EMPTY_CALL_TASK_FORM,
      title: `${base.name}: обзвон`,
    });
    setCallTaskError('');
  };

  const runRecurringTasks = async () => {
    setRunningRecurring(true);
    try {
      const res = await apiFetch('/api/call-tasks/recurring/run', {
        method: 'POST',
      });
      if (!res.ok) {
        alert(await readError(res, 'Не удалось запустить автозадачи'));
        return;
      }
      const result = (await res.json()) as { processed: number };
      alert(`Проверено автозадач: ${result.processed}`);
      await fetchBases();
    } finally {
      setRunningRecurring(false);
    }
  };

  const handleCreateCallTask = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!callTaskBase) return;

    setCallTaskSaving(true);
    setCallTaskError('');
    const res = await apiFetch(`/api/client-bases/${callTaskBase.id}/call-tasks`, {
      method: 'POST',
      body: JSON.stringify({
        assignedToAccountId:
          callTaskForm.assignedToAccountId === 'none'
            ? null
            : Number(callTaskForm.assignedToAccountId),
        description: callTaskForm.description.trim(),
        dueAt: callTaskForm.dueAt || null,
        scopeType: callTaskForm.scopeType,
        title: callTaskForm.title.trim(),
      }),
    });

    setCallTaskSaving(false);
    if (!res.ok) {
      setCallTaskError(await readError(res, 'Не удалось создать обзвон'));
      return;
    }

    setCallTaskBase(null);
    await fetchBases();
    navigate('/admin/call-tasks');
  };

  return (
    <div className="min-w-0 space-y-4 p-4 md:p-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Базы клиентов</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Сохраненные фильтры клиентской базы. Задачи на обзвон будут
            создаваться из этих баз.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Select
            value={baseStatus}
            onValueChange={(value) => setBaseStatus(value as ClientBaseStatus)}
          >
            <SelectTrigger className="w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="active">Активные</SelectItem>
              <SelectItem value="archived">Архив</SelectItem>
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="icon"
            onClick={fetchBases}
            disabled={loading}
            aria-label="Обновить базы клиентов"
            title="Обновить"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
          <Button
            variant="outline"
            onClick={() => void runRecurringTasks()}
            disabled={runningRecurring}
            title="Проверить базы с наступившим временем автозадачи"
          >
            <Repeat2
              className={`mr-2 h-4 w-4 ${runningRecurring ? 'animate-spin' : ''}`}
            />
            Автозадачи
          </Button>
          <Button onClick={openCreate}>
            <Plus className="mr-2 h-4 w-4" /> База
          </Button>
        </div>
      </div>

      <div className="rounded-md border bg-card">
        <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
          <div className="font-medium">
            {baseStatus === 'active' ? 'Активные базы' : 'Архив баз'}
          </div>
          <Badge variant="outline">{bases.length}</Badge>
        </div>
        <div className="overflow-x-auto">
          <Table className="min-w-[1280px] table-fixed">
            <TableHeader>
              <TableRow>
                <TableHead className="w-[24%]">База</TableHead>
                <TableHead className="w-[22%]">Фильтр</TableHead>
                <TableHead className="w-[96px] text-right">Клиентов</TableHead>
                <TableHead className="w-[150px]">
                  <span className="inline-flex items-center gap-1.5">
                    Срок прозвона
                    <HelpTooltip>
                      Сколько дней дается на обработку каждого клиента после
                      создания задачи. Если срок не задан, используется общий
                      дедлайн задачи.
                    </HelpTooltip>
                  </span>
                </TableHead>
                <TableHead className="w-[18%]">Автозадача</TableHead>
                <TableHead className="w-[18%]">Последняя задача</TableHead>
                <TableHead className="w-[150px] text-right"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && bases.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                    Загрузка баз...
                  </TableCell>
                </TableRow>
              )}
              {!loading && bases.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                    Базы еще не созданы.
                  </TableCell>
                </TableRow>
              )}
              {bases.map((base) => (
                <TableRow key={base.id}>
                  <TableCell className="whitespace-normal">
                    <div className="min-w-0">
                      <div className="truncate font-medium">{base.name}</div>
                      {base.description && (
                        <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                          {base.description}
                        </div>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="whitespace-normal text-muted-foreground">
                    <div className="line-clamp-2 leading-5">
                      {describeFilters(base.filters)}
                    </div>
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    {base.currentClientCount.toLocaleString('ru-RU')}
                  </TableCell>
                  <TableCell className="whitespace-normal text-sm text-muted-foreground">
                    <span title={describeCallDeadline(base)}>
                      {describeCallDeadline(base)}
                    </span>
                  </TableCell>
                  <TableCell className="whitespace-normal">
                    {base.recurrence?.enabled ? (
                      <div className="text-sm">
                        <div className="truncate">{describeRecurrence(base)}</div>
                        <div className="text-xs text-muted-foreground">
                          след.: {formatDateTime(base.recurrence.nextRunAt)}
                        </div>
                      </div>
                    ) : (
                      <span className="text-sm text-muted-foreground">
                        Не настроена
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="whitespace-normal">
                    {base.lastTaskCreatedAt ? (
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
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => void openPreview(base)}
                        aria-label={`Открыть базу ${base.name}`}
                        title="Открыть"
                      >
                        <Eye className="h-4 w-4" />
                      </Button>
                      {base.status === 'active' && (
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => openCreateCallTask(base)}
                          aria-label={`Создать обзвон по базе ${base.name}`}
                          title={
                            getCallTaskBlockedReason(base) || 'Создать обзвон'
                          }
                        >
                          <PhoneCall className="h-4 w-4" />
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => openEdit(base)}
                        aria-label={`Редактировать базу ${base.name}`}
                        title="Редактировать"
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      {base.status === 'active' ? (
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => requestBaseStatusChange(base)}
                          aria-label={`Архивировать базу ${base.name}`}
                          title="Архивировать"
                        >
                          <Archive className="h-4 w-4" />
                        </Button>
                      ) : (
                        <>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => requestBaseStatusChange(base)}
                            aria-label={`Восстановить базу ${base.name}`}
                            title="Восстановить"
                          >
                            <ArchiveRestore className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                            onClick={() => requestPermanentDelete(base)}
                            aria-label={`Удалить навсегда базу ${base.name}`}
                            title="Удалить навсегда"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
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
            <DialogTitle className="flex items-center gap-2">
              <Users className="h-5 w-5 text-muted-foreground" />
              {previewBase?.name || 'База'}
            </DialogTitle>
            <DialogDescription>
              Сейчас подходит клиентов: {previewTotal.toLocaleString('ru-RU')}.
              Показаны первые 20.
            </DialogDescription>
          </DialogHeader>

          <div className="overflow-x-auto rounded-md border">
            <Table className="min-w-[760px] table-fixed">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[28%]">Клиент</TableHead>
                  <TableHead className="w-[18%]">Телефон</TableHead>
                  <TableHead className="w-[18%]">Источник</TableHead>
                  <TableHead className="w-[12%] text-right">Визиты</TableHead>
                  <TableHead className="w-[16%]">Последний визит</TableHead>
                  <TableHead className="w-[8%]">Сегмент</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {previewLoading && (
                  <TableRow>
                    <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                      Загрузка...
                    </TableCell>
                  </TableRow>
                )}
                {!previewLoading && previewClients.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                      Клиенты не найдены.
                    </TableCell>
                  </TableRow>
                )}
                {previewClients.map((client) => (
                  <TableRow key={client.id}>
                    <TableCell className="truncate font-medium">
                      {client.name}
                    </TableCell>
                    <TableCell className="truncate text-muted-foreground">
                      {client.phone}
                    </TableCell>
                    <TableCell className="truncate text-muted-foreground">
                      {client.source}
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      {client.stats.visitCount}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDate(client.stats.lastVisitAt)}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{client.segment}</Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
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
