import { useState, useMemo } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import {
  listUtilization,
  saveUtilization,
  type UtilizationRecord,
} from '@/api/utilization';
import { queryKeys } from '@/api/query-keys';
import { ErrorState } from '@/components/error-state';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/toast';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  Line,
  ComposedChart,
} from 'recharts';
import {
  Plus,
  Calendar as CalendarIcon,
  RefreshCw,
  Lightbulb,
  TrendingUp,
  TrendingDown,
  Target,
  Clock,
} from 'lucide-react';
import { format, startOfMonth, subDays } from 'date-fns';
import { ru } from 'date-fns/locale';
import type { DateRange } from 'react-day-picker';
import { cn } from '@/lib/utils';
import { canManageUtilization } from '@/lib/permissions';
import { useAuth } from '@/lib/useAuth';
import { getApiErrorMessage } from '@/lib/api';

const CAP_15 = 15 * 5; // 75 часов (5 кортов 2х2 по 15 часов)
const CAP_6 = 15; // 15 часов (1 корт 1х1)
const TOTAL_CAPACITY = CAP_15 + CAP_6;

interface WeekdayStat {
  name: string;
  val: number;
}

type CourtFilter = 'all' | '2x2' | '1x1';

const optionalHoursSchema = z
  .string()
  .trim()
  .refine((value) => !value || Number(value) >= 0, {
    message: 'Введите число не меньше 0',
  });

const optionalSessionsSchema = z
  .string()
  .trim()
  .refine((value) => !value || Number.isInteger(Number(value)), {
    message: 'Введите целое число',
  })
  .refine((value) => !value || Number(value) >= 0, {
    message: 'Введите число не меньше 0',
  });

const utilizationFormSchema = z.object({
  batchText: z.string(),
  booked1: optionalHoursSchema,
  booked2: optionalHoursSchema,
  date: z.string().min(1, 'Укажите дату'),
  sessions1: optionalSessionsSchema,
  sessions2: optionalSessionsSchema,
});

type UtilizationFormValues = z.infer<typeof utilizationFormSchema>;

function getEmptyUtilizationForm(): UtilizationFormValues {
  return {
    batchText: '',
    booked1: '',
    booked2: '',
    date: format(new Date(), 'yyyy-MM-dd'),
    sessions1: '',
    sessions2: '',
  };
}

