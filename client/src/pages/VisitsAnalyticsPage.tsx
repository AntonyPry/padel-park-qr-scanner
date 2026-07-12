import { lazy, Suspense, useState, useMemo, type ReactNode } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import {
  getVisitsAnalytics,
  type ChartDatum,
} from '@/api/visits-analytics';
import { queryKeys } from '@/api/query-keys';
import { ErrorState } from '@/components/error-state';
import { ChartLoadingState } from '@/components/chart-loading-state';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/toast';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import {
  Users,
  Key,
  Target,
  TrendingUp,
  Calendar as CalendarIcon,
  Download,
} from 'lucide-react';
import { format, subDays } from 'date-fns';
import { ru } from 'date-fns/locale';
import type { DateRange } from 'react-day-picker';
import { cn } from '@/lib/utils';
import { apiFetch, getApiErrorMessage, readApiError } from '@/lib/api';
import { AnimatedDonut, AnimatedMetricValue } from '@/components/animated-data';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { SourceQualityTab } from '@/components/source-quality-tab';
import {
  getVisitsExportRequest,
  requestVisitsExport,
  type LifecycleSourceFilterState,
} from '@/lib/visits-analytics-export';

const CohortsLifecycleTab = lazy(() => import('@/components/cohorts-lifecycle-tab'));

const DAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const HOURS = Array.from({ length: 16 }, (_, i) => i + 8);
const SOURCE_CHART_COLORS = [
  'hsl(221 83% 53%)',
  'hsl(160 84% 39%)',
  'hsl(43 96% 56%)',
  'hsl(262 83% 58%)',
  'hsl(0 84% 60%)',
  'hsl(173 80% 40%)',
  'hsl(340 82% 52%)',
  'hsl(199 89% 48%)',
];
const CATEGORY_CHART_COLORS = [
  'hsl(262 83% 58%)',
  'hsl(340 82% 52%)',
  'hsl(0 84% 60%)',
  'hsl(24 95% 53%)',
  'hsl(43 96% 56%)',
  'hsl(160 84% 39%)',
  'hsl(199 89% 48%)',
  'hsl(221 83% 53%)',
];

function CompactStat({
  icon,
  label,
  value,
  change,
  title,
}: {
  icon: ReactNode;
  label: string;
  value: ReactNode;
  change?: { absolute: number; percent: number | null };
  title?: string;
}) {
  return (
    <div className="min-w-0 rounded-lg bg-background/70 px-3 py-2" title={title}>
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        {icon}
        <span className="leading-tight">{label}</span>
      </div>
      <div className="mt-1 truncate text-lg font-semibold">
        <AnimatedMetricValue value={value} />
      </div>
      {change && (
        <div className={cn('text-[11px]', change.absolute > 0 ? 'text-emerald-600' : change.absolute < 0 ? 'text-red-600' : 'text-muted-foreground')}>
          {change.absolute > 0 ? '+' : ''}{change.absolute.toFixed(1).replace('.0', '')}
          {change.percent !== null ? ` (${change.percent > 0 ? '+' : ''}${change.percent.toFixed(1)}%)` : ' (нет базы)'}
          {' '}к пред. периоду
        </div>
      )}
    </div>
  );
}

