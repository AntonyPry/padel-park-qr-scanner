import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Archive,
  ArchiveRestore,
  BarChart3,
  CheckCircle2,
  Clock,
  ListChecks,
  MessageSquareText,
  Pencil,
  PhoneCall,
  RefreshCw,
  Repeat2,
  Save,
  Trash2,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  ConfirmActionDialog,
  type ConfirmAction,
} from '@/components/confirm-action-dialog';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { Input } from '@/components/ui/input';
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
import {
  HelpTooltip,
  MetricCard,
  MetricLabel,
} from '@/components/dashboard-metric';
import { apiFetch } from '@/lib/api';
import { canManageCallTasks } from '@/lib/permissions';
import { useAuth } from '@/lib/useAuth';

type CallTaskStatus = 'backlog' | 'in_progress' | 'done' | 'archived';
type TaskFilterStatus = CallTaskStatus | 'active' | 'all';
type CallTaskClientStatus =
  | 'new'
  | 'no_answer'
  | 'callback'
  | 'doubting'
  | 'booked'
  | 'refused';
type ClientFilterStatus = CallTaskClientStatus | 'all' | 'overdue';

interface CallTask {
  assignedTo?: {
    id: number;
    name: string;
  } | null;
  clientBase?: {
    id: number;
    name: string;
  } | null;
  counts: Record<CallTaskClientStatus, number>;
  currentBaseClientCount?: number | null;
  description?: string;
  dueAt?: string | null;
  id: number;
  membershipDiff?: {
    addedCount: number;
    currentCount: number;
    removedCount: number;
    taskCount: number;
    updatedCount: number;
  } | null;
  metrics?: CallTaskMetrics;
  newInBaseCount?: number | null;
  overdueCount: number;
  scopeType: 'snapshot' | 'dynamic';
  snapshotClientCount: number;
  status: CallTaskStatus;
  title: string;
  totalClientCount: number;
}

interface CallTaskMetrics {
  bookedCount: number;
  completionRate: number;
  contactedCount: number;
  contactRate: number;
  conversionRate: number;
  finishedCount: number;
  overdueRate: number;
}

interface CallTaskClient {
  client?: {
    id: number;
    name: string;
    phone: string;
    status: string;
  } | null;
  clientName: string;
  clientPhone?: string | null;
  contactedAt?: string | null;
  deadlineAt?: string | null;
  id: number;
  attempts?: Array<{
    actor?: {
      id: number;
      name: string;
    } | null;
    createdAt: string;
    deadlineAt?: string | null;
    id: number;
    status: CallTaskClientStatus;
    summary: string;
  }>;
  lastAttempt?: {
    createdAt: string;
    status: CallTaskClientStatus;
    summary: string;
  } | null;
  lastVisitAt?: string | null;
  source?: string | null;
  status: CallTaskClientStatus;
  summary: string;
  visitCount: number;
}

