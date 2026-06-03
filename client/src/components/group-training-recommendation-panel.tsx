import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CalendarPlus,
  Loader2,
  RefreshCw,
  Sparkles,
  Target,
  UsersRound,
  X,
} from 'lucide-react';
import {
  getGroupTrainingRecommendation,
  type GroupTrainingRecommendation,
  type GroupTrainingRecommendationBlock,
  type GroupTrainingRecommendationParticipantStat,
} from '@/api/training-recommendations';
import type { TrainingPlanExercisePayload } from '@/api/training-plans';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from '@/components/ui/toast';
import { getApiErrorMessage } from '@/lib/api';
import {
  getExerciseFormatLabel,
  getSkillDirectionLabel,
} from '@/lib/methodology';

export interface GroupTrainingClientOption {
  id: number;
  latestLevel?: string | null;
  name: string;
  notesCount?: number;
}

interface GroupTrainingRecommendationPanelProps {
  clients: GroupTrainingClientOption[];
  disabled?: boolean;
  onCreatePlan?: (
    recommendation: GroupTrainingRecommendation,
    plannedExercises: TrainingPlanExercisePayload[],
  ) => Promise<void> | void;
  onClear?: () => void;
  onRemoveClient?: (clientId: number) => void;
}

interface GroupPlanMeta {
  duplicateBlockCount: number;
  duplicateBlockKeys: Set<string>;
  insertableBlockCount: number;
  plannedExercises: TrainingPlanExercisePayload[];
}

function formatDate(value?: string | null) {
  if (!value) return '-';
  return new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short' }).format(
    new Date(value),
  );
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

function getRoleLabel(role: string) {
  if (role === 'weak') return 'упрощение';
  if (role === 'advanced') return 'усложнение';
  return 'общая версия';
}

function formatParticipants(participants: GroupTrainingRecommendationParticipantStat[]) {
  if (participants.length === 0) return 'нет';
  return participants.map((participant) => participant.clientName).join(', ');
}

function getGroupPlanMeta(
  blocks: GroupTrainingRecommendationBlock[],
): GroupPlanMeta {
  const duplicateBlockKeys = new Set<string>();
  const seenExerciseIds = new Set<number>();
  const plannedExercises: TrainingPlanExercisePayload[] = [];
  let duplicateBlockCount = 0;
  let insertableBlockCount = 0;

  blocks.forEach((block) => {
    const exerciseId = block.exercise?.id;
    const isInsertable = block.insertable !== false && Boolean(exerciseId);
    if (!isInsertable || !exerciseId) {
      return;
    }

    insertableBlockCount += 1;
    if (seenExerciseIds.has(exerciseId)) {
      duplicateBlockKeys.add(block.key);
      duplicateBlockCount += 1;
      return;
    }

    seenExerciseIds.add(exerciseId);
    plannedExercises.push({
      blockKey: block.key,
      blockTitle: block.title,
      reasonSnapshot: block.reason,
      trainingExerciseId: exerciseId,
    });
  });

  return {
    duplicateBlockCount,
    duplicateBlockKeys,
    insertableBlockCount,
    plannedExercises,
  };
}

function StatBadges({ block }: { block: GroupTrainingRecommendationBlock }) {
  const stats = block.skillStats;
  if (!stats) return null;

  return (
    <div className="flex flex-wrap gap-1.5">
      <Badge variant="outline">min {stats.minLevel}</Badge>
      <Badge variant="outline">avg {stats.averageLevel}</Badge>
      <Badge variant="outline">max {stats.maxLevel}</Badge>
      <Badge variant={stats.levelSpread > 2 ? 'secondary' : 'outline'}>
        разброс {stats.levelSpread}
      </Badge>
      {stats.staleMajority && (
        <Badge variant="secondary">давно у большинства</Badge>
      )}
    </div>
  );
}

