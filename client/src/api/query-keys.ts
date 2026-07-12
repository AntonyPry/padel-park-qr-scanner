import type { AuditAction } from '@/api/audit';
import type {
  MethodologyExerciseFilters,
  MethodologySkillFilters,
} from '@/api/methodology';
import type { MethodologyAnalyticsFilters } from '@/api/methodology-analytics';
import type { ReferenceStatus, ReferenceType } from '@/lib/references';

export const queryKeys = {
  audit: {
    all: ['audit'] as const,
    list: (params: { action: AuditAction; page: number; pageSize: number }) =>
      [...queryKeys.audit.all, 'list', params] as const,
  },
  bookings: {
    all: ['bookings'] as const,
    analytics: (params: { from: string; to: string }) =>
      [...queryKeys.bookings.all, 'analytics', params] as const,
    blocks: (date: string) => [...queryKeys.bookings.all, 'blocks', date] as const,
    exceptions: () => [...queryKeys.bookings.all, 'exceptions'] as const,
    history: (id: number | null) => [...queryKeys.bookings.all, 'history', id] as const,
    priceRules: () => [...queryKeys.bookings.all, 'price-rules'] as const,
    responsibles: () => [...queryKeys.bookings.all, 'responsibles'] as const,
    resources: () => [...queryKeys.bookings.all, 'resources'] as const,
    schedule: (date: string) => [...queryKeys.bookings.all, 'schedule', date] as const,
    series: () => [...queryKeys.bookings.all, 'series'] as const,
    settings: () => [...queryKeys.bookings.all, 'settings'] as const,
  },
  clients: {
    all: ['clients'] as const,
    detail: (clientId: number | null) =>
      [...queryKeys.clients.all, 'detail', clientId] as const,
    list: (params: Record<string, unknown>) =>
      [...queryKeys.clients.all, 'list', params] as const,
    trainingRecommendation: (
      clientId: number | null,
      params: { date?: string; goal?: string },
    ) => [...queryKeys.clients.all, 'training-recommendation', clientId, params] as const,
  },
  methodology: {
    all: ['methodology'] as const,
    analytics: (params: MethodologyAnalyticsFilters) =>
      [...queryKeys.methodology.all, 'analytics', params] as const,
    exercises: (params: MethodologyExerciseFilters) =>
      [...queryKeys.methodology.all, 'exercises', params] as const,
    skills: (params: MethodologySkillFilters) =>
      [...queryKeys.methodology.all, 'skills', params] as const,
  },
  onboarding: {
    all: ['onboarding'] as const,
    detail: (role?: string | null) =>
      [...queryKeys.onboarding.all, 'detail', role || 'current'] as const,
    task: (taskKey: string, role?: string | null) =>
      [...queryKeys.onboarding.all, 'task', role || 'current', taskKey] as const,
    metrics: () => [...queryKeys.onboarding.all, 'metrics'] as const,
    trainingData: (role?: string | null) =>
      [...queryKeys.onboarding.all, 'training-data', role || 'all'] as const,
    trainingMode: () => [...queryKeys.onboarding.all, 'training-mode'] as const,
  },
  references: {
    all: ['references'] as const,
    list: (type: ReferenceType, status: ReferenceStatus | 'all') =>
      [...queryKeys.references.all, 'list', type, status] as const,
  },
  shiftReports: {
    all: ['shiftReports'] as const,
    active: () => [...queryKeys.shiftReports.all, 'active'] as const,
    list: (params: Record<string, unknown>) =>
      [...queryKeys.shiftReports.all, 'list', params] as const,
    templates: (status: string) =>
      [...queryKeys.shiftReports.all, 'templates', status] as const,
  },
  telephony: {
    all: ['telephony'] as const,
    call: (id: number | null) => [...queryKeys.telephony.all, 'call', id] as const,
    calls: (params: Record<string, unknown>) =>
      [...queryKeys.telephony.all, 'calls', params] as const,
    config: () => [...queryKeys.telephony.all, 'config'] as const,
    rawEvents: (params: Record<string, unknown>) =>
      [...queryKeys.telephony.all, 'raw-events', params] as const,
    report: (params: Record<string, unknown>) =>
      [...queryKeys.telephony.all, 'report', params] as const,
    stats: () => [...queryKeys.telephony.all, 'stats'] as const,
    transcriptionJob: (id: number | null) =>
      [...queryKeys.telephony.all, 'transcription-job', id] as const,
    transcriptionJobs: (params: Record<string, unknown>) =>
      [...queryKeys.telephony.all, 'transcription-jobs', params] as const,
    transcriptionStats: () => [...queryKeys.telephony.all, 'transcription-stats'] as const,
  },
  trainingPlans: {
    all: ['training-plans'] as const,
    detail: (planId: number | null) =>
      [...queryKeys.trainingPlans.all, 'detail', planId] as const,
    list: (params: Record<string, unknown>) =>
      [...queryKeys.trainingPlans.all, 'list', params] as const,
  },
  utilization: {
    all: ['utilization'] as const,
    list: () => [...queryKeys.utilization.all, 'list'] as const,
  },
  visitsAnalytics: {
    all: ['visits-analytics'] as const,
    detail: (params: { from: string; to: string }) =>
      [...queryKeys.visitsAnalytics.all, params] as const,
    sourceQuality: (params: { from: string; to: string; sources?: number[] }) =>
      [...queryKeys.visitsAnalytics.all, 'source-quality', params] as const,
  },
};
