import { useEffect, useMemo, useState } from 'react';
import {
  CalendarPlus,
  ClipboardCheck,
  Loader2,
  Sparkles,
  Target,
} from 'lucide-react';
import {
  getTrainingRecommendation,
  type TrainingRecommendation,
  type TrainingRecommendationBlock,
} from '@/api/training-recommendations';
import type { TrainingPlanExercisePayload } from '@/api/training-plans';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from '@/components/ui/toast';
import {
  getExerciseFormatLabel,
  getSkillDirectionLabel,
} from '@/lib/methodology';
import { getApiErrorMessage } from '@/lib/api';

interface TrainingRecommendationPanelProps {
  clientId?: number | null;
  disabled?: boolean;
  onCreatePlan?: (
    recommendation: TrainingRecommendation,
    plannedExercises: TrainingPlanExercisePayload[],
  ) => Promise<void> | void;
  onApplyExercises?: (exerciseIds: number[]) => void;
}

interface InsertPlanMeta {
  duplicateBlockKeys: Set<string>;
  duplicateBlockCount: number;
  exerciseIds: number[];
  insertableBlockCount: number;
  plannedExercises: TrainingPlanExercisePayload[];
}

function getCountLabel(count: number, one: string, few: string, many: string) {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return `${count} ${one}`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
    return `${count} ${few}`;
  }
  return `${count} ${many}`;
}

function getExerciseCountLabel(count: number) {
  return getCountLabel(count, 'упражнение', 'упражнения', 'упражнений');
}

function getBlockCountLabel(count: number) {
  return getCountLabel(count, 'блок', 'блока', 'блоков');
}

function getInsertPlanMeta(blocks: TrainingRecommendationBlock[]): InsertPlanMeta {
  const duplicateBlockKeys = new Set<string>();
  const seenExerciseIds = new Set<number>();
  const exerciseIds: number[] = [];
  const plannedExercises: TrainingPlanExercisePayload[] = [];
  let duplicateBlockCount = 0;
  let insertableBlockCount = 0;

  blocks.forEach((block) => {
    const exerciseId = block.exercise?.id;
    const isInsertable = block.insertable !== false && Boolean(exerciseId);
    if (!isInsertable || !exerciseId) return;

    insertableBlockCount += 1;
    if (seenExerciseIds.has(exerciseId)) {
      duplicateBlockKeys.add(block.key);
      duplicateBlockCount += 1;
      return;
    }

    seenExerciseIds.add(exerciseId);
    exerciseIds.push(exerciseId);
    plannedExercises.push({
      blockKey: block.key,
      blockTitle: block.title,
      reasonSnapshot: block.reason,
      trainingExerciseId: exerciseId,
    });
  });

  return {
    duplicateBlockKeys,
    duplicateBlockCount,
    exerciseIds,
    insertableBlockCount,
    plannedExercises,
  };
}

function formatDate(value?: string | null) {
  if (!value) return '-';
  return new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short' }).format(
    new Date(value),
  );
}

function SummaryBadges({
  insertPlanMeta,
  recommendation,
}: {
  insertPlanMeta: InsertPlanMeta;
  recommendation: TrainingRecommendation;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      <Badge variant="outline">{recommendation.blocks.length} блоков</Badge>
      <Badge variant="outline">
        К вставке: {getExerciseCountLabel(insertPlanMeta.exerciseIds.length)}
      </Badge>
      <Badge variant="outline">
        История: {recommendation.summary.historyDepth}
      </Badge>
      <Badge variant="outline">
        Approved: {recommendation.summary.approvedExercisesCount}
      </Badge>
      {recommendation.summary.littleHistory && (
        <Badge variant="secondary">мало истории</Badge>
      )}
      {recommendation.summary.fallbackBlocks > 0 && (
        <Badge variant="secondary">
          fallback: {recommendation.summary.fallbackBlocks}
        </Badge>
      )}
      {insertPlanMeta.duplicateBlockCount > 0 && (
        <Badge variant="secondary">
          повтор вручную: {insertPlanMeta.duplicateBlockCount}
        </Badge>
      )}
    </div>
  );
}

