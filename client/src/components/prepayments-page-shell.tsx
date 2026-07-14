import {
  Building2,
  CalendarClock,
  Gift,
  Link2,
  PackageCheck,
  RotateCcw,
  Search,
  SlidersHorizontal,
} from 'lucide-react';
import { ModuleSwitch } from '@/components/module-switch';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  PREPAYMENTS_METRIC_GRID_CLASS,
  PREPAYMENTS_SWITCH_ITEMS,
} from '@/lib/prepayments-layout';

const metricIcons = [Link2, PackageCheck, CalendarClock, Gift, Building2];

export function PrepaymentsMetricsSkeleton() {
  return (
    <div
      aria-label="Загрузка показателей предоплат"
      className={PREPAYMENTS_METRIC_GRID_CLASS}
      data-testid="prepayments-metrics-skeleton"
      role="status"
    >
      {metricIcons.map((Icon, index) => (
        <Card
          key={index}
          aria-hidden="true"
          size="sm"
          className="min-h-[140px] [container-type:inline-size]"
        >
          <CardHeader className="grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1">
            <CardDescription className="min-h-9">
              <span className="block h-4 w-32 max-w-full rounded bg-muted" />
            </CardDescription>
            <CardTitle className="flex h-8 min-w-0 items-center">
              <span className="block h-6 w-20 max-w-full rounded bg-muted" />
            </CardTitle>
            <CardAction className="flex size-9 items-center justify-center rounded-md border bg-muted">
              <Icon className="h-4 w-4 opacity-0" />
            </CardAction>
          </CardHeader>
          <CardContent className="min-h-8">
            <span className="block h-3 w-36 max-w-full rounded bg-muted" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export function PrepaymentsPageShell() {
  return (
    <div className="flex flex-col gap-5" aria-label="Загрузка раздела предоплат">
      <div className="grid gap-2 rounded-xl border bg-card/60 p-3 xl:grid-cols-[auto_minmax(280px,1fr)_auto_auto] xl:items-center">
        <ModuleSwitch items={PREPAYMENTS_SWITCH_ITEMS} className="shrink-0" />
        <div className="flex min-w-0 gap-2">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              aria-label="Поиск загружается"
              className="pl-9"
              disabled
              placeholder="Клиент, сертификат или компания"
            />
          </div>
          <Button className="shrink-0" disabled>
            <Search className="mr-2 h-4 w-4" />
            Найти
          </Button>
        </div>
        <Button type="button" variant="outline" disabled>
          <SlidersHorizontal className="mr-2 h-4 w-4" />
          Фильтры
        </Button>
        <div className="flex justify-end">
          <Button type="button" variant="ghost" disabled>
            <RotateCcw className="mr-2 h-4 w-4" />
            Сброс
          </Button>
        </div>
      </div>
      <PrepaymentsMetricsSkeleton />
    </div>
  );
}
