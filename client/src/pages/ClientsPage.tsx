import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Archive,
  ArchiveRestore,
  CalendarDays,
  Dumbbell,
  Eye,
  GitMerge,
  Pencil,
  Phone,
  Plus,
  RefreshCw,
  Save,
  Search,
  Trash2,
  UserRoundCheck,
  Users,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  ConfirmActionDialog,
  type ConfirmAction,
} from '@/components/confirm-action-dialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  Pagination,
  PaginationButton,
  PaginationContent,
  PaginationEllipsis,
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
import {
  canManageClients,
  canManageTrainingNotes,
  canMergeClients,
  canViewTrainingNotes,
} from '@/lib/permissions';
import type { ReferenceItem } from '@/lib/references';
import { fetchReferences } from '@/lib/references';
import { useAuth } from '@/lib/useAuth';

type ClientStatus = 'active' | 'archived';
type ClientSegment = 'all' | 'new' | 'regular' | 'inactive' | 'no_visits';

interface ClientStats {
  firstVisitAt?: string | null;
  lastVisitAt?: string | null;
  visitCount: number;
}

interface Client {
  id: number;
  telegramId?: string | null;
  vkId?: string | null;
  webId?: string | null;
  name: string;
  phone: string;
  phoneNormalized?: string | null;
  source: string;
  sourceId?: number | null;
  note?: string | null;
  status: ClientStatus;
  statusLabel: string;
  segment: string;
  mergedIntoUserId?: number | null;
  createdAt: string;
  updatedAt: string;
  stats: ClientStats;
}

interface ClientVisit {
  id: number;
  scannedAt: string;
  keyNumber?: string | null;
  category?: string | null;
  categoryIds?: number[];
  categories?: Array<{
    id: number;
    name: string;
  }>;
  createdAt: string;
}

interface ClientsResponse {
  items: Client[];
  page: number;
  pageSize: number;
  sources: string[];
  total: number;
  totalPages: number;
}

interface ClientDetails {
  client: Client;
  duplicateCandidates: Client[];
  mergedInto?: Client | null;
  trainingNotes: TrainingNote[];
  visits: ClientVisit[];
}

interface TrainingNote {
  id: number;
  trainedAt: string;
  level: TrainingLevel;
  exercises: string;
  note: string;
  trainer?: {
    id: number;
    email: string;
    name: string;
  } | null;
  createdAt: string;
  updatedAt: string;
}

type TrainingLevel = 'D' | 'D+' | 'C' | 'C+' | 'B' | 'B+' | 'A';

interface TrainingFormState {
  exercises: string;
  level: TrainingLevel;
  note: string;
  trainedAt: string;
}

interface DuplicateGroup {
  phoneNormalized: string;
  count: number;
  clients: Client[];
}

interface DuplicateGroupSelection {
  primaryId: number | null;
  duplicateIds: number[];
}

interface ClientFormState {
  name: string;
  phone: string;
  sourceId: string;
  source: string;
  note: string;
  status: 'active' | 'archived';
}

interface ClientPayload {
  name: string;
  note: string;
  phone: string;
  source: string;
  sourceId?: number;
  status: 'active' | 'archived';
}

type PendingAction = ConfirmAction & {
  onConfirm: () => Promise<void>;
};

const EMPTY_FORM: ClientFormState = {
  name: '',
  phone: '',
  sourceId: '',
  source: 'Ресепшн (Админ)',
  note: '',
  status: 'active',
};

const TRAINING_LEVELS: TrainingLevel[] = ['D', 'D+', 'C', 'C+', 'B', 'B+', 'A'];

function getTodayDate() {
  return new Date().toISOString().slice(0, 10);
}

const EMPTY_TRAINING_FORM: TrainingFormState = {
  exercises: '',
  level: 'D',
  note: '',
  trainedAt: getTodayDate(),
};

const CLIENT_SEGMENT_OPTIONS: Array<{
  value: ClientSegment;
  label: string;
  condition: string;
}> = [
  {
    value: 'all',
    label: 'Все сегменты',
    condition: 'Показываются все клиенты без фильтра по активности.',
  },
  {
    value: 'new',
    label: 'Новые',
    condition: 'Клиенты, у которых ровно один визит.',
  },
  {
    value: 'regular',
    label: 'Постоянные',
    condition: 'Клиенты, у которых три или больше визитов.',
  },
  {
    value: 'inactive',
    label: 'Давно не были',
    condition: 'Клиенты с визитами, у которых последний визит был 60 или больше дней назад.',
  },
  {
    value: 'no_visits',
    label: 'Без визитов',
    condition: 'Клиенты, у которых еще нет ни одного визита.',
  },
];

function getPhoneDigits(value: string) {
  const digits = value.replace(/\D/g, '');
  return digits.length > 10 ? digits.slice(-10) : digits;
}

function formatClientPhone(value: string) {
  let digits = value.replace(/\D/g, '');
  if (!digits) return '';

  if (digits.startsWith('8')) digits = `7${digits.slice(1)}`;
  if (!digits.startsWith('7')) digits = `7${digits}`;

  const local = digits.slice(1, 11);
  let formatted = '+7';

  if (local.length > 0) formatted += ` (${local.slice(0, 3)}`;
  if (local.length >= 3) formatted += ')';
  if (local.length > 3) formatted += ` ${local.slice(3, 6)}`;
  if (local.length > 6) formatted += `-${local.slice(6, 8)}`;
  if (local.length > 8) formatted += `-${local.slice(8, 10)}`;

  return formatted;
}

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

async function readApiError(response: Response, fallback: string) {
  try {
    const data = (await response.json()) as {
      client?: Client;
      code?: string;
      error?: string;
    };
    return {
      client: data.client,
      code: data.code,
      error: data.error || fallback,
    };
  } catch {
    return { error: fallback };
  }
}

function getStatusBadgeClass(status: ClientStatus) {
  if (status === 'active') {
    return 'bg-green-100 text-green-800 border-transparent dark:bg-green-900/30 dark:text-green-300';
  }
  return 'bg-muted text-muted-foreground';
}

function getPaginationItems(currentPage: number, pageCount: number) {
  const pages: Array<number | 'ellipsis'> = [];
  const total = Math.max(1, pageCount);

  if (total <= 7) {
    return Array.from({ length: total }, (_, index) => index + 1);
  }

  pages.push(1);

  if (currentPage > 4) {
    pages.push('ellipsis');
  }

  const start = Math.max(2, currentPage - 1);
  const end = Math.min(total - 1, currentPage + 1);

  for (let pageNumber = start; pageNumber <= end; pageNumber += 1) {
    pages.push(pageNumber);
  }

  if (currentPage < total - 3) {
    pages.push('ellipsis');
  }

  pages.push(total);
  return pages;
}

