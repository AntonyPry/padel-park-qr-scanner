import { apiRequest } from '@/lib/api';
import type { TrainingNoteExercisePayload } from '@/lib/training-note-exercises';

export type TrainingPlanKind = 'personal' | 'group';
export type TrainingPlanStatus = 'planned' | 'completed';
export type TrainingPlanSourceType =
  | 'manual'
  | 'personal_recommendation'
  | 'group_recommendation';

export interface TrainingPlanExercisePayload {
  blockKey?: string | null;
  blockTitle?: string | null;
  reasonSnapshot?: unknown;
  trainingExerciseId: number;
}

export interface TrainingPlanExercise {
  blockKey?: string | null;
  blockTitle: string;
  exercise?: {
    eLevel?: string | null;
    id?: number | null;
    mainSkill?: {
      direction?: string | null;
      id: number;
      name: string;
    } | null;
    name: string;
    status?: string | null;
  } | null;
  exerciseName: string;
  id: number;
  orderIndex: number;
  reasonSnapshot: string;
  trainingExerciseId: number;
}

export interface TrainingPlanParticipant {
  client?: {
    id: number;
    name: string;
    status: string;
  } | null;
  clientId: number;
  id: number;
  trainingNote?: {
    id: number;
    level: string;
    trainedAt: string;
  } | null;
  trainingNoteId?: number | null;
}

export interface TrainingPlan {
  booking?: {
    bookingSeriesId?: number | null;
    bookingType: string;
    court?: {
      id: number;
      name: string;
      type?: string;
    } | null;
    courtId?: number | null;
    endsAt: string;
    id: number;
    responsibleStaff?: {
      id: number;
      name: string;
      position?: string | null;
    } | null;
    startsAt: string;
    status: string;
  } | null;
  bookingId?: number | null;
  completedAt?: string | null;
  createdAt: string;
  goal: string;
  id: number;
  kind: TrainingPlanKind;
  notes: string;
  participants: TrainingPlanParticipant[];
  plannedAt: string;
  plannedExercises: TrainingPlanExercise[];
  sourceSnapshot?: unknown;
  sourceType: TrainingPlanSourceType;
  status: TrainingPlanStatus;
  trainer?: {
    id: number;
    name: string;
    role?: string;
  } | null;
  updatedAt: string;
}

export interface TrainingPlanPayload {
  clientIds: number[];
  goal?: string | null;
  kind: TrainingPlanKind;
  notes?: string | null;
  plannedAt?: string;
  plannedExercises: TrainingPlanExercisePayload[];
  sourceSnapshot?: unknown;
  sourceType?: TrainingPlanSourceType;
}

export interface TrainingPlanCompletionPayload {
  exerciseResults?: TrainingNoteExercisePayload[];
  level?: string;
  note?: string | null;
  participantResults?: Array<{
    clientId: number;
    exerciseResults?: TrainingNoteExercisePayload[];
    level?: string;
    note?: string | null;
    trainedAt?: string;
  }>;
  trainedAt?: string;
}

function appendOptionalParam(
  params: URLSearchParams,
  key: string,
  value: string | number | null | undefined,
) {
  if (value === undefined || value === null || value === '' || value === 'all') {
    return;
  }
  params.set(key, String(value));
}

function queryString(params: URLSearchParams) {
  const value = params.toString();
  return value ? `?${value}` : '';
}

export function listTrainingPlans(filters: {
  bookingId?: number | null;
  clientId?: number | null;
  from?: string | null;
  status?: TrainingPlanStatus | 'all';
  to?: string | null;
} = {}) {
  const params = new URLSearchParams();
  appendOptionalParam(params, 'bookingId', filters.bookingId);
  appendOptionalParam(params, 'clientId', filters.clientId);
  appendOptionalParam(params, 'from', filters.from);
  appendOptionalParam(params, 'status', filters.status || 'all');
  appendOptionalParam(params, 'to', filters.to);

  return apiRequest<TrainingPlan[]>(
    `/api/training-plans${queryString(params)}`,
    {},
    'Не удалось загрузить планы тренировок',
  );
}

export function getTrainingPlan(planId: number) {
  return apiRequest<TrainingPlan>(
    `/api/training-plans/${planId}`,
    {},
    'Не удалось загрузить план тренировки',
  );
}

export function createTrainingPlan(payload: TrainingPlanPayload) {
  return apiRequest<TrainingPlan>(
    '/api/training-plans',
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
    'Не удалось создать план тренировки',
  );
}

export function updateTrainingPlanExercises(
  planId: number,
  plannedExercises: TrainingPlanExercisePayload[],
) {
  return apiRequest<TrainingPlan>(
    `/api/training-plans/${planId}/exercises`,
    {
      method: 'PUT',
      body: JSON.stringify({ plannedExercises }),
    },
    'Не удалось заменить упражнение в плане',
  );
}

export function completeTrainingPlan(
  planId: number,
  payload: TrainingPlanCompletionPayload,
) {
  return apiRequest<TrainingPlan>(
    `/api/training-plans/${planId}/complete`,
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
    'Не удалось подтвердить тренировку',
  );
}

export function quickCompleteTrainingPlan(
  planId: number,
  payload: { note?: string | null; trainedAt?: string } = {},
) {
  return apiRequest<TrainingPlan>(
    `/api/training-plans/${planId}/quick-complete`,
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
    'Не удалось быстро закрыть план тренировки',
  );
}
