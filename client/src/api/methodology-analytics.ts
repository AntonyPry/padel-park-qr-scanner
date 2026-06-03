import { apiRequest } from '@/lib/api';
import type {
  TrainingExerciseELevel,
  TrainingExerciseFormat,
  TrainingSkillDirection,
} from '@/lib/methodology';

export interface MethodologyAnalyticsFilters {
  from: string;
  to: string;
  trainerAccountId?: number | null;
}

export interface MethodologyAnalyticsAccount {
  email?: string | null;
  id: number;
  name?: string | null;
  role?: string | null;
}

export interface MethodologyAnalyticsSkill {
  direction?: TrainingSkillDirection | null;
  id: number;
  name: string;
  status?: string | null;
}

export interface MethodologyExerciseUsage {
  averageRating?: number | null;
  eLevel?: TrainingExerciseELevel | null;
  exerciseId: number;
  formats: TrainingExerciseFormat[];
  lastUsedAt?: string | null;
  lowRatingCount: number;
  mainSkill?: MethodologyAnalyticsSkill | null;
  name: string;
  usageCount: number;
}

export interface WeakMethodologySkill {
  affectedClients: number;
  advancedCount: number;
  averageRating?: number | null;
  blockedCount: number;
  direction?: TrainingSkillDirection | null;
  eventsCount: number;
  lowRatingCount: number;
  noProgressCount: number;
  repeatCount: number;
  skillId: number;
  skillName: string;
  weaknessScore: number;
}

export interface MethodologyAnalyticsClient {
  id: number;
  name: string;
  status?: string | null;
}

export interface ClientWithoutProgress {
  advancedCount: number;
  client?: MethodologyAnalyticsClient | null;
  latestTrainingAt?: string | null;
  lowRatingCount: number;
  noProgressEvents: number;
  repeatEvents: number;
  structuredTrainings: number;
  userId: number;
}

export interface StuckLevelClient {
  client?: MethodologyAnalyticsClient | null;
  currentLevel: string;
  daysAtLevel: number;
  latestTrainingAt: string;
  sameLevelSince: string;
  sameLevelTrainings: number;
  userId: number;
}

export interface MonotonousTrainer {
  advancedHistoryEvents: number;
  exerciseRepeatPercent: number;
  explicitRepeatPercent: number;
  flags: string[];
  gameFormatPercent: number;
  highELevelPercent: number;
  monotonyScore: number;
  noProgressPercent: number;
  noteCount: number;
  resultCount: number;
  trainer: MethodologyAnalyticsAccount;
  uniqueExercises: number;
  uniqueSkills: number;
}

export interface TrainerRecommendationAdherence {
  averageAdherencePercent: number;
  deviatedPlans: number;
  followedPlans: number;
  partialPlans: number;
  recommendationPlans: number;
  trainer?: MethodologyAnalyticsAccount | null;
}

export interface RecommendationDeviationExample {
  adherencePercent: number;
  actualExerciseCount: number;
  extraCount: number;
  missingCount: number;
  planId: number;
  plannedAt?: string | null;
  plannedExerciseCount: number;
  sourceType?: string | null;
  trainer?: MethodologyAnalyticsAccount | null;
}

export interface LowApprovedSkillCoverage {
  approvedExerciseCount: number;
  direction?: TrainingSkillDirection | null;
  gameFormatCount: number;
  highELevelCount: number;
  skillId: number;
  skillName: string;
}

export interface MethodologyAnalyticsSummary {
  activeSkills: number;
  approvedExercises: number;
  lowData: boolean;
  recommendationPlans: number;
  structuredResults: number;
  structuredTrainingNotes: number;
  trainersWithTraining: number;
  trainingNotes: number;
}

export interface MethodologyAnalyticsEmptyStates {
  recommendations?: string | null;
  structuredTraining?: string | null;
  trainingNotes?: string | null;
}

export interface MethodologyAnalytics {
  clientsWithoutProgress: ClientWithoutProgress[];
  emptyStates: MethodologyAnalyticsEmptyStates;
  filters: MethodologyAnalyticsFilters;
  frequentExercises: MethodologyExerciseUsage[];
  lowApprovedSkillCoverage: LowApprovedSkillCoverage[];
  monotonousTrainers: MonotonousTrainer[];
  rarelyUsedExercises: MethodologyExerciseUsage[];
  recommendationDeviationExamples: RecommendationDeviationExample[];
  stuckLevelClients: StuckLevelClient[];
  summary: MethodologyAnalyticsSummary;
  trainerRecommendationAdherence: TrainerRecommendationAdherence[];
  trainers: MethodologyAnalyticsAccount[];
  weakSkills: WeakMethodologySkill[];
}

export function getMethodologyAnalytics(filters: MethodologyAnalyticsFilters) {
  const query = new URLSearchParams({
    from: filters.from,
    to: filters.to,
  });
  if (filters.trainerAccountId) {
    query.set('trainerAccountId', String(filters.trainerAccountId));
  }

  return apiRequest<MethodologyAnalytics>(
    `/api/methodology/analytics?${query.toString()}`,
    {},
    'Не удалось загрузить аналитику методики',
  );
}
