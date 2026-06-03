import { useState } from 'react';
import {
  CalendarDays,
  ClipboardCheck,
  Pencil,
  Repeat2,
  RotateCcw,
  Save,
  Target,
  X,
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
  type TrainingExerciseELevel,
  TRAINING_EXERCISE_E_LEVELS,
  type TrainingSkillSummary,
  getSkillDirectionLabel,
} from '@/lib/methodology';

export interface ClientSkillMapItem {
  id: number;
  skill: TrainingSkillSummary | null;
  skillId: number;
  level: number;
  lastTrainedAt?: string | null;
  latestExercises: string;
  latestAssessment: string;
  repeatFlag: boolean;
  nextEStep?: TrainingExerciseELevel | null;
  history?: Array<{
    changeType: string;
    createdAt?: string | null;
    eLevel?: TrainingExerciseELevel | null;
    exerciseNameSnapshot: string;
    explanation: string;
    id: number;
    nextEStep?: TrainingExerciseELevel | null;
    nextLevel: number;
    occurredAt?: string | null;
    previousLevel: number;
    rating?: number | null;
    repeatFlag: boolean;
    source: string;
    trainingNoteExerciseId?: number | null;
    trainingNoteId?: number | null;
  }>;
  updatedAt?: string | null;
}

export interface ClientSkillMapPayload {
  lastTrainedAt?: string | null;
  latestAssessment?: string | null;
  latestExercises?: string | null;
  level?: number;
  nextEStep?: TrainingExerciseELevel | null;
  repeatFlag?: boolean;
}

interface SkillMapDraft {
  lastTrainedAt: string;
  latestAssessment: string;
  latestExercises: string;
  level: string;
  nextEStep: TrainingExerciseELevel | 'none';
  repeatFlag: boolean;
}

interface ClientSkillMapProps {
  canEdit?: boolean;
  disabledReason?: string;
  items: ClientSkillMapItem[];
  onSave?: (skillId: number, payload: ClientSkillMapPayload) => Promise<void>;
  title?: string;
}

const SKILL_LEVELS = [0, 1, 2, 3, 4, 5];

function formatDate(value?: string | null) {
  if (!value) return '-';
  return new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short' }).format(
    new Date(value),
  );
}

function getDraft(item: ClientSkillMapItem): SkillMapDraft {
  return {
    lastTrainedAt: item.lastTrainedAt || '',
    latestAssessment: item.latestAssessment || '',
    latestExercises: item.latestExercises || '',
    level: String(item.level ?? 0),
    nextEStep: item.nextEStep || 'none',
    repeatFlag: item.repeatFlag,
  };
}

function getPayload(draft: SkillMapDraft): ClientSkillMapPayload {
  return {
    lastTrainedAt: draft.lastTrainedAt || null,
    latestAssessment: draft.latestAssessment,
    latestExercises: draft.latestExercises,
    level: Number(draft.level),
    nextEStep: draft.nextEStep === 'none' ? null : draft.nextEStep,
    repeatFlag: draft.repeatFlag,
  };
}

