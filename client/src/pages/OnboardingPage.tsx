import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowUpRight,
  Award,
  BarChart3,
  CheckCircle2,
  Circle,
  Database,
  FlaskConical,
  GraduationCap,
  ListChecks,
  Power,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Timer,
  Trash2,
  Trophy,
  UsersRound,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import {
  cleanupOnboardingTrainingData,
  completeOnboardingTask,
  getOnboardingMetrics,
  getOnboardingOverview,
  getOnboardingTrainingData,
  resetOnboardingProgress,
  type OnboardingMetrics,
  type OnboardingMission,
  type OnboardingOverview,
  type OnboardingTask,
  type OnboardingTrainingDataSummary,
} from '@/api/onboarding';
import { queryKeys } from '@/api/query-keys';
import { ConfirmActionDialog } from '@/components/confirm-action-dialog';
import { ErrorState } from '@/components/error-state';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from '@/components/ui/toast';
import { getApiErrorMessage } from '@/lib/api';
import { getAccountRoleLabel, type AccountRole } from '@/lib/roles';
import { cn } from '@/lib/utils';
import { useAuth } from '@/lib/useAuth';
import { useTrainingMode } from '@/lib/useTrainingMode';

function getTaskStatus(task: OnboardingTask) {
  if (task.progress.isCompleted) {
    return {
      className:
        'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/70 dark:bg-emerald-950/40 dark:text-emerald-300',
      icon: CheckCircle2,
      label: 'Готово',
    };
  }

  if (task.progress.isNext) {
    return {
      className:
        'border-primary/25 bg-primary/10 text-primary dark:border-primary/40 dark:bg-primary/15',
      icon: GraduationCap,
      label: 'Следующее',
    };
  }

  return {
    className: 'border-border bg-muted text-muted-foreground',
    icon: Circle,
    label: 'В очереди',
  };
}

function getMissionStats(mission: OnboardingMission) {
  const completed = mission.tasks.filter((task) => task.progress.isCompleted).length;
  return {
    completed,
    percent:
      mission.tasks.length > 0
        ? Math.round((completed / mission.tasks.length) * 100)
        : 0,
    total: mission.tasks.length,
  };
}

function getNextTask(overview: OnboardingOverview | undefined) {
  if (!overview?.summary.nextTaskKey) return null;

  for (const mission of overview.path.missions) {
    const task = mission.tasks.find(
      (item) => item.key === overview.summary.nextTaskKey,
    );
    if (task) return task;
  }

  return null;
}

function getCompletedSkillCount(overview: OnboardingOverview | undefined) {
  if (!overview) return 0;
  return overview.summary.skills.filter((skill) => skill.percent === 100).length;
}

function formatTaskKind(kind: OnboardingTask['kind']) {
  return kind === 'review' ? 'Разбор' : 'Практика';
}

function formatCompletedAt(value: string | null) {
  if (!value) return null;

  return new Intl.DateTimeFormat('ru-RU', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value));
}

function ProgressBar({ percent }: { percent: number }) {
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
      <div
        className="h-full rounded-full bg-primary transition-[width]"
        style={{ width: `${Math.max(0, Math.min(100, percent))}%` }}
      />
    </div>
  );
}

