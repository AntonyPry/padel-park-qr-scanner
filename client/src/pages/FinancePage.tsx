import { useState, useEffect } from 'react';
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
  Calendar as CalendarIcon,
  RefreshCw,
  Plus,
  ChevronRight,
  LayoutList,
  ChevronDown,
  List,
} from 'lucide-react';
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
import { Badge } from '@/components/ui/badge';

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
  const [report, setReport] = useState<any>(null);
  const [categories, setCategories] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [detailsModalCat, setDetailsModalCat] = useState<string | null>(null);

  const now = new Date();
  const [dateRange, setDateRange] = useState<DateRange | undefined>({
    from: new Date(now.getFullYear(), now.getMonth(), 1),
    to: now,
  });

  const [isModalOpen, setIsModalOpen] = useState(false);
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
      // Передаем даты на бэкенд, чтобы он сам всё отфильтровал
      const fromStr = dateRange?.from
        ? format(dateRange.from, 'yyyy-MM-dd')
        : '';
      const toStr = dateRange?.to ? format(dateRange.to, 'yyyy-MM-dd') : '';

      const [finRes, catRes] = await Promise.all([
        fetch(`${API_URL}/api/finance?from=${fromStr}&to=${toStr}`),
        fetch(`${API_URL}/api/catalog/categories`),
      ]);

      if (finRes.ok) setReport(await finRes.json());
      if (catRes.ok) setCategories(await catRes.json());
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchFinances();
  }, [dateRange]); // Автоматически перезапрашиваем при смене дат

  const handleAddManual = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch(`${API_URL}/api/finance`, {
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

  if (!report) return null; // Ждем загрузки отчета

  const { summary, sections } = report;

  // Подготовка данных для графиков напрямую из секций бэкенда
  const incomePieData = [
    ...(sections.REVENUE_POS || []),
    ...(sections.REVENUE_EXT || []),
  ]
    .filter((i) => i.sum > 0)
    .map((i) => ({ name: i.name, value: i.sum }));

  const expensePieData = [
    ...(sections.COGS || []),
    ...(sections.FEES || []),
    ...(sections.OPEX || []),
  ]
    .filter((i) => i.sum > 0)
    .map((i) => ({ name: i.name, value: i.sum }))
    .sort((a, b) => b.value - a.value);

  const ExpandableRow = ({
    item,
    isExpense,
    depth = 0,
  }: {
    item: any;
    isExpense: boolean;
    depth?: number;
  }) => {
    const [expanded, setExpanded] = useState(false);
    const hasSubItems = item.subItems && item.subItems.length > 0;
    const paddingLeft = `${2.5 + depth * 1.5}rem`;

    return (
      <>
        <TableRow
          className={`bg-transparent hover:bg-muted/50 ${hasSubItems ? 'cursor-pointer' : ''} group`}
          onClick={() => hasSubItems && setExpanded(!expanded)}
        >
          <TableCell
            className="border-b-0 flex items-center gap-2"
            style={{ paddingLeft }}
          >
            {hasSubItems ? (
              expanded ? (
                <ChevronDown className="w-4 h-4 text-primary shrink-0" />
              ) : (
                <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
              )
            ) : (
              <span className="w-4 h-4 inline-block shrink-0" />
            )}
            <span
              className={
                hasSubItems
                  ? depth === 0
                    ? 'font-bold text-foreground'
                    : 'font-medium text-foreground'
                  : 'text-muted-foreground'
              }
            >
              {item.name}
            </span>
          </TableCell>

          <TableCell
            className={`text-right border-b-0 ${hasSubItems ? (depth === 0 ? 'font-bold text-foreground' : 'font-medium text-foreground') : 'text-muted-foreground'} ${isExpense ? 'text-destructive/80' : ''}`}
          >
            <div className="flex items-center justify-end gap-3">
              <span>
                {isExpense ? '-' : ''}
                {item.sum.toLocaleString('ru-RU')} ₽
              </span>
              {/* КНОПКА ОТКРЫТИЯ ДЕТАЛИЗАЦИИ */}
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={(e) => {
                  e.stopPropagation();
                  setDetailsModalCat(item.name);
                }}
              >
                <List className="h-4 w-4 text-muted-foreground" />
              </Button>
            </div>
          </TableCell>
        </TableRow>

        {expanded &&
          hasSubItems &&
          item.subItems.map((subItem: any, idx: number) => (
            <ExpandableRow
              key={idx}
              item={subItem}
              isExpense={isExpense}
              depth={depth + 1}
            />
          ))}
      </>
    );
  };

  const SubRows = ({
    items,
    isExpense = false,
  }: {
    items: any[];
    isExpense?: boolean;
  }) => {
    if (!items || items.length === 0) return null;
    return (
      <>
        {items.map((item, idx) => (
          <ExpandableRow
            key={idx}
            item={item}
            isExpense={isExpense}
            depth={0}
          />
        ))}
      </>
    );
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
                variant="outline"
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
                    <SelectValue placeholder="Выберите категорию из базы" />
                  </SelectTrigger>
                  <SelectContent>
                    {categories
                      .filter((c) => c.type === form.type)
                      .map((c) => (
                        <SelectItem key={c.id} value={c.name}>
                          {c.name}
                        </SelectItem>
                      ))}
                    {categories.filter((c) => c.type === form.type).length ===
                      0 && (
                      <SelectItem value="empty" disabled>
                        Нет созданных категорий
                      </SelectItem>
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

      {/* KPI карточки (берем прямо из summary) */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="text-sm text-muted-foreground font-medium">
              Выручка
            </div>
            <div className="text-2xl font-bold mt-1">
              {summary.revenue.toLocaleString('ru-RU')} ₽
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-sm text-muted-foreground font-medium">
              Валовая прибыль (Gross)
            </div>
            <div className="text-2xl font-bold mt-1">
              {summary.gross.toLocaleString('ru-RU')} ₽
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-sm text-muted-foreground font-medium">
              OPEX (Расходы)
            </div>
            <div className="text-2xl font-bold mt-1">
              {summary.opex.toLocaleString('ru-RU')} ₽
            </div>
          </CardContent>
        </Card>
        <Card
          className={
            summary.net >= 0
              ? 'border-green-500/50 bg-green-500/5'
              : 'border-destructive/50 bg-destructive/5'
          }
        >
          <CardContent className="pt-6">
            <div className="text-sm text-muted-foreground font-medium">
              Чистая прибыль (Net)
            </div>
            <div className="text-2xl font-bold mt-1">
              {summary.net.toLocaleString('ru-RU')} ₽
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-sm text-muted-foreground font-medium">
              Рентабельность (Margin)
            </div>
            <div className="text-2xl font-bold mt-1">
              {summary.margin.toFixed(1)} %
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Диаграммы */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base font-semibold">
              Структура выручки
            </CardTitle>
          </CardHeader>
          <CardContent className="h-[250px]">
            {incomePieData.length > 0 ? (
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
            ) : (
              <div className="flex items-center justify-center h-full text-muted-foreground">
                Нет данных
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base font-semibold">
              Структура расходов (COGS + OPEX)
            </CardTitle>
          </CardHeader>
          <CardContent className="h-[250px]">
            {expensePieData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={expensePieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={80}
                    paddingAngle={2}
                    dataKey="value"
                  >
                    {expensePieData.map((_, index) => (
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
            ) : (
              <div className="flex items-center justify-center h-full text-muted-foreground">
                Нет данных
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ДИНАМИЧЕСКАЯ ТАБЛИЦА P&L */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mt-6">
        <div className="col-span-2 space-y-6">
          <div className="border rounded-md bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Статья</TableHead>
                  <TableHead className="text-right">Сумма</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {/* БЛОК ДОХОДОВ */}
                <TableRow className="bg-muted/30">
                  <TableCell className="font-bold">Выручка (итого)</TableCell>
                  <TableCell className="text-right font-bold">
                    {summary.revenue.toLocaleString('ru-RU')} ₽
                  </TableCell>
                </TableRow>

                <TableRow className="bg-muted/10">
                  <TableCell className="font-semibold pl-6">
                    <LayoutList className="inline w-4 h-4 mr-2" />
                    Касса (Эвотор)
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    {summary.posRev.toLocaleString('ru-RU')} ₽
                  </TableCell>
                </TableRow>
                <SubRows items={sections.REVENUE_POS} />

                <TableRow className="bg-muted/10">
                  <TableCell className="font-semibold pl-6">
                    <LayoutList className="inline w-4 h-4 mr-2" />
                    Вне кассы (Ручные/Корп)
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    {summary.extTotal.toLocaleString('ru-RU')} ₽
                  </TableCell>
                </TableRow>
                <SubRows items={sections.REVENUE_EXT} />

                {/* БЛОК СЕБЕСТОИМОСТИ И КОМИССИЙ */}
                <TableRow className="bg-muted/30 mt-4">
                  <TableCell className="font-bold">COGS + комиссии</TableCell>
                  <TableCell className="text-right font-bold text-destructive">
                    -{summary.cogsTotal.toLocaleString('ru-RU')} ₽
                  </TableCell>
                </TableRow>

                <TableRow className="bg-muted/10">
                  <TableCell className="font-semibold pl-6">
                    <LayoutList className="inline w-4 h-4 mr-2" />
                    Закупы (Себестоимость)
                  </TableCell>
                  <TableCell></TableCell>
                </TableRow>
                <SubRows items={sections.COGS} isExpense={true} />

                <TableRow className="bg-muted/10">
                  <TableCell className="font-semibold pl-6">
                    <LayoutList className="inline w-4 h-4 mr-2" />
                    Комиссии сервисов и Эквайринг
                  </TableCell>
                  <TableCell></TableCell>
                </TableRow>
                <SubRows items={sections.FEES} isExpense={true} />

                {/* ВАЛОВАЯ ПРИБЫЛЬ */}
                <TableRow className="bg-primary/5 border-y-2 border-primary/20">
                  <TableCell className="font-bold text-lg">
                    Валовая прибыль (Gross)
                  </TableCell>
                  <TableCell className="text-right font-bold text-lg text-primary">
                    {summary.gross.toLocaleString('ru-RU')} ₽
                  </TableCell>
                </TableRow>

                {/* БЛОК OPEX */}
                <TableRow className="bg-muted/30">
                  <TableCell className="font-bold">
                    OPEX (операционные расходы)
                  </TableCell>
                  <TableCell className="text-right font-bold text-destructive">
                    -{summary.opex.toLocaleString('ru-RU')} ₽
                  </TableCell>
                </TableRow>
                <SubRows items={sections.OPEX} isExpense={true} />

                {/* ЧИСТАЯ ПРИБЫЛЬ */}
                <TableRow
                  className={
                    summary.net >= 0 ? 'bg-green-500/10' : 'bg-destructive/10'
                  }
                >
                  <TableCell className="font-bold text-xl">
                    Чистая прибыль
                  </TableCell>
                  <TableCell
                    className={`text-right font-bold text-xl ${summary.net >= 0 ? 'text-green-500' : 'text-destructive'}`}
                  >
                    {summary.net.toLocaleString('ru-RU')} ₽
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </div>
      </div>
      {/* МОДАЛЬНОЕ ОКНО ДЕТАЛИЗАЦИИ */}
      <Dialog
        open={!!detailsModalCat}
        onOpenChange={(open) => !open && setDetailsModalCat(null)}
      >
        <DialogContent className="max-w-[95vw] md:max-w-[85vw] lg:max-w-6xl max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Детализация: {detailsModalCat}</DialogTitle>
          </DialogHeader>

          <div className="flex-1 overflow-auto mt-4 border rounded-md">
            <Table>
              <TableHeader className="bg-muted/50 sticky top-0">
                <TableRow>
                  <TableHead>Дата</TableHead>
                  <TableHead>Источник</TableHead>
                  <TableHead>Позиция / Комментарий</TableHead>
                  <TableHead className="text-right">Сумма</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report?.details
                  // Магия фильтрации: показываем операцию, если выбранная категория есть в её "пути"
                  ?.filter(
                    (d: any) =>
                      d.path?.includes(detailsModalCat) ||
                      d.category === detailsModalCat,
                  )
                  // Сортируем по дате от новых к старым
                  ?.sort(
                    (a: any, b: any) =>
                      new Date(b.date).getTime() - new Date(a.date).getTime(),
                  )
                  .map((detail: any, idx: number) => (
                    <TableRow key={idx}>
                      <TableCell className="whitespace-nowrap">
                        {detail.date
                          ? format(new Date(detail.date), 'dd.MM.yyyy HH:mm')
                          : '—'}
                      </TableCell>
                      <TableCell>
                        {detail.source === 'evotor' && (
                          <Badge
                            variant="outline"
                            className="bg-blue-500/10 text-blue-500"
                          >
                            Касса
                          </Badge>
                        )}
                        {detail.source === 'manual' && (
                          <Badge
                            variant="outline"
                            className="bg-orange-500/10 text-orange-500"
                          >
                            Ручная
                          </Badge>
                        )}
                        {detail.source === 'fee' && (
                          <Badge
                            variant="outline"
                            className="bg-red-500/10 text-red-500"
                          >
                            Комиссия
                          </Badge>
                        )}
                        {detail.source === 'system' && (
                          <Badge
                            variant="outline"
                            className="bg-purple-500/10 text-purple-500"
                          >
                            Система
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <span className="font-medium">
                          {detail.comment || detail.category}
                        </span>
                        {/* Если кликнули на родителя, покажем к какой конкретно подкатегории относится этот чек */}
                        {detail.category !== detailsModalCat && (
                          <span className="ml-2 text-xs text-muted-foreground">
                            ({detail.category})
                          </span>
                        )}
                      </TableCell>
                      <TableCell
                        className={`text-right font-medium ${detail.type === 'expense' ? 'text-destructive' : 'text-green-500'}`}
                      >
                        {detail.type === 'expense' ? '-' : '+'}
                        {detail.amount.toLocaleString('ru-RU')} ₽
                      </TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
