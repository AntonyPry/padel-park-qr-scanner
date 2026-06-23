import { useCallback, useEffect, useMemo, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import type { ColumnDef } from '@tanstack/react-table';
import {
  Archive,
  ArchiveRestore,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  UserCog,
} from 'lucide-react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/toast';
import { Card, CardContent } from '@/components/ui/card';
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
import { useAuth } from '@/lib/useAuth';

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
  const { account } = useAuth();
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
    if (account?.role === 'owner') return ACCOUNT_ROLES;
    return ACCOUNT_ROLES.filter((role) =>
      MANAGER_MANAGED_ROLES.includes(role.value),
    );
  }, [account?.role]);

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
    if (accountStatus === 'all') return accounts;
    return accounts.filter((item) => item.status === accountStatus);
  }, [accountStatus, accounts]);

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
        setAccounts([]);
        setLoadError(await readError(accountsRes, 'Не удалось загрузить пользователей'));
      }
      if (staffRes.ok) {
        setStaff((await staffRes.json()) as StaffOption[]);
      } else {
        setStaff([]);
        setLoadError((current) =>
          current || 'Не удалось загрузить сотрудников для привязки',
        );
      }
    } catch (error) {
      setAccounts([]);
      setStaff([]);
      setLoadError(getApiErrorMessage(error, 'Не удалось загрузить пользователей'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const canManageAccount = (target: SystemAccount) => {
    if (account?.role === 'owner') return true;
    return Boolean(
      account?.role === 'manager' &&
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
      account?.role === 'manager' &&
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
        accessorKey: 'status',
        header: 'Статус',
        size: 120,
        cell: ({ row }) => {
          const item = row.original;

          return (
            <Badge
              variant="outline"
              className={
                item.status === 'active'
                  ? 'border-transparent bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300'
                  : ''
              }
            >
              {item.status === 'active'
                ? 'Активен'
                : item.status === 'archived'
                  ? 'Архив'
                  : 'Отключен'}
            </Badge>
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
    <div className="min-w-0 p-4 md:p-8 space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">
            Пользователи системы
          </h1>
          <p className="text-muted-foreground mt-1 text-sm max-w-2xl">
            Логины, роли и доступы в CRM. Сотрудники для смен и зарплаты
            остаются в разделе персонала.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Select
            value={accountStatus}
            onValueChange={(value) =>
              setAccountStatus(value as 'active' | 'archived' | 'all')
            }
          >
            <SelectTrigger className="w-[150px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="active">Активные</SelectItem>
              <SelectItem value="archived">Архив</SelectItem>
              <SelectItem value="all">Все</SelectItem>
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="icon"
            onClick={fetchData}
            disabled={loading}
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4 mr-2" /> Пользователь
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="text-sm text-muted-foreground">Всего</div>
            <div className="text-2xl font-bold mt-1">{stats.total}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-sm text-muted-foreground">Активные</div>
            <div className="text-2xl font-bold mt-1">{stats.active}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-sm text-muted-foreground">
              Привязаны к персоналу
            </div>
            <div className="text-2xl font-bold mt-1">{stats.linked}</div>
          </CardContent>
        </Card>
      </div>

      <div className="border rounded-md bg-card overflow-x-auto">
        <DataTable
          columns={accountColumns}
          data={displayedAccounts}
          emptyText="Пользователи еще не созданы"
          errorText={loadError}
          loading={loading}
          loadingText="Загрузка пользователей..."
          minWidthClassName="min-w-[760px] table-fixed"
          onRetry={() => void fetchData()}
        />
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
