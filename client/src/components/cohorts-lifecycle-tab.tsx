import { useEffect, useMemo, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { RefreshCw, Users } from 'lucide-react';
import {
  getCohortsLifecycle,
  type CohortMetric,
  type CohortRow,
  type LifecycleStatus,
  type RetentionMetric,
  type VisitsAnalyticsSegmentSelection,
} from '@/api/visits-analytics';
import { queryKeys } from '@/api/query-keys';
import { ChartLoadingState } from '@/components/chart-loading-state';
import { HelpTooltip } from '@/components/dashboard-metric';
import { ErrorState } from '@/components/error-state';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { getApiErrorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import type { LifecycleSourceFilterState } from '@/lib/visits-analytics-export';
import { getLifecycleChangeColorClass } from '@/lib/visits-analytics-lifecycle';

const lifecycleStyles: Record<LifecycleStatus['key'], string> = {
  new: 'border-sky-200 bg-sky-50/70 dark:border-sky-900 dark:bg-sky-950/25',
  developing: 'border-indigo-200 bg-indigo-50/70 dark:border-indigo-900 dark:bg-indigo-950/25',
  regular: 'border-emerald-200 bg-emerald-50/70 dark:border-emerald-900 dark:bg-emerald-950/25',
  atRisk: 'border-amber-200 bg-amber-50/70 dark:border-amber-900 dark:bg-amber-950/25',
  sleeping: 'border-orange-200 bg-orange-50/70 dark:border-orange-900 dark:bg-orange-950/25',
  lost: 'border-red-200 bg-red-50/70 dark:border-red-900 dark:bg-red-950/25',
};

function monthLabel(value: string) {
  const [year, month] = value.split('-').map(Number);
  return new Intl.DateTimeFormat('ru-RU', { month: 'long', year: 'numeric', timeZone: 'Europe/Moscow' }).format(new Date(Date.UTC(year, month - 1, 1)));
}

function changeLabel(status: LifecycleStatus) {
  const sign = status.change.absolute > 0 ? '+' : '';
  const percent = status.change.percent === null
    ? 'нет базы'
    : `${status.change.percent > 0 ? '+' : ''}${status.change.percent.toFixed(1)}%`;
  return `${sign}${status.change.absolute} (${percent})`;
}

function RateValue({ metric }: { metric: CohortMetric | RetentionMetric }) {
  if (metric.rate === null) {
    return (
      <span className="text-xs text-muted-foreground" title="Недостаточно времени">
        Недостаточно времени
      </span>
    );
  }
  return (
    <span className="font-medium">
      {metric.rate.toFixed(1)}%
      <small className="block text-muted-foreground">{metric.count} из {metric.eligibleCount}</small>
    </span>
  );
}

function CohortMobileCard({ cohort, onCreate }: { cohort: CohortRow; onCreate?: () => void }) {
  return (
    <Card className="min-w-0">
      <CardHeader className="pb-3">
        <CardTitle className="flex min-w-0 items-center justify-between gap-3 text-base">
          <span className="min-w-0 capitalize">{monthLabel(cohort.cohortMonth)}</span>
          <span className="shrink-0 rounded-full bg-muted px-2.5 py-1 text-xs font-medium">{cohort.cohortSize} клиентов</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {onCreate && (
          <Button variant="outline" size="sm" className="w-full" disabled={cohort.actionableCount === 0} onClick={onCreate}>
            <Users className="mr-1.5 h-3.5 w-3.5" /> Создать базу · {cohort.actionableCount}
          </Button>
        )}
        <div className="grid grid-cols-1 gap-3 min-[360px]:grid-cols-3">
          {[['30 дней', cohort.repeat30], ['60 дней', cohort.repeat60], ['90 дней', cohort.repeat90]].map(([label, metric]) => (
            <div key={String(label)} className="min-w-0 rounded-lg bg-muted/50 p-2.5">
              <div className="text-xs text-muted-foreground">Повтор за {String(label)}</div>
              <div className="mt-1"><RateValue metric={metric as CohortMetric} /></div>
            </div>
          ))}
        </div>
        <div>
          <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Удержание по календарным месяцам</div>
          <div className="grid grid-cols-2 gap-2 min-[360px]:grid-cols-3">
            {cohort.retention.map((metric) => (
              <div key={metric.monthIndex} className="min-w-0 rounded-lg border p-2.5">
                <div className="text-xs text-muted-foreground">M{metric.monthIndex}</div>
                <div className="mt-1"><RateValue metric={metric} /></div>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function CohortsLifecycleTab({
  canCreateBase = false,
  from,
  onCreateSegment,
  onSourceFilterChange,
  to,
}: {
  canCreateBase?: boolean;
  from: string;
  onCreateSegment?: (selection: VisitsAnalyticsSegmentSelection) => void;
  onSourceFilterChange?: (filter: LifecycleSourceFilterState) => void;
  to: string;
}) {
  const [excludedSources, setExcludedSources] = useState<string[]>([]);
  const baseParams = useMemo(() => ({ from, to }), [from, to]);
  const baseQuery = useQuery({
    queryFn: () => getCohortsLifecycle(baseParams),
    queryKey: queryKeys.visitsAnalytics.cohortsLifecycle(baseParams),
    placeholderData: keepPreviousData,
  });
  const sourceOptions = useMemo(() => baseQuery.data?.availableSources || [], [baseQuery.data?.availableSources]);
  const selectedSources = useMemo(
    () => sourceOptions.filter((source) => !excludedSources.includes(source.sourceKey)).map((source) => source.sourceKey),
    [excludedSources, sourceOptions],
  );
  const allHidden = sourceOptions.length > 0 && selectedSources.length === 0;
  const filteredParams = useMemo(() => ({ ...baseParams, sources: selectedSources }), [baseParams, selectedSources]);
  const filteredQuery = useQuery({
    enabled: excludedSources.length > 0 && selectedSources.length > 0,
    queryFn: () => getCohortsLifecycle(filteredParams),
    queryKey: queryKeys.visitsAnalytics.cohortsLifecycle(filteredParams),
    placeholderData: () => baseQuery.data,
  });
  const query = excludedSources.length > 0 ? filteredQuery : baseQuery;
  const data = allHidden ? undefined : query.data;

  useEffect(() => {
    onSourceFilterChange?.({
      allHidden,
      sourceKeys: excludedSources.length > 0 && !allHidden ? selectedSources : undefined,
    });
  }, [allHidden, excludedSources.length, onSourceFilterChange, selectedSources]);

  const isBackgroundFetching = Boolean(data && (baseQuery.isFetching || filteredQuery.isFetching));
  const error = query.isError ? getApiErrorMessage(query.error, 'Не удалось загрузить когорты и жизненный цикл') : '';

  return (
    <div className="w-full min-w-0 space-y-5">
      <div className="rounded-xl border bg-card/60 p-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="font-medium">Когорты первого визита: {from} — {to}</div>
            <div className="text-sm text-muted-foreground">Статусы рассчитаны на конец {to}, часовой пояс Europe/Moscow.</div>
          </div>
          {isBackgroundFetching && (
            <div className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground" role="status">
              <RefreshCw className="h-3.5 w-3.5 animate-spin" /> Обновляем данные
            </div>
          )}
        </div>
        {sourceOptions.length > 0 && (
          <div className="mt-3 flex min-w-0 flex-wrap gap-2" aria-label="Фильтр по источникам">
            {sourceOptions.map((source) => {
              const excluded = excludedSources.includes(source.sourceKey);
              return (
                <Button
                  key={source.sourceKey}
                  size="sm"
                  variant={excluded ? 'outline' : 'secondary'}
                  className="h-auto min-w-0 max-w-full whitespace-normal break-words text-left"
                  aria-pressed={!excluded}
                  onClick={() => setExcludedSources((current) => current.includes(source.sourceKey)
                    ? current.filter((key) => key !== source.sourceKey)
                    : [...current, source.sourceKey])}
                >
                  {source.source} · {source.clientCount}
                </Button>
              );
            })}
          </div>
        )}
        {canCreateBase && (
          <Button
            variant="outline"
            size="sm"
            className="mt-3 w-full sm:w-auto"
            disabled={allHidden || !data || data.lifecycle.actionableTotal === 0}
            onClick={() => onCreateSegment?.({
              asOf: data?.asOf,
              expectedCount: data?.lifecycle.actionableTotal,
              from,
              kind: 'filters',
              sourceKeys: excludedSources.length > 0 ? selectedSources : undefined,
              to,
            })}
          >
            <Users className="mr-1.5 h-3.5 w-3.5" /> База по активным фильтрам · {data?.lifecycle.actionableTotal || 0}
          </Button>
        )}
      </div>

      {allHidden ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground">Все источники скрыты фильтром</CardContent></Card>
      ) : error && !data ? (
        <ErrorState title="Когорты и жизненный цикл не загрузились" message={error} onRetry={() => void query.refetch()} />
      ) : !data ? (
        <ChartLoadingState title="Загрузка когорт и жизненного цикла" />
      ) : (
        <>
          {error && <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">Не удалось обновить данные. Показан последний успешный результат.</div>}

          <section aria-labelledby="lifecycle-heading">
            <div className="mb-3 flex items-center gap-2">
              <h2 id="lifecycle-heading" className="text-lg font-semibold">Жизненный цикл</h2>
              <HelpTooltip>Взаимоисключающие статусы всей классифицированной базы на конец выбранного периода. Сравнение — со срезом на конец предыдущего периода той же длительности.</HelpTooltip>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {data.lifecycle.statuses.map((status) => (
                <Card key={status.key} className={cn('min-w-0', lifecycleStyles[status.key])}>
                  <CardContent className="p-4">
                    <div className="flex min-w-0 items-center gap-1.5 text-sm font-medium">
                      <span className="min-w-0">{status.label}</span>
                      <HelpTooltip>{status.formula}</HelpTooltip>
                    </div>
                    <div className="mt-2 text-2xl font-semibold">{status.count}</div>
                    <div className="text-sm text-muted-foreground">{status.share.toFixed(1)}% из {data.lifecycle.totalClassified}</div>
                    {canCreateBase && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="mt-3 w-full bg-background/70"
                        disabled={status.actionableCount === 0}
                        onClick={() => onCreateSegment?.({
                          asOf: data.asOf,
                          expectedCount: status.actionableCount,
                          from,
                          kind: 'lifecycle',
                          lifecycleStatus: status.key,
                          sourceKeys: excludedSources.length > 0 ? selectedSources : undefined,
                          to,
                        })}
                      >
                        <Users className="mr-1.5 h-3.5 w-3.5" /> Создать базу · {status.actionableCount}
                      </Button>
                    )}
                    <div
                      data-testid={`lifecycle-change-${status.key}`}
                      className={cn('mt-2 text-xs', getLifecycleChangeColorClass(status.key, status.change.absolute))}
                    >
                      {changeLabel(status)} к пред. срезу
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </section>

          <section aria-labelledby="cohorts-heading">
            <div className="mb-3 flex items-center gap-2">
              <h2 id="cohorts-heading" className="text-lg font-semibold">Когортная матрица</h2>
              <HelpTooltip>M1, M2 и далее — хотя бы один визит в соответствующем полном календарном месяце после месяца первого визита. Незавершённое окно не считается нулём.</HelpTooltip>
            </div>
            {data.cohorts.length === 0 ? (
              <Card><CardContent className="py-12 text-center text-muted-foreground">В выбранном периоде нет когорт первого реального визита</CardContent></Card>
            ) : (
              <>
                <div className="hidden w-full min-w-0 max-w-full overflow-hidden rounded-xl border lg:block">
                  <Table className="min-w-max" containerClassName="max-w-full overscroll-x-contain">
                    <TableHeader><TableRow>
                      <TableHead className="sticky left-0 z-10 min-w-40 bg-card">Когорта</TableHead>
                      <TableHead>Размер</TableHead>
                      <TableHead>Повтор 30</TableHead><TableHead>Повтор 60</TableHead><TableHead>Повтор 90</TableHead>
                      {data.retentionMonths.map((month) => <TableHead key={month}>M{month}</TableHead>)}
                    </TableRow></TableHeader>
                    <TableBody>{data.cohorts.map((cohort) => (
                      <TableRow key={cohort.cohortMonth}>
                        <TableCell className="sticky left-0 z-10 bg-card font-medium capitalize"><div>{monthLabel(cohort.cohortMonth)}</div>{canCreateBase&&<Button variant="outline" size="sm" className="mt-2 h-auto whitespace-normal" disabled={cohort.actionableCount===0} onClick={()=>onCreateSegment?.({asOf:data.asOf,cohortMonth:cohort.cohortMonth,expectedCount:cohort.actionableCount,from,kind:'cohort',sourceKeys:excludedSources.length>0?selectedSources:undefined,to})}><Users className="mr-1.5 h-3.5 w-3.5"/>База · {cohort.actionableCount}</Button>}</TableCell>
                        <TableCell>{cohort.cohortSize}</TableCell>
                        <TableCell><RateValue metric={cohort.repeat30} /></TableCell>
                        <TableCell><RateValue metric={cohort.repeat60} /></TableCell>
                        <TableCell><RateValue metric={cohort.repeat90} /></TableCell>
                        {cohort.retention.map((metric) => <TableCell key={metric.monthIndex}><RateValue metric={metric} /></TableCell>)}
                      </TableRow>
                    ))}</TableBody>
                  </Table>
                </div>
                <div className="grid min-w-0 gap-3 lg:hidden">
                  {data.cohorts.map((cohort) => <CohortMobileCard key={cohort.cohortMonth} cohort={cohort} onCreate={canCreateBase ? ()=>onCreateSegment?.({asOf:data.asOf,cohortMonth:cohort.cohortMonth,expectedCount:cohort.actionableCount,from,kind:'cohort',sourceKeys:excludedSources.length>0?selectedSources:undefined,to}) : undefined} />)}
                </div>
              </>
            )}
          </section>
        </>
      )}
    </div>
  );
}