interface TaskClientsResponse {
  items: CallTaskClient[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

interface CallTasksReport {
  attemptsCount: number;
  counts: Record<CallTaskClientStatus, number>;
  metrics: CallTaskMetrics;
  overdueCount: number;
  tasksCount: number;
  totalClientCount: number;
}

interface AttemptFormState {
  deadlineAt: string;
  status: CallTaskClientStatus;
  summary: string;
}

interface BulkFormState {
  deadlineAt: string;
  status: CallTaskClientStatus | 'keep';
  summary: string;
}

interface TaskFormState {
  assignedToAccountId: string;
  description: string;
  dueAt: string;
  scopeType: 'snapshot' | 'dynamic';
  title: string;
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

type ConfirmActionState = ConfirmAction & {
  onConfirm: () => Promise<void>;
};

const TASK_STATUS_LABELS: Record<CallTaskStatus, string> = {
  archived: 'Архив',
  backlog: 'Бэклог',
  done: 'Готово',
  in_progress: 'В работе',
};

const CLIENT_STATUS_LABELS: Record<CallTaskClientStatus, string> = {
  booked: 'Записался',
  callback: 'Перезвонить',
  doubting: 'Сомневается',
  new: 'Не звонили',
  no_answer: 'Не взял трубку',
  refused: 'Отказ',
};

const CLIENT_STATUSES: CallTaskClientStatus[] = [
  'new',
  'no_answer',
  'callback',
  'doubting',
  'booked',
  'refused',
];

const EMPTY_ATTEMPT_FORM: AttemptFormState = {
  deadlineAt: '',
  status: 'new',
  summary: '',
};

const EMPTY_BULK_FORM: BulkFormState = {
  deadlineAt: '',
  status: 'keep',
  summary: '',
};

const EMPTY_TASK_FORM: TaskFormState = {
  assignedToAccountId: 'none',
  description: '',
  dueAt: '',
  scopeType: 'snapshot',
  title: '',
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

function formatPercent(value?: number | null) {
  return `${Number(value || 0).toLocaleString('ru-RU', {
    maximumFractionDigits: 1,
  })}%`;
}

function formatForDateTimeInput(value?: string | null) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const offsetDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return offsetDate.toISOString().slice(0, 16);
}

function isClientOverdue(client: CallTaskClient) {
  if (!client.deadlineAt || ['booked', 'refused'].includes(client.status)) {
    return false;
  }

  return new Date(client.deadlineAt).getTime() < Date.now();
}

async function readError(response: Response, fallback: string) {
  try {
    const data = (await response.json()) as { error?: string };
    return data.error || fallback;
  } catch {
    return fallback;
  }
}

function getTaskProgress(task: CallTask) {
  const done = task.counts.booked + task.counts.refused;
  const total = task.totalClientCount || task.snapshotClientCount || 0;
  return { done, total };
}

function getTaskStatusActionCopy(task: CallTask, nextStatus: CallTaskStatus) {
  const taskName = `«${task.title}»`;
  const copy: Record<
    CallTaskStatus,
    { confirmLabel: string; description: string; isDestructive?: boolean; title: string }
  > = {
    archived: {
      confirmLabel: 'Перенести в архив',
      description: `Задача ${taskName} пропадет из активного списка, но останется в архиве и ее можно будет восстановить.`,
      isDestructive: true,
      title: 'Перенести задачу в архив?',
    },
    backlog: {
      confirmLabel: 'Вернуть в бэклог',
      description: `Задача ${taskName} снова появится в активных задачах и будет доступна для работы.`,
      title: 'Вернуть задачу из архива?',
    },
    done: {
      confirmLabel: 'Завершить',
      description: `Задача ${taskName} будет отмечена как готовая. История звонков и результаты клиентов сохранятся.`,
      title: 'Завершить задачу?',
    },
    in_progress: {
      confirmLabel: 'Перевести в работу',
      description: `Задача ${taskName} перейдет в статус «В работе» и останется доступной исполнителю.`,
      title: 'Перевести задачу в работу?',
    },
  };

  return copy[nextStatus];
}

export default function CallTasksPage() {
  const { account } = useAuth();
  const canManage = canManageCallTasks(account?.role);
  const [tasks, setTasks] = useState<CallTask[]>([]);
  const [report, setReport] = useState<CallTasksReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<TaskFilterStatus>('active');
  const [selectedTask, setSelectedTask] = useState<CallTask | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<number | null>(null);
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [clients, setClients] = useState<CallTaskClient[]>([]);
  const [clientsLoading, setClientsLoading] = useState(false);
  const [clientStatus, setClientStatus] = useState<ClientFilterStatus>('all');
  const [clientQuery, setClientQuery] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalClients, setTotalClients] = useState(0);
  const [selectedClientIds, setSelectedClientIds] = useState<number[]>([]);
  const [editingClient, setEditingClient] = useState<CallTaskClient | null>(null);
  const [attemptForm, setAttemptForm] =
    useState<AttemptFormState>(EMPTY_ATTEMPT_FORM);
  const [savingAttempt, setSavingAttempt] = useState(false);
  const [bulkDialogOpen, setBulkDialogOpen] = useState(false);
  const [bulkForm, setBulkForm] = useState<BulkFormState>(EMPTY_BULK_FORM);
  const [savingBulk, setSavingBulk] = useState(false);
  const [confirmAction, setConfirmAction] =
    useState<ConfirmActionState | null>(null);
  const [confirmingAction, setConfirmingAction] = useState(false);
  const [editingTask, setEditingTask] = useState<CallTask | null>(null);
  const [taskForm, setTaskForm] = useState<TaskFormState>(EMPTY_TASK_FORM);
  const [savingTask, setSavingTask] = useState(false);
  const [syncingTask, setSyncingTask] = useState(false);
  const tasksRequestIdRef = useRef(0);
  const reportRequestIdRef = useRef(0);
  const clientsRequestIdRef = useRef(0);
  const taskDetailsRequestIdRef = useRef(0);

  const fetchTasks = useCallback(async () => {
    const requestId = tasksRequestIdRef.current + 1;
    tasksRequestIdRef.current = requestId;
    setLoading(true);
    try {
      const res = await apiFetch(`/api/call-tasks?status=${status}`);
      if (requestId !== tasksRequestIdRef.current) return;
      if (!res.ok) {
        alert(await readError(res, 'Не удалось загрузить задачи обзвона'));
        return;
      }
      const data = (await res.json()) as CallTask[];
      if (requestId !== tasksRequestIdRef.current) return;
      setTasks(data);
      setSelectedTask(
        selectedTaskId
          ? data.find((task) => task.id === selectedTaskId) || null
          : null,
      );
    } finally {
      if (requestId === tasksRequestIdRef.current) {
        setLoading(false);
      }
    }
  }, [selectedTaskId, status]);

  const fetchReport = useCallback(async () => {
    const requestId = reportRequestIdRef.current + 1;
    reportRequestIdRef.current = requestId;
    try {
      const res = await apiFetch(`/api/call-tasks/report?status=${status}`);
      if (requestId !== reportRequestIdRef.current) return;
      if (!res.ok) {
        setReport(null);
        return;
      }

      const nextReport = (await res.json()) as CallTasksReport;
      if (requestId === reportRequestIdRef.current) {
        setReport(nextReport);
      }
    } catch {
      if (requestId === reportRequestIdRef.current) {
        setReport(null);
      }
    }
  }, [status]);

  const fetchAccounts = useCallback(async () => {
    try {
      const res = await apiFetch('/api/accounts');
      if (!res.ok) return;
      setAccounts((await res.json()) as AccountOption[]);
    } catch {
      setAccounts([]);
    }
  }, []);

  const openTask = useCallback(async (task: CallTask) => {
    const requestId = taskDetailsRequestIdRef.current + 1;
    taskDetailsRequestIdRef.current = requestId;
    setSelectedTaskId(task.id);
    setSelectedTask(task);
    setClients([]);
    setTotalClients(0);
    setTotalPages(1);
    setSelectedClientIds([]);
    setEditingClient(null);
    setBulkDialogOpen(false);

    const res = await apiFetch(`/api/call-tasks/${task.id}`);
    if (res.ok) {
      const freshTask = (await res.json()) as CallTask;
      if (requestId === taskDetailsRequestIdRef.current) {
        setSelectedTask(freshTask);
      }
    }
  }, []);

  const refreshTaskDetails = useCallback(async (taskId: number) => {
    const requestId = taskDetailsRequestIdRef.current + 1;
    taskDetailsRequestIdRef.current = requestId;
    const res = await apiFetch(`/api/call-tasks/${taskId}`);
    if (!res.ok || requestId !== taskDetailsRequestIdRef.current) return;

    const freshTask = (await res.json()) as CallTask;
    setSelectedTask((current) =>
      current?.id === freshTask.id ? freshTask : current,
    );
    setSelectedTaskId((current) =>
      current === freshTask.id ? freshTask.id : current,
    );
  }, []);

  const fetchClients = useCallback(async () => {
    const requestId = clientsRequestIdRef.current + 1;
    clientsRequestIdRef.current = requestId;

    if (!selectedTask) {
      setClients([]);
      setTotalClients(0);
      setTotalPages(1);
      setClientsLoading(false);
      return;
    }

    setClientsLoading(true);
    setClients([]);
    setTotalClients(0);
    const params = new URLSearchParams({
      page: String(page),
      pageSize: '25',
      status: clientStatus === 'overdue' ? 'all' : clientStatus,
    });
    if (clientStatus === 'overdue') params.set('overdue', 'true');
    if (clientQuery.trim()) params.set('q', clientQuery.trim());

    try {
      const res = await apiFetch(
        `/api/call-tasks/${selectedTask.id}/clients?${params.toString()}`,
      );
      if (!res.ok) {
        alert(await readError(res, 'Не удалось загрузить клиентов задачи'));
        return;
      }
      const data = (await res.json()) as TaskClientsResponse;
      if (requestId !== clientsRequestIdRef.current) return;
      setClients(data.items);
      setTotalPages(data.totalPages);
      setTotalClients(data.total);
    } finally {
      if (requestId === clientsRequestIdRef.current) {
        setClientsLoading(false);
      }
    }
  }, [clientQuery, clientStatus, page, selectedTask]);

  useEffect(() => {
    void fetchTasks();
  }, [fetchTasks]);

  useEffect(() => {
    void fetchReport();
  }, [fetchReport]);

  useEffect(() => {
    void fetchAccounts();
  }, [fetchAccounts]);

  useEffect(() => {
    setPage(1);
    setSelectedClientIds([]);
  }, [clientQuery, clientStatus, selectedTask?.id]);

  useEffect(() => {
    void fetchClients();
  }, [fetchClients]);

  const openClientResult = (client: CallTaskClient) => {
    setEditingClient(client);
    setAttemptForm({
      deadlineAt: formatForDateTimeInput(client.deadlineAt),
      status: client.status,
      summary: client.summary || '',
    });
  };

  const saveAttempt = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!editingClient) return;

    setSavingAttempt(true);
    const res = await apiFetch(
      `/api/call-task-clients/${editingClient.id}/attempts`,
      {
        method: 'POST',
        body: JSON.stringify({
          deadlineAt: attemptForm.deadlineAt || null,
          status: attemptForm.status,
          summary: attemptForm.summary.trim(),
        }),
      },
    );
    setSavingAttempt(false);

    if (!res.ok) {
      alert(await readError(res, 'Не удалось сохранить результат звонка'));
      return;
    }

    const saved = (await res.json()) as CallTaskClient;
    setClients((prev) =>
      prev.map((client) => (client.id === saved.id ? saved : client)),
    );
    setEditingClient(null);
    await fetchTasks();
    if (selectedTask) await refreshTaskDetails(selectedTask.id);
    await fetchReport();
  };

