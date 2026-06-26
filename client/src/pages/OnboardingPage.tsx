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
  Maximize2,
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
import { Link, useNavigate, useParams } from 'react-router-dom';
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
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
import { getAccountRoleLabel, type AccountRole } from '@/lib/roles';
import { cn } from '@/lib/utils';
import { useAuth } from '@/lib/useAuth';
import { useTheme } from '@/lib/theme-context';
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

function getTaskLessonPath(task: OnboardingTask) {
  return `/admin/onboarding/${encodeURIComponent(task.key)}`;
}

function findTaskLesson(overview: OnboardingOverview, taskKey: string) {
  const normalizedTaskKey = decodeURIComponent(taskKey);

  for (const mission of overview.path.missions) {
    const task = mission.tasks.find((item) => item.key === normalizedTaskKey);
    if (task) return { mission, task };
  }

  return null;
}

const LESSON_SCREENSHOTS: Record<string, string[]> = {
  'accountant.catalog.update-category': [
    '/onboarding/accountant/catalog/overview.png',
    '/onboarding/accountant/catalog/details.png',
  ],
  'accountant.catalog.update-rule': [
    '/onboarding/accountant/catalog/overview.png',
    '/onboarding/accountant/catalog/details.png',
  ],
  'accountant.finance.export': [
    '/onboarding/accountant/finances/overview.png',
    '/onboarding/accountant/finances/details.png',
  ],
  'accountant.finance.manual-record': [
    '/onboarding/accountant/finances/overview.png',
    '/onboarding/accountant/finances/details.png',
  ],
  'accountant.finance.review': [
    '/onboarding/accountant/finances/overview.png',
    '/onboarding/accountant/finances/details.png',
  ],
  'accountant.payroll.review': [
    '/onboarding/accountant/staff/overview.png',
    '/onboarding/accountant/staff/details.png',
  ],
  'admin.access.create-visit': [
    '/onboarding/admin/access-create-visit/monitor.png',
    '/onboarding/admin/access-create-visit/manual-visit-context.png',
  ],
  'admin.booking.cancel': [
    '/onboarding/admin/booking-cancel/schedule.png',
    '/onboarding/admin/booking-cancel/day-bookings.png',
  ],
  'admin.booking.create-phone': [
    '/onboarding/admin/booking-create-phone/schedule.png',
    '/onboarding/admin/booking-create-phone/booking-form.png',
    '/onboarding/admin/booking-create-phone/result-schedule.png',
  ],
  'admin.booking.mark-paid': [
    '/onboarding/admin/booking-mark-paid/schedule.png',
    '/onboarding/admin/booking-mark-paid/day-bookings.png',
  ],
  'admin.booking.move': [
    '/onboarding/admin/booking-move/schedule-grid.png',
    '/onboarding/admin/booking-move/day-bookings.png',
  ],
  'admin.booking.review-schedule': [
    '/onboarding/admin/booking-review-schedule/schedule.png',
    '/onboarding/admin/booking-review-schedule/day-bookings.png',
  ],
  'admin.call-task.log-attempt': [
    '/onboarding/admin/call-task-log-attempt/tasks-list.png',
    '/onboarding/admin/call-task-log-attempt/task-detail.png',
  ],
  'admin.client.create': [
    '/onboarding/admin/client-create/client-list.png',
    '/onboarding/admin/client-create/client-form.png',
    '/onboarding/admin/client-create/result-list.png',
  ],
  'manager.call-task.create': [
    '/onboarding/manager/call-tasks/overview.png',
    '/onboarding/manager/call-tasks/details.png',
  ],
  'manager.call-task.read-report': [
    '/onboarding/manager/call-tasks/overview.png',
    '/onboarding/manager/call-tasks/details.png',
  ],
  'manager.client-base.create': [
    '/onboarding/manager/client-bases/overview.png',
    '/onboarding/manager/client-bases/details.png',
  ],
  'manager.motivation.update': [
    '/onboarding/manager/motivation/overview.png',
    '/onboarding/manager/motivation/details.png',
  ],
  'manager.references.review': [
    '/onboarding/manager/references/overview.png',
    '/onboarding/manager/references/details.png',
  ],
  'manager.shift.approve': [
    '/onboarding/manager/staff/overview.png',
    '/onboarding/manager/staff/details.png',
  ],
  'manager.utilization.review': [
    '/onboarding/manager/utilization/overview.png',
    '/onboarding/manager/utilization/details.png',
  ],
  'manager.visits-analytics.review': [
    '/onboarding/manager/visits-analytics/overview.png',
    '/onboarding/manager/visits-analytics/details.png',
  ],
  'owner.account.create': [
    '/onboarding/owner/users/overview.png',
    '/onboarding/owner/users/details.png',
  ],
  'owner.audit.review': [
    '/onboarding/owner/audit/overview.png',
    '/onboarding/owner/audit/details.png',
  ],
  'owner.finance.review': [
    '/onboarding/owner/finances/overview.png',
    '/onboarding/owner/finances/details.png',
  ],
  'owner.motivation.review': [
    '/onboarding/owner/motivation/overview.png',
    '/onboarding/owner/motivation/details.png',
  ],
  'owner.onboarding.review-training-data': [
    '/onboarding/owner/onboarding/overview.png',
    '/onboarding/owner/onboarding/details.png',
  ],
  'owner.operations.review-visits': [
    '/onboarding/owner/visits-analytics/overview.png',
    '/onboarding/owner/visits-analytics/details.png',
  ],
  'owner.utilization.review': [
    '/onboarding/owner/utilization/overview.png',
    '/onboarding/owner/utilization/details.png',
  ],
  'trainer.client.open-card': [
    '/onboarding/trainer/trainer/overview.png',
    '/onboarding/trainer/trainer/details.png',
  ],
  'trainer.training-level.update': [
    '/onboarding/trainer/trainer/overview.png',
    '/onboarding/trainer/trainer/details.png',
  ],
  'trainer.training-note.create': [
    '/onboarding/trainer/trainer/overview.png',
    '/onboarding/trainer/trainer/details.png',
  ],
  'trainer.training-note.update': [
    '/onboarding/trainer/trainer/overview.png',
    '/onboarding/trainer/trainer/details.png',
  ],
  'viewer.bookings.review': [
    '/onboarding/viewer/bookings/overview.png',
    '/onboarding/viewer/bookings/details.png',
  ],
  'viewer.finance.review': [
    '/onboarding/viewer/finances/overview.png',
    '/onboarding/viewer/finances/details.png',
  ],
  'viewer.utilization.review': [
    '/onboarding/viewer/utilization/overview.png',
    '/onboarding/viewer/utilization/details.png',
  ],
  'viewer.visits-analytics.review': [
    '/onboarding/viewer/visits-analytics/overview.png',
    '/onboarding/viewer/visits-analytics/details.png',
  ],
};

