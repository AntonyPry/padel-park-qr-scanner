import { useState, useEffect, useCallback } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import type { ColumnDef } from '@tanstack/react-table';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/data-table';
import { ErrorState } from '@/components/error-state';
import { EmptyState } from '@/components/empty-state';
import { ChartLoadingState } from '@/components/chart-loading-state';
import { toast } from '@/components/ui/toast';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
  Plus,
  ChevronRight,
  LayoutList,
  ChevronDown,
  List,
  Download,
  History,
} from 'lucide-react';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import type { DateRange } from 'react-day-picker';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { apiFetch, getApiErrorMessage } from '@/lib/api';
import { AnimatedDonut, AnimatedMetricValue } from '@/components/animated-data';
import { canExportFinance, canManageFinance } from '@/lib/permissions';
import { useAuthorizationRole } from '@/lib/useAuth';
import { MetricCard } from '@/components/dashboard-metric';
import {
  PermissionActionButton,
  PermissionHint,
} from '@/components/permission-feedback';
import {
  permissionMessages,
  showPermissionDenied,
} from '@/lib/permission-feedback';
import { useRealtimeRefresh } from '@/lib/realtime';

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

const manualFinanceFormSchema = z.object({
  amount: z
    .string()
    .min(1, 'Укажите сумму')
    .refine((value) => Number(value) > 0, {
      message: 'Сумма должна быть больше 0',
    }),
  category: z.string().min(1, 'Выберите категорию'),
  comment: z.string(),
  date: z.string().min(1, 'Укажите дату'),
  type: z.enum(['income', 'expense']),
});
type ManualFinanceForm = z.infer<typeof manualFinanceFormSchema>;

const currencyValueFormatter = new Intl.NumberFormat('ru-RU', {
  maximumFractionDigits: 2,
});

const formatCurrencyValue = (val: unknown) => {
  const rawValue = Array.isArray(val) ? val[0] : val;
  return `${currencyValueFormatter.format(Number(rawValue ?? 0))} ₽`;
};

const INCOME_CHART_COLORS = [
  'hsl(160 84% 39%)',
  'hsl(199 89% 48%)',
  'hsl(262 83% 58%)',
  'hsl(43 96% 56%)',
  'hsl(221 83% 53%)',
  'hsl(173 80% 40%)',
];

const EXPENSE_CHART_COLORS = [
  'hsl(0 84% 60%)',
  'hsl(24 95% 53%)',
  'hsl(43 96% 56%)',
  'hsl(262 83% 58%)',
  'hsl(199 89% 48%)',
  'hsl(340 82% 52%)',
];

const DISTRIBUTION_MAX_ROWS = 7;
const OTHER_CHART_COLOR = 'hsl(240 5% 64%)';

interface DistributionItem {
  isOther?: boolean;
  name: string;
  sourceCount?: number;
  value: number;
}

function buildDistributionItems(items: Array<{ name: string; value: number }>) {
  const normalizedItems = items
    .map((item) => ({
      name: item.name.trim() || 'Без названия',
      value: Number(item.value || 0),
    }))
    .filter((item) => item.value > 0)
    .sort((a, b) => b.value - a.value);

  if (normalizedItems.length <= DISTRIBUTION_MAX_ROWS) {
    return normalizedItems;
  }

  const headItems = normalizedItems.slice(0, DISTRIBUTION_MAX_ROWS - 1);
  const tailItems = normalizedItems.slice(DISTRIBUTION_MAX_ROWS - 1);
  const otherValue = tailItems.reduce((sum, item) => sum + item.value, 0);

  return [
    ...headItems,
    {
      isOther: true,
      name: `Остальное · ${tailItems.length}`,
      sourceCount: tailItems.length,
      value: otherValue,
    },
  ];
}