export function TrainingRecommendationPanel({
  clientId,
  disabled,
  onCreatePlan,
  onApplyExercises,
}: TrainingRecommendationPanelProps) {
  const [goal, setGoal] = useState('');
  const [recommendation, setRecommendation] =
    useState<TrainingRecommendation | null>(null);
  const [creatingPlan, setCreatingPlan] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setGoal('');
    setRecommendation(null);
    setError(null);
  }, [clientId]);

  const insertPlanMeta = useMemo(
    () => getInsertPlanMeta(recommendation?.blocks || []),
    [recommendation?.blocks],
  );

  const requestRecommendation = async () => {
    if (!clientId) return;

    setLoading(true);
    setError(null);
    try {
      const nextRecommendation = await getTrainingRecommendation(clientId, {
        goal,
      });
      setRecommendation(nextRecommendation);
    } catch (requestError) {
      const message = getApiErrorMessage(
        requestError,
        'Не удалось рекомендовать тренировку',
      );
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  const applyExercises = () => {
    if (insertPlanMeta.exerciseIds.length === 0 || !onApplyExercises) return;
    onApplyExercises(insertPlanMeta.exerciseIds);
    const duplicateSuffix =
      insertPlanMeta.duplicateBlockCount > 0
        ? `; ${getBlockCountLabel(insertPlanMeta.duplicateBlockCount)} с повтором оставлено вручную`
        : '';
    toast.success(
      `В форму добавлено ${getExerciseCountLabel(insertPlanMeta.exerciseIds.length)}${duplicateSuffix}`,
    );
  };

  const createPlan = async () => {
    if (
      !recommendation ||
      !onCreatePlan ||
      insertPlanMeta.plannedExercises.length === 0
    ) {
      return;
    }

    setCreatingPlan(true);
    try {
      await onCreatePlan(recommendation, insertPlanMeta.plannedExercises);
    } finally {
      setCreatingPlan(false);
    }
  };

  return (
    <div className="rounded-md border">
      <div className="flex flex-col gap-3 border-b px-4 py-3 xl:flex-row xl:items-end">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 font-medium">
            <Sparkles className="h-4 w-4 text-muted-foreground" />
            Рекомендовать тренировку
          </div>
          <div className="mt-2 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
            <Input
              disabled={disabled || loading || !clientId}
              maxLength={160}
              placeholder="Цель тренировки"
              value={goal}
              onChange={(event) => setGoal(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  void requestRecommendation();
                }
              }}
            />
            <Button
              type="button"
              disabled={disabled || loading || !clientId}
              onClick={() => void requestRecommendation()}
            >
              {loading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : recommendation ? (
                <Sparkles className="mr-2 h-4 w-4" />
              ) : (
                <Target className="mr-2 h-4 w-4" />
              )}
              {recommendation ? 'Пересчитать' : 'Рекомендовать'}
            </Button>
          </div>
        </div>
        {recommendation && (
          <div className="flex flex-col gap-2 sm:flex-row xl:flex-col">
            {onCreatePlan && (
              <Button
                type="button"
                variant="outline"
                disabled={
                  disabled ||
                  creatingPlan ||
                  insertPlanMeta.plannedExercises.length === 0
                }
                onClick={() => void createPlan()}
              >
                {creatingPlan ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <CalendarPlus className="mr-2 h-4 w-4" />
                )}
                Создать план
              </Button>
            )}
            {onApplyExercises && (
              <Button
                type="button"
                variant="outline"
                disabled={insertPlanMeta.exerciseIds.length === 0}
                onClick={applyExercises}
              >
                <ClipboardCheck className="mr-2 h-4 w-4" />
                {insertPlanMeta.exerciseIds.length === 0
                  ? 'Нет упражнений для вставки'
                  : `Вставить ${getExerciseCountLabel(insertPlanMeta.exerciseIds.length)}`}
              </Button>
            )}
          </div>
        )}
      </div>

      {error && (
        <div className="border-b border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {!recommendation ? (
        <div className="px-4 py-6 text-sm text-muted-foreground">
          План появится здесь после расчета.
        </div>
      ) : (
        <div className="space-y-4 p-4">
          <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
            <SummaryBadges
              insertPlanMeta={insertPlanMeta}
              recommendation={recommendation}
            />
            <div className="text-xs text-muted-foreground">
              Дата расчета: {formatDate(recommendation.asOfDate)}
            </div>
          </div>

          {recommendation.prioritySkills.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {recommendation.prioritySkills.slice(0, 3).map((priority) => (
                <Badge
                  key={priority.skillId}
                  variant={priority.loweredReason ? 'secondary' : 'outline'}
                  className="h-auto min-h-6 whitespace-normal break-words text-left"
                >
                  {priority.skill?.name || `Навык ${priority.skillId}`} ·{' '}
                  {priority.targetELevel || '-'}
                </Badge>
              ))}
            </div>
          )}

          <div className="space-y-3">
            {recommendation.blocks.map((block) => {
              const isDuplicateBlock =
                insertPlanMeta.duplicateBlockKeys.has(block.key);
              const isInsertableBlock =
                block.insertable !== false &&
                Boolean(block.exercise?.id) &&
                !isDuplicateBlock;

              return (
                <article key={block.key} className="rounded-md border p-3">
                  <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline">{block.title}</Badge>
                        {block.exercise?.eLevel && (
                          <Badge>{block.exercise.eLevel}</Badge>
                        )}
                        {block.skill && (
                          <Badge variant="secondary">
                            {block.skill.name}
                          </Badge>
                        )}
                        {isInsertableBlock ? (
                          <Badge variant="outline">вставляется</Badge>
                        ) : (
                          <Badge variant="secondary">не вставляется</Badge>
                        )}
                        {isDuplicateBlock && (
                          <Badge variant="secondary">повтор вручную</Badge>
                        )}
                      </div>
                      <div className="mt-2 break-words font-medium">
                        {block.exercise?.name || 'Ручной блок'}
                      </div>
                      {isDuplicateBlock && (
                        <div className="mt-1 text-xs text-muted-foreground">
                          Это упражнение уже есть выше в плане, поэтому блок
                          остается ручным и не вставляется автоматически.
                        </div>
                      )}
                      {block.skill?.direction && (
                        <div className="mt-1 text-xs text-muted-foreground">
                          {getSkillDirectionLabel(block.skill.direction)}
                        </div>
                      )}
                    </div>
                    {block.exercise?.formats?.length ? (
                      <div className="flex shrink-0 flex-wrap gap-1">
                        {block.exercise.formats.map((format) => (
                          <Badge key={format} variant="outline">
                            {getExerciseFormatLabel(format)}
                          </Badge>
                        ))}
                      </div>
                    ) : null}
                  </div>

                  {block.exercise?.successCriterion && (
                    <div className="mt-2 text-sm text-muted-foreground">
                      {block.exercise.successCriterion}
                    </div>
                  )}

                  <div className="mt-3 grid gap-2 text-sm">
                    <div>
                      <span className="font-medium">Навык: </span>
                      <span className="text-muted-foreground">
                        {block.reason.skill}
                      </span>
                    </div>
                    <div>
                      <span className="font-medium">E-level: </span>
                      <span className="text-muted-foreground">
                        {block.reason.eLevel}
                      </span>
                    </div>
                    <div>
                      <span className="font-medium">Повторы: </span>
                      <span className="text-muted-foreground">
                        {isDuplicateBlock
                          ? 'Повтор упражнения уже есть в плане; строка не вставляется автоматически.'
                          : block.reason.antiRepeat}
                      </span>
                    </div>
                    <div>
                      <span className="font-medium">Вариации: </span>
                      <span className="text-muted-foreground">
                        {block.reason.adjustment}
                      </span>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
