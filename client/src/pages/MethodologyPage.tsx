import { useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { type ColumnDef } from '@tanstack/react-table';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import {
  Archive,
  ArchiveRestore,
  CheckCircle2,
  Pencil,
  Plus,
  Save,
} from 'lucide-react';
import {
  approveMethodologyExercise,
  archiveMethodologyExercise,
  createMethodologyExercise,
  createMethodologySkill,
  listMethodologyExercises,
  listMethodologySkills,
  restoreMethodologyExercise,
  updateMethodologyExercise,
  updateMethodologySkill,
  type MethodologyExerciseFilters,
  type MethodologyExercisePayload,
  type MethodologySkillFilters,
  type MethodologySkillPayload,
} from '@/api/methodology';
import { queryKeys } from '@/api/query-keys';
import {
  ConfirmActionDialog,
  type ConfirmAction,
} from '@/components/confirm-action-dialog';
import { DataTable } from '@/components/data-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ModuleSwitch } from '@/components/module-switch';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
  canCreateMethodologyDraft,
  canManageMethodology,
} from '@/lib/permissions';
import { useAuth } from '@/lib/useAuth';
import {
  TRAINING_EXERCISE_E_LEVELS,
  TRAINING_EXERCISE_FORMATS,
  TRAINING_SKILL_DIRECTIONS,
  getExerciseFormatLabel,
  getExerciseStatusLabel,
  getSkillDirectionLabel,
  getSkillLevelRangeLabel,
  getSkillStatusLabel,
  type TrainingExercise,
  type TrainingExerciseFormat,
  type TrainingExerciseStatus,
  type TrainingSkill,
  type TrainingSkillDirection,
  type TrainingSkillStatus,
} from '@/lib/methodology';
import { cn } from '@/lib/utils';

type Section = 'exercises' | 'skills';
type PendingAction = ConfirmAction & {
  onConfirm: () => Promise<void>;
};

const METHODOLOGY_SWITCH_ITEMS = [
  { label: 'Методика', to: '/admin/methodology' },
  { label: 'Аналитика', to: '/admin/methodology-analytics' },
];

const skillFormSchema = z.object({
  description: z.string().trim().optional(),
  direction: z.custom<TrainingSkillDirection>((value) =>
    TRAINING_SKILL_DIRECTIONS.some((item) => item.value === value),
  ),
  name: z
    .string()
    .trim()
    .min(2, 'Название должно быть не короче 2 символов'),
  status: z.custom<TrainingSkillStatus>((value) =>
    ['active', 'archived'].includes(String(value)),
  ),
});

const exerciseFormSchema = z
  .object({
    complication: z.string().trim().optional(),
    description: z.string().trim().optional(),
    eLevel: z.string(),
    mainSkillId: z.string(),
    name: z
      .string()
      .trim()
      .min(2, 'Название должно быть не короче 2 символов'),
    simplification: z.string().trim().optional(),
    skillLevelMax: z.string(),
    skillLevelMin: z.string(),
    status: z.custom<TrainingExerciseStatus>((value) =>
      ['draft', 'approved', 'archived'].includes(String(value)),
    ),
    successCriterion: z.string().trim().optional(),
  })
  .refine(
    (values) => {
      if (values.skillLevelMin === 'none' || values.skillLevelMax === 'none') {
        return true;
      }
      return Number(values.skillLevelMin) <= Number(values.skillLevelMax);
    },
    {
      message: 'Минимальный уровень не может быть выше максимального',
      path: ['skillLevelMax'],
    },
  );

type SkillFormValues = z.infer<typeof skillFormSchema>;
type ExerciseFormValues = z.infer<typeof exerciseFormSchema>;

const EMPTY_SKILL_FORM: SkillFormValues = {
  description: '',
  direction: 'technique',
  name: '',
  status: 'active',
};

const EMPTY_EXERCISE_FORM: ExerciseFormValues = {
  complication: '',
  description: '',
  eLevel: 'none',
  mainSkillId: 'none',
  name: '',
  simplification: '',
  skillLevelMax: 'none',
  skillLevelMin: 'none',
  status: 'draft',
  successCriterion: '',
};

function textAreaClassName() {
  return 'min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-50';
}

function getSkillStatusBadgeClass(status: TrainingSkillStatus) {
  if (status === 'active') {
    return 'border-transparent bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300';
  }
  return 'bg-muted text-muted-foreground';
}

function getExerciseStatusBadgeClass(status: TrainingExerciseStatus) {
  if (status === 'approved') {
    return 'border-transparent bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300';
  }
  if (status === 'draft') {
    return 'border-transparent bg-amber-100 text-amber-900 dark:bg-amber-900/30 dark:text-amber-200';
  }
  return 'bg-muted text-muted-foreground';
}

