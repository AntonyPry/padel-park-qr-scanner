import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import {
  CalendarDays,
  CheckCircle2,
  Dumbbell,
  History,
  Pencil,
  Plus,
  Save,
  Search,
  Target,
  Trash2,
} from 'lucide-react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/toast';
import {
  ConfirmActionDialog,
  type ConfirmAction,
} from '@/components/confirm-action-dialog';
import {
  ClientSkillMap,
  type ClientSkillMapItem,
  type ClientSkillMapPayload,
} from '@/components/client-skill-map';
import {
  TrainingNoteExerciseEditor,
  TrainingNoteExerciseList,
} from '@/components/training-note-exercises';
import {
  GroupTrainingRecommendationPanel,
  type GroupTrainingClientOption,
} from '@/components/group-training-recommendation-panel';
import { TrainingRecommendationPanel } from '@/components/training-recommendation-panel';
import {
  TrainingPlanLifecyclePanel,
} from '@/components/training-plan-lifecycle';
import type {
  GroupTrainingRecommendation,
  TrainingRecommendation,
} from '@/api/training-recommendations';
import {
  completeTrainingPlan,
  createTrainingPlan,
  listTrainingPlans,
  quickCompleteTrainingPlan,
  type TrainingPlan,
  type TrainingPlanExercisePayload,
  updateTrainingPlanExercises,
} from '@/api/training-plans';
import {
  createExerciseFormResult,
  type TrainingNoteExerciseFormResult,
  type TrainingNoteExerciseResult,
  toExerciseResultForm,
  toExerciseResultPayload,
} from '@/lib/training-note-exercises';
import { DataTable } from '@/components/data-table';
import { HelpTooltip, MetricCard } from '@/components/dashboard-metric';
import { Input } from '@/components/ui/input';
import {
  Pagination,
  PaginationButton,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationNext,
  PaginationPrevious,
} from '@/components/ui/pagination';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { listMethodologyExercises } from '@/api/methodology';
import { queryKeys } from '@/api/query-keys';
import { apiFetch } from '@/lib/api';
import { useRealtimeRefresh } from '@/lib/realtime';
import { useAuth, useAuthorizationRole } from '@/lib/useAuth';

type TrainingLevel = 'D' | 'D+' | 'C' | 'C+' | 'B' | 'B+' | 'A';

interface ClientStats {
  firstVisitAt?: string | null;
  lastVisitAt?: string | null;
  visitCount: number;
}

interface ClientTrainingStats {
  latestAt?: string | null;
  latestLevel?: TrainingLevel | null;
  notesCount: number;
}

interface Client {
  id: number;
  name: string;
  note?: string | null;
  segment: string;
  source: string;
  status: 'active' | 'archived';
  stats: ClientStats;
  training?: ClientTrainingStats;
}

interface ClientsResponse {
  items: Client[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

interface TrainingNote {
  createdAt: string;
  exerciseResults: TrainingNoteExerciseResult[];
  exercises: string;
  id: number;
  level: TrainingLevel;
  note: string;
  trainedAt: string;
  trainer?: {
    id: number;
    name: string;
    role?: string;
  } | null;
  updatedAt: string;
}

interface ClientDetails {
  client: Client;
  skillMap: ClientSkillMapItem[];
  trainingNotes: TrainingNote[];
}

interface TrainingFormState {
  exerciseResults: TrainingNoteExerciseFormResult[];
  legacyExercises: string;
  level: TrainingLevel;
  note: string;
  trainedAt: string;
}

type PendingAction = ConfirmAction & {
  onConfirm: () => Promise<boolean | void>;
};

const TRAINING_LEVELS: TrainingLevel[] = ['D', 'D+', 'C', 'C+', 'B', 'B+', 'A'];
const LEVEL_ORDER = new Map(TRAINING_LEVELS.map((level, index) => [level, index]));

function getTodayDate() {
  const date = new Date();
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 10);
}

function getEmptyTrainingForm(): TrainingFormState {
  return {
    exerciseResults: [],
    legacyExercises: '',
    level: 'D',
    note: '',
    trainedAt: getTodayDate(),
  };
}
const trainingFormSchema = z.object({
  exerciseResults: z.array(
    z.object({
      canAdvance: z.boolean(),
      comment: z.string().max(240, 'Комментарий до 240 символов'),
      rating: z.number().min(1).max(5),
      repeatExercise: z.boolean(),
      repeatSkill: z.boolean(),
      trainingExerciseId: z.string().min(1),
    }),
  ),
  legacyExercises: z.string(),
  level: z.enum(['D', 'D+', 'C', 'C+', 'B', 'B+', 'A']),
  note: z.string(),
  trainedAt: z.string().min(1, 'Укажите дату'),
}).refine(
  (values) =>
    values.exerciseResults.length > 0 ||
    values.legacyExercises.trim().length > 0 ||
    values.note.trim().length > 0,
  { message: 'Выберите упражнение или оставьте заметку', path: ['exerciseResults'] },
);

function formatDate(value?: string | null) {
  if (!value) return '-';
  return new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short' }).format(
    new Date(value),
  );
}

function formatDateTime(value?: string | null) {
  if (!value) return '-';
  return new Intl.DateTimeFormat('ru-RU', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value));
}

async function readError(response: Response, fallback: string) {
  try {
    const data = (await response.json()) as { error?: string };
    return data.error || fallback;
  } catch {
    return fallback;
  }
}