function NextTaskPanel({
  completingTaskKey,
  completionBadge,
  nextTask,
  onComplete,
}: {
  completingTaskKey: string | null;
  completionBadge: string;
  nextTask: OnboardingTask | null;
  onComplete: (task: OnboardingTask) => void;
}) {
  if (!nextTask) {
    return (
      <section className="rounded-md border bg-background p-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0">
            <Badge
              variant="outline"
              className="border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/70 dark:bg-emerald-950/40 dark:text-emerald-300"
            >
              <Award className="h-3 w-3" />
              Путь завершен
            </Badge>
            <h2 className="mt-3 text-lg font-semibold text-foreground">
              {completionBadge}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Все задания роли закрыты, обучение можно использовать как чеклист
              контроля качества.
            </p>
          </div>
          <Trophy className="h-10 w-10 text-primary" />
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-md border bg-background p-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <Badge variant="outline" className="border-primary/25 bg-primary/10 text-primary">
            <ListChecks className="h-3 w-3" />
            Следующее задание
          </Badge>
          <h2 className="mt-3 text-lg font-semibold text-foreground">
            {nextTask.title}
          </h2>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            {nextTask.description}
          </p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {nextTask.skills.map((skill) => (
              <Badge key={skill} variant="secondary">
                {skill}
              </Badge>
            ))}
            <Badge variant="outline">
              <Award className="h-3 w-3" />
              {nextTask.badge}
            </Badge>
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap gap-2 lg:justify-end">
          <Button asChild variant="outline" size="sm">
            <Link to={nextTask.route}>
              <ArrowUpRight className="h-4 w-4" />
              Открыть
            </Link>
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={
              nextTask.progress.isCompleted || completingTaskKey === nextTask.key
            }
            onClick={() => onComplete(nextTask)}
          >
            {completingTaskKey === nextTask.key ? (
              <RefreshCw className="h-4 w-4 animate-spin" />
            ) : (
              <CheckCircle2 className="h-4 w-4" />
            )}
            Завершить
          </Button>
        </div>
      </div>
    </section>
  );
}

function SkillProgressPanel({ overview }: { overview: OnboardingOverview }) {
  const completedSkills = getCompletedSkillCount(overview);

  return (
    <section className="rounded-md border bg-background p-5">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <Badge variant="outline">
            <Sparkles className="h-3 w-3" />
            Навыки пути
          </Badge>
          <h2 className="mt-3 text-lg font-semibold text-foreground">
            {completedSkills}/{overview.summary.skills.length} закрыто
          </h2>
        </div>
        <div className="flex flex-wrap gap-2 md:justify-end">
          {overview.summary.skills.map((skill) => (
            <Badge
              key={skill.name}
              variant="outline"
              className={cn(
                'h-auto py-1',
                skill.percent === 100 &&
                  'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/70 dark:bg-emerald-950/40 dark:text-emerald-300',
              )}
            >
              {skill.name}
              <span className="text-[10px] text-muted-foreground">
                {skill.completedTasks}/{skill.totalTasks}
              </span>
            </Badge>
          ))}
        </div>
      </div>
    </section>
  );
}

function TrainingDataPanel({
  cleaning,
  loading,
  onCleanup,
  roleTitle,
  summary,
}: {
  cleaning: boolean;
  loading: boolean;
  onCleanup: () => void;
  roleTitle: string;
  summary?: OnboardingTrainingDataSummary;
}) {
  const visibleEntities =
    summary?.entities.filter((entity) => entity.count > 0) || [];

  return (
    <section className="rounded-md border bg-background p-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <Badge variant="outline">
            <Database className="h-3 w-3" />
            Учебные данные
          </Badge>
          <h2 className="mt-3 text-lg font-semibold text-foreground">
            {loading ? 'Проверяем...' : `${summary?.totalRecords || 0} записей`}
          </h2>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Только владелец: {roleTitle}. Данные тренировки не участвуют в
            боевых отчетах.
          </p>
        </div>
        <Button
          type="button"
          variant="destructive"
          onClick={onCleanup}
          disabled={loading || cleaning || !summary?.hasRecords}
          title="Очистка учебных данных доступна только владельцу"
        >
          {cleaning ? (
            <RefreshCw className="h-4 w-4 animate-spin" />
          ) : (
            <Trash2 className="h-4 w-4" />
          )}
          Очистить
        </Button>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {visibleEntities.length > 0 ? (
          visibleEntities.map((entity) => (
            <Badge key={entity.key} variant="secondary">
              {entity.label}
              <span className="text-[10px] text-muted-foreground">
                {entity.count}
              </span>
            </Badge>
          ))
        ) : (
          <span className="text-sm text-muted-foreground">
            Для этой роли учебных записей нет.
          </span>
        )}
      </div>
    </section>
  );
}

function OnboardingMetricsPanel({
  loading,
  metrics,
}: {
  loading: boolean;
  metrics?: OnboardingMetrics;
}) {
  const roles = metrics?.roles || [];

  return (
    <section className="rounded-md border bg-background p-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <Badge variant="outline">
            <BarChart3 className="h-3 w-3" />
            Метрики обучения
          </Badge>
          <h2 className="mt-3 text-lg font-semibold text-foreground">
            {loading ? 'Считаем...' : `${metrics?.summary.percent || 0}% общего прогресса`}
          </h2>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Только владелец: сводка по прохождению ролевых путей активными
            аккаунтами.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 lg:justify-end">
          <Badge variant="secondary">
            <UsersRound className="h-3 w-3" />
            {metrics?.summary.activeAccounts || 0} аккаунтов
          </Badge>
          <Badge variant="secondary">
            {metrics?.summary.completedTaskSlots || 0}/{metrics?.summary.totalTaskSlots || 0} заданий
          </Badge>
        </div>
      </div>

      <div className="mt-5 grid gap-3 lg:grid-cols-2">
        {roles.map((role) => (
          <div key={role.role} className="rounded-md border bg-muted/20 p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">{role.label}</Badge>
                  <Badge variant="secondary">
                    {role.startedAccounts}/{role.totalAccounts} начали
                  </Badge>
                </div>
                <div className="mt-2 text-sm text-muted-foreground">
                  {role.completedTaskSlots}/{role.totalTaskSlots} заданий, завершили путь: {role.completedAccounts}
                </div>
              </div>
              <div className="text-left sm:text-right">
                <div className="text-xl font-semibold text-foreground">
                  {role.percent}%
                </div>
                <div className="text-xs text-muted-foreground">
                  {role.lastCompletedAt
                    ? `Обновлено ${formatCompletedAt(role.lastCompletedAt)}`
                    : 'Без прогресса'}
                </div>
              </div>
            </div>
            <div className="mt-3">
              <ProgressBar percent={role.percent} />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function TaskRow({
  completingTaskKey,
  onComplete,
  task,
}: {
  completingTaskKey: string | null;
  onComplete: (task: OnboardingTask) => void;
  task: OnboardingTask;
}) {
  const status = getTaskStatus(task);
  const StatusIcon = status.icon;
  const completedAt = formatCompletedAt(task.progress.completedAt);

  return (
    <div
      className={cn(
        'rounded-md border bg-background p-4',
        task.progress.isNext && !task.progress.isCompleted && 'border-primary/40',
      )}
    >
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className={status.className}>
              <StatusIcon className="h-3 w-3" />
              {status.label}
            </Badge>
            <Badge variant="outline">{formatTaskKind(task.kind)}</Badge>
            {task.trainingMode?.recommended && (
              <Badge
                variant="outline"
                className="border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/70 dark:bg-amber-950/40 dark:text-amber-300"
              >
                Тренировка
              </Badge>
            )}
          </div>

          <h3 className="mt-3 text-base font-semibold text-foreground">
            {task.title}
          </h3>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            {task.description}
          </p>

          <div className="mt-3 flex flex-wrap gap-1.5">
            {task.skills.map((skill) => (
              <Badge key={skill} variant="secondary">
                {skill}
              </Badge>
            ))}
            <Badge variant="outline">
              <Award className="h-3 w-3" />
              {task.badge}
            </Badge>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <Timer className="h-3.5 w-3.5" />
              {task.estimatedMinutes} мин
            </span>
            <span className="inline-flex items-center gap-1">
              <Trophy className="h-3.5 w-3.5" />
              {task.rewardXp} XP
            </span>
            <span className="font-mono text-[11px]">
              {task.checkpoint.event}
            </span>
            {completedAt && <span>Завершено: {completedAt}</span>}
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap gap-2 lg:justify-end">
          <Button asChild variant="outline" size="sm">
            <Link to={task.route}>
              <ArrowUpRight className="h-4 w-4" />
              Открыть
            </Link>
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={
              task.progress.isCompleted || completingTaskKey === task.key
            }
            onClick={() => onComplete(task)}
          >
            {completingTaskKey === task.key ? (
              <RefreshCw className="h-4 w-4 animate-spin" />
            ) : (
              <CheckCircle2 className="h-4 w-4" />
            )}
            Завершить
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function OnboardingPage() {
  const { account } = useAuth();
  const trainingMode = useTrainingMode();
  const queryClient = useQueryClient();
  const [selectedRoleOverride, setSelectedRoleOverride] =
    useState<AccountRole | null>(null);
  const [confirmTrainingCleanup, setConfirmTrainingCleanup] = useState(false);

  const roleForRequest =
    account?.role === 'owner'
      ? selectedRoleOverride || account.role
      : undefined;
  const roleForQueryKey =
    account?.role === 'owner'
      ? selectedRoleOverride || account.role
      : account?.role;

  const onboardingQuery = useQuery({
    enabled: Boolean(account?.role),
    queryFn: () => getOnboardingOverview(roleForRequest),
    queryKey: queryKeys.onboarding.detail(roleForQueryKey),
  });

  const trainingDataQuery = useQuery({
    enabled: account?.role === 'owner' && Boolean(roleForQueryKey),
    queryFn: () => getOnboardingTrainingData(roleForQueryKey as AccountRole),
    queryKey: queryKeys.onboarding.trainingData(roleForQueryKey),
  });

  const metricsQuery = useQuery({
    enabled: account?.role === 'owner',
    queryFn: getOnboardingMetrics,
    queryKey: queryKeys.onboarding.metrics(),
  });

  const overview = onboardingQuery.data;
  const activeRole = overview?.selectedRole || roleForQueryKey;

  const completeMutation = useMutation({
    mutationFn: (task: OnboardingTask) =>
      completeOnboardingTask(task.key, activeRole),
    onSuccess: (data: OnboardingOverview) => {
      queryClient.setQueryData(
        queryKeys.onboarding.detail(data.selectedRole),
        data,
      );
      queryClient.invalidateQueries({ queryKey: queryKeys.onboarding.metrics() });
      toast.success('Задание завершено');
    },
  });

  const resetMutation = useMutation({
    mutationFn: () => resetOnboardingProgress(activeRole),
    onSuccess: (data: OnboardingOverview) => {
      queryClient.setQueryData(
        queryKeys.onboarding.detail(data.selectedRole),
        data,
      );
      queryClient.invalidateQueries({ queryKey: queryKeys.onboarding.metrics() });
      toast.success('Прогресс сброшен');
    },
  });

  const cleanupTrainingDataMutation = useMutation({
    mutationFn: () => cleanupOnboardingTrainingData(activeRole),
    onSuccess: (data) => {
      queryClient.setQueryData(
        queryKeys.onboarding.trainingData(data.role),
        data.remaining,
      );
      queryClient.invalidateQueries({ queryKey: queryKeys.onboarding.all });
      toast.success('Учебные данные очищены');
    },
  });

  const completedMissions = useMemo(() => {
    if (!overview) return 0;
    return overview.path.missions.filter((mission) => {
      const stats = getMissionStats(mission);
      return stats.total > 0 && stats.completed === stats.total;
    }).length;
  }, [overview]);

  const nextTask = useMemo(() => getNextTask(overview), [overview]);

  const handleRoleChange = (role: string) => {
    setSelectedRoleOverride(role as AccountRole);
  };

  const handleComplete = async (task: OnboardingTask) => {
    try {
      await completeMutation.mutateAsync(task);
    } catch (error) {
      toast.error(
        getApiErrorMessage(error, 'Не удалось обновить прогресс обучения'),
      );
    }
  };

  const handleReset = async () => {
    try {
      await resetMutation.mutateAsync();
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'Не удалось сбросить прогресс'));
    }
  };

  const handleTrainingModeToggle = async () => {
    try {
      if (trainingMode.state.isEnabled) {
        await trainingMode.disable();
        toast.success('Режим тренировки выключен');
      } else {
        await trainingMode.enable(activeRole);
        toast.success('Режим тренировки включен');
      }
    } catch (error) {
      toast.error(
        getApiErrorMessage(error, 'Не удалось изменить режим тренировки'),
      );
    }
  };

  const handleCleanupTrainingData = async () => {
    try {
      await cleanupTrainingDataMutation.mutateAsync();
      setConfirmTrainingCleanup(false);
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'Не удалось очистить учебные данные'));
    }
  };

  if (onboardingQuery.isError) {
    return (
      <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <ErrorState
          message={getApiErrorMessage(
            onboardingQuery.error,
            'Не удалось загрузить обучение',
          )}
          onRetry={() => onboardingQuery.refetch()}
        />
      </div>
    );
  }

  if (onboardingQuery.isLoading || !overview) {
    return (
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
        <div className="h-32 animate-pulse rounded-md border bg-muted/40" />
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="h-48 animate-pulse rounded-md border bg-muted/40" />
          <div className="h-48 animate-pulse rounded-md border bg-muted/40" />
        </div>
      </div>
    );
  }

  const summary = overview.summary;
  const roleTitle = getAccountRoleLabel(overview.selectedRole);
  const completingTaskKey = completeMutation.isPending
    ? completeMutation.variables?.key || null
    : null;

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
      <section className="rounded-md border bg-background p-5">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="border-primary/25 bg-primary/10 text-primary">
                <GraduationCap className="h-3 w-3" />
                {roleTitle}
              </Badge>
              <Badge variant="outline">{overview.path.levelLabel}</Badge>
              {summary.percent === 100 && (
                <Badge
                  variant="outline"
                  className="border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/70 dark:bg-emerald-950/40 dark:text-emerald-300"
                >
                  <Award className="h-3 w-3" />
                  {overview.path.completionBadge}
                </Badge>
              )}
              {overview.ownerRoleOverrideEnabled && (
                <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/70 dark:bg-emerald-950/40 dark:text-emerald-300">
                  <ShieldCheck className="h-3 w-3" />
                  Режим владельца
                </Badge>
              )}
            </div>

            <h1 className="mt-3 text-2xl font-semibold text-foreground">
              {overview.path.title}
            </h1>
            <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
              {overview.path.description}
            </p>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            {overview.ownerRoleOverrideEnabled && (
              <div className="w-full min-w-56 sm:w-64">
                <div className="mb-1 text-xs font-medium text-muted-foreground">
                  Роль прохождения · только владелец
                </div>
                <Select
                  value={overview.selectedRole}
                  onValueChange={handleRoleChange}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {overview.availableRoles.map((role) => (
                      <SelectItem key={role.value} value={role.value}>
                        {role.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <Button
              type="button"
              variant="outline"
              onClick={handleReset}
              disabled={resetMutation.isPending || summary.completedTasks === 0}
              title={
                summary.completedTasks === 0
                  ? 'Нет завершенных заданий для сброса'
                  : 'Сбросить прогресс текущей роли'
              }
            >
              {resetMutation.isPending ? (
                <RefreshCw className="h-4 w-4 animate-spin" />
              ) : (
                <RotateCcw className="h-4 w-4" />
              )}
              Сбросить
            </Button>
            <Button
              type="button"
              variant={trainingMode.state.isEnabled ? 'destructive' : 'secondary'}
              onClick={handleTrainingModeToggle}
              disabled={trainingMode.loading}
            >
              {trainingMode.state.isEnabled ? (
                <Power className="h-4 w-4" />
              ) : (
                <FlaskConical className="h-4 w-4" />
              )}
              {trainingMode.state.isEnabled ? 'Выключить тренировку' : 'Тренировка'}
            </Button>
          </div>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-4">
          <div className="rounded-md border bg-muted/20 p-4">
            <div className="text-xs text-muted-foreground">Прогресс</div>
            <div className="mt-1 text-2xl font-semibold">{summary.percent}%</div>
          </div>
          <div className="rounded-md border bg-muted/20 p-4">
            <div className="text-xs text-muted-foreground">Задания</div>
            <div className="mt-1 text-2xl font-semibold">
              {summary.completedTasks}/{summary.totalTasks}
            </div>
          </div>
          <div className="rounded-md border bg-muted/20 p-4">
            <div className="text-xs text-muted-foreground">Миссии</div>
            <div className="mt-1 text-2xl font-semibold">
              {completedMissions}/{overview.path.missions.length}
            </div>
          </div>
          <div className="rounded-md border bg-muted/20 p-4">
            <div className="text-xs text-muted-foreground">Опыт</div>
            <div className="mt-1 text-2xl font-semibold">
              {summary.earnedXp}/{summary.totalXp}
            </div>
          </div>
        </div>

        <div className="mt-5">
          <ProgressBar percent={summary.percent} />
        </div>

        {overview.path.outcomes.length > 0 && (
          <div className="mt-5 flex flex-wrap gap-2">
            {overview.path.outcomes.map((outcome) => (
              <Badge key={outcome} variant="outline">
                {outcome}
              </Badge>
            ))}
          </div>
        )}
      </section>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
        <NextTaskPanel
          completingTaskKey={completingTaskKey}
          completionBadge={overview.path.completionBadge}
          nextTask={nextTask}
          onComplete={handleComplete}
        />
        <SkillProgressPanel overview={overview} />
      </div>

      {overview.ownerRoleOverrideEnabled && (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
          <OnboardingMetricsPanel
            loading={metricsQuery.isLoading}
            metrics={metricsQuery.data}
          />
          <TrainingDataPanel
            cleaning={cleanupTrainingDataMutation.isPending}
            loading={trainingDataQuery.isLoading}
            onCleanup={() => setConfirmTrainingCleanup(true)}
            roleTitle={roleTitle}
            summary={trainingDataQuery.data}
          />
        </div>
      )}

      <div className="grid gap-5">
        {overview.path.missions.map((mission) => {
          const stats = getMissionStats(mission);

          return (
            <section key={mission.key} className="rounded-md border bg-background">
              <div className="border-b p-5">
                <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                  <div className="min-w-0">
                    <h2 className="text-lg font-semibold text-foreground">
                      {mission.title}
                    </h2>
                    <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
                      {mission.description}
                    </p>
                  </div>
                  <div className="w-full shrink-0 md:w-56">
                    <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
                      <span>
                        {stats.completed}/{stats.total}
                      </span>
                      <span>{stats.percent}%</span>
                    </div>
                    <ProgressBar percent={stats.percent} />
                  </div>
                </div>
              </div>

              <div className="grid gap-3 p-5">
                {mission.tasks.map((task) => (
                  <TaskRow
                    key={task.key}
                    completingTaskKey={completingTaskKey}
                    onComplete={handleComplete}
                    task={task}
                  />
                ))}
              </div>
            </section>
          );
        })}
      </div>

      <ConfirmActionDialog
        action={
          confirmTrainingCleanup
            ? {
                confirmLabel: 'Очистить',
                description: `Будут удалены учебные записи для роли «${roleTitle}». Прогресс обучения останется.`,
                isDestructive: true,
                title: 'Очистить учебные данные?',
              }
            : null
        }
        loading={cleanupTrainingDataMutation.isPending}
        onCancel={() => setConfirmTrainingCleanup(false)}
        onConfirm={handleCleanupTrainingData}
      />
    </div>
  );
}