export function GroupTrainingRecommendationPanel({
  clients,
  disabled,
  onCreatePlan,
  onClear,
  onRemoveClient,
}: GroupTrainingRecommendationPanelProps) {
  const [goal, setGoal] = useState('');
  const [recommendation, setRecommendation] =
    useState<GroupTrainingRecommendation | null>(null);
  const [creatingPlan, setCreatingPlan] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const selectedIds = useMemo(
    () => clients.map((client) => client.id).sort((left, right) => left - right),
    [clients],
  );
  const selectedKey = selectedIds.join(',');
  const canRecommend = selectedIds.length >= 2;

  useEffect(() => {
    setRecommendation(null);
    setError(null);
  }, [selectedKey]);

  const requestRecommendation = async () => {
    if (!canRecommend) return;

    setLoading(true);
    setError(null);
    try {
      const nextRecommendation = await getGroupTrainingRecommendation({
        clientIds: selectedIds,
        goal,
      });
      setRecommendation(nextRecommendation);
    } catch (requestError) {
      const message = getApiErrorMessage(
        requestError,
        'Не удалось рекомендовать групповую тренировку',
      );
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };
  const planMeta = useMemo(
    () => getGroupPlanMeta(recommendation?.blocks || []),
    [recommendation?.blocks],
  );

  const createPlan = async () => {
    if (!recommendation || !onCreatePlan || planMeta.plannedExercises.length === 0) {
      return;
    }

    setCreatingPlan(true);
    try {
      await onCreatePlan(recommendation, planMeta.plannedExercises);
      const duplicateSuffix =
        planMeta.duplicateBlockCount > 0
          ? `; ${getBlockCountLabel(planMeta.duplicateBlockCount)} с повтором оставлено вручную`
          : '';
      toast.success(
        `План создан: ${getExerciseCountLabel(planMeta.plannedExercises.length)}${duplicateSuffix}`,
      );
    } finally {
      setCreatingPlan(false);
    }
  };

  return (
    <div className="rounded-md border bg-card">
      <div className="flex flex-col gap-3 border-b px-4 py-3 xl:flex-row xl:items-end">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 font-medium">
            <UsersRound className="h-4 w-4 text-muted-foreground" />
            Групповая тренировка
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {clients.length === 0 ? (
              <Badge variant="outline">участники не выбраны</Badge>
            ) : (
              clients.map((client) => (
                <Badge
                  key={client.id}
                  variant="outline"
                  className="h-auto min-h-6 whitespace-normal break-words text-left"
                >
                  <span>{client.name}</span>
                  {client.latestLevel && <span> · {client.latestLevel}</span>}
                  {onRemoveClient && (
                    <button
                      type="button"
                      className="ml-1 rounded-sm text-muted-foreground hover:text-foreground"
                      aria-label={`Убрать ${client.name} из группы`}
                      onClick={() => onRemoveClient(client.id)}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </Badge>
              ))
            )}
          </div>
          <div className="mt-2 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
            <Input
              disabled={disabled || loading || !canRecommend}
              maxLength={160}
              placeholder="Тема тренировки"
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
              disabled={disabled || loading || !canRecommend}
              onClick={() => void requestRecommendation()}
            >
              {loading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : recommendation ? (
                <RefreshCw className="mr-2 h-4 w-4" />
              ) : (
                <Target className="mr-2 h-4 w-4" />
              )}
              {recommendation ? 'Обновить' : 'Рекомендовать'}
            </Button>
          </div>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row xl:flex-col">
          {onCreatePlan && recommendation && (
            <Button
              type="button"
              variant="outline"
              disabled={disabled || creatingPlan || planMeta.plannedExercises.length === 0}
              onClick={() => void createPlan()}
            >
              {creatingPlan ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <CalendarPlus className="mr-2 h-4 w-4" />
              )}
              {planMeta.plannedExercises.length === 0
                ? 'Нет упражнений для плана'
                : `Создать план: ${getExerciseCountLabel(planMeta.plannedExercises.length)}`}
            </Button>
          )}
          {onClear && clients.length > 0 && (
            <Button type="button" variant="outline" onClick={onClear}>
              Очистить группу
            </Button>
          )}
        </div>
      </div>

      {error && (
        <div className="border-b border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {!recommendation ? (
        <div className="px-4 py-5 text-sm text-muted-foreground">
          {canRecommend
            ? 'План появится здесь после расчета.'
            : 'Выберите минимум двух активных клиентов в таблице.'}
        </div>
      ) : (
        <div className="space-y-4 p-4">
          <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap gap-1.5">
              <Badge variant="outline">
                Участники: {recommendation.summary.participantCount}
              </Badge>
              <Badge variant="outline">
                Большинство: {recommendation.summary.majorityCount}
              </Badge>
              <Badge variant="outline">
                Approved: {recommendation.summary.approvedExercisesCount}
              </Badge>
              <Badge variant="outline">
                К плану: {getExerciseCountLabel(planMeta.plannedExercises.length)}
              </Badge>
              {recommendation.summary.fallbackBlocks > 0 && (
                <Badge variant="secondary">
                  fallback: {recommendation.summary.fallbackBlocks}
                </Badge>
              )}
              {planMeta.duplicateBlockCount > 0 && (
                <Badge variant="secondary">
                  повтор вручную: {planMeta.duplicateBlockCount}
                </Badge>
              )}
              {recommendation.summary.warningSkillsCount > 0 && (
                <Badge variant="secondary">
                  предупреждения: {recommendation.summary.warningSkillsCount}
                </Badge>
              )}
            </div>
            <div className="text-xs text-muted-foreground">
              Дата расчета: {formatDate(recommendation.asOfDate)}
            </div>
          </div>

          {recommendation.warnings.length > 0 && (
            <div className="space-y-2">
              {recommendation.warnings.map((warning) => (
                <div
                  key={warning.skillId}
                  className="flex gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900"
                >
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>
                    {warning.skill?.name || `Навык ${warning.skillId}`}: {warning.text}
                  </span>
                </div>
              ))}
            </div>
          )}

          {recommendation.prioritySkills.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {recommendation.prioritySkills.slice(0, 4).map((skill) => (
                <Badge
                  key={skill.skillId}
                  variant={skill.warning ? 'secondary' : 'outline'}
                  className="h-auto min-h-6 whitespace-normal break-words text-left"
                >
                  {skill.skill?.name || `Навык ${skill.skillId}`} · avg{' '}
                  {skill.averageLevel} · {skill.targetELevel || '-'}
                </Badge>
              ))}
            </div>
          )}

          <div className="divide-y rounded-md border">
            {recommendation.blocks.map((block) => {
              const isDuplicateBlock = planMeta.duplicateBlockKeys.has(block.key);
              const isInsertableBlock =
                block.insertable !== false &&
                Boolean(block.exercise?.id) &&
                !isDuplicateBlock;

              return (
                <article key={block.key} className="p-3">
                  <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline">{block.title}</Badge>
                        {block.exercise?.eLevel && <Badge>{block.exercise.eLevel}</Badge>}
                        {block.skill && (
                          <Badge variant="secondary">{block.skill.name}</Badge>
                        )}
                        {isInsertableBlock ? (
                          <Badge variant="outline">в план</Badge>
                        ) : (
                          <Badge variant="secondary">ручной блок</Badge>
                        )}
                        {isDuplicateBlock && (
                          <Badge variant="secondary">повтор вручную</Badge>
                        )}
                      </div>
                      <div className="mt-2 break-words font-medium">
                        {block.exercise?.name || 'Ручной подбор упражнения'}
                      </div>
                      {isDuplicateBlock && (
                        <div className="mt-1 text-xs text-muted-foreground">
                          Это упражнение уже есть выше в групповом плане, поэтому
                          блок остается ручным и не создаст отдельную строку плана.
                        </div>
                      )}
                      {block.skill?.direction && (
                        <div className="mt-1 text-xs text-muted-foreground">
                          {getSkillDirectionLabel(block.skill.direction)}
                        </div>
                      )}
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-1">
                      {block.exercise?.formats?.map((format) => (
                        <Badge key={format} variant="outline">
                          {getExerciseFormatLabel(format)}
                        </Badge>
                      ))}
                    </div>
                  </div>

                {block.warning && (
                  <div className="mt-3 flex gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>{block.warning}</span>
                  </div>
                )}

                <div className="mt-3">
                  <StatBadges block={block} />
                </div>

                <div className="mt-3 grid gap-3 text-sm xl:grid-cols-3">
                  <div>
                    <div className="font-medium">Общая версия</div>
                    <div className="mt-1 text-muted-foreground">
                      {block.commonVersion}
                    </div>
                  </div>
                  <div>
                    <div className="font-medium">Упрощение для слабых</div>
                    <div className="mt-1 text-muted-foreground">
                      {block.exercise?.simplification || 'Подберите вручную.'}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {formatParticipants(block.weakParticipants)}
                    </div>
                  </div>
                  <div>
                    <div className="font-medium">Усложнение для сильных</div>
                    <div className="mt-1 text-muted-foreground">
                      {block.exercise?.complication || 'Подберите вручную.'}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {formatParticipants(block.advancedParticipants)}
                    </div>
                  </div>
                </div>

                {block.exercise?.successCriterion && (
                  <div className="mt-3 text-sm text-muted-foreground">
                    <span className="font-medium text-foreground">
                      Критерий:{' '}
                    </span>
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
                    <span className="font-medium">Уровень: </span>
                    <span className="text-muted-foreground">
                      {block.reason.level}
                    </span>
                  </div>
                  <div>
                    <span className="font-medium">Повторы: </span>
                    <span className="text-muted-foreground">
                      {block.reason.antiRepeat}
                    </span>
                  </div>
                </div>

                {block.focusNotes.length > 0 && (
                  <div className="mt-3">
                    <div className="mb-2 flex items-center gap-1.5 text-sm font-medium">
                      <Sparkles className="h-4 w-4 text-muted-foreground" />
                      Фокус по ученикам
                    </div>
                    <div className="grid gap-2 md:grid-cols-2">
                      {block.focusNotes.map((note) => (
                        <div
                          key={note.clientId}
                          className="rounded-md border px-3 py-2 text-sm"
                        >
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="font-medium">{note.clientName}</span>
                            <Badge variant="outline">ур. {note.level}</Badge>
                            <Badge variant="secondary">{getRoleLabel(note.role)}</Badge>
                          </div>
                          <div className="mt-1 text-muted-foreground">
                            {note.focus}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                </article>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