export function ClientSkillMap({
  canEdit = false,
  disabledReason,
  items,
  onSave,
  title = 'Карта навыков',
}: ClientSkillMapProps) {
  const [draft, setDraft] = useState<SkillMapDraft | null>(null);
  const [editingSkillId, setEditingSkillId] = useState<number | null>(null);
  const [savingSkillId, setSavingSkillId] = useState<number | null>(null);
  const canUpdate = canEdit && Boolean(onSave);

  const startEdit = (item: ClientSkillMapItem) => {
    setEditingSkillId(item.skillId);
    setDraft(getDraft(item));
  };

  const cancelEdit = () => {
    setEditingSkillId(null);
    setDraft(null);
  };

  const save = async (item: ClientSkillMapItem) => {
    if (!draft || !onSave) return;
    setSavingSkillId(item.skillId);
    try {
      await onSave(item.skillId, getPayload(draft));
      cancelEdit();
    } finally {
      setSavingSkillId(null);
    }
  };

  return (
    <div className="rounded-md border">
      <div className="flex flex-col gap-3 border-b px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2 font-medium">
            <Target className="h-4 w-4 text-muted-foreground" />
            {title}
          </div>
          <div className="mt-1 text-sm text-muted-foreground">
            Уровни 0-5 по активным навыкам методики.
          </div>
        </div>
        <Badge variant="outline">{items.length} навыков</Badge>
      </div>

      <div className="divide-y">
        {items.length === 0 ? (
          <div className="p-6 text-center text-sm text-muted-foreground">
            Активных навыков пока нет.
          </div>
        ) : (
          items.map((item) => {
            const isEditing = editingSkillId === item.skillId;
            const currentDraft = isEditing ? draft : null;

            return (
              <article key={item.skillId} className="p-4">
                <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge>{item.level}</Badge>
                      {item.repeatFlag && (
                        <Badge variant="secondary">
                          <Repeat2 className="mr-1 h-3 w-3" />
                          repeat
                        </Badge>
                      )}
                      <span className="break-words font-medium">
                        {item.skill?.name || `Навык ${item.skillId}`}
                      </span>
                      <Badge variant="outline">
                        {getSkillDirectionLabel(item.skill?.direction)}
                      </Badge>
                    </div>
                    {item.skill?.description && (
                      <div className="mt-2 whitespace-pre-wrap break-words text-sm text-muted-foreground">
                        {item.skill.description}
                      </div>
                    )}
                    <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
                      <div className="flex min-w-0 items-start gap-2">
                        <CalendarDays className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                        <span className="min-w-0">
                          <span className="text-muted-foreground">
                            Отработка:{' '}
                          </span>
                          {formatDate(item.lastTrainedAt)}
                        </span>
                      </div>
                      <div className="flex min-w-0 items-start gap-2">
                        <ClipboardCheck className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                        <span className="min-w-0">
                          <span className="text-muted-foreground">
                            E-step:{' '}
                          </span>
                          {item.nextEStep || '-'}
                        </span>
                      </div>
                      <div className="min-w-0 break-words">
                        <span className="text-muted-foreground">
                          Упражнения:{' '}
                        </span>
                        {item.latestExercises || '-'}
                      </div>
                      <div className="min-w-0 break-words">
                        <span className="text-muted-foreground">Оценка: </span>
                        {item.latestAssessment || '-'}
                      </div>
                    </div>
                  </div>

                  {canUpdate && !isEditing && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => startEdit(item)}
                    >
                      <Pencil className="mr-2 h-4 w-4" />
                      Изменить
                    </Button>
                  )}
                </div>

                {isEditing && currentDraft && (
                  <div className="mt-4 rounded-md border bg-muted/30 p-3">
                    <div className="grid gap-3 lg:grid-cols-[90px_160px_1fr_1fr]">
                      <div>
                        <label className="mb-1 block text-xs font-medium text-muted-foreground">
                          Уровень
                        </label>
                        <Select
                          value={currentDraft.level}
                          onValueChange={(value) =>
                            setDraft({ ...currentDraft, level: value })
                          }
                        >
                          <SelectTrigger className="w-full bg-background">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {SKILL_LEVELS.map((level) => (
                              <SelectItem key={level} value={String(level)}>
                                {level}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-medium text-muted-foreground">
                          Отработка
                        </label>
                        <Input
                          type="date"
                          value={currentDraft.lastTrainedAt}
                          onChange={(event) =>
                            setDraft({
                              ...currentDraft,
                              lastTrainedAt: event.target.value,
                            })
                          }
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-medium text-muted-foreground">
                          Упражнения
                        </label>
                        <Input
                          value={currentDraft.latestExercises}
                          onChange={(event) =>
                            setDraft({
                              ...currentDraft,
                              latestExercises: event.target.value,
                            })
                          }
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-medium text-muted-foreground">
                          Оценка
                        </label>
                        <Input
                          value={currentDraft.latestAssessment}
                          onChange={(event) =>
                            setDraft({
                              ...currentDraft,
                              latestAssessment: event.target.value,
                            })
                          }
                        />
                      </div>
                    </div>
                    <div className="mt-3 grid gap-3 sm:grid-cols-[180px_1fr] sm:items-end">
                      <div>
                        <label className="mb-1 block text-xs font-medium text-muted-foreground">
                          Следующий E-step
                        </label>
                        <Select
                          value={currentDraft.nextEStep}
                          onValueChange={(value) =>
                            setDraft({
                              ...currentDraft,
                              nextEStep: value as TrainingExerciseELevel | 'none',
                            })
                          }
                        >
                          <SelectTrigger className="w-full bg-background">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">-</SelectItem>
                            {TRAINING_EXERCISE_E_LEVELS.map((step) => (
                              <SelectItem key={step} value={step}>
                                {step}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <label className="flex min-h-8 items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={currentDraft.repeatFlag}
                          onChange={(event) =>
                            setDraft({
                              ...currentDraft,
                              repeatFlag: event.target.checked,
                            })
                          }
                          className="h-4 w-4"
                        />
                        <span>repeat flag</span>
                      </label>
                    </div>
                    <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => save(item)}
                        disabled={savingSkillId === item.skillId}
                      >
                        <Save className="mr-2 h-4 w-4" />
                        {savingSkillId === item.skillId ? 'Сохраняем...' : 'Сохранить'}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={cancelEdit}
                      >
                        <X className="mr-2 h-4 w-4" />
                        Отменить
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setDraft(getDraft(item))}
                      >
                        <RotateCcw className="mr-2 h-4 w-4" />
                        Сбросить
                      </Button>
                    </div>
                  </div>
                )}
              </article>
            );
          })
        )}
      </div>

      {disabledReason && !canUpdate && (
        <div className="border-t px-4 py-3 text-sm text-muted-foreground">
          {disabledReason}
        </div>
      )}
    </div>
  );
}
