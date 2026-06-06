import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { useSearchParams } from 'react-router-dom';
import {
  Archive,
  ArchiveRestore,
  Building2,
  Download,
  History,
  Landmark,
  Link2,
  MinusCircle,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Wallet,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
import { DataTable } from '@/components/data-table';
import {
  ConfirmActionDialog,
  type ConfirmAction,
} from '@/components/confirm-action-dialog';
import { toast } from '@/components/ui/toast';
import { apiFetch, getApiErrorMessage, readApiError } from '@/lib/api';
import {
  canExportFinance,
  canManageCorporateDeposits,
} from '@/lib/permissions';
import { useAuth } from '@/lib/useAuth';

type CorporateClientStatus = 'active' | 'archived';
type LedgerEntryStatus = 'active' | 'canceled';
type LedgerEntryType = 'deposit' | 'spending';
type DepositMode = 'create' | 'link';

interface CatalogCategory {
  id: number;
  name: string;
  type: 'income' | 'expense' | string;
}

interface CorporateActor {
  email?: string | null;
  id: number;
  name?: string | null;
  role?: string | null;
}

interface FinanceRecord {
  amount: number;
  category: string;
  comment?: string | null;
  date: string;
  id: number;
  type: string;
}

interface CorporateLedgerEntry {
  amount: number;
  bookingId?: number | null;
  canceledAt?: string | null;
  canceledBy?: CorporateActor | null;
  cancelReason?: string | null;
  category?: string | null;
  clientId?: number | null;
  clientName?: string | null;
  comment?: string | null;
  corporateClientId: number;
  createdAt: string;
  createdBy?: CorporateActor | null;
  date: string;
  finance?: FinanceRecord | null;
  financeCreatedByLedger: boolean;
  financeId?: number | null;
  id: number;
  participantName?: string | null;
  runningBalance?: number | null;
  service?: string | null;
  signedAmount?: number | null;
  status: LedgerEntryStatus;
  trainingNoteId?: number | null;
  type: LedgerEntryType;
  visitId?: number | null;
}

interface CorporateClient {
  archivedAt?: string | null;
  archiveReason?: string | null;
  balance: number;
  comment?: string | null;
  contactEmail?: string | null;
  contactName?: string | null;
  contactPhone?: string | null;
  createdAt: string;
  id: number;
  ledgerEntries?: CorporateLedgerEntry[];
  name: string;
  status: CorporateClientStatus;
}

type ClientFormState = {
  comment: string;
  contactEmail: string;
  contactName: string;
  contactPhone: string;
  name: string;
};

type DepositFormState = {
  amount: string;
  category: string;
  comment: string;
  date: string;
  financeId: string;
};

type SpendingFormState = {
  amount: string;
  bookingId: string;
  clientId: string;
  comment: string;
  date: string;
  participantName: string;
  service: string;
  trainingNoteId: string;
  visitId: string;
};

type PendingAction = ConfirmAction & {
  onConfirm: () => Promise<void>;
};

const STATUS_LABELS: Record<CorporateClientStatus | 'all', string> = {
  active: 'Активные',
  all: 'Все',
  archived: 'Архив',
};

const LEDGER_STATUS_LABELS: Record<LedgerEntryStatus, string> = {
  active: 'Активно',
  canceled: 'Отменено',
};

const LEDGER_TYPE_LABELS: Record<LedgerEntryType, string> = {
  deposit: 'Пополнение',
  spending: 'Списание',
};

const emptyClientForm: ClientFormState = {
  comment: '',
  contactEmail: '',
  contactName: '',
  contactPhone: '',
  name: '',
};

const today = new Date().toISOString().slice(0, 10);

const emptyDepositForm: DepositFormState = {
  amount: '',
  category: '',
  comment: '',
  date: today,
  financeId: '',
};

const emptySpendingForm: SpendingFormState = {
  amount: '',
  bookingId: '',
  clientId: '',
  comment: '',
  date: today,
  participantName: '',
  service: '',
  trainingNoteId: '',
  visitId: '',
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

function getStatusVariant(status: CorporateClientStatus | LedgerEntryStatus) {
  if (status === 'active') return 'default';
  if (status === 'canceled') return 'secondary';
  return 'outline';
}

function clientToForm(client: CorporateClient | null): ClientFormState {
  if (!client) return emptyClientForm;
  return {
    comment: client.comment || '',
    contactEmail: client.contactEmail || '',
    contactName: client.contactName || '',
    contactPhone: client.contactPhone || '',
    name: client.name,
  };
}

export default function CorporateClientsPage() {
  const { account } = useAuth();
  const [searchParams] = useSearchParams();
  const canManage = canManageCorporateDeposits(account?.role);
  const canExport = canExportFinance(account?.role);
  const [clients, setClients] = useState<CorporateClient[]>([]);
  const [selectedClient, setSelectedClient] = useState<CorporateClient | null>(null);
  const [selectedClientId, setSelectedClientId] = useState<number | null>(null);
  const [categories, setCategories] = useState<CatalogCategory[]>([]);
  const [searchInput, setSearchInput] = useState('');
  const [statusFilter, setStatusFilter] =
    useState<CorporateClientStatus | 'all'>('active');
  const [loading, setLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [errorText, setErrorText] = useState('');
  const [clientDialogOpen, setClientDialogOpen] = useState(false);
  const [clientDialogMode, setClientDialogMode] = useState<'create' | 'edit'>(
    'create',
  );
  const [clientSaving, setClientSaving] = useState(false);
  const [clientForm, setClientForm] = useState<ClientFormState>(emptyClientForm);
  const [depositDialogOpen, setDepositDialogOpen] = useState(false);
  const [depositSaving, setDepositSaving] = useState(false);
  const [depositMode, setDepositMode] = useState<DepositMode>('create');
  const [depositForm, setDepositForm] =
    useState<DepositFormState>(emptyDepositForm);
  const [spendingDialogOpen, setSpendingDialogOpen] = useState(false);
  const [spendingSaving, setSpendingSaving] = useState(false);
  const [spendingForm, setSpendingForm] =
    useState<SpendingFormState>(emptySpendingForm);
  const [ledgerFrom, setLedgerFrom] = useState('');
  const [ledgerTo, setLedgerTo] = useState('');
  const [ledgerExporting, setLedgerExporting] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [pendingActionLoading, setPendingActionLoading] = useState(false);

  const incomeCategories = useMemo(
    () => categories.filter((category) => category.type === 'income'),
    [categories],
  );

  const loadCategories = useCallback(async () => {
    try {
      const response = await apiFetch('/api/catalog/categories?status=active');
      if (!response.ok) return;
      const data = (await response.json()) as CatalogCategory[];
      setCategories(data);
      setDepositForm((current) => ({
        ...current,
        category:
          current.category ||
          data.find((category) => category.type === 'income')?.name ||
          '',
      }));
    } catch {
      setCategories([]);
    }
  }, []);

  const loadClients = useCallback(async () => {
    setLoading(true);
    setErrorText('');
    try {
      const params = new URLSearchParams();
      if (searchInput.trim()) params.set('q', searchInput.trim());
      if (statusFilter !== 'active') params.set('status', statusFilter);
      const suffix = params.toString() ? `?${params.toString()}` : '';
      const response = await apiFetch(`/api/corporate-clients${suffix}`);
      if (!response.ok) {
        const message = await readError(
          response,
          'Не удалось загрузить корпоративных клиентов',
        );
        setErrorText(message);
        return;
      }
      const data = (await response.json()) as CorporateClient[];
      const requestedCompanyId = Number(searchParams.get('companyId') || 0);
      setClients(data);
      setSelectedClientId((currentId) => {
        if (
          requestedCompanyId &&
          data.some((client) => client.id === requestedCompanyId)
        ) {
          return requestedCompanyId;
        }
        if (currentId && data.some((client) => client.id === currentId)) {
          return currentId;
        }
        return data[0]?.id || null;
      });
      if (data.length === 0) setSelectedClient(null);
    } catch (error) {
      setErrorText(
        getApiErrorMessage(error, 'Не удалось загрузить корпоративных клиентов'),
      );
    } finally {
      setLoading(false);
    }
  }, [searchInput, searchParams, statusFilter]);

  const getLedgerQuery = useCallback(() => {
    const params = new URLSearchParams();
    if (ledgerFrom) params.set('from', ledgerFrom);
    if (ledgerTo) params.set('to', ledgerTo);
    const query = params.toString();
    return query ? `?${query}` : '';
  }, [ledgerFrom, ledgerTo]);

  const loadClientDetail = useCallback(async (clientId: number) => {
    setDetailLoading(true);
    try {
      const response = await apiFetch(`/api/corporate-clients/${clientId}`);
      if (!response.ok) {
        toast.error(
          await readError(response, 'Не удалось загрузить карточку компании'),
        );
        return;
      }
      const detail = (await response.json()) as CorporateClient;
      const ledgerResponse = await apiFetch(
        `/api/corporate-clients/${clientId}/ledger${getLedgerQuery()}`,
      );
      if (ledgerResponse.ok) {
        detail.ledgerEntries =
          (await ledgerResponse.json()) as CorporateLedgerEntry[];
      }
      setSelectedClient(detail);
    } catch (error) {
      toast.error(
        getApiErrorMessage(error, 'Не удалось загрузить карточку компании'),
      );
    } finally {
      setDetailLoading(false);
    }
  }, [getLedgerQuery]);

  useEffect(() => {
    void loadCategories();
  }, [loadCategories]);

  useEffect(() => {
    void loadClients();
  }, [loadClients]);

  useEffect(() => {
    if (!selectedClientId) return;
    void loadClientDetail(selectedClientId);
  }, [loadClientDetail, selectedClientId]);

  const openCreateClientDialog = () => {
    setClientDialogMode('create');
    setClientForm(emptyClientForm);
    setClientDialogOpen(true);
  };

  const openEditClientDialog = () => {
    setClientDialogMode('edit');
    setClientForm(clientToForm(selectedClient));
    setClientDialogOpen(true);
  };

  const handleSaveClient = async () => {
    if (!clientForm.name.trim()) return;
    setClientSaving(true);
    try {
      const isEdit = clientDialogMode === 'edit' && selectedClient;
      const response = await apiFetch(
        isEdit
          ? `/api/corporate-clients/${selectedClient.id}`
          : '/api/corporate-clients',
        {
          body: JSON.stringify(clientForm),
          method: isEdit ? 'PUT' : 'POST',
        },
      );
      if (!response.ok) {
        toast.error(
          await readError(response, 'Не удалось сохранить корпоративного клиента'),
        );
        return;
      }

      const saved = (await response.json()) as CorporateClient;
      setSelectedClient(saved);
      setSelectedClientId(saved.id);
      setClientDialogOpen(false);
      await loadClients();
      toast.success(isEdit ? 'Компания обновлена' : 'Компания создана');
    } catch (error) {
      toast.error(
        getApiErrorMessage(error, 'Не удалось сохранить корпоративного клиента'),
      );
    } finally {
      setClientSaving(false);
    }
  };

  const openDepositDialog = () => {
    setDepositMode('create');
    setDepositForm({
      ...emptyDepositForm,
      category: incomeCategories[0]?.name || '',
      date: today,
    });
    setDepositDialogOpen(true);
  };

  const openSpendingDialog = () => {
    setSpendingForm({
      ...emptySpendingForm,
      date: today,
    });
    setSpendingDialogOpen(true);
  };

  const handleCreateDeposit = async () => {
    if (!selectedClient) return;
    setDepositSaving(true);
    try {
      const body =
        depositMode === 'link'
          ? {
              comment: depositForm.comment,
              financeId: depositForm.financeId,
            }
          : {
              amount: depositForm.amount,
              category: depositForm.category,
              comment: depositForm.comment,
              date: depositForm.date,
            };

      const response = await apiFetch(
        `/api/corporate-clients/${selectedClient.id}/deposits`,
        {
          body: JSON.stringify(body),
          method: 'POST',
        },
      );
      if (!response.ok) {
        toast.error(await readError(response, 'Не удалось пополнить баланс'));
        return;
      }

      const data = (await response.json()) as {
        corporateClient: CorporateClient;
      };
      setSelectedClient(data.corporateClient);
      setDepositDialogOpen(false);
      await loadClients();
      await loadClientDetail(selectedClient.id);
      toast.success('Баланс пополнен');
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'Не удалось пополнить баланс'));
    } finally {
      setDepositSaving(false);
    }
  };

  const handleCreateSpending = async () => {
    if (!selectedClient) return;
    setSpendingSaving(true);
    try {
      const body = {
        amount: spendingForm.amount,
        bookingId: spendingForm.bookingId,
        clientId: spendingForm.clientId,
        comment: spendingForm.comment,
        date: spendingForm.date,
        participantName: spendingForm.participantName,
        service: spendingForm.service,
        trainingNoteId: spendingForm.trainingNoteId,
        visitId: spendingForm.visitId,
      };
      const response = await apiFetch(
        `/api/corporate-clients/${selectedClient.id}/spendings`,
        {
          body: JSON.stringify(body),
          method: 'POST',
        },
      );
      if (!response.ok) {
        toast.error(await readError(response, 'Не удалось списать с баланса'));
        return;
      }

      const data = (await response.json()) as {
        corporateClient: CorporateClient;
      };
      setSelectedClient(data.corporateClient);
      setSpendingDialogOpen(false);
      await loadClients();
      await loadClientDetail(selectedClient.id);
      toast.success('Списание сохранено');
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'Не удалось списать с баланса'));
    } finally {
      setSpendingSaving(false);
    }
  };

  const handleExportLedger = async () => {
    if (!selectedClient) return;
    setLedgerExporting(true);
    try {
      const response = await apiFetch(
        `/api/corporate-clients/${selectedClient.id}/ledger/export${getLedgerQuery()}`,
      );
      if (!response.ok) {
        toast.error(await readError(response, 'Не удалось выгрузить детализацию'));
        return;
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `corporate-${selectedClient.id}-${ledgerFrom || 'start'}-${ledgerTo || 'end'}.xlsx`;
      link.click();
      URL.revokeObjectURL(url);
      toast.success('Детализация выгружена');
    } catch (error) {
      toast.error(
        getApiErrorMessage(error, 'Не удалось выгрузить детализацию'),
      );
    } finally {
      setLedgerExporting(false);
    }
  };

  const requestArchive = () => {
    if (!selectedClient) return;
    setPendingAction({
      confirmLabel: 'В архив',
      description: selectedClient.name,
      isDestructive: true,
      title: 'Архивировать компанию?',
      onConfirm: async () => {
        const response = await apiFetch(
          `/api/corporate-clients/${selectedClient.id}/archive`,
          {
            body: JSON.stringify({ reason: 'Архивировано вручную' }),
            method: 'POST',
          },
        );
        if (!response.ok) {
          toast.error(await readError(response, 'Не удалось архивировать'));
          return;
        }
        const data = (await response.json()) as CorporateClient;
        setSelectedClient(data);
        await loadClients();
        toast.success('Компания в архиве');
      },
    });
  };

  const requestRestore = () => {
    if (!selectedClient) return;
    setPendingAction({
      confirmLabel: 'Восстановить',
      description: selectedClient.name,
      title: 'Восстановить компанию?',
      onConfirm: async () => {
        const response = await apiFetch(
          `/api/corporate-clients/${selectedClient.id}/restore`,
          {
            method: 'POST',
          },
        );
        if (!response.ok) {
          toast.error(await readError(response, 'Не удалось восстановить'));
          return;
        }
        const data = (await response.json()) as CorporateClient;
        setSelectedClient(data);
        await loadClients();
        toast.success('Компания восстановлена');
      },
    });
  };

  const requestCancelDeposit = useCallback(
    (entry: CorporateLedgerEntry, corporateClientId: number) => {
      setPendingAction({
        confirmLabel: 'Отменить',
        description: `${formatDate(entry.date)} · ${formatMoney(entry.amount)}`,
        isDestructive: true,
        title: 'Отменить пополнение?',
        onConfirm: async () => {
          const response = await apiFetch(
            `/api/corporate-clients/${corporateClientId}/deposits/${entry.id}/cancel`,
            {
              body: JSON.stringify({ reason: 'Отменено вручную' }),
              method: 'POST',
            },
          );
          if (!response.ok) {
            toast.error(await readError(response, 'Не удалось отменить пополнение'));
            return;
          }
          const data = (await response.json()) as {
            corporateClient: CorporateClient;
          };
          setSelectedClient(data.corporateClient);
          await loadClients();
          await loadClientDetail(corporateClientId);
          toast.success('Пополнение отменено');
        },
      });
    },
    [loadClientDetail, loadClients],
  );

  const requestReverseSpending = useCallback(
    (entry: CorporateLedgerEntry, corporateClientId: number) => {
      setPendingAction({
        confirmLabel: 'Отменить',
        description: `${formatDate(entry.date)} · ${entry.service || 'Списание'} · ${formatMoney(entry.amount)}`,
        isDestructive: true,
        title: 'Отменить списание?',
        onConfirm: async () => {
          const response = await apiFetch(
            `/api/corporate-clients/${corporateClientId}/spendings/${entry.id}/reverse`,
            {
              body: JSON.stringify({ reason: 'Отменено вручную' }),
              method: 'POST',
            },
          );
          if (!response.ok) {
            toast.error(await readError(response, 'Не удалось отменить списание'));
            return;
          }
          const data = (await response.json()) as {
            corporateClient: CorporateClient;
          };
          setSelectedClient(data.corporateClient);
          await loadClients();
          await loadClientDetail(corporateClientId);
          toast.success('Списание отменено');
        },
      });
    },
    [loadClientDetail, loadClients],
  );

  const columns = useMemo<ColumnDef<CorporateClient>[]>(
    () => [
      {
        accessorKey: 'name',
        header: 'Компания',
        size: 220,
        cell: ({ row }) => (
          <div className="min-w-0">
            <div className="truncate font-medium">{row.original.name}</div>
            <div className="truncate text-xs text-muted-foreground">
              {row.original.contactName || row.original.contactPhone || '-'}
            </div>
          </div>
        ),
      },
      {
        accessorKey: 'balance',
        header: 'Баланс',
        size: 140,
        cell: ({ row }) => (
          <span className="font-semibold">{formatMoney(row.original.balance)}</span>
        ),
      },
      {
        id: 'contact',
        header: 'Контакт',
        size: 180,
        cell: ({ row }) => (
          <div className="min-w-0 text-sm">
            <div className="truncate">{row.original.contactPhone || '-'}</div>
            <div className="truncate text-xs text-muted-foreground">
              {row.original.contactEmail || '-'}
            </div>
          </div>
        ),
      },
      {
        accessorKey: 'status',
        header: 'Статус',
        size: 120,
        cell: ({ row }) => (
          <Badge variant={getStatusVariant(row.original.status)}>
            {STATUS_LABELS[row.original.status]}
          </Badge>
        ),
      },
    ],
    [],
  );

  const ledgerColumns = useMemo<ColumnDef<CorporateLedgerEntry>[]>(
    () => [
      {
        accessorKey: 'date',
        header: 'Дата',
        size: 110,
        cell: ({ row }) => formatDate(row.original.date),
      },
      {
        accessorKey: 'type',
        header: 'Тип',
        size: 130,
        cell: ({ row }) => LEDGER_TYPE_LABELS[row.original.type],
      },
      {
        accessorKey: 'amount',
        header: 'Сумма',
        size: 130,
        cell: ({ row }) => (
          <span className="font-medium">
            {formatMoney(row.original.signedAmount ?? row.original.amount)}
          </span>
        ),
      },
      {
        id: 'service',
        header: 'Услуга / участник',
        size: 220,
        cell: ({ row }) => (
          <div className="min-w-0 text-sm">
            <div className="truncate">
              {row.original.service ||
                (row.original.type === 'deposit' ? 'Пополнение' : '-')}
            </div>
            <div className="truncate text-xs text-muted-foreground">
              {row.original.participantName || row.original.clientName || '-'}
            </div>
          </div>
        ),
      },
      {
        id: 'finance',
        header: 'Finance',
        size: 140,
        cell: ({ row }) => (
          <div className="min-w-0 text-sm">
            <div className="truncate">
              {row.original.financeId ? `#${row.original.financeId}` : '-'}
            </div>
            <div className="truncate text-xs text-muted-foreground">
              {row.original.category || row.original.finance?.category || '-'}
            </div>
          </div>
        ),
      },
      {
        accessorKey: 'runningBalance',
        header: 'Остаток',
        size: 130,
        cell: ({ row }) =>
          row.original.runningBalance === null ||
          row.original.runningBalance === undefined
            ? '-'
            : formatMoney(row.original.runningBalance),
      },
      {
        accessorKey: 'status',
        header: 'Статус',
        size: 120,
        cell: ({ row }) => (
          <Badge variant={getStatusVariant(row.original.status)}>
            {LEDGER_STATUS_LABELS[row.original.status]}
          </Badge>
        ),
      },
      {
        id: 'actions',
        header: '',
        size: 96,
        cell: ({ row }) => {
          const corporateClientId = selectedClient?.id;
          const canCancel =
            canManage &&
            Boolean(corporateClientId) &&
            row.original.status === 'active';

          return canCancel && corporateClientId ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={(event) => {
                event.stopPropagation();
                if (row.original.type === 'deposit') {
                  requestCancelDeposit(row.original, corporateClientId);
                } else {
                  requestReverseSpending(row.original, corporateClientId);
                }
              }}
            >
              <RotateCcw className="mr-2 h-4 w-4" />
              Отмена
            </Button>
          ) : null;
        },
      },
    ],
    [canManage, requestCancelDeposit, requestReverseSpending, selectedClient?.id],
  );

  const activeClients = clients.filter((client) => client.status === 'active');
  const totalBalance = clients.reduce(
    (sum, client) => sum + Number(client.balance || 0),
    0,
  );
  const ledgerEntries = selectedClient?.ledgerEntries || [];
  const canSubmitDeposit =
    depositMode === 'link'
      ? Boolean(depositForm.financeId)
      : Boolean(
          depositForm.amount &&
            Number(depositForm.amount) > 0 &&
            depositForm.category &&
            depositForm.date,
        );
  const canSubmitSpending = Boolean(
    spendingForm.amount &&
      Number(spendingForm.amount) > 0 &&
      spendingForm.date &&
      spendingForm.service.trim(),
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Корпоративные клиенты
          </h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => void loadClients()}
            disabled={loading}
          >
            <RefreshCw className="mr-2 h-4 w-4" />
            Обновить
          </Button>
          {canManage && (
            <Button type="button" onClick={openCreateClientDialog}>
              <Plus className="mr-2 h-4 w-4" />
              Компания
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <div className="flex size-10 items-center justify-center rounded-md bg-primary/10 text-primary">
              <Wallet className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <div className="text-sm text-muted-foreground">Общий баланс</div>
              <div className="truncate text-xl font-semibold">
                {formatMoney(totalBalance)}
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <div className="flex size-10 items-center justify-center rounded-md bg-primary/10 text-primary">
              <Building2 className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <div className="text-sm text-muted-foreground">Активные компании</div>
              <div className="truncate text-xl font-semibold">
                {activeClients.length}
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <div className="flex size-10 items-center justify-center rounded-md bg-primary/10 text-primary">
              <Landmark className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <div className="text-sm text-muted-foreground">Выбрано</div>
              <div className="truncate text-xl font-semibold">
                {selectedClient ? formatMoney(selectedClient.balance) : '-'}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_430px]">
        <Card>
          <CardHeader className="gap-4">
            <CardTitle className="flex items-center gap-2 text-base">
              <Building2 className="h-5 w-5" />
              Реестр
            </CardTitle>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1fr)_180px]">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={searchInput}
                  onChange={(event) => setSearchInput(event.target.value)}
                  placeholder="Название, контакт, телефон"
                  className="pl-9"
                />
              </div>
              <Select
                value={statusFilter}
                onValueChange={(value) =>
                  setStatusFilter(value as CorporateClientStatus | 'all')
                }
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
            </div>
          </CardHeader>
          <CardContent>
            <DataTable
              columns={columns}
              data={clients}
              emptyText="Корпоративных клиентов пока нет."
              errorText={errorText}
              getRowClassName={(row) =>
                row.original.id === selectedClientId ? 'bg-primary/5' : undefined
              }
              getRowProps={(row) => ({
                className: 'cursor-pointer',
                onClick: () => setSelectedClientId(row.original.id),
              })}
              loading={loading}
              minWidthClassName="min-w-[700px]"
              onRetry={() => void loadClients()}
              pageSize={10}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Landmark className="h-5 w-5" />
              Карточка
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            {!selectedClient && !detailLoading && (
              <div className="rounded-md border border-dashed p-6 text-sm text-muted-foreground">
                Компания не выбрана.
              </div>
            )}
            {detailLoading && (
              <div className="rounded-md border border-dashed p-6 text-sm text-muted-foreground">
                Загрузка...
              </div>
            )}
            {selectedClient && !detailLoading && (
              <>
                <div className="space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-lg font-semibold">
                        {selectedClient.name}
                      </div>
                      <div className="text-sm text-muted-foreground">
                        {selectedClient.contactName || 'Контакт не указан'}
                      </div>
                    </div>
                    <Badge variant={getStatusVariant(selectedClient.status)}>
                      {STATUS_LABELS[selectedClient.status]}
                    </Badge>
                  </div>
                  <div className="rounded-md border p-4">
                    <div className="text-xs text-muted-foreground">Баланс</div>
                    <div className="mt-1 text-2xl font-semibold">
                      {formatMoney(selectedClient.balance)}
                    </div>
                  </div>
                  <div className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
                    <div className="rounded-md border p-3">
                      <div className="text-xs text-muted-foreground">Телефон</div>
                      <div className="mt-1 font-medium">
                        {selectedClient.contactPhone || '-'}
                      </div>
                    </div>
                    <div className="rounded-md border p-3">
                      <div className="text-xs text-muted-foreground">Email</div>
                      <div className="mt-1 truncate font-medium">
                        {selectedClient.contactEmail || '-'}
                      </div>
                    </div>
                  </div>
                  {selectedClient.comment && (
                    <div className="rounded-md border p-3 text-sm text-muted-foreground">
                      {selectedClient.comment}
                    </div>
                  )}
                </div>

                {canManage && (
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <Button type="button" onClick={openDepositDialog}>
                      <Plus className="mr-2 h-4 w-4" />
                      Пополнить
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={openSpendingDialog}
                    >
                      <MinusCircle className="mr-2 h-4 w-4" />
                      Списать
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={openEditClientDialog}
                    >
                      <Pencil className="mr-2 h-4 w-4" />
                      Изменить
                    </Button>
                    {selectedClient.status === 'active' ? (
                      <Button
                        type="button"
                        variant="outline"
                        onClick={requestArchive}
                      >
                        <Archive className="mr-2 h-4 w-4" />
                        В архив
                      </Button>
                    ) : (
                      <Button
                        type="button"
                        variant="outline"
                        onClick={requestRestore}
                      >
                        <ArchiveRestore className="mr-2 h-4 w-4" />
                        Восстановить
                      </Button>
                    )}
                  </div>
                )}

                <div className="space-y-3">
                  <div className="flex flex-col gap-3">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <History className="h-4 w-4" />
                      История баланса
                    </div>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <div className="space-y-1">
                        <Label htmlFor="corporate-ledger-from">С</Label>
                        <Input
                          id="corporate-ledger-from"
                          type="date"
                          value={ledgerFrom}
                          onChange={(event) => setLedgerFrom(event.target.value)}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor="corporate-ledger-to">По</Label>
                        <Input
                          id="corporate-ledger-to"
                          type="date"
                          value={ledgerTo}
                          onChange={(event) => setLedgerTo(event.target.value)}
                        />
                      </div>
                    </div>
                    {canExport && (
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => void handleExportLedger()}
                        disabled={ledgerExporting}
                      >
                        <Download className="mr-2 h-4 w-4" />
                        {ledgerExporting ? 'Выгружаем...' : 'Excel'}
                      </Button>
                    )}
                  </div>
                  <DataTable
                    columns={ledgerColumns}
                    data={ledgerEntries}
                    emptyText="Операций пока нет."
                    minWidthClassName="min-w-[980px]"
                    pageSize={6}
                  />
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog
        open={clientDialogOpen}
        onOpenChange={(open) => {
          if (!open && !clientSaving) setClientDialogOpen(false);
        }}
      >
        <DialogContent className="sm:max-w-[560px]">
          <DialogHeader>
            <DialogTitle>
              {clientDialogMode === 'create'
                ? 'Новая компания'
                : 'Изменить компанию'}
            </DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="corporate-name">Название</Label>
              <Input
                id="corporate-name"
                value={clientForm.name}
                onChange={(event) =>
                  setClientForm((current) => ({
                    ...current,
                    name: event.target.value,
                  }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="corporate-contact-name">Контакт</Label>
              <Input
                id="corporate-contact-name"
                value={clientForm.contactName}
                onChange={(event) =>
                  setClientForm((current) => ({
                    ...current,
                    contactName: event.target.value,
                  }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="corporate-phone">Телефон</Label>
              <Input
                id="corporate-phone"
                value={clientForm.contactPhone}
                onChange={(event) =>
                  setClientForm((current) => ({
                    ...current,
                    contactPhone: event.target.value,
                  }))
                }
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="corporate-email">Email</Label>
              <Input
                id="corporate-email"
                type="email"
                value={clientForm.contactEmail}
                onChange={(event) =>
                  setClientForm((current) => ({
                    ...current,
                    contactEmail: event.target.value,
                  }))
                }
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="corporate-comment">Комментарий</Label>
              <Input
                id="corporate-comment"
                value={clientForm.comment}
                onChange={(event) =>
                  setClientForm((current) => ({
                    ...current,
                    comment: event.target.value,
                  }))
                }
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setClientDialogOpen(false)}
              disabled={clientSaving}
            >
              Отмена
            </Button>
            <Button
              type="button"
              onClick={() => void handleSaveClient()}
              disabled={clientSaving || !clientForm.name.trim()}
            >
              {clientSaving ? 'Сохраняем...' : 'Сохранить'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={depositDialogOpen}
        onOpenChange={(open) => {
          if (!open && !depositSaving) setDepositDialogOpen(false);
        }}
      >
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>Пополнить баланс</DialogTitle>
            <DialogDescription>{selectedClient?.name}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="corporate-deposit-mode">Источник</Label>
              <Select
                value={depositMode}
                onValueChange={(value) => setDepositMode(value as DepositMode)}
              >
                <SelectTrigger id="corporate-deposit-mode">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="create">Создать доход</SelectItem>
                  <SelectItem value="link">Связать доход #ID</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {depositMode === 'link' ? (
              <div className="space-y-2">
                <Label htmlFor="corporate-finance-id">Finance ID</Label>
                <div className="relative">
                  <Link2 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="corporate-finance-id"
                    className="pl-9"
                    type="number"
                    min="1"
                    value={depositForm.financeId}
                    onChange={(event) =>
                      setDepositForm((current) => ({
                        ...current,
                        financeId: event.target.value,
                      }))
                    }
                  />
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="corporate-deposit-date">Дата</Label>
                  <Input
                    id="corporate-deposit-date"
                    type="date"
                    value={depositForm.date}
                    onChange={(event) =>
                      setDepositForm((current) => ({
                        ...current,
                        date: event.target.value,
                      }))
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="corporate-deposit-amount">Сумма</Label>
                  <Input
                    id="corporate-deposit-amount"
                    type="number"
                    min="1"
                    step="1"
                    value={depositForm.amount}
                    onChange={(event) =>
                      setDepositForm((current) => ({
                        ...current,
                        amount: event.target.value,
                      }))
                    }
                  />
                </div>
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="corporate-deposit-category">Категория</Label>
                  <Select
                    value={depositForm.category}
                    onValueChange={(value) =>
                      setDepositForm((current) => ({
                        ...current,
                        category: value,
                      }))
                    }
                  >
                    <SelectTrigger id="corporate-deposit-category">
                      <SelectValue placeholder="Выберите категорию" />
                    </SelectTrigger>
                    <SelectContent>
                      {incomeCategories.map((category) => (
                        <SelectItem key={category.id} value={category.name}>
                          {category.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="corporate-deposit-comment">Комментарий</Label>
              <Input
                id="corporate-deposit-comment"
                value={depositForm.comment}
                onChange={(event) =>
                  setDepositForm((current) => ({
                    ...current,
                    comment: event.target.value,
                  }))
                }
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setDepositDialogOpen(false)}
              disabled={depositSaving}
            >
              Отмена
            </Button>
            <Button
              type="button"
              onClick={() => void handleCreateDeposit()}
              disabled={depositSaving || !canSubmitDeposit}
            >
              {depositSaving ? 'Сохраняем...' : 'Пополнить'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={spendingDialogOpen}
        onOpenChange={(open) => {
          if (!open && !spendingSaving) setSpendingDialogOpen(false);
        }}
      >
        <DialogContent className="sm:max-w-[560px]">
          <DialogHeader>
            <DialogTitle>Списать с баланса</DialogTitle>
            <DialogDescription>{selectedClient?.name}</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="corporate-spending-date">Дата</Label>
              <Input
                id="corporate-spending-date"
                type="date"
                value={spendingForm.date}
                onChange={(event) =>
                  setSpendingForm((current) => ({
                    ...current,
                    date: event.target.value,
                  }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="corporate-spending-amount">Сумма</Label>
              <Input
                id="corporate-spending-amount"
                type="number"
                min="1"
                step="1"
                value={spendingForm.amount}
                onChange={(event) =>
                  setSpendingForm((current) => ({
                    ...current,
                    amount: event.target.value,
                  }))
                }
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="corporate-spending-service">Услуга</Label>
              <Input
                id="corporate-spending-service"
                value={spendingForm.service}
                onChange={(event) =>
                  setSpendingForm((current) => ({
                    ...current,
                    service: event.target.value,
                  }))
                }
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="corporate-spending-participant">
                Участник / клиент
              </Label>
              <Input
                id="corporate-spending-participant"
                value={spendingForm.participantName}
                onChange={(event) =>
                  setSpendingForm((current) => ({
                    ...current,
                    participantName: event.target.value,
                  }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="corporate-spending-client-id">Client ID</Label>
              <Input
                id="corporate-spending-client-id"
                type="number"
                min="1"
                value={spendingForm.clientId}
                onChange={(event) =>
                  setSpendingForm((current) => ({
                    ...current,
                    clientId: event.target.value,
                  }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="corporate-spending-booking-id">Booking ID</Label>
              <Input
                id="corporate-spending-booking-id"
                type="number"
                min="1"
                value={spendingForm.bookingId}
                onChange={(event) =>
                  setSpendingForm((current) => ({
                    ...current,
                    bookingId: event.target.value,
                  }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="corporate-spending-visit-id">Visit ID</Label>
              <Input
                id="corporate-spending-visit-id"
                type="number"
                min="1"
                value={spendingForm.visitId}
                onChange={(event) =>
                  setSpendingForm((current) => ({
                    ...current,
                    visitId: event.target.value,
                  }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="corporate-spending-note-id">Training note ID</Label>
              <Input
                id="corporate-spending-note-id"
                type="number"
                min="1"
                value={spendingForm.trainingNoteId}
                onChange={(event) =>
                  setSpendingForm((current) => ({
                    ...current,
                    trainingNoteId: event.target.value,
                  }))
                }
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="corporate-spending-comment">Комментарий</Label>
              <Input
                id="corporate-spending-comment"
                value={spendingForm.comment}
                onChange={(event) =>
                  setSpendingForm((current) => ({
                    ...current,
                    comment: event.target.value,
                  }))
                }
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setSpendingDialogOpen(false)}
              disabled={spendingSaving}
            >
              Отмена
            </Button>
            <Button
              type="button"
              onClick={() => void handleCreateSpending()}
              disabled={spendingSaving || !canSubmitSpending}
            >
              {spendingSaving ? 'Сохраняем...' : 'Списать'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmActionDialog
        action={pendingAction}
        loading={pendingActionLoading}
        onCancel={() => setPendingAction(null)}
        onConfirm={async () => {
          if (!pendingAction) return;
          setPendingActionLoading(true);
          try {
            await pendingAction.onConfirm();
            setPendingAction(null);
          } finally {
            setPendingActionLoading(false);
          }
        }}
      />
    </div>
  );
}
