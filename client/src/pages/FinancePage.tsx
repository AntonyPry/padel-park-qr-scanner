import { useState, useEffect, useCallback } from 'react';
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
  Download,
  History,
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
import { Badge } from '@/components/ui/badge';
import { apiFetch } from '@/lib/api';
import { canExportFinance, canManageFinance } from '@/lib/permissions';
import { useAuth } from '@/lib/useAuth';
import { MetricCard } from '@/components/dashboard-metric';

const PIE_COLORS = [
  '#3b82f6',
  '#10b981',
  '#f59e0b',
  '#ef4444',
  '#8b5cf6',
  '#06b6d4',
  '#64748b',
];

interface CatalogCategory {
  id: number;
  name: string;
  type: 'income' | 'expense' | string;
}

interface PnlSummary {
  revenue: number;
  posRev: number;
  extTotal: number;
  cogsTotal: number;
  gross: number;
  opex: number;
  net: number;
  margin: number;
  cash?: number;
  cashless?: number;
}

interface PnlSectionItem {
  name: string;
  sum: number;
  subItems: PnlSectionItem[];
}

interface PnlDetail {
  category: string;
  path?: string[];
  amount: number;
  type: 'income' | 'expense' | string;
  comment?: string;
  source: 'evotor' | 'manual' | 'fee' | 'system' | string;
  date?: string;
}

interface FinanceReport {
  summary: PnlSummary;
  reconciliation?: {
    receiptCount: number;
    receiptsTotal: number;
    receiptItemsTotal: number;
    difference: number;
  };
  sections: {
    REVENUE_POS: PnlSectionItem[];
    REVENUE_EXT: PnlSectionItem[];
    COGS: PnlSectionItem[];
    FEES: PnlSectionItem[];
    OPEX: PnlSectionItem[];
  };
  details: PnlDetail[];
}

interface FinanceHistoryItem {
  id: number;
  action: string;
  entityType: string;
  entityId?: string | null;
  date?: string | null;
  fromDate?: string | null;
  toDate?: string | null;
  reason?: string | null;
  createdAt: string;
  account?: {
    name?: string;
    email?: string;
    role?: string;
  } | null;
}

interface ManualFinanceForm {
  date: string;
  category: string;
  amount: string;
  type: 'income' | 'expense';
  comment: string;
}

const formatCurrencyValue = (val: unknown) => {
  const rawValue = Array.isArray(val) ? val[0] : val;
  return `${Number(rawValue ?? 0).toLocaleString()} ₽`;
};

const FINANCE_ACTION_LABELS: Record<string, string> = {
  'finance_manual.create': 'Ручная операция добавлена',
  'finance_report.export': 'Финансовый отчет выгружен',
  'payroll.export': 'Payroll выгружен',
  'payroll_period.approved': 'Payroll утвержден',
  'payroll_period.create': 'Payroll-период создан',
  'payroll_period.draft': 'Payroll возвращен в черновик',
  'payroll_period.paid': 'Payroll выплачен',
  'payroll_period.recalculate': 'Payroll пересчитан',
  'payroll_period.reviewed': 'Payroll отправлен на проверку',
  'shift.archive': 'Смена архивирована',
  'shift.close': 'Смена завершена',
  'shift.create': 'Смена создана',
  'shift.start': 'Смена начата',
  'shift.update': 'Смена изменена',
};

function getFinanceActionLabel(action: string) {
  return FINANCE_ACTION_LABELS[action] || action;
}