function getDefaultPrimaryClientId(clients: Client[]) {
  const [primary] = [...clients].sort((a, b) => {
    const visitDiff = b.stats.visitCount - a.stats.visitCount;
    if (visitDiff !== 0) return visitDiff;

    const lastVisitDiff =
      new Date(b.stats.lastVisitAt || 0).getTime() -
      new Date(a.stats.lastVisitAt || 0).getTime();
    if (lastVisitDiff !== 0) return lastVisitDiff;

    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  });

  return primary?.id ?? null;
}

function buildDuplicateSelections(groups: DuplicateGroup[]) {
  return groups.reduce<Record<string, DuplicateGroupSelection>>((acc, group) => {
    const primaryId = getDefaultPrimaryClientId(group.clients);
    acc[group.phoneNormalized] = {
      primaryId,
      duplicateIds: [],
    };
    return acc;
  }, {});
}

function formatVisitCategories(visit: ClientVisit) {
  const names = visit.categories?.map((category) => category.name).filter(Boolean);
  return names && names.length > 0 ? names.join(', ') : visit.category || '-';
}

export default function ClientsPage() {
  const { account } = useAuth();
  const canEdit = canManageClients(account?.role);
  const canMerge = canMergeClients(account?.role);
  const canViewTraining = canViewTrainingNotes(account?.role);
  const canEditTraining = canManageTrainingNotes(account?.role);
  const isTrainerAccount = account?.role === 'trainer';
  const clientTableColSpan = isTrainerAccount ? 6 : 7;

  const [viewMode, setViewMode] = useState<'list' | 'duplicates'>('list');
  const [clients, setClients] = useState<Client[]>([]);
  const [sources, setSources] = useState<ReferenceItem[]>([]);
  const [referencesLoading, setReferencesLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [sourceId, setSourceId] = useState('all');
  const [segment, setSegment] = useState<ClientSegment>('all');
  const [status, setStatus] = useState<'active' | 'archived' | 'all'>('active');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  const [details, setDetails] = useState<ClientDetails | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editingClient, setEditingClient] = useState<Client | null>(null);
  const [form, setForm] = useState<ClientFormState>(EMPTY_FORM);
  const [duplicateWarning, setDuplicateWarning] = useState<Client | null>(null);
  const [trainingForm, setTrainingForm] = useState<TrainingFormState>({
    ...EMPTY_TRAINING_FORM,
    trainedAt: getTodayDate(),
  });
  const [trainingSaving, setTrainingSaving] = useState(false);
  const [selectedMergeIds, setSelectedMergeIds] = useState<number[]>([]);
  const [duplicateGroups, setDuplicateGroups] = useState<DuplicateGroup[]>([]);
  const [duplicatesLoading, setDuplicatesLoading] = useState(false);
  const [duplicatesError, setDuplicatesError] = useState<string | null>(null);
  const [groupSelections, setGroupSelections] = useState<
    Record<string, DuplicateGroupSelection>
  >({});
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [pendingActionLoading, setPendingActionLoading] = useState(false);

  const queryString = useMemo(() => {
    const params = new URLSearchParams({
      page: String(page),
      pageSize: '10',
      segment,
      status,
    });

    if (q.trim()) params.set('q', q.trim());
    if (sourceId !== 'all') params.set('sourceId', sourceId);

    return params.toString();
  }, [page, q, segment, sourceId, status]);

  const fetchClients = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/clients?${queryString}`);
      if (!res.ok) {
        setError(await readError(res, 'Не удалось загрузить клиентов'));
        return;
      }

      const data = (await res.json()) as ClientsResponse;
      setClients(data.items);
      setTotalPages(data.totalPages);
    } catch {
      setError('Не удалось загрузить клиентов. Проверьте подключение к серверу.');
    } finally {
      setLoading(false);
    }
  }, [queryString]);

  const fetchClientSources = useCallback(async () => {
    setReferencesLoading(true);
    try {
      setSources(await fetchReferences('client-sources', 'all'));
    } catch {
      setSources([]);
    } finally {
      setReferencesLoading(false);
    }
  }, []);

  const fetchDuplicateGroups = useCallback(async () => {
    if (!canMerge) return;

    setDuplicatesLoading(true);
    setDuplicatesError(null);
    try {
      const res = await apiFetch('/api/clients/duplicates');
      if (!res.ok) {
        setDuplicatesError(await readError(res, 'Не удалось загрузить дубли'));
        return;
      }

      const data = (await res.json()) as DuplicateGroup[];
      setDuplicateGroups(data);
      setGroupSelections(buildDuplicateSelections(data));
    } catch {
      setDuplicatesError('Не удалось загрузить дубли. Проверьте подключение к серверу.');
    } finally {
      setDuplicatesLoading(false);
    }
  }, [canMerge]);

  useEffect(() => {
    void fetchClientSources();
  }, [fetchClientSources]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void fetchClients();
    }, 250);

    return () => window.clearTimeout(timeout);
  }, [fetchClients]);

  useEffect(() => {
    if (viewMode !== 'duplicates') return;
    if (!canMerge) {
      setViewMode('list');
      return;
    }

    void fetchDuplicateGroups();
  }, [canMerge, fetchDuplicateGroups, viewMode]);

  useEffect(() => {
    setPage(1);
  }, [q, segment, sourceId, status]);

  useEffect(() => {
    const digits = getPhoneDigits(form.phone);
    if (!formOpen || digits.length !== 10) {
      setDuplicateWarning(null);
      return;
    }

    let cancelled = false;
    const checkedPhoneDigits = digits;

    const timeout = window.setTimeout(async () => {
      const params = new URLSearchParams({ phone: form.phone });
      params.set('includeArchived', 'true');
      if (editingClient) {
        params.set('excludeClientId', String(editingClient.id));
      }

      const res = await apiFetch(`/api/clients/lookup?${params.toString()}`);
      if (cancelled || getPhoneDigits(form.phone) !== checkedPhoneDigits) {
        return;
      }
      if (!res.ok) return;
      const data = (await res.json()) as { client: Client | null };
      if (cancelled || getPhoneDigits(form.phone) !== checkedPhoneDigits) {
        return;
      }
      setDuplicateWarning(data.client);
    }, 300);

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [editingClient, form.phone, formOpen]);

  const isInitialLoading = loading && clients.length === 0;
  const paginationItems = useMemo(
    () => getPaginationItems(page, totalPages),
    [page, totalPages],
  );
  const activeSources = useMemo(
    () => sources.filter((source) => source.status === 'active'),
    [sources],
  );
  const formSourceOptions = useMemo(() => {
    const currentSource = sources.find(
      (source) => String(source.id) === form.sourceId,
    );
    if (
      currentSource &&
      currentSource.status === 'archived' &&
      !activeSources.some((source) => source.id === currentSource.id)
    ) {
      return [...activeSources, currentSource];
    }

    return activeSources;
  }, [activeSources, form.sourceId, sources]);

  const getEmptyClientForm = useCallback(() => {
    const defaultSource =
      activeSources.find((item) => item.name === 'Ресепшн (Админ)') ||
      activeSources[0];

    return {
      ...EMPTY_FORM,
      sourceId: defaultSource ? String(defaultSource.id) : '',
      source: defaultSource?.name || EMPTY_FORM.source,
    };
  }, [activeSources]);

  const openCreate = () => {
    setEditingClient(null);
    setForm(getEmptyClientForm());
    setDuplicateWarning(null);
    setFormOpen(true);
  };

  const openEdit = (client: Client) => {
    setEditingClient(client);
    setForm({
      name: client.name,
      phone: client.phone,
      sourceId: client.sourceId
        ? String(client.sourceId)
        : String(sources.find((item) => item.name === client.source)?.id || ''),
      source: client.source,
      note: client.note || '',
      status: client.status === 'archived' ? 'archived' : 'active',
    });
    setDuplicateWarning(null);
    setFormOpen(true);
  };

  const openRestoreFromArchive = (client: Client) => {
    setEditingClient(client);
    setForm({
      name: client.name,
      phone: client.phone,
      sourceId: client.sourceId
        ? String(client.sourceId)
        : String(sources.find((item) => item.name === client.source)?.id || ''),
      source: client.source,
      note: client.note || '',
      status: 'active',
    });
    setDuplicateWarning(null);
    setFormOpen(true);
  };

  const loadDetails = async (clientId: number) => {
    setDetailsLoading(true);
    try {
      const res = await apiFetch(`/api/clients/${clientId}`);
      if (!res.ok) {
        alert(await readError(res, 'Не удалось открыть клиента'));
        return;
      }

      const data = (await res.json()) as ClientDetails;
      setDetails({ ...data, trainingNotes: data.trainingNotes || [] });
      setTrainingForm({ ...EMPTY_TRAINING_FORM, trainedAt: getTodayDate() });
      setSelectedMergeIds([]);
    } finally {
      setDetailsLoading(false);
    }
  };

  const saveClient = async (payload: ClientPayload) => {
    const res = await apiFetch(
      editingClient ? `/api/clients/${editingClient.id}` : '/api/clients',
      {
        method: editingClient ? 'PUT' : 'POST',
        body: JSON.stringify(payload),
      },
    );

    if (!res.ok) {
      const apiError = await readApiError(res, 'Не удалось сохранить клиента');
      if (
        apiError.code === 'CLIENT_ARCHIVED_CONFLICT' &&
        apiError.client &&
        !editingClient
      ) {
        setDuplicateWarning(apiError.client);
        return;
      }

      alert(apiError.error);
      return;
    }

    const saved = (await res.json()) as ClientDetails;
    setFormOpen(false);
    setDetails(saved);
    void fetchClients();
  };

  const handleSave = async (event: React.FormEvent) => {
    event.preventDefault();

    const payload: ClientPayload = {
      name: form.name.trim(),
      phone: form.phone,
      sourceId: form.sourceId ? Number(form.sourceId) : undefined,
      source: form.source.trim(),
      note: form.note.trim(),
      status: form.status,
    };

    if (editingClient && editingClient.status !== payload.status) {
      const isArchiving = payload.status === 'archived';
      const clientName = payload.name || editingClient.name;

      setPendingAction({
        confirmLabel: isArchiving ? 'В архив' : 'Восстановить',
        description: isArchiving
          ? `Клиент «${clientName}» исчезнет из активной базы, но история визитов, заметки и задачи сохранятся.`
          : `Клиент «${clientName}» будет восстановлен в активную базу с обновленными данными из формы.`,
        isDestructive: isArchiving,
        onConfirm: () => saveClient(payload),
        title: isArchiving
          ? 'Сохранить и отправить клиента в архив?'
          : 'Сохранить и восстановить клиента?',
      });
      return;
    }

    await saveClient(payload);
  };

  const executeClientStatusUpdate = async (
    client: Client,
    nextStatus: ClientStatus,
  ) => {
    const isArchiving = nextStatus === 'archived';
    const res = await apiFetch(`/api/clients/${client.id}`, {
      method: 'PUT',
      body: JSON.stringify({ status: nextStatus }),
    });

    if (!res.ok) {
      alert(
        await readError(
          res,
          isArchiving
            ? 'Не удалось отправить клиента в архив'
            : 'Не удалось восстановить клиента',
        ),
      );
      return;
    }

    const saved = (await res.json()) as ClientDetails;
    setDetails((current) =>
      current?.client.id === client.id ? saved : current,
    );
    void fetchClients();
  };

  const requestClientStatusUpdate = (
    client: Client,
    nextStatus: ClientStatus,
  ) => {
    const isArchiving = nextStatus === 'archived';

    setPendingAction({
      confirmLabel: isArchiving ? 'В архив' : 'Восстановить',
      description: isArchiving
        ? `Клиент «${client.name}» исчезнет из активной базы, но история визитов, заметки и задачи сохранятся. Восстановить можно из фильтра «Архив».`
        : `Клиент «${client.name}» вернется в активную базу. После восстановления проверьте телефон, источник и заметки.`,
      isDestructive: isArchiving,
      onConfirm: () => executeClientStatusUpdate(client, nextStatus),
      title: isArchiving ? 'Отправить клиента в архив?' : 'Восстановить клиента?',
    });
  };

  const executePermanentDelete = async (client: Client) => {
    const res = await apiFetch(`/api/clients/${client.id}/permanent`, {
      method: 'DELETE',
    });

    if (!res.ok) {
      alert(await readError(res, 'Не удалось удалить клиента из архива'));
      return;
    }

    if (details?.client.id === client.id) {
      setDetails(null);
    }
    await fetchClients();
  };

  const requestPermanentDelete = (client: Client) => {
    setPendingAction({
      confirmLabel: 'Удалить навсегда',
      description: `Клиент «${client.name}» будет удален из архива без возможности восстановления. Сервер разрешит это только если у клиента нет визитов, дневника тренировок, задач обзвона и связанных дублей.`,
      isDestructive: true,
      onConfirm: () => executePermanentDelete(client),
      title: 'Удалить клиента из архива?',
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

  const handleTrainingSave = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!details?.client) return;

    setTrainingSaving(true);
    try {
      const res = await apiFetch(
        `/api/clients/${details.client.id}/training-notes`,
        {
          method: 'POST',
          body: JSON.stringify(trainingForm),
        },
      );

      if (!res.ok) {
        alert(await readError(res, 'Не удалось сохранить запись тренировки'));
        return;
      }

      const trainingNotes = (await res.json()) as TrainingNote[];
      setDetails({ ...details, trainingNotes });
      setTrainingForm({ ...EMPTY_TRAINING_FORM, trainedAt: getTodayDate() });
    } finally {
      setTrainingSaving(false);
    }
  };

  const toggleMergeCandidate = (clientId: number) => {
    setSelectedMergeIds((prev) =>
      prev.includes(clientId)
        ? prev.filter((id) => id !== clientId)
        : [...prev, clientId],
    );
  };

  const setDuplicateGroupPrimary = (group: DuplicateGroup, primaryId: number) => {
    setGroupSelections((prev) => ({
      ...prev,
      [group.phoneNormalized]: {
        primaryId,
        duplicateIds: [],
      },
    }));
  };

  const toggleDuplicateGroupClient = (group: DuplicateGroup, clientId: number) => {
    setGroupSelections((prev) => {
      const current = prev[group.phoneNormalized] || {
        primaryId: getDefaultPrimaryClientId(group.clients),
        duplicateIds: [],
      };

      if (current.primaryId === clientId) return prev;

      const duplicateIds = current.duplicateIds.includes(clientId)
        ? current.duplicateIds.filter((id) => id !== clientId)
        : [...current.duplicateIds, clientId];

      return {
        ...prev,
        [group.phoneNormalized]: {
          ...current,
          duplicateIds,
        },
      };
    });
  };

  const executeSelectedMerge = async (
    primaryClient: Client,
    duplicateClientIds: number[],
  ) => {
    const res = await apiFetch(`/api/clients/${primaryClient.id}/merge`, {
      method: 'POST',
      body: JSON.stringify({ duplicateClientIds }),
    });

    if (!res.ok) {
      alert(await readError(res, 'Не удалось объединить клиентов'));
      return;
    }

    const mergedDetails = (await res.json()) as ClientDetails;
    if (details?.client.id === primaryClient.id) {
      setDetails(mergedDetails);
    }
    setSelectedMergeIds([]);
    void fetchClients();
    if (viewMode === 'duplicates') void fetchDuplicateGroups();
  };

  const handleMerge = () => {
    if (!details?.client || selectedMergeIds.length === 0) return;

    const primaryClient = details.client;
    const duplicateClientIds = [...selectedMergeIds];
    setPendingAction({
      confirmLabel: 'Объединить',
      description: `Выбранные дубли будут объединены с клиентом «${primaryClient.name}». История визитов будет перенесена, а дубль уйдет в архивную техническую запись.`,
      isDestructive: true,
      onConfirm: () => executeSelectedMerge(primaryClient, duplicateClientIds),
      title: 'Объединить клиентов?',
    });
  };

  const handleMergeDuplicateGroup = (group: DuplicateGroup) => {
    const selection = groupSelections[group.phoneNormalized];
    if (!selection?.primaryId || selection.duplicateIds.length === 0) {
      alert('Выберите основного клиента и хотя бы один дубль');
      return;
    }

    const primary = group.clients.find(
      (client) => client.id === selection.primaryId,
    );
    if (!primary) return;

    const duplicateClientIds = [...selection.duplicateIds];
    setPendingAction({
      confirmLabel: 'Объединить',
      description: `${duplicateClientIds.length} дубл. будут объединены с клиентом «${primary.name}». История визитов будет перенесена, а дубли уйдут в архивные технические записи.`,
      isDestructive: true,
      onConfirm: async () => {
        await executeSelectedMerge(primary, duplicateClientIds);
        await fetchDuplicateGroups();
      },
      title: 'Объединить группу дублей?',
    });
  };

  return (
    <div className="min-w-0 space-y-4 p-4 md:p-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Клиенты</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Клиентская база, история визитов, заметки и объединение дублей.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant={viewMode === 'list' ? 'default' : 'outline'}
            onClick={() => setViewMode('list')}
          >
            Список
          </Button>
          {canMerge && (
            <Button
              variant={viewMode === 'duplicates' ? 'default' : 'outline'}
              onClick={() => setViewMode('duplicates')}
            >
              <GitMerge className="mr-2 h-4 w-4" /> Дубли
            </Button>
          )}
          <Button
            variant="outline"
            size="icon"
            onClick={() =>
              viewMode === 'duplicates'
                ? void fetchDuplicateGroups()
                : void fetchClients()
            }
            disabled={viewMode === 'duplicates' ? duplicatesLoading : loading}
            aria-label="Обновить список клиентов"
            title="Обновить"
          >
            <RefreshCw
              className={`h-4 w-4 ${
                (viewMode === 'duplicates' ? duplicatesLoading : loading)
                  ? 'animate-spin'
                  : ''
              }`}
            />
          </Button>
          {canEdit && (
            <Button onClick={openCreate}>
              <Plus className="mr-2 h-4 w-4" /> Клиент
            </Button>
          )}
        </div>
      </div>

      {viewMode === 'list' ? (
        <>
          <div className="rounded-md border bg-card p-3">
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(220px,1fr)_180px_180px_160px]">
              <div className="relative">
                <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input
                  value={q}
                  onChange={(event) => setQ(event.target.value)}
                  placeholder={isTrainerAccount ? 'Имя клиента' : 'Имя или телефон'}
                  className="pl-9"
                />
              </div>
              <Select value={sourceId} onValueChange={setSourceId}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Все источники</SelectItem>
                  {sources.map((item) => (
                    <SelectItem key={item.id} value={String(item.id)}>
                      {item.status === 'archived'
                        ? `${item.name} (архив)`
                        : item.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={segment}
                onValueChange={(value) => setSegment(value as ClientSegment)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CLIENT_SEGMENT_OPTIONS.map((option) => (
                    <SelectItem
                      key={option.value}
                      value={option.value}
                      title={option.condition}
                    >
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={status}
                onValueChange={(value) =>
                  setStatus(value as 'active' | 'archived' | 'all')
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
          </div>

          <div className="hidden overflow-x-auto rounded-md border bg-card lg:block">
            <Table className="min-w-[960px] table-fixed">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[23%]">Клиент</TableHead>
                  {!isTrainerAccount && (
                    <TableHead className="w-[17%]">Телефон</TableHead>
                  )}
                  <TableHead className="w-[16%]">Источник</TableHead>
                  <TableHead className="w-[14%]">Сегмент</TableHead>
                  <TableHead className="w-[9%] text-right">Визиты</TableHead>
                  <TableHead className="w-[12%]">Последний визит</TableHead>
                  <TableHead className="w-[11%] text-right"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(isInitialLoading || error || clients.length === 0) && (
                  <TableRow>
                    <TableCell
                      colSpan={clientTableColSpan}
                      className="py-10 text-center text-muted-foreground"
                    >
                      {isInitialLoading
                        ? 'Загрузка клиентов...'
                        : error || 'Клиенты не найдены'}
                    </TableCell>
                  </TableRow>
                )}
                {clients.map((client) => (
                  <TableRow key={client.id}>
                    <TableCell>
                      <div className="min-w-0">
                        <div className="flex min-w-0 items-center gap-2">
                          <UserRoundCheck className="h-4 w-4 shrink-0 text-muted-foreground" />
                          <span className="truncate font-medium">
                            {client.name}
                          </span>
                        </div>
                        <div className="mt-1 flex flex-wrap gap-1">
                          <Badge
                            variant="outline"
                            className={getStatusBadgeClass(client.status)}
                          >
                            {client.statusLabel}
                          </Badge>
                          {client.note && (
                            <Badge variant="outline">Есть заметка</Badge>
                          )}
                        </div>
                      </div>
                    </TableCell>
                    {!isTrainerAccount && (
                      <TableCell className="truncate text-muted-foreground">
                        {client.phone}
                      </TableCell>
                    )}
                    <TableCell className="truncate text-muted-foreground">
                      {client.source}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{client.segment}</Badge>
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      {client.stats.visitCount}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDate(client.stats.lastVisitAt)}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => void loadDetails(client.id)}
                          aria-label={`Открыть клиента ${client.name}`}
                          title="Открыть"
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                        {canEdit && !client.mergedIntoUserId && (
                          <>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              onClick={() => openEdit(client)}
                              aria-label={`Редактировать клиента ${client.name}`}
                              title="Редактировать"
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            {client.status === 'archived' ? (
                              <>
                                <Button
                                  variant="ghost"
                                  size="icon-sm"
                                  onClick={() =>
                                    requestClientStatusUpdate(client, 'active')
                                  }
                                  aria-label={`Восстановить клиента ${client.name}`}
                                  title="Восстановить"
                                >
                                  <ArchiveRestore className="h-4 w-4" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon-sm"
                                  className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                                  onClick={() => requestPermanentDelete(client)}
                                  aria-label={`Удалить навсегда клиента ${client.name}`}
                                  title="Удалить навсегда"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </>
                            ) : (
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                onClick={() =>
                                  requestClientStatusUpdate(client, 'archived')
                                }
                                aria-label={`Архивировать клиента ${client.name}`}
                                title="Архивировать"
                              >
                                <Archive className="h-4 w-4" />
                              </Button>
                            )}
                          </>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="space-y-3 lg:hidden">
            {(isInitialLoading || error || clients.length === 0) && (
              <div className="rounded-md border bg-card p-6 text-center text-muted-foreground">
                {isInitialLoading
                  ? 'Загрузка клиентов...'
                  : error || 'Клиенты не найдены'}
              </div>
            )}
            {clients.map((client) => (
              <div key={client.id} className="rounded-md border bg-card p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex min-w-0 items-center gap-2">
                      <UserRoundCheck className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="truncate font-medium">{client.name}</span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1">
                      <Badge
                        variant="outline"
                        className={getStatusBadgeClass(client.status)}
                      >
                        {client.statusLabel}
                      </Badge>
                      <Badge variant="outline">{client.segment}</Badge>
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => void loadDetails(client.id)}
                      aria-label={`Открыть клиента ${client.name}`}
                      title="Открыть"
                    >
                      <Eye className="h-4 w-4" />
                    </Button>
                    {canEdit && !client.mergedIntoUserId && (
                      <>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => openEdit(client)}
                          aria-label={`Редактировать клиента ${client.name}`}
                          title="Редактировать"
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        {client.status === 'archived' ? (
                          <>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              onClick={() =>
                                requestClientStatusUpdate(client, 'active')
                              }
                              aria-label={`Восстановить клиента ${client.name}`}
                              title="Восстановить"
                            >
                              <ArchiveRestore className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                              onClick={() => requestPermanentDelete(client)}
                              aria-label={`Удалить навсегда клиента ${client.name}`}
                              title="Удалить навсегда"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </>
                        ) : (
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={() =>
                              requestClientStatusUpdate(client, 'archived')
                            }
                            aria-label={`Архивировать клиента ${client.name}`}
                            title="Архивировать"
                          >
                            <Archive className="h-4 w-4" />
                          </Button>
                        )}
                      </>
                    )}
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-1 gap-2 text-sm">
                  {!isTrainerAccount && (
                    <div className="flex justify-between gap-3">
                      <span className="text-muted-foreground">Телефон</span>
                      <span className="text-right font-medium">{client.phone}</span>
                    </div>
                  )}
                  <div className="flex justify-between gap-3">
                    <span className="text-muted-foreground">Источник</span>
                    <span className="text-right">{client.source}</span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-muted-foreground">Визиты</span>
                    <span className="font-medium">{client.stats.visitCount}</span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-muted-foreground">Последний визит</span>
                    <span>{formatDate(client.stats.lastVisitAt)}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <Pagination className="justify-end">
            <PaginationContent>
              <PaginationItem>
                <PaginationPrevious
                  disabled={page <= 1}
                  onClick={() => setPage((value) => Math.max(1, value - 1))}
                />
              </PaginationItem>
              {paginationItems.map((item, index) => (
                <PaginationItem key={`${item}-${index}`}>
                  {item === 'ellipsis' ? (
                    <PaginationEllipsis />
                  ) : (
                    <PaginationButton
                      isActive={item === page}
                      onClick={() => setPage(item)}
                    >
                      {item}
                    </PaginationButton>
                  )}
                </PaginationItem>
              ))}
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
        </>
      ) : (
        <div className="rounded-md border bg-card">
          <div className="flex flex-col gap-3 border-b p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="font-semibold">Дубликаты клиентов</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Группы строятся по одинаковому телефону. Основная запись остается,
                выбранные дубли переносят в нее историю визитов.
              </p>
            </div>
            <Button
              variant="outline"
              onClick={() => void fetchDuplicateGroups()}
              disabled={duplicatesLoading}
            >
              <RefreshCw
                className={`mr-2 h-4 w-4 ${
                  duplicatesLoading ? 'animate-spin' : ''
                }`}
              />
              Обновить
            </Button>
          </div>

          {duplicatesLoading && duplicateGroups.length === 0 && (
            <div className="p-8 text-center text-muted-foreground">
              Загрузка дублей...
            </div>
          )}

          {duplicatesError && (
            <div className="p-8 text-center text-destructive">
              {duplicatesError}
            </div>
          )}

          {!duplicatesLoading && !duplicatesError && duplicateGroups.length === 0 && (
            <div className="p-8 text-center text-muted-foreground">
              Дублей по телефону не найдено.
            </div>
          )}

          {duplicateGroups.map((group) => {
            const selection = groupSelections[group.phoneNormalized] || {
              primaryId: getDefaultPrimaryClientId(group.clients),
              duplicateIds: [],
            };

            return (
              <div key={group.phoneNormalized} className="border-t p-4">
                <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="font-medium">
                      Телефон: {group.clients[0]?.phone || group.phoneNormalized}
                    </div>
                    <div className="text-sm text-muted-foreground">
                      {group.count} записи с одинаковым телефоном
                    </div>
                  </div>
                  <Button
                    onClick={() => void handleMergeDuplicateGroup(group)}
                    disabled={!selection.primaryId || selection.duplicateIds.length === 0}
                  >
                    <GitMerge className="mr-2 h-4 w-4" />
                    Объединить выбранные
                  </Button>
                </div>

                <div className="overflow-x-auto rounded-md border">
                  <Table className="min-w-[880px] table-fixed">
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[90px]">Основной</TableHead>
                        <TableHead className="w-[100px]">Слить</TableHead>
                        <TableHead className="w-[24%]">Клиент</TableHead>
                        <TableHead className="w-[11%] text-right">
                          Визиты
                        </TableHead>
                        <TableHead className="w-[16%]">Последний визит</TableHead>
                        <TableHead className="w-[18%]">Источник</TableHead>
                        <TableHead className="w-[90px] text-right"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {group.clients.map((client) => {
                        const isPrimary = selection.primaryId === client.id;
                        const isSelectedDuplicate =
                          selection.duplicateIds.includes(client.id);

                        return (
                          <TableRow key={client.id}>
                            <TableCell>
                              <input
                                type="radio"
                                name={`primary-${group.phoneNormalized}`}
                                checked={isPrimary}
                                onChange={() =>
                                  setDuplicateGroupPrimary(group, client.id)
                                }
                                className="h-4 w-4"
                              />
                            </TableCell>
                            <TableCell>
                              <input
                                type="checkbox"
                                checked={isSelectedDuplicate}
                                disabled={isPrimary}
                                onChange={() =>
                                  toggleDuplicateGroupClient(group, client.id)
                                }
                                className="h-4 w-4"
                              />
                            </TableCell>
                            <TableCell>
                              <div className="min-w-0">
                                <div className="truncate font-medium">
                                  {client.name}
                                </div>
                                <div className="mt-1 flex flex-wrap gap-1">
                                  <Badge
                                    variant="outline"
                                    className={getStatusBadgeClass(client.status)}
                                  >
                                    {client.statusLabel}
                                  </Badge>
                                  {client.note && (
                                    <Badge variant="outline">Есть заметка</Badge>
                                  )}
                                </div>
                              </div>
                            </TableCell>
                            <TableCell className="text-right font-medium">
                              {client.stats.visitCount}
                            </TableCell>
                            <TableCell className="text-muted-foreground">
                              {formatDate(client.stats.lastVisitAt)}
                            </TableCell>
                            <TableCell className="truncate text-muted-foreground">
                              {client.source}
                            </TableCell>
                            <TableCell className="text-right">
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                onClick={() => void loadDetails(client.id)}
                                aria-label={`Открыть клиента ${client.name}`}
                                title="Открыть"
                              >
                                <Eye className="h-4 w-4" />
                              </Button>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-[720px]">
          <DialogHeader>
            <DialogTitle>
              {editingClient?.status === 'archived' && form.status === 'active'
                ? 'Восстановить клиента'
                : editingClient
                  ? 'Редактировать клиента'
                  : 'Новый клиент'}
            </DialogTitle>
            <DialogDescription>
              {editingClient?.status === 'archived' && form.status === 'active'
                ? 'Проверьте и обновите данные перед возвращением клиента в актуальную базу.'
                : 'Телефон проверяется на дубли и хранится в едином формате.'}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSave} className="space-y-4 pt-2">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-medium">Имя</label>
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
                  Телефон
                </label>
                <Input
                  required
                  inputMode="tel"
                  value={form.phone}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      phone: formatClientPhone(event.target.value),
                    })
                  }
                  placeholder="+7 (999) 000-00-00"
                />
              </div>
            </div>

            {duplicateWarning && (
              <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
                <div className="font-medium text-amber-700 dark:text-amber-300">
                  {duplicateWarning.status === 'archived'
                    ? 'Клиент с таким телефоном уже есть в архиве'
                    : 'Клиент с таким телефоном уже есть'}
                </div>
                <div className="mt-1 text-muted-foreground">
                  {duplicateWarning.name} · {duplicateWarning.phone}
                </div>
                {duplicateWarning.status === 'archived' && !editingClient ? (
                  <Button
                    type="button"
                    variant="outline"
                    className="mt-3 w-full"
                    onClick={() => openRestoreFromArchive(duplicateWarning)}
                  >
                    <ArchiveRestore className="mr-2 h-4 w-4" />
                    Восстановить и отредактировать
                  </Button>
                ) : (
                  <button
                    type="button"
                    className="mt-2 text-left text-muted-foreground underline"
                    onClick={() => {
                      setFormOpen(false);
                      void loadDetails(duplicateWarning.id);
                    }}
                  >
                    Открыть карточку
                  </button>
                )}
              </div>
            )}

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-medium">
                  Источник
                </label>
                <Select
                  value={form.sourceId}
                  onValueChange={(sourceId) => {
                    const source = sources.find(
                      (item) => String(item.id) === sourceId,
                    );
                    setForm({
                      ...form,
                      sourceId,
                      source: source?.name || form.source,
                    });
                  }}
                  disabled={referencesLoading}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Выберите источник" />
                  </SelectTrigger>
                  <SelectContent>
                    {formSourceOptions.map((source) => (
                      <SelectItem key={source.id} value={String(source.id)}>
                        {source.status === 'archived'
                          ? `${source.name} (архив)`
                          : source.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {editingClient && (
                <div>
                  <label className="mb-1 block text-xs font-medium">
                    Статус
                  </label>
                  <Select
                    value={form.status}
                    onValueChange={(value) =>
                      setForm({
                        ...form,
                        status: value as 'active' | 'archived',
                      })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="active">Активен</SelectItem>
                      <SelectItem value="archived">В архиве</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium">
                Заметка
              </label>
              <textarea
                value={form.note}
                onChange={(event) =>
                  setForm({ ...form, note: event.target.value })
                }
                className="min-h-[120px] w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                placeholder="Что важно знать администраторам и менеджеру"
              />
            </div>

            <Button type="submit" className="w-full">
              Сохранить
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(details)} onOpenChange={(open) => !open && setDetails(null)}>
        <DialogContent className="max-h-[calc(100dvh-1rem)] max-w-[calc(100vw-1rem)] overflow-y-auto p-3 sm:max-w-[980px] sm:p-4">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 pr-8">
              <Users className="h-5 w-5 text-muted-foreground" />
              {details?.client.name || 'Клиент'}
            </DialogTitle>
            <DialogDescription>
              Карточка клиента, история визитов и возможные дубли.
            </DialogDescription>
          </DialogHeader>

          {detailsLoading && (
            <div className="py-10 text-center text-sm text-muted-foreground">
              Загрузка...
            </div>
          )}

          {details && !detailsLoading && (
            <div className="space-y-5">
              {details.client.mergedIntoUserId && details.mergedInto ? (
                <div className="rounded-md border border-blue-500/30 bg-blue-500/10 p-4 text-sm">
                  Этот клиент уже объединен с{' '}
                  <button
                    type="button"
                    className="font-medium underline"
                    onClick={() => void loadDetails(details.mergedInto!.id)}
                  >
                    {details.mergedInto.name}
                  </button>
                  .
                </div>
              ) : (
                <>
                  <div
                    className={`grid grid-cols-1 gap-4 ${
                      isTrainerAccount ? 'md:grid-cols-2' : 'md:grid-cols-3'
                    }`}
                  >
                    {!isTrainerAccount && (
                      <div className="min-w-0 rounded-md border p-4">
                        <div className="text-xs text-muted-foreground">
                          Телефон
                        </div>
                        <div className="mt-1 flex items-center gap-2 font-medium">
                          <Phone className="h-4 w-4 text-muted-foreground" />
                          {details.client.phone}
                        </div>
                      </div>
                    )}
                    <div className="min-w-0 rounded-md border p-4">
                      <div className="text-xs text-muted-foreground">
                        Визитов
                      </div>
                      <div className="mt-1 text-2xl font-bold">
                        {details.client.stats.visitCount}
                      </div>
                    </div>
                    <div className="min-w-0 rounded-md border p-4">
                      <div className="text-xs text-muted-foreground">
                        Последний визит
                      </div>
                      <div className="mt-1 flex min-w-0 items-center gap-2 font-medium">
                        <CalendarDays className="h-4 w-4 text-muted-foreground" />
                        <span className="min-w-0 break-words">
                          {formatDateTime(details.client.stats.lastVisitAt)}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div className="min-w-0 rounded-md border p-4">
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <div className="font-medium">Данные клиента</div>
                        {canEdit && (
                          <div className="flex flex-wrap justify-end gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => openEdit(details.client)}
                            >
                              <Pencil className="mr-2 h-4 w-4" /> Изменить
                            </Button>
                            {details.client.status === 'archived' ? (
                              <>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() =>
                                    requestClientStatusUpdate(
                                      details.client,
                                      'active',
                                    )
                                  }
                                >
                                  <ArchiveRestore className="mr-2 h-4 w-4" />
                                  Восстановить
                                </Button>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                                  onClick={() =>
                                    requestPermanentDelete(details.client)
                                  }
                                >
                                  <Trash2 className="mr-2 h-4 w-4" />
                                  Удалить
                                </Button>
                              </>
                            ) : (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() =>
                                  requestClientStatusUpdate(
                                    details.client,
                                    'archived',
                                  )
                                }
                              >
                                <Archive className="mr-2 h-4 w-4" />
                                В архив
                              </Button>
                            )}
                          </div>
                        )}
                      </div>
                      <div className="space-y-2 text-sm">
                        <div className="flex justify-between gap-3">
                          <span className="text-muted-foreground">
                            Источник
                          </span>
                          <span className="min-w-0 break-words text-right">
                            {details.client.source}
                          </span>
                        </div>
                        <div className="flex justify-between gap-3">
                          <span className="text-muted-foreground">
                            Первый визит
                          </span>
                          <span className="min-w-0 break-words text-right">
                            {formatDateTime(
                              details.client.stats.firstVisitAt,
                            )}
                          </span>
                        </div>
                        <div className="flex justify-between gap-3">
                          <span className="text-muted-foreground">
                            Создан
                          </span>
                          <span className="min-w-0 break-words text-right">
                            {formatDateTime(details.client.createdAt)}
                          </span>
                        </div>
                        <div className="flex justify-between gap-3">
                          <span className="text-muted-foreground">
                            Внешние ID
                          </span>
                          <span className="text-right text-xs">
                            {[
                              details.client.telegramId && 'TG',
                              details.client.vkId && 'VK',
                              details.client.webId && 'WEB',
                            ]
                              .filter(Boolean)
                              .join(', ') || '-'}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="min-w-0 rounded-md border p-4">
                      <div className="mb-2 font-medium">Заметка</div>
                      <div className="min-h-[112px] whitespace-pre-wrap text-sm text-muted-foreground">
                        {details.client.note || 'Заметка пока не заполнена.'}
                      </div>
                    </div>
                  </div>

                  {canViewTraining && (
                    <div className="rounded-md border">
                      <div className="flex flex-col gap-3 border-b px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <div className="flex items-center gap-2 font-medium">
                            <Dumbbell className="h-4 w-4 text-muted-foreground" />
                            Дневник тренировок
                          </div>
                          <div className="mt-1 text-sm text-muted-foreground">
                            Уровень, упражнения и заметки тренера по клиенту.
                          </div>
                        </div>
                      </div>

                      <div className="space-y-4 p-4">
                        {canEditTraining && details.client.status === 'archived' && (
                          <div className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
                            Клиент в архиве, дневник тренировок доступен только
                            для просмотра.
                          </div>
                        )}

                        {canEditTraining && details.client.status !== 'archived' && (
                          <form
                            onSubmit={handleTrainingSave}
                            className="rounded-md border p-3"
                          >
                            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[160px_140px_1fr]">
                              <div>
                                <label className="mb-1 block text-xs font-medium">
                                  Дата
                                </label>
                                <Input
                                  type="date"
                                  required
                                  value={trainingForm.trainedAt}
                                  onChange={(event) =>
                                    setTrainingForm({
                                      ...trainingForm,
                                      trainedAt: event.target.value,
                                    })
                                  }
                                />
                              </div>
                              <div>
                                <label className="mb-1 block text-xs font-medium">
                                  Уровень
                                </label>
                                <Select
                                  value={trainingForm.level}
                                  onValueChange={(value) =>
                                    setTrainingForm({
                                      ...trainingForm,
                                      level: value as TrainingLevel,
                                    })
                                  }
                                >
                                  <SelectTrigger>
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {TRAINING_LEVELS.map((level) => (
                                      <SelectItem key={level} value={level}>
                                        {level}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>
                              <div>
                                <label className="mb-1 block text-xs font-medium">
                                  Упражнения
                                </label>
                                <Input
                                  value={trainingForm.exercises}
                                  onChange={(event) =>
                                    setTrainingForm({
                                      ...trainingForm,
                                      exercises: event.target.value,
                                    })
                                  }
                                  placeholder="Что делали на тренировке"
                                />
                              </div>
                            </div>
                            <div className="mt-3">
                              <label className="mb-1 block text-xs font-medium">
                                Заметка
                              </label>
                              <textarea
                                value={trainingForm.note}
                                onChange={(event) =>
                                  setTrainingForm({
                                    ...trainingForm,
                                    note: event.target.value,
                                  })
                                }
                                className="min-h-[90px] w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                placeholder="Свободное поле для дневника тренировок"
                              />
                            </div>
                            <Button
                              type="submit"
                              className="mt-3 w-full sm:w-auto"
                              disabled={trainingSaving}
                            >
                              <Save className="mr-2 h-4 w-4" />
                              {trainingSaving ? 'Сохранение...' : 'Добавить запись'}
                            </Button>
                          </form>
                        )}

                        {details.trainingNotes.length === 0 ? (
                          <div className="rounded-md border border-dashed py-8 text-center text-sm text-muted-foreground">
                            Записей тренера пока нет.
                          </div>
                        ) : (
                          <div className="divide-y rounded-md border">
                            {details.trainingNotes.map((entry) => (
                              <div key={entry.id} className="p-3">
                                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <Badge variant="outline">{entry.level}</Badge>
                                    <span className="font-medium">
                                      {formatDate(entry.trainedAt)}
                                    </span>
                                  </div>
                                  <div className="text-sm text-muted-foreground">
                                    {entry.trainer?.name || 'Тренер'}
                                  </div>
                                </div>
                                {entry.exercises && (
                                  <div className="mt-3 text-sm">
                                    <span className="text-muted-foreground">
                                      Упражнения:{' '}
                                    </span>
                                    {entry.exercises}
                                  </div>
                                )}
                                {entry.note && (
                                  <div className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">
                                    {entry.note}
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {canMerge && details.duplicateCandidates.length > 0 && (
                    <div className="rounded-md border border-amber-500/30 p-4">
                      <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <div className="font-medium">Возможные дубли</div>
                          <div className="text-sm text-muted-foreground">
                            Совпадает нормализованный телефон. Выберите записи,
                            которые нужно объединить с текущим клиентом.
                          </div>
                        </div>
                        <Button
                          onClick={handleMerge}
                          disabled={selectedMergeIds.length === 0}
                        >
                          <GitMerge className="mr-2 h-4 w-4" /> Объединить
                        </Button>
                      </div>
                      <div className="divide-y rounded-md border">
                        {details.duplicateCandidates.map((client) => (
                          <label
                            key={client.id}
                            className="flex cursor-pointer flex-col gap-3 p-3 text-sm hover:bg-muted sm:flex-row sm:items-center sm:justify-between"
                          >
                            <span className="flex min-w-0 items-center gap-3 self-stretch">
                              <input
                                type="checkbox"
                                checked={selectedMergeIds.includes(client.id)}
                                onChange={() => toggleMergeCandidate(client.id)}
                                className="h-4 w-4 shrink-0"
                              />
                              <span className="min-w-0 flex-1">
                                <span className="block break-words font-medium">
                                  {client.name}
                                </span>
                                <span className="block break-words text-muted-foreground">
                                  {client.phone} · {client.stats.visitCount} визитов
                                </span>
                              </span>
                            </span>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="self-end sm:self-auto"
                              onClick={(event) => {
                                event.preventDefault();
                                void loadDetails(client.id);
                              }}
                            >
                              Открыть
                            </Button>
                          </label>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="rounded-md border">
                    <div className="border-b px-4 py-3 font-medium">
                      История визитов
                    </div>
                    <div className="space-y-3 p-3 sm:hidden">
                      {details.visits.length === 0 && (
                        <div className="py-5 text-center text-muted-foreground">
                          Визитов пока нет
                        </div>
                      )}
                      {details.visits.map((visit) => (
                        <div key={visit.id} className="rounded-md border p-3 text-sm">
                          <div className="font-medium">
                            {formatDateTime(visit.scannedAt)}
                          </div>
                          <div className="mt-2 text-muted-foreground">
                            {formatVisitCategories(visit)}
                          </div>
                          <div className="mt-2">
                            {visit.keyNumber ? (
                              <Badge variant="outline">
                                №{visit.keyNumber}
                              </Badge>
                            ) : (
                              <span className="text-muted-foreground">Без ключа</span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="hidden overflow-x-auto sm:block">
                      <Table className="min-w-[620px]">
                        <TableHeader>
                          <TableRow>
                            <TableHead>Дата</TableHead>
                            <TableHead>Цель визита</TableHead>
                            <TableHead>Ключ</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {details.visits.length === 0 && (
                            <TableRow>
                              <TableCell
                                colSpan={3}
                                className="py-8 text-center text-muted-foreground"
                              >
                                Визитов пока нет
                              </TableCell>
                            </TableRow>
                          )}
                          {details.visits.map((visit) => (
                            <TableRow key={visit.id}>
                              <TableCell>
                                {formatDateTime(visit.scannedAt)}
                              </TableCell>
                              <TableCell className="text-muted-foreground">
                                {formatVisitCategories(visit)}
                              </TableCell>
                              <TableCell>
                                {visit.keyNumber ? (
                                  <Badge variant="outline">
                                    №{visit.keyNumber}
                                  </Badge>
                                ) : (
                                  <span className="text-muted-foreground">-</span>
                                )}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
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