  const selectedClientsOnPage = useMemo(
    () => clients.filter((client) => selectedClientIds.includes(client.id)),
    [clients, selectedClientIds],
  );
  const allClientsOnPageSelected =
    clients.length > 0 && selectedClientsOnPage.length === clients.length;

  const toggleClientSelection = (clientId: number) => {
    setSelectedClientIds((prev) =>
      prev.includes(clientId)
        ? prev.filter((id) => id !== clientId)
        : [...prev, clientId],
    );
  };

  const toggleAllClientsOnPage = () => {
    if (allClientsOnPageSelected) {
      setSelectedClientIds((prev) =>
        prev.filter((id) => !clients.some((client) => client.id === id)),
      );
      return;
    }

    setSelectedClientIds((prev) =>
      Array.from(new Set([...prev, ...clients.map((client) => client.id)])),
    );
  };

  const openBulkDialog = () => {
    setBulkForm({ ...EMPTY_BULK_FORM });
    setBulkDialogOpen(true);
  };

  const saveBulkAction = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedTask || selectedClientIds.length === 0) return;

    const payload: {
      deadlineAt?: string | null;
      status?: CallTaskClientStatus;
      summary?: string;
      taskClientIds: number[];
    } = {
      taskClientIds: selectedClientIds,
    };
    if (bulkForm.status !== 'keep') payload.status = bulkForm.status;
    if (bulkForm.deadlineAt) payload.deadlineAt = bulkForm.deadlineAt;
    if (bulkForm.summary.trim()) payload.summary = bulkForm.summary.trim();

    setSavingBulk(true);
    try {
      const res = await apiFetch(
        `/api/call-tasks/${selectedTask.id}/clients/bulk`,
        {
          method: 'PATCH',
          body: JSON.stringify(payload),
        },
      );

      if (!res.ok) {
        alert(await readError(res, 'Не удалось массово обновить клиентов'));
        return;
      }

      setBulkDialogOpen(false);
      setSelectedClientIds([]);
      await fetchClients();
      await fetchTasks();
      await refreshTaskDetails(selectedTask.id);
      await fetchReport();
    } finally {
      setSavingBulk(false);
    }
  };

  const openEditTask = (task: CallTask) => {
    setEditingTask(task);
    setTaskForm({
      assignedToAccountId: task.assignedTo?.id
        ? String(task.assignedTo.id)
        : 'none',
      description: task.description || '',
      dueAt: formatForDateTimeInput(task.dueAt),
      scopeType: task.scopeType,
      title: task.title,
    });
  };

  const saveTask = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!editingTask) return;

    setSavingTask(true);
    const res = await apiFetch(`/api/call-tasks/${editingTask.id}`, {
      method: 'PUT',
      body: JSON.stringify({
        assignedToAccountId:
          taskForm.assignedToAccountId === 'none'
            ? null
            : Number(taskForm.assignedToAccountId),
        description: taskForm.description.trim(),
        dueAt: taskForm.dueAt || null,
        scopeType: taskForm.scopeType,
        title: taskForm.title.trim(),
      }),
    });
    setSavingTask(false);

    if (!res.ok) {
      alert(await readError(res, 'Не удалось сохранить задачу'));
      return;
    }

    const saved = (await res.json()) as CallTask;
    setEditingTask(null);
    setSelectedTask(saved);
    setSelectedTaskId(saved.id);
    await fetchTasks();
    await refreshTaskDetails(saved.id);
    await fetchReport();
  };

  const syncSelectedTask = async () => {
    if (!selectedTask) return;

    setSyncingTask(true);
    try {
      const res = await apiFetch(`/api/call-tasks/${selectedTask.id}/sync`, {
        method: 'POST',
      });
      if (!res.ok) {
        alert(await readError(res, 'Не удалось синхронизировать задачу'));
        return;
      }
      const result = (await res.json()) as {
        addedCount: number;
        keptRemovedCount: number;
        removedCount: number;
        task: CallTask;
        updatedCount: number;
      };
      setSelectedTask(result.task);
      alert(
        `Добавлено: ${result.addedCount}. Убрано без истории: ${result.removedCount}. Обновлено: ${result.updatedCount}. Осталось вне базы с историей: ${result.keptRemovedCount}.`,
      );
      await fetchTasks();
      await fetchClients();
      await fetchReport();
    } finally {
      setSyncingTask(false);
    }
  };

  const executeTaskStatusUpdate = async (
    task: CallTask,
    nextStatus: CallTaskStatus,
  ) => {
    const res = await apiFetch(`/api/call-tasks/${task.id}`, {
      method: 'PUT',
      body: JSON.stringify({ status: nextStatus }),
    });
    if (!res.ok) {
      alert(await readError(res, 'Не удалось обновить статус задачи'));
      return;
    }
    await fetchTasks();
    await refreshTaskDetails(task.id);
    await fetchReport();
  };

  const requestTaskStatusUpdate = (
    task: CallTask,
    nextStatus: CallTaskStatus,
  ) => {
    const copy = getTaskStatusActionCopy(task, nextStatus);
    setConfirmAction({
      ...copy,
      onConfirm: () => executeTaskStatusUpdate(task, nextStatus),
    });
  };

  const executePermanentDelete = async (task: CallTask) => {
    const res = await apiFetch(`/api/call-tasks/${task.id}/permanent`, {
      method: 'DELETE',
    });
    if (!res.ok) {
      alert(await readError(res, 'Не удалось удалить задачу из архива'));
      return;
    }

    setSelectedTask(null);
    setSelectedTaskId(null);
    setClients([]);
    await fetchTasks();
    await fetchReport();
  };

  const requestPermanentDelete = (task: CallTask) => {
    setConfirmAction({
      confirmLabel: 'Удалить навсегда',
      description: `Задача «${task.title}» будет удалена без возможности восстановления. Сервер не даст удалить ее, если по ней уже были звонки, статусы или комментарии.`,
      isDestructive: true,
      onConfirm: () => executePermanentDelete(task),
      title: 'Удалить задачу из архива?',
    });
  };

  const renderTaskActionItems = (task: CallTask) => {
    if (!canManage) {
      return (
        <ContextMenuItem disabled>
          Только руководитель может менять задачу
        </ContextMenuItem>
      );
    }

    if (task.status === 'archived') {
      return (
        <>
          <ContextMenuItem
            onSelect={() => requestTaskStatusUpdate(task, 'backlog')}
          >
            <ArchiveRestore className="h-4 w-4" />
            Вернуть из архива
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem
            variant="destructive"
            onSelect={() => requestPermanentDelete(task)}
          >
            <Trash2 className="h-4 w-4" />
            Удалить навсегда
          </ContextMenuItem>
        </>
      );
    }

    return (
      <>
        {task.status === 'backlog' && (
          <ContextMenuItem
            onSelect={() => requestTaskStatusUpdate(task, 'in_progress')}
          >
            <Clock className="h-4 w-4" />
            В работу
          </ContextMenuItem>
        )}
        {task.status === 'done' && (
          <ContextMenuItem
            onSelect={() => requestTaskStatusUpdate(task, 'in_progress')}
          >
            <Clock className="h-4 w-4" />
            Вернуть в работу
          </ContextMenuItem>
        )}
        {task.status !== 'done' && (
          <ContextMenuItem onSelect={() => requestTaskStatusUpdate(task, 'done')}>
            <CheckCircle2 className="h-4 w-4" />
            Завершить
          </ContextMenuItem>
        )}
        <ContextMenuSeparator />
        <ContextMenuItem
          variant="destructive"
          onSelect={() => requestTaskStatusUpdate(task, 'archived')}
        >
          <Archive className="h-4 w-4" />
          В архив
        </ContextMenuItem>
      </>
    );
  };

  const confirmPendingAction = async () => {
    if (!confirmAction) return;

    setConfirmingAction(true);
    try {
      await confirmAction.onConfirm();
      setConfirmAction(null);
    } finally {
      setConfirmingAction(false);
    }
  };

  const selectedProgress = useMemo(
    () => (selectedTask ? getTaskProgress(selectedTask) : { done: 0, total: 0 }),
    [selectedTask],
  );
  const selectedTaskIsReadOnly =
    selectedTask?.status === 'archived' || selectedTask?.status === 'done';

  const renderTaskCard = (task: CallTask) => {
    const progress = getTaskProgress(task);
    const isSelected = selectedTask?.id === task.id;

    return (
      <ContextMenu key={task.id}>
        <ContextMenuTrigger asChild>
          <button
            type="button"
            onClick={() => void openTask(task)}
            className={`block w-full rounded-md px-3 py-3 text-left transition-colors hover:bg-muted/60 ${
              isSelected ? 'bg-muted' : ''
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate font-medium">{task.title}</div>
                <div className="mt-1 truncate text-xs text-muted-foreground">
                  {task.clientBase?.name || 'Без базы'} ·{' '}
                  {task.assignedTo?.name || 'без исполнителя'}
                </div>
              </div>
              <Badge variant="outline">
                {TASK_STATUS_LABELS[task.status]}
              </Badge>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
              <div>
                <MetricLabel tooltip="Клиенты с финальным результатом: «Записался» или «Отказ».">
                  Готово
                </MetricLabel>
                <div className="font-medium">
                  {progress.done}/{progress.total}
                </div>
              </div>
              <div>
                <MetricLabel tooltip="Клиенты в этой задаче, у которых уже прошел дедлайн и статус еще не финальный.">
                  Просрочено
                </MetricLabel>
                <div
                  className={
                    task.overdueCount > 0
                      ? 'font-medium text-destructive'
                      : 'font-medium'
                  }
                >
                  {task.overdueCount}
                </div>
              </div>
              <div>
                <MetricLabel tooltip="Доля записавшихся среди клиентов, по которым уже был контакт.">
                  Запись
                </MetricLabel>
                <div className="font-medium">
                  {formatPercent(task.metrics?.conversionRate)}
                </div>
              </div>
            </div>
            {task.newInBaseCount ? (
              <div className="mt-2 text-xs text-primary">
                +{task.newInBaseCount} новых клиентов в базе
              </div>
            ) : null}
          </button>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuLabel>Действия с задачей</ContextMenuLabel>
          <ContextMenuItem onSelect={() => void openTask(task)}>
            <PhoneCall className="h-4 w-4" />
            Открыть
          </ContextMenuItem>
          <ContextMenuSeparator />
          {renderTaskActionItems(task)}
        </ContextMenuContent>
      </ContextMenu>
    );
  };

  return (
    <div className="min-w-0 space-y-4 p-4 md:p-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Задачи обзвона</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Рабочие списки клиентов из баз: статус разговора, саммари, дедлайн
            по клиенту и контроль просрочек.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground">Показать</span>
            <HelpTooltip>
              Фильтр меняет набор задач на экране и в верхней сводке. Клиенты
              внутри выбранной задачи фильтруются отдельно ниже.
            </HelpTooltip>
          </div>
          <Select
            value={status}
            onValueChange={(value) => setStatus(value as TaskFilterStatus)}
          >
            <SelectTrigger className="w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="active">Активные</SelectItem>
              <SelectItem value="backlog">Бэклог</SelectItem>
              <SelectItem value="in_progress">В работе</SelectItem>
              <SelectItem value="done">Готово</SelectItem>
              <SelectItem value="archived">Архив</SelectItem>
              <SelectItem value="all">Все</SelectItem>
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="icon"
            onClick={fetchTasks}
            disabled={loading}
            title="Обновить"
            aria-label="Обновить задачи обзвона"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <MetricCard
          icon={<ListChecks className="h-4 w-4" />}
          label="Задач"
          tooltip="Количество задач в выбранном фильтре: активные, архив, готовые или все."
          value={report?.tasksCount ?? 0}
        />
        <MetricCard
          label="Клиентов"
          tooltip="Суммарное количество клиентов внутри задач, которые сейчас попали в фильтр."
          value={(report?.totalClientCount ?? 0).toLocaleString('ru-RU')}
        />
        <MetricCard
          label="Контакт"
          tooltip="Доля клиентов, по которым уже есть результат звонка. Формула: все статусы кроме «Не звонили» / все клиенты."
          value={formatPercent(report?.metrics.contactRate)}
        />
        <MetricCard
          label="Запись"
          tooltip="Конверсия в запись среди тех, с кем уже был контакт. Формула: «Записался» / все клиенты не в статусе «Не звонили»."
          value={formatPercent(report?.metrics.conversionRate)}
        />
        <MetricCard
          label="Просрочено"
          tooltip="Клиенты, у которых прошел дедлайн обзвона и статус еще не финальный. Финальные статусы: «Записался» и «Отказ»."
          value={report?.overdueCount ?? 0}
          valueClassName={report?.overdueCount ? 'text-destructive' : ''}
        />
        <MetricCard
          icon={<BarChart3 className="h-4 w-4" />}
          label="Попыток"
          tooltip="Количество сохраненных записей в истории попыток звонка по клиентам из выбранных задач."
          value={report?.attemptsCount ?? 0}
        />
      </div>

      <div className="grid min-h-[520px] grid-cols-1 gap-4 xl:grid-cols-[420px_minmax(0,1fr)]">
        <div className="rounded-md border bg-card">
          <div className="flex items-center justify-between border-b px-4 py-3">
            <div className="font-medium">Список задач</div>
            <Badge variant="outline">{tasks.length}</Badge>
          </div>
          <div className="divide-y">
            {tasks.length === 0 && (
              <div className="px-4 py-10 text-center text-sm text-muted-foreground">
                Активных задач обзвона пока нет.
              </div>
            )}
            {tasks.map((task) => renderTaskCard(task))}
          </div>
        </div>

        <div className="min-w-0 rounded-md border bg-card">
          {!selectedTask ? (
            <div className="flex h-full min-h-[420px] flex-col items-center justify-center gap-3 p-8 text-center text-muted-foreground">
              <PhoneCall className="h-8 w-8" />
              <div className="text-sm">Выберите задачу, чтобы начать обзвон.</div>
            </div>
          ) : (
            <>
              <div className="space-y-3 border-b px-4 py-3">
                <div className="flex flex-col gap-3 2xl:flex-row 2xl:items-start 2xl:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="truncate text-xl font-semibold">
                        {selectedTask.title}
                      </h2>
                      <Badge variant="outline">
                        {selectedTask.scopeType === 'dynamic'
                          ? 'Автообновляемая'
                          : 'Фиксированная'}
                      </Badge>
                      <HelpTooltip>
                        {selectedTask.scopeType === 'dynamic'
                          ? 'CRM сверяет задачу с фильтром базы и добавляет новых подходящих клиентов. Клиенты с историей звонков не удаляются молча.'
                          : 'Список клиентов был зафиксирован в момент создания задачи и не меняется автоматически.'}
                      </HelpTooltip>
                    </div>
                    <div className="mt-1 text-sm text-muted-foreground">
                      {selectedTask.clientBase?.name || 'Без базы'} · дедлайн:{' '}
                      {formatDateTime(selectedTask.dueAt)}
                    </div>
                  </div>
                  {canManage && (
                    <div className="flex flex-wrap gap-2">
                      {!selectedTaskIsReadOnly && (
                        <Button
                          variant="outline"
                          onClick={() => openEditTask(selectedTask)}
                        >
                          <Pencil className="mr-2 h-4 w-4" />
                          Изменить
                        </Button>
                      )}
                      {!selectedTaskIsReadOnly &&
                        selectedTask.scopeType === 'dynamic' && (
                          <Button
                            variant="outline"
                            onClick={() => void syncSelectedTask()}
                            disabled={syncingTask}
                          >
                            <Repeat2
                              className={`mr-2 h-4 w-4 ${syncingTask ? 'animate-spin' : ''}`}
                            />
                            Синхронизировать
                          </Button>
                        )}
                      {selectedTask.status === 'archived' && (
                        <>
                          <Button
                            variant="outline"
                            onClick={() =>
                              requestTaskStatusUpdate(selectedTask, 'backlog')
                            }
                          >
                            <ArchiveRestore className="mr-2 h-4 w-4" />
                            Вернуть
                          </Button>
                          <Button
                            variant="outline"
                            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                            onClick={() => requestPermanentDelete(selectedTask)}
                          >
                            <Trash2 className="mr-2 h-4 w-4" />
                            Удалить
                          </Button>
                        </>
                      )}
                      {selectedTask.status === 'backlog' && (
                        <Button
                          variant="outline"
                          onClick={() =>
                            requestTaskStatusUpdate(selectedTask, 'in_progress')
                          }
                        >
                          <Clock className="mr-2 h-4 w-4" />
                          В работу
                        </Button>
                      )}
                      {selectedTask.status === 'done' && (
                        <Button
                          variant="outline"
                          onClick={() =>
                            requestTaskStatusUpdate(selectedTask, 'in_progress')
                          }
                        >
                          <Clock className="mr-2 h-4 w-4" />
                          В работу
                        </Button>
                      )}
                      {!['done', 'archived'].includes(selectedTask.status) && (
                        <Button
                          variant="outline"
                          onClick={() =>
                            requestTaskStatusUpdate(selectedTask, 'done')
                          }
                        >
                          <CheckCircle2 className="mr-2 h-4 w-4" />
                          Завершить
                        </Button>
                      )}
                      {selectedTask.status !== 'archived' && (
                        <Button
                          variant="outline"
                          onClick={() =>
                            requestTaskStatusUpdate(selectedTask, 'archived')
                          }
                        >
                          <Archive className="mr-2 h-4 w-4" />
                          В архив
                        </Button>
                      )}
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-5">
                  <div>
                    <MetricLabel tooltip="Сколько клиентов находится в выбранной задаче сейчас.">
                      Всего
                    </MetricLabel>
                    <div className="font-semibold">{selectedProgress.total}</div>
                  </div>
                  <div>
                    <MetricLabel tooltip="Клиенты со статусом «Записался». Это основной успешный результат обзвона.">
                      Записались
                    </MetricLabel>
                    <div className="font-semibold">{selectedTask.counts.booked}</div>
                  </div>
                  <div>
                    <MetricLabel tooltip="Клиенты, по которым нужен следующий контакт. Дедлайн по клиенту помогает не пропустить срок.">
                      Перезвонить
                    </MetricLabel>
                    <div className="font-semibold">
                      {selectedTask.counts.callback}
                    </div>
                  </div>
                  <div>
                    <MetricLabel tooltip="Клиенты, которые не отказались, но пока не готовы записаться. Обычно требуют повторного касания.">
                      Сомневаются
                    </MetricLabel>
                    <div className="font-semibold">
                      {selectedTask.counts.doubting}
                    </div>
                  </div>
                  <div>
                    <MetricLabel tooltip="Клиенты с финальным отрицательным результатом. Они считаются закрытыми в этой задаче.">
                      Отказы
                    </MetricLabel>
                    <div className="font-semibold">{selectedTask.counts.refused}</div>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
                  <div className="rounded-md border px-3 py-2">
                    <MetricLabel tooltip="Доля клиентов, у которых статус уже изменился с «Не звонили» на любой результат.">
                      Контакт
                    </MetricLabel>
                    <div className="font-semibold">
                      {formatPercent(selectedTask.metrics?.contactRate)}
                    </div>
                  </div>
                  <div className="rounded-md border px-3 py-2">
                    <MetricLabel tooltip="Доля «Записался» среди клиентов, по которым уже был контакт.">
                      Конверсия в запись
                    </MetricLabel>
                    <div className="font-semibold">
                      {formatPercent(selectedTask.metrics?.conversionRate)}
                    </div>
                  </div>
                  <div className="rounded-md border px-3 py-2">
                    <MetricLabel tooltip="Доля клиентов с финальным статусом: «Записался» или «Отказ».">
                      Закрыто
                    </MetricLabel>
                    <div className="font-semibold">
                      {formatPercent(selectedTask.metrics?.completionRate)}
                    </div>
                  </div>
                  <div className="rounded-md border px-3 py-2">
                    <MetricLabel tooltip="Доля клиентов в задаче, у которых прошел дедлайн и статус еще не финальный.">
                      Просрочка
                    </MetricLabel>
                    <div
                      className={`font-semibold ${
                        selectedTask.overdueCount > 0 ? 'text-destructive' : ''
                      }`}
                    >
                      {formatPercent(selectedTask.metrics?.overdueRate)}
                    </div>
                  </div>
                </div>
                {selectedTask.membershipDiff &&
                  (selectedTask.membershipDiff.addedCount > 0 ||
                    selectedTask.membershipDiff.removedCount > 0 ||
                    selectedTask.membershipDiff.updatedCount > 0) && (
                    <div className="rounded-md border border-primary/20 bg-primary/5 px-3 py-2 text-sm">
                      <span className="inline-flex items-center gap-1.5 font-medium">
                        Расхождение с базой
                        <HelpTooltip>
                          Показывает, как текущий фильтр базы отличается от
                          состава задачи: кто добавился, кто выпал из фильтра и
                          у кого изменились данные снапшота.
                        </HelpTooltip>
                        :
                      </span>{' '}
                      новых {selectedTask.membershipDiff.addedCount}, выпали{' '}
                      {selectedTask.membershipDiff.removedCount}, изменились{' '}
                      {selectedTask.membershipDiff.updatedCount}.
                    </div>
                  )}
              </div>

              <div className="flex flex-col gap-3 border-b px-4 py-3 md:flex-row md:items-center md:justify-between">
                <div className="flex flex-1 flex-col gap-2 sm:flex-row">
                  <Input
                    value={clientQuery}
                    onChange={(event) => setClientQuery(event.target.value)}
                    placeholder="Поиск по имени или телефону"
                    className="sm:max-w-[320px]"
                  />
                  <Select
                    value={clientStatus}
                    onValueChange={(value) =>
                      setClientStatus(value as ClientFilterStatus)
                    }
                  >
                    <SelectTrigger className="sm:w-[190px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Все статусы</SelectItem>
                      <SelectItem value="overdue">Просроченные</SelectItem>
                      {CLIENT_STATUSES.map((item) => (
                        <SelectItem key={item} value={item}>
                          {CLIENT_STATUS_LABELS[item]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="text-sm text-muted-foreground">
                  Найдено: {totalClients}
                </div>
              </div>

              {selectedClientIds.length > 0 && (
                <div className="flex flex-col gap-2 border-b bg-muted/35 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="text-sm">
                    Выбрано клиентов: <span className="font-medium">{selectedClientIds.length}</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      onClick={() => setSelectedClientIds([])}
                    >
                      Снять выбор
                    </Button>
                    {!selectedTaskIsReadOnly && (
                      <Button onClick={openBulkDialog}>
                        <ListChecks className="mr-2 h-4 w-4" />
                        Массовое действие
                      </Button>
                    )}
                  </div>
                </div>
              )}

              <div className="overflow-x-auto">
                <Table className="min-w-[980px] table-fixed">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[44px]">
                        <input
                          type="checkbox"
                          checked={allClientsOnPageSelected}
                          disabled={clients.length === 0 || selectedTaskIsReadOnly}
                          onChange={toggleAllClientsOnPage}
                          className="h-4 w-4"
                          aria-label="Выбрать всех клиентов на странице"
                        />
                      </TableHead>
                      <TableHead className="w-[24%]">Клиент</TableHead>
                      <TableHead className="w-[16%]">Телефон</TableHead>
                      <TableHead className="w-[13%]">
                        <MetricLabel tooltip="Сверху количество визитов клиента, ниже дата последнего визита.">
                          Визиты
                        </MetricLabel>
                      </TableHead>
                      <TableHead className="w-[16%]">
                        <MetricLabel tooltip="Текущий результат работы по клиенту в этой задаче обзвона.">
                          Статус
                        </MetricLabel>
                      </TableHead>
                      <TableHead className="w-[15%]">
                        <MetricLabel tooltip="Срок, до которого нужно обработать конкретного клиента. Может быть задан сроком прозвона базы, дедлайном задачи или вручную.">
                          Дедлайн
                        </MetricLabel>
                      </TableHead>
                      <TableHead className="w-[16%]">
                        <MetricLabel tooltip="Последнее саммари по клиенту в этой задаче. Полная история открывается через кнопку результата звонка.">
                          Комментарий
                        </MetricLabel>
                      </TableHead>
                      <TableHead className="w-[92px] text-right"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {clientsLoading && (
                      <TableRow>
                        <TableCell
                          colSpan={8}
                          className="py-10 text-center text-muted-foreground"
                        >
                          Загрузка клиентов...
                        </TableCell>
                      </TableRow>
                    )}
                    {!clientsLoading && clients.length === 0 && (
                      <TableRow>
                        <TableCell
                          colSpan={8}
                          className="py-10 text-center text-muted-foreground"
                        >
                          Клиенты не найдены.
                        </TableCell>
                      </TableRow>
                    )}
                    {!clientsLoading &&
                      clients.map((client) => (
                        <TableRow key={client.id}>
                          <TableCell>
                            <input
                              type="checkbox"
                              checked={selectedClientIds.includes(client.id)}
                              disabled={selectedTaskIsReadOnly}
                              onChange={() => toggleClientSelection(client.id)}
                              className="h-4 w-4"
                              aria-label={`Выбрать ${client.clientName}`}
                            />
                          </TableCell>
                          <TableCell>
                            <div className="min-w-0">
                              <div className="truncate font-medium">
                                {client.clientName}
                              </div>
                              <div className="truncate text-xs text-muted-foreground">
                                {client.source || 'Источник не указан'}
                              </div>
                            </div>
                          </TableCell>
                          <TableCell className="truncate text-muted-foreground">
                            {client.clientPhone || '-'}
                          </TableCell>
                          <TableCell>
                            <div className="text-sm">{client.visitCount}</div>
                            <div className="text-xs text-muted-foreground">
                              {formatDate(client.lastVisitAt)}
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline">
                              {CLIENT_STATUS_LABELS[client.status]}
                            </Badge>
                          </TableCell>
                          <TableCell
                            className={
                              isClientOverdue(client)
                                ? 'font-medium text-destructive'
                                : 'text-muted-foreground'
                            }
                          >
                            {formatDateTime(client.deadlineAt)}
                          </TableCell>
                          <TableCell className="truncate text-muted-foreground">
                            {client.summary || client.lastAttempt?.summary || '-'}
                          </TableCell>
                          <TableCell className="text-right">
                            {selectedTaskIsReadOnly ? (
                              <span className="text-xs text-muted-foreground">
                                Только просмотр
                              </span>
                            ) : (
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                onClick={() => openClientResult(client)}
                                title="Результат звонка"
                                aria-label={`Результат звонка ${client.clientName}`}
                              >
                                <MessageSquareText className="h-4 w-4" />
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                  </TableBody>
                </Table>
              </div>

              <div className="border-t px-4 py-3">
                <Pagination>
                  <PaginationContent>
                    <PaginationItem>
                      <PaginationPrevious
                        disabled={page <= 1}
                        onClick={() => setPage((current) => Math.max(1, current - 1))}
                      />
                    </PaginationItem>
                    <PaginationItem>
                      <span className="px-3 text-sm text-muted-foreground">
                        {page} / {totalPages}
                      </span>
                    </PaginationItem>
                    <PaginationItem>
                      <PaginationNext
                        disabled={page >= totalPages}
                        onClick={() =>
                          setPage((current) => Math.min(totalPages, current + 1))
                        }
                      />
                    </PaginationItem>
                  </PaginationContent>
                </Pagination>
              </div>
            </>
          )}
        </div>
      </div>

      <Dialog
        open={Boolean(editingClient)}
        onOpenChange={(open) => !open && setEditingClient(null)}
      >
        <DialogContent className="sm:max-w-[640px]">
          <DialogHeader>
            <DialogTitle>Результат звонка</DialogTitle>
            <DialogDescription>
              {editingClient?.clientName} · {editingClient?.clientPhone || '-'}
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={saveAttempt} className="space-y-4 pt-2">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 flex items-center gap-1.5 text-xs font-medium">
                  Статус
                  <HelpTooltip>
                    Результат последнего контакта с клиентом. По нему строится
                    прогресс задачи и отчет по обзвону.
                  </HelpTooltip>
                </label>
                <Select
                  value={attemptForm.status}
                  onValueChange={(statusValue) =>
                    setAttemptForm({
                      ...attemptForm,
                      status: statusValue as CallTaskClientStatus,
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CLIENT_STATUSES.map((item) => (
                      <SelectItem key={item} value={item}>
                        {CLIENT_STATUS_LABELS[item]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="mb-1 flex items-center gap-1.5 text-xs font-medium">
                  Дедлайн по клиенту
                  <HelpTooltip>
                    Индивидуальный срок следующего действия по этому клиенту.
                    Если срок прошел и статус не финальный, клиент попадет в
                    просрочку.
                  </HelpTooltip>
                </label>
                <Input
                  type="datetime-local"
                  value={attemptForm.deadlineAt}
                  onChange={(event) =>
                    setAttemptForm({
                      ...attemptForm,
                      deadlineAt: event.target.value,
                    })
                  }
                />
              </div>
            </div>

            <div>
              <label className="mb-1 flex items-center gap-1.5 text-xs font-medium">
                Саммари
                <HelpTooltip>
                  Коротко запишите итог разговора: что сказал клиент, когда
                  перезвонить и о чем договорились. Это сохранится в истории
                  попыток.
                </HelpTooltip>
              </label>
              <textarea
                required
                value={attemptForm.summary}
                onChange={(event) =>
                  setAttemptForm({ ...attemptForm, summary: event.target.value })
                }
                className="min-h-[140px] w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                placeholder="Что сказал клиент, когда перезвонить, на что договорились"
              />
            </div>

            {editingClient?.attempts && editingClient.attempts.length > 0 && (
              <div className="rounded-md border">
                <div className="border-b px-3 py-2 text-sm font-medium">
                  История попыток
                </div>
                <div className="max-h-[220px] divide-y overflow-y-auto">
                  {editingClient.attempts.map((attempt) => (
                    <div key={attempt.id} className="px-3 py-2 text-sm">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-medium">
                          {CLIENT_STATUS_LABELS[attempt.status]}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {formatDateTime(attempt.createdAt)}
                        </span>
                      </div>
                      {attempt.summary && (
                        <div className="mt-1 text-muted-foreground">
                          {attempt.summary}
                        </div>
                      )}
                      <div className="mt-1 text-xs text-muted-foreground">
                        {attempt.actor?.name || 'Система'} · дедлайн:{' '}
                        {formatDateTime(attempt.deadlineAt)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <Button type="submit" disabled={savingAttempt} className="w-full">
              <Save className="mr-2 h-4 w-4" />
              {savingAttempt ? 'Сохраняем...' : 'Сохранить результат'}
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(editingTask)}
        onOpenChange={(open) => !open && setEditingTask(null)}
      >
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-[720px]">
          <DialogHeader>
            <DialogTitle>Настройки задачи</DialogTitle>
            <DialogDescription>
              Меняются параметры самой задачи. История звонков клиентов
              сохраняется.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={saveTask} className="space-y-4 pt-2">
            <div>
              <label className="mb-1 block text-xs font-medium">Название</label>
              <Input
                required
                value={taskForm.title}
                onChange={(event) =>
                  setTaskForm({ ...taskForm, title: event.target.value })
                }
              />
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div>
                <label className="mb-1 flex items-center gap-1.5 text-xs font-medium">
                  Режим
                  <HelpTooltip>
                    Фиксированный список не меняется после создания. Автообновляемая
                    задача подтягивает новых клиентов из фильтра базы.
                  </HelpTooltip>
                </label>
                <Select
                  value={taskForm.scopeType}
                  onValueChange={(value) =>
                    setTaskForm({
                      ...taskForm,
                      scopeType: value as 'snapshot' | 'dynamic',
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
                <label className="mb-1 flex items-center gap-1.5 text-xs font-medium">
                  Исполнитель
                  <HelpTooltip>
                    Аккаунт, который будет работать с задачей. Руководители
                    видят все задачи, администратор видит назначенные ему и
                    неназначенные.
                  </HelpTooltip>
                </label>
                <Select
                  value={taskForm.assignedToAccountId}
                  onValueChange={(value) =>
                    setTaskForm({ ...taskForm, assignedToAccountId: value })
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
                <label className="mb-1 flex items-center gap-1.5 text-xs font-medium">
                  Дедлайн
                  <HelpTooltip>
                    Общий срок задачи. Если у базы задан срок прозвона, у
                    клиентов будет свой дедлайн от даты создания задачи.
                  </HelpTooltip>
                </label>
                <Input
                  type="datetime-local"
                  value={taskForm.dueAt}
                  onChange={(event) =>
                    setTaskForm({ ...taskForm, dueAt: event.target.value })
                  }
                />
              </div>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium">Описание</label>
              <textarea
                value={taskForm.description}
                onChange={(event) =>
                  setTaskForm({ ...taskForm, description: event.target.value })
                }
                className="min-h-[100px] w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>

            <Button type="submit" disabled={savingTask} className="w-full">
              <Save className="mr-2 h-4 w-4" />
              {savingTask ? 'Сохраняем...' : 'Сохранить задачу'}
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={bulkDialogOpen} onOpenChange={setBulkDialogOpen}>
        <DialogContent className="sm:max-w-[620px]">
          <DialogHeader>
            <DialogTitle>Массовое действие</DialogTitle>
            <DialogDescription>
              Обновятся выбранные клиенты текущей задачи. Для каждого клиента
              сохранится запись в истории попыток.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={saveBulkAction} className="space-y-4 pt-2">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 flex items-center gap-1.5 text-xs font-medium">
                  Статус
                  <HelpTooltip>
                    Можно массово перевести выбранных клиентов в один результат
                    или оставить статус без изменений.
                  </HelpTooltip>
                </label>
                <Select
                  value={bulkForm.status}
                  onValueChange={(statusValue) =>
                    setBulkForm({
                      ...bulkForm,
                      status: statusValue as BulkFormState['status'],
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="keep">Не менять</SelectItem>
                    {CLIENT_STATUSES.map((item) => (
                      <SelectItem key={item} value={item}>
                        {CLIENT_STATUS_LABELS[item]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="mb-1 flex items-center gap-1.5 text-xs font-medium">
                  Новый дедлайн
                  <HelpTooltip>
                    Поставит выбранным клиентам общий индивидуальный дедлайн.
                    Если оставить пустым, текущие дедлайны не изменятся.
                  </HelpTooltip>
                </label>
                <Input
                  type="datetime-local"
                  value={bulkForm.deadlineAt}
                  onChange={(event) =>
                    setBulkForm({ ...bulkForm, deadlineAt: event.target.value })
                  }
                />
              </div>
            </div>

            <div>
              <label className="mb-1 flex items-center gap-1.5 text-xs font-medium">
                Комментарий
                <HelpTooltip>
                  Комментарий добавится в историю попыток каждого выбранного
                  клиента. При изменении только комментария время контакта не
                  перезаписывается.
                </HelpTooltip>
              </label>
              <textarea
                value={bulkForm.summary}
                onChange={(event) =>
                  setBulkForm({ ...bulkForm, summary: event.target.value })
                }
                className="min-h-[110px] w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                placeholder="Например: массовая отметка после обзвона"
              />
            </div>

            <Button type="submit" disabled={savingBulk} className="w-full">
              <Save className="mr-2 h-4 w-4" />
              {savingBulk
                ? 'Сохраняем...'
                : `Применить к ${selectedClientIds.length} клиентам`}
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmActionDialog
        action={confirmAction}
        loading={confirmingAction}
        onCancel={() => setConfirmAction(null)}
        onConfirm={confirmPendingAction}
      />
    </div>
  );
}