export default function FinancePage() {
  const { account } = useAuth();
  const canEditFinance = canManageFinance(account?.role);
  const canDownloadFinance = canExportFinance(account?.role);
  const [report, setReport] = useState<FinanceReport | null>(null);
  const [history, setHistory] = useState<FinanceHistoryItem[]>([]);
  const [categories, setCategories] = useState<CatalogCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');
  const [detailsModalCat, setDetailsModalCat] = useState<string | null>(null);

  const now = new Date();
  const [dateRange, setDateRange] = useState<DateRange | undefined>({
    from: new Date(now.getFullYear(), now.getMonth(), 1),
    to: now,
  });

  const [isModalOpen, setIsModalOpen] = useState(false);
  const todayStr = now.toISOString().split('T')[0];
  const [form, setForm] = useState<ManualFinanceForm>({
    date: todayStr,
    category: '',
    amount: '',
    type: 'expense',
    comment: '',
  });

  const fetchFinances = useCallback(async () => {
    setLoading(true);
    setErrorMessage('');
    try {
      // Передаем даты на бэкенд, чтобы он сам всё отфильтровал
      const fromStr = dateRange?.from
        ? format(dateRange.from, 'yyyy-MM-dd')
        : '';
      const toStr = dateRange?.to ? format(dateRange.to, 'yyyy-MM-dd') : '';

      const [finRes, catRes] = await Promise.all([
        apiFetch(`/api/finance?from=${fromStr}&to=${toStr}`),
        apiFetch('/api/catalog/categories'),
      ]);

      if (finRes.ok) {
        setReport((await finRes.json()) as FinanceReport);
      } else {
        const data = (await finRes.json().catch(() => ({}))) as {
          error?: string;
        };
        setReport(null);
        setErrorMessage(data.error || 'Не удалось загрузить финансовый отчет');
      }
      if (catRes.ok) setCategories((await catRes.json()) as CatalogCategory[]);

      const historyRes = await apiFetch(
        `/api/finance/history?from=${fromStr}&to=${toStr}&limit=10`,
      );
      if (historyRes.ok) {
        setHistory((await historyRes.json()) as FinanceHistoryItem[]);
      }
    } catch (e) {
      console.error(e);
      setReport(null);
      setErrorMessage('Не удалось загрузить финансовый отчет');
    } finally {
      setLoading(false);
    }
  }, [dateRange]);

  useEffect(() => {
    void fetchFinances();
  }, [fetchFinances]); // Автоматически перезапрашиваем при смене дат

  const handleAddManual = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await apiFetch('/api/finance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (res.ok) {
        setIsModalOpen(false);
        setForm({ ...form, category: '', amount: '', comment: '' });
        void fetchFinances();
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleExport = async () => {
    const fromStr = dateRange?.from ? format(dateRange.from, 'yyyy-MM-dd') : '';
    const toStr = dateRange?.to ? format(dateRange.to, 'yyyy-MM-dd') : '';
    const res = await apiFetch(`/api/finance/export?from=${fromStr}&to=${toStr}`);

    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setErrorMessage(data.error || 'Не удалось выгрузить финансовый отчет');
      return;
    }

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `pnl-${fromStr || 'start'}-${toStr || 'end'}.xlsx`;
    link.click();
    URL.revokeObjectURL(url);
  };

  if (!report) {
    return (
      <div className="p-6 md:p-8 space-y-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Финансы</h1>
          <p className="text-muted-foreground mt-1">
            P&L: прибыль, расходы, касса и ручные операции.
          </p>
        </div>
        <div className="rounded-md border bg-card px-4 py-8 text-center text-muted-foreground">
          {loading ? 'Загрузка финансового отчета...' : errorMessage || 'Нет данных для отчета'}
        </div>
      </div>
    );
  }

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
    item: PnlSectionItem;
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
                title={`Показать детализацию: ${item.name}`}
                aria-label={`Показать детализацию: ${item.name}`}
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
          item.subItems.map((subItem, idx) => (
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
    items: PnlSectionItem[];
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
          <h1 className="text-3xl font-bold tracking-tight">Финансы</h1>
          <p className="text-muted-foreground mt-1">
            P&L: прибыль, расходы, касса и ручные операции.
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
            title="Обновить отчет"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>

          {canDownloadFinance && (
            <Button variant="outline" onClick={handleExport}>
              <Download className="w-4 h-4 mr-2" /> Экспорт
            </Button>
          )}

          <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
            {canEditFinance && (
              <DialogTrigger asChild>
                <Button>
                  <Plus className="w-4 h-4 mr-2" /> Добавить
                </Button>
              </DialogTrigger>
            )}
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

      {errorMessage && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {errorMessage}
        </div>
      )}

      {/* KPI карточки (берем прямо из summary) */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        <MetricCard
          label="Выручка"
          tooltip="Все доходы за выбранный период: касса Эвотор и ручные доходные операции."
          value={`${summary.revenue.toLocaleString('ru-RU')} ₽`}
        />
        <MetricCard
          label="Валовая прибыль"
          tooltip="Выручка минус себестоимость и комиссии."
          value={`${summary.gross.toLocaleString('ru-RU')} ₽`}
        />
        <MetricCard
          label="Опер. расходы"
          tooltip="Операционные расходы, включая автоматический расчет зарплаты администраторов."
          value={`${summary.opex.toLocaleString('ru-RU')} ₽`}
        />
        <MetricCard
          label="Чистая прибыль"
          tooltip="Итоговый финансовый результат после себестоимости, комиссий и операционных расходов."
          value={`${summary.net.toLocaleString('ru-RU')} ₽`}
          valueClassName={summary.net >= 0 ? 'text-green-500' : 'text-destructive'}
        />
        <MetricCard
          label="Рентабельность"
          tooltip="Доля чистой прибыли от общей выручки."
          value={`${summary.margin.toFixed(1)} %`}
        />
        <MetricCard
          label="Сверка чеков"
          tooltip="Разница между суммой чеков Эвотора и суммой их позиций. Ноль означает, что чековая сумма и позиции сходятся."
          value={`${Number(report.reconciliation?.difference || 0).toLocaleString('ru-RU')} ₽`}
          valueClassName={
            Math.abs(Number(report.reconciliation?.difference || 0)) <= 1
              ? 'text-green-500'
              : 'text-amber-500'
          }
        />
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
              <ResponsiveContainer width="100%" height={250} minWidth={240}>
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
                    formatter={formatCurrencyValue}
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
              Структура расходов
            </CardTitle>
          </CardHeader>
          <CardContent className="h-[250px]">
            {expensePieData.length > 0 ? (
              <ResponsiveContainer width="100%" height={250} minWidth={240}>
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
                    formatter={formatCurrencyValue}
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
        <div className="lg:col-span-2 space-y-6">
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
                    Вне кассы
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    {summary.extTotal.toLocaleString('ru-RU')} ₽
                  </TableCell>
                </TableRow>
                <SubRows items={sections.REVENUE_EXT} />

                {/* БЛОК СЕБЕСТОИМОСТИ И КОМИССИЙ */}
                <TableRow className="bg-muted/30 mt-4">
                  <TableCell className="font-bold">
                    Себестоимость и комиссии
                  </TableCell>
                  <TableCell className="text-right font-bold text-destructive">
                    -{summary.cogsTotal.toLocaleString('ru-RU')} ₽
                  </TableCell>
                </TableRow>

                <TableRow className="bg-muted/10">
                  <TableCell className="font-semibold pl-6">
                    <LayoutList className="inline w-4 h-4 mr-2" />
                    Закупы
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
                    Валовая прибыль
                  </TableCell>
                  <TableCell className="text-right font-bold text-lg text-primary">
                    {summary.gross.toLocaleString('ru-RU')} ₽
                  </TableCell>
                </TableRow>

                {/* БЛОК OPEX */}
                <TableRow className="bg-muted/30">
                  <TableCell className="font-bold">
                    Операционные расходы
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
      <div className="border rounded-md bg-card overflow-hidden">
        <div className="px-4 py-3 border-b flex items-center gap-2">
          <History className="h-4 w-4 text-muted-foreground" />
          <div>
            <div className="font-semibold">Финансовая история</div>
            <div className="text-xs text-muted-foreground">
              Кто менял смены, ручные операции, payroll-периоды и выгрузки.
            </div>
          </div>
        </div>
        <Table className="min-w-[760px]">
          <TableHeader>
            <TableRow>
              <TableHead>Дата</TableHead>
              <TableHead>Действие</TableHead>
              <TableHead>Период/операция</TableHead>
              <TableHead>Кто</TableHead>
              <TableHead>Причина</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {history.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                  Изменений за период пока нет
                </TableCell>
              </TableRow>
            )}
            {history.map((item) => (
              <TableRow key={item.id}>
                <TableCell className="whitespace-nowrap">
                  {format(new Date(item.createdAt), 'dd.MM.yyyy HH:mm')}
                </TableCell>
                <TableCell className="font-medium">
                  {getFinanceActionLabel(item.action)}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {item.fromDate && item.toDate
                    ? `${item.fromDate} — ${item.toDate}`
                    : item.date || item.entityId || '-'}
                </TableCell>
                <TableCell>{item.account?.name || item.account?.email || '-'}</TableCell>
                <TableCell className="max-w-[260px] truncate">
                  {item.reason || '-'}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
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
                {[...(report?.details || [])]
                  // Магия фильтрации: показываем операцию, если выбранная категория есть в её "пути"
                  ?.filter(
                    (d) =>
                      (detailsModalCat !== null &&
                        d.path?.includes(detailsModalCat)) ||
                      d.category === detailsModalCat,
                  )
                  // Сортируем по дате от новых к старым
                  ?.sort(
                    (a, b) =>
                      new Date(b.date || 0).getTime() -
                      new Date(a.date || 0).getTime(),
                  )
                  .map((detail, idx) => (
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
