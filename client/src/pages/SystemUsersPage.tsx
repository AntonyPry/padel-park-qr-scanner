import { useCallback, useEffect, useMemo, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import type { ColumnDef } from '@tanstack/react-table';
import {
  Archive,
  ArchiveRestore,
  Pencil,
  Plus,
  Save,
  Search,
  Trash2,
  UserCog,
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { DataTable } from '@/components/data-table';
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
  PermissionActionButton,
} from '@/components/permission-feedback';
import {
  permissionMessages,
  showPermissionDenied,
} from '@/lib/permission-feedback';
import { apiFetch, getApiErrorMessage } from '@/lib/api';
import {
  ACCOUNT_ROLES,
  getAccountRoleDescription,
  getAccountRoleLabel,
  type AccountRole,
} from '@/lib/roles';
import { useAuthorizationRole } from '@/lib/useAuth';
import { useRealtimeRefresh } from '@/lib/realtime';

type AccountStatus = 'active' | 'inactive' | 'archived';

interface StaffOption {
  id: number;
  name: string;
  position?: string;
  role: string;
  phone?: string | null;
  status: string;
}

interface SystemAccount {
  id: number;
  email: string;
  role: AccountRole;
  status: AccountStatus;
  staffId?: number | null;
  lastLoginAt?: string | null;
  createdAt?: string | null;
  Staff?: StaffOption | null;
}

type PendingAction = ConfirmAction & {
  onConfirm: () => Promise<void>;
};

const MANAGER_MANAGED_ROLES: AccountRole[] = [
  'admin',
  'accountant',
  'viewer',
  'trainer',
];
const accountFormSchema = z.object({
  email: z.string().trim().email('Введите корректный email'),
  password: z
    .string()
    .optional()
    .refine((value) => !value || value.length >= 6, {
      message: 'Минимум 6 символов',
    }),
  role: z.enum(['owner', 'manager', 'admin', 'accountant', 'viewer', 'trainer']),
  staffId: z.string(),
  status: z.enum(['active', 'inactive', 'archived']),
});
type AccountFormState = z.infer<typeof accountFormSchema>;

const EMPTY_FORM: AccountFormState = {
  email: '',
  password: '',
  role: 'admin',
  staffId: 'none',
  status: 'active',
};

async function readError(response: Response, fallback: string) {
  try {
    const data = (await response.json()) as { error?: string };
    return data.error || fallback;
  } catch {
    return fallback;
  }
}

function formatDateTime(value?: string | null) {
  if (!value) return '-';

  return new Intl.DateTimeFormat('ru-RU', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value));
}

function getStaffPosition(staff: StaffOption) {
  return staff.position || staff.role || '-';
}