function getThemedScreenshotSrc(src: string, resolvedTheme: 'light' | 'dark') {
  if (resolvedTheme === 'light') {
    return src.replace(/^\/onboarding\//, '/onboarding-light/');
  }

  return src;
}

function getLessonSteps(task: OnboardingTask, screenshotsCount: number) {
  const steps = [
    {
      title: 'Поймите результат',
      text: `${task.description} После этого этапа должно быть понятно, какой рабочий результат нужно получить в CRM.`,
    },
    {
      title: 'Откройте рабочий раздел',
      text: `Нажмите «Открыть раздел» или перейдите по маршруту ${task.route}. Работайте именно в этом разделе, чтобы прогресс и контекст совпадали с уроком.`,
    },
    {
      title: 'Сверьтесь со скриншотами',
      text:
        screenshotsCount > 0
          ? 'Сначала посмотрите общий вид раздела, затем откройте увеличенный скриншот кликом и найдите нужную область интерфейса.'
          : 'Для этого урока пока нет отдельного скриншота, поэтому ориентируйтесь на описание и рабочий раздел.',
    },
    {
      title: task.kind === 'review' ? 'Проверьте данные' : 'Выполните действие',
      text:
        task.kind === 'review'
          ? 'Для обзорного урока достаточно открыть раздел, просмотреть ключевые данные и убедиться, что вы понимаете, где они находятся.'
          : 'Для практического урока выполните действие в CRM. Если доступен режим тренировки, используйте учебные данные, чтобы не затронуть боевую базу.',
    },
    {
      title: 'Завершите урок',
      text:
        task.kind === 'review'
          ? 'Обзорные уроки могут закрываться автоматически после открытия нужного раздела. Если этого не произошло, завершите урок вручную.'
          : 'Если CRM не зачла действие автоматически, вернитесь в урок и нажмите «Завершить».',
    },
  ];

  return steps;
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
  const navigate = useNavigate();

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
    <section
      className="cursor-pointer rounded-md border bg-background p-5 transition-colors hover:bg-muted/20"
      onClick={() => navigate(getTaskLessonPath(nextTask))}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          navigate(getTaskLessonPath(nextTask));
        }
      }}
      role="link"
      tabIndex={0}
    >
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

        <div
          className="flex shrink-0 flex-wrap gap-2 lg:justify-end"
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
        >
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
    <section className="rounded-2xl border bg-background p-5">
      <div className="flex flex-col gap-4">
        <div className="min-w-0">
          <Badge variant="outline">
            <Sparkles className="h-3 w-3" />
            Навыки пути
          </Badge>
          <h2 className="mt-3 text-lg font-semibold text-foreground">
            {completedSkills}/{overview.summary.skills.length} закрыто
          </h2>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          {overview.summary.skills.map((skill) => (
            <Badge
              key={skill.name}
              variant="outline"
              className={cn(
                'h-auto w-full justify-between gap-2 whitespace-normal rounded-xl px-3 py-2 text-left leading-4',
                skill.percent === 100 &&
                  'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/70 dark:bg-emerald-950/40 dark:text-emerald-300',
              )}
            >
              <span className="min-w-0 flex-1 truncate">{skill.name}</span>
              <span className="shrink-0 text-[10px] text-muted-foreground">
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
  const navigate = useNavigate();
  const status = getTaskStatus(task);
  const StatusIcon = status.icon;
  const completedAt = formatCompletedAt(task.progress.completedAt);

  return (
    <div
      className={cn(
        'cursor-pointer rounded-md border bg-background p-4 transition-colors hover:bg-muted/20',
        task.progress.isNext && !task.progress.isCompleted && 'border-primary/40',
      )}
      onClick={() => navigate(getTaskLessonPath(task))}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          navigate(getTaskLessonPath(task));
        }
      }}
      role="link"
      tabIndex={0}
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
            {completedAt && <span>Завершено: {completedAt}</span>}
          </div>
        </div>

        <div
          className="flex shrink-0 flex-wrap gap-2 lg:justify-end"
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
        >
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

function LessonDetail({
  completingTaskKey,
  mission,
  onComplete,
  task,
}: {
  completingTaskKey: string | null;
  mission: OnboardingMission;
  onComplete: (task: OnboardingTask) => void;
  task: OnboardingTask;
}) {
  const { resolvedTheme } = useTheme();
  const status = getTaskStatus(task);
  const StatusIcon = status.icon;
  const completedAt = formatCompletedAt(task.progress.completedAt);
  const screenshots = LESSON_SCREENSHOTS[task.key] || [];
  const steps = getLessonSteps(task, screenshots.length);
  const [selectedScreenshot, setSelectedScreenshot] = useState<{
    alt: string;
    src: string;
  } | null>(null);

  return (
    <div className="flex w-full flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button asChild variant="outline" size="sm">
          <Link to="/admin/onboarding">Назад к обучению</Link>
        </Button>
        <div className="flex flex-wrap justify-end gap-2">
          <Button asChild variant="outline" size="sm">
            <Link to={task.route}>
              <ArrowUpRight className="h-4 w-4" />
              Открыть раздел
            </Link>
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={task.progress.isCompleted || completingTaskKey === task.key}
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

      <section className="rounded-2xl border bg-background p-5 shadow-sm shadow-foreground/5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className={status.className}>
                <StatusIcon className="h-3 w-3" />
                {status.label}
              </Badge>
              <Badge variant="outline">{formatTaskKind(task.kind)}</Badge>
              <Badge variant="secondary">{mission.title}</Badge>
              {completedAt && (
                <Badge variant="outline">Завершено {completedAt}</Badge>
              )}
            </div>
            <h1 className="mt-4 text-2xl font-semibold tracking-tight text-foreground">
              {task.title}
            </h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
              {task.description}
            </p>
          </div>
          <div className="flex flex-wrap gap-2 lg:justify-end">
            {task.skills.map((skill) => (
              <Badge key={skill} variant="secondary">
                {skill}
              </Badge>
            ))}
            <Badge variant="outline">
              <Timer className="h-3 w-3" />
              {task.estimatedMinutes} мин
            </Badge>
          </div>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
        <div className="rounded-2xl border bg-background p-5">
          <Badge variant="outline">Порядок прохождения</Badge>
          <div className="mt-4 space-y-3">
            {steps.map((step, index) => (
              <div key={step.title} className="rounded-xl border bg-muted/20 p-4">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <span className="flex size-6 items-center justify-center rounded-full bg-primary text-xs text-primary-foreground">
                    {index + 1}
                  </span>
                  {step.title}
                </div>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  {step.text}
                </p>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border bg-background p-5">
          <Badge variant="outline">Скриншоты</Badge>
          {screenshots.length > 0 ? (
            <div className="mt-4 grid gap-3">
              {screenshots.map((src, index) => {
                const alt = `${task.title}: скриншот ${index + 1}`;
                const themedSrc = getThemedScreenshotSrc(src, resolvedTheme);

                return (
                  <figure
                    key={src}
                    className="overflow-hidden rounded-xl border bg-muted/20"
                  >
                    <button
                      type="button"
                      className="group relative block w-full overflow-hidden text-left"
                      onClick={() => setSelectedScreenshot({ alt, src })}
                    >
                      <img
                        alt={alt}
                        className="w-full object-cover transition-transform duration-500 group-hover:scale-[1.01]"
                        src={themedSrc}
                      />
                      <span className="absolute right-3 top-3 flex size-9 items-center justify-center rounded-full border bg-background/85 text-foreground opacity-0 shadow-sm backdrop-blur transition-opacity duration-300 group-hover:opacity-100 group-focus-visible:opacity-100">
                        <Maximize2 className="h-4 w-4" />
                        <span className="sr-only">Увеличить скриншот</span>
                      </span>
                    </button>
                  </figure>
                );
              })}
            </div>
          ) : (
            <div className="mt-4 rounded-xl border border-dashed p-6 text-sm text-muted-foreground">
              Для этого урока пока нет привязанного скриншота.
            </div>
          )}
        </div>
      </section>

      <Dialog
        open={Boolean(selectedScreenshot)}
        onOpenChange={(open) => {
          if (!open) setSelectedScreenshot(null);
        }}
      >
        <DialogContent className="max-w-[min(1280px,calc(100vw-2rem))] gap-3 p-2 sm:max-w-[min(1280px,calc(100vw-2rem))]">
          <DialogTitle className="sr-only">
            {selectedScreenshot?.alt || 'Скриншот урока'}
          </DialogTitle>
          <DialogDescription className="sr-only">
            Увеличенное изображение рабочего экрана CRM из текущего урока.
          </DialogDescription>
          {selectedScreenshot && (
            <div className="max-h-[calc(100dvh-5rem)] overflow-auto rounded-lg">
              <img
                alt={selectedScreenshot.alt}
                className="w-full min-w-[720px] max-w-none rounded-lg object-contain md:min-w-0"
                src={getThemedScreenshotSrc(selectedScreenshot.src, resolvedTheme)}
              />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function OnboardingPage() {
  const { taskKey } = useParams();
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
      <div className="flex w-full flex-col gap-5">
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
      <div className="flex w-full flex-col gap-5">
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
  const lesson = taskKey ? findTaskLesson(overview, taskKey) : null;

  if (taskKey) {
    if (!lesson) {
      return (
        <div className="flex w-full flex-col gap-4">
          <ErrorState
            message="Такого урока нет в текущем пути роли."
            title="Урок не найден"
          />
          <div>
            <Button asChild variant="outline">
              <Link to="/admin/onboarding">Вернуться к обучению</Link>
            </Button>
          </div>
        </div>
      );
    }

    return (
      <LessonDetail
        completingTaskKey={completingTaskKey}
        mission={lesson.mission}
        onComplete={handleComplete}
        task={lesson.task}
      />
    );
  }

  return (
    <div className="flex w-full flex-col gap-5">
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