function normalizeSelectNumber(value: string) {
  return value === 'none' ? null : Number(value);
}

function formatSkillLevelOptions() {
  return [0, 1, 2, 3, 4, 5].map((level) => (
    <SelectItem key={level} value={String(level)}>
      {level}
    </SelectItem>
  ));
}

function canEditExercise(
  exercise: TrainingExercise,
  accountId: number | undefined,
  canManage: boolean,
) {
  if (canManage) return true;
  return (
    exercise.status === 'draft' &&
    Boolean(accountId) &&
    Number(exercise.createdBy?.id) === Number(accountId)
  );
}

export default function MethodologyPage() {
  const { account } = useAuth();
  const queryClient = useQueryClient();
  const canManage = canManageMethodology(account?.role);
  const canCreateDraft = canCreateMethodologyDraft(account?.role);
  const [section, setSection] = useState<Section>('exercises');
  const [skillFilters, setSkillFilters] = useState<MethodologySkillFilters>({
    direction: 'all',
    q: '',
    status: 'active',
  });
  const [exerciseFilters, setExerciseFilters] =
    useState<MethodologyExerciseFilters>({
      direction: 'all',
      eLevel: 'all',
      format: 'all',
      mainSkillId: null,
      q: '',
      skillId: null,
      skillLevel: null,
      status: canManage ? 'all' : 'approved',
    });
  const [skillDialogOpen, setSkillDialogOpen] = useState(false);
  const [exerciseDialogOpen, setExerciseDialogOpen] = useState(false);
  const [editingSkill, setEditingSkill] = useState<TrainingSkill | null>(null);
  const [editingExercise, setEditingExercise] =
    useState<TrainingExercise | null>(null);
  const [selectedAdditionalSkillIds, setSelectedAdditionalSkillIds] = useState<
    number[]
  >([]);
  const [selectedFormats, setSelectedFormats] = useState<
    TrainingExerciseFormat[]
  >(['personal']);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [pendingActionLoading, setPendingActionLoading] = useState(false);

  const skillForm = useForm<SkillFormValues>({
    defaultValues: EMPTY_SKILL_FORM,
    resolver: zodResolver(skillFormSchema),
  });
  const exerciseForm = useForm<ExerciseFormValues>({
    defaultValues: EMPTY_EXERCISE_FORM,
    resolver: zodResolver(exerciseFormSchema),
  });

  const activeSkillsQuery = useQuery({
    queryFn: () => listMethodologySkills({ status: 'active' }),
    queryKey: queryKeys.methodology.skills({ status: 'active' }),
  });
  const skillsQuery = useQuery({
    queryFn: () => listMethodologySkills(skillFilters),
    queryKey: queryKeys.methodology.skills(skillFilters),
  });
  const exercisesQuery = useQuery({
    queryFn: () => listMethodologyExercises(exerciseFilters),
    queryKey: queryKeys.methodology.exercises(exerciseFilters),
  });

  const activeSkills = activeSkillsQuery.data || [];
  const skills = skillsQuery.data || [];
  const exercises = exercisesQuery.data || [];
  const skillErrorMessage = skillsQuery.isError
    ? getApiErrorMessage(skillsQuery.error, 'Не удалось загрузить навыки')
    : null;
  const exerciseErrorMessage = exercisesQuery.isError
    ? getApiErrorMessage(exercisesQuery.error, 'Не удалось загрузить упражнения')
    : null;
  const loadingSkills = skillsQuery.isLoading || skillsQuery.isFetching;
  const loadingExercises =
    exercisesQuery.isLoading || exercisesQuery.isFetching;
  const invalidateMethodology = () =>
    queryClient.invalidateQueries({ queryKey: queryKeys.methodology.all });

  const saveSkillMutation = useMutation({
    mutationFn: (payload: {
      id?: number;
      values: MethodologySkillPayload | Partial<MethodologySkillPayload>;
    }) =>
      payload.id
        ? updateMethodologySkill(payload.id, payload.values)
        : createMethodologySkill(payload.values as MethodologySkillPayload),
    onSuccess: invalidateMethodology,
  });
  const saveExerciseMutation = useMutation({
    mutationFn: (payload: {
      id?: number;
      values: MethodologyExercisePayload | Partial<MethodologyExercisePayload>;
    }) =>
      payload.id
        ? updateMethodologyExercise(payload.id, payload.values)
        : createMethodologyExercise(payload.values as MethodologyExercisePayload),
    onSuccess: invalidateMethodology,
  });
  const approveExerciseMutation = useMutation({
    mutationFn: approveMethodologyExercise,
    onSuccess: invalidateMethodology,
  });
  const archiveExerciseMutation = useMutation({
    mutationFn: archiveMethodologyExercise,
    onSuccess: invalidateMethodology,
  });
  const restoreExerciseMutation = useMutation({
    mutationFn: restoreMethodologyExercise,
    onSuccess: invalidateMethodology,
  });

  const openCreateSkill = () => {
    setEditingSkill(null);
    skillForm.reset(EMPTY_SKILL_FORM);
    setSkillDialogOpen(true);
  };

  const openEditSkill = (skill: TrainingSkill) => {
    setEditingSkill(skill);
    skillForm.reset({
      description: skill.description || '',
      direction: skill.direction,
      name: skill.name,
      status: skill.status,
    });
    setSkillDialogOpen(true);
  };

  const openCreateExercise = () => {
    setEditingExercise(null);
    setSelectedAdditionalSkillIds([]);
    setSelectedFormats(['personal']);
    exerciseForm.reset({
      ...EMPTY_EXERCISE_FORM,
      status: 'draft',
    });
    setExerciseDialogOpen(true);
  };

  const openEditExercise = (exercise: TrainingExercise) => {
    setEditingExercise(exercise);
    setSelectedAdditionalSkillIds(exercise.additionalSkillIds || []);
    setSelectedFormats(exercise.formats.length > 0 ? exercise.formats : ['personal']);
    exerciseForm.reset({
      complication: exercise.complication || '',
      description: exercise.description || '',
      eLevel: exercise.eLevel || 'none',
      mainSkillId: exercise.mainSkillId ? String(exercise.mainSkillId) : 'none',
      name: exercise.name,
      simplification: exercise.simplification || '',
      skillLevelMax:
        exercise.skillLevelMax === null || exercise.skillLevelMax === undefined
          ? 'none'
          : String(exercise.skillLevelMax),
      skillLevelMin:
        exercise.skillLevelMin === null || exercise.skillLevelMin === undefined
          ? 'none'
          : String(exercise.skillLevelMin),
      status: exercise.status,
      successCriterion: exercise.successCriterion || '',
    });
    setExerciseDialogOpen(true);
  };

  const handleSkillSave = skillForm.handleSubmit(async (values) => {
    try {
      await saveSkillMutation.mutateAsync({
        id: editingSkill?.id,
        values: {
          description: values.description || null,
          direction: values.direction,
          name: values.name,
          status: values.status,
        },
      });
      setSkillDialogOpen(false);
      toast.success(editingSkill ? 'Навык обновлен' : 'Навык создан');
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'Не удалось сохранить навык'));
    }
  });

  const buildExercisePayload = (
    values: ExerciseFormValues,
  ): MethodologyExercisePayload => {
    const skillLevelMin = normalizeSelectNumber(values.skillLevelMin);
    const skillLevelMax = normalizeSelectNumber(values.skillLevelMax);
    const mainSkillId = normalizeSelectNumber(values.mainSkillId);

    return {
      additionalSkillIds: selectedAdditionalSkillIds.filter(
        (skillId) => skillId !== mainSkillId,
      ),
      complication: values.complication || null,
      description: values.description || null,
      eLevel:
        values.eLevel === 'none'
          ? null
          : (values.eLevel as MethodologyExercisePayload['eLevel']),
      formats: selectedFormats,
      mainSkillId,
      name: values.name,
      simplification: values.simplification || null,
      skillLevelMax,
      skillLevelMin,
      status: canManage ? values.status : 'draft',
      successCriterion: values.successCriterion || null,
    };
  };

  const handleExerciseSave = exerciseForm.handleSubmit(async (values) => {
    const payload = buildExercisePayload(values);
    if (payload.status === 'approved' && (!payload.mainSkillId || !payload.eLevel)) {
      toast.error('Для утверждения нужен главный навык и E-level');
      return;
    }

    try {
      await saveExerciseMutation.mutateAsync({
        id: editingExercise?.id,
        values: payload,
      });
      setExerciseDialogOpen(false);
      toast.success(
        editingExercise ? 'Упражнение обновлено' : 'Упражнение создано',
      );
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'Не удалось сохранить упражнение'));
    }
  });

  const updateSkillStatus = async (
    skill: TrainingSkill,
    status: TrainingSkillStatus,
  ) => {
    try {
      await saveSkillMutation.mutateAsync({
        id: skill.id,
        values: { status },
      });
      toast.success(status === 'archived' ? 'Навык в архиве' : 'Навык активен');
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'Не удалось изменить статус навыка'));
    }
  };

  const requestSkillStatusChange = (
    skill: TrainingSkill,
    status: TrainingSkillStatus,
  ) => {
    const archive = status === 'archived';
    setPendingAction({
      confirmLabel: archive ? 'В архив' : 'Восстановить',
      description: archive
        ? `«${skill.name}» исчезнет из активных списков выбора для новых упражнений.`
        : `«${skill.name}» снова появится в списке активных навыков.`,
      isDestructive: archive,
      onConfirm: () => updateSkillStatus(skill, status),
      title: archive ? 'Архивировать навык?' : 'Восстановить навык?',
    });
  };

  const requestExerciseAction = (
    exercise: TrainingExercise,
    action: 'approve' | 'archive' | 'restore',
  ) => {
    const actionConfig = {
      approve: {
        confirmLabel: 'Утвердить',
        description: `«${exercise.name}» станет доступно тренерам как утвержденное упражнение.`,
        isDestructive: false,
        onConfirm: async () => {
          await approveExerciseMutation.mutateAsync(exercise.id);
          toast.success('Упражнение утверждено');
        },
        title: 'Утвердить упражнение?',
      },
      archive: {
        confirmLabel: 'В архив',
        description: `«${exercise.name}» будет скрыто из активной методической базы.`,
        isDestructive: true,
        onConfirm: async () => {
          await archiveExerciseMutation.mutateAsync(exercise.id);
          toast.success('Упражнение отправлено в архив');
        },
        title: 'Архивировать упражнение?',
      },
      restore: {
        confirmLabel: 'Восстановить',
        description: `«${exercise.name}» вернется в черновики и сможет быть утверждено заново.`,
        isDestructive: false,
        onConfirm: async () => {
          await restoreExerciseMutation.mutateAsync(exercise.id);
          toast.success('Упражнение восстановлено');
        },
        title: 'Восстановить упражнение?',
      },
    }[action];

    setPendingAction(actionConfig);
  };

  const confirmPendingAction = async () => {
    if (!pendingAction) return;
    setPendingActionLoading(true);
    try {
      await pendingAction.onConfirm();
      setPendingAction(null);
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'Не удалось выполнить действие'));
    } finally {
      setPendingActionLoading(false);
    }
  };

  const toggleAdditionalSkill = (skillId: number) => {
    setSelectedAdditionalSkillIds((current) =>
      current.includes(skillId)
        ? current.filter((id) => id !== skillId)
        : [...current, skillId],
    );
  };

  const toggleFormat = (format: TrainingExerciseFormat) => {
    setSelectedFormats((current) =>
      current.includes(format)
        ? current.filter((item) => item !== format)
        : [...current, format],
    );
  };

  const skillColumns: ColumnDef<TrainingSkill>[] = [
    {
      accessorKey: 'name',
      cell: ({ row }) => (
        <div className="min-w-0">
          <div className="break-words font-medium">{row.original.name}</div>
          {row.original.description && (
            <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">
              {row.original.description}
            </div>
          )}
        </div>
      ),
      header: 'Навык',
      size: 320,
    },
    {
      accessorKey: 'direction',
      cell: ({ row }) => (
        <Badge variant="outline" className="h-auto min-h-5 whitespace-normal break-words text-left">
          {getSkillDirectionLabel(row.original.direction)}
        </Badge>
      ),
      header: 'Направление',
      size: 220,
    },
    {
      accessorKey: 'status',
      cell: ({ row }) => (
        <Badge
          variant="outline"
          className={cn(
            'h-auto min-h-5 whitespace-normal break-words text-left',
            getSkillStatusBadgeClass(row.original.status),
          )}
        >
          {getSkillStatusLabel(row.original.status)}
        </Badge>
      ),
      header: 'Статус',
      size: 140,
    },
    {
      id: 'actions',
      cell: ({ row }) => {
        const skill = row.original;

        return (
          <div className="flex justify-end gap-1">
            {canManage ? (
              <>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => openEditSkill(skill)}
                  aria-label={`Редактировать ${skill.name}`}
                  title="Редактировать"
                >
                  <Pencil className="h-4 w-4" />
                </Button>
                {skill.status === 'active' ? (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => requestSkillStatusChange(skill, 'archived')}
                    aria-label={`Архивировать ${skill.name}`}
                    title="Архивировать"
                  >
                    <Archive className="h-4 w-4" />
                  </Button>
                ) : (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => requestSkillStatusChange(skill, 'active')}
                    aria-label={`Восстановить ${skill.name}`}
                    title="Восстановить"
                  >
                    <ArchiveRestore className="h-4 w-4" />
                  </Button>
                )}
              </>
            ) : (
              <span className="text-xs text-muted-foreground">Просмотр</span>
            )}
          </div>
        );
      },
      header: '',
      size: 140,
    },
  ];

  const exerciseColumns: ColumnDef<TrainingExercise>[] = [
    {
      accessorKey: 'name',
      cell: ({ row }) => (
        <div className="min-w-0">
          <div className="break-words font-medium">{row.original.name}</div>
          {row.original.description && (
            <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">
              {row.original.description}
            </div>
          )}
        </div>
      ),
      header: 'Упражнение',
      size: 300,
    },
    {
      accessorKey: 'status',
      cell: ({ row }) => (
        <Badge
          variant="outline"
          className={cn(
            'h-auto min-h-5 whitespace-normal break-words text-left',
            getExerciseStatusBadgeClass(row.original.status),
          )}
        >
          {getExerciseStatusLabel(row.original.status)}
        </Badge>
      ),
      header: 'Статус',
      size: 130,
    },
    {
      accessorKey: 'mainSkill',
      cell: ({ row }) => (
        <div className="min-w-0">
          <div className="break-words">
            {row.original.mainSkill?.name || '-'}
          </div>
          {row.original.mainSkill && (
            <div className="mt-1 text-xs text-muted-foreground">
              {getSkillDirectionLabel(row.original.mainSkill.direction)}
            </div>
          )}
        </div>
      ),
      header: 'Главный навык',
      size: 230,
    },
    {
      id: 'levels',
      cell: ({ row }) => (
        <div className="space-y-1 text-sm">
          <div>{row.original.eLevel || '-'}</div>
          <div className="text-xs text-muted-foreground">
            Уровень {getSkillLevelRangeLabel(
              row.original.skillLevelMin,
              row.original.skillLevelMax,
            )}
          </div>
        </div>
      ),
      header: 'Уровни',
      size: 140,
    },
    {
      accessorKey: 'formats',
      cell: ({ row }) => (
        <div className="flex flex-wrap gap-1">
          {row.original.formats.length > 0 ? (
            row.original.formats.map((format) => (
              <Badge
                key={format}
                variant="outline"
                className="h-auto min-h-5 whitespace-normal break-words text-left"
              >
                {getExerciseFormatLabel(format)}
              </Badge>
            ))
          ) : (
            <span className="text-muted-foreground">-</span>
          )}
        </div>
      ),
      header: 'Форматы',
      size: 220,
    },
    {
      id: 'actions',
      cell: ({ row }) => {
        const exercise = row.original;
        const editable = canEditExercise(exercise, account?.id, canManage);

        return (
          <div className="flex justify-end gap-1">
            {editable && (
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => openEditExercise(exercise)}
                aria-label={`Редактировать ${exercise.name}`}
                title="Редактировать"
              >
                <Pencil className="h-4 w-4" />
              </Button>
            )}
            {canManage && exercise.status !== 'approved' && exercise.status !== 'archived' && (
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => requestExerciseAction(exercise, 'approve')}
                aria-label={`Утвердить ${exercise.name}`}
                title="Утвердить"
              >
                <CheckCircle2 className="h-4 w-4" />
              </Button>
            )}
            {canManage && exercise.status !== 'archived' && (
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => requestExerciseAction(exercise, 'archive')}
                aria-label={`Архивировать ${exercise.name}`}
                title="Архивировать"
              >
                <Archive className="h-4 w-4" />
              </Button>
            )}
            {canManage && exercise.status === 'archived' && (
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => requestExerciseAction(exercise, 'restore')}
                aria-label={`Восстановить ${exercise.name}`}
                title="Восстановить"
              >
                <ArchiveRestore className="h-4 w-4" />
              </Button>
            )}
            {!editable && !canManage && (
              <span className="text-xs text-muted-foreground">Просмотр</span>
            )}
          </div>
        );
      },
      header: '',
      size: 170,
    },
  ];

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <div className="flex flex-col gap-3 rounded-xl border bg-card/60 p-3 lg:flex-row lg:items-center lg:justify-between">
        <ModuleSwitch items={METHODOLOGY_SWITCH_ITEMS} />
        <div className="flex flex-wrap gap-2">
          {section === 'skills' && canManage && (
            <Button onClick={openCreateSkill}>
              <Plus className="mr-2 h-4 w-4" />
              Навык
            </Button>
          )}
          {section === 'exercises' && canCreateDraft && (
            <Button onClick={openCreateExercise}>
              <Plus className="mr-2 h-4 w-4" />
              Упражнение
            </Button>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-3 rounded-md border bg-card p-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap gap-2">
          <Button
            variant={section === 'exercises' ? 'default' : 'outline'}
            onClick={() => setSection('exercises')}
          >
            Упражнения
          </Button>
          <Button
            variant={section === 'skills' ? 'default' : 'outline'}
            onClick={() => setSection('skills')}
          >
            Навыки
          </Button>
        </div>
      </div>

      {section === 'exercises' && (
        <>
          <div className="grid gap-3 rounded-md border bg-card p-3 md:grid-cols-2 xl:grid-cols-6">
            <div className="xl:col-span-2">
              <Label className="mb-1 text-xs">Поиск</Label>
              <Input
                value={exerciseFilters.q || ''}
                onChange={(event) =>
                  setExerciseFilters((current) => ({
                    ...current,
                    q: event.target.value,
                  }))
                }
                placeholder="Название или критерий"
              />
            </div>
            <div>
              <Label className="mb-1 text-xs">Статус</Label>
              <Select
                value={exerciseFilters.status || 'all'}
                onValueChange={(value) =>
                  setExerciseFilters((current) => ({
                    ...current,
                    status: value as MethodologyExerciseFilters['status'],
                  }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {canManage && <SelectItem value="all">Все</SelectItem>}
                  <SelectItem value="approved">Утвержденные</SelectItem>
                  <SelectItem value="draft">Черновики</SelectItem>
                  {canManage && <SelectItem value="archived">Архив</SelectItem>}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="mb-1 text-xs">Направление</Label>
              <Select
                value={exerciseFilters.direction || 'all'}
                onValueChange={(value) =>
                  setExerciseFilters((current) => ({
                    ...current,
                    direction: value as MethodologyExerciseFilters['direction'],
                  }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Все</SelectItem>
                  {TRAINING_SKILL_DIRECTIONS.map((direction) => (
                    <SelectItem key={direction.value} value={direction.value}>
                      {direction.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="mb-1 text-xs">E-level</Label>
              <Select
                value={exerciseFilters.eLevel || 'all'}
                onValueChange={(value) =>
                  setExerciseFilters((current) => ({
                    ...current,
                    eLevel: value as MethodologyExerciseFilters['eLevel'],
                  }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Все</SelectItem>
                  {TRAINING_EXERCISE_E_LEVELS.map((level) => (
                    <SelectItem key={level} value={level}>
                      {level}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="mb-1 text-xs">Формат</Label>
              <Select
                value={exerciseFilters.format || 'all'}
                onValueChange={(value) =>
                  setExerciseFilters((current) => ({
                    ...current,
                    format: value as MethodologyExerciseFilters['format'],
                  }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Все</SelectItem>
                  {TRAINING_EXERCISE_FORMATS.map((format) => (
                    <SelectItem key={format.value} value={format.value}>
                      {format.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="mb-1 text-xs">Навык</Label>
              <Select
                value={
                  exerciseFilters.skillId ? String(exerciseFilters.skillId) : 'all'
                }
                onValueChange={(value) =>
                  setExerciseFilters((current) => ({
                    ...current,
                    skillId: value === 'all' ? null : Number(value),
                  }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Все</SelectItem>
                  {activeSkills.map((skill) => (
                    <SelectItem key={skill.id} value={String(skill.id)}>
                      {skill.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="mb-1 text-xs">Уровень 0-5</Label>
              <Select
                value={
                  exerciseFilters.skillLevel === null ||
                  exerciseFilters.skillLevel === undefined
                    ? 'all'
                    : String(exerciseFilters.skillLevel)
                }
                onValueChange={(value) =>
                  setExerciseFilters((current) => ({
                    ...current,
                    skillLevel: value === 'all' ? null : Number(value),
                  }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Все</SelectItem>
                  {formatSkillLevelOptions()}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="rounded-md border bg-card">
            <DataTable
              columns={exerciseColumns}
              data={exercises}
              emptyText="Упражнений пока нет."
              errorText={exerciseErrorMessage || undefined}
              loading={loadingExercises}
              loadingText="Загрузка упражнений..."
              minWidthClassName="min-w-[1190px]"
              onRetry={() => void exercisesQuery.refetch()}
              pageSize={12}
              tableClassName="table-fixed"
            />
          </div>
        </>
      )}

      {section === 'skills' && (
        <>
          <div className="grid gap-3 rounded-md border bg-card p-3 md:grid-cols-2 xl:grid-cols-4">
            <div className="xl:col-span-2">
              <Label className="mb-1 text-xs">Поиск</Label>
              <Input
                value={skillFilters.q || ''}
                onChange={(event) =>
                  setSkillFilters((current) => ({
                    ...current,
                    q: event.target.value,
                  }))
                }
                placeholder="Название или описание"
              />
            </div>
            <div>
              <Label className="mb-1 text-xs">Направление</Label>
              <Select
                value={skillFilters.direction || 'all'}
                onValueChange={(value) =>
                  setSkillFilters((current) => ({
                    ...current,
                    direction: value as MethodologySkillFilters['direction'],
                  }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Все</SelectItem>
                  {TRAINING_SKILL_DIRECTIONS.map((direction) => (
                    <SelectItem key={direction.value} value={direction.value}>
                      {direction.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="mb-1 text-xs">Статус</Label>
              <Select
                value={skillFilters.status || 'active'}
                onValueChange={(value) =>
                  setSkillFilters((current) => ({
                    ...current,
                    status: value as MethodologySkillFilters['status'],
                  }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Активные</SelectItem>
                  {canManage && <SelectItem value="archived">Архив</SelectItem>}
                  {canManage && <SelectItem value="all">Все</SelectItem>}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="rounded-md border bg-card">
            <DataTable
              columns={skillColumns}
              data={skills}
              emptyText="Навыков пока нет."
              errorText={skillErrorMessage || undefined}
              loading={loadingSkills}
              loadingText="Загрузка навыков..."
              minWidthClassName="min-w-[820px]"
              onRetry={() => void skillsQuery.refetch()}
              pageSize={12}
              tableClassName="table-fixed"
            />
          </div>
        </>
      )}

      <Dialog open={skillDialogOpen} onOpenChange={setSkillDialogOpen}>
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-[560px]">
          <DialogHeader>
            <DialogTitle>
              {editingSkill ? 'Редактировать навык' : 'Новый навык'}
            </DialogTitle>
            <DialogDescription>Методическая база</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSkillSave} className="space-y-4 pt-2">
            <div>
              <Label className="mb-1 text-xs">Название</Label>
              <Input
                aria-invalid={Boolean(skillForm.formState.errors.name)}
                {...skillForm.register('name')}
              />
              {skillForm.formState.errors.name && (
                <div className="mt-1 text-xs text-destructive">
                  {skillForm.formState.errors.name.message}
                </div>
              )}
            </div>
            <div>
              <Label className="mb-1 text-xs">Направление</Label>
              <Select
                value={skillForm.watch('direction')}
                onValueChange={(value) =>
                  skillForm.setValue(
                    'direction',
                    value as TrainingSkillDirection,
                    { shouldValidate: true },
                  )
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TRAINING_SKILL_DIRECTIONS.map((direction) => (
                    <SelectItem key={direction.value} value={direction.value}>
                      {direction.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {editingSkill && (
              <div>
                <Label className="mb-1 text-xs">Статус</Label>
                <Select
                  value={skillForm.watch('status')}
                  onValueChange={(value) =>
                    skillForm.setValue('status', value as TrainingSkillStatus, {
                      shouldValidate: true,
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Активен</SelectItem>
                    <SelectItem value="archived">Архив</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
            <div>
              <Label className="mb-1 text-xs">Описание</Label>
              <textarea
                className={textAreaClassName()}
                {...skillForm.register('description')}
              />
            </div>
            <Button
              type="submit"
              className="w-full"
              disabled={saveSkillMutation.isPending}
            >
              <Save className="mr-2 h-4 w-4" />
              Сохранить
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={exerciseDialogOpen} onOpenChange={setExerciseDialogOpen}>
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-[760px]">
          <DialogHeader>
            <DialogTitle>
              {editingExercise ? 'Редактировать упражнение' : 'Новое упражнение'}
            </DialogTitle>
            <DialogDescription>Методическая база</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleExerciseSave} className="space-y-4 pt-2">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="md:col-span-2">
                <Label className="mb-1 text-xs">Название</Label>
                <Input
                  aria-invalid={Boolean(exerciseForm.formState.errors.name)}
                  {...exerciseForm.register('name')}
                />
                {exerciseForm.formState.errors.name && (
                  <div className="mt-1 text-xs text-destructive">
                    {exerciseForm.formState.errors.name.message}
                  </div>
                )}
              </div>
              <div>
                <Label className="mb-1 text-xs">Главный навык</Label>
                <Select
                  value={exerciseForm.watch('mainSkillId')}
                  onValueChange={(value) =>
                    exerciseForm.setValue('mainSkillId', value, {
                      shouldValidate: true,
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Не выбран</SelectItem>
                    {activeSkills.map((skill) => (
                      <SelectItem key={skill.id} value={String(skill.id)}>
                        {skill.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="mb-1 text-xs">E-level</Label>
                <Select
                  value={exerciseForm.watch('eLevel')}
                  onValueChange={(value) =>
                    exerciseForm.setValue('eLevel', value, {
                      shouldValidate: true,
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Не выбран</SelectItem>
                    {TRAINING_EXERCISE_E_LEVELS.map((level) => (
                      <SelectItem key={level} value={level}>
                        {level}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="mb-1 text-xs">Уровень от</Label>
                <Select
                  value={exerciseForm.watch('skillLevelMin')}
                  onValueChange={(value) =>
                    exerciseForm.setValue('skillLevelMin', value, {
                      shouldValidate: true,
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Любой</SelectItem>
                    {formatSkillLevelOptions()}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="mb-1 text-xs">Уровень до</Label>
                <Select
                  value={exerciseForm.watch('skillLevelMax')}
                  onValueChange={(value) =>
                    exerciseForm.setValue('skillLevelMax', value, {
                      shouldValidate: true,
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Любой</SelectItem>
                    {formatSkillLevelOptions()}
                  </SelectContent>
                </Select>
                {exerciseForm.formState.errors.skillLevelMax && (
                  <div className="mt-1 text-xs text-destructive">
                    {exerciseForm.formState.errors.skillLevelMax.message}
                  </div>
                )}
              </div>
              {canManage && (
                <div>
                  <Label className="mb-1 text-xs">Статус</Label>
                  <Select
                    value={exerciseForm.watch('status')}
                    onValueChange={(value) =>
                      exerciseForm.setValue(
                        'status',
                        value as TrainingExerciseStatus,
                        { shouldValidate: true },
                      )
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="draft">Черновик</SelectItem>
                      <SelectItem value="approved">Утверждено</SelectItem>
                      <SelectItem value="archived">Архив</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>

            <div>
              <Label className="mb-2 text-xs">Форматы</Label>
              <div className="flex flex-wrap gap-2">
                {TRAINING_EXERCISE_FORMATS.map((format) => (
                  <label
                    key={format.value}
                    className="flex h-8 items-center gap-2 rounded-md border px-3 text-sm"
                  >
                    <input
                      type="checkbox"
                      checked={selectedFormats.includes(format.value)}
                      onChange={() => toggleFormat(format.value)}
                    />
                    <span>{format.label}</span>
                  </label>
                ))}
              </div>
            </div>

            <div>
              <Label className="mb-2 text-xs">Дополнительные навыки</Label>
              <div className="grid max-h-44 gap-2 overflow-y-auto rounded-md border p-2 sm:grid-cols-2">
                {activeSkills.length > 0 ? (
                  activeSkills.map((skill) => (
                    <label
                      key={skill.id}
                      className="flex min-w-0 items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-muted"
                    >
                      <input
                        type="checkbox"
                        checked={selectedAdditionalSkillIds.includes(skill.id)}
                        onChange={() => toggleAdditionalSkill(skill.id)}
                      />
                      <span className="truncate">{skill.name}</span>
                    </label>
                  ))
                ) : (
                  <div className="text-sm text-muted-foreground">
                    Активных навыков нет
                  </div>
                )}
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="md:col-span-2">
                <Label className="mb-1 text-xs">Описание</Label>
                <textarea
                  className={textAreaClassName()}
                  {...exerciseForm.register('description')}
                />
              </div>
              <div className="md:col-span-2">
                <Label className="mb-1 text-xs">Критерий успеха</Label>
                <textarea
                  className={textAreaClassName()}
                  {...exerciseForm.register('successCriterion')}
                />
              </div>
              <div>
                <Label className="mb-1 text-xs">Упрощение</Label>
                <textarea
                  className={textAreaClassName()}
                  {...exerciseForm.register('simplification')}
                />
              </div>
              <div>
                <Label className="mb-1 text-xs">Усложнение</Label>
                <textarea
                  className={textAreaClassName()}
                  {...exerciseForm.register('complication')}
                />
              </div>
            </div>

            <Button
              type="submit"
              className="w-full"
              disabled={saveExerciseMutation.isPending}
            >
              <Save className="mr-2 h-4 w-4" />
              Сохранить
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmActionDialog
        action={pendingAction}
        loading={pendingActionLoading}
        onCancel={() => setPendingAction(null)}
        onConfirm={confirmPendingAction}
      />
    </div>
  );
}
