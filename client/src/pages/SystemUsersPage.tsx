import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  UserCog,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
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
import {
  ACCOUNT_ROLES,
  getAccountRoleDescription,
  getAccountRoleLabel,
  type AccountRole,
} from '@/lib/roles';
import { useAuth } from '@/lib/useAuth';

type AccountStatus = 'active' | 'inactive';

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

interface AccountFormState {
  email: string;
  password: string;
  role: AccountRole;
  staffId: string;
  status: AccountStatus;
}

const MANAGER_MANAGED_ROLES: AccountRole[] = ['admin', 'accountant', 'viewer'];
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
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState<SystemAccount | null>(
    null,
  );
  const [form, setForm] = useState<AccountFormState>(EMPTY_FORM);

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
    () => staff.filter((item) => !linkedStaffIds.has(item.id)),
    [linkedStaffIds, staff],
  );

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [accountsRes, staffRes] = await Promise.all([
        apiFetch('/api/accounts'),
        apiFetch('/api/staff'),
      ]);

      if (accountsRes.ok) {
        setAccounts((await accountsRes.json()) as SystemAccount[]);
      }
      if (staffRes.ok) {
        setStaff((await staffRes.json()) as StaffOption[]);
      }
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
    setForm({
      ...EMPTY_FORM,
      role: availableRoles[0]?.value || 'admin',
    });
    setIsModalOpen(true);
  };

  const openEdit = (target: SystemAccount) => {
    setEditingAccount(target);
    setForm({
      email: target.email,
      password: '',
      role: target.role,
      staffId: target.staffId ? String(target.staffId) : 'none',
      status: target.status,
    });
    setIsModalOpen(true);
  };

  const handleSave = async (event: React.FormEvent) => {
    event.preventDefault();

    const payload = {
      email: form.email.trim(),
      password: form.password || undefined,
      role: form.role,
      staffId: form.staffId === 'none' ? null : Number(form.staffId),
      status: form.status,
    };

    const response = await apiFetch(
      editingAccount ? `/api/accounts/${editingAccount.id}` : '/api/accounts',
      {
        method: editingAccount ? 'PUT' : 'POST',
        body: JSON.stringify(payload),
      },
    );

    if (!response.ok) {
      alert(await readError(response, 'Не удалось сохранить пользователя'));
      return;
    }

    const saved = (await response.json()) as SystemAccount;
    setAccounts((prev) =>
      editingAccount
        ? prev.map((item) => (item.id === saved.id ? saved : item))
        : [saved, ...prev],
    );
    setIsModalOpen(false);
  };

  const handleDelete = async (target: SystemAccount) => {
    if (!confirm(`Удалить пользователя ${target.email}?`)) return;

    const response = await apiFetch(`/api/accounts/${target.id}`, {
      method: 'DELETE',
    });

    if (!response.ok) {
      alert(await readError(response, 'Не удалось удалить пользователя'));
      return;
    }

    setAccounts((prev) => prev.filter((item) => item.id !== target.id));
  };

  const stats = useMemo(
    () => ({
      active: accounts.filter((item) => item.status === 'active').length,
      linked: accounts.filter((item) => item.staffId).length,
      total: accounts.length,
    }),
    [accounts],
  );

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
        <Table className="min-w-[760px] table-fixed">
          <TableHeader>
            <TableRow>
              <TableHead className="w-[30%]">Пользователь</TableHead>
              <TableHead className="w-[18%]">Роль CRM</TableHead>
              <TableHead className="w-[22%]">Сотрудник</TableHead>
              <TableHead className="w-[14%]">Статус</TableHead>
              <TableHead className="hidden xl:table-cell w-[16%]">
                Последний вход
              </TableHead>
              <TableHead className="w-[92px] text-right"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {accounts.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="text-center text-muted-foreground py-10"
                >
                  Пользователи еще не созданы
                </TableCell>
              </TableRow>
            )}
            {accounts.map((item) => {
              const manageable = canManageAccount(item);

              return (
                <TableRow key={item.id}>
                  <TableCell>
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="h-8 w-8 rounded-md bg-muted flex items-center justify-center">
                        <UserCog className="h-4 w-4 text-muted-foreground" />
                      </div>
                      <div className="min-w-0">
                        <div className="font-medium truncate">
                          {item.email}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          ID {item.id}
                        </div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">
                      {getAccountRoleLabel(item.role)}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {item.Staff ? (
                      <div className="min-w-0">
                        <div className="font-medium truncate">
                          {item.Staff.name}
                        </div>
                        <div className="text-xs text-muted-foreground truncate">
                          {getStaffPosition(item.Staff)}
                        </div>
                      </div>
                    ) : (
                      <span className="text-muted-foreground">Не привязан</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={
                        item.status === 'active'
                          ? 'bg-green-100 text-green-800 border-transparent dark:bg-green-900/30 dark:text-green-300'
                          : ''
                      }
                    >
                      {item.status === 'active' ? 'Активен' : 'Отключен'}
                    </Badge>
                  </TableCell>
                  <TableCell className="hidden xl:table-cell text-muted-foreground">
                    {formatDateTime(item.lastLoginAt)}
                  </TableCell>
                  <TableCell className="text-right">
                    {manageable ? (
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => openEdit(item)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="destructive"
                          size="icon-sm"
                          onClick={() => void handleDelete(item)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        Недоступно
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
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
                <label className="text-xs font-medium mb-1 block">Email</label>
                <Input
                  type="email"
                  required
                  value={form.email}
                  onChange={(event) =>
                    setForm({ ...form, email: event.target.value })
                  }
                />
              </div>
              <div>
                <label className="text-xs font-medium mb-1 block">
                  {editingAccount ? 'Новый пароль' : 'Пароль'}
                </label>
                <Input
                  type="password"
                  minLength={6}
                  required={!editingAccount}
                  placeholder={editingAccount ? 'Оставьте пустым' : ''}
                  value={form.password}
                  onChange={(event) =>
                    setForm({ ...form, password: event.target.value })
                  }
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium mb-1 block">Роль</label>
                <Select
                  value={form.role}
                  onValueChange={(role) =>
                    setForm({ ...form, role: role as AccountRole })
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
                  {getAccountRoleDescription(form.role)}
                </p>
              </div>
              <div>
                <label className="text-xs font-medium mb-1 block">Статус</label>
                <Select
                  value={form.status}
                  onValueChange={(status) =>
                    setForm({ ...form, status: status as AccountStatus })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Активен</SelectItem>
                    <SelectItem value="inactive">Отключен</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <label className="text-xs font-medium mb-1 block">
                Сотрудник
              </label>
              <Select
                value={form.staffId}
                onValueChange={(staffId) => setForm({ ...form, staffId })}
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
    </div>
  );
}
