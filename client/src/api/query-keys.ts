import type { AuditAction } from '@/api/audit';
import type {
  MethodologyExerciseFilters,
  MethodologySkillFilters,
} from '@/api/methodology';
import type { MethodologyAnalyticsFilters } from '@/api/methodology-analytics';
import {
  getActiveTenantContext,
  isTenantCacheRealtimeCapabilityEnabled,
  type ActiveTenantContext,
} from '@/lib/tenant-context';
import type { ReferenceStatus, ReferenceType } from '@/lib/references';

export type TenantQueryScope = 'global' | 'membership' | 'organization' | 'club';
export type TenantQueryKey = readonly unknown[];

export interface TenantQueryAuthority {
  context: ActiveTenantContext | null;
  enabled: boolean;
}

export const TENANT_QUERY_DOMAINS = new Set([
  'access',
  'accounts',
  'audit',
  'bookings',
  'callTasks',
  'catalog',
  'certificates',
  'clientBases',
  'clientSubscriptions',
  'clients',
  'corporateClients',
  'finance',
  'manager-control-dashboard',
  'methodology',
  'motivation',
  'onboarding',
  'payroll',
  'prepayments',
  'references',
  'reports',
  'shiftCash',
  'shiftReports',
  'shifts',
  'staff',
  'subscriptionTypes',
  'telephony',
  'trainingNotes',
  'training-plans',
  'utilization',
  'visits-analytics',
]);

function requireContext(authority: TenantQueryAuthority) {
  if (authority.context) return authority.context;
  throw new Error('Tenant query key requested before tenant context is ready');
}

export function createTenantQueryKey(
  authority: TenantQueryAuthority,
  scope: TenantQueryScope,
  domain: string,
  ...parts: readonly unknown[]
): TenantQueryKey {
  if (scope === 'global' || !authority.enabled) return [domain, ...parts] as const;

  const context = requireContext(authority);
  if (scope === 'organization') {
    return ['tenant', context.organizationId, 'org', domain, ...parts] as const;
  }
  if (scope === 'membership') {
    return [
      'tenant',
      context.organizationId,
      'membership',
      context.membershipId,
      domain,
      ...parts,
    ] as const;
  }
  return [
    'tenant',
    context.organizationId,
    context.clubId,
    domain,
    ...parts,
  ] as const;
}

export function isTenantQueryReady(authority: TenantQueryAuthority) {
  return !authority.enabled || authority.context !== null;
}

function currentAuthority(): TenantQueryAuthority {
  return {
    context: getActiveTenantContext(),
    enabled: isTenantCacheRealtimeCapabilityEnabled(),
  };
}

function key(scope: TenantQueryScope, domain: string, ...parts: readonly unknown[]) {
  return createTenantQueryKey(currentAuthority(), scope, domain, ...parts);
}

function domainKeys(scope: TenantQueryScope, domain: string) {
  return {
    get all() {
      return key(scope, domain);
    },
  };
}

