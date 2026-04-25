import { useState, useEffect, useMemo } from 'react';
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
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { API_URL } from '@/config';

interface AdminStat {
  name: string;
  totalShifts: number;
  totalHours: number;
  basePay: number;
  bonusPay: number;
  totalPay: number;
}
interface ShiftRecord {
  id: number | string;
  isDraft: boolean;
  date: string;
  adminName: string;
  hours: number;
  dailyRevenue: number;
  basePay: number;
  bonus: number;
  total: number;
  items: any[];
}

export default function StaffPage() {
  const [admins, setAdmins] = useState<AdminStat[]>([]);
  const [shifts, setShifts] = useState<ShiftRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const now = new Date();
  const [dateRange, setDateRange] = useState<DateRange | undefined>({
    from: new Date(now.getFullYear(), now.getMonth(), 1),
    to: now,
  });

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [detailModal, setDetailModal] = useState<{
    isOpen: boolean;
    shift: ShiftRecord | null;
  }>({ isOpen: false, shift: null });

  const [form, setForm] = useState({
    id: '',
    date: '',
    adminName: '',
    hours: '',
    comment: '',
  });

  const fetchPayroll = async () => {
    setLoading(true);
    const fromStr = dateRange?.from ? format(dateRange.from, 'yyyy-MM-dd') : '';
    const toStr = dateRange?.to ? format(dateRange.to, 'yyyy-MM-dd') : fromStr;

    try {
      const res = await fetch(
        `${API_URL}api/payroll?from=${fromStr}&to=${toStr}`,
      );
      if (res.ok) {
        const data = await res.json();
        setAdmins(data.admins);
        setShifts(data.shifts);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPayroll();
  }, [dateRange]);

  const handleSaveShift = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const method =
        String(form.id).startsWith('draft-') || !form.id ? 'POST' : 'PUT';
      // Если это черновик, передаем дату, а id удаляем (создастся новая запись)
      const payload = {
        ...form,
        id: String(form.id).startsWith('draft-') ? undefined : form.id,
        hours: Number(form.hours) || 0,
      };

      const res = await fetch(`${API_URL}api/shifts`, {
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
      await fetch(`${API_URL}api/shifts`, {
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
      setForm({
        id: String(shift.id),
        date: shift.date,
        adminName: shift.adminName || '',
        hours: String(shift.hours || ''),
        comment: '',
      });
    } else {
      setForm({
        id: '',
        date: format(new Date(), 'yyyy-MM-dd'),
        adminName: '',
        hours: '',
        comment: '',
      });
    }
    setIsModalOpen(true);
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

  const getBucketStyles = (bucket: string) => {
    switch (bucket) {
      case 'vip':
        return 'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300 border-transparent';
      case 'food':
        return 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300 border-transparent';
      case 'chef':
        return 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 border-transparent';
      case 'tube':
        return 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300 border-transparent';
      case 'store':
        return 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300 border-transparent';
      default:
        return 'bg-transparent';
    }
  };

  return (
    <div className="p-6 md:p-8 space-y-6">
      {/* ШАПКА */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Администраторы</h1>
          <p className="text-muted-foreground mt-1 text-sm max-w-2xl">
            Черновики смен создаются автоматически по дням, где есть кассовые
            операции. Ты только указываешь администратора и рабочие часы.
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
          <Button onClick={() => openForm()}>
            <Plus className="w-4 h-4 mr-2" /> Добавить смену
          </Button>
        </div>
      </div>

      {/* KPI КАРТОЧКИ */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
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

      {/* ЖУРНАЛ СМЕН */}
      <div className="border rounded-md bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Дата</TableHead>
              <TableHead>Статус</TableHead>
              <TableHead>Администратор</TableHead>
              <TableHead className="text-right">Часы</TableHead>
              <TableHead className="text-right">Выручка дня</TableHead>
              <TableHead className="text-right">Премии</TableHead>
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
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => openForm(s)}
                    >
                      Изм.
                    </Button>
                    {!s.isDraft && (
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
      <div className="border rounded-md bg-card mt-8">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Администратор</TableHead>
              <TableHead className="text-right">Смен</TableHead>
              <TableHead className="text-right">Часы</TableHead>
              <TableHead className="text-right">Премии</TableHead>
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
              .sort((a, b) => b.totalPay - a.totalPay)
              .map((a) => (
                <TableRow key={a.name}>
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
              Заполни администратора и часы. Если оставить пусто — смена
              останется черновиком.
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
              <Input
                placeholder="Например: Мария"
                required
                value={form.adminName}
                onChange={(e) =>
                  setForm({ ...form, adminName: e.target.value })
                }
              />
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
                {detailModal.shift?.bonus.toLocaleString()} ₽
              </div>
            )}
          </div>

          <div className="px-6 py-3 border-b flex gap-2 flex-wrap bg-card">
            <Badge variant="outline" className={getBucketStyles('vip')}>
              VIP
            </Badge>
            <Badge variant="outline" className={getBucketStyles('food')}>
              Еда / напитки
            </Badge>
            <Badge variant="outline" className={getBucketStyles('chef')}>
              Ракетки шефа
            </Badge>
            <Badge variant="outline" className={getBucketStyles('tube')}>
              Тубусы
            </Badge>
            <Badge variant="outline" className={getBucketStyles('store')}>
              Товары
            </Badge>
          </div>

          <div className="flex-1 overflow-y-auto px-6 py-2">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Позиция</TableHead>
                  <TableHead className="text-right">Кол-во</TableHead>
                  <TableHead className="text-right">Сумма</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {detailModal.shift?.items?.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={3}
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
                    <TableCell>
                      <div className="font-medium">{item.name}</div>
                      <div className="text-xs opacity-70 mt-0.5">
                        {item.category}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">{item.qty}</TableCell>
                    <TableCell className="text-right font-medium">
                      {item.sum.toLocaleString('ru-RU')} ₽
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
