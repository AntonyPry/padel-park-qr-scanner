import { useState, useEffect, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Play,
  Square,
  Trophy,
  Coffee,
  Target,
  Wallet,
  Clock,
} from 'lucide-react';
import { API_URL } from '@/config';
import { format } from 'date-fns';

// Те же ставки, что и в финансах (чтобы цифры сходились)
const RATES = {
  base: 2500, // Оклад за выход
  bar: 5, // 5% с бара
  courts: 2, // 2% с кортов
  other: 3, // 3% с прочего
};

export default function AdminMotivationPage() {
  const [records, setRecords] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  // Состояние смены
  const [isShiftActive, setIsShiftActive] = useState(false);
  const [shiftStart, setShiftStart] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());

  // При загрузке проверяем, есть ли активная смена в localStorage
  useEffect(() => {
    const active = localStorage.getItem('shift_active') === 'true';
    const start = localStorage.getItem('shift_start');
    if (active && start) {
      setIsShiftActive(true);
      setShiftStart(Number(start));
      fetchFinances(); // Сразу грузим продажи, если смена идет
    }
  }, []);

  // Тикаем таймером каждую секунду, если смена активна
  useEffect(() => {
    if (!isShiftActive) return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [isShiftActive]);

  // Можно обновлять данные раз в минуту, чтобы админ видел новые продажи
  useEffect(() => {
    if (!isShiftActive) return;
    const fetchInterval = setInterval(() => {
      fetchFinances();
    }, 60000);
    return () => clearInterval(fetchInterval);
  }, [isShiftActive]);

  const fetchFinances = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/finance`);
      if (res.ok) setRecords(await res.json());
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleStartShift = () => {
    const time = Date.now();
    localStorage.setItem('shift_active', 'true');
    localStorage.setItem('shift_start', time.toString());
    setIsShiftActive(true);
    setShiftStart(time);
    fetchFinances();
  };

  const handleEndShift = () => {
    if (confirm('Уверены, что хотите завершить смену?')) {
      localStorage.removeItem('shift_active');
      localStorage.removeItem('shift_start');
      setIsShiftActive(false);
      setShiftStart(null);
    }
  };

  // Форматируем время смены в HH:MM:SS
  const formatDuration = (ms: number) => {
    const totalSeconds = Math.floor(ms / 1000);
    const h = String(Math.floor(totalSeconds / 3600)).padStart(2, '0');
    const m = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, '0');
    const s = String(totalSeconds % 60).padStart(2, '0');
    return `${h}:${m}:${s}`;
  };

  // Считаем бонусы за текущую смену
  const shiftStats = useMemo(() => {
    if (!shiftStart) return null;

    let barBonus = 0;
    let courtBonus = 0;
    let otherBonus = 0;
    const salesList: any[] = [];

    // Фильтруем только чеки (evotor), пробитые после старта смены
    records.forEach((r) => {
      const dTime = new Date(r.date).getTime();
      if (dTime >= shiftStart && r.type === 'income' && r.source === 'evotor') {
        const val = Math.abs(Number(r.amount));
        let earned = 0;
        let rate = 0;

        if (r.category === 'Бар / Кафе') {
          earned = val * (RATES.bar / 100);
          rate = RATES.bar;
          barBonus += earned;
        } else if (r.category === 'Аренда кортов') {
          earned = val * (RATES.courts / 100);
          rate = RATES.courts;
          courtBonus += earned;
        } else {
          earned = val * (RATES.other / 100);
          rate = RATES.other;
          otherBonus += earned;
        }

        salesList.push({
          ...r,
          earned,
          rate,
        });
      }
    });

    const totalBonus = barBonus + courtBonus + otherBonus;
    const totalPay = RATES.base + totalBonus;

    // Сортируем продажи от новых к старым
    salesList.sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
    );

    return {
      barBonus,
      courtBonus,
      otherBonus,
      totalBonus,
      totalPay,
      salesList,
    };
  }, [records, shiftStart]);

  return (
    <div className="p-6 md:p-8 space-y-6 max-w-[1200px] mx-auto">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Моя смена</h1>
          <p className="text-muted-foreground mt-1">
            Трекер заработка в реальном времени
          </p>
        </div>

        {/* Кнопки управления сменой */}
        <div className="flex items-center gap-4 w-full sm:w-auto bg-card border rounded-lg p-2">
          {isShiftActive ? (
            <>
              <div className="flex items-center gap-2 px-4 text-lg font-mono tracking-widest text-primary">
                <Clock className="w-5 h-5 animate-pulse" />
                {shiftStart ? formatDuration(now - shiftStart) : '00:00:00'}
              </div>
              <Button
                onClick={handleEndShift}
                variant="destructive"
                className="w-full sm:w-auto"
              >
                <Square className="w-4 h-4 mr-2 fill-current" /> Завершить
              </Button>
            </>
          ) : (
            <Button
              onClick={handleStartShift}
              className="w-full sm:w-auto bg-green-600 hover:bg-green-700 text-white"
            >
              <Play className="w-4 h-4 mr-2 fill-current" /> Начать смену
            </Button>
          )}
        </div>
      </div>

      {!isShiftActive ? (
        <Card className="border-dashed border-2 bg-muted/20">
          <CardContent className="flex flex-col items-center justify-center py-20 text-center space-y-4">
            <div className="p-4 rounded-full bg-primary/10">
              <Wallet className="w-12 h-12 text-primary" />
            </div>
            <div>
              <h2 className="text-xl font-bold">Смена не начата</h2>
              <p className="text-muted-foreground max-w-[400px] mt-2">
                Нажмите кнопку «Начать смену», чтобы включить трекер бонусов.
                Все пробитые на кассе чеки начнут пополнять ваш баланс.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* КАРТОЧКИ ЗАРАБОТКА */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card className="border-primary/30 shadow-sm relative overflow-hidden">
              <div className="absolute top-0 right-0 p-4 opacity-10">
                <Trophy className="w-16 h-16" />
              </div>
              <CardContent className="pt-6 relative z-10">
                <div className="text-sm font-medium">Заработано за смену</div>
                <div className="text-3xl font-bold mt-1 text-primary">
                  {shiftStats?.totalPay.toLocaleString('ru-RU')} ₽
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  Оклад + бонусы
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-6">
                <div className="text-sm text-muted-foreground">
                  Гарантированный оклад
                </div>
                <div className="text-2xl font-bold mt-1">
                  {RATES.base.toLocaleString('ru-RU')} ₽
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  За выход
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-6">
                <div className="text-sm text-muted-foreground flex items-center gap-1">
                  <Coffee className="w-4 h-4 text-emerald-500" /> Бонус с Бара
                </div>
                <div className="text-2xl font-bold mt-1">
                  {shiftStats?.barBonus.toLocaleString('ru-RU')} ₽
                </div>
                <div className="text-xs text-green-500 mt-1">
                  +{RATES.bar}% с продаж кафе
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-6">
                <div className="text-sm text-muted-foreground flex items-center gap-1">
                  <Target className="w-4 h-4 text-blue-500" /> Корты и прочее
                </div>
                <div className="text-2xl font-bold mt-1">
                  {(
                    (shiftStats?.courtBonus || 0) +
                    (shiftStats?.otherBonus || 0)
                  ).toLocaleString('ru-RU')}{' '}
                  ₽
                </div>
                <div className="text-xs text-blue-500 mt-1">
                  +{RATES.courts}% корты / +{RATES.other}% прочее
                </div>
              </CardContent>
            </Card>
          </div>

          {/* ИСТОРИЯ НАЧИСЛЕНИЙ ЗА СМЕНУ */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2 border-b">
              <CardTitle className="text-lg">За что начислены бонусы</CardTitle>
              <div className="text-sm text-muted-foreground flex items-center gap-1">
                {loading && (
                  <span className="animate-pulse">Обновление...</span>
                )}
              </div>
            </CardHeader>
            <CardContent className="pt-0 px-0">
              {shiftStats?.salesList.length === 0 ? (
                <div className="text-center text-muted-foreground py-12">
                  В эту смену продаж пока не было. <br /> Ждем первых гостей!
                </div>
              ) : (
                <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
                  <Table>
                    <TableHeader className="sticky top-0 bg-card z-10">
                      <TableRow>
                        <TableHead>Время</TableHead>
                        <TableHead>Категория (Касса)</TableHead>
                        <TableHead className="text-right">Сумма чека</TableHead>
                        <TableHead className="text-right">Ваш бонус</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {shiftStats?.salesList.map((sale, idx) => (
                        <TableRow key={idx} className="hover:bg-muted/50">
                          <TableCell className="text-muted-foreground text-sm">
                            {format(new Date(sale.date), 'HH:mm:ss')}
                          </TableCell>
                          <TableCell className="font-medium">
                            {sale.category}
                          </TableCell>
                          <TableCell className="text-right">
                            {Math.abs(Number(sale.amount)).toLocaleString(
                              'ru-RU',
                            )}{' '}
                            ₽
                          </TableCell>
                          <TableCell className="text-right font-bold text-green-500 flex items-center justify-end gap-2">
                            <span className="text-xs bg-green-500/10 text-green-600 px-1.5 py-0.5 rounded">
                              {sale.rate}%
                            </span>
                            +{sale.earned.toLocaleString('ru-RU')} ₽
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