export const queryKeys = {
  access: domainKeys('club', 'access'),
  accounts: domainKeys('organization', 'accounts'),
  audit: {
    get all() {
      return key('organization', 'audit');
    },
    list: (params: { action: AuditAction; page: number; pageSize: number }) =>
      key('organization', 'audit', 'list', params),
  },
  bookings: {
    get all() {
      return key('club', 'bookings');
    },
    analytics: (params: { from: string; to: string }) =>
      key('club', 'bookings', 'analytics', params),
    blocks: (date: string) => key('club', 'bookings', 'blocks', date),
    exceptions: () => key('club', 'bookings', 'exceptions'),
    history: (id: number | null) => key('club', 'bookings', 'history', id),
    priceRules: () => key('club', 'bookings', 'price-rules'),
    responsibles: () => key('club', 'bookings', 'responsibles'),
    resources: () => key('club', 'bookings', 'resources'),
    schedule: (date: string) => key('club', 'bookings', 'schedule', date),
    series: () => key('club', 'bookings', 'series'),
    settings: () => key('club', 'bookings', 'settings'),
  },
  callTasks: domainKeys('club', 'callTasks'),
  catalog: {
    get club() {
      return key('club', 'catalog');
    },
    get organization() {
      return key('organization', 'catalog');
    },
  },
  certificates: domainKeys('club', 'certificates'),
  clientBases: domainKeys('club', 'clientBases'),
  clientSubscriptions: domainKeys('club', 'clientSubscriptions'),
  clients: {
    get all() {
      return key('organization', 'clients');
    },
    detail: (clientId: number | null) =>
      key('club', 'clients', 'detail', clientId),
    list: (params: Record<string, unknown>) =>
      key('organization', 'clients', 'list', params),
    trainingRecommendation: (
      clientId: number | null,
      params: { date?: string; goal?: string },
    ) => key('club', 'clients', 'training-recommendation', clientId, params),
  },
  corporateClients: {
    get club() {
      return key('club', 'corporateClients');
    },
    get organization() {
      return key('organization', 'corporateClients');
    },
  },
  finance: {
    get club() {
      return key('club', 'finance');
    },
    get organization() {
      return key('organization', 'finance');
    },
  },
  managerControl: {
    get all() {
      return key('club', 'manager-control-dashboard');
    },
    detail: (filters: Record<string, unknown>) =>
      key('club', 'manager-control-dashboard', filters),
  },
  methodology: {
    get all() {
      return key('organization', 'methodology');
    },
    analytics: (params: MethodologyAnalyticsFilters) =>
      key('organization', 'methodology', 'analytics', params),
    exercises: (params: MethodologyExerciseFilters) =>
      key('organization', 'methodology', 'exercises', params),
    skills: (params: MethodologySkillFilters) =>
      key('organization', 'methodology', 'skills', params),
  },
  motivation: {
    get club() {
      return key('club', 'motivation');
    },
    get organization() {
      return key('organization', 'motivation');
    },
  },
  onboarding: {
    get all() {
      return key('membership', 'onboarding');
    },
    get clubAll() {
      return key('club', 'onboarding');
    },
    get organizationAll() {
      return key('organization', 'onboarding');
    },
    detail: (role?: string | null) =>
      key('membership', 'onboarding', 'detail', role || 'current'),
    task: (taskKey: string, role?: string | null) =>
      key('membership', 'onboarding', 'task', role || 'current', taskKey),
    metrics: () => key('organization', 'onboarding', 'metrics'),
    trainingData: (role?: string | null) =>
      key('club', 'onboarding', 'training-data', role || 'all'),
    trainingMode: () => key('membership', 'onboarding', 'training-mode'),
  },
  payroll: domainKeys('organization', 'payroll'),
  prepayments: domainKeys('club', 'prepayments'),
  references: {
    get all() {
      return key('organization', 'references');
    },
    list: (type: ReferenceType, status: ReferenceStatus | 'all') =>
      key('organization', 'references', 'list', type, status),
  },
  reports: domainKeys('club', 'reports'),
  shiftCash: domainKeys('club', 'shiftCash'),
  shiftReports: {
    get all() {
      return key('club', 'shiftReports');
    },
    active: () => key('club', 'shiftReports', 'active'),
    list: (params: Record<string, unknown>) =>
      key('club', 'shiftReports', 'list', params),
    templates: (status: string) =>
      key('organization', 'shiftReports', 'templates', status),
    get templatesAll() {
      return key('organization', 'shiftReports');
    },
  },
  shifts: domainKeys('club', 'shifts'),
  staff: domainKeys('organization', 'staff'),
  subscriptionTypes: domainKeys('organization', 'subscriptionTypes'),
  telephony: {
    get all() {
      return key('club', 'telephony');
    },
    call: (id: number | null) => key('club', 'telephony', 'call', id),
    calls: (params: Record<string, unknown>) => key('club', 'telephony', 'calls', params),
    config: () => key('club', 'telephony', 'config'),
    rawEvents: (params: Record<string, unknown>) =>
      key('club', 'telephony', 'raw-events', params),
    report: (params: Record<string, unknown>) =>
      key('club', 'telephony', 'report', params),
    stats: () => key('club', 'telephony', 'stats'),
    transcriptionJob: (id: number | null) =>
      key('club', 'telephony', 'transcription-job', id),
    transcriptionJobs: (params: Record<string, unknown>) =>
      key('club', 'telephony', 'transcription-jobs', params),
    transcriptionStats: () => key('club', 'telephony', 'transcription-stats'),
  },
  trainingNotes: domainKeys('club', 'trainingNotes'),
  trainingPlans: {
    get all() {
      return key('club', 'training-plans');
    },
    detail: (planId: number | null) =>
      key('club', 'training-plans', 'detail', planId),
    list: (params: Record<string, unknown>) =>
      key('club', 'training-plans', 'list', params),
  },
  utilization: {
    get all() {
      return key('club', 'utilization');
    },
    list: () => key('club', 'utilization', 'list'),
  },
  visitsAnalytics: {
    get all() {
      return key('club', 'visits-analytics');
    },
    detail: (params: { from: string; to: string }) =>
      key('club', 'visits-analytics', params),
    sourceQuality: (params: { from: string; to: string; sources?: string[] }) =>
      key('club', 'visits-analytics', 'source-quality', params),
    cohortsLifecycle: (params: { from: string; to: string; sources?: string[] }) =>
      key('club', 'visits-analytics', 'cohorts-lifecycle', params),
    revenueLtv: (params: { from: string; to: string; sources?: string[] }) =>
      key('club', 'visits-analytics', 'revenue-ltv', params),
  },
};
