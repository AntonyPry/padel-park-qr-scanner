import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Award,
  BarChart3,
  BookOpenCheck,
  CheckCircle2,
  Circle,
  Database,
  ExternalLink,
  GraduationCap,
  ImageOff,
  ListChecks,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Timer,
  Trash2,
  Trophy,
  X,
  ZoomIn,
} from 'lucide-react';
import {
  Link,
  useNavigate,
  useParams,
  useSearchParams,
} from 'react-router-dom';
import {
  cleanupOnboardingTrainingData,
  completeOnboardingTask,
  getOnboardingMetrics,
  getOnboardingOverview,
  getOnboardingTaskDetail,
  getOnboardingTrainingData,
  resetOnboardingProgress,
  type OnboardingGuidedTask,
  type OnboardingLessonBlock,
  type OnboardingMetrics,
  type OnboardingMission,
  type OnboardingOverview,
  type OnboardingTask,
  type OnboardingTaskDetail,
  type OnboardingTrainingDataSummary,
} from '@/api/onboarding';
import { queryKeys } from '@/api/query-keys';
import { ConfirmActionDialog } from '@/components/confirm-action-dialog';
import { ErrorState } from '@/components/error-state';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from '@/components/ui/toast';
import { getApiErrorMessage } from '@/lib/api';
import {
  activateOnboardingQuest,
  clearStoredActiveOnboardingQuest,
} from '@/lib/onboarding-quest';
import { getAccountRoleLabel, type AccountRole } from '@/lib/roles';
import { useTheme } from '@/lib/theme-context';
import { cn } from '@/lib/utils';
import { useAuthorizationRole } from '@/lib/useAuth';

