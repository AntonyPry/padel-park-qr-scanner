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
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
import {
  TrendingUp,
  AlertCircle,
  Lightbulb,
  Activity,
  Calendar as CalendarIcon,
  RefreshCw,
  Plus,
} from 'lucide-react';
// Добавлены импорты для круговых диаграмм
import {
  PieChart,
  Pie,
  Cell,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import type { DateRange } from 'react-day-picker';
import { cn } from '@/lib/utils';
import { API_URL } from '@/config';

const MANUAL_CATEGORIES = [
  { type: 'income', value: 'corp', label: 'Корп. выручка (вне кассы)' },
  {
    type: 'income',
    value: 'lunda_courts',
    label: 'Лунда — бронь кортов (вне кассы)',
  },
  {
    type: 'income',
    value: 'lunda_tournaments',
    label: 'Лунда — турниры (вне кассы)',
  },
  {
    type: 'income',
    value: 'aladdin',
    label: 'Алладин сертификаты (вне кассы)',
  },
  { type: 'income', value: 'other_income', label: 'Прочая выручка вне кассы' },
  {
    type: 'expense',
    value: 'cogs_food',
    label: 'COGS — закуп еды/напитков',
    group: 'COGS еда/напитки',
  },
  {
    type: 'expense',
    value: 'cogs_goods',
    label: 'COGS — закуп товаров/инвентаря',
    group: 'COGS товары',
  },
  { type: 'expense', value: 'rent', label: 'OPEX — аренда', group: 'Аренда' },
  {
    type: 'expense',
    value: 'utilities',
    label: 'OPEX — коммунальные',
    group: 'Коммунальные',
  },
  {
    type: 'expense',
    value: 'payroll',
    label: 'OPEX — зарплаты',
    group: 'Зарплаты (штат)',
  },
  {
    type: 'expense',
    value: 'marketing',
    label: 'OPEX — маркетинг',
    group: 'Маркетинг',
  },
  {
    type: 'expense',
    value: 'services',
    label: 'OPEX — услуги',
    group: 'Услуги',
  },
  {
    type: 'expense',
    value: 'events',
    label: 'OPEX — мероприятия',
    group: 'Мероприятия (OPEX)',
  },
  {
    type: 'expense',
    value: 'subs',
    label: 'OPEX — подписки/сервисы',
    group: 'Подписки',
  },
  {
    type: 'expense',
    value: 'phone',
    label: 'OPEX — связь и интернет',
    group: 'Связь и интернет',
  },
  {
    type: 'expense',
    value: 'other_opex',
    label: 'OPEX — прочее',
    group: 'OPEX прочее',
  },
];

// Палитра для диаграмм
const PIE_COLORS = [
  '#3b82f6',
  '#10b981',
  '#f59e0b',
  '#ef4444',
  '#8b5cf6',
  '#06b6d4',
  '#64748b',
];

export default function FinancePage() {
  const [records, setRecords] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Настройка дефолтного периода (с 1 числа текущего месяца по сегодня)
  const now = new Date();
  const [dateRange, setDateRange] = useState<DateRange | undefined>({
    from: new Date(now.getFullYear(), now.getMonth(), 1),
    to: now,
  });

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [detailModal, setDetailModal] = useState<{
    isOpen: boolean;
    type: 'list' | 'formula';
    title: string;
    subtitle: string;
    items: any[];
  }>({ isOpen: false, type: 'list', title: '', subtitle: '', items: [] });

  const todayStr = now.toISOString().split('T')[0];
  const [form, setForm] = useState({
    date: todayStr,
    category: '',
    amount: '',
    type: 'expense',
    comment: '',
  });

  const fetchFinances = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}api/finance`);
      if (res.ok) setRecords(await res.json());
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchFinances();
  }, []);

  const handleAddManual = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch(`${API_URL}api/finance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (res.ok) {
        setIsModalOpen(false);
        setForm({ ...form, category: '', amount: '', comment: '' });
        fetchFinances();
      }
    } catch (e) {
      console.error(e);
    }
  };

  const stats = useMemo(() => {
    const start = dateRange?.from ? dateRange.from : new Date();
    const end = dateRange?.to ? dateRange.to : start;

    const startTime = new Date(
      start.getFullYear(),
      start.getMonth(),
      start.getDate(),
    ).getTime();
    const endTime = new Date(
      end.getFullYear(),
      end.getMonth(),
      end.getDate(),
      23,
      59,
      59,
      999,
    ).getTime();

    const periodLength = endTime - startTime;
    const prevStartTime = startTime - periodLength - 1;
    const prevEndTime = startTime - 1;

    const buildState = (sTime: number, eTime: number) => {
      const filtered = records.filter((r) => {
        const dTime = new Date(r.date).getTime();
        return dTime >= sTime && dTime <= eTime;
      });

      let posRev = 0,
        extCorp = 0,
        extLunda = 0,
        extAladdin = 0,
        extOther = 0;
      let cogsItems = 0,
        acqFee = 0,
        lundaFee = 0,
        aladdinFee = 0;
      let opex = 0,
        cashless = 0,
        cash = 0;

      const posCats: Record<string, number> = {};
      const opexRows: any[] = [];
      const cogsRows: any[] = [];
      const extRows: any[] = [];

      filtered.forEach((r) => {
        const val = Math.abs(Number(r.amount));

        if (r.type === 'income' && r.source === 'evotor') {
          posRev += val;
          posCats[r.category] = (posCats[r.category] || 0) + val;
          if (r.rawCashless) cashless += Number(r.rawCashless);
        } else if (r.type === 'income' && r.source === 'manual') {
          if (r.category === 'corp') extCorp += val;
          else if (
            r.category === 'lunda_courts' ||
            r.category === 'lunda_tournaments'
          )
            extLunda += val;
          else if (r.category === 'aladdin') extAladdin += val;
          else extOther += val;
          extRows.push({
            ...r,
            val,
            catLabel:
              MANUAL_CATEGORIES.find((c) => c.value === r.category)?.label ||
              r.category,
          });
        } else if (r.type === 'expense') {
          if (r.category === 'Эквайринг') acqFee += val;
          else if (r.category === 'Комиссия Лунда') lundaFee += val;
          else if (r.category === 'Комиссия Алладин') aladdinFee += val;
          else if (r.category.includes('cogs')) {
            cogsItems += val;
            cogsRows.push({
              ...r,
              val,
              catLabel:
                MANUAL_CATEGORIES.find((c) => c.value === r.category)?.label ||
                r.category,
            });
          } else {
            opex += val;
            opexRows.push({
              ...r,
              val,
              catLabel:
                MANUAL_CATEGORIES.find((c) => c.value === r.category)?.label ||
                r.category,
            });
          }
        }
      });

      const extTotal = extCorp + extLunda + extAladdin + extOther;
      const revenue = posRev + extTotal;
      const cogsTotal = cogsItems + acqFee + lundaFee + aladdinFee;
      const gross = revenue - cogsTotal;
      const net = gross - opex;
      const margin = revenue > 0 ? (net / revenue) * 100 : 0;

      const alloc2 = extLunda > 0 ? extLunda * 0.71 : 0;
      const alloc1 = extLunda > 0 ? extLunda - alloc2 : 0;

      return {
        revenue,
        posRev,
        extTotal,
        extCorp,
        extLunda,
        alloc2,
        alloc1,
        extAladdin,
        extOther,
        cogsItems,
        acqFee,
        lundaFee,
        aladdinFee,
        cogsTotal,
        gross,
        opex,
        net,
        margin,
        posCats,
        extRows,
        cogsRows,
        opexRows,
        records: filtered,
        cashless,
        cash,
      };
    };

    const cur = buildState(startTime, endTime);
    const prev = buildState(prevStartTime, prevEndTime);

    // --- ПОДГОТОВКА ДАННЫХ ДЛЯ ДИАГРАММ ---
    const incomePieData = [
      { name: 'Касса', value: cur.posRev },
      { name: 'Корп.', value: cur.extCorp },
      { name: 'Лунда', value: cur.extLunda },
      { name: 'Алладин', value: cur.extAladdin },
      { name: 'Прочее', value: cur.extOther },
    ].filter((i) => i.value > 0);

    const expensePieData = [
      { name: 'Себестоимость (COGS)', value: cur.cogsItems },
      {
        name: 'Комиссии и Эквайринг',
        value: cur.acqFee + cur.lundaFee + cur.aladdinFee,
      },
    ];

    // Группируем OPEX, отрезая приставку "OPEX — " для красоты графика
    const opexGrouped = cur.opexRows.reduce((acc: any, r) => {
      const name = (r.catLabel || r.category).replace('OPEX — ', '');
      acc[name] = (acc[name] || 0) + r.val;
      return acc;
    }, {});
    Object.entries(opexGrouped).forEach(([name, val]) => {
      expensePieData.push({ name, value: val as number });
    });

    const finalExpensePieData = expensePieData
      .filter((i) => i.value > 0)
      .sort((a, b) => b.value - a.value);
    // --------------------------------------

    const insights = [];
    if (cur.margin < 0)
      insights.push({
        title: 'Убыток в периоде',
        text: 'Кликните “Структура расходов” чтобы проанализировать OPEX.',
        type: 'danger',
      });
    const food = cur.posCats['Бар / Кафе'] || 0;
    const courts = cur.posCats['Аренда кортов'] || 0;
    if (courts > 0 && food / courts < 0.06)
      insights.push({
        title: 'Еда/напитки низко',
        text: `Сейчас ${((food / courts) * 100).toFixed(1)}% от выручки кортов. Цель 6–10%.`,
        type: 'warning',
      });
    if (insights.length === 0)
      insights.push({
        title: 'Ок',
        text: 'Показатели в норме. Провалитесь в статьи для проверки.',
        type: 'success',
      });

    return {
      cur,
      prev,
      insights,
      start,
      end,
      incomePieData,
      finalExpensePieData,
    };
  }, [records, dateRange]);

  const {
    cur,
    prev,
    insights,
    start,
    end,
    incomePieData,
    finalExpensePieData,
  } = stats;
  const periodLabel = `${format(start, 'dd.MM.yyyy')} — ${format(end, 'dd.MM.yyyy')}`;

  const formatDiff = (curV: number, prevV: number) => {
    if (prevV === 0) return null;
    const diff = curV - prevV;
    const color = diff >= 0 ? 'text-green-500' : 'text-destructive';
    return (
      <span className={`text-xs ml-2 font-medium ${color}`}>
        {diff >= 0 ? '↑' : '↓'} {Math.abs(diff).toLocaleString('ru-RU')} ₽
      </span>
    );
  };

  const openDetail = (id: string) => {
    let title = '',
      items: any[] = [],
      type: 'list' | 'formula' = 'list';

    if (id === 'rev_pos') {
      title = 'Выручка — касса';
      items = Object.entries(cur.posCats).map(([name, sum]) => ({
        name,
        sum,
        comment: 'Сводка по категориям Эвотор',
      }));
    } else if (id === 'rev_ext') {
      title = 'Выручка — вне кассы';
      items = cur.extRows.map((r) => ({
        name: r.catLabel,
        sum: r.val,
        comment: r.comment || r.date,
      }));
    } else if (id === 'rev_corp') {
      title = 'Корп. выручка (вне кассы)';
      items = cur.extRows
        .filter((r) => r.category === 'corp')
        .map((r) => ({
          name: r.catLabel,
          sum: r.val,
          comment: r.comment || r.date,
        }));
    } else if (id === 'rev_lunda') {
      title = 'Лунда (вне кассы)';
      items = cur.extRows
        .filter(
          (r) =>
            r.category === 'lunda_courts' || r.category === 'lunda_tournaments',
        )
        .map((r) => ({
          name: r.catLabel,
          sum: r.val,
          comment: r.comment || r.date,
        }));
    } else if (id === 'rev_aladdin') {
      title = 'Алладин сертификаты (вне кассы)';
      items = cur.extRows
        .filter((r) => r.category === 'aladdin')
        .map((r) => ({
          name: r.catLabel,
          sum: r.val,
          comment: r.comment || r.date,
        }));
    } else if (id === 'cogs_items') {
      title = 'Себестоимость (закупы)';
      items = cur.cogsRows.map((r) => ({
        name: r.catLabel,
        sum: r.val,
        comment: r.comment || r.date,
      }));
    } else if (id === 'opex' || id === 'opex_struct') {
      title = 'Структура расходов периода';
      const grouped = cur.opexRows.reduce((acc: any, r) => {
        acc[r.catLabel] = (acc[r.catLabel] || 0) + r.val;
        return acc;
      }, {});
      items = Object.entries(grouped).map(([name, sum]) => ({
        name,
        sum,
        comment: 'Сгруппировано',
      }));
    } else if (id === 'fee_acq') {
      title = 'Эквайринг';
      type = 'formula';
      items = [
        { name: 'Безнал кассы', sum: cur.cashless, comment: '' },
        { name: 'Итого (1%)', sum: cur.acqFee, comment: '', isTotal: true },
      ];
    } else if (id === 'fee_lunda') {
      title = 'Комиссия Лунда';
      type = 'formula';
      items = [
        { name: 'Лунда — бронь кортов', sum: cur.extLunda, comment: '' },
        { name: 'Итого (1.5%)', sum: cur.lundaFee, comment: '', isTotal: true },
      ];
    } else if (id === 'fee_aladdin') {
      title = 'Комиссия Алладин';
      type = 'formula';
      items = [
        { name: 'Алладин сертификаты', sum: cur.extAladdin, comment: '' },
        {
          name: 'Итого (17%)',
          sum: cur.aladdinFee,
          comment: '',
          isTotal: true,
        },
      ];
    }

    setDetailModal({
      isOpen: true,
      type,
      title,
      subtitle: `Период: ${periodLabel}`,
      items: type === 'list' ? items.sort((a, b) => b.sum - a.sum) : items,
    });
  };

  return (
    <div className="p-6 md:p-8 space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">P&L Отчет</h1>
          <p className="text-muted-foreground mt-1">
            Финансовый результат клуба (касса + ручные операции)
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3 w-full sm:w-auto">
          <Popover>
            <PopoverTrigger asChild>
              <Button
                id="date"
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
            onClick={fetchFinances}
            disabled={loading}
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>

          <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="w-4 h-4 mr-2" /> Добавить
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Новая запись</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleAddManual} className="space-y-4 pt-4">
                <div className="grid grid-cols-2 gap-4">
                  <Button
                    type="button"
                    variant={form.type === 'income' ? 'default' : 'outline'}
                    className={
                      form.type === 'income'
                        ? 'bg-green-600 hover:bg-green-700'
                        : ''
                    }
                    onClick={() =>
                      setForm({ ...form, type: 'income', category: '' })
                    }
                  >
                    Доход
                  </Button>
                  <Button
                    type="button"
                    variant={form.type === 'expense' ? 'default' : 'outline'}
                    className={
                      form.type === 'expense'
                        ? 'bg-destructive hover:bg-destructive/90'
                        : ''
                    }
                    onClick={() =>
                      setForm({ ...form, type: 'expense', category: '' })
                    }
                  >
                    Расход
                  </Button>
                </div>
                <Input
                  type="date"
                  value={form.date}
                  onChange={(e) => setForm({ ...form, date: e.target.value })}
                  required
                />
                <Select
                  value={form.category}
                  onValueChange={(val) => setForm({ ...form, category: val })}
                  required
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Выберите категорию" />
                  </SelectTrigger>
                  <SelectContent>
                    {MANUAL_CATEGORIES.filter((c) => c.type === form.type).map(
                      (c) => (
                        <SelectItem key={c.value} value={c.value}>
                          {c.label}
                        </SelectItem>
                      ),
                    )}
                  </SelectContent>
                </Select>
                <Input
                  type="number"
                  placeholder="Сумма"
                  value={form.amount}
                  onChange={(e) => setForm({ ...form, amount: e.target.value })}
                  required
                />
                <Input
                  placeholder="Комментарий"
                  value={form.comment}
                  onChange={(e) =>
                    setForm({ ...form, comment: e.target.value })
                  }
                />
                <Button type="submit" className="w-full">
                  Сохранить
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* KPI */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="text-sm text-muted-foreground font-medium">
              Выручка
            </div>
            <div className="text-2xl font-bold mt-1">
              {cur.revenue.toLocaleString('ru-RU')} ₽{' '}
              {formatDiff(cur.revenue, prev.revenue)}
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              Касса: {cur.posRev.toLocaleString()} • Вне кассы:{' '}
              {cur.extTotal.toLocaleString()}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-sm text-muted-foreground font-medium">
              Выручка прошлого периода
            </div>
            <div className="text-2xl font-bold mt-1 text-muted-foreground">
              {prev.revenue.toLocaleString('ru-RU')} ₽
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              Тот же сдвиг по дням назад
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-sm text-muted-foreground font-medium">
              Валовая прибыль (Gross)
            </div>
            <div className="text-2xl font-bold mt-1">
              {cur.gross.toLocaleString('ru-RU')} ₽{' '}
              {formatDiff(cur.gross, prev.gross)}
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              COGS+комиссии: -{cur.cogsTotal.toLocaleString()}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-sm text-muted-foreground font-medium">
              OPEX (Расходы)
            </div>
            <div className="text-2xl font-bold mt-1">
              {cur.opex.toLocaleString('ru-RU')} ₽{' '}
              {formatDiff(cur.opex, prev.opex)}
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              Аренда/ФОТ/маркетинг/прочее
            </div>
          </CardContent>
        </Card>
        <Card
          className={
            cur.net >= 0
              ? 'border-green-500/50 bg-green-500/5'
              : 'border-destructive/50 bg-destructive/5'
          }
        >
          <CardContent className="pt-6">
            <div className="text-sm text-muted-foreground font-medium">
              Чистая прибыль (Net)
            </div>
            <div className="text-2xl font-bold mt-1">
              {cur.net.toLocaleString('ru-RU')} ₽{' '}
              {formatDiff(cur.net, prev.net)}
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              Без налогов
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-sm text-muted-foreground font-medium">
              Рентабельность (Margin)
            </div>
            <div className="text-2xl font-bold mt-1">
              {cur.margin.toFixed(1)} %
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              {cur.net >= 0 ? 'Плюс' : 'Минус'} к выручке
            </div>
          </CardContent>
        </Card>
      </div>

      {/* НОВЫЙ БЛОК: ДИАГРАММЫ ДОХОДОВ И РАСХОДОВ */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base font-semibold">
              Структура выручки
            </CardTitle>
          </CardHeader>
          <CardContent className="h-[250px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={incomePieData}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={80}
                  paddingAngle={2}
                  dataKey="value"
                >
                  {incomePieData.map((_, index) => (
                    <Cell
                      key={`cell-${index}`}
                      fill={PIE_COLORS[index % PIE_COLORS.length]}
                    />
                  ))}
                </Pie>
                <RechartsTooltip
                  formatter={(val: any) => `${val.toLocaleString()} ₽`}
                />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base font-semibold">
              Структура расходов (COGS + OPEX)
            </CardTitle>
          </CardHeader>
          <CardContent className="h-[250px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={finalExpensePieData}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={80}
                  paddingAngle={2}
                  dataKey="value"
                >
                  {finalExpensePieData.map((_, index) => (
                    <Cell
                      key={`cell-${index}`}
                      fill={
                        [
                          '#ef4444',
                          '#f97316',
                          '#f59e0b',
                          '#84cc16',
                          '#06b6d4',
                          '#6366f1',
                        ][index % 6]
                      }
                    />
                  ))}
                </Pie>
                <RechartsTooltip
                  formatter={(val: any) => `${val.toLocaleString()} ₽`}
                />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* ОСНОВНОЙ КОНТЕНТ */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mt-6">
        <div className="col-span-2 space-y-6">
          {/* ГЛАВНАЯ ТАБЛИЦА P&L (17 строк как в оригинале) */}
          <div className="border rounded-md bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Статья</TableHead>
                  <TableHead className="text-right">Сумма</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow className="bg-muted/30">
                  <TableCell className="font-bold">Выручка (итого)</TableCell>
                  <TableCell className="text-right font-bold">
                    {cur.revenue.toLocaleString('ru-RU')} ₽
                  </TableCell>
                </TableRow>
                <TableRow
                  onClick={() => openDetail('rev_pos')}
                  className="cursor-pointer hover:bg-muted/50"
                >
                  <TableCell className="pl-6">Выручка — касса</TableCell>
                  <TableCell className="text-right">
                    {cur.posRev.toLocaleString('ru-RU')} ₽
                  </TableCell>
                </TableRow>
                <TableRow
                  onClick={() => openDetail('rev_ext')}
                  className="cursor-pointer hover:bg-muted/50"
                >
                  <TableCell className="pl-6">Выручка — вне кассы</TableCell>
                  <TableCell className="text-right">
                    {cur.extTotal.toLocaleString('ru-RU')} ₽
                  </TableCell>
                </TableRow>
                <TableRow
                  onClick={() => openDetail('rev_corp')}
                  className="cursor-pointer hover:bg-muted/50"
                >
                  <TableCell className="pl-12 text-muted-foreground">
                    Корп. выручка (вне кассы)
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground">
                    {cur.extCorp.toLocaleString('ru-RU')} ₽
                  </TableCell>
                </TableRow>
                <TableRow
                  onClick={() => openDetail('rev_lunda')}
                  className="cursor-pointer hover:bg-muted/50"
                >
                  <TableCell className="pl-12 text-muted-foreground">
                    Лунда — бронь кортов (вне кассы)
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground">
                    {cur.extLunda.toLocaleString('ru-RU')} ₽
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="pl-16 text-xs text-muted-foreground">
                    ...2x2 (по доле выручки кортов)
                  </TableCell>
                  <TableCell className="text-right text-xs text-muted-foreground">
                    {cur.alloc2.toLocaleString('ru-RU')} ₽
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="pl-16 text-xs text-muted-foreground">
                    ...1x1 (по доле выручки кортов)
                  </TableCell>
                  <TableCell className="text-right text-xs text-muted-foreground">
                    {cur.alloc1.toLocaleString('ru-RU')} ₽
                  </TableCell>
                </TableRow>
                <TableRow
                  onClick={() => openDetail('rev_aladdin')}
                  className="cursor-pointer hover:bg-muted/50"
                >
                  <TableCell className="pl-12 text-muted-foreground">
                    Алладин сертификаты (вне кассы)
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground">
                    {cur.extAladdin.toLocaleString('ru-RU')} ₽
                  </TableCell>
                </TableRow>

                <TableRow className="bg-muted/30 mt-4">
                  <TableCell className="font-bold">COGS + комиссии</TableCell>
                  <TableCell className="text-right font-bold text-destructive">
                    -{cur.cogsTotal.toLocaleString('ru-RU')} ₽
                  </TableCell>
                </TableRow>
                <TableRow
                  onClick={() => openDetail('fee_acq')}
                  className="cursor-pointer hover:bg-muted/50"
                >
                  <TableCell className="pl-6">
                    Эквайринг (1% от безнала кассы)
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground">
                    -{cur.acqFee.toLocaleString('ru-RU')} ₽
                  </TableCell>
                </TableRow>
                <TableRow
                  onClick={() => openDetail('fee_lunda')}
                  className="cursor-pointer hover:bg-muted/50"
                >
                  <TableCell className="pl-6">Комиссия Лунда (1.5%)</TableCell>
                  <TableCell className="text-right text-muted-foreground">
                    -{cur.lundaFee.toLocaleString('ru-RU')} ₽
                  </TableCell>
                </TableRow>
                <TableRow
                  onClick={() => openDetail('fee_aladdin')}
                  className="cursor-pointer hover:bg-muted/50"
                >
                  <TableCell className="pl-6">Комиссия Алладин (17%)</TableCell>
                  <TableCell className="text-right text-muted-foreground">
                    -{cur.aladdinFee.toLocaleString('ru-RU')} ₽
                  </TableCell>
                </TableRow>
                <TableRow
                  onClick={() => openDetail('cogs_items')}
                  className="cursor-pointer hover:bg-muted/50"
                >
                  <TableCell className="pl-6">Себестоимость (закупы)</TableCell>
                  <TableCell className="text-right text-muted-foreground">
                    -{cur.cogsItems.toLocaleString('ru-RU')} ₽
                  </TableCell>
                </TableRow>

                <TableRow className="bg-primary/5">
                  <TableCell className="font-bold">Валовая прибыль</TableCell>
                  <TableCell className="text-right font-bold text-primary">
                    {cur.gross.toLocaleString('ru-RU')} ₽
                  </TableCell>
                </TableRow>

                <TableRow
                  onClick={() => openDetail('opex')}
                  className="bg-muted/30 cursor-pointer hover:bg-muted/50"
                >
                  <TableCell className="font-bold">
                    OPEX (операционные расходы)
                  </TableCell>
                  <TableCell className="text-right font-bold text-destructive">
                    -{cur.opex.toLocaleString('ru-RU')} ₽
                  </TableCell>
                </TableRow>
                <TableRow
                  onClick={() => openDetail('opex_struct')}
                  className="cursor-pointer hover:bg-muted/50"
                >
                  <TableCell className="pl-6">
                    Структура расходов периода
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground">
                    -{cur.opex.toLocaleString('ru-RU')} ₽
                  </TableCell>
                </TableRow>

                <TableRow
                  className={
                    cur.net >= 0 ? 'bg-green-500/10' : 'bg-destructive/10'
                  }
                >
                  <TableCell className="font-bold text-lg">
                    Чистая прибыль
                  </TableCell>
                  <TableCell
                    className={`text-right font-bold text-lg ${cur.net >= 0 ? 'text-green-500' : 'text-destructive'}`}
                  >
                    {cur.net.toLocaleString('ru-RU')} ₽
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>

          {/* ВТОРАЯ ТАБЛИЦА: ДАННЫЕ ДЛЯ РАСЧЕТОВ */}
          <div className="border rounded-md bg-card">
            <div className="p-4 border-b font-semibold">
              Данные для расчётов
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>База</TableHead>
                  <TableHead className="text-right">Значение</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow>
                  <TableCell>Безнал кассы</TableCell>
                  <TableCell className="text-right font-medium">
                    {cur.cashless.toLocaleString('ru-RU')} ₽
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>Нал кассы</TableCell>
                  <TableCell className="text-right font-medium">
                    {cur.cash.toLocaleString('ru-RU')} ₽
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>Лунда — бронь кортов</TableCell>
                  <TableCell className="text-right font-medium">
                    {cur.extLunda.toLocaleString('ru-RU')} ₽
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>Алладин сертификаты</TableCell>
                  <TableCell className="text-right font-medium">
                    {cur.extAladdin.toLocaleString('ru-RU')} ₽
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </div>

        {/* ПРАВАЯ КОЛОНКА (Инсайты) */}
        <div className="space-y-6">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Lightbulb className="w-4 h-4 text-orange-500" />{' '}
                Action-insights
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {insights.map((ins, i) => (
                <div key={i} className="flex gap-3">
                  <div className="mt-0.5">
                    {ins.type === 'danger' ? (
                      <AlertCircle className="w-4 h-4 text-destructive" />
                    ) : ins.type === 'warning' ? (
                      <Activity className="w-4 h-4 text-orange-500" />
                    ) : (
                      <TrendingUp className="w-4 h-4 text-green-500" />
                    )}
                  </div>
                  <div>
                    <div className="font-semibold text-sm">{ins.title}</div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {ins.text}
                    </div>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* МОДАЛКА ДЕТАЛИЗАЦИИ */}
      <Dialog
        open={detailModal.isOpen}
        onOpenChange={(val) =>
          setDetailModal((prev) => ({ ...prev, isOpen: val }))
        }
      >
        <DialogContent className="max-w-3xl sm:max-w-4xl max-h-[90vh] overflow-hidden flex flex-col p-0">
          <div className="px-6 py-4 border-b bg-muted/30">
            <DialogTitle className="text-2xl font-bold">
              {detailModal.title}
            </DialogTitle>
            <div className="text-sm text-muted-foreground mt-1">
              {detailModal.subtitle}
            </div>
          </div>
          <div className="flex-1 overflow-y-auto px-6 py-4">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>
                    {detailModal.type === 'formula' ? 'База' : 'Статья'}
                  </TableHead>
                  <TableHead className="text-right">
                    {detailModal.type === 'formula' ? 'Значение' : 'Сумма'}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {detailModal.items.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={2}
                      className="text-center text-muted-foreground py-12"
                    >
                      Нет данных за этот период
                    </TableCell>
                  </TableRow>
                )}
                {detailModal.items.map((item, idx) => (
                  <TableRow
                    key={idx}
                    className={item.isTotal ? 'bg-muted/30' : ''}
                  >
                    <TableCell>
                      <div
                        className={`text-base ${item.isTotal ? 'font-bold' : 'font-medium'}`}
                      >
                        {item.name}
                      </div>
                      {item.comment && (
                        <div className="text-sm text-muted-foreground mt-0.5">
                          {item.comment}
                        </div>
                      )}
                    </TableCell>
                    <TableCell
                      className={`text-right text-lg ${item.isTotal ? 'font-bold' : 'font-medium'}`}
                    >
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