function DonutChartCard({
  colors,
  emptyText,
  items,
  title,
}: {
  colors: string[];
  emptyText: string;
  items: ChartDatum[];
  title: string;
}) {
  const total = items.reduce((sum, item) => sum + Number(item.value || 0), 0);
  const visibleItems = items.slice(0, 8);
  const segments = visibleItems.map((item, index) => {
    const value = Number(item.value || 0);

    return {
      index,
      item,
      value,
    };
  });

  return (
    <Card className="col-span-1 flex flex-col">
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold">{title}</CardTitle>
      </CardHeader>
      <CardContent className="grid flex-1 gap-4 md:grid-cols-[minmax(0,1fr)_180px]">
        {items.length === 0 || total <= 0 ? (
          <div className="flex min-h-[240px] items-center justify-center text-sm text-muted-foreground md:col-span-2">
            {emptyText}
          </div>
        ) : (
          <>
            <div className="relative h-[240px] min-w-0">
              <AnimatedDonut
                ariaLabel={title}
                innerRadius={62}
                items={segments.map(({ index, item, value }) => ({
                  color: colors[index % colors.length],
                  id: item.name,
                  title: `${item.name}: ${value} визитов`,
                  value,
                }))}
                showTrack={false}
              />
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <div className="text-center">
                  <div className="text-2xl font-semibold">
                    <AnimatedMetricValue value={total} />
                  </div>
                  <div className="text-xs text-muted-foreground">визитов</div>
                </div>
              </div>
            </div>
            <div className="flex min-w-0 flex-col justify-center gap-2">
              {visibleItems.map((item, index) => {
                const value = Number(item.value || 0);
                const percent = total > 0 ? Math.round((value / total) * 100) : 0;

                return (
                  <div key={item.name} className="flex min-w-0 items-center gap-2 text-sm">
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: colors[index % colors.length] }}
                    />
                    <span className="min-w-0 flex-1 truncate text-muted-foreground">
                      {item.name}
                    </span>
                    <span className="shrink-0 font-medium">{percent}%</span>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

export default function VisitsAnalyticsPage() {
  const [activeTab, setActiveTab] = useState('overview');
  const [lifecycleSourceFilter, setLifecycleSourceFilter] = useState<LifecycleSourceFilterState>({ allHidden: false });
  const [dateRange, setDateRange] = useState<DateRange | undefined>({
    from: subDays(new Date(), 30),
    to: new Date(),
  });

  const analyticsParams = useMemo(() => {
    const fromStr = dateRange?.from ? format(dateRange.from, 'yyyy-MM-dd') : '';
    const toStr = dateRange?.to ? format(dateRange.to, 'yyyy-MM-dd') : fromStr;
    return { from: fromStr, to: toStr };
  }, [dateRange]);
  const analyticsQuery = useQuery({
    queryFn: () => getVisitsAnalytics(analyticsParams),
    queryKey: queryKeys.visitsAnalytics.detail(analyticsParams),
    placeholderData: keepPreviousData,
  });
  const data = analyticsQuery.data;
  const errorText = analyticsQuery.isError
    ? getApiErrorMessage(analyticsQuery.error, 'Не удалось загрузить аналитику посещений')
    : '';
  const exportRequest = getVisitsExportRequest({
    activeTab,
    from: analyticsParams.from,
    sourceFilter: lifecycleSourceFilter,
    to: analyticsParams.to,
  });

  // ЭКСПОРТ В EXCEL
  const handleExport = async () => {
    try {
      const response = await requestVisitsExport(apiFetch, {
        activeTab,
        from: analyticsParams.from,
        sourceFilter: lifecycleSourceFilter,
        to: analyticsParams.to,
      });
      if (!response) return;

      if (!response.ok) {
        const apiError = await readApiError(response, 'Не удалось выгрузить аналитику');
        toast.error(apiError.message);
        return;
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `visits-${analyticsParams.from || 'all'}-${analyticsParams.to || 'all'}.xlsx`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      toast.success('Аналитика выгружена');
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'Не удалось выгрузить аналитику'));
    }
  };

  // Агрегируем источники
  const aggregatedSources = useMemo(() => {
    if (!data?.sources) return [];
    const sourcesMap = new Map<string, ChartDatum>();

    data.sources.forEach(({ name, value }) => {
      const normalizedName = name.trim() || 'Не указан';
      const key = normalizedName.toLowerCase();
      const existing = sourcesMap.get(key);
      sourcesMap.set(key, {
        name: existing?.name || normalizedName,
        value: (existing?.value || 0) + value,
      });
    });

    return Array.from(sourcesMap.values()).sort((a, b) => b.value - a.value);
  }, [data]);

  const getHeatMapColor = (count: number) => {
    if (count === 0)
      return 'bg-slate-100 text-slate-400 dark:bg-slate-800/50 dark:text-slate-500';
    if (count <= 2)
      return 'bg-sky-200 text-sky-900 dark:bg-sky-900/50 dark:text-sky-200';
    if (count <= 5)
      return 'bg-emerald-300 text-emerald-950 dark:bg-emerald-800 dark:text-emerald-100';
    if (count <= 9)
      return 'bg-amber-400 text-amber-950 dark:bg-amber-600 dark:text-amber-50';
    if (count <= 14) return 'bg-orange-500 text-white shadow-sm';
    return 'bg-red-600 text-white font-bold shadow-md ring-1 ring-red-700';
  };

  return (
    <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-5">
      <TabsList className="grid h-auto w-full grid-cols-1 sm:w-auto sm:grid-cols-3">
        <TabsTrigger value="overview">Обзор</TabsTrigger>
        <TabsTrigger value="source-quality">Качество источников</TabsTrigger>
        <TabsTrigger value="cohorts-lifecycle" className="h-auto min-h-8 whitespace-normal">Когорты и жизненный цикл</TabsTrigger>
      </TabsList>
      {activeTab !== 'source-quality' && (
        <div className="flex flex-col gap-3 rounded-xl border bg-card/60 p-3 sm:flex-row sm:items-center sm:justify-end">
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                className={cn('w-full justify-start bg-card text-left font-normal sm:w-[260px]', !dateRange && 'text-muted-foreground')}
              >
                <CalendarIcon className="mr-2 h-4 w-4" />
                {dateRange?.from ? (
                  dateRange.to ? <>{format(dateRange.from, 'dd.MM.yyyy')} — {format(dateRange.to, 'dd.MM.yyyy')}</> : format(dateRange.from, 'dd.MM.yyyy')
                ) : <span>Выберите период</span>}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="end">
              <Calendar initialFocus mode="range" defaultMonth={dateRange?.from} selected={dateRange} onSelect={setDateRange} numberOfMonths={1} locale={ru} />
            </PopoverContent>
          </Popover>
          <Button disabled={exportRequest.disabled} onClick={handleExport} variant="default" className="w-full bg-green-600 text-white hover:bg-green-700 sm:w-auto">
            <Download className="mr-2 h-4 w-4" /> Экспорт в Excel
          </Button>
        </div>
      )}
      <TabsContent value="source-quality"><SourceQualityTab /></TabsContent>
      <TabsContent value="cohorts-lifecycle">
        <Suspense fallback={<ChartLoadingState title="Загрузка вкладки когорт" />}>
          <CohortsLifecycleTab key={`${analyticsParams.from}:${analyticsParams.to}`} from={analyticsParams.from} to={analyticsParams.to} onSourceFilterChange={setLifecycleSourceFilter} />
        </Suspense>
      </TabsContent>
      <TabsContent value="overview"><div className="flex flex-col gap-5">
      <div className="rounded-xl border bg-card/60 p-3">
        {data && (
          <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-7">
            <CompactStat
              icon={<Key className="h-3.5 w-3.5 text-primary" />}
              label="Всего визитов"
              value={data.totalVisits}
              change={data.changes.totalVisits}
            />
            <CompactStat
              icon={<Users className="h-3.5 w-3.5 text-sky-500" />}
              label="Уникальных гостей"
              value={data.uniqueGuests}
              change={data.changes.uniqueGuests}
            />
            <CompactStat icon={<Users className="h-3.5 w-3.5 text-violet-500" />} label="Новые гости" value={data.newGuests} change={data.changes.newGuests} title="Клиенты, чей самый первый визит за всю историю попал в выбранный период" />
            <CompactStat icon={<Users className="h-3.5 w-3.5 text-cyan-500" />} label="Вернувшиеся гости" value={data.returningGuests} change={data.changes.returningGuests} title="Клиенты с визитом в периоде, чей первый визит был раньше периода" />
            <CompactStat icon={<TrendingUp className="h-3.5 w-3.5 text-indigo-500" />} label="Повторные визиты" value={data.repeatVisits} change={data.changes.repeatVisits} title="Все визиты периода сверх первого визита каждого уникального гостя в этом периоде" />
            <CompactStat icon={<Target className="h-3.5 w-3.5 text-orange-500" />} label="Визитов на гостя" value={data.averageVisitsPerGuest.toFixed(2)} change={data.changes.averageVisitsPerGuest} title="Всего визитов / уникальные гости" />
            <CompactStat
              icon={<TrendingUp className="h-3.5 w-3.5 text-emerald-500" />}
              label="Повтор за 30 дней"
              value={`${data.repeatRate30.toFixed(1)}%`}
              change={data.changes.repeatRate30}
              title={`Клиенты со вторым визитом не позднее 30 дней после первого / клиенты когорты с завершённым 30-дневным окном. Основание: ${data.repeatRate30RepeatedGuests} из ${data.repeatRate30EligibleGuests}.`}
            />
          </div>
        )}
      </div>

      {errorText && !data ? (
        <ErrorState
          message={errorText}
          onRetry={() => void analyticsQuery.refetch()}
          title="Аналитика не загрузилась"
        />
      ) : !data ? (
        <ChartLoadingState title="Загрузка аналитики посещений" />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
            <DonutChartCard
              colors={SOURCE_CHART_COLORS}
              emptyText="Нет данных"
              items={aggregatedSources}
              title="Визиты клиентов по источникам"
            />

            <DonutChartCard
              colors={CATEGORY_CHART_COLORS}
              emptyText="Нет данных"
              items={data.categories || []}
              title="Цели визитов"
            />

            {/* ТОП ГОСТЕЙ */}
            <Card className="col-span-1 md:col-span-2 xl:col-span-1 overflow-hidden flex flex-col">
              <CardHeader>
                <CardTitle className="text-lg text-center">
                  ТОП-10 частых гостей
                </CardTitle>
              </CardHeader>
              <div className="overflow-auto flex-1 max-h-[300px]">
                <Table>
                  <TableHeader className="sticky top-0 bg-card z-10">
                    <TableRow>
                      <TableHead>Имя</TableHead>
                      <TableHead className="text-right">Визитов</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.topGuests.map((guest, idx) => (
                      <TableRow key={idx}>
                        <TableCell className="font-medium">
                          {idx < 3 && (
                            <span className="mr-2 text-base">
                              {idx === 0 ? '🥇' : idx === 1 ? '🥈' : '🥉'}
                            </span>
                          )}
                          <span className="truncate inline-block max-w-[150px] align-bottom">
                            {guest.name}
                          </span>
                        </TableCell>
                        <TableCell className="text-right font-bold text-primary">
                          <AnimatedMetricValue value={guest.visits} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </Card>
          </div>

          {/* ТЕПЛОВАЯ КАРТА */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-lg flex items-center justify-between">
                <span>Плотность визитов (по часам выдачи ключей)</span>
                <div className="flex items-center gap-1 text-[10px] font-normal opacity-70">
                  <span>Меньше</span>
                  <div className="w-3 h-3 rounded-sm bg-slate-100 dark:bg-slate-800/50 flex items-center justify-center text-[8px] text-slate-400">
                    0
                  </div>
                  <div className="w-3 h-3 rounded-sm bg-sky-200 dark:bg-sky-900/50"></div>
                  <div className="w-3 h-3 rounded-sm bg-emerald-300 dark:bg-emerald-800"></div>
                  <div className="w-3 h-3 rounded-sm bg-amber-400 dark:bg-amber-600"></div>
                  <div className="w-3 h-3 rounded-sm bg-orange-500"></div>
                  <div className="w-3 h-3 rounded-sm bg-red-600"></div>
                  <span>Больше</span>
                </div>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto pb-2">
                <div className="min-w-[700px]">
                  <div className="flex mb-1">
                    <div className="w-12 shrink-0"></div>
                    {HOURS.map((h) => (
                      <div
                        key={h}
                        className="flex-1 text-center text-xs text-muted-foreground"
                      >
                        {h}
                      </div>
                    ))}
                  </div>

                  <div className="space-y-[2px]">
                    {DAYS.map((dayName, dayIndex) => {
                      const dbDayIndex = dayIndex + 1; // 1 = Пн, 7 = Вс
                      return (
                        <div
                          key={dayName}
                          className="crm-cascade-row flex items-center"
                          style={{ animationDelay: `${dayIndex * 45}ms` }}
                        >
                          <div className="w-12 shrink-0 text-xs font-medium text-muted-foreground">
                            {dayName}
                          </div>
                          {HOURS.map((h) => {
                            const count =
                              data.heatMap[`${dbDayIndex}-${h}`] || 0;
                            return (
                              <div key={h} className="flex-1 px-[1px]">
                                <div
                                  className={cn(
                                    'h-8 w-full rounded-[4px] flex items-center justify-center text-[11px] transition-all hover:scale-110 hover:z-10 relative cursor-default border border-transparent hover:border-foreground/20',
                                    getHeatMapColor(count),
                                  )}
                                  title={`${dayName}, ${h}:00 — Визитов: ${count}`}
                                >
                                  {count}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div></TabsContent>
    </Tabs>
  );
}