function getPaginationItems(currentPage: number, pageCount: number) {
  const pages = new Set<number>([1, pageCount, currentPage]);
  if (currentPage > 1) pages.add(currentPage - 1);
  if (currentPage < pageCount) pages.add(currentPage + 1);

  const sorted = Array.from(pages)
    .filter((page) => page >= 1 && page <= pageCount)
    .sort((a, b) => a - b);

  return sorted.reduce<Array<number | 'ellipsis'>>((items, page, index) => {
    if (index > 0 && page - sorted[index - 1] > 1) items.push('ellipsis');
    items.push(page);
    return items;
  }, []);
}

function getLevelDelta(notes: TrainingNote[]) {
  if (notes.length < 2) return null;
  const chronological = [...notes].sort(
    (a, b) =>
      new Date(a.trainedAt || a.createdAt).getTime() -
      new Date(b.trainedAt || b.createdAt).getTime(),
  );
  const first = chronological[0]?.level;
  const last = chronological.at(-1)?.level;
  if (!first || !last) return null;

  const delta = (LEVEL_ORDER.get(last) || 0) - (LEVEL_ORDER.get(first) || 0);
  if (delta > 0) return `+${delta}`;
  return String(delta);
}

function getLatestNote(notes: TrainingNote[]) {
  return notes[0] || null;
}

function mapClientToGroupOption(client: Client): GroupTrainingClientOption {
  return {
    id: client.id,
    latestLevel: client.training?.latestLevel || null,
    name: client.name,
    notesCount: client.training?.notesCount || 0,
  };
}

function getPlanParticipantNames(plan: TrainingPlan) {
  return plan.participants
    .map((participant) => participant.client?.name)
    .filter(Boolean)
    .join(', ');
}

function getPlanSortTime(plan: TrainingPlan) {
  const rawDate = plan.booking?.startsAt || `${plan.plannedAt}T00:00:00`;
  return new Date(rawDate).getTime();
}