export default function UtilizationPage() {
  const { account } = useAuth();
  const queryClient = useQueryClient();
  const canEditUtilization = canManageUtilization(account?.role);
  const [isOpen, setIsOpen] = useState(false);
  const [courtFilter, setCourtFilter] = useState<CourtFilter>('all');

  const [dateRange, setDateRange] = useState<DateRange | undefined>({
    from: subDays(new Date(), 30),
    to: new Date(),
  });

  const [addMode, setAddMode] = useState<'single' | 'batch'>('single');
  const utilizationForm = useForm<UtilizationFormValues>({
    defaultValues: getEmptyUtilizationForm(),
    resolver: zodResolver(utilizationFormSchema),
  });

  const utilizationQuery = useQuery({
    queryFn: listUtilization,
    queryKey: queryKeys.utilization.list(),
  });
  const data = useMemo(
    () => utilizationQuery.data || [],
    [utilizationQuery.data],
  );
  const loading = utilizationQuery.isLoading || utilizationQuery.isFetching;
  const errorText = utilizationQuery.isError
    ? getApiErrorMessage(utilizationQuery.error, 'Не удалось загрузить утилизацию кортов')
    : '';
  const saveUtilizationMutation = useMutation({
    mutationFn: saveUtilization,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.utilization.all }),
  });

  const parseBatchData = (text: string): UtilizationRecord[] => {
    const year = new Date().getFullYear();
    const parsed: Array<UtilizationRecord | null> = text
      .split('\n')
      .map((line) => {
        const trimmed = line.trim();
        if (!trimmed) return null;
        const [dateStr, b2s2, b1s1] = trimmed.split(/\s+/);
        if (!dateStr || !b2s2 || !b1s1) return null;
        const [day, month] = dateStr.split('.');
        const [booked2, sessions2] = b2s2.split('/');
        const [booked1, sessions1] = b1s1.split('/');
        return {
          date: `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`,
          booked2: Number(booked2) || 0,
          sessions2: Number(sessions2) || 0,
          booked1: Number(booked1) || 0,
          sessions1: Number(sessions1) || 0,
        };
      });

    return parsed.filter((item): item is UtilizationRecord => item !== null);
  };

  const handleSubmit = utilizationForm.handleSubmit(async (values) => {
    const payload =
      addMode === 'single'
        ? [
            {
              booked1: values.booked1 || 0,
              booked2: values.booked2 || 0,
              date: values.date,
              sessions1: values.sessions1 || 0,
              sessions2: values.sessions2 || 0,
            },
          ]
        : parseBatchData(values.batchText);
    if (!payload.length) {
      toast.error('Не удалось распознать данные');
      return;
    }

    try {
      await saveUtilizationMutation.mutateAsync(payload);
      setIsOpen(false);
      utilizationForm.reset({
        ...utilizationForm.getValues(),
        batchText: '',
        booked2: '',
        sessions2: '',
        booked1: '',
        sessions1: '',
      });
      toast.success('Данные загрузки сохранены');
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'Не удалось сохранить данные загрузки'));
    }
  });

  const stats = useMemo(() => {
    const from = dateRange?.from || startOfMonth(new Date());
    const to = dateRange?.to || new Date();

    const periodData = data
      .filter((d) => {
        const dt = new Date(d.date);
        return dt >= from && dt <= to;
      })
      .sort((a, b) => a.date.localeCompare(b.date));
    if (!periodData.length) return null;

    let totalHours2 = 0,
      totalHours1 = 0,
      totalSessions2 = 0,
      totalSessions1 = 0;
    periodData.forEach((d) => {
      totalHours2 += Number(d.booked2);
      totalHours1 += Number(d.booked1);
      totalSessions2 += Number(d.sessions2 || 0);
      totalSessions1 += Number(d.sessions1 || 0);
    });

    const totalHours = totalHours2 + totalHours1;
    const avgUtil = (totalHours / (periodData.length * TOTAL_CAPACITY)) * 100;
    const avg2 = (totalHours2 / (periodData.length * CAP_15)) * 100;
    const avg1 = (totalHours1 / (periodData.length * CAP_6)) * 100;

    // Среднее время сессии
    const avgSessionAll =
      totalSessions1 + totalSessions2 > 0
        ? (totalHours / (totalSessions1 + totalSessions2)).toFixed(1)
        : '0';
    const avgSession2 =
      totalSessions2 > 0 ? (totalHours2 / totalSessions2).toFixed(1) : '0';
    const avgSession1 =
      totalSessions1 > 0 ? (totalHours1 / totalSessions1).toFixed(1) : '0';

    const getDayUtil = (d: UtilizationRecord) => {
      if (courtFilter === '2x2') return (Number(d.booked2) / CAP_15) * 100;
      if (courtFilter === '1x1') return (Number(d.booked1) / CAP_6) * 100;
      return ((Number(d.booked2) + Number(d.booked1)) / TOTAL_CAPACITY) * 100;
    };

    const sortedByUtil = [...periodData].sort(
      (a, b) => getDayUtil(b) - getDayUtil(a),
    );

    const weekdayMap: Record<string, { name: string; sum: number; count: number }> =
      {};
    const daysRu = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
    periodData.forEach((d) => {
      const dayName = daysRu[new Date(d.date).getDay()];
      if (!weekdayMap[dayName])
        weekdayMap[dayName] = { name: dayName, sum: 0, count: 0 };
      weekdayMap[dayName].sum += getDayUtil(d) / 100; // Держим в долях для расчета среднего
      weekdayMap[dayName].count++;
    });
    const weekdays = Object.values(weekdayMap)
      .map((w): WeekdayStat => ({
        name: w.name,
        val: Math.round((w.sum / w.count) * 100),
      }))
      .sort((a, b) => b.val - a.val);

    const chartData = periodData.map((d, i) => {
      const window = periodData.slice(Math.max(0, i - 6), i + 1);
      const ma7 =
        window.reduce((s, x) => s + getDayUtil(x) / 100, 0) / window.length;
      return {
        date: format(new Date(d.date), 'dd.MM'),
        'Загрузка %': Math.round(getDayUtil(d)),
        MA7: Math.round(ma7 * 100),
      };
    });

    return {
      avgUtil,
      avg2,
      avg1,
      totalHours,
      avgSessionAll,
      avgSession2,
      avgSession1,
      bestDay: sortedByUtil[0],
      worstDay: sortedByUtil[sortedByUtil.length - 1],
      weekdays,
      chartData,
      periodData,
      getDayUtil,
    };
  }, [data, dateRange, courtFilter]);

  const getHeatColor = (val: number) => {
    const p = val / 100;
    if (p < 0.4) return 'bg-blue-500/20 text-blue-400';
    if (p < 0.7) return 'bg-orange-500/30 text-orange-400';
    return 'bg-red-500/40 text-red-400';
  };

  return (
    <div className="p-6 md:p-8 space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">
            Утилизация кортов
          </h1>
          <p className="text-muted-foreground mt-1">
            Анализ загрузки площадок и сессий
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
            onClick={() => void utilizationQuery.refetch()}
            disabled={loading}
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
          <Dialog open={isOpen} onOpenChange={setIsOpen}>
            {canEditUtilization && (
              <DialogTrigger asChild>
                <Button>
                  <Plus className="w-4 h-4 mr-2" /> Внести данные
                </Button>
              </DialogTrigger>
            )}
            <DialogContent className="sm:max-w-[425px]">
              <DialogHeader>
                <DialogTitle>Загрузка за день</DialogTitle>
              </DialogHeader>
              <div className="flex gap-2 mb-4 bg-muted p-1 rounded-md">
                <Button
                  variant={addMode === 'single' ? 'default' : 'ghost'}
                  size="sm"
                  className="flex-1"
                  onClick={() => setAddMode('single')}
                >
                  Одиночное
                </Button>
                <Button
                  variant={addMode === 'batch' ? 'default' : 'ghost'}
                  size="sm"
                  className="flex-1"
                  onClick={() => setAddMode('batch')}
                >
                  Массовое
                </Button>
              </div>
              <form onSubmit={handleSubmit} className="space-y-4">
                {addMode === 'single' ? (
                  <>
                    <Input
                      type="date"
                      required
                      aria-invalid={Boolean(
                        utilizationForm.formState.errors.date,
                      )}
                      {...utilizationForm.register('date')}
                    />
                    {utilizationForm.formState.errors.date && (
                      <div className="text-xs text-destructive">
                        {utilizationForm.formState.errors.date.message}
                      </div>
                    )}
                    <div className="space-y-3">
                      <div className="text-sm font-semibold border-b pb-1">
                        Корты 2x2
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1">
                          <Label className="text-xs text-muted-foreground">
                            Занято часов
                          </Label>
                          <Input
                            type="number"
                            step="0.5"
                            aria-invalid={Boolean(
                              utilizationForm.formState.errors.booked2,
                            )}
                            {...utilizationForm.register('booked2')}
                          />
                          {utilizationForm.formState.errors.booked2 && (
                            <div className="text-xs text-destructive">
                              {utilizationForm.formState.errors.booked2.message}
                            </div>
                          )}
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs text-muted-foreground">
                            Кол-во сессий
                          </Label>
                          <Input
                            type="number"
                            aria-invalid={Boolean(
                              utilizationForm.formState.errors.sessions2,
                            )}
                            {...utilizationForm.register('sessions2')}
                          />
                          {utilizationForm.formState.errors.sessions2 && (
                            <div className="text-xs text-destructive">
                              {
                                utilizationForm.formState.errors.sessions2
                                  .message
                              }
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="space-y-3">
                      <div className="text-sm font-semibold border-b pb-1">
                        Корт 1x1
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1">
                          <Label className="text-xs text-muted-foreground">
                            Занято часов
                          </Label>
                          <Input
                            type="number"
                            step="0.5"
                            aria-invalid={Boolean(
                              utilizationForm.formState.errors.booked1,
                            )}
                            {...utilizationForm.register('booked1')}
                          />
                          {utilizationForm.formState.errors.booked1 && (
                            <div className="text-xs text-destructive">
                              {utilizationForm.formState.errors.booked1.message}
                            </div>
                          )}
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs text-muted-foreground">
                            Кол-во сессий
                          </Label>
                          <Input
                            type="number"
                            aria-invalid={Boolean(
                              utilizationForm.formState.errors.sessions1,
                            )}
                            {...utilizationForm.register('sessions1')}
                          />
                          {utilizationForm.formState.errors.sessions1 && (
                            <div className="text-xs text-destructive">
                              {
                                utilizationForm.formState.errors.sessions1
                                  .message
                              }
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground">
                      Формат: ДД.ММ [Часы 2х2]/[Сессии 2х2] [Часы 1х1]/[Сессии
                      1х1]
                    </Label>
                    <textarea
                      required
                      className="flex min-h-[150px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm"
                      {...utilizationForm.register('batchText')}
                    />
                  </div>
                )}
                <Button
                  type="submit"
                  className="w-full"
                  disabled={saveUtilizationMutation.isPending}
                >
                  Сохранить
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {errorText && data.length === 0 && (
        <ErrorState
          message={errorText}
          onRetry={() => void utilizationQuery.refetch()}
          title="Утилизация не загрузилась"
        />
      )}

      {stats && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-4 xl:grid-cols-8 gap-4">
            <Card className="bg-primary text-primary-foreground">
              <CardContent className="pt-6">
                <div className="text-[10px] opacity-80 font-medium uppercase truncate">
                  Ср. загрузка
                </div>
                <div className="text-xl font-bold mt-1">
                  {Math.round(stats.avgUtil)}%
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="text-[10px] text-muted-foreground font-medium uppercase truncate">
                  Корты 2×2
                </div>
                <div className="text-xl font-bold mt-1">
                  {Math.round(stats.avg2)}%
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="text-[10px] text-muted-foreground font-medium uppercase truncate">
                  Корт 1×1
                </div>
                <div className="text-xl font-bold mt-1">
                  {Math.round(stats.avg1)}%
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="text-[10px] text-muted-foreground font-medium uppercase truncate">
                  Всего часов
                </div>
                <div className="text-xl font-bold mt-1">
                  {stats.totalHours} ч
                </div>
              </CardContent>
            </Card>

            {/* Карточки сессий */}
            <Card className="bg-muted/50">
              <CardContent className="pt-6">
                <div className="text-[10px] text-muted-foreground font-medium uppercase flex items-center gap-1 truncate">
                  <Clock className="w-3 h-3" /> Ср. время 2x2
                </div>
                <div className="text-xl font-bold mt-1">
                  {stats.avgSession2} ч
                </div>
              </CardContent>
            </Card>
            <Card className="bg-muted/50">
              <CardContent className="pt-6">
                <div className="text-[10px] text-muted-foreground font-medium uppercase flex items-center gap-1 truncate">
                  <Clock className="w-3 h-3" /> Ср. время 1x1
                </div>
                <div className="text-xl font-bold mt-1">
                  {stats.avgSession1} ч
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-6">
                <div className="text-[10px] text-muted-foreground font-medium uppercase text-green-500 truncate">
                  Лучший день
                </div>
                <div className="text-xl font-bold mt-1">
                  {Math.round(stats.getDayUtil(stats.bestDay))}%
                </div>
                <div className="text-[10px] text-muted-foreground mt-1">
                  {stats.bestDay.date}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="text-[10px] text-muted-foreground font-medium uppercase text-destructive truncate">
                  Худший день
                </div>
                <div className="text-xl font-bold mt-1">
                  {Math.round(stats.getDayUtil(stats.worstDay))}%
                </div>
                <div className="text-[10px] text-muted-foreground mt-1">
                  {stats.worstDay.date}
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-6">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-base font-semibold">
                    Динамика загрузки + MA7
                  </CardTitle>
                  <div className="flex bg-muted p-1 rounded-md text-xs">
                    <button
                      onClick={() => setCourtFilter('all')}
                      className={cn(
                        'px-3 py-1 rounded-sm transition-colors',
                        courtFilter === 'all' &&
                          'bg-background shadow-sm font-medium',
                      )}
                    >
                      Все
                    </button>
                    <button
                      onClick={() => setCourtFilter('2x2')}
                      className={cn(
                        'px-3 py-1 rounded-sm transition-colors',
                        courtFilter === '2x2' &&
                          'bg-background shadow-sm font-medium',
                      )}
                    >
                      2x2
                    </button>
                    <button
                      onClick={() => setCourtFilter('1x1')}
                      className={cn(
                        'px-3 py-1 rounded-sm transition-colors',
                        courtFilter === '1x1' &&
                          'bg-background shadow-sm font-medium',
                      )}
                    >
                      1x1
                    </button>
                  </div>
                </CardHeader>
                <CardContent className="h-[350px] pl-0">
                  <ResponsiveContainer width="100%" height={350} minWidth={280}>
                    <ComposedChart data={stats.chartData}>
                      <CartesianGrid
                        strokeDasharray="3 3"
                        vertical={false}
                        opacity={0.1}
                      />
                      <XAxis
                        dataKey="date"
                        fontSize={10}
                        tickLine={false}
                        axisLine={false}
                      />
                      <YAxis
                        fontSize={10}
                        tickLine={false}
                        axisLine={false}
                        tickFormatter={(v) => `${v}%`}
                      />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: 'hsl(var(--card))',
                          borderRadius: '8px',
                          border: '1px solid hsl(var(--border))',
                        }}
                      />
                      <Legend />
                      <Bar
                        dataKey="Загрузка %"
                        fill="#3b82f6"
                        radius={[4, 4, 0, 0]}
                        opacity={0.7}
                      />
                      <Line
                        type="monotone"
                        dataKey="MA7"
                        stroke="#ef4444"
                        strokeWidth={3}
                        dot={false}
                        name="Тренд (7д)"
                      />
                    </ComposedChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base font-semibold">
                    Календарная теплокарта (по фильтру:{' '}
                    {courtFilter === 'all' ? 'Все' : courtFilter})
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-wrap gap-2">
                    {stats.periodData.map((d) => {
                      const util = Math.round(stats.getDayUtil(d));
                      return (
                        <div
                          key={d.date}
                          className={cn(
                            'w-12 h-12 rounded-lg flex flex-col items-center justify-center border',
                            getHeatColor(util),
                          )}
                        >
                          <span className="text-[9px] font-bold opacity-80">
                            {format(new Date(d.date), 'dd.MM')}
                          </span>
                          <span className="text-xs font-black">{util}%</span>
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            </div>

            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base font-semibold">
                    По дням недели ({courtFilter})
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>День</TableHead>
                        <TableHead className="text-right">Средний %</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {stats.weekdays.map((w) => (
                        <TableRow key={w.name}>
                          <TableCell className="font-medium">
                            {w.name}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-2">
                              <div className="w-16 h-2 bg-muted rounded-full overflow-hidden">
                                <div
                                  className="h-full bg-primary"
                                  style={{ width: `${w.val}%` }}
                                />
                              </div>
                              <span className="text-xs font-bold">
                                {w.val}%
                              </span>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base font-semibold flex items-center gap-2">
                    <Lightbulb className="w-4 h-4 text-orange-500" /> Аналитика
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex gap-3">
                    <TrendingUp className="w-4 h-4 text-green-500 mt-1 shrink-0" />
                    <div>
                      <div className="text-sm font-medium">
                        Лучший день ({courtFilter})
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {stats.weekdays[0].name} ({stats.weekdays[0].val}%). В
                        эти дни можно повышать цены.
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-3">
                    <TrendingDown className="w-4 h-4 text-destructive mt-1 shrink-0" />
                    <div>
                      <div className="text-sm font-medium">
                        Худший день ({courtFilter})
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {stats.weekdays[stats.weekdays.length - 1].name} (
                        {stats.weekdays[stats.weekdays.length - 1].val}%).
                        Требуются акции.
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-3">
                    <Target className="w-4 h-4 text-primary mt-1 shrink-0" />
                    <div>
                      <div className="text-sm font-medium">
                        Продолжительность игры
                      </div>
                      <div className="text-xs text-muted-foreground">
                        В среднем на кортах 2x2 бронируют {stats.avgSession2} ч,
                        а на 1x1 — {stats.avgSession1} ч.
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
