import { apiRequest } from '@/lib/api';
import type {
  TrainingExercise,
  TrainingExerciseELevel,
  TrainingExerciseFormat,
  TrainingExerciseStatus,
  TrainingSkill,
  TrainingSkillDirection,
  TrainingSkillStatus,
} from '@/lib/methodology';

export interface MethodologySkillFilters {
  direction?: TrainingSkillDirection | 'all';
  q?: string;
  status?: TrainingSkillStatus | 'all';
}

export interface MethodologyExerciseFilters {
  direction?: TrainingSkillDirection | 'all';
  eLevel?: TrainingExerciseELevel | 'all';
  format?: TrainingExerciseFormat | 'all';
  mainSkillId?: number | null;
  q?: string;
  skillId?: number | null;
  skillLevel?: number | null;
  status?: TrainingExerciseStatus | 'all';
}

export interface MethodologySkillPayload {
  description?: string | null;
  direction: TrainingSkillDirection;
  name: string;
  status?: TrainingSkillStatus;
}

export interface MethodologyExercisePayload {
  additionalSkillIds?: number[];
  complication?: string | null;
  description?: string | null;
  eLevel?: TrainingExerciseELevel | null;
  formats?: TrainingExerciseFormat[];
  mainSkillId?: number | null;
  name: string;
  simplification?: string | null;
  skillLevelMax?: number | null;
  skillLevelMin?: number | null;
  status?: TrainingExerciseStatus;
  successCriterion?: string | null;
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

export function listMethodologySkills(filters: MethodologySkillFilters = {}) {
  const params = new URLSearchParams();
  appendOptionalParam(params, 'direction', filters.direction);
  appendOptionalParam(params, 'q', filters.q?.trim());
  appendOptionalParam(params, 'status', filters.status || 'active');

  return apiRequest<TrainingSkill[]>(
    `/api/methodology/skills${queryString(params)}`,
    {},
    'Не удалось загрузить навыки',
  );
}

export function createMethodologySkill(payload: MethodologySkillPayload) {
  return apiRequest<TrainingSkill>(
    '/api/methodology/skills',
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
    'Не удалось сохранить навык',
  );
}

export function updateMethodologySkill(
  id: number,
  payload: Partial<MethodologySkillPayload>,
) {
  return apiRequest<TrainingSkill>(
    `/api/methodology/skills/${id}`,
    {
      method: 'PUT',
      body: JSON.stringify(payload),
    },
    'Не удалось сохранить навык',
  );
}

export function listMethodologyExercises(
  filters: MethodologyExerciseFilters = {},
) {
  const params = new URLSearchParams();
  appendOptionalParam(params, 'direction', filters.direction);
  appendOptionalParam(params, 'eLevel', filters.eLevel);
  appendOptionalParam(params, 'format', filters.format);
  appendOptionalParam(params, 'mainSkillId', filters.mainSkillId);
  appendOptionalParam(params, 'q', filters.q?.trim());
  appendOptionalParam(params, 'skillId', filters.skillId);
  appendOptionalParam(params, 'skillLevel', filters.skillLevel);
  appendOptionalParam(params, 'status', filters.status || 'all');

  return apiRequest<TrainingExercise[]>(
    `/api/methodology/exercises${queryString(params)}`,
    {},
    'Не удалось загрузить упражнения',
  );
}

export function createMethodologyExercise(payload: MethodologyExercisePayload) {
  return apiRequest<TrainingExercise>(
    '/api/methodology/exercises',
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
    'Не удалось сохранить упражнение',
  );
}

export function updateMethodologyExercise(
  id: number,
  payload: Partial<MethodologyExercisePayload>,
) {
  return apiRequest<TrainingExercise>(
    `/api/methodology/exercises/${id}`,
    {
      method: 'PUT',
      body: JSON.stringify(payload),
    },
    'Не удалось сохранить упражнение',
  );
}

export function approveMethodologyExercise(id: number) {
  return apiRequest<TrainingExercise>(
    `/api/methodology/exercises/${id}/approve`,
    { method: 'POST' },
    'Не удалось утвердить упражнение',
  );
}

export function archiveMethodologyExercise(id: number) {
  return apiRequest<TrainingExercise>(
    `/api/methodology/exercises/${id}/archive`,
    { method: 'POST' },
    'Не удалось архивировать упражнение',
  );
}

export function restoreMethodologyExercise(id: number) {
  return apiRequest<TrainingExercise>(
    `/api/methodology/exercises/${id}/restore`,
    { method: 'POST' },
    'Не удалось восстановить упражнение',
  );
}
