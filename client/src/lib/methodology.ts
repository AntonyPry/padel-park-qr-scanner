export type TrainingSkillDirection =
  | 'technique'
  | 'tactics'
  | 'game_situations'
  | 'pair_interaction'
  | 'physical_coordination';

export type TrainingSkillStatus = 'active' | 'archived';
export type TrainingExerciseStatus = 'draft' | 'approved' | 'archived';
export type TrainingExerciseELevel = 'E1' | 'E2' | 'E3' | 'E4' | 'E5' | 'E6' | 'E7';
export type TrainingExerciseFormat = 'personal' | 'pair' | 'group' | 'game';

export const TRAINING_SKILL_DIRECTIONS: Array<{
  label: string;
  value: TrainingSkillDirection;
}> = [
  { label: 'Техника', value: 'technique' },
  { label: 'Тактика', value: 'tactics' },
  { label: 'Игровые ситуации', value: 'game_situations' },
  { label: 'Парное взаимодействие', value: 'pair_interaction' },
  { label: 'Физика/координация', value: 'physical_coordination' },
];

export const TRAINING_EXERCISE_E_LEVELS: TrainingExerciseELevel[] = [
  'E1',
  'E2',
  'E3',
  'E4',
  'E5',
  'E6',
  'E7',
];

export const TRAINING_EXERCISE_FORMATS: Array<{
  label: string;
  value: TrainingExerciseFormat;
}> = [
  { label: 'Персонально', value: 'personal' },
  { label: 'Пара', value: 'pair' },
  { label: 'Группа', value: 'group' },
  { label: 'Игра', value: 'game' },
];

export interface MethodologyAccount {
  email?: string | null;
  id: number;
  name?: string | null;
  role?: string | null;
}

export interface TrainingSkillSummary {
  description: string;
  direction: TrainingSkillDirection;
  id: number;
  name: string;
  status: TrainingSkillStatus;
}

export interface TrainingSkill extends TrainingSkillSummary {
  createdAt: string;
  createdBy?: MethodologyAccount | null;
  updatedAt: string;
  updatedBy?: MethodologyAccount | null;
}

export interface TrainingExercise {
  additionalSkillIds: number[];
  additionalSkills: TrainingSkillSummary[];
  approvedAt?: string | null;
  approvedBy?: MethodologyAccount | null;
  complication: string;
  createdAt: string;
  createdBy?: MethodologyAccount | null;
  description: string;
  eLevel?: TrainingExerciseELevel | null;
  formats: TrainingExerciseFormat[];
  id: number;
  mainSkill?: TrainingSkillSummary | null;
  mainSkillId?: number | null;
  name: string;
  simplification: string;
  skillLevelMax?: number | null;
  skillLevelMin?: number | null;
  status: TrainingExerciseStatus;
  successCriterion: string;
  updatedAt: string;
  updatedBy?: MethodologyAccount | null;
}

export function getSkillDirectionLabel(direction?: string | null) {
  return (
    TRAINING_SKILL_DIRECTIONS.find((item) => item.value === direction)?.label ||
    direction ||
    '-'
  );
}

export function getExerciseFormatLabel(format?: string | null) {
  return (
    TRAINING_EXERCISE_FORMATS.find((item) => item.value === format)?.label ||
    format ||
    '-'
  );
}

export function getSkillLevelRangeLabel(
  min?: number | null,
  max?: number | null,
) {
  if (min === null || min === undefined || max === null || max === undefined) {
    return '-';
  }
  if (min === max) return String(min);
  return `${min}-${max}`;
}

export function getExerciseStatusLabel(status: TrainingExerciseStatus) {
  if (status === 'approved') return 'Утверждено';
  if (status === 'archived') return 'Архив';
  return 'Черновик';
}

export function getSkillStatusLabel(status: TrainingSkillStatus) {
  return status === 'active' ? 'Активен' : 'Архив';
}
