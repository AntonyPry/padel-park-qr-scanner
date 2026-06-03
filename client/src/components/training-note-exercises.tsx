import { type ReactNode, useMemo, useState } from 'react';
import {
  CheckCircle2,
  Repeat2,
  RotateCcw,
  Search,
  Trash2,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import type { TrainingExercise } from '@/lib/methodology';
import {
  getSkillDirectionLabel,
} from '@/lib/methodology';
import {
  createExerciseFormResult,
  type TrainingNoteExerciseFormResult,
  type TrainingNoteExerciseResult,
} from '@/lib/training-note-exercises';
import { cn } from '@/lib/utils';

const RATINGS = [1, 2, 3, 4, 5];

function getExerciseLabel(exercise?: TrainingExercise | null) {
  if (!exercise) return 'Упражнение';
  return [exercise.name, exercise.eLevel].filter(Boolean).join(' · ');
}

function getResultExerciseLabel(
  result: TrainingNoteExerciseResult,
) {
  return result.exercise?.name || result.exerciseName || 'Упражнение';
}

function FlagButton({
  active,
  children,
  disabled,
  label,
  onClick,
}: {
  active: boolean;
  children: ReactNode;
  disabled?: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          aria-label={label}
          className={cn('h-8 w-8 p-0', active && 'border-primary bg-primary/10')}
          disabled={disabled}
          size="sm"
          type="button"
          variant="outline"
          onClick={onClick}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export function TrainingNoteExerciseEditor({
  disabled,
  exercises,
  onChange,
  value,
}: {
  disabled?: boolean;
  exercises: TrainingExercise[];
  onChange: (nextValue: TrainingNoteExerciseFormResult[]) => void;
  value: TrainingNoteExerciseFormResult[];
}) {
  const [pickerKey, setPickerKey] = useState(0);
  const [q, setQ] = useState('');
  const exerciseById = useMemo(
    () => new Map(exercises.map((exercise) => [Number(exercise.id), exercise])),
    [exercises],
  );
  const selectedIds = useMemo(
    () => new Set(value.map((item) => Number(item.trainingExerciseId))),
    [value],
  );
  const visibleExercises = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return exercises.filter((exercise) => {
      if (selectedIds.has(Number(exercise.id))) return false;
      if (!needle) return true;
      return [
        exercise.name,
        exercise.eLevel || '',
        exercise.mainSkill?.name || '',
        exercise.mainSkill?.direction
          ? getSkillDirectionLabel(exercise.mainSkill.direction)
          : '',
      ]
        .join(' ')
        .toLowerCase()
        .includes(needle);
    });
  }, [exercises, q, selectedIds]);

  const updateResult = (
    index: number,
    patch: Partial<TrainingNoteExerciseFormResult>,
  ) => {
    onChange(
      value.map((result, currentIndex) =>
        currentIndex === index ? { ...result, ...patch } : result,
      ),
    );
  };

  const removeResult = (index: number) => {
    onChange(value.filter((_, currentIndex) => currentIndex !== index));
  };

  const addExercise = (exerciseId: string) => {
    onChange([...value, createExerciseFormResult(exerciseId)]);
    setPickerKey((current) => current + 1);
    setQ('');
  };

  return (
    <TooltipProvider>
      <div className="space-y-3">
        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_220px]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9"
              disabled={disabled}
              placeholder="Найти упражнение"
              value={q}
              onChange={(event) => setQ(event.target.value)}
            />
          </div>
          <Select
            key={pickerKey}
            disabled={disabled || visibleExercises.length === 0}
            onValueChange={addExercise}
          >
            <SelectTrigger>
              <SelectValue placeholder="Добавить упражнение" />
            </SelectTrigger>
            <SelectContent>
              {visibleExercises.map((exercise) => (
                <SelectItem key={exercise.id} value={String(exercise.id)}>
                  {getExerciseLabel(exercise)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {value.length === 0 ? (
          <div className="rounded-md border border-dashed py-6 text-center text-sm text-muted-foreground">
            Выберите упражнения из методической базы.
          </div>
        ) : (
          <div className="space-y-2">
            {value.map((result, index) => {
              const exercise = exerciseById.get(Number(result.trainingExerciseId));

              return (
                <div key={`${result.trainingExerciseId}-${index}`} className="rounded-md border p-3">
                  <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="break-words font-medium">
                          {getExerciseLabel(exercise)}
                        </span>
                        {exercise?.mainSkill && (
                          <Badge variant="outline">
                            {exercise.mainSkill.name}
                          </Badge>
                        )}
                      </div>
                      {exercise?.successCriterion && (
                        <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                          {exercise.successCriterion}
                        </div>
                      )}
                    </div>
                    <Button
                      aria-label="Убрать упражнение"
                      className="h-8 w-8 p-0"
                      disabled={disabled}
                      size="sm"
                      type="button"
                      variant="ghost"
                      onClick={() => removeResult(index)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>

                  <div className="mt-3 flex flex-col gap-3 xl:flex-row xl:items-center">
                    <div className="flex items-center gap-1">
                      {RATINGS.map((rating) => (
                        <Button
                          key={rating}
                          className="h-8 w-8 p-0"
                          disabled={disabled}
                          size="sm"
                          type="button"
                          variant={result.rating === rating ? 'default' : 'outline'}
                          onClick={() => updateResult(index, { rating })}
                        >
                          {rating}
                        </Button>
                      ))}
                    </div>
                    <div className="flex items-center gap-1">
                      <FlagButton
                        active={result.repeatSkill}
                        disabled={disabled}
                        label="Повторить навык"
                        onClick={() =>
                          updateResult(index, {
                            repeatSkill: !result.repeatSkill,
                          })
                        }
                      >
                        <Repeat2 className="h-4 w-4" />
                      </FlagButton>
                      <FlagButton
                        active={result.repeatExercise}
                        disabled={disabled}
                        label="Повторить упражнение"
                        onClick={() =>
                          updateResult(index, {
                            repeatExercise: !result.repeatExercise,
                          })
                        }
                      >
                        <RotateCcw className="h-4 w-4" />
                      </FlagButton>
                      <FlagButton
                        active={result.canAdvance}
                        disabled={disabled}
                        label="Можно усложнять"
                        onClick={() =>
                          updateResult(index, {
                            canAdvance: !result.canAdvance,
                          })
                        }
                      >
                        <CheckCircle2 className="h-4 w-4" />
                      </FlagButton>
                    </div>
                    <Input
                      className="min-w-0 xl:flex-1"
                      disabled={disabled}
                      maxLength={240}
                      placeholder="Короткий комментарий"
                      value={result.comment}
                      onChange={(event) =>
                        updateResult(index, { comment: event.target.value })
                      }
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}

export function TrainingNoteExerciseList({
  results,
}: {
  results: TrainingNoteExerciseResult[];
}) {
  if (results.length === 0) return null;

  return (
    <div className="mt-3 space-y-2">
      {results.map((result, index) => (
        <div key={result.id || `${result.trainingExerciseId}-${index}`} className="rounded-md border bg-muted/20 p-2">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary">{result.rating}/5</Badge>
                <span className="break-words font-medium">
                  {getResultExerciseLabel(result)}
                </span>
                {result.exercise?.eLevel && (
                  <Badge variant="outline">{result.exercise.eLevel}</Badge>
                )}
              </div>
              {result.exercise?.mainSkill && (
                <div className="mt-1 text-xs text-muted-foreground">
                  {result.exercise.mainSkill.name} ·{' '}
                  {getSkillDirectionLabel(result.exercise.mainSkill.direction)}
                </div>
              )}
            </div>
            <div className="flex shrink-0 flex-wrap gap-1">
              {result.repeatSkill && <Badge variant="outline">Навык повторить</Badge>}
              {result.repeatExercise && <Badge variant="outline">Упражнение повторить</Badge>}
              {result.canAdvance && <Badge variant="outline">Можно усложнять</Badge>}
            </div>
          </div>
          {result.comment && (
            <div className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">
              {result.comment}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
