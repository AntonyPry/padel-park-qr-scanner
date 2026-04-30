import { useState, useEffect, useMemo } from 'react';
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
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
import { format, subDays } from 'date-fns';
import { ru } from 'date-fns/locale';
import type { DateRange } from 'react-day-picker';
import { cn } from '@/lib/utils';
import { API_URL } from '@/config';

const KNOWN_SOURCES = [
  'Рекомендация друзей',
  'Увидел в тц',
  'Вк',
  'Другое',
  'Тг',
  'Инст',
  'Радио',
  'Хоккей',
  'Сайт',
];

// Палитра для кольца Источников
const COLORS = [
  '#3b82f6',
  '#10b981',
  '#f59e0b',
  '#6366f1',
  '#ef4444',
  '#14b8a6',
  '#ec4899',
  '#8b5cf6',
  '#64748b',
];

// Палитра для кольца Целей визита
const CATEGORY_COLORS = [
  '#8b5cf6',
  '#ec4899',
  '#f43f5e',
  '#f97316',
  '#eab308',
  '#84cc16',
  '#10b981',
  '#06b6d4',
  '#3b82f6',
];

const DAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const HOURS = Array.from({ length: 16 }, (_, i) => i + 8);

export default function VisitsAnalyticsPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const [dateRange, setDateRange] = useState<DateRange | undefined>({
    from: subDays(new Date(), 30),
    to: new Date(),
  });

  const fetchData = async () => {
    setLoading(true);
    const fromStr = dateRange?.from ? format(dateRange.from, 'yyyy-MM-dd') : '';
    const toStr = dateRange?.to ? format(dateRange.to, 'yyyy-MM-dd') : fromStr;

    try {
      const res = await fetch(
        `${API_URL}/api/analytics/visits?from=${fromStr}&to=${toStr}`,
      );
      if (res.ok) {
        setData(await res.json());
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [dateRange]);

  // ЭКСПОРТ В EXCEL
  const handleExport = () => {
    const fromStr = dateRange?.from ? format(dateRange.from, 'yyyy-MM-dd') : '';
    const toStr = dateRange?.to ? format(dateRange.to, 'yyyy-MM-dd') : fromStr;
    window.open(
      `${API_URL}/api/export/visits?from=${fromStr}&to=${toStr}`,
      '_blank',
    );
  };

  // Агрегируем источники
  const aggregatedSources = useMemo(() => {
    if (!data?.sources) return [];
    let otherCount = 0;
    const finalSources: any[] = [];

    data.sources.forEach((sourceItem: any) => {
      const isKnown = KNOWN_SOURCES.some(
        (known) => known.toLowerCase() === sourceItem.name.toLowerCase(),
      );
      if (isKnown) {
        if (sourceItem.name.toLowerCase() === 'другое') {
          otherCount += sourceItem.value;
        } else {
          finalSources.push(sourceItem);
        }
      } else {
        otherCount += sourceItem.value;
      }
    });

    if (otherCount > 0) {
      finalSources.push({ name: 'Другое', value: otherCount });
    }
    return finalSources.sort((a, b) => b.value - a.value);
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
    <div className="p-6 md:p-8 space-y-6 max-w-[1600px] mx-auto">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">
            Аналитика посещений
          </h1>
          <p className="text-muted-foreground mt-1">
            Откуда приходят гости и в какое время
          </p>
        </div>

        <div className="flex flex-wrap gap-3 w-full sm:w-auto">
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
            onClick={handleExport}
            variant="default"
            className="w-full sm:w-auto bg-green-600 hover:bg-green-700 text-white"
          >
            <Download className="mr-2 h-4 w-4" />
            Экспорт в Excel
          </Button>
        </div>
      </div>

      {!data || loading ? (
        <div className="flex justify-center py-12 text-muted-foreground animate-pulse">
          Загрузка аналитики...
        </div>
      ) : (
        <>
          {/* КАРТОЧКИ */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card>
              <CardHeader className="pb-2 flex flex-row items-center justify-between">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Всего визитов
                </CardTitle>
                <Key className="h-4 w-4 text-primary" />
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">{data.totalVisits}</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2 flex flex-row items-center justify-between">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Уникальных гостей
                </CardTitle>
                <Users className="h-4 w-4 text-blue-500" />
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">{data.uniqueGuests}</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2 flex flex-row items-center justify-between">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Индекс возвращаемости
                </CardTitle>
                <TrendingUp className="h-4 w-4 text-green-500" />
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">
                  {data.uniqueGuests > 0
                    ? Math.round(
                        (data.totalVisits / data.uniqueGuests - 1) * 100,
                      )
                    : 0}
                  %
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2 flex flex-row items-center justify-between">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Топ источник
                </CardTitle>
                <Target className="h-4 w-4 text-orange-500" />
              </CardHeader>
              <CardContent>
                <div className="text-xl font-bold truncate">
                  {aggregatedSources.length > 0
                    ? aggregatedSources[0].name
                    : '-'}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* ГРАФИКИ И ТОП (3 КОЛОНКИ НА БОЛЬШИХ ЭКРАНАХ) */}
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
            {/* ИСТОЧНИКИ */}
            <Card className="col-span-1 flex flex-col">
              <CardHeader>
                <CardTitle className="text-lg text-center">
                  Откуда о нас узнают
                </CardTitle>
              </CardHeader>
              <CardContent className="flex-1 min-h-[280px]">
                {aggregatedSources.length === 0 ? (
                  <div className="flex h-full items-center justify-center text-muted-foreground">
                    Нет данных
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={aggregatedSources}
                        cx="50%"
                        cy="50%"
                        innerRadius={65}
                        outerRadius={95}
                        paddingAngle={2}
                        dataKey="value"
                      >
                        {aggregatedSources.map((_entry: any, index: number) => (
                          <Cell
                            key={`cell-${index}`}
                            fill={COLORS[index % COLORS.length]}
                          />
                        ))}
                      </Pie>
                      <Tooltip
                        formatter={(value, name) => [`${value} визитов`, name]}
                        contentStyle={{
                          borderRadius: '8px',
                          border: 'none',
                          boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
                        }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>

            {/* ЦЕЛИ ВИЗИТОВ */}
            <Card className="col-span-1 flex flex-col">
              <CardHeader>
                <CardTitle className="text-lg text-center">
                  Цели визитов (Категории)
                </CardTitle>
              </CardHeader>
              <CardContent className="flex-1 min-h-[280px]">
                {!data?.categories || data.categories.length === 0 ? (
                  <div className="flex h-full items-center justify-center text-muted-foreground">
                    Нет данных
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={data.categories}
                        cx="50%"
                        cy="50%"
                        innerRadius={65}
                        outerRadius={95}
                        paddingAngle={2}
                        dataKey="value"
                      >
                        {data.categories.map((_entry: any, index: number) => (
                          <Cell
                            key={`cell-${index}`}
                            fill={
                              CATEGORY_COLORS[index % CATEGORY_COLORS.length]
                            }
                          />
                        ))}
                      </Pie>
                      <Tooltip
                        formatter={(value, name) => [`${value} визитов`, name]}
                        contentStyle={{
                          borderRadius: '8px',
                          border: 'none',
                          boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
                        }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>

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
                    {data.topGuests.map((guest: any, idx: number) => (
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
                          {guest.visits}
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
                        <div key={dayName} className="flex items-center">
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
    </div>
  );
}
