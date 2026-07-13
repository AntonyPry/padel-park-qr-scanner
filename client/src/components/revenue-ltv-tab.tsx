import { useEffect, useMemo, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import {
  getRevenueLtv,
  type LtvMetric,
  type RevenueCohortValue,
  type RevenueLtvSourceRow,
} from '@/api/visits-analytics';
import { queryKeys } from '@/api/query-keys';
import { ChartLoadingState } from '@/components/chart-loading-state';
import { HelpTooltip } from '@/components/dashboard-metric';
import { ErrorState } from '@/components/error-state';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { getApiErrorMessage } from '@/lib/api';
import type { LifecycleSourceFilterState } from '@/lib/visits-analytics-export';
import { cn } from '@/lib/utils';

const money = new Intl.NumberFormat('ru-RU', {
  currency: 'RUB',
  maximumFractionDigits: 0,
  style: 'currency',
});

function formatMoney(value: number | null) {
  return value === null ? 'Недостаточно времени' : money.format(value);
}

function formatPercent(value: number | null) {
  return value === null ? 'Недостаточно времени' : `${value.toFixed(1)}%`;
}

function formatOptionalPercent(value: number | null, emptyLabel: string) {
  return value === null ? emptyLabel : `${value.toFixed(1)}%`;
}

function MetricState({ metric }: { metric: LtvMetric }) {
  if (metric.value === null) return <span className="text-xs text-muted-foreground">Недостаточно времени</span>;
  return (
    <span>
      {formatMoney(metric.value)}
      <small className="block text-muted-foreground">{metric.eligibleCount} зрелых клиентов</small>
      {metric.lowSample && <small className="block text-amber-600">Мало данных</small>}
    </span>
  );
}

function SummaryCard({ label, value, formula }: { label: string; value: string; formula: string }) {
  return (
    <Card className="min-w-0">
      <CardContent className="p-4">
        <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
          <span>{label}</span><HelpTooltip>{formula}</HelpTooltip>
        </div>
        <div className="mt-2 break-words text-xl font-semibold">{value}</div>
      </CardContent>
    </Card>
  );
}

function SourceMobileCard({ row }: { row: RevenueLtvSourceRow }) {
  const metrics = [
    ['Привлечено', String(row.acquiredClients)],
    ['Платящих', String(row.payingClients)],
    ['Конверсия', formatPercent(row.payerConversion)],
    ['Выручка', formatMoney(row.attributedRevenue)],
    ['LTV 30', formatMoney(row.ltv30.value)],
    ['LTV 60', formatMoney(row.ltv60.value)],
    ['LTV 90', formatMoney(row.ltv90.value)],
    ['Lifetime LTV', formatMoney(row.lifetimeLtv.value)],
  ];
  return (
    <Card className="min-w-0">
      <CardHeader className="pb-3">
        <CardTitle className="break-words text-base">{row.source}</CardTitle>
        <div className={cn('text-xs', row.reliability.key === 'high' ? 'text-emerald-600' : row.reliability.key === 'low' ? 'text-red-600' : 'text-amber-600')}>
          Надежность: {row.reliability.label}
        </div>
      </CardHeader>
      <CardContent className="grid min-w-0 grid-cols-2 gap-3 text-sm">
        {metrics.map(([label, value]) => (
          <div key={label} className="min-w-0 rounded-lg bg-muted/50 p-2.5">
            <div className="text-xs text-muted-foreground">{label}</div>
            <div className="mt-1 break-words font-medium">{value}</div>
          </div>
        ))}
        <div className="col-span-2 text-xs text-muted-foreground">
          Зрелая выборка 30 / 60 / 90: {row.matureSample.days30} / {row.matureSample.days60} / {row.matureSample.days90}
        </div>
      </CardContent>
    </Card>
  );
}

function CohortValue({ value }: { value: RevenueCohortValue }) {
  if (!value.isMature) return <span className="text-xs text-muted-foreground">Недостаточно времени</span>;
  return <span className="font-medium">{formatMoney(value.value)}<small className="block text-muted-foreground">накоплено {formatMoney(value.revenue)}</small></span>;
}

export default function RevenueLtvTab({
  from,
  onSourceFilterChange,
  to,
}: {
  from: string;
  onSourceFilterChange?: (filter: LifecycleSourceFilterState) => void;
  to: string;
}) {
  const [excludedSources, setExcludedSources] = useState<string[]>([]);
  const baseParams = useMemo(() => ({ from, to }), [from, to]);
  const baseQuery = useQuery({
    queryFn: () => getRevenueLtv(baseParams),
    queryKey: queryKeys.visitsAnalytics.revenueLtv(baseParams),
    placeholderData: keepPreviousData,
  });
  const sourceOptions = useMemo(() => baseQuery.data?.availableSources || [], [baseQuery.data?.availableSources]);
  const selectedSources = useMemo(
    () => sourceOptions.filter((source) => !excludedSources.includes(source.sourceKey)).map((source) => source.sourceKey),
    [excludedSources, sourceOptions],
  );
  const allHidden = sourceOptions.length > 0 && selectedSources.length === 0;
  const sources = excludedSources.length > 0 ? selectedSources : undefined;
  const filteredParams = useMemo(() => ({ from, to, sources }), [from, sources, to]);
  const filteredQuery = useQuery({
    enabled: Boolean(sources?.length),
    queryFn: () => getRevenueLtv(filteredParams),
    queryKey: queryKeys.visitsAnalytics.revenueLtv(filteredParams),
    placeholderData: () => baseQuery.data,
  });
  const query = sources?.length ? filteredQuery : baseQuery;
  const lastSuccessfulData = sources?.length ? (filteredQuery.data ?? baseQuery.data) : baseQuery.data;
  const data = allHidden ? undefined : lastSuccessfulData;
  const error = query.isError ? getApiErrorMessage(query.error, 'Не удалось загрузить выручку и LTV') : '';
  const isBackgroundFetching = query.isFetching && Boolean(data);

  useEffect(() => {
    onSourceFilterChange?.({ allHidden, sourceKeys: sources });
  }, [allHidden, onSourceFilterChange, sources]);

  return (
    <div className="min-w-0 space-y-5">
      <div className="rounded-xl border bg-card/60 p-3">
        <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="font-medium">Выручка и LTV: {from} — {to}</div>
            <div className="text-sm text-muted-foreground">LTV считается от первого реального визита до даты среза, Europe/Moscow.</div>
          </div>
          {isBackgroundFetching && <div className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground" role="status"><RefreshCw className="h-3.5 w-3.5 animate-spin" /> Обновляем данные</div>}
        </div>
        {sourceOptions.length > 0 && (
          <div className="mt-3 flex min-w-0 flex-wrap gap-2" aria-label="Фильтр LTV по источникам">
            {sourceOptions.map((source) => {
              const excluded = excludedSources.includes(source.sourceKey);
              return (
                <Button
                  key={source.sourceKey}
                  aria-pressed={!excluded}
                  className="h-auto min-w-0 max-w-full whitespace-normal break-words text-left"
                  onClick={() => setExcludedSources((current) => current.includes(source.sourceKey) ? current.filter((key) => key !== source.sourceKey) : [...current, source.sourceKey])}
                  size="sm"
                  variant={excluded ? 'outline' : 'secondary'}
                >
                  {source.source} · {source.clientCount}
                </Button>
              );
            })}
          </div>
        )}
      </div>

      {allHidden ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground">Все источники скрыты фильтром</CardContent></Card>
      ) : error && !data ? (
        <ErrorState title="Выручка и LTV не загрузились" message={error} onRetry={() => void query.refetch()} />
      ) : !data ? (
        <ChartLoadingState title="Загрузка выручки и LTV" />
      ) : (
        <>
          {error && <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">Не удалось обновить данные. Показан последний успешный результат.</div>}
          <section aria-labelledby="revenue-summary-heading">
            <div className="mb-3 flex items-center gap-2"><h2 id="revenue-summary-heading" className="text-lg font-semibold">Основные показатели</h2><HelpTooltip>Карточка выручки использует денежные события выбранного периода. LTV — когорту клиентов, чей первый реальный визит попал в период.</HelpTooltip></div>
            <div className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5">
              <SummaryCard label="Атрибутированная выручка" value={formatMoney(data.summary.attributedRevenue)} formula="Сумма уникальных денежных событий периода с надежной canonical client связью. PAYBACK отрицательный." />
              <SummaryCard label="Привлечено клиентов" value={String(data.summary.acquiredClients)} formula="Canonical-клиенты, чей первый реальный визит попал в выбранный период." />
              <SummaryCard label="Платящих клиентов" value={String(data.summary.payingClients)} formula="Клиенты когорты хотя бы с одним положительным атрибутированным событием после первого визита." />
              <SummaryCard label="Конверсия в оплату" value={formatOptionalPercent(data.summary.payerConversion, 'Нет привлеченных клиентов')} formula="Платящие клиенты / привлеченные клиенты × 100." />
              <SummaryCard label="На привлеченного клиента" value={formatMoney(data.summary.averageRevenuePerAcquiredClient)} formula="Накопленная выручка когорты / все привлеченные клиенты." />
              <SummaryCard label="На платящего клиента" value={formatMoney(data.summary.averageRevenuePerPayingClient)} formula="Накопленная выручка когорты / платящие клиенты." />
              <SummaryCard label="LTV 30" value={formatMoney(data.summary.ltv30.value)} formula="Выручка первых 30 дней клиентов с завершенным окном / mature30. Незрелые клиенты не входят в знаменатель." />
              <SummaryCard label="LTV 60" value={formatMoney(data.summary.ltv60.value)} formula="Выручка первых 60 дней клиентов с завершенным окном / mature60." />
              <SummaryCard label="LTV 90" value={formatMoney(data.summary.ltv90.value)} formula="Выручка первых 90 дней клиентов с завершенным окном / mature90." />
              <SummaryCard label="Lifetime LTV" value={formatMoney(data.summary.lifetimeLtv.value)} formula="Накопленная выручка от первого визита до даты среза / размер когорты." />
              <SummaryCard label="Покрытие кассовых движений" value={formatOptionalPercent(data.summary.coveragePercent, 'Нет кассовых движений')} formula="Сумма модулей всех надежно привязанных позиций чеков / сумма модулей всех чеков × 100. Модули сохраняют смысл доли при PAYBACK; net-суммы показаны отдельно." />
            </div>
          </section>

          <section aria-labelledby="revenue-sources-heading">
            <div className="mb-3 flex items-center gap-2"><h2 id="revenue-sources-heading" className="text-lg font-semibold">LTV по источникам</h2><HelpTooltip>Источник берется у canonical-клиента по stable source key. «Мало данных» — менее 10 зрелых клиентов в 90-дневном окне.</HelpTooltip></div>
            {data.sources.length === 0 ? <Card><CardContent className="py-12 text-center text-muted-foreground">Нет привлеченных клиентов в выбранном периоде</CardContent></Card> : (
              <>
                <div className="hidden max-w-full overflow-x-auto rounded-xl border lg:block">
                  <Table className="min-w-max"><TableHeader><TableRow>
                    <TableHead>Источник</TableHead><TableHead>Привлечено</TableHead><TableHead>Платящих</TableHead><TableHead>Конверсия</TableHead><TableHead>Выручка</TableHead><TableHead>LTV 30</TableHead><TableHead>LTV 60</TableHead><TableHead>LTV 90</TableHead><TableHead>Lifetime</TableHead><TableHead>Зрелая 30/60/90</TableHead><TableHead>Надежность</TableHead>
                  </TableRow></TableHeader><TableBody>{data.sources.map((row) => (
                    <TableRow key={row.sourceKey}><TableCell className="max-w-52 whitespace-normal font-medium">{row.source}</TableCell><TableCell>{row.acquiredClients}</TableCell><TableCell>{row.payingClients}</TableCell><TableCell>{formatPercent(row.payerConversion)}</TableCell><TableCell>{formatMoney(row.attributedRevenue)}</TableCell><TableCell><MetricState metric={row.ltv30} /></TableCell><TableCell><MetricState metric={row.ltv60} /></TableCell><TableCell><MetricState metric={row.ltv90} /></TableCell><TableCell>{formatMoney(row.lifetimeLtv.value)}</TableCell><TableCell>{row.matureSample.days30} / {row.matureSample.days60} / {row.matureSample.days90}</TableCell><TableCell>{row.reliability.label}</TableCell></TableRow>
                  ))}</TableBody></Table>
                </div>
                <div className="grid min-w-0 gap-3 lg:hidden">{data.sources.map((row) => <SourceMobileCard key={row.sourceKey} row={row} />)}</div>
              </>
            )}
          </section>

          <section aria-labelledby="revenue-cohorts-heading">
            <div className="mb-3 flex items-center gap-2"><h2 id="revenue-cohorts-heading" className="text-lg font-semibold">Накопительный LTV когорт</h2><HelpTooltip>M0, M1 и далее — накопленная надежно атрибутированная выручка / исходный размер когорты. Незавершенные календарные месяцы возвращают null.</HelpTooltip></div>
            {data.cohorts.rows.length === 0 ? <Card><CardContent className="py-12 text-center text-muted-foreground">Нет когорт первого реального визита</CardContent></Card> : (
              <>
                <div className="hidden max-w-full overflow-x-auto rounded-xl border lg:block"><Table className="min-w-max"><TableHeader><TableRow><TableHead className="sticky left-0 z-10 bg-card">Когорта</TableHead><TableHead>Размер</TableHead>{data.cohorts.months.map((month) => <TableHead key={month}>M{month}</TableHead>)}</TableRow></TableHeader><TableBody>{data.cohorts.rows.map((cohort) => <TableRow key={cohort.cohortMonth}><TableCell className="sticky left-0 z-10 bg-card font-medium">{cohort.cohortMonth}</TableCell><TableCell>{cohort.cohortSize}</TableCell>{cohort.values.map((value) => <TableCell key={value.monthIndex}><CohortValue value={value} /></TableCell>)}</TableRow>)}</TableBody></Table></div>
                <div className="grid min-w-0 gap-3 lg:hidden">{data.cohorts.rows.map((cohort) => <Card key={cohort.cohortMonth} className="min-w-0"><CardHeader className="pb-3"><CardTitle className="text-base">{cohort.cohortMonth} · {cohort.cohortSize} клиентов</CardTitle></CardHeader><CardContent className="grid grid-cols-2 gap-2 min-[360px]:grid-cols-3">{cohort.values.map((value) => <div key={value.monthIndex} className="min-w-0 rounded-lg border p-2.5"><div className="text-xs text-muted-foreground">M{value.monthIndex}</div><div className="mt-1 break-words"><CohortValue value={value} /></div></div>)}</CardContent></Card>)}</div>
              </>
            )}
          </section>

          <section aria-labelledby="revenue-coverage-heading">
            <div className="mb-3 flex items-center gap-2"><h2 id="revenue-coverage-heading" className="text-lg font-semibold">Покрытие данных</h2><HelpTooltip>LTV использует только однозначно связанные денежные события. Непривязанные суммы не распределяются по клиентам или источникам.</HelpTooltip></div>
            {data.coverage.sourceFilterScope === 'selected_sources_vs_all_cash' && <div className="mb-3 rounded-lg border border-amber-300/60 bg-amber-50/70 p-3 text-sm text-amber-900 dark:bg-amber-950/20 dark:text-amber-100">Фильтр меняет надежно привязанную сумму выбранных источников. Общая касса, истинно непривязанная сумма и coverage остаются общими: источник у непривязанных чеков определить нельзя.</div>}
            <div className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <SummaryCard label="Кассовая net-выручка" value={formatMoney(data.coverage.cashNetRevenue)} formula="SELL положительно, PAYBACK отрицательно; все чеки периода." />
              <SummaryCard label={data.coverage.sourceFilterScope === 'selected_sources_vs_all_cash' ? 'Привязано к выбранным источникам' : 'Надежно привязано'} value={formatMoney(data.coverage.attributedCashRevenue)} formula="Позиции чеков с одной canonical client связью; одна позиция считается один раз. При source-фильтре показана выбранная часть." />
              <SummaryCard label="Истинно не привязано" value={formatMoney(data.coverage.unlinkedCashRevenue)} formula="Общая кассовая net-выручка минус все надежно привязанные позиции, независимо от source-фильтра." />
              {data.coverage.sourceFilterScope === 'selected_sources_vs_all_cash' && <SummaryCard label="Вне выбранных источников" value={formatMoney(data.coverage.outsideSelectedSourcesCashRevenue)} formula="Надежно привязанные позиции клиентов из источников, скрытых текущим фильтром." />}
              <SummaryCard label="PAYBACK" value={String(data.coverage.paybackCount)} formula="Количество возвратных чеков периода; суммы имеют отрицательный знак." />
              <SummaryCard label="Неизвестный клиент" value={formatMoney(data.coverage.unknownClientAmount)} formula="Позиции чеков без прямой клиентской связи. Не распределяются по догадке." />
              <SummaryCard label="Непривязанный PAYBACK" value={`${data.coverage.unlinkedPaybackCount} · ${formatMoney(data.coverage.unlinkedPaybackAmount)}`} formula="Возвратные позиции без единственной надежной canonical client связи. Они уменьшают общую кассу, но не распределяются в LTV по предположению." />
              <SummaryCard label="Риск двойного учета" value={formatMoney(data.coverage.duplicateRiskAmount)} formula="Receipt-backed saleAmount не добавляется повторно; неоднозначные связи к разным клиентам исключены." />
              <SummaryCard label="Расхождение чек / позиции" value={formatMoney(data.coverage.receiptItemReconciliationDifference)} formula="Кассовая net-выручка минус net-сумма сохраненных позиций. Показывает чеки с отсутствующими или несходящимися позициями." />
              <SummaryCard label="Legacy без даты" value={`${data.coverage.legacySales.count} · ${formatMoney(data.coverage.legacySales.amount)}`} formula="Сертификаты legacy_stn_google_sheet не входят в периодический LTV из-за неизвестной даты продажи." />
              <SummaryCard label="Booking payments, справочно" value={formatMoney(data.coverage.bookingPaymentsReference)} formula="Не входят в основной LTV: модель не доказывает, что paidAmount — отдельный от кассы платеж." />
            </div>
            <div className="mt-3 text-xs text-muted-foreground">Ручные Finance без clientId: {formatMoney(data.coverage.manualFinanceWithoutClient)}. Corporate ledger, исключенный как движение предоплаченного баланса, а не новый cash event: {formatMoney(data.coverage.corporateLedgerExcludedAmount)}. Они не входят в индивидуальный LTV.</div>
          </section>
        </>
      )}
    </div>
  );
}
