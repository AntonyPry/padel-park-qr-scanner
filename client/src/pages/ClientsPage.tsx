import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CalendarDays,
  Eye,
  GitMerge,
  Pencil,
  Phone,
  Plus,
  RefreshCw,
  Search,
  UserRoundCheck,
  Users,
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
  canMergeClients,
} from '@/lib/permissions';
import { useAuth } from '@/lib/useAuth';

type ClientStatus = 'active' | 'archived' | 'merged';
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
  visits: ClientVisit[];
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
  source: string;
  note: string;
  status: 'active' | 'archived';
}

const EMPTY_FORM: ClientFormState = {
  name: '',
  phone: '',
  source: 'Ресепшн (Админ)',
  note: '',
  status: 'active',
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

function getStatusBadgeClass(status: ClientStatus) {
  if (status === 'active') {
    return 'bg-green-100 text-green-800 border-transparent dark:bg-green-900/30 dark:text-green-300';
  }
  if (status === 'merged') {
    return 'bg-blue-100 text-blue-800 border-transparent dark:bg-blue-900/30 dark:text-blue-300';
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
      duplicateIds: group.clients
        .map((client) => client.id)
        .filter((clientId) => clientId !== primaryId),
    };
    return acc;
  }, {});
}

export default function ClientsPage() {
  const { account } = useAuth();
  const canEdit = canManageClients(account?.role);
  const canMerge = canMergeClients(account?.role);

  const [viewMode, setViewMode] = useState<'list' | 'duplicates'>('list');
  const [clients, setClients] = useState<Client[]>([]);
  const [sources, setSources] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [source, setSource] = useState('all');
  const [segment, setSegment] = useState<ClientSegment>('all');
  const [status, setStatus] = useState<'active' | 'archived' | 'merged' | 'all'>(
    'active',
  );
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  const [details, setDetails] = useState<ClientDetails | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editingClient, setEditingClient] = useState<Client | null>(null);
  const [form, setForm] = useState<ClientFormState>(EMPTY_FORM);
  const [duplicateWarning, setDuplicateWarning] = useState<Client | null>(null);
  const [selectedMergeIds, setSelectedMergeIds] = useState<number[]>([]);
  const [duplicateGroups, setDuplicateGroups] = useState<DuplicateGroup[]>([]);
  const [duplicatesLoading, setDuplicatesLoading] = useState(false);
  const [duplicatesError, setDuplicatesError] = useState<string | null>(null);
  const [groupSelections, setGroupSelections] = useState<
    Record<string, DuplicateGroupSelection>
  >({});

  const queryString = useMemo(() => {
    const params = new URLSearchParams({
      page: String(page),
      pageSize: '10',
      segment,
      status,
    });

    if (q.trim()) params.set('q', q.trim());
    if (source !== 'all') params.set('source', source);

    return params.toString();
  }, [page, q, segment, source, status]);

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
      setSources(data.sources);
      setTotalPages(data.totalPages);
    } catch {
      setError('Не удалось загрузить клиентов. Проверьте подключение к серверу.');
    } finally {
      setLoading(false);
    }
  }, [queryString]);

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
  }, [q, segment, source, status]);

  useEffect(() => {
    const digits = getPhoneDigits(form.phone);
    if (!formOpen || digits.length !== 10) {
      setDuplicateWarning(null);
      return;
    }

    const timeout = window.setTimeout(async () => {
      const params = new URLSearchParams({ phone: form.phone });
      if (editingClient) {
        params.set('excludeClientId', String(editingClient.id));
      }

      const res = await apiFetch(`/api/clients/lookup?${params.toString()}`);
      if (!res.ok) return;
      const data = (await res.json()) as { client: Client | null };
      setDuplicateWarning(data.client);
    }, 300);

    return () => window.clearTimeout(timeout);
  }, [editingClient, form.phone, formOpen]);

  const isInitialLoading = loading && clients.length === 0;
  const paginationItems = useMemo(
    () => getPaginationItems(page, totalPages),
    [page, totalPages],
  );

  const openCreate = () => {
    setEditingClient(null);
    setForm(EMPTY_FORM);
    setDuplicateWarning(null);
    setFormOpen(true);
  };

  const openEdit = (client: Client) => {
    setEditingClient(client);
    setForm({
      name: client.name,
      phone: client.phone,
      source: client.source,
      note: client.note || '',
      status: client.status === 'archived' ? 'archived' : 'active',
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
      setDetails(data);
      setSelectedMergeIds([]);
    } finally {
      setDetailsLoading(false);
    }
  };

  const handleSave = async (event: React.FormEvent) => {
    event.preventDefault();

    const payload = {
      name: form.name.trim(),
      phone: form.phone,
      source: form.source.trim(),
      note: form.note.trim(),
      status: form.status,
    };

    const res = await apiFetch(
      editingClient ? `/api/clients/${editingClient.id}` : '/api/clients',
      {
        method: editingClient ? 'PUT' : 'POST',
        body: JSON.stringify(payload),
      },
    );

    if (!res.ok) {
      alert(await readError(res, 'Не удалось сохранить клиента'));
      return;
    }

    const saved = (await res.json()) as ClientDetails;
    setFormOpen(false);
    setDetails(saved);
    void fetchClients();
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
        duplicateIds: group.clients
          .map((client) => client.id)
          .filter((clientId) => clientId !== primaryId),
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

  const handleMerge = async () => {
    if (!details?.client || selectedMergeIds.length === 0) return;

    if (
      !confirm(
        `Объединить выбранные дубли с клиентом ${details.client.name}? История визитов будет перенесена.`,
      )
    ) {
      return;
    }

    const res = await apiFetch(`/api/clients/${details.client.id}/merge`, {
      method: 'POST',
      body: JSON.stringify({ duplicateClientIds: selectedMergeIds }),
    });

    if (!res.ok) {
      alert(await readError(res, 'Не удалось объединить клиентов'));
      return;
    }

    setDetails((await res.json()) as ClientDetails);
    setSelectedMergeIds([]);
    void fetchClients();
    if (viewMode === 'duplicates') void fetchDuplicateGroups();
  };

  const handleMergeDuplicateGroup = async (group: DuplicateGroup) => {
    const selection = groupSelections[group.phoneNormalized];
    if (!selection?.primaryId || selection.duplicateIds.length === 0) {
      alert('Выберите основного клиента и хотя бы один дубль');
      return;
    }

    const primary = group.clients.find(
      (client) => client.id === selection.primaryId,
    );
    if (
      !confirm(
        `Объединить ${selection.duplicateIds.length} дубл. с клиентом ${primary?.name || selection.primaryId}? История визитов будет перенесена.`,
      )
    ) {
      return;
    }

    const res = await apiFetch(`/api/clients/${selection.primaryId}/merge`, {
      method: 'POST',
      body: JSON.stringify({ duplicateClientIds: selection.duplicateIds }),
    });

    if (!res.ok) {
      alert(await readError(res, 'Не удалось объединить клиентов'));
      return;
    }

    const mergedDetails = (await res.json()) as ClientDetails;
    if (details?.client.id === selection.primaryId) {
      setDetails(mergedDetails);
    }
    await fetchDuplicateGroups();
    void fetchClients();
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
                  placeholder="Имя или телефон"
                  className="pl-9"
                />
              </div>
              <Select value={source} onValueChange={setSource}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Все источники</SelectItem>
                  {sources.map((item) => (
                    <SelectItem key={item} value={item}>
                      {item}
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
                  setStatus(value as 'active' | 'archived' | 'merged' | 'all')
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Активные</SelectItem>
                  <SelectItem value="archived">Архив</SelectItem>
                  <SelectItem value="merged">Объединенные</SelectItem>
                  <SelectItem value="all">Все статусы</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="hidden overflow-x-auto rounded-md border bg-card lg:block">
            <Table className="min-w-[860px] table-fixed">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[25%]">Клиент</TableHead>
                  <TableHead className="w-[17%]">Телефон</TableHead>
                  <TableHead className="w-[16%]">Источник</TableHead>
                  <TableHead className="w-[14%]">Сегмент</TableHead>
                  <TableHead className="w-[9%] text-right">Визиты</TableHead>
                  <TableHead className="w-[12%]">Последний визит</TableHead>
                  <TableHead className="w-[7%] text-right"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(isInitialLoading || error || clients.length === 0) && (
                  <TableRow>
                    <TableCell
                      colSpan={7}
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
                    <TableCell className="truncate text-muted-foreground">
                      {client.phone}
                    </TableCell>
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
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                        {canEdit && client.status !== 'merged' && (
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => openEdit(client)}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
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
                    >
                      <Eye className="h-4 w-4" />
                    </Button>
                    {canEdit && client.status !== 'merged' && (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => openEdit(client)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-1 gap-2 text-sm">
                  <div className="flex justify-between gap-3">
                    <span className="text-muted-foreground">Телефон</span>
                    <span className="text-right font-medium">{client.phone}</span>
                  </div>
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
              {editingClient ? 'Редактировать клиента' : 'Новый клиент'}
            </DialogTitle>
            <DialogDescription>
              Телефон проверяется на дубли и хранится в едином формате.
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
                  Клиент с таким телефоном уже есть
                </div>
                <button
                  type="button"
                  className="mt-1 text-left text-muted-foreground underline"
                  onClick={() => {
                    setFormOpen(false);
                    void loadDetails(duplicateWarning.id);
                  }}
                >
                  {duplicateWarning.name} · {duplicateWarning.phone}
                </button>
              </div>
            )}

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-medium">
                  Источник
                </label>
                <Input
                  value={form.source}
                  onChange={(event) =>
                    setForm({ ...form, source: event.target.value })
                  }
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">
                  Статус
                </label>
                <Select
                  value={form.status}
                  onValueChange={(value) =>
                    setForm({ ...form, status: value as 'active' | 'archived' })
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
              {details.client.status === 'merged' && details.mergedInto ? (
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
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                    <div className="min-w-0 rounded-md border p-4">
                      <div className="text-xs text-muted-foreground">
                        Телефон
                      </div>
                      <div className="mt-1 flex items-center gap-2 font-medium">
                        <Phone className="h-4 w-4 text-muted-foreground" />
                        {details.client.phone}
                      </div>
                    </div>
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
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => openEdit(details.client)}
                          >
                            <Pencil className="mr-2 h-4 w-4" /> Изменить
                          </Button>
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
                            {visit.category || '-'}
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
                                {visit.category || '-'}
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
    </div>
  );
}
