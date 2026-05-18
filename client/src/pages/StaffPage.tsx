import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import type { DateRange } from 'react-day-picker';
import { cn } from '@/lib/utils';
import {
  Calendar as CalendarIcon,
  Plus,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  Pencil,
  Trash2,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { apiFetch } from '@/lib/api';
import { canManageShifts, canManageStaff } from '@/lib/permissions';
import { useAuth } from '@/lib/useAuth';

interface AdminStat {
  staffId?: number | null;
  name: string;
  totalShifts: number;
  totalHours: number;
  basePay: number;
  bonusPay: number;
  totalPay: number;
}
interface PayrollItem {
  name: string;
  category: string;
  sum: number;
  qty: number;
  bucket?: string;
  bonus?: number;
  bonusRuleNames?: string[];
}
interface ShiftRecord {
  id: number | string;
  isDraft: boolean;
  date: string;
  staffId?: number | null;
  adminName: string | null;
  hours: number;
  dailyRevenue: number;
  basePay: number;
  calculatedBonus?: number;
  manualAdjustment?: number;
  bonus: number;
  total: number;
  items: PayrollItem[];
}

interface StaffMember {
  id: number;
  name: string;
  position?: string;
  role?: string;
  phone?: string | null;
  status: 'active' | 'inactive' | string;
}

const emptyStaffForm = {
  name: '',
  phone: '',
  position: 'Администратор',
  status: 'active',
};

function getStaffPosition(staff: StaffMember) {
  return staff.position || staff.role || '-';
}

export default function StaffPage() {
  const { account } = useAuth();
  const canEditStaff = canManageStaff(account?.role);
  const canEditShifts = canManageShifts(account?.role);
  const [admins, setAdmins] = useState<AdminStat[]>([]);
  const [shifts, setShifts] = useState<ShiftRecord[]>([]);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [loading, setLoading] = useState(true);

  const now = new Date();
  const [dateRange, setDateRange] = useState<DateRange | undefined>({
    from: new Date(now.getFullYear(), now.getMonth(), 1),
    to: now,
  });

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isStaffModalOpen, setIsStaffModalOpen] = useState(false);
  const [editingStaff, setEditingStaff] = useState<StaffMember | null>(null);
  const [detailModal, setDetailModal] = useState<{
    isOpen: boolean;
    shift: ShiftRecord | null;
  }>({ isOpen: false, shift: null });

  const [form, setForm] = useState({
    id: '',
    date: '',
    staffId: '',
    adminName: '',
    hours: '',
    manualAdjustment: '',
    comment: '',
  });
  const [staffForm, setStaffForm] = useState(emptyStaffForm);

  const fetchPayroll = useCallback(async () => {
    setLoading(true);
    const fromStr = dateRange?.from ? format(dateRange.from, 'yyyy-MM-dd') : '';
    const toStr = dateRange?.to ? format(dateRange.to, 'yyyy-MM-dd') : fromStr;

    try {
      const [payrollRes, staffRes] = await Promise.all([
        apiFetch(`/api/finance/payroll?from=${fromStr}&to=${toStr}`),
        apiFetch('/api/staff'),
      ]);

      if (payrollRes.ok) {
        const data = await payrollRes.json();
        setAdmins(data.admins);
        setShifts(data.shifts);
      }

      if (staffRes.ok) {
        setStaff((await staffRes.json()) as StaffMember[]);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [dateRange]);

  useEffect(() => {
    void fetchPayroll();
  }, [fetchPayroll]);

  const handleSaveShift = async (e: React.FormEvent) => {
    e.preventDefault();
    const selectedStaff = staff.find((item) => String(item.id) === form.staffId);

    if (!selectedStaff) {
      alert('Выберите сотрудника смены');
      return;
    }

    try {
      const method =
        String(form.id).startsWith('draft-') || !form.id ? 'POST' : 'PUT';
      const payload = {
        ...form,
        id: String(form.id).startsWith('draft-') ? undefined : form.id,
        staffId: selectedStaff.id,
        adminName: selectedStaff.name,
        hours: Number(form.hours) || 0,
        manualAdjustment: Number(form.manualAdjustment) || 0,
      };

      const res = await apiFetch('/api/shifts', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        setIsModalOpen(false);
        fetchPayroll();
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleDelete = async (id: number | string) => {
    if (String(id).startsWith('draft-')) return;
    if (!confirm('Точно удалить смену?')) return;
    try {
      await apiFetch('/api/shifts', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      fetchPayroll();
    } catch (e) {
      console.error(e);
    }
  };

  const openForm = (shift?: ShiftRecord) => {
    if (shift) {
      const matchedStaff =
        shift.staffId ||
        staff.find((item) => item.name === shift.adminName)?.id ||
        '';

      setForm({
        id: String(shift.id),
        date: shift.date,
        staffId: matchedStaff ? String(matchedStaff) : '',
        adminName: shift.adminName || '',
        hours: String(shift.hours || ''),
        manualAdjustment: String(shift.manualAdjustment || ''),
        comment: '',
      });
    } else {
      setForm({
        id: '',
        date: format(new Date(), 'yyyy-MM-dd'),
        staffId: '',
        adminName: '',
        hours: '',
        manualAdjustment: '',
        comment: '',
      });
    }
    setIsModalOpen(true);
  };

  const openStaffForm = (item?: StaffMember) => {
    if (item) {
      setEditingStaff(item);
      setStaffForm({
        name: item.name,
        phone: item.phone || '',
        position: getStaffPosition(item),
        status: item.status === 'inactive' ? 'inactive' : 'active',
      });
    } else {
      setEditingStaff(null);
      setStaffForm(emptyStaffForm);
    }

    setIsStaffModalOpen(true);
  };

  const closeStaffForm = () => {
    setIsStaffModalOpen(false);
    setEditingStaff(null);
    setStaffForm(emptyStaffForm);
  };

  const handleSaveStaff = async (e: React.FormEvent) => {
    e.preventDefault();

    try {
      const payload = {
        name: staffForm.name.trim(),
        position: staffForm.position.trim(),
        phone: staffForm.phone.trim() || undefined,
        status: staffForm.status,
      };

      const res = await apiFetch(
        editingStaff ? `/api/staff/${editingStaff.id}` : '/api/staff',
        {
          method: editingStaff ? 'PUT' : 'POST',
          body: JSON.stringify(payload),
        },
      );

      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        alert(data.error || 'Не удалось сохранить сотрудника');
        return;
      }

      closeStaffForm();
      fetchPayroll();
    } catch (e) {
      console.error(e);
    }
  };

  const handleDeleteStaff = async (item: StaffMember) => {
    if (!confirm(`Удалить сотрудника ${item.name}?`)) return;

    try {
      const res = await apiFetch(`/api/staff/${item.id}`, {
        method: 'DELETE',
      });

      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        alert(data.error || 'Не удалось удалить сотрудника');
        return;
      }

      fetchPayroll();
    } catch (e) {
      console.error(e);
    }
  };

  const stats = useMemo(() => {
    let totalShifts = 0,
      totalDrafts = 0,
      totalHours = 0,
      totalRev = 0,
      totalPay = 0;
    shifts.forEach((s) => {
      if (s.isDraft) totalDrafts++;
      else {
        totalShifts++;
        totalHours += s.hours;
      }
      totalRev += s.dailyRevenue;
      totalPay += s.total;
    });
    return { totalShifts, totalDrafts, totalHours, totalRev, totalPay };
  }, [shifts]);

  const activeStaff = useMemo(
    () => staff.filter((item) => item.status === 'active'),
    [staff],
  );

  const getBucketStyles = (bucket: string) => {
    switch (bucket) {
      case 'bonus':
        return 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300 border-transparent';
      default:
        return 'bg-transparent';
    }
  };

  return (
    <div className="min-w-0 p-4 md:p-8 space-y-6">
      {/* ШАПКА */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">
            Персонал и смены
          </h1>
          <p className="text-muted-foreground mt-1 text-sm max-w-2xl">
            Черновики смен создаются автоматически по дням, где есть кассовые
            операции. Здесь живут сотрудники, смены и расчет начислений.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3 w-full sm:w-auto">
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant={'outline'}
                className={cn(
                  'w-full sm:w-[260px] justify-start text-left font-normal bg-card',
                  !dateRange && 'text-muted-foreground',
                )}
              >
                <CalendarIcon className="mr-2 h-4 w-4" />
                {dateRange?.from ? (
                  dateRange.to ? (
                    <>
                      {format(dateRange.from, 'dd.MM.yyyy')} —{' '}
                      {format(dateRange.to, 'dd.MM.yyyy')}
                    </>
                  ) : (
                    format(dateRange.from, 'dd.MM.yyyy')
                  )
                ) : (
                  <span>Выберите период</span>
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="end">
              <Calendar
                initialFocus
                mode="range"
                defaultMonth={dateRange?.from}
                selected={dateRange}
                onSelect={setDateRange}
                numberOfMonths={1}
                locale={ru}
              />
            </PopoverContent>
          </Popover>
          <Button
            variant="outline"
            size="icon"
            onClick={fetchPayroll}
            disabled={loading}
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
          {canEditStaff && (
            <Button variant="outline" onClick={() => openStaffForm()}>
              <Plus className="w-4 h-4 mr-2" /> Сотрудник
            </Button>
          )}
          {canEditShifts && (
            <Button onClick={() => openForm()}>
              <Plus className="w-4 h-4 mr-2" /> Добавить смену
            </Button>
          )}
        </div>
      </div>

      {/* KPI КАРТОЧКИ */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="text-xs text-muted-foreground font-medium">
              Смен
            </div>
            <div className="text-2xl font-bold mt-1">{stats.totalShifts}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-xs text-muted-foreground font-medium">
              Черновики
            </div>
            <div className="text-2xl font-bold mt-1 text-amber-500">
              {stats.totalDrafts}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-xs text-muted-foreground font-medium">
              Часов
            </div>
            <div className="text-2xl font-bold mt-1">
              {stats.totalHours.toLocaleString()}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-xs text-muted-foreground font-medium">
              Выручка дней
            </div>
            <div className="text-2xl font-bold mt-1">
              {stats.totalRev.toLocaleString()} ₽
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-xs text-muted-foreground font-medium">
              Итого начислено
            </div>
            <div className="text-2xl font-bold mt-1 text-primary">
              {stats.totalPay.toLocaleString()} ₽
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="border rounded-md bg-card overflow-x-auto">
        <div className="px-4 py-3 border-b flex items-center justify-between gap-3">
          <div>
            <div className="font-semibold">Сотрудники</div>
            <div className="text-xs text-muted-foreground">
              Рабочие смены привязываются к этой базе.
            </div>
          </div>
          {canEditStaff && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => openStaffForm()}
            >
              <Plus className="w-4 h-4 mr-2" /> Добавить
            </Button>
          )}
        </div>
        <Table className="min-w-[760px] table-fixed">
          <TableHeader>
            <TableRow>
              <TableHead className="w-[28%]">Имя</TableHead>
              <TableHead className="w-[26%]">Должность</TableHead>
              <TableHead className="w-[20%]">Телефон</TableHead>
              <TableHead className="w-[14%]">Статус</TableHead>
              <TableHead className="w-[12%] text-right"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {staff.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={5}
                  className="text-center text-muted-foreground py-8"
                >
                  Сотрудники еще не добавлены
                </TableCell>
              </TableRow>
            )}
            {staff.map((item) => (
              <TableRow key={item.id}>
                <TableCell className="font-medium truncate">
                  {item.name}
                </TableCell>
                <TableCell className="truncate">
                  {getStaffPosition(item)}
                </TableCell>
                <TableCell className="text-muted-foreground truncate">
                  {item.phone || '-'}
                </TableCell>
                <TableCell>
                  <Badge variant="outline">
                    {item.status === 'active' ? 'Активен' : 'Отключен'}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  {canEditStaff && (
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => openStaffForm(item)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="text-destructive hover:text-destructive hover:bg-destructive/10"
                        onClick={() => void handleDeleteStaff(item)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* ЖУРНАЛ СМЕН */}
      <div className="border rounded-md bg-card overflow-x-auto">
        <Table className="min-w-[980px]">
          <TableHeader>
            <TableRow>
              <TableHead>Дата</TableHead>
              <TableHead>Статус</TableHead>
              <TableHead>Администратор</TableHead>
              <TableHead className="text-right">Часы</TableHead>
              <TableHead className="text-right">Выручка дня</TableHead>
              <TableHead className="text-right">Премии/корр.</TableHead>
              <TableHead className="text-right">Итого</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {shifts.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={8}
                  className="text-center text-muted-foreground py-8"
                >
                  Нет данных за этот период
                </TableCell>
              </TableRow>
            )}
            {shifts.map((s) => (
              <TableRow
                key={s.id}
                className="cursor-pointer hover:bg-muted/50"
                onClick={() => setDetailModal({ isOpen: true, shift: s })}
              >
                <TableCell className="font-medium">{s.date}</TableCell>
                <TableCell>
                  {s.isDraft ? (
                    <Badge
                      variant="outline"
                      className="bg-amber-100 text-amber-800 border-transparent dark:bg-amber-900/30 dark:text-amber-300"
                    >
                      <AlertTriangle className="w-3 h-3 mr-1" /> Черновик
                    </Badge>
                  ) : (
                    <Badge
                      variant="outline"
                      className="bg-green-100 text-green-800 border-transparent dark:bg-green-900/30 dark:text-green-300"
                    >
                      <CheckCircle2 className="w-3 h-3 mr-1" /> Заполнено
                    </Badge>
                  )}
                </TableCell>
                <TableCell>
                  {s.isDraft ? (
                    <span className="text-muted-foreground text-xs">
                      Не указано
                    </span>
                  ) : (
                    s.adminName
                  )}
                </TableCell>
                <TableCell className="text-right">{s.hours || '—'}</TableCell>
                <TableCell className="text-right">
                  {s.dailyRevenue.toLocaleString('ru-RU')} ₽
                </TableCell>
                <TableCell className="text-right text-muted-foreground">
                  {s.bonus > 0
                    ? `+${s.bonus.toLocaleString()}`
                    : s.bonus === 0
                      ? '—'
                      : s.bonus.toLocaleString()}{' '}
                  ₽
                </TableCell>
                <TableCell className="text-right font-bold text-base">
                  {s.total > 0 ? s.total.toLocaleString('ru-RU') + ' ₽' : '—'}
                </TableCell>
                <TableCell className="text-right">
                  <div
                    className="flex justify-end gap-2"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {canEditShifts && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => openForm(s)}
                      >
                        Изм.
                      </Button>
                    )}
                    {canEditShifts && !s.isDraft && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive hover:bg-destructive/10"
                        onClick={() => handleDelete(s.id)}
                      >
                        Удал.
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="text-xs text-muted-foreground">
        Статус{' '}
        <Badge
          variant="outline"
          className="bg-amber-100 text-amber-800 border-transparent dark:bg-amber-900/30 dark:text-amber-300 scale-75 origin-left"
        >
          Черновик
        </Badge>{' '}
        — день создан автоматически и ещё не заполнен. Зарплата считается только
        когда указаны администратор и часы.
      </div>

      {/* ТАБЛИЦА АГРЕГАЦИИ ПО АДМИНАМ */}
      <div className="border rounded-md bg-card mt-8 overflow-x-auto">
        <Table className="min-w-[720px]">
          <TableHeader>
            <TableRow>
              <TableHead>Администратор</TableHead>
              <TableHead className="text-right">Смен</TableHead>
              <TableHead className="text-right">Часы</TableHead>
              <TableHead className="text-right">Премии/корр.</TableHead>
              <TableHead className="text-right">Итого</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {admins.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={5}
                  className="text-center text-muted-foreground py-8"
                >
                  Нет заполненных смен за выбранный период
                </TableCell>
              </TableRow>
            )}
            {admins
              .toSorted((a, b) => b.totalPay - a.totalPay)
              .map((a) => (
                <TableRow key={a.staffId || a.name}>
                  <TableCell className="font-medium text-base">
                    {a.name}
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    {a.totalShifts}
                  </TableCell>
                  <TableCell className="text-right">{a.totalHours}</TableCell>
                  <TableCell className="text-right text-muted-foreground">
                    {a.bonusPay.toLocaleString('ru-RU')} ₽
                  </TableCell>
                  <TableCell className="text-right font-bold text-lg">
                    {a.totalPay.toLocaleString('ru-RU')} ₽
                  </TableCell>
                </TableRow>
              ))}
          </TableBody>
        </Table>
      </div>

      <Dialog
        open={isStaffModalOpen}
        onOpenChange={(open) => (open ? setIsStaffModalOpen(true) : closeStaffForm())}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingStaff ? 'Редактировать сотрудника' : 'Новый сотрудник'}
            </DialogTitle>
            <div className="text-sm text-muted-foreground">
              Сотрудник используется в сменах, payroll и операционной логике.
              Доступ в CRM создается в разделе пользователей.
            </div>
          </DialogHeader>
          <form onSubmit={handleSaveStaff} className="space-y-4 pt-2">
            <div>
              <label className="text-xs font-medium mb-1 block">Имя</label>
              <Input
                required
                value={staffForm.name}
                onChange={(e) =>
                  setStaffForm({ ...staffForm, name: e.target.value })
                }
              />
            </div>
            <div>
              <label className="text-xs font-medium mb-1 block">
                Должность
              </label>
              <Input
                required
                value={staffForm.position}
                onChange={(e) =>
                  setStaffForm({ ...staffForm, position: e.target.value })
                }
              />
            </div>
            <div>
              <label className="text-xs font-medium mb-1 block">Телефон</label>
              <Input
                value={staffForm.phone}
                onChange={(e) =>
                  setStaffForm({ ...staffForm, phone: e.target.value })
                }
              />
            </div>
            <div>
              <label className="text-xs font-medium mb-1 block">Статус</label>
              <Select
                value={staffForm.status}
                onValueChange={(status) =>
                  setStaffForm({ ...staffForm, status })
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Активен</SelectItem>
                  <SelectItem value="inactive">Отключен</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button type="submit" className="w-full">
              {editingStaff ? 'Сохранить' : 'Создать'}
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      {/* ФОРМА ДОБАВЛЕНИЯ/РЕДАКТИРОВАНИЯ */}
      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {form.id && !String(form.id).startsWith('draft-')
                ? 'Редактирование смены'
                : 'Заполнение черновика / Новая смена'}
            </DialogTitle>
            <div className="text-sm text-muted-foreground">
              Выберите сотрудника и укажите рабочие часы.
            </div>
          </DialogHeader>
          <form onSubmit={handleSaveShift} className="space-y-4 pt-2">
            <div>
              <label className="text-xs font-medium mb-1 block">Дата</label>
              <Input
                type="date"
                required
                value={form.date}
                onChange={(e) => setForm({ ...form, date: e.target.value })}
                disabled={String(form.id).startsWith('draft-')}
              />
            </div>
            <div>
              <label className="text-xs font-medium mb-1 block">
                Администратор
              </label>
              <Select
                value={form.staffId}
                onValueChange={(staffId) => {
                  const selectedStaff = staff.find(
                    (item) => String(item.id) === staffId,
                  );
                  setForm({
                    ...form,
                    staffId,
                    adminName: selectedStaff?.name || '',
                  });
                }}
                required
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Выберите сотрудника" />
                </SelectTrigger>
                <SelectContent>
                  {activeStaff.map((item) => (
                    <SelectItem key={item.id} value={String(item.id)}>
                      {item.name} · {getStaffPosition(item)}
                    </SelectItem>
                  ))}
                  {activeStaff.length === 0 && (
                    <SelectItem value="empty" disabled>
                      Сначала добавьте сотрудника
                    </SelectItem>
                  )}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs font-medium mb-1 block">Часы</label>
              <Input
                type="number"
                step="0.5"
                required
                placeholder="12"
                value={form.hours}
                onChange={(e) => setForm({ ...form, hours: e.target.value })}
              />
            </div>
            <div>
              <label className="text-xs font-medium mb-1 block">
                Корректировка зарплаты
              </label>
              <Input
                type="number"
                step="1"
                placeholder="0"
                value={form.manualAdjustment}
                onChange={(e) =>
                  setForm({ ...form, manualAdjustment: e.target.value })
                }
              />
              <div className="mt-1 text-xs text-muted-foreground">
                Можно указать премию или штраф вручную.
              </div>
            </div>
            <div>
              <label className="text-xs font-medium mb-1 block">
                Комментарий
              </label>
              <Input
                placeholder="По необходимости"
                value={form.comment}
                onChange={(e) => setForm({ ...form, comment: e.target.value })}
              />
            </div>
            <Button type="submit" className="w-full">
              Сохранить
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      {/* ДЕТАЛИЗАЦИЯ (ЧЕКИ ВНУТРИ СМЕНЫ) */}
      <Dialog
        open={detailModal.isOpen}
        onOpenChange={(val) =>
          setDetailModal((prev) => ({ ...prev, isOpen: val }))
        }
      >
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-hidden flex flex-col p-0">
          <div className="px-6 py-4 border-b bg-muted/30">
            <DialogTitle className="text-2xl font-bold">
              {detailModal.shift?.date} —{' '}
              {detailModal.shift?.isDraft
                ? 'Черновик'
                : detailModal.shift?.adminName}
            </DialogTitle>
            {!detailModal.shift?.isDraft && (
              <div className="text-sm text-muted-foreground mt-1">
                Часы: {detailModal.shift?.hours} • Выручка:{' '}
                {detailModal.shift?.dailyRevenue.toLocaleString()} ₽ • База:{' '}
                {detailModal.shift?.basePay.toLocaleString()} ₽ • Премия:{' '}
                {Number(
                  detailModal.shift?.calculatedBonus ??
                    detailModal.shift?.bonus ??
                    0,
                ).toLocaleString()}{' '}
                ₽
                {Number(detailModal.shift?.manualAdjustment || 0) !== 0 &&
                  ` • Корректировка: ${Number(detailModal.shift?.manualAdjustment).toLocaleString()} ₽`}
              </div>
            )}
          </div>

          <div className="px-6 py-3 border-b flex gap-2 flex-wrap bg-card">
            <Badge variant="outline" className={getBucketStyles('bonus')}>
              Начислен бонус по правилу мотивации
            </Badge>
          </div>

          <div className="flex-1 overflow-auto px-4 py-2 sm:px-6">
            <Table className="min-w-[560px] table-fixed">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[40%]">Позиция</TableHead>
                  <TableHead className="w-[14%] text-right">Кол-во</TableHead>
                  <TableHead className="w-[20%] text-right">Сумма</TableHead>
                  <TableHead className="w-[26%] text-right">Бонус</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {detailModal.shift?.items?.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={4}
                      className="text-center py-8 text-muted-foreground"
                    >
                      Нет кассовых операций в этот день
                    </TableCell>
                  </TableRow>
                )}
                {detailModal.shift?.items?.map((item, idx) => (
                  <TableRow
                    key={idx}
                    className={item.bucket ? getBucketStyles(item.bucket) : ''}
                  >
                    <TableCell className="align-top whitespace-normal">
                      <div className="font-medium break-words">{item.name}</div>
                      <div className="text-xs opacity-70 mt-0.5 break-words">
                        {item.category}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">{item.qty}</TableCell>
                    <TableCell className="text-right font-medium">
                      {item.sum.toLocaleString('ru-RU')} ₽
                    </TableCell>
                    <TableCell className="text-right align-top whitespace-normal">
                      {Number(item.bonus) > 0 ? (
                        <div>
                          <div className="font-medium text-green-600">
                            +{Number(item.bonus).toLocaleString('ru-RU')} ₽
                          </div>
                          <div className="text-xs text-muted-foreground break-words">
                            {item.bonusRuleNames?.join(', ')}
                          </div>
                        </div>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="p-4 border-t flex justify-end bg-card">
            <Button
              variant="outline"
              onClick={() =>
                setDetailModal((prev) => ({ ...prev, isOpen: false }))
              }
            >
              Закрыть
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
