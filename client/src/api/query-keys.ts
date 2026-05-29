import type { AuditAction } from '@/api/audit';
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
    schedule: (date: string) => [...queryKeys.bookings.all, 'schedule', date] as const,
    series: () => [...queryKeys.bookings.all, 'series'] as const,
    settings: () => [...queryKeys.bookings.all, 'settings'] as const,
  },
  references: {
    all: ['references'] as const,
    list: (type: ReferenceType, status: ReferenceStatus | 'all') =>
      [...queryKeys.references.all, 'list', type, status] as const,
  },
  telephony: {
    all: ['telephony'] as const,
    calls: (params: Record<string, unknown>) =>
      [...queryKeys.telephony.all, 'calls', params] as const,
    config: () => [...queryKeys.telephony.all, 'config'] as const,
    rawEvents: (params: Record<string, unknown>) =>
      [...queryKeys.telephony.all, 'raw-events', params] as const,
    stats: () => [...queryKeys.telephony.all, 'stats'] as const,
  },
  utilization: {
    all: ['utilization'] as const,
    list: () => [...queryKeys.utilization.all, 'list'] as const,
  },
  visitsAnalytics: {
    all: ['visits-analytics'] as const,
    detail: (params: { from: string; to: string }) =>
      [...queryKeys.visitsAnalytics.all, params] as const,
  },
};
