import { useMemo, useState, type ComponentType, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format, subDays } from 'date-fns';
import {
  AlertTriangle,
  BarChart3,
  CalendarDays,
  ChartColumn,
  Dumbbell,
  Filter,
  Gauge,
  Target,
  TrendingDown,
  UserRound,
  Users,
} from 'lucide-react';
import {
  getMethodologyAnalytics,
  type ClientWithoutProgress,
  type LowApprovedSkillCoverage,
  type MethodologyAnalytics,
  type MethodologyExerciseUsage,
  type MonotonousTrainer,
  type RecommendationDeviationExample,
  type StuckLevelClient,
  type TrainerRecommendationAdherence,
  type WeakMethodologySkill,
} from '@/api/methodology-analytics';
import { queryKeys } from '@/api/query-keys';
import { ErrorState } from '@/components/error-state';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { ModuleSwitch } from '@/components/module-switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  getExerciseFormatLabel,
  getSkillDirectionLabel,
} from '@/lib/methodology';
import { getApiErrorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';

const DEFAULT_FILTERS = {
  from: format(subDays(new Date(), 30), 'yyyy-MM-dd'),
  to: format(new Date(), 'yyyy-MM-dd'),
  trainerAccountId: null as number | null,
};

const METHODOLOGY_SWITCH_ITEMS = [
  { label: 'Методика', to: '/admin/methodology' },
  { label: 'Аналитика', to: '/admin/methodology-analytics' },
];

function formatDate(value?: string | null) {
  if (!value) return '-';
  const [year, month, day] = value.slice(0, 10).split('-');
  if (!year || !month || !day) return value;
  return `${day}.${month}.${year}`;
}

function formatRating(value?: number | null) {
  return value === null || value === undefined ? '-' : value.toFixed(1);
}

function formatPercent(value?: number | null) {
  return `${Math.round(value || 0)}%`;
}

function trainerName(trainer?: { email?: string | null; name?: string | null } | null) {
  return trainer?.name || trainer?.email || 'Без тренера';
}

function EmptyBlock({ text }: { text: string }) {
  return (
    <div className="flex min-h-28 items-center justify-center rounded-md border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
      {text}
    </div>
  );
}

function KpiCard({
  icon: Icon,
  label,
  value,
  accent = 'text-primary',
}: {
  accent?: string;
  icon: ComponentType<{ className?: string }>;
  label: string;
  value: string | number;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between p-4 pb-1">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {label}
        </CardTitle>
        <Icon className={cn('h-4 w-4', accent)} />
      </CardHeader>
      <CardContent className="p-4 pt-1">
        <div className="text-2xl font-semibold">{value}</div>
      </CardContent>
    </Card>
  );
}

function SectionCard({
  children,
  icon: Icon,
  title,
}: {
  children: ReactNode;
  icon: ComponentType<{ className?: string }>;
  title: string;
}) {
  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Icon className="h-5 w-5 text-primary" />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function MetricBar({
  max,
  value,
}: {
  max: number;
  value: number;
}) {
  const width = max > 0 ? Math.max(4, Math.round((value / max) * 100)) : 0;
  return (
    <div className="h-2 w-full rounded-full bg-muted">
      <div
        className="h-2 rounded-full bg-primary"
        style={{ width: `${Math.min(100, width)}%` }}
      />
    </div>
  );
}

function ExerciseList({
  emptyText,
  items,
}: {
  emptyText: string;
  items: MethodologyExerciseUsage[];
}) {
  const maxUsage = Math.max(...items.map((item) => item.usageCount), 0);

  if (items.length === 0) return <EmptyBlock text={emptyText} />;

  return (
    <div className="space-y-3">
      {items.map((item) => (
        <div key={item.exerciseId} className="space-y-2">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="truncate text-sm font-medium">{item.name}</div>
              <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                <span>{item.eLevel || '-'}</span>
                {item.formats.slice(0, 2).map((formatValue) => (
                  <Badge key={formatValue} variant="outline" className="h-5 px-1.5">
                    {getExerciseFormatLabel(formatValue)}
                  </Badge>
                ))}
                <span>{item.mainSkill?.name || 'без навыка'}</span>
              </div>
            </div>
            <div className="shrink-0 text-right">
              <div className="text-sm font-semibold">{item.usageCount}</div>
              <div className="text-xs text-muted-foreground">
                {formatRating(item.averageRating)}
              </div>
            </div>
          </div>
          <MetricBar max={maxUsage} value={item.usageCount} />
        </div>
      ))}
    </div>
  );
}

function WeakSkillsTable({ items }: { items: WeakMethodologySkill[] }) {
  if (items.length === 0) {
    return <EmptyBlock text="Нет выраженных просадок по навыкам за период." />;
  }

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Навык</TableHead>
            <TableHead>Направление</TableHead>
            <TableHead className="text-right">Клиенты</TableHead>
            <TableHead className="text-right">Низкие</TableHead>
            <TableHead className="text-right">Repeat</TableHead>
            <TableHead className="text-right">Оценка</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item) => (
            <TableRow key={item.skillId}>
              <TableCell className="font-medium">{item.skillName}</TableCell>
              <TableCell>{getSkillDirectionLabel(item.direction)}</TableCell>
              <TableCell className="text-right">{item.affectedClients}</TableCell>
              <TableCell className="text-right">{item.lowRatingCount}</TableCell>
              <TableCell className="text-right">{item.repeatCount}</TableCell>
              <TableCell className="text-right">
                {formatRating(item.averageRating)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function ClientsWithoutProgressTable({
  items,
}: {
  items: ClientWithoutProgress[];
}) {
  if (items.length === 0) {
    return <EmptyBlock text="Нет клиентов с серией структурных тренировок без прогресса." />;
  }

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Клиент</TableHead>
            <TableHead className="text-right">Тренировки</TableHead>
            <TableHead className="text-right">Без прогресса</TableHead>
            <TableHead className="text-right">Repeat</TableHead>
            <TableHead>Последняя</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item) => (
            <TableRow key={item.userId}>
              <TableCell className="font-medium">
                {item.client?.name || `Клиент #${item.userId}`}
              </TableCell>
              <TableCell className="text-right">{item.structuredTrainings}</TableCell>
              <TableCell className="text-right">{item.noProgressEvents}</TableCell>
              <TableCell className="text-right">{item.repeatEvents}</TableCell>
              <TableCell>{formatDate(item.latestTrainingAt)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function StuckLevelClientsTable({ items }: { items: StuckLevelClient[] }) {
  if (items.length === 0) {
    return <EmptyBlock text="Нет клиентов, которые долго держатся на одном игровом уровне." />;
  }

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Клиент</TableHead>
            <TableHead>Уровень</TableHead>
            <TableHead className="text-right">Дней</TableHead>
            <TableHead className="text-right">Тренировки</TableHead>
            <TableHead>С уровня</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item) => (
            <TableRow key={item.userId}>
              <TableCell className="font-medium">
                {item.client?.name || `Клиент #${item.userId}`}
              </TableCell>
              <TableCell>
                <Badge variant="outline">{item.currentLevel}</Badge>
              </TableCell>
              <TableCell className="text-right">{item.daysAtLevel}</TableCell>
              <TableCell className="text-right">{item.sameLevelTrainings}</TableCell>
              <TableCell>{formatDate(item.sameLevelSince)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function getScoreBadgeClass(score: number) {
  if (score >= 70) {
    return 'border-transparent bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-200';
  }
  if (score >= 45) {
    return 'border-transparent bg-amber-100 text-amber-900 dark:bg-amber-900/30 dark:text-amber-200';
  }
  return 'border-transparent bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-200';
}

function MonotonousTrainersTable({ items }: { items: MonotonousTrainer[] }) {
  if (items.length === 0) {
    return <EmptyBlock text="Нет структурных тренировок для расчета однообразия." />;
  }

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Тренер</TableHead>
            <TableHead>Индекс</TableHead>
            <TableHead className="text-right">Повтор</TableHead>
            <TableHead className="text-right">E6-E7</TableHead>
            <TableHead className="text-right">Игра</TableHead>
            <TableHead>Сигналы</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item) => (
            <TableRow key={item.trainer.id}>
              <TableCell className="font-medium">{trainerName(item.trainer)}</TableCell>
              <TableCell>
                <Badge className={getScoreBadgeClass(item.monotonyScore)}>
                  {item.monotonyScore}
                </Badge>
              </TableCell>
              <TableCell className="text-right">
                {formatPercent(item.exerciseRepeatPercent)}
              </TableCell>
              <TableCell className="text-right">
                {formatPercent(item.highELevelPercent)}
              </TableCell>
              <TableCell className="text-right">
                {formatPercent(item.gameFormatPercent)}
              </TableCell>
              <TableCell>
                <div className="flex flex-wrap gap-1">
                  {item.flags.slice(0, 3).map((flag) => (
                    <Badge key={flag} variant="outline" className="whitespace-nowrap">
                      {flag}
                    </Badge>
                  ))}
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function RecommendationAdherenceTable({
  items,
}: {
  items: TrainerRecommendationAdherence[];
}) {
  if (items.length === 0) {
    return <EmptyBlock text="Нет завершенных планов из рекомендаций за период." />;
  }

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Тренер</TableHead>
            <TableHead className="text-right">Планы</TableHead>
            <TableHead className="text-right">Следует</TableHead>
            <TableHead className="text-right">Частично</TableHead>
            <TableHead className="text-right">Отклонения</TableHead>
            <TableHead className="text-right">Adherence</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item) => (
            <TableRow key={item.trainer?.id || 'none'}>
              <TableCell className="font-medium">{trainerName(item.trainer)}</TableCell>
              <TableCell className="text-right">{item.recommendationPlans}</TableCell>
              <TableCell className="text-right">{item.followedPlans}</TableCell>
              <TableCell className="text-right">{item.partialPlans}</TableCell>
              <TableCell className="text-right">{item.deviatedPlans}</TableCell>
              <TableCell className="text-right">
                {formatPercent(item.averageAdherencePercent)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function RecommendationDeviationList({
  items,
}: {
  items: RecommendationDeviationExample[];
}) {
  if (items.length === 0) return null;

  return (
    <div className="mt-4 border-t pt-4">
      <div className="mb-2 text-sm font-medium">Примеры отклонений</div>
      <div className="space-y-2">
        {items.slice(0, 4).map((item) => (
          <div
            key={item.planId}
            className="flex flex-col gap-1 rounded-md bg-muted/50 px-3 py-2 text-sm sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="min-w-0">
              <span className="font-medium">План #{item.planId}</span>
              <span className="text-muted-foreground">
                {' '}
                · {trainerName(item.trainer)} · {formatDate(item.plannedAt)}
              </span>
            </div>
            <div className="shrink-0 text-muted-foreground">
              {formatPercent(item.adherencePercent)}, нет {item.missingCount}, вне плана{' '}
              {item.extraCount}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function LowCoverageTable({ items }: { items: LowApprovedSkillCoverage[] }) {
  if (items.length === 0) {
    return <EmptyBlock text="У всех активных навыков достаточно approved упражнений." />;
  }

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Навык</TableHead>
            <TableHead>Направление</TableHead>
            <TableHead className="text-right">Approved</TableHead>
            <TableHead className="text-right">E6-E7</TableHead>
            <TableHead className="text-right">Игра</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item) => (
            <TableRow key={item.skillId}>
              <TableCell className="font-medium">{item.skillName}</TableCell>
              <TableCell>{getSkillDirectionLabel(item.direction)}</TableCell>
              <TableCell className="text-right">{item.approvedExerciseCount}</TableCell>
              <TableCell className="text-right">{item.highELevelCount}</TableCell>
              <TableCell className="text-right">{item.gameFormatCount}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function AnalyticsContent({ data }: { data: MethodologyAnalytics }) {
  return (
    <>
      {data.summary.lowData ? (
        <div className="flex items-start gap-3 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-100">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            {data.emptyStates.structuredTraining ||
              'Данных за период мало, часть выводов может быть нестабильной.'}
          </span>
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          accent="text-sky-600"
          icon={CalendarDays}
          label="Тренировочные записи"
          value={data.summary.trainingNotes}
        />
        <KpiCard
          accent="text-emerald-600"
          icon={Dumbbell}
          label="Структурные упражнения"
          value={data.summary.structuredResults}
        />
        <KpiCard
          accent="text-violet-600"
          icon={Target}
          label="Approved упражнения"
          value={data.summary.approvedExercises}
        />
        <KpiCard
          accent="text-amber-600"
          icon={Users}
          label="Тренеры в периоде"
          value={data.summary.trainersWithTraining}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <SectionCard icon={ChartColumn} title="Частые упражнения">
          <ExerciseList
            emptyText={data.emptyStates.trainingNotes || 'Нет использованных упражнений.'}
            items={data.frequentExercises}
          />
        </SectionCard>

        <SectionCard icon={BarChart3} title="Редко используемые approved">
          <ExerciseList
            emptyText="Нет approved упражнений для анализа."
            items={data.rarelyUsedExercises}
          />
        </SectionCard>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <SectionCard icon={TrendingDown} title="Проседающие навыки">
          <WeakSkillsTable items={data.weakSkills} />
        </SectionCard>

        <SectionCard icon={UserRound} title="Клиенты без прогресса">
          <ClientsWithoutProgressTable items={data.clientsWithoutProgress} />
        </SectionCard>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <SectionCard icon={Gauge} title="Клиенты на одном уровне">
          <StuckLevelClientsTable items={data.stuckLevelClients} />
        </SectionCard>

        <SectionCard icon={AlertTriangle} title="Навыки с малой базой">
          <LowCoverageTable items={data.lowApprovedSkillCoverage} />
        </SectionCard>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <SectionCard icon={Gauge} title="Однообразие тренировок">
          <MonotonousTrainersTable items={data.monotonousTrainers} />
        </SectionCard>

        <SectionCard icon={Target} title="Следование рекомендациям">
          <RecommendationAdherenceTable
            items={data.trainerRecommendationAdherence}
          />
          <RecommendationDeviationList
            items={data.recommendationDeviationExamples}
          />
        </SectionCard>
      </div>
    </>
  );
}

export default function MethodologyAnalyticsPage() {
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const isDateRangeValid =
    !filters.from || !filters.to || filters.from <= filters.to;
  const analyticsParams = useMemo(
    () => ({
      from: filters.from,
      to: filters.to,
      trainerAccountId: filters.trainerAccountId,
    }),
    [filters],
  );
  const analyticsQuery = useQuery({
    enabled: isDateRangeValid,
    queryFn: () => getMethodologyAnalytics(analyticsParams),
    queryKey: queryKeys.methodology.analytics(analyticsParams),
  });
  const data = analyticsQuery.data;
  const dateRangeError = !isDateRangeValid
    ? 'Дата начала не может быть позже даты окончания.'
    : '';
  const errorText = analyticsQuery.isError
    ? getApiErrorMessage(analyticsQuery.error, 'Не удалось загрузить аналитику методики')
    : '';

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3 rounded-xl border bg-card/60 p-3 xl:flex-row xl:items-center xl:justify-between">
        <ModuleSwitch items={METHODOLOGY_SWITCH_ITEMS} />
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-[160px_160px_220px]">
          <div>
            <Input
              id="methodology-analytics-from"
              aria-label="Дата с"
              type="date"
              value={filters.from}
              onChange={(event) =>
                setFilters((current) => ({ ...current, from: event.target.value }))
              }
            />
          </div>
          <div>
            <Input
              id="methodology-analytics-to"
              aria-label="Дата по"
              type="date"
              value={filters.to}
              onChange={(event) =>
                setFilters((current) => ({ ...current, to: event.target.value }))
              }
            />
          </div>
          <div>
            <Select
              value={filters.trainerAccountId ? String(filters.trainerAccountId) : 'all'}
              onValueChange={(value) =>
                setFilters((current) => ({
                  ...current,
                  trainerAccountId: value === 'all' ? null : Number(value),
                }))
              }
            >
              <SelectTrigger>
                <Filter className="mr-2 h-4 w-4" />
                <SelectValue placeholder="Все тренеры" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Все тренеры</SelectItem>
                {(data?.trainers || []).map((trainer) => (
                  <SelectItem key={trainer.id} value={String(trainer.id)}>
                    {trainerName(trainer)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {dateRangeError ? (
        <ErrorState
          message="Исправьте даты в фильтре, и dashboard обновится без лишнего запроса к API."
          title={dateRangeError}
        />
      ) : errorText && !data ? (
        <ErrorState
          message={errorText}
          onRetry={() => void analyticsQuery.refetch()}
          title="Аналитика не загрузилась"
        />
      ) : !data ? (
        <div className="flex min-h-80 items-center justify-center text-sm text-muted-foreground">
          Загрузка аналитики...
        </div>
      ) : (
        <AnalyticsContent data={data} />
      )}
    </div>
  );
}