function getTaskStatus(task: OnboardingTask) {
  if (task.progress.isCompleted && task.progress.lesson.isUpdatedAfterCompletion) {
    return {
      className:
        'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/70 dark:bg-amber-950/40 dark:text-amber-300',
      icon: Sparkles,
      label: 'Обновлено',
    };
  }

  if (task.progress.isCompleted) {
    return {
      className:
        'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/70 dark:bg-emerald-950/40 dark:text-emerald-300',
      icon: CheckCircle2,
      label: 'Готово',
    };
  }

  if (task.progress.status === 'in_progress') {
    return {
      className:
        'border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-900/70 dark:bg-sky-950/40 dark:text-sky-300',
      icon: BookOpenCheck,
      label: 'В процессе',
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
  return kind === 'review' ? 'Разбор' : 'Действие';
}

function formatCompletedAt(value: string | null) {
  if (!value) return null;

  return new Intl.DateTimeFormat('ru-RU', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value));
}

function roleQuery(role?: AccountRole | null) {
  return role ? `?role=${encodeURIComponent(role)}` : '';
}

function taskDetailUrl(taskKey: string, role?: AccountRole | null) {
  return `/admin/onboarding/${encodeURIComponent(taskKey)}${roleQuery(role)}`;
}

const TASK_KEY_ROLE_PREFIXES: AccountRole[] = [
  'owner',
  'manager',
  'admin',
  'accountant',
  'trainer',
  'viewer',
];

function inferRoleFromTaskKey(taskKey?: string) {
  const prefix = taskKey?.split('.')[0];

  if (TASK_KEY_ROLE_PREFIXES.includes(prefix as AccountRole)) {
    return prefix as AccountRole;
  }

  return null;
}

function getThemedScreenshotSrc(src: string, resolvedTheme: 'light' | 'dark') {
  if (resolvedTheme !== 'light') return src;
  return src.replace(/^\/onboarding\//, '/onboarding-light/');
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

function RoleSelect({
  overview,
  onChange,
}: {
  overview: OnboardingOverview;
  onChange: (role: string) => void;
}) {
  if (!overview.ownerRoleOverrideEnabled) return null;

  return (
    <div className="w-full min-w-56 sm:w-64">
      <div className="mb-1 text-xs font-medium text-muted-foreground">
        Роль прохождения
      </div>
      <Select value={overview.selectedRole} onValueChange={onChange}>
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
            Навыки
          </Badge>
          <h2 className="mt-3 text-base font-semibold text-foreground">
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
          <h2 className="mt-3 text-base font-semibold text-foreground">
            {loading ? 'Проверяем...' : `${summary?.totalRecords || 0} записей`}
          </h2>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            {roleTitle}: training-записи не участвуют в боевых отчетах.
          </p>
        </div>
        <Button
          type="button"
          variant="destructive"
          onClick={onCleanup}
          disabled={loading || cleaning || !summary?.hasRecords}
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
            Метрики
          </Badge>
          <h2 className="mt-3 text-base font-semibold text-foreground">
            {loading ? 'Считаем...' : `${metrics?.summary.percent || 0}% общего прогресса`}
          </h2>
        </div>
        <Badge variant="secondary">
          {metrics?.summary.completedTaskSlots || 0}/{metrics?.summary.totalTaskSlots || 0} заданий
        </Badge>
      </div>

      <div className="mt-5 grid gap-3 lg:grid-cols-2">
        {roles.map((role) => (
          <div key={role.role} className="rounded-md border bg-muted/20 p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <Badge variant="outline">{role.label}</Badge>
                <div className="mt-2 text-xs text-muted-foreground">
                  {role.startedAccounts}/{role.totalAccounts} начали
                </div>
              </div>
              <div className="text-right text-lg font-semibold text-foreground">
                {role.percent}%
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

function TaskCard({
  selectedRole,
  task,
}: {
  selectedRole: AccountRole;
  task: OnboardingTask;
}) {
  const status = getTaskStatus(task);
  const StatusIcon = status.icon;
  const completedAt = formatCompletedAt(task.progress.completedAt);
  const lessonUpdatedAt = formatCompletedAt(task.progress.lesson.updatedAt);
  const isUpdatedAfterCompletion = task.progress.lesson.isUpdatedAfterCompletion;

  return (
    <article
      className={cn(
        'rounded-md border bg-background p-4 transition-colors',
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
            <span className="inline-flex items-center gap-1">
              <BookOpenCheck className="h-3.5 w-3.5" />
              {task.progress.isCompleted ? 'урок пройден' : 'поэтапный урок'}
            </span>
            {completedAt && <span>Завершено: {completedAt}</span>}
            {isUpdatedAfterCompletion && lessonUpdatedAt && (
              <span className="inline-flex items-center gap-1 font-medium text-amber-700 dark:text-amber-300">
                <Sparkles className="h-3.5 w-3.5" />
                Обновлено: {lessonUpdatedAt}
              </span>
            )}
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap gap-2 lg:justify-end">
          <Button asChild size="sm">
            <Link to={taskDetailUrl(task.key, selectedRole)}>
              <BookOpenCheck className="h-4 w-4" />
              Открыть урок
            </Link>
          </Button>
        </div>
      </div>
    </article>
  );
}

function OnboardingListView({
  onRoleChange,
  overview,
}: {
  onRoleChange: (role: string) => void;
  overview: OnboardingOverview;
}) {
  const clubRole = useAuthorizationRole('club');
  const organizationRole = useAuthorizationRole('organization');
  const queryClient = useQueryClient();
  const [confirmTrainingCleanup, setConfirmTrainingCleanup] = useState(false);
  const activeRole = overview.selectedRole;
  const roleTitle = getAccountRoleLabel(activeRole);
  const nextTask = useMemo(() => getNextTask(overview), [overview]);
  const completedMissions = useMemo(
    () =>
      overview.path.missions.filter((mission) => {
        const stats = getMissionStats(mission);
        return stats.total > 0 && stats.completed === stats.total;
      }).length,
    [overview],
  );
  const hasProgress = overview.path.missions.some((mission) =>
    mission.tasks.some((task) => task.progress.status !== 'not_started'),
  );

  const trainingDataQuery = useQuery({
    enabled: clubRole === 'owner',
    queryFn: () => getOnboardingTrainingData(activeRole),
    queryKey: queryKeys.onboarding.trainingData(activeRole),
  });
  const metricsQuery = useQuery({
    enabled: organizationRole === 'owner',
    queryFn: getOnboardingMetrics,
    queryKey: queryKeys.onboarding.metrics(),
  });
  const resetMutation = useMutation({
    mutationFn: () => resetOnboardingProgress(activeRole),
    onSuccess: (data: OnboardingOverview) => {
      queryClient.setQueryData(
        queryKeys.onboarding.detail(data.selectedRole),
        data,
      );
      queryClient.invalidateQueries({ queryKey: queryKeys.onboarding.metrics() });
      queryClient.invalidateQueries({ queryKey: queryKeys.onboarding.all });
      clearStoredActiveOnboardingQuest();
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

  const handleReset = async () => {
    try {
      await resetMutation.mutateAsync();
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'Не удалось сбросить прогресс'));
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
              {overview.ownerRoleOverrideEnabled && (
                <Badge
                  variant="outline"
                  className="border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/70 dark:bg-emerald-950/40 dark:text-emerald-300"
                >
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
            <RoleSelect overview={overview} onChange={onRoleChange} />
            <Button
              type="button"
              variant="outline"
              onClick={handleReset}
              disabled={resetMutation.isPending || !hasProgress}
            >
              {resetMutation.isPending ? (
                <RefreshCw className="h-4 w-4 animate-spin" />
              ) : (
                <RotateCcw className="h-4 w-4" />
              )}
              Сбросить
            </Button>
          </div>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-4">
          <div className="rounded-md border bg-muted/20 p-4">
            <div className="text-xs text-muted-foreground">Прогресс</div>
            <div className="mt-1 text-2xl font-semibold">{overview.summary.percent}%</div>
          </div>
          <div className="rounded-md border bg-muted/20 p-4">
            <div className="text-xs text-muted-foreground">Задания</div>
            <div className="mt-1 text-2xl font-semibold">
              {overview.summary.completedTasks}/{overview.summary.totalTasks}
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
              {overview.summary.earnedXp}/{overview.summary.totalXp}
            </div>
          </div>
        </div>

        <div className="mt-5">
          <ProgressBar percent={overview.summary.percent} />
        </div>
      </section>

      {nextTask && (
        <section className="rounded-md border bg-background p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
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
            </div>
            <Button asChild>
              <Link to={taskDetailUrl(nextTask.key, activeRole)}>
                <BookOpenCheck className="h-4 w-4" />
                Начать урок
              </Link>
            </Button>
          </div>
        </section>
      )}

      <SkillProgressPanel overview={overview} />

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
                  <TaskCard
                    key={task.key}
                    selectedRole={activeRole}
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

function getInstructionCardStorageKey(
  role: AccountRole,
  taskKey: string,
  lessonUpdatedAt?: string | null,
) {
  return `padel-park:onboarding-card:${role}:${taskKey}:${lessonUpdatedAt || 'draft'}`;
}

function getCardScreenshots(
  task: OnboardingGuidedTask,
  block: OnboardingLessonBlock,
) {
  const indices = Array.isArray(block.screenshotIndices)
    ? block.screenshotIndices
    : Number.isInteger(block.screenshotIndex)
      ? [Number(block.screenshotIndex)]
      : [];

  return indices
    .map((index) => task.lesson.screenshots[index])
    .filter(Boolean);
}

function ScreenshotCallouts({
  embedded = false,
  callouts,
}: {
  embedded?: boolean;
  callouts?: OnboardingGuidedTask['lesson']['screenshots'][number]['callouts'];
}) {
  if (embedded) return null;
  if (!Array.isArray(callouts) || callouts.length === 0) return null;

  return (
    <span className="pointer-events-none absolute inset-0 [container-type:inline-size]">
      {callouts.map((callout, index) => (
        <span
          key={`frame-${callout.label || index}-${callout.x}-${callout.y}`}
          className="absolute rounded-[2px] border border-primary/90 bg-primary/[0.04]"
          style={{
            borderWidth: 'clamp(1px, 0.12cqw, 2px)',
            height: `${callout.height || 8}%`,
            left: `${callout.x}%`,
            top: `${callout.y}%`,
            width: `${callout.width || 8}%`,
          }}
        />
      ))}
      {callouts.map((callout, index) => (
        <span
          key={`marker-${callout.label || index}-${callout.x}-${callout.y}`}
          className="absolute flex -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-primary font-semibold leading-none text-primary-foreground shadow-sm ring-1 ring-background [container-type:inline-size]"
          style={{
            aspectRatio: '1 / 1',
            height: 'auto',
            left: `${callout.labelX ?? callout.x}%`,
            maxWidth: '14px',
            minWidth: '8px',
            top: `${callout.labelY ?? callout.y}%`,
            width: `clamp(8px, ${callout.markerSize || 1.8}%, 14px)`,
          }}
        >
          <span
            className="leading-none"
            style={{
              fontSize: '62cqw',
            }}
          >
            {callout.label || index + 1}
          </span>
        </span>
      ))}
    </span>
  );
}

function ScreenshotCaption({
  asFigureCaption = false,
  screenshot,
}: {
  asFigureCaption?: boolean;
  screenshot: OnboardingGuidedTask['lesson']['screenshots'][number];
}) {
  const legendItems = (screenshot.callouts || []).filter((callout) =>
    callout.text,
  );

  if (!screenshot.caption && legendItems.length === 0) return null;

  const CaptionTag = asFigureCaption ? 'figcaption' : 'div';

  return (
    <CaptionTag className="border-t bg-background px-3 py-2 text-xs text-muted-foreground">
      {screenshot.caption && <p>{screenshot.caption}</p>}
      {legendItems.length > 0 && (
        <ol className="mt-2 grid gap-1">
          {legendItems.map((callout, index) => (
            <li
              key={`${callout.label || index}-${callout.text}`}
              className="grid grid-cols-[auto_minmax(0,1fr)] gap-2 leading-4"
            >
              <span className="font-semibold text-primary">
                {callout.label || index + 1}
              </span>
              <span>{callout.text}</span>
            </li>
          ))}
        </ol>
      )}
    </CaptionTag>
  );
}

function MissingScreenshotNotice({ text }: { text: string }) {
  return (
    <div className="mt-5 rounded-md border border-dashed border-amber-300 bg-amber-50/80 p-3 text-sm text-amber-900 dark:border-amber-800/70 dark:bg-amber-950/30 dark:text-amber-200">
      <div className="flex gap-2">
        <ImageOff className="mt-0.5 h-4 w-4 shrink-0" />
        <div>
          <p className="font-medium">missing screenshot</p>
          <p className="mt-1 leading-5">{text}</p>
        </div>
      </div>
    </div>
  );
}

function InstructionScreenshot({
  screenshot,
  title,
}: {
  screenshot: OnboardingGuidedTask['lesson']['screenshots'][number];
  title: string;
}) {
  const alt = screenshot.alt || screenshot.caption || title;
  const [open, setOpen] = useState(false);
  const { resolvedTheme } = useTheme();
  const screenshotSrc = getThemedScreenshotSrc(screenshot.src, resolvedTheme);
  const closeZoom = () => setOpen(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <figure
        className={cn(
          'flex flex-col overflow-hidden rounded-md border bg-muted/20',
          screenshot.kind === 'crop' ? 'min-h-[170px]' : 'min-h-[260px]',
        )}
      >
        <DialogTrigger asChild>
          <button
            type="button"
            className="group relative flex flex-1 cursor-zoom-in items-center justify-center p-3 text-left outline-none transition-colors hover:bg-muted/30 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            aria-label="Открыть скриншот крупнее"
          >
            <span className="relative block w-full">
              <img
                src={screenshotSrc}
                alt={alt}
                className={cn(
                  'w-full object-contain',
                  screenshot.kind === 'crop' ? 'max-h-[300px]' : 'max-h-[520px]',
                )}
              />
              <ScreenshotCallouts
                callouts={screenshot.callouts}
                embedded={screenshot.calloutsEmbedded}
              />
            </span>
            <span className="pointer-events-none absolute right-3 top-3 inline-flex h-9 w-9 items-center justify-center rounded-full border bg-background/90 text-foreground opacity-0 shadow-sm transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
              <ZoomIn className="h-4 w-4" />
            </span>
          </button>
        </DialogTrigger>
        <ScreenshotCaption asFigureCaption screenshot={screenshot} />
      </figure>

      <DialogContent
        className="max-h-[calc(100dvh-1rem)] max-w-[calc(100vw-1rem)] overflow-hidden rounded-md p-0 sm:max-w-[min(1280px,calc(100vw-2rem))]"
        overlayClassName="bg-black/70 supports-backdrop-filter:backdrop-blur-sm"
        showCloseButton={false}
      >
        <DialogHeader className="sr-only">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{screenshot.caption || alt}</DialogDescription>
        </DialogHeader>
        <DialogClose asChild>
          <Button
            type="button"
            variant="secondary"
            size="icon-sm"
            className="absolute right-3 top-3 z-10 bg-background/90 shadow-sm"
            aria-label="Закрыть скриншот"
          >
            <X className="h-4 w-4" />
          </Button>
        </DialogClose>
        <div
          className="max-h-[calc(100dvh-5rem)] overflow-auto bg-black p-2 sm:flex sm:items-center sm:justify-center sm:p-4"
          onClick={closeZoom}
          onPointerDownCapture={closeZoom}
        >
          <span
            className="relative inline-block"
            onClick={closeZoom}
            onPointerDownCapture={closeZoom}
          >
            <img
              src={screenshotSrc}
              alt={alt}
              className="h-auto w-[920px] max-w-none object-contain sm:max-h-[calc(100dvh-7rem)] sm:w-auto sm:max-w-full"
              onClick={closeZoom}
              onPointerDownCapture={closeZoom}
            />
            <ScreenshotCallouts
              callouts={screenshot.callouts}
              embedded={screenshot.calloutsEmbedded}
            />
          </span>
        </div>
        <ScreenshotCaption screenshot={screenshot} />
      </DialogContent>
    </Dialog>
  );
}

function InstructionScreenshots({
  screenshots,
  title,
}: {
  screenshots: OnboardingGuidedTask['lesson']['screenshots'];
  title: string;
}) {
  if (screenshots.length === 0) return null;

  return (
    <div className="grid min-w-0 gap-3">
      {screenshots.map((item) => (
        <InstructionScreenshot
          key={`${item.src}-${item.caption || item.alt || title}`}
          screenshot={item}
          title={title}
        />
      ))}
    </div>
  );
}

function InstructionCardReader({
  isPending,
  onComplete,
  role,
  task,
}: {
  isPending: boolean;
  onComplete: () => void;
  role: AccountRole;
  task: OnboardingGuidedTask;
}) {
  const blocks =
    task.lesson.blocks.length > 0
      ? task.lesson.blocks
      : [{ text: task.description, type: 'paragraph' }];
  const storageKey = getInstructionCardStorageKey(
    role,
    task.key,
    task.lesson.updatedAt || task.progress.lesson.updatedAt,
  );
  const [cardIndex, setCardIndex] = useState(() => {
    if (typeof window === 'undefined') return 0;

    const saved = Number(window.localStorage.getItem(storageKey));
    return Number.isFinite(saved) ? saved : 0;
  });
  const safeIndex = Math.max(0, Math.min(cardIndex, blocks.length - 1));
  const block = blocks[safeIndex];
  const screenshots = getCardScreenshots(task, block);
  const hasScreenshots = screenshots.length > 0;
  const title =
    block.title ||
    (block.type === 'heading' ? block.text : `Этап ${safeIndex + 1}`);
  const showText = block.type !== 'heading' || Boolean(block.title);
  const isFinalCard = safeIndex === blocks.length - 1;
  const isUpdatedAfterCompletion = task.progress.lesson.isUpdatedAfterCompletion;
  const progressPercent = Math.round(((safeIndex + 1) / blocks.length) * 100);

  const saveCardIndex = (nextIndex: number) => {
    const boundedIndex = Math.max(0, Math.min(nextIndex, blocks.length - 1));
    setCardIndex(boundedIndex);

    if (typeof window !== 'undefined') {
      window.localStorage.setItem(storageKey, String(boundedIndex));
    }
  };

  const handleNext = () => {
    if (isFinalCard) {
      onComplete();
      return;
    }

    saveCardIndex(safeIndex + 1);
  };

  return (
    <section className="grid gap-4">
      <article
        key={`${task.key}-${safeIndex}`}
        className="overflow-hidden rounded-md border bg-background motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-right-3"
      >
        <div
          className={cn(
            'grid gap-5 p-5 sm:p-6',
            hasScreenshots
              ? 'min-h-[min(680px,calc(100dvh-14rem))] lg:grid-cols-[minmax(0,0.85fr)_minmax(360px,1.15fr)]'
              : 'min-h-[min(520px,calc(100dvh-14rem))]',
          )}
        >
          <div
            className={cn(
              'flex min-w-0 flex-col justify-center',
              !hasScreenshots && 'mx-auto w-full max-w-3xl',
            )}
          >
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="w-fit">
                Этап {safeIndex + 1}/{blocks.length}
              </Badge>
            </div>
            <h2 className="mt-4 text-2xl font-semibold leading-tight text-foreground">
              {title}
            </h2>
            {showText && (
              <p className="mt-4 text-sm leading-6 text-muted-foreground sm:text-base">
                {block.text}
              </p>
            )}
            {Array.isArray(block.items) && block.items.length > 0 && (
              <ul className="mt-5 grid gap-2 text-sm text-muted-foreground">
                {block.items.map((item) => (
                  <li key={item} className="flex gap-2">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            )}
            {block.missingScreenshot && !hasScreenshots && (
              <MissingScreenshotNotice text={block.missingScreenshot} />
            )}
          </div>

          {hasScreenshots && (
            <InstructionScreenshots screenshots={screenshots} title={title} />
          )}
        </div>
      </article>

      <div className="grid grid-cols-[minmax(4.5rem,auto)_minmax(0,1fr)_minmax(5.75rem,auto)] items-center gap-2 sm:gap-3">
        <Button
          type="button"
          variant="outline"
          className="min-w-0 justify-center px-3 text-center"
          onClick={() => saveCardIndex(safeIndex - 1)}
          disabled={safeIndex === 0}
        >
          Назад
        </Button>

        <div className="min-w-0">
          <div className="mb-1 flex items-center justify-between gap-2 text-[11px] text-muted-foreground sm:text-xs">
            <span className="truncate">Прогресс урока</span>
            <span className="shrink-0">{progressPercent}%</span>
          </div>
          <ProgressBar percent={progressPercent} />
          <div className="mt-2 flex justify-center gap-1">
            {blocks.map((item, index) => (
              <button
                key={`${item.type}-${index}`}
                type="button"
                className={cn(
                  'h-2.5 w-2.5 rounded-full border transition-colors',
                  index === safeIndex
                    ? 'border-primary bg-primary'
                    : 'border-border bg-muted hover:bg-muted-foreground/20',
                )}
                aria-label={`Открыть этап ${index + 1}`}
                onClick={() => saveCardIndex(index)}
              />
            ))}
          </div>
        </div>

        <Button
          type="button"
          className="min-w-0 justify-center whitespace-normal px-3 text-center"
          onClick={handleNext}
          disabled={
            isPending ||
            (task.progress.isCompleted && !isUpdatedAfterCompletion && isFinalCard)
          }
        >
          {isPending ? (
            <RefreshCw className="h-4 w-4 animate-spin" />
          ) : (
            <CheckCircle2 className="h-4 w-4" />
          )}
          {task.progress.isCompleted && isUpdatedAfterCompletion && isFinalCard
            ? 'Отметить обновление'
            : task.progress.isCompleted && isFinalCard
            ? 'Урок завершен'
            : isFinalCard
              ? 'Завершить урок'
              : 'Далее'}
        </Button>
      </div>
    </section>
  );
}

function TaskDetailView({
  detail,
  loadingCompletion,
  onComplete,
}: {
  detail: OnboardingTaskDetail;
  loadingCompletion: boolean;
  onComplete: () => void;
}) {
  const task = detail.task;
  const roleTitle = getAccountRoleLabel(detail.selectedRole);
  const status = getTaskStatus(task);
  const StatusIcon = status.icon;
  const lessonUpdatedAt = formatCompletedAt(task.progress.lesson.updatedAt);
  const isUpdatedAfterCompletion = task.progress.lesson.isUpdatedAfterCompletion;
  const navigate = useNavigate();
  const canOpenInCrm = Boolean(task.route?.startsWith('/admin'));

  const handleOpenInCrm = () => {
    if (!canOpenInCrm) return;

    const quest = activateOnboardingQuest(task, detail.selectedRole);
    if (!quest) return;

    navigate(quest.route);
  };

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 py-4 sm:px-6 sm:py-6 lg:px-8">
      <div className="flex flex-col gap-3 rounded-md border bg-background/80 p-3 sm:flex-row sm:items-center sm:justify-between sm:p-4">
        <div className="min-w-0">
          <Button asChild variant="ghost" size="sm" className="-ml-2">
            <Link
              to={`/admin/onboarding${roleQuery(detail.selectedRole)}`}
              onClick={() => clearStoredActiveOnboardingQuest()}
            >
              <ArrowLeft className="h-4 w-4" />
              К заданиям
            </Link>
          </Button>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Badge variant="outline" className={status.className}>
              <StatusIcon className="h-3 w-3" />
              {status.label}
            </Badge>
            <Badge variant="outline">{roleTitle}</Badge>
            <Badge variant="outline">{detail.mission.title}</Badge>
          </div>
        </div>
        <div className="min-w-0 sm:text-right">
          <div className="text-xs text-muted-foreground">Урок</div>
          <h1 className="mt-1 truncate text-sm font-semibold text-foreground sm:text-base">
            {task.title}
          </h1>
          <div className="mt-3 flex justify-start sm:justify-end">
            <Button
              type="button"
              size="sm"
              onClick={handleOpenInCrm}
              disabled={!canOpenInCrm}
              title={
                canOpenInCrm
                  ? `Открыть ${task.route}`
                  : 'Для этого задания нет CRM-маршрута'
              }
            >
              <ExternalLink className="h-4 w-4" />
              Открыть в CRM
            </Button>
          </div>
        </div>
      </div>

      <div className="min-w-0">
        {isUpdatedAfterCompletion && (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900/70 dark:bg-amber-950/30 dark:text-amber-200">
            <div className="flex gap-2">
              <Sparkles className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <div className="font-medium">Урок обновлен после вашего прохождения</div>
                <p className="mt-1 text-amber-800/90 dark:text-amber-200/80">
                  Пройдите этапы еще раз и на последнем этапе нажмите
                  “Отметить обновление”, чтобы убрать пометку.
                  {lessonUpdatedAt ? ` Обновлено: ${lessonUpdatedAt}.` : ''}
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      <InstructionCardReader
        isPending={loadingCompletion}
        onComplete={onComplete}
        role={detail.selectedRole}
        task={task}
      />
    </div>
  );
}

export default function OnboardingPage() {
  const { taskKey } = useParams<{ taskKey?: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const membershipRole = useAuthorizationRole('membership');
  const queryClient = useQueryClient();
  const roleFromQuery = searchParams.get('role') as AccountRole | null;
  const roleFromTaskKey = inferRoleFromTaskKey(taskKey);
  const roleForRequest =
    membershipRole === 'owner'
      ? roleFromQuery || roleFromTaskKey || membershipRole
      : undefined;
  const roleForQueryKey =
    membershipRole === 'owner'
      ? roleFromQuery || roleFromTaskKey || membershipRole
      : membershipRole;

  const overviewQuery = useQuery({
    enabled: Boolean(membershipRole) && !taskKey,
    queryFn: () => getOnboardingOverview(roleForRequest),
    queryKey: queryKeys.onboarding.detail(roleForQueryKey),
  });
  const detailQuery = useQuery({
    enabled: Boolean(membershipRole && taskKey),
    queryFn: () => getOnboardingTaskDetail(taskKey!, roleForRequest),
    queryKey: queryKeys.onboarding.task(taskKey || 'none', roleForQueryKey),
    refetchOnMount: 'always',
    refetchOnReconnect: 'always',
    refetchOnWindowFocus: 'always',
  });

  useEffect(() => {
    if (!membershipRole || !taskKey) return;

    void queryClient.invalidateQueries({
      queryKey: queryKeys.onboarding.task(taskKey, roleForQueryKey),
    });
  }, [membershipRole, queryClient, roleForQueryKey, taskKey]);

  const completeInstructionMutation = useMutation({
    mutationFn: (detail: OnboardingTaskDetail) =>
      completeOnboardingTask(detail.task.key, detail.selectedRole),
    onSuccess: (data, detail) => {
      queryClient.setQueryData(
        queryKeys.onboarding.detail(data.selectedRole),
        data,
      );
      queryClient.invalidateQueries({
        queryKey: queryKeys.onboarding.task(detail.task.key, detail.selectedRole),
      });
      queryClient.invalidateQueries({ queryKey: queryKeys.onboarding.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.onboarding.metrics() });
      clearStoredActiveOnboardingQuest();
      toast.success(
        detail.task.progress.lesson.isUpdatedAfterCompletion
          ? 'Обновление урока отмечено'
          : 'Урок завершен',
      );
    },
  });

  const handleRoleChange = (role: string) => {
    setSearchParams({ role });
  };

  if (taskKey) {
    if (detailQuery.isError) {
      return (
        <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
          <ErrorState
            message={getApiErrorMessage(
              detailQuery.error,
              'Не удалось загрузить задание',
            )}
            onRetry={() => detailQuery.refetch()}
          />
        </div>
      );
    }

    if (detailQuery.isLoading || !detailQuery.data) {
      return (
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
          <div className="h-28 animate-pulse rounded-md border bg-muted/40" />
          <div className="h-72 animate-pulse rounded-md border bg-muted/40" />
          <div className="h-56 animate-pulse rounded-md border bg-muted/40" />
        </div>
      );
    }

    const detail = detailQuery.data;

    return (
      <TaskDetailView
        detail={detail}
        loadingCompletion={completeInstructionMutation.isPending}
        onComplete={() => {
          void completeInstructionMutation.mutateAsync(detail).catch((error) => {
            toast.error(getApiErrorMessage(error, 'Не удалось завершить урок'));
          });
        }}
      />
    );
  }

  if (overviewQuery.isError) {
    return (
      <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <ErrorState
          message={getApiErrorMessage(
            overviewQuery.error,
            'Не удалось загрузить обучение',
          )}
          onRetry={() => overviewQuery.refetch()}
        />
      </div>
    );
  }

  if (overviewQuery.isLoading || !overviewQuery.data) {
    return (
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
        <div className="h-32 animate-pulse rounded-md border bg-muted/40" />
        <div className="h-48 animate-pulse rounded-md border bg-muted/40" />
        <div className="h-48 animate-pulse rounded-md border bg-muted/40" />
      </div>
    );
  }

  return (
    <OnboardingListView
      overview={overviewQuery.data}
      onRoleChange={handleRoleChange}
    />
  );
}