export default function SystemUsersPage() {
  const organizationRole = useAuthorizationRole('organization');
  const [accounts, setAccounts] = useState<SystemAccount[]>([]);
  const [staff, setStaff] = useState<StaffOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState<SystemAccount | null>(
    null,
  );
  const [accountStatus, setAccountStatus] = useState<
    'active' | 'archived' | 'all'
  >('active');
  const [accountSearch, setAccountSearch] = useState('');
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [pendingActionLoading, setPendingActionLoading] = useState(false);
  const accountForm = useForm<AccountFormState>({
    defaultValues: EMPTY_FORM,
    resolver: zodResolver(accountFormSchema),
  });
  const selectedRole = accountForm.watch('role');
  const selectedStaffId = accountForm.watch('staffId');
  const selectedStatus = accountForm.watch('status');

  const availableRoles = useMemo(() => {
    if (organizationRole === 'owner') return ACCOUNT_ROLES;
    return ACCOUNT_ROLES.filter((role) =>
      MANAGER_MANAGED_ROLES.includes(role.value),
    );
  }, [organizationRole]);

  const linkedStaffIds = useMemo(() => {
    return new Set(
      accounts
        .filter((item) => item.id !== editingAccount?.id && item.staffId)
        .map((item) => Number(item.staffId)),
    );
  }, [accounts, editingAccount?.id]);

  const staffOptions = useMemo(
    () =>
      staff.filter(
        (item) =>
          !linkedStaffIds.has(item.id) &&
          (item.status === 'active' || item.id === editingAccount?.staffId),
      ),
    [editingAccount?.staffId, linkedStaffIds, staff],
  );
  const displayedAccounts = useMemo(() => {
    const filteredByStatus =
      accountStatus === 'all'
        ? accounts
        : accounts.filter((item) => item.status === accountStatus);
    const query = accountSearch.trim().toLowerCase();

    if (!query) return filteredByStatus;

    return filteredByStatus.filter((item) =>
      [
        item.email,
        getAccountRoleLabel(item.role),
        item.Staff?.name,
        item.Staff?.position,
        item.Staff?.role,
        item.Staff?.phone,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query)),
    );
  }, [accountSearch, accountStatus, accounts]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const [accountsRes, staffRes] = await Promise.all([
        apiFetch('/api/accounts'),
        apiFetch('/api/staff'),
      ]);

      if (accountsRes.ok) {
        setAccounts((await accountsRes.json()) as SystemAccount[]);
      } else {
        setLoadError(await readError(accountsRes, 'Не удалось загрузить пользователей'));
      }
      if (staffRes.ok) {
        setStaff((await staffRes.json()) as StaffOption[]);
      } else {
        setLoadError((current) =>
          current || 'Не удалось загрузить сотрудников для привязки',
        );
      }
    } catch (error) {
      setLoadError(getApiErrorMessage(error, 'Не удалось загрузить пользователей'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  useRealtimeRefresh(['accounts', 'staff'], () => {
    void fetchData();
  });

  const canManageAccount = (target: SystemAccount) => {
    if (organizationRole === 'owner') return true;
    return Boolean(
      organizationRole === 'manager' &&
        MANAGER_MANAGED_ROLES.includes(target.role),
    );
  };

  const openCreate = () => {
    setEditingAccount(null);
    accountForm.reset({
      ...EMPTY_FORM,
      role: availableRoles[0]?.value || 'admin',
    });
    setIsModalOpen(true);
  };

  const openEdit = (target: SystemAccount) => {
    if (!canManageAccount(target)) {
      showPermissionDenied(permissionMessages.systemUsersRestricted);
      return;
    }

    setEditingAccount(target);
    accountForm.reset({
      email: target.email,
      password: '',
      role: target.role,
      staffId: target.staffId ? String(target.staffId) : 'none',
      status: target.status,
    });
    setIsModalOpen(true);
  };

  const saveAccount = async (
    values: AccountFormState,
    target: SystemAccount | null,
  ) => {
    if (target && !canManageAccount(target)) {
      showPermissionDenied(permissionMessages.systemUsersRestricted);
      return;
    }
    if (
      organizationRole === 'manager' &&
      !MANAGER_MANAGED_ROLES.includes(values.role)
    ) {
      showPermissionDenied(permissionMessages.systemUsersRestricted);
      return;
    }

    const payload = {
      email: values.email.trim(),
      password: values.password || undefined,
      role: values.role,
      staffId: values.staffId === 'none' ? null : Number(values.staffId),
      status: values.status,
    };

    const response = await apiFetch(
      target ? `/api/accounts/${target.id}` : '/api/accounts',
      {
        method: target ? 'PUT' : 'POST',
        body: JSON.stringify(payload),
      },
    );

    if (!response.ok) {
      toast.error(await readError(response, 'Не удалось сохранить пользователя'));
      return;
    }

    const saved = (await response.json()) as SystemAccount;
    setAccounts((prev) =>
      target
        ? prev.map((item) => (item.id === saved.id ? saved : item))
        : [saved, ...prev],
    );
    setIsModalOpen(false);
    toast.success(target ? 'Пользователь обновлен' : 'Пользователь создан');
  };

  const handleSave = accountForm.handleSubmit(async (values) => {
    if (!editingAccount && !values.password) {
      accountForm.setError('password', {
        message: 'Укажите пароль для нового пользователя',
        type: 'manual',
      });
      return;
    }

    const changesArchiveState =
      editingAccount &&
      values.status !== editingAccount.status &&
      (values.status === 'archived' || editingAccount.status === 'archived');

    if (changesArchiveState) {
      const target = editingAccount;
      const goesToArchive = values.status === 'archived';
      setPendingAction({
        confirmLabel: goesToArchive ? 'В архив' : 'Восстановить',
        description: goesToArchive
          ? `Пользователь ${target.email} не сможет войти в CRM. Остальные изменения формы тоже будут сохранены.`
          : `Пользователь ${target.email} снова сможет войти в CRM. Остальные изменения формы тоже будут сохранены.`,
        isDestructive: goesToArchive,
        onConfirm: () => saveAccount(values, target),
        title: goesToArchive
          ? 'Архивировать пользователя?'
          : 'Восстановить пользователя?',
      });
      return;
    }

    await saveAccount(values, editingAccount);
  });

  const executeArchive = async (target: SystemAccount) => {
    if (!canManageAccount(target)) {
      showPermissionDenied(permissionMessages.systemUsersRestricted);
      return;
    }

    const response = await apiFetch(`/api/accounts/${target.id}`, {
      method: 'DELETE',
    });

    if (!response.ok) {
      toast.error(await readError(response, 'Не удалось отключить пользователя'));
      return;
    }

    const saved = (await response.json()) as SystemAccount;
    setAccounts((prev) =>
      prev.map((item) => (item.id === saved.id ? saved : item)),
    );
    toast.success('Пользователь отправлен в архив');
  };

  const executeRestore = async (target: SystemAccount) => {
    if (!canManageAccount(target)) {
      showPermissionDenied(permissionMessages.systemUsersRestricted);
      return;
    }

    const response = await apiFetch(`/api/accounts/${target.id}/restore`, {
      method: 'POST',
    });
    if (!response.ok) {
      toast.error(await readError(response, 'Не удалось восстановить пользователя'));
      return;
    }
    const saved = (await response.json()) as SystemAccount;
    setAccounts((prev) =>
      prev.map((item) => (item.id === saved.id ? saved : item)),
    );
    toast.success('Пользователь восстановлен');
  };

  const executePermanentDelete = async (target: SystemAccount) => {
    if (!canManageAccount(target)) {
      showPermissionDenied(permissionMessages.systemUsersRestricted);
      return;
    }

    const response = await apiFetch(`/api/accounts/${target.id}/permanent`, {
      method: 'DELETE',
    });
    if (!response.ok) {
      toast.error(await readError(response, 'Не удалось удалить пользователя из архива'));
      return;
    }
    setAccounts((prev) => prev.filter((item) => item.id !== target.id));
    toast.success('Пользователь удален из архива');
  };

  const requestArchive = (target: SystemAccount) => {
    if (!canManageAccount(target)) {
      showPermissionDenied(permissionMessages.systemUsersRestricted);
      return;
    }

    const isArchived = target.status === 'archived';
    setPendingAction({
      confirmLabel: isArchived ? 'Восстановить' : 'В архив',
      description: isArchived
        ? `Пользователь ${target.email} снова сможет войти в CRM.`
        : `Пользователь ${target.email} не сможет войти и будет перенесен в архив. История его действий сохранится.`,
      isDestructive: !isArchived,
      onConfirm: () => (isArchived ? executeRestore(target) : executeArchive(target)),
      title: isArchived ? 'Восстановить пользователя?' : 'Архивировать пользователя?',
    });
  };

  const requestPermanentDelete = (target: SystemAccount) => {
    if (!canManageAccount(target)) {
      showPermissionDenied(permissionMessages.systemUsersRestricted);
      return;
    }

    setPendingAction({
      confirmLabel: 'Удалить навсегда',
      description: `Пользователь ${target.email} будет удален без возможности восстановления. Сервер не даст удалить его, если есть связанные действия.`,
      isDestructive: true,
      onConfirm: () => executePermanentDelete(target),
      title: 'Удалить пользователя из архива?',
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

  const stats = useMemo(
    () => ({
      active: accounts.filter((item) => item.status === 'active').length,
      linked: accounts.filter((item) => item.staffId).length,
      total: accounts.length,
    }),
    [accounts],
  );
  const accountColumns: ColumnDef<SystemAccount>[] = [
      {
        id: 'user',
        header: 'Пользователь',
        size: 230,
        cell: ({ row }) => {
          const item = row.original;

          return (
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-md bg-muted">
                <UserCog className="h-4 w-4 text-muted-foreground" />
              </div>
              <div className="min-w-0">
                <div className="truncate font-medium">{item.email}</div>
                <div className="text-xs text-muted-foreground">ID {item.id}</div>
              </div>
            </div>
          );
        },
      },
      {
        accessorKey: 'role',
        header: 'Роль CRM',
        size: 140,
        cell: ({ row }) => (
          <Badge variant="outline">
            {getAccountRoleLabel(row.original.role)}
          </Badge>
        ),
      },
      {
        id: 'staff',
        header: 'Сотрудник',
        size: 170,
        cell: ({ row }) => {
          const item = row.original;

          return item.Staff ? (
            <div className="min-w-0">
              <div className="truncate font-medium">{item.Staff.name}</div>
              <div className="truncate text-xs text-muted-foreground">
                {getStaffPosition(item.Staff)}
              </div>
            </div>
          ) : (
            <span className="text-muted-foreground">Не привязан</span>
          );
        },
      },
      {
        id: 'lastLogin',
        header: 'Последний вход',
        size: 140,
        meta: {
          cellClassName: 'hidden text-muted-foreground xl:table-cell',
          headerClassName: 'hidden xl:table-cell',
        },
        cell: ({ row }) => formatDateTime(row.original.lastLoginAt),
      },
      {
        id: 'actions',
        header: '',
        size: 110,
        meta: {
          cellClassName: 'text-right',
          headerClassName: 'text-right',
        },
        cell: ({ row }) => {
          const item = row.original;
          const manageable = canManageAccount(item);

          if (!manageable) {
            return (
              <PermissionActionButton
                allowed={false}
                deniedMessage={permissionMessages.systemUsersRestricted}
                size="sm"
                variant="ghost"
                aria-label={`Почему нельзя управлять пользователем ${item.email}`}
              >
                Недоступно
              </PermissionActionButton>
            );
          }

          return (
            <div className="flex justify-end gap-1">
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => openEdit(item)}
                aria-label={`Редактировать пользователя ${item.email}`}
                title="Редактировать"
              >
                <Pencil className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                onClick={() => requestArchive(item)}
                aria-label={
                  item.status === 'archived'
                    ? `Восстановить пользователя ${item.email}`
                    : `Архивировать пользователя ${item.email}`
                }
                title={item.status === 'archived' ? 'Восстановить' : 'В архив'}
              >
                {item.status === 'archived' ? (
                  <ArchiveRestore className="h-4 w-4" />
                ) : (
                  <Archive className="h-4 w-4" />
                )}
              </Button>
              {item.status === 'archived' && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                  onClick={() => requestPermanentDelete(item)}
                  aria-label={`Удалить пользователя ${item.email} навсегда`}
                  title="Удалить навсегда"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </div>
          );
        },
      },
    ];

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <div className="grid gap-2 rounded-xl border bg-card/60 p-3 lg:grid-cols-[160px_minmax(220px,1fr)_auto] lg:items-center">
        <Select
          value={accountStatus}
          onValueChange={(value) =>
            setAccountStatus(value as 'active' | 'archived' | 'all')
          }
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="active">Активные</SelectItem>
            <SelectItem value="archived">Архив</SelectItem>
            <SelectItem value="all">Все</SelectItem>
          </SelectContent>
        </Select>
        <div className="relative min-w-0">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            value={accountSearch}
            onChange={(event) => setAccountSearch(event.target.value)}
            placeholder="Поиск по email, сотруднику или роли"
          />
        </div>
        <div className="flex justify-end">
          <Button onClick={openCreate} className="w-full lg:w-auto">
            <Plus className="h-4 w-4 mr-2" /> Пользователь
          </Button>
        </div>
      </div>

      <div className="rounded-md border bg-card">
        <DataTable
          columns={accountColumns}
          data={displayedAccounts}
          emptyText="Пользователи еще не созданы"
          errorText={loadError}
          loading={loading && displayedAccounts.length === 0}
          loadingText="Загрузка пользователей..."
          onRetry={() => void fetchData()}
          pageSize={10}
          tableClassName="table-fixed"
          renderMobileCard={(row) => {
            const item = row.original;
            const manageable = canManageAccount(item);

            return (
              <div className="min-w-0 rounded-xl border bg-card p-4 shadow-sm">
                <div className="flex min-w-0 items-start gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted">
                    <UserCog className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="break-all font-semibold">{item.email}</div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      ID {item.id}
                    </div>
                  </div>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <div className="text-xs text-muted-foreground">Роль CRM</div>
                    <div className="mt-1">{getAccountRoleLabel(item.role)}</div>
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs text-muted-foreground">Сотрудник</div>
                    <div className="mt-1 break-words">
                      {item.Staff?.name || 'Не привязан'}
                    </div>
                  </div>
                  <div className="col-span-2">
                    <div className="text-xs text-muted-foreground">Последний вход</div>
                    <div className="mt-1">{formatDateTime(item.lastLoginAt)}</div>
                  </div>
                </div>
                <div className="mt-4 flex flex-wrap justify-end gap-2 border-t pt-3">
                  {manageable ? (
                    <>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => openEdit(item)}
                      >
                        <Pencil className="mr-2 h-4 w-4" />
                        Изменить
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => requestArchive(item)}
                      >
                        {item.status === 'archived' ? (
                          <ArchiveRestore className="mr-2 h-4 w-4" />
                        ) : (
                          <Archive className="mr-2 h-4 w-4" />
                        )}
                        {item.status === 'archived' ? 'Восстановить' : 'В архив'}
                      </Button>
                      {item.status === 'archived' && (
                        <Button
                          type="button"
                          variant="destructive"
                          size="sm"
                          onClick={() => requestPermanentDelete(item)}
                        >
                          <Trash2 className="mr-2 h-4 w-4" />
                          Удалить
                        </Button>
                      )}
                    </>
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      {permissionMessages.systemUsersRestricted}
                    </span>
                  )}
                </div>
              </div>
            );
          }}
        />
      </div>

      <div className="grid gap-2 sm:grid-cols-3">
        <div className="rounded-xl border bg-card/70 px-3 py-2">
          <div className="text-xs text-muted-foreground">Всего</div>
          <div className="mt-1 text-lg font-semibold">{stats.total}</div>
        </div>
        <div className="rounded-xl border bg-card/70 px-3 py-2">
          <div className="text-xs text-muted-foreground">Активные</div>
          <div className="mt-1 text-lg font-semibold">{stats.active}</div>
        </div>
        <div className="rounded-xl border bg-card/70 px-3 py-2">
          <div className="text-xs text-muted-foreground">Привязаны к персоналу</div>
          <div className="mt-1 text-lg font-semibold">{stats.linked}</div>
        </div>
      </div>

      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent className="sm:max-w-[720px]">
          <DialogHeader>
            <DialogTitle>
              {editingAccount ? 'Редактировать пользователя' : 'Новый пользователь'}
            </DialogTitle>
            <DialogDescription>
              Роль определяет разделы CRM, которые будут доступны пользователю.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSave} className="space-y-4 pt-2">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label className="mb-1 block text-xs">Email</Label>
                <Input
                  type="email"
                  {...accountForm.register('email')}
                  aria-invalid={Boolean(accountForm.formState.errors.email)}
                />
                {accountForm.formState.errors.email && (
                  <p className="mt-1 text-xs text-destructive">
                    {accountForm.formState.errors.email.message}
                  </p>
                )}
              </div>
              <div>
                <Label className="mb-1 block text-xs">
                  {editingAccount ? 'Новый пароль' : 'Пароль'}
                </Label>
                <Input
                  type="password"
                  placeholder={editingAccount ? 'Оставьте пустым' : ''}
                  {...accountForm.register('password')}
                  aria-invalid={Boolean(accountForm.formState.errors.password)}
                />
                {accountForm.formState.errors.password && (
                  <p className="mt-1 text-xs text-destructive">
                    {accountForm.formState.errors.password.message}
                  </p>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label className="mb-1 block text-xs">Роль</Label>
                <Select
                  value={selectedRole}
                  onValueChange={(role) =>
                    accountForm.setValue('role', role as AccountRole, {
                      shouldDirty: true,
                      shouldValidate: true,
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {availableRoles.map((role) => (
                      <SelectItem key={role.value} value={role.value}>
                        {role.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground mt-1">
                  {getAccountRoleDescription(selectedRole)}
                </p>
              </div>
              <div>
                <Label className="mb-1 block text-xs">Статус</Label>
                <Select
                  value={selectedStatus}
                  onValueChange={(status) =>
                    accountForm.setValue('status', status as AccountStatus, {
                      shouldDirty: true,
                      shouldValidate: true,
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Активен</SelectItem>
                    <SelectItem value="inactive">Отключен</SelectItem>
                    <SelectItem value="archived">Архив</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <Label className="mb-1 block text-xs">
                Сотрудник
              </Label>
              <Select
                value={selectedStaffId}
                onValueChange={(staffId) =>
                  accountForm.setValue('staffId', staffId, {
                    shouldDirty: true,
                    shouldValidate: true,
                  })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Без привязки</SelectItem>
                  {staffOptions.map((item) => (
                    <SelectItem key={item.id} value={String(item.id)}>
                      {item.name} · {getStaffPosition(item)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground mt-1">
                Привязка нужна, если пользователь сам работает смены и должен
                попадать в payroll.
              </p>
            </div>

            <Button type="submit" className="w-full">
              <Save className="h-4 w-4 mr-2" /> Сохранить
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