export default function TrainerPage() {
  const { account } = useAuth();
  const clubRole = useAuthorizationRole('club');
  const [clients, setClients] = useState<Client[]>([]);
  const [clientsError, setClientsError] = useState<string | null>(null);
  const [clientsLoading, setClientsLoading] = useState(true);
  const [details, setDetails] = useState<ClientDetails | null>(null);
  const [detailsError, setDetailsError] = useState<string | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [editingNote, setEditingNote] = useState<TrainingNote | null>(null);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [saving, setSaving] = useState(false);
  const [totalPages, setTotalPages] = useState(1);
  const [trainingLevel, setTrainingLevel] = useState<'all' | TrainingLevel>('all');
  const [trainingPlans, setTrainingPlans] = useState<TrainingPlan[]>([]);
  const [trainingPlansError, setTrainingPlansError] = useState<string | null>(null);
  const [trainingPlansLoading, setTrainingPlansLoading] = useState(false);
  const [activePlan, setActivePlan] = useState<TrainingPlan | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [pendingActionLoading, setPendingActionLoading] = useState(false);
  const [groupClientIds, setGroupClientIds] = useState<number[]>([]);
  const [groupClientOptionsById, setGroupClientOptionsById] = useState<
    Record<number, GroupTrainingClientOption>
  >({});
  const detailsPanelRef = useRef<HTMLElement | null>(null);
  const detailsRequestIdRef = useRef(0);
  const trainingForm = useForm<TrainingFormState>({
    defaultValues: getEmptyTrainingForm(),
    resolver: zodResolver(trainingFormSchema),
  });
  const form = trainingForm.watch();
  const setForm = useCallback((nextForm: TrainingFormState) => {
    trainingForm.reset(nextForm, {
      keepDirty: true,
      keepErrors: true,
      keepTouched: true,
    });
  }, [trainingForm]);

  const queryString = useMemo(() => {
    const params = new URLSearchParams({
      page: String(page),
      pageSize: '10',
      status: 'active',
    });
    if (q.trim()) params.set('q', q.trim());
    if (trainingLevel !== 'all') params.set('trainingLevel', trainingLevel);
    return params.toString();
  }, [page, q, trainingLevel]);

  const paginationItems = useMemo(
    () => getPaginationItems(page, totalPages),
    [page, totalPages],
  );
  const selectedClientId = details?.client.id || null;
  const selectedClientPlans = useMemo(
    () =>
      trainingPlans.filter((plan) =>
        plan.participants.some((participant) => participant.clientId === selectedClientId),
      ),
    [selectedClientId, trainingPlans],
  );
  const upcomingTrainingPlans = useMemo(
    () =>
      trainingPlans
        .filter((plan) => plan.status === 'planned')
        .sort((left, right) => getPlanSortTime(left) - getPlanSortTime(right))
        .slice(0, 6),
    [trainingPlans],
  );
  const selectedGroupIdSet = useMemo(
    () => new Set(groupClientIds),
    [groupClientIds],
  );
  const selectedGroupClients = useMemo(
    () =>
      groupClientIds
        .map((clientId) => groupClientOptionsById[clientId])
        .filter((client): client is GroupTrainingClientOption => Boolean(client)),
    [groupClientIds, groupClientOptionsById],
  );
  const allPageClientsSelected = useMemo(
    () =>
      clients.length > 0 &&
      clients.every((client) => selectedGroupIdSet.has(client.id)),
    [clients, selectedGroupIdSet],
  );
  const latestNote = useMemo(
    () => getLatestNote(details?.trainingNotes || []),
    [details?.trainingNotes],
  );
  const levelDelta = useMemo(
    () => getLevelDelta(details?.trainingNotes || []),
    [details?.trainingNotes],
  );
  const approvedExerciseFilters = useMemo(() => ({ status: 'approved' as const }), []);
  const exercisesQuery = useQuery({
    enabled: Boolean(details?.client && details.client.status !== 'archived'),
    queryFn: () => listMethodologyExercises(approvedExerciseFilters),
    queryKey: queryKeys.methodology.exercises(approvedExerciseFilters),
  });
  const methodologyExercises = exercisesQuery.data || [];

  const fetchClients = useCallback(async () => {
    setClientsLoading(true);
    setClientsError(null);
    try {
      const response = await apiFetch(`/api/clients?${queryString}`);
      if (!response.ok) {
        setClientsError(await readError(response, 'Не удалось загрузить клиентов'));
        return;
      }

      const data = (await response.json()) as ClientsResponse;
      setClients(data.items);
      setGroupClientOptionsById((current) => {
        const next = { ...current };
        data.items.forEach((client) => {
          next[client.id] = mapClientToGroupOption(client);
        });
        return next;
      });
      setTotalPages(data.totalPages);
    } catch {
      setClientsError('Не удалось загрузить клиентов. Проверьте сервер.');
    } finally {
      setClientsLoading(false);
    }
  }, [queryString]);

  const upsertTrainingPlan = useCallback((plan: TrainingPlan) => {
    setTrainingPlans((current) => {
      const exists = current.some((item) => item.id === plan.id);
      const next = exists
        ? current.map((item) => (item.id === plan.id ? plan : item))
        : [plan, ...current];

      return next.sort((left, right) => {
        if (left.status !== right.status) return left.status === 'planned' ? -1 : 1;
        return new Date(right.plannedAt).getTime() - new Date(left.plannedAt).getTime();
      });
    });
  }, []);

  const fetchTrainingPlans = useCallback(async () => {
    setTrainingPlansLoading(true);
    setTrainingPlansError(null);
    try {
      setTrainingPlans(await listTrainingPlans({ status: 'all' }));
    } catch (error) {
      setTrainingPlansError(
        error instanceof Error
          ? error.message
          : 'Не удалось загрузить планы тренировок',
      );
    } finally {
      setTrainingPlansLoading(false);
    }
  }, []);

  const loadDetails = useCallback(async (clientId: number) => {
    const requestId = detailsRequestIdRef.current + 1;
    detailsRequestIdRef.current = requestId;

    const isBackgroundRefresh = details?.client.id === clientId;
    setDetailsLoading(true);
    setDetailsError(null);
    setDetails((current) =>
      current?.client.id === clientId ? current : null,
    );
    try {
      const response = await apiFetch(`/api/clients/${clientId}`);
      if (requestId !== detailsRequestIdRef.current) return;
      if (!response.ok) {
        setDetailsError(await readError(response, 'Не удалось открыть клиента'));
        return;
      }

      const data = (await response.json()) as ClientDetails;
      setDetails({
        ...data,
        skillMap: data.skillMap || [],
        trainingNotes: data.trainingNotes || [],
      });
      if (!isBackgroundRefresh) {
        setActivePlan(null);
        setEditingNote(null);
        setForm(getEmptyTrainingForm());
      }
      if (!isBackgroundRefresh && window.innerWidth < 1024) {
        window.setTimeout(() => {
          if (requestId === detailsRequestIdRef.current) {
            detailsPanelRef.current?.scrollIntoView({
              behavior: 'smooth',
              block: 'start',
            });
          }
        }, 0);
      }
    } catch {
      if (requestId !== detailsRequestIdRef.current) return;
      setDetailsError('Не удалось открыть клиента. Проверьте сервер.');
    } finally {
      if (requestId === detailsRequestIdRef.current) {
        setDetailsLoading(false);
      }
    }
  }, [details?.client.id, setForm]);

  const refreshSkillMap = useCallback(async (clientId: number) => {
    const response = await apiFetch(`/api/clients/${clientId}/skill-map`);
    if (!response.ok) return;

    const skillMap = (await response.json()) as ClientSkillMapItem[];
    setDetails((current) =>
      current?.client.id === clientId ? { ...current, skillMap } : current,
    );
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void fetchClients();
    }, 250);

    return () => window.clearTimeout(timeout);
  }, [fetchClients]);

  useEffect(() => {
    void fetchTrainingPlans();
  }, [fetchTrainingPlans]);

  useRealtimeRefresh(
    ['clients', 'trainingNotes', 'trainingPlans', 'methodology', 'bookings'],
    () => {
      void fetchClients();
      void fetchTrainingPlans();
      if (details?.client.id) void loadDetails(details.client.id);
    },
  );

  useEffect(() => {
    setPage(1);
  }, [q, trainingLevel]);

  const toggleGroupClient = useCallback((client: Client) => {
    setGroupClientOptionsById((current) => ({
      ...current,
      [client.id]: mapClientToGroupOption(client),
    }));
    setGroupClientIds((current) =>
      current.includes(client.id)
        ? current.filter((clientId) => clientId !== client.id)
        : [...current, client.id],
    );
  }, []);

  const toggleCurrentPageGroupSelection = useCallback(() => {
    setGroupClientOptionsById((current) => {
      const next = { ...current };
      clients.forEach((client) => {
        next[client.id] = mapClientToGroupOption(client);
      });
      return next;
    });
    setGroupClientIds((current) => {
      const pageIds = new Set(clients.map((client) => client.id));
      if (clients.length > 0 && clients.every((client) => current.includes(client.id))) {
        return current.filter((clientId) => !pageIds.has(clientId));
      }
      return Array.from(new Set([...current, ...clients.map((client) => client.id)]));
    });
  }, [clients]);

  const removeGroupClient = useCallback((clientId: number) => {
    setGroupClientIds((current) => current.filter((id) => id !== clientId));
  }, []);

  const canChangeNote = useCallback(
    (note: TrainingNote) => {
      if (clubRole === 'owner' || clubRole === 'manager') return true;
      return clubRole === 'trainer' && note.trainer?.id === account?.id;
    },
    [account?.id, clubRole],
  );

  const resetForm = () => {
    setActivePlan(null);
    setEditingNote(null);
    setForm(getEmptyTrainingForm());
  };

  const applyRecommendedExercises = useCallback((exerciseIds: number[]) => {
    const currentForm = trainingForm.getValues();
    setActivePlan(null);
    setEditingNote(null);
    setForm({
      ...currentForm,
      exerciseResults: exerciseIds.map(createExerciseFormResult),
      legacyExercises: '',
    });
  }, [setForm, trainingForm]);

  const hasDuplicatePlanExercises = useCallback(
    (plannedExercises: TrainingPlanExercisePayload[]) => {
      const ids = plannedExercises.map((item) => Number(item.trainingExerciseId));
      return new Set(ids).size !== ids.length;
    },
    [],
  );

  const createPersonalPlanFromRecommendation = useCallback(async (
    recommendation: TrainingRecommendation,
    plannedExercises: TrainingPlanExercisePayload[],
  ) => {
    if (!details?.client) return;
    if (hasDuplicatePlanExercises(plannedExercises)) {
      toast.error('В плане не должно быть одинаковых упражнений');
      return;
    }

    setSaving(true);
    try {
      const plan = await createTrainingPlan({
        clientIds: [details.client.id],
        goal: recommendation.goal,
        kind: 'personal',
        plannedAt: recommendation.asOfDate,
        plannedExercises,
        sourceSnapshot: {
          generatedAt: recommendation.generatedAt,
          prioritySkillIds: recommendation.prioritySkills.map((skill) => skill.skillId),
          summary: recommendation.summary,
        },
        sourceType: 'personal_recommendation',
      });
      upsertTrainingPlan(plan);
      toast.success('План тренировки создан');
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Не удалось создать план тренировки',
      );
    } finally {
      setSaving(false);
    }
  }, [details?.client, hasDuplicatePlanExercises, upsertTrainingPlan]);

  const createGroupPlanFromRecommendation = useCallback(async (
    recommendation: GroupTrainingRecommendation,
    plannedExercises: TrainingPlanExercisePayload[],
  ) => {
    if (hasDuplicatePlanExercises(plannedExercises)) {
      toast.error('В плане не должно быть одинаковых упражнений');
      return;
    }

    setSaving(true);
    try {
      const plan = await createTrainingPlan({
        clientIds: recommendation.clientIds,
        goal: recommendation.goal,
        kind: 'group',
        plannedAt: recommendation.asOfDate,
        plannedExercises,
        sourceSnapshot: {
          generatedAt: recommendation.generatedAt,
          participants: recommendation.participants,
          prioritySkillIds: recommendation.prioritySkills.map((skill) => skill.skillId),
          summary: recommendation.summary,
        },
        sourceType: 'group_recommendation',
      });
      upsertTrainingPlan(plan);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Не удалось создать групповой план',
      );
    } finally {
      setSaving(false);
    }
  }, [hasDuplicatePlanExercises, upsertTrainingPlan]);

  const replacePlanExercises = useCallback(async (
    plan: TrainingPlan,
    plannedExercises: TrainingPlanExercisePayload[],
  ) => {
    if (hasDuplicatePlanExercises(plannedExercises)) {
      toast.error('Это упражнение уже есть в плане');
      return;
    }

    setSaving(true);
    try {
      const updatedPlan = await updateTrainingPlanExercises(
        plan.id,
        plannedExercises,
      );
      upsertTrainingPlan(updatedPlan);
      toast.success('Упражнение в плане заменено');
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Не удалось заменить упражнение',
      );
    } finally {
      setSaving(false);
    }
  }, [hasDuplicatePlanExercises, upsertTrainingPlan]);

  const quickCompletePlan = useCallback(async (plan: TrainingPlan) => {
    setSaving(true);
    try {
      const completedPlan = await quickCompleteTrainingPlan(plan.id, {
        trainedAt: plan.plannedAt,
      });
      upsertTrainingPlan(completedPlan);
      if (
        details?.client &&
        completedPlan.participants.some(
          (participant) => participant.clientId === details.client.id,
        )
      ) {
        await loadDetails(details.client.id);
      }
      void fetchClients();
      toast.success('План закрыт как completed');
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Не удалось быстро закрыть план',
      );
    } finally {
      setSaving(false);
    }
  }, [details?.client, fetchClients, loadDetails, upsertTrainingPlan]);

  const startPlanCompletion = useCallback((plan: TrainingPlan) => {
    setActivePlan(plan);
    setEditingNote(null);
    setForm({
      exerciseResults: plan.plannedExercises.map((item) =>
        createExerciseFormResult(item.trainingExerciseId),
      ),
      legacyExercises: '',
      level: latestNote?.level || details?.client.training?.latestLevel || 'D',
      note: plan.goal ? `Цель плана: ${plan.goal}` : '',
      trainedAt: plan.plannedAt,
    });
  }, [details?.client.training?.latestLevel, latestNote?.level, setForm]);

  const startEdit = (note: TrainingNote) => {
    const exerciseResults = note.exerciseResults || [];
    setActivePlan(null);
    setEditingNote(note);
    setForm({
      exerciseResults: exerciseResults.map(toExerciseResultForm),
      legacyExercises: exerciseResults.length > 0 ? '' : note.exercises,
      level: note.level,
      note: note.note,
      trainedAt: note.trainedAt,
    });
  };

  const submitTraining = trainingForm.handleSubmit(async (values) => {
    if (!details?.client) return;

    setSaving(true);
    try {
      if (activePlan && !editingNote) {
        const completedPlan = await completeTrainingPlan(activePlan.id, {
          exerciseResults: toExerciseResultPayload(values.exerciseResults),
          level: values.level,
          note: values.note,
          trainedAt: values.trainedAt,
        });
        upsertTrainingPlan(completedPlan);
        resetForm();
        await loadDetails(details.client.id);
        void fetchClients();
        toast.success('План подтвержден, дневник обновлен');
        return;
      }

      const response = await apiFetch(
        editingNote
          ? `/api/training-notes/${editingNote.id}`
          : `/api/clients/${details.client.id}/training-notes`,
        {
          method: editingNote ? 'PUT' : 'POST',
          body: JSON.stringify({
            exerciseResults: toExerciseResultPayload(values.exerciseResults),
            exercises:
              values.exerciseResults.length > 0
                ? undefined
                : values.legacyExercises,
            level: values.level,
            note: values.note,
            trainedAt: values.trainedAt,
          }),
        },
      );

      if (!response.ok) {
        toast.error(await readError(response, 'Не удалось сохранить тренировку'));
        return;
      }

      const trainingNotes = (await response.json()) as TrainingNote[];
      setDetails({ ...details, trainingNotes });
      resetForm();
      void refreshSkillMap(details.client.id);
      void fetchClients();
      toast.success(editingNote ? 'Тренировка обновлена' : 'Тренировка сохранена');
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Не удалось сохранить тренировку',
      );
    } finally {
      setSaving(false);
    }
  }, (errors) => {
    const firstError = Object.values(errors)[0];
    toast.error(firstError?.message || 'Проверьте поля тренировки');
  });

  const saveSkillMap = async (
    skillId: number,
    payload: ClientSkillMapPayload,
  ) => {
    if (!details?.client) return;

    const response = await apiFetch(
      `/api/clients/${details.client.id}/skill-map/${skillId}`,
      {
        method: 'PUT',
        body: JSON.stringify(payload),
      },
    );

    if (!response.ok) {
      const message = await readError(response, 'Не удалось сохранить карту навыков');
      toast.error(message);
      throw new Error(message);
    }

    const skillMap = (await response.json()) as ClientSkillMapItem[];
    setDetails((current) =>
      current?.client.id === details.client.id
        ? { ...current, skillMap }
        : current,
    );
    toast.success('Карта навыков обновлена');
  };

  const deleteNote = (note: TrainingNote) => {
    setPendingAction({
      confirmLabel: 'Удалить',
      description:
        'Запись исчезнет из дневника тренировок клиента и истории прогресса.',
      isDestructive: true,
      title: 'Удалить тренировочную запись?',
      onConfirm: async () => {
        const response = await apiFetch(`/api/training-notes/${note.id}`, {
          method: 'DELETE',
        });

        if (!response.ok) {
          toast.error(await readError(response, 'Не удалось удалить тренировку'));
          return false;
        }

        const trainingNotes = (await response.json()) as TrainingNote[];
        setDetails((current) =>
          current ? { ...current, trainingNotes } : current,
        );
        if (editingNote?.id === note.id) resetForm();
        if (details?.client.id) void refreshSkillMap(details.client.id);
        void fetchClients();
        toast.success('Тренировка удалена');
      },
    });
  };

  const confirmPendingAction = async () => {
    if (!pendingAction) return;
    setPendingActionLoading(true);
    try {
      const shouldClose = await pendingAction.onConfirm();
      if (shouldClose !== false) setPendingAction(null);
    } finally {
      setPendingActionLoading(false);
    }
  };
  const clientColumns: ColumnDef<Client>[] = [
    {
      id: 'groupSelect',
      header: () => (
        <input
          type="checkbox"
          aria-label="Выбрать клиентов на странице для группы"
          checked={allPageClientsSelected}
          disabled={clients.length === 0 || clientsLoading}
          className="h-4 w-4 accent-primary"
          onChange={toggleCurrentPageGroupSelection}
          onClick={(event) => event.stopPropagation()}
        />
      ),
      cell: ({ row }) => {
        const client = row.original;
        return (
          <input
            type="checkbox"
            aria-label={`Выбрать ${client.name} для групповой тренировки`}
            checked={selectedGroupIdSet.has(client.id)}
            className="h-4 w-4 accent-primary"
            onChange={() => toggleGroupClient(client)}
            onClick={(event) => event.stopPropagation()}
          />
        );
      },
    },
    {
      accessorKey: 'name',
      header: 'Клиент',
      cell: ({ row }) => {
        const client = row.original;

        return (
          <div className="min-w-44">
            <div className="break-words font-medium">{client.name}</div>
            <div className="mt-1 flex flex-wrap gap-1">
              <Badge
                variant="outline"
                className="h-auto min-h-5 whitespace-normal break-words text-left"
              >
                {client.segment}
              </Badge>
              {client.source && (
                <Badge
                  variant="secondary"
                  className="h-auto min-h-5 whitespace-normal break-words text-left"
                >
                  {client.source}
                </Badge>
              )}
            </div>
          </div>
        );
      },
    },
    {
      id: 'visits',
      header: 'Визиты',
      cell: ({ row }) => row.original.stats.visitCount,
    },
    {
      id: 'lastVisit',
      header: 'Последний визит',
      cell: ({ row }) => formatDate(row.original.stats.lastVisitAt),
    },
    {
      id: 'level',
      header: 'Уровень',
      cell: ({ row }) =>
        row.original.training?.latestLevel ? (
          <Badge className="h-auto min-h-5 whitespace-normal break-words text-left">
            {row.original.training.latestLevel}
          </Badge>
        ) : (
          <span className="text-muted-foreground">-</span>
        ),
    },
    {
      id: 'notes',
      header: 'Дневник',
      meta: {
        cellClassName: 'text-right',
        headerClassName: 'text-right',
      },
      cell: ({ row }) => row.original.training?.notesCount || 0,
    },
  ];

  return (
    <div className="flex w-full flex-col gap-5">
      <h1 className="sr-only">Тренерский кабинет</h1>

      <section className="rounded-md border bg-card">
        <div className="flex flex-col gap-3 border-b p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2 font-medium">
              <CalendarDays className="h-4 w-4 text-muted-foreground" />
              Ближайшие planned-тренировки
            </div>
            <div className="mt-1 text-sm text-muted-foreground">
              Планы из рекомендаций и бронирований, назначенные на тренера.
            </div>
          </div>
        </div>
        <div className="p-4">
          {trainingPlansError && (
            <div className="mb-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {trainingPlansError}
            </div>
          )}
          {trainingPlansLoading ? (
            <div className="rounded-md border py-6 text-center text-sm text-muted-foreground">
              Загружаем ближайшие планы...
            </div>
          ) : upcomingTrainingPlans.length === 0 ? (
            <div className="rounded-md border border-dashed py-6 text-center text-sm text-muted-foreground">
              Ближайших planned-планов нет.
            </div>
          ) : (
            <div className="grid gap-3 lg:grid-cols-2">
              {upcomingTrainingPlans.map((plan) => (
                <article key={plan.id} className="rounded-md border p-3">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge>{plan.kind === 'group' ? 'group' : 'personal'}</Badge>
                        {plan.bookingId && <Badge variant="outline">booking</Badge>}
                        <span className="text-sm text-muted-foreground">
                          {plan.booking?.startsAt
                            ? formatDateTime(plan.booking.startsAt)
                            : formatDate(plan.plannedAt)}
                        </span>
                      </div>
                      <div className="mt-2 truncate font-medium">
                        {plan.goal || 'План тренировки'}
                      </div>
                      <div className="mt-1 text-sm text-muted-foreground">
                        {plan.booking?.court?.name || 'Ресурс не указан'} ·{' '}
                        {plan.plannedExercises.length} упр.
                      </div>
                      <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                        {getPlanParticipantNames(plan) || 'Участники не указаны'}
                      </div>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      disabled={saving || plan.plannedExercises.length === 0}
                      onClick={() => void quickCompletePlan(plan)}
                    >
                      <CheckCircle2 className="mr-2 h-4 w-4" />
                      Completed
                    </Button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      </section>

      <GroupTrainingRecommendationPanel
        clients={selectedGroupClients}
        disabled={saving}
        onCreatePlan={createGroupPlanFromRecommendation}
        onClear={() => setGroupClientIds([])}
        onRemoveClient={removeGroupClient}
      />

      <div className="grid gap-4 lg:min-h-[620px] lg:grid-cols-[minmax(0,1fr)_minmax(420px,0.9fr)]">
        <section className="min-w-0 rounded-md border bg-card lg:min-h-[620px]">
          <div className="border-b p-4">
            <div className="flex flex-col gap-3 xl:flex-row xl:items-end">
              <div className="min-w-0 flex-1">
                <label className="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  Поиск клиента
                  <HelpTooltip>
                    Поиск идет по имени клиента. Телефоны в тренерском режиме не
                    используются и не показываются.
                  </HelpTooltip>
                </label>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={q}
                    onChange={(event) => setQ(event.target.value)}
                    className="pl-9"
                    placeholder="Имя клиента"
                  />
                </div>
              </div>
              <div className="w-full xl:w-48">
                <label className="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  Уровень
                  <HelpTooltip>
                    Фильтр показывает клиентов по последнему уровню из дневника
                    тренировок.
                  </HelpTooltip>
                </label>
                <Select
                  value={trainingLevel}
                  onValueChange={(value) =>
                    setTrainingLevel(value as 'all' | TrainingLevel)
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Все уровни</SelectItem>
                    {TRAINING_LEVELS.map((level) => (
                      <SelectItem key={level} value={level}>
                        {level}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          {clientsError && clients.length > 0 && (
            <div className="border-b border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
              {clientsError}
            </div>
          )}

          <DataTable
            columns={clientColumns}
            data={clients}
            emptyText="Клиентов по текущему фильтру нет."
            errorText={clientsError || undefined}
            loading={clientsLoading && clients.length === 0}
            loadingText="Загружаем клиентов..."
            minWidthClassName="min-w-[720px]"
            onRetry={() => void fetchClients()}
            getRowProps={(row) => ({
              className: `cursor-pointer ${
                selectedClientId === row.original.id ? 'bg-muted/70' : ''
              }`,
              onClick: () => void loadDetails(row.original.id),
            })}
          />

          <div className="flex flex-col gap-3 border-t p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-sm text-muted-foreground">
              Страница {page} из {totalPages}
            </div>
            <Pagination className="justify-end sm:w-auto">
              <PaginationContent>
                <PaginationItem>
                  <PaginationPrevious
                    onClick={() => setPage((value) => Math.max(1, value - 1))}
                    disabled={page <= 1 || clientsLoading}
                  />
                </PaginationItem>
                {paginationItems.map((item, index) => (
                  <PaginationItem key={`${item}-${index}`}>
                    {item === 'ellipsis' ? (
                      <PaginationEllipsis />
                    ) : (
                      <PaginationButton
                        isActive={item === page}
                        onClick={() => setPage(item)}
                        disabled={clientsLoading}
                      >
                        {item}
                      </PaginationButton>
                    )}
                  </PaginationItem>
                ))}
                <PaginationItem>
                  <PaginationNext
                    onClick={() =>
                      setPage((value) => Math.min(totalPages, value + 1))
                    }
                    disabled={page >= totalPages || clientsLoading}
                  />
                </PaginationItem>
              </PaginationContent>
            </Pagination>
          </div>
        </section>

        <section
          ref={detailsPanelRef}
          className="min-w-0 scroll-mt-14 rounded-md border bg-card lg:min-h-[620px]"
        >
          {detailsError && (
            <div className="border-b border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
              {detailsError}
            </div>
          )}
          {!details && !detailsLoading ? (
            <div className="flex min-h-[360px] flex-col items-center justify-center p-8 text-center lg:min-h-[620px]">
              <Dumbbell className="mb-3 h-8 w-8 text-muted-foreground" />
              <div className="font-medium">
                {detailsError ? 'Клиент не открыт' : 'Выберите клиента'}
              </div>
              <div className="mt-1 max-w-sm text-sm text-muted-foreground">
                {detailsError
                  ? 'Выберите клиента заново или обновите список.'
                  : 'Откроется дневник тренировок, история уровней и форма новой записи.'}
              </div>
            </div>
          ) : detailsLoading && !details ? (
            <div className="flex min-h-[360px] items-center justify-center text-sm text-muted-foreground lg:min-h-[620px]">
              Открываем карточку...
            </div>
          ) : (
            <div className="flex min-h-[360px] flex-col lg:min-h-[620px]">
              <div className="border-b p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-xl font-semibold">
                        {details?.client.name}
                      </h2>
                      {latestNote && <Badge>{latestNote.level}</Badge>}
                      {detailsLoading && (
                        <span className="text-xs text-muted-foreground" role="status">
                          Обновляем...
                        </span>
                      )}
                    </div>
                    <div className="mt-2 grid gap-2 text-sm text-muted-foreground sm:grid-cols-2">
                      <span className="flex items-center gap-1.5">
                        <CalendarDays className="h-4 w-4" />
                        Последний визит: {formatDate(details?.client.stats.lastVisitAt)}
                      </span>
                      <span className="flex items-center gap-1.5">
                        <Target className="h-4 w-4" />
                        Визитов всего: {details?.client.stats.visitCount}
                      </span>
                    </div>
                  </div>
                  <Button type="button" variant="outline" onClick={resetForm}>
                    <Plus className="mr-2 h-4 w-4" />
                    Новая запись
                  </Button>
                </div>
              </div>

              <div className="grid gap-3 border-b p-4 sm:grid-cols-3">
                <MetricCard
                  icon={<History className="h-3.5 w-3.5" />}
                  label="Записей"
                  tooltip="Количество записей в дневнике тренировок выбранного клиента."
                  value={details?.trainingNotes.length || 0}
                />
                <MetricCard
                  icon={<Dumbbell className="h-3.5 w-3.5" />}
                  label="Последний уровень"
                  tooltip="Последний уровень клиента по самой свежей тренировочной записи."
                  value={latestNote?.level || '-'}
                />
                <MetricCard
                  icon={<Target className="h-3.5 w-3.5" />}
                  label="Прогресс"
                  tooltip="Разница между первым и последним уровнем в дневнике. Положительное число означает рост."
                  value={levelDelta || '-'}
                />
              </div>

              {details?.client.status !== 'archived' && (
                <div className="border-b p-4">
                  <TrainingRecommendationPanel
                    clientId={details?.client.id}
                    disabled={saving}
                    onCreatePlan={createPersonalPlanFromRecommendation}
                    onApplyExercises={applyRecommendedExercises}
                  />
                </div>
              )}

              <div className="border-b p-4">
                {trainingPlansError && (
                  <div className="mb-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                    {trainingPlansError}
                  </div>
                )}
                {trainingPlansLoading ? (
                  <div className="rounded-md border py-6 text-center text-sm text-muted-foreground">
                    Загружаем планы тренировок...
                  </div>
                ) : (
                  <TrainingPlanLifecyclePanel
                    disabled={saving || details?.client.status === 'archived'}
                    exercises={methodologyExercises}
                    plans={selectedClientPlans}
                    onReplaceExercise={replacePlanExercises}
                    onStartCompletion={startPlanCompletion}
                  />
                )}
              </div>

              <div className="border-b p-4">
                <ClientSkillMap
                  canEdit={details?.client.status !== 'archived'}
                  disabledReason={
                    details?.client.status === 'archived'
                      ? 'Клиент в архиве, карта навыков доступна только для просмотра.'
                      : undefined
                  }
                  items={details?.skillMap || []}
                  onSave={saveSkillMap}
                />
              </div>

              <form className="border-b p-4" onSubmit={submitTraining}>
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <div className="font-medium">
                      {editingNote
                        ? 'Редактировать запись'
                        : activePlan
                          ? 'Подтвердить факт по плану'
                          : 'Новая completed-тренировка'}
                    </div>
                    <div className="text-sm text-muted-foreground">
                      {activePlan
                        ? 'Заполните реальные оценки и отметки: они обновят дневник и карту навыков.'
                        : 'Дата, уровень и результаты упражнений.'}
                    </div>
                  </div>
                  {(editingNote || activePlan) && (
                    <Button type="button" variant="ghost" onClick={resetForm}>
                      Отменить
                    </Button>
                  )}
                </div>
                <div className="grid gap-3 sm:grid-cols-[150px_120px]">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-muted-foreground">
                      Дата
                    </label>
                    <Input
                      type="date"
                      value={form.trainedAt}
                      onChange={(event) =>
                        setForm({ ...form, trainedAt: event.target.value })
                      }
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-muted-foreground">
                      Уровень
                    </label>
                    <Select
                      value={form.level}
                      onValueChange={(value) =>
                        setForm({ ...form, level: value as TrainingLevel })
                      }
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {TRAINING_LEVELS.map((level) => (
                          <SelectItem key={level} value={level}>
                            {level}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="mt-3">
                  <TrainingNoteExerciseEditor
                    disabled={saving}
                    exercises={methodologyExercises}
                    value={form.exerciseResults}
                    onChange={(exerciseResults) =>
                      setForm({ ...form, exerciseResults })
                    }
                  />
                  {exercisesQuery.isError && (
                    <div className="mt-2 text-sm text-destructive">
                      Не удалось загрузить упражнения методической базы.
                    </div>
                  )}
                </div>
                {editingNote && form.exerciseResults.length === 0 && (
                  <div>
                    <label className="mb-1 block text-xs font-medium text-muted-foreground">
                      Текст упражнений старой записи
                    </label>
                    <Input
                      value={form.legacyExercises}
                      onChange={(event) =>
                        setForm({ ...form, legacyExercises: event.target.value })
                      }
                      placeholder="Например: свечи, выход к сетке, bandeja"
                    />
                  </div>
                )}
                <div className="mt-3">
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">
                    Общая заметка
                  </label>
                  <textarea
                    value={form.note}
                    onChange={(event) =>
                      setForm({ ...form, note: event.target.value })
                    }
                    className="min-h-[96px] w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    placeholder="Что получилось, что закрепить, что сделать в следующий раз"
                  />
                </div>
                <Button type="submit" className="mt-3" disabled={saving}>
                  <Save className="mr-2 h-4 w-4" />
                  {saving
                    ? 'Сохраняем...'
                    : activePlan
                      ? 'Подтвердить факт'
                      : editingNote
                        ? 'Сохранить'
                        : 'Добавить completed'}
                </Button>
              </form>

              <div className="flex-1 p-4">
                <div className="mb-3 flex items-center gap-1.5">
                  <div className="font-medium">Completed: история прогресса</div>
                  <HelpTooltip>
                    Записи отсортированы от новых к старым. Цветной бейдж
                    показывает уровень клиента на дату тренировки.
                  </HelpTooltip>
                </div>

                {details?.trainingNotes.length === 0 ? (
                  <div className="rounded-md border border-dashed py-10 text-center text-sm text-muted-foreground">
                    Дневник тренировок пока пуст.
                  </div>
                ) : (
                  <div className="divide-y rounded-md border">
                    {details?.trainingNotes.map((note) => (
                      <article key={note.id} className="p-3">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <Badge>{note.level}</Badge>
                              <span className="font-medium">
                                {formatDate(note.trainedAt)}
                              </span>
                              <span className="text-sm text-muted-foreground">
                                {note.trainer?.name || 'Тренер'}
                              </span>
                            </div>
                            {note.exerciseResults?.length > 0 ? (
                              <TrainingNoteExerciseList results={note.exerciseResults} />
                            ) : note.exercises ? (
                              <div className="mt-2 text-sm">
                                <span className="text-muted-foreground">
                                  Упражнения:{' '}
                                </span>
                                {note.exercises}
                              </div>
                            ) : null}
                            {note.note && (
                              <div className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">
                                {note.note}
                              </div>
                            )}
                          </div>
                          {canChangeNote(note) && (
                            <div className="flex shrink-0 gap-2">
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => startEdit(note)}
                              >
                                <Pencil className="mr-2 h-4 w-4" />
                                Изменить
                              </Button>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => deleteNote(note)}
                              >
                                <Trash2 className="mr-2 h-4 w-4" />
                                Удалить
                              </Button>
                            </div>
                          )}
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </section>
      </div>

      <ConfirmActionDialog
        action={pendingAction}
        loading={pendingActionLoading}
        onCancel={() => setPendingAction(null)}
        onConfirm={confirmPendingAction}
      />
    </div>
  );
}