function DistributionChartCard({
  items,
  title,
  tone,
}: {
  items: Array<{ name: string; value: number }>;
  title: string;
  tone: 'income' | 'expense';
}) {
  const distributionItems: DistributionItem[] = buildDistributionItems(items);
  const colors = tone === 'income' ? INCOME_CHART_COLORS : EXPENSE_CHART_COLORS;
  const total = distributionItems.reduce((sum, item) => sum + Number(item.value || 0), 0);
  const segments = distributionItems.map((item, index) => {
    const value = Number(item.value || 0);
    const color = item.isOther ? OTHER_CHART_COLOR : colors[index % colors.length];

    return {
      color,
      index,
      item,
      percent: total > 0 ? Math.round((value / total) * 100) : 0,
      value,
    };
  });

  return (
    <Card data-finance-distribution={tone}>
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {distributionItems.length > 0 && total > 0 ? (
          <div className="grid min-h-[260px] gap-4 md:grid-cols-[240px_minmax(0,1fr)] md:items-center">
            <div className="relative mx-auto h-[220px] w-[220px]">
              <AnimatedDonut
                ariaLabel={title}
                items={segments.map(({ color, item, value }) => ({
                  color,
                  id: item.name,
                  title: `${item.name}: ${formatCurrencyValue(value)}`,
                  value,
                }))}
              />
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <div className="text-center">
                  <div className="text-xl font-semibold">
                    <AnimatedMetricValue value={formatCurrencyValue(total)} />
                  </div>
                  <div className="text-xs text-muted-foreground">итого</div>
                </div>
              </div>
            </div>
            <div className="flex min-w-0 flex-col gap-2">
              {segments.map(({ color, item, percent }) => (
                <div
                  key={item.name}
                  className="flex min-w-0 items-center gap-3 rounded-xl bg-muted/25 px-3 py-2 text-sm"
                  title={
                    item.sourceCount
                      ? `Сумма ${item.sourceCount} небольших категорий`
                      : item.name
                  }
                >
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: color }}
                  />
                  <span
                    data-distribution-label
                    className="min-w-0 flex-1 truncate text-muted-foreground"
                  >
                    {item.name}
                  </span>
                  <span className="shrink-0 font-medium">{percent}%</span>
                  <span className="shrink-0 text-muted-foreground">
                    <AnimatedMetricValue value={formatCurrencyValue(item.value)} />
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex min-h-[260px] items-center justify-center text-sm text-muted-foreground">
            Нет данных
          </div>
        )}
      </CardContent>
    </Card>
  );
}

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

async function readError(response: Response, fallback: string) {
  try {
    const data = (await response.json()) as { error?: string };
    return data.error || fallback;
  } catch {
    return fallback;
  }
}

export default function FinancePage() {
  const clubRole = useAuthorizationRole('club');
  const canEditFinance = canManageFinance(clubRole);
  const canDownloadFinance = canExportFinance(clubRole);
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
  const manualForm = useForm<ManualFinanceForm>({
    defaultValues: {
      amount: '',
      category: '',
      comment: '',
      date: todayStr,
      type: 'expense',
    },
    resolver: zodResolver(manualFinanceFormSchema),
  });
  const manualType = manualForm.watch('type');
  const manualCategory = manualForm.watch('category');

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
      setErrorMessage('Не удалось загрузить финансовый отчет');
    } finally {
      setLoading(false);
    }
  }, [dateRange]);

  useEffect(() => {
    void fetchFinances();
  }, [fetchFinances]); // Автоматически перезапрашиваем при смене дат

  useRealtimeRefresh(
    ['finance', 'payroll', 'catalog', 'corporateClients', 'prepayments'],
    () => {
      void fetchFinances();
    },
  );

  const handleAddManual = manualForm.handleSubmit(async (values) => {
    if (!canEditFinance) {
      showPermissionDenied(permissionMessages.financeManage);
      return;
    }

    try {
      const res = await apiFetch('/api/finance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      });
      if (res.ok) {
        setIsModalOpen(false);
        manualForm.reset({
          amount: '',
          category: '',
          comment: '',
          date: values.date,
          type: values.type,
        });
        void fetchFinances();
      } else {
        setErrorMessage(await readError(res, 'Не удалось добавить операцию'));
      }
    } catch (e) {
      console.error(e);
      setErrorMessage('Не удалось добавить операцию');
    }
  });

  const handleExport = async () => {
    const fromStr = dateRange?.from ? format(dateRange.from, 'yyyy-MM-dd') : '';
    const toStr = dateRange?.to ? format(dateRange.to, 'yyyy-MM-dd') : '';
    try {
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
      toast.success('Финансовый отчет выгружен');
    } catch (error) {
      setErrorMessage(getApiErrorMessage(error, 'Не удалось выгрузить финансовый отчет'));
    }
  };

  if (!report) {
    return (
      <div className="flex flex-col gap-5">
        {loading ? (
          <ChartLoadingState title="Загрузка финансового отчета" />
        ) : errorMessage ? (
          <ErrorState
            message={errorMessage}
            onRetry={() => void fetchFinances()}
            title="Финансовый отчет не загрузился"
          />
        ) : (
          <EmptyState
            title="Нет данных для отчета"
            description="Выберите другой период или проверьте операции."
          />
        )}
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
  const historyColumns: ColumnDef<FinanceHistoryItem>[] = [
    {
      accessorKey: 'createdAt',
      header: 'Дата',
      meta: {
        cellClassName: 'whitespace-nowrap',
      },
      cell: ({ row }) => format(new Date(row.original.createdAt), 'dd.MM.yyyy HH:mm'),
    },
    {
      accessorKey: 'action',
      header: 'Действие',
      meta: {
        cellClassName: 'font-medium',
      },
      cell: ({ row }) => getFinanceActionLabel(row.original.action),
    },
    {
      id: 'period',
      header: 'Период/операция',
      meta: {
        cellClassName: 'text-muted-foreground',
      },
      cell: ({ row }) => {
        const item = row.original;

        return item.fromDate && item.toDate
          ? `${item.fromDate} — ${item.toDate}`
          : item.date || item.entityId || '-';
      },
    },
    {
      id: 'actor',
      header: 'Кто',
      cell: ({ row }) =>
        row.original.account?.name || row.original.account?.email || '-',
    },
    {
      accessorKey: 'reason',
      header: 'Причина',
      meta: {
        cellClassName: 'max-w-[260px] truncate',
      },
      cell: ({ row }) => row.original.reason || '-',
    },
  ];

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-end">
        <div className="flex w-full flex-wrap items-center gap-3 sm:w-auto">
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

          {canDownloadFinance && (
            <Button variant="outline" onClick={handleExport}>
              <Download className="w-4 h-4 mr-2" /> Экспорт
            </Button>
          )}

          <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
            {canEditFinance ? (
              <DialogTrigger asChild>
                <Button>
                  <Plus className="w-4 h-4 mr-2" /> Добавить
                </Button>
              </DialogTrigger>
            ) : (
              <PermissionActionButton
                allowed={false}
                deniedMessage={permissionMessages.financeManage}
              >
                <Plus className="w-4 h-4 mr-2" /> Добавить
              </PermissionActionButton>
            )}
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Новая запись</DialogTitle>
                <DialogDescription className="sr-only">
                  Добавьте ручную финансовую запись.
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={handleAddManual} className="space-y-4 pt-4">
                <div className="grid grid-cols-2 gap-4">
                  <Button
                    type="button"
                    variant={manualType === 'income' ? 'default' : 'outline'}
                    className={
                      manualType === 'income'
                        ? 'bg-green-600 hover:bg-green-700'
                        : ''
                    }
                    onClick={() => {
                      manualForm.setValue('type', 'income', {
                        shouldDirty: true,
                        shouldValidate: true,
                      });
                      manualForm.setValue('category', '', {
                        shouldDirty: true,
                        shouldValidate: true,
                      });
                    }}
                  >
                    Доход
                  </Button>
                  <Button
                    type="button"
                    variant={manualType === 'expense' ? 'default' : 'outline'}
                    className={
                      manualType === 'expense'
                        ? 'bg-destructive hover:bg-destructive/90'
                        : ''
                    }
                    onClick={() => {
                      manualForm.setValue('type', 'expense', {
                        shouldDirty: true,
                        shouldValidate: true,
                      });
                      manualForm.setValue('category', '', {
                        shouldDirty: true,
                        shouldValidate: true,
                      });
                    }}
                  >
                    Расход
                  </Button>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Дата</Label>
                <Input
                  type="date"
                    {...manualForm.register('date')}
                    aria-invalid={Boolean(manualForm.formState.errors.date)}
                />
                  {manualForm.formState.errors.date && (
                    <p className="text-xs text-destructive">
                      {manualForm.formState.errors.date.message}
                    </p>
                  )}
                </div>

                <div className="space-y-1">
                  <Label className="text-xs">Категория</Label>
                <Select
                    value={manualCategory}
                    onValueChange={(value) =>
                      manualForm.setValue('category', value, {
                        shouldDirty: true,
                        shouldValidate: true,
                      })
                    }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Выберите категорию из базы" />
                  </SelectTrigger>
                  <SelectContent>
                    {categories
                        .filter((category) => category.type === manualType)
                      .map((c) => (
                        <SelectItem key={c.id} value={c.name}>
                          {c.name}
                        </SelectItem>
                      ))}
                      {categories.filter((category) => category.type === manualType)
                        .length === 0 && (
                      <SelectItem value="empty" disabled>
                        Нет созданных категорий
                      </SelectItem>
                    )}
                  </SelectContent>
                </Select>
                  {manualForm.formState.errors.category && (
                    <p className="text-xs text-destructive">
                      {manualForm.formState.errors.category.message}
                    </p>
                  )}
                </div>

                <div className="space-y-1">
                  <Label className="text-xs">Сумма</Label>
                <Input
                  type="number"
                  placeholder="Сумма"
                    {...manualForm.register('amount')}
                    aria-invalid={Boolean(manualForm.formState.errors.amount)}
                />
                  {manualForm.formState.errors.amount && (
                    <p className="text-xs text-destructive">
                      {manualForm.formState.errors.amount.message}
                    </p>
                  )}
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Комментарий</Label>
                <Input
                  placeholder="Комментарий"
                    {...manualForm.register('comment')}
                />
                </div>
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
      {!canEditFinance && (
        <PermissionHint>{permissionMessages.financeManage}</PermissionHint>
      )}

      {/* KPI карточки (берем прямо из summary) */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        <MetricCard
          label="Выручка"
          tooltip="Все доходы за выбранный период: касса Эвотор и ручные доходные операции."
          value={formatCurrencyValue(summary.revenue)}
        />
        <MetricCard
          label="Валовая прибыль"
          tooltip="Выручка минус себестоимость и комиссии."
          value={formatCurrencyValue(summary.gross)}
        />
        <MetricCard
          label="Опер. расходы"
          tooltip="Операционные расходы, включая автоматический расчет зарплаты администраторов."
          value={formatCurrencyValue(summary.opex)}
        />
        <MetricCard
          label="Чистая прибыль"
          tooltip="Итоговый финансовый результат после себестоимости, комиссий и операционных расходов."
          value={formatCurrencyValue(summary.net)}
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
          value={formatCurrencyValue(report.reconciliation?.difference || 0)}
          valueClassName={
            Math.abs(Number(report.reconciliation?.difference || 0)) <= 1
              ? 'text-green-500'
              : 'text-amber-500'
          }
        />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <DistributionChartCard
          items={incomePieData}
          title="Структура выручки"
          tone="income"
        />
        <DistributionChartCard
          items={expensePieData}
          title="Структура расходов"
          tone="expense"
        />
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
        <DataTable
          columns={historyColumns}
          data={history}
          emptyText="Изменений за период пока нет"
          minWidthClassName="min-w-[760px]"
        />
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
