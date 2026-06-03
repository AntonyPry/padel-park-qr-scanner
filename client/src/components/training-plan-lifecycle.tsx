import {
  CalendarDays,
  CheckCircle2,
  ClipboardCheck,
  Replace,
  UsersRound,
} from 'lucide-react';
import type {
  TrainingPlan,
  TrainingPlanExercisePayload,
} from '@/api/training-plans';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { TrainingExercise } from '@/lib/methodology';
import { getSkillDirectionLabel } from '@/lib/methodology';

function formatDate(value?: string | null) {
  if (!value) return '-';
  return new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short' }).format(
    new Date(value),
  );
}

function getKindLabel(kind: string) {
  return kind === 'group' ? 'group' : 'personal';
}

function getSourceLabel(sourceType: string) {
  if (sourceType === 'personal_recommendation') return 'из персональной рекомендации';
  if (sourceType === 'group_recommendation') return 'из групповой рекомендации';
  return 'ручной план';
}

function participantNames(plan: TrainingPlan) {
  return plan.participants
    .map((participant) => participant.client?.name)
    .filter(Boolean)
    .join(', ');
}

function planExercisesPayload(plan: TrainingPlan): TrainingPlanExercisePayload[] {
  return plan.plannedExercises.map((item) => ({
    blockKey: item.blockKey || null,
    blockTitle: item.blockTitle || null,
    reasonSnapshot: item.reasonSnapshot || null,
    trainingExerciseId: Number(item.trainingExerciseId),
  }));
}

export function TrainingPlanLifecyclePanel({
  disabled,
  exercises,
  onReplaceExercise,
  onStartCompletion,
  plans,
}: {
  disabled?: boolean;
  exercises: TrainingExercise[];
  onReplaceExercise: (
    plan: TrainingPlan,
    plannedExercises: TrainingPlanExercisePayload[],
  ) => void | Promise<void>;
  onStartCompletion: (plan: TrainingPlan) => void;
  plans: TrainingPlan[];
}) {
  const plannedPlans = plans.filter((plan) => plan.status === 'planned');
  const completedPlans = plans.filter((plan) => plan.status === 'completed');

  const replaceExercise = (
    plan: TrainingPlan,
    index: number,
    nextExerciseId: string,
  ) => {
    const nextPayload = planExercisesPayload(plan).map((item, currentIndex) =>
      currentIndex === index
        ? { ...item, trainingExerciseId: Number(nextExerciseId) }
        : item,
    );
    void onReplaceExercise(plan, nextPayload);
  };

  return (
    <div className="space-y-4">
      <section>
        <div className="mb-2 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 font-medium">
            <ClipboardCheck className="h-4 w-4 text-muted-foreground" />
            Planned
          </div>
          <Badge variant="outline">{plannedPlans.length}</Badge>
        </div>

        {plannedPlans.length === 0 ? (
          <div className="rounded-md border border-dashed py-6 text-center text-sm text-muted-foreground">
            Планов перед занятием пока нет.
          </div>
        ) : (
          <div className="space-y-3">
            {plannedPlans.map((plan) => (
              <article key={plan.id} className="rounded-md border p-3">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge>{getKindLabel(plan.kind)}</Badge>
                      <Badge variant="outline">{getSourceLabel(plan.sourceType)}</Badge>
                      <span className="flex items-center gap-1 text-sm text-muted-foreground">
                        <CalendarDays className="h-3.5 w-3.5" />
                        {formatDate(plan.plannedAt)}
                      </span>
                    </div>
                    {plan.goal && (
                      <div className="mt-2 break-words text-sm font-medium">
                        {plan.goal}
                      </div>
                    )}
                    <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                      <UsersRound className="h-3.5 w-3.5" />
                      <span className="break-words">
                        {participantNames(plan) || 'Участники не указаны'}
                      </span>
                    </div>
                  </div>
                  <Button
                    type="button"
                    disabled={disabled || plan.plannedExercises.length === 0}
                    onClick={() => onStartCompletion(plan)}
                  >
                    <CheckCircle2 className="mr-2 h-4 w-4" />
                    Подтвердить факт
                  </Button>
                </div>

                <div className="mt-3 space-y-2">
                  {plan.plannedExercises.map((item, index) => (
                    <div
                      key={`${item.id}-${item.trainingExerciseId}-${index}`}
                      className="grid gap-2 rounded-md border bg-muted/20 p-2 lg:grid-cols-[minmax(0,1fr)_260px]"
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          {item.blockTitle && (
                            <Badge variant="outline">{item.blockTitle}</Badge>
                          )}
                          {item.exercise?.eLevel && <Badge>{item.exercise.eLevel}</Badge>}
                          <span className="break-words font-medium">
                            {item.exercise?.name || item.exerciseName}
                          </span>
                        </div>
                        {item.exercise?.mainSkill && (
                          <div className="mt-1 text-xs text-muted-foreground">
                            {item.exercise.mainSkill.name} ·{' '}
                            {getSkillDirectionLabel(item.exercise.mainSkill.direction)}
                          </div>
                        )}
                      </div>
                      <Select
                        disabled={disabled || exercises.length === 0}
                        onValueChange={(value) => replaceExercise(plan, index, value)}
                      >
                        <SelectTrigger>
                          <Replace className="mr-2 h-4 w-4 text-muted-foreground" />
                          <SelectValue placeholder="Заменить из базы" />
                        </SelectTrigger>
                        <SelectContent>
                          {exercises.map((exercise) => (
                            <SelectItem
                              key={exercise.id}
                              value={String(exercise.id)}
                              disabled={Number(exercise.id) === Number(item.trainingExerciseId)}
                            >
                              {[exercise.name, exercise.eLevel].filter(Boolean).join(' · ')}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  ))}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section>
        <div className="mb-2 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 font-medium">
            <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
            Completed
          </div>
          <Badge variant="outline">{completedPlans.length}</Badge>
        </div>
        {completedPlans.length === 0 ? (
          <div className="rounded-md border border-dashed py-5 text-center text-sm text-muted-foreground">
            Подтвержденные планы появятся здесь, а подробности останутся в
            дневнике ниже.
          </div>
        ) : (
          <div className="space-y-2">
            {completedPlans.slice(0, 5).map((plan) => (
              <div key={plan.id} className="rounded-md border px-3 py-2 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="secondary">{getKindLabel(plan.kind)}</Badge>
                  <span className="font-medium">{formatDate(plan.plannedAt)}</span>
                  <span className="text-muted-foreground">
                    {plan.plannedExercises.length} упр.
                  </span>
                </div>
                <div className="mt-1 break-words text-xs text-muted-foreground">
                  {participantNames(plan)}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
