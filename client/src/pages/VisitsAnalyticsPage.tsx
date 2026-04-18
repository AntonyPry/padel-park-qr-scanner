import { useState, useEffect } from 'react';
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
} from 'lucide-react';
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import { format, subDays } from 'date-fns';
import { ru } from 'date-fns/locale';
import type { DateRange } from 'react-day-picker';
import { cn } from '@/lib/utils';

const COLORS = [
  '#00c64c',
  '#3b82f6',
  '#f59e0b',
  '#ef4444',
  '#8b5cf6',
  '#14b8a6',
  '#64748b',
];
const DAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const HOURS = Array.from({ length: 16 }, (_, i) => i + 8);

export default function VisitsAnalyticsPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  // Календарь по умолчанию (последние 30 дней)
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
        `http://localhost:3000/api/analytics/visits?from=${fromStr}&to=${toStr}`,
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

  const getHeatMapColor = (count: number) => {
    if (count === 0) return 'bg-muted/10';
    if (count < 3) return 'bg-primary/20';
    if (count < 7) return 'bg-primary/50 text-white';
    if (count < 12) return 'bg-primary/80 text-white';
    return 'bg-primary text-primary-foreground font-bold';
  };

  return (
    <div className="p-6 md:p-8 space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">
            Аналитика посещений
          </h1>
          <p className="text-muted-foreground mt-1">
            Откуда приходят гости и в какое время
          </p>
        </div>

        <div className="flex w-full sm:w-auto">
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
        </div>
      </div>

      {!data || loading ? (
        <div className="flex justify-center py-12 text-muted-foreground">
          Загрузка данных...
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
                  Возвращаемость
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
                  {data.sources.length > 0 ? data.sources[0].name : '-'}
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* ИСТОЧНИКИ */}
            <Card className="col-span-1">
              <CardHeader>
                <CardTitle className="text-lg">Откуда о нас узнают</CardTitle>
              </CardHeader>
              <CardContent className="h-[300px]">
                {data.sources.length === 0 ? (
                  <div className="flex h-full items-center justify-center text-muted-foreground">
                    Нет данных
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={data.sources}
                        cx="50%"
                        cy="50%"
                        innerRadius={60}
                        outerRadius={90}
                        paddingAngle={2}
                        dataKey="value"
                      >
                        {data.sources.map((_entry: any, index: number) => (
                          <Cell
                            key={`cell-${index}`}
                            fill={COLORS[index % COLORS.length]}
                          />
                        ))}
                      </Pie>
                      <Tooltip
                        formatter={(value) => [
                          `${value} визитов`,
                          'Количество',
                        ]}
                      />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>

            {/* ТОП ГОСТЕЙ */}
            <Card className="col-span-1 lg:col-span-2 overflow-hidden">
              <CardHeader>
                <CardTitle className="text-lg">
                  ТОП-10 самых частых гостей
                </CardTitle>
              </CardHeader>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Имя</TableHead>
                      <TableHead>Телефон</TableHead>
                      <TableHead className="text-right">Визитов</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.topGuests.map((guest: any, idx: number) => (
                      <TableRow key={idx}>
                        <TableCell className="font-medium">
                          {idx < 3 && (
                            <span className="mr-2 text-xl">
                              {idx === 0 ? '🥇' : idx === 1 ? '🥈' : '🥉'}
                            </span>
                          )}
                          {guest.name}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {guest.phone}
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
            <CardHeader>
              <CardTitle className="text-lg">
                Тепловая карта входов (по часам)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto pb-4">
                <div className="min-w-[700px]">
                  <div className="flex mb-2">
                    <div className="w-12 shrink-0"></div>
                    {HOURS.map((h) => (
                      <div
                        key={h}
                        className="flex-1 text-center text-xs text-muted-foreground"
                      >
                        {h}:00
                      </div>
                    ))}
                  </div>
                  <div className="space-y-1">
                    {DAYS.map((dayName, dayIndex) => {
                      const dbDayIndex = dayIndex + 1;
                      return (
                        <div key={dayName} className="flex items-center">
                          <div className="w-12 shrink-0 text-sm font-medium">
                            {dayName}
                          </div>
                          {HOURS.map((h) => {
                            const count =
                              data.heatMap[`${dbDayIndex}-${h}`] || 0;
                            return (
                              <div key={h} className="flex-1 p-[1px]">
                                <div
                                  className={`h-8 w-full rounded-sm flex items-center justify-center text-xs transition-colors hover:ring-2 ring-primary/50 cursor-default ${getHeatMapColor(count)}`}
                                  title={`${dayName}, ${h}:00 — Визитов: ${count}`}
                                >
                                  {count > 0 ? count : ''}
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
