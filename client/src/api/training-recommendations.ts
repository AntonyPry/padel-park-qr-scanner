import { apiRequest } from '@/lib/api';
import type {
  TrainingExerciseELevel,
  TrainingExerciseFormat,
  TrainingSkillSummary,
} from '@/lib/methodology';

export interface TrainingRecommendationExercise {
  eLevel?: TrainingExerciseELevel | null;
  formats: TrainingExerciseFormat[];
  id: number;
  mainSkill?: TrainingSkillSummary | null;
  name: string;
  successCriterion: string;
}

export interface TrainingRecommendationReason {
  adjustment: string;
  antiRepeat: string;
  eLevel: string;
  skill: string;
}

export interface TrainingRecommendationBlock {
  exercise?: TrainingRecommendationExercise | null;
  insertable: boolean;
  isFallback: boolean;
  key: string;
  reason: TrainingRecommendationReason;
  skill?: TrainingSkillSummary | null;
  skillId?: number | null;
  targetELevel?: TrainingExerciseELevel | null;
  title: string;
}

export interface TrainingRecommendationPrioritySkill {
  daysSinceLast?: number | null;
  eLevelCorridor: TrainingExerciseELevel[];
  latestRating?: number | null;
  level: number;
  loweredReason?: string | null;
  priorityScore: number;
  reasons: string[];
  repeatFlag: boolean;
  skill?: TrainingSkillSummary | null;
  skillId: number;
  targetELevel?: TrainingExerciseELevel | null;
}

export interface TrainingRecommendation {
  asOfDate: string;
  blocks: TrainingRecommendationBlock[];
  clientId: number;
  clientStatus?: string;
  generatedAt: string;
  goal: string;
  prioritySkills: TrainingRecommendationPrioritySkill[];
  summary: {
    approvedExercisesCount: number;
    fallbackBlocks: number;
    historyDepth: number;
    latestTrainingLevel?: string | null;
    littleHistory: boolean;
    recentExerciseIds: number[];
    selectedExerciseIds: number[];
  };
}

export interface GroupTrainingRecommendationParticipant {
  clientId: number;
  historyDepth: number;
  latestTrainingLevel?: string | null;
  name: string;
  status?: string;
}

export interface GroupTrainingRecommendationParticipantStat {
  clientId: number;
  clientName: string;
  daysSinceLast?: number | null;
  latestRating?: number | null;
  level: number;
  priorityScore: number;
  relevant: boolean;
  repeatFlag: boolean;
}

export interface GroupTrainingRecommendationFocusNote {
  clientId: number;
  clientName: string;
  daysSinceLast?: number | null;
  focus: string;
  latestRating?: number | null;
  level: number;
  role: 'weak' | 'advanced' | 'core';
}

export interface GroupTrainingRecommendationSkillComparison {
  advancedParticipants: GroupTrainingRecommendationParticipantStat[];
  averageLevel: number;
  eLevelCorridor: TrainingExerciseELevel[];
  levelSpread: number;
  majorityRelevant: boolean;
  maxLevel: number;
  minLevel: number;
  participantCount: number;
  participants: GroupTrainingRecommendationParticipantStat[];
  priorityScore: number;
  reasons: string[];
  relevantCount: number;
  skill?: TrainingSkillSummary | null;
  skillId: number;
  staleCount: number;
  staleMajority: boolean;
  targetELevel?: TrainingExerciseELevel | null;
  targetLevel: number;
  warning?: string | null;
  weakParticipants: GroupTrainingRecommendationParticipantStat[];
}

export interface GroupTrainingRecommendationExercise
  extends TrainingRecommendationExercise {
  complication: string;
  description: string;
  simplification: string;
}

export interface GroupTrainingRecommendationBlock {
  advancedParticipants: GroupTrainingRecommendationParticipantStat[];
  commonVersion: string;
  exercise?: GroupTrainingRecommendationExercise | null;
  focusNotes: GroupTrainingRecommendationFocusNote[];
  insertable: boolean;
  isFallback: boolean;
  key: string;
  reason: {
    antiRepeat: string;
    level: string;
    skill: string;
    variations: string;
  };
  skill?: TrainingSkillSummary | null;
  skillId?: number | null;
  skillStats?: {
    averageLevel: number;
    levelSpread: number;
    maxLevel: number;
    minLevel: number;
    relevantCount: number;
    staleCount: number;
    staleMajority: boolean;
  } | null;
  targetELevel?: TrainingExerciseELevel | null;
  title: string;
  warning?: string | null;
  weakParticipants: GroupTrainingRecommendationParticipantStat[];
}

export interface GroupTrainingRecommendation {
  asOfDate: string;
  blocks: GroupTrainingRecommendationBlock[];
  clientIds: number[];
  generatedAt: string;
  goal: string;
  participants: GroupTrainingRecommendationParticipant[];
  prioritySkills: GroupTrainingRecommendationSkillComparison[];
  summary: {
    approvedExercisesCount: number;
    fallbackBlocks: number;
    majorityCount: number;
    participantCount: number;
    recentExerciseIds: number[];
    selectedExerciseIds: number[];
    warningSkillsCount: number;
  };
  warnings: Array<{
    skill?: TrainingSkillSummary | null;
    skillId: number;
    text?: string | null;
  }>;
}

function appendOptionalParam(
  params: URLSearchParams,
  key: string,
  value: string | null | undefined,
) {
  const normalized = String(value || '').trim();
  if (!normalized) return;
  params.set(key, normalized);
}

export function getTrainingRecommendation(
  clientId: number,
  params: { date?: string; goal?: string } = {},
) {
  const searchParams = new URLSearchParams();
  appendOptionalParam(searchParams, 'date', params.date);
  appendOptionalParam(searchParams, 'goal', params.goal);
  const query = searchParams.toString();

  return apiRequest<TrainingRecommendation>(
    `/api/clients/${clientId}/training-recommendation${query ? `?${query}` : ''}`,
    {},
    'Не удалось рекомендовать тренировку',
  );
}

export function getGroupTrainingRecommendation(params: {
  clientIds: number[];
  date?: string;
  goal?: string;
}) {
  return apiRequest<GroupTrainingRecommendation>(
    '/api/clients/training-recommendation/group',
    {
      method: 'POST',
      body: JSON.stringify(params),
    },
    'Не удалось рекомендовать групповую тренировку',
  );
}
