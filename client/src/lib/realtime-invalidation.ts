import { queryKeys } from '@/api/query-keys';
import {
  getActiveTenantContext,
  isTenantCacheRealtimeCapabilityEnabled,
} from '@/lib/tenant-context';

export interface CrmChangedEvent {
  id: string;
  domain: string;
  entity: string;
  entityId: string | null;
  action:
    | 'created'
    | 'updated'
    | 'deleted'
    | 'restored'
    | 'archived'
    | 'merged'
    | 'recalculated'
    | 'submitted'
    | 'imported'
    | 'synced';
  occurredAt: string;
  actorRole: string | null;
  actorId: string | null;
  source: 'api' | 'webhook' | 'system' | string;
  trainingMode?: boolean;
  trainingRole?: string | null;
  clubId?: number | null;
  event?: string;
  membershipId?: number | null;
  organizationId?: number | null;
  tenantScope?: 'membership' | 'organization' | 'club';
  hints?: {
    queryGroups?: string[];
    routes?: string[];
  };
}

type QueryKey = readonly unknown[];
type QueryKeyResolver = () => QueryKey[];

export const REALTIME_QUERY_GROUP_KEYS: Record<string, QueryKeyResolver> = {
  access: () => [queryKeys.access.all],
  accounts: () => [queryKeys.accounts.all],
  audit: () => [queryKeys.audit.all],
  bookings: () => [queryKeys.bookings.all, queryKeys.visitsAnalytics.all],
  callTasks: () => [queryKeys.callTasks.all],
  catalog: () => [queryKeys.catalog.organization, queryKeys.catalog.club],
  certificates: () => [queryKeys.certificates.all, queryKeys.clients.all, queryKeys.bookings.all, queryKeys.visitsAnalytics.all],
  clientBases: () => [queryKeys.clientBases.all],
  clientSubscriptions: () => [queryKeys.clientSubscriptions.all, queryKeys.clients.all, queryKeys.visitsAnalytics.all],
  clients: () => [queryKeys.clients.all, queryKeys.visitsAnalytics.all],
  corporateClients: () => [queryKeys.corporateClients.organization, queryKeys.corporateClients.club, queryKeys.finance.club, queryKeys.prepayments.all, queryKeys.visitsAnalytics.all],
  finance: () => [queryKeys.finance.club, queryKeys.finance.organization, queryKeys.visitsAnalytics.all],
  managerControl: () => [queryKeys.managerControl.all],
  methodology: () => [queryKeys.methodology.all],
  methodologyAnalytics: () => [queryKeys.methodology.all],
  motivation: () => [queryKeys.motivation.organization, queryKeys.motivation.club],
  onboarding: () => [queryKeys.onboarding.all, queryKeys.onboarding.organizationAll, queryKeys.onboarding.clubAll],
  payroll: () => [queryKeys.payroll.all, queryKeys.finance.organization, queryKeys.staff.all],
  prepayments: () => [queryKeys.prepayments.all, queryKeys.visitsAnalytics.all],
  references: () => [queryKeys.references.all, queryKeys.visitsAnalytics.all],
  reports: () => [queryKeys.reports.all],
  shiftCash: () => [queryKeys.shiftCash.all, queryKeys.shifts.all, queryKeys.finance.club],
  shiftReports: () => [queryKeys.shiftReports.all, queryKeys.shiftReports.templatesAll, queryKeys.shifts.all],
  shifts: () => [
    queryKeys.shifts.all,
    queryKeys.shiftCash.all,
    queryKeys.shiftReports.all,
    queryKeys.payroll.all,
    queryKeys.staff.all,
    queryKeys.finance.club,
    queryKeys.finance.organization,
    queryKeys.motivation.club,
    queryKeys.motivation.organization,
  ],
  staff: () => [queryKeys.staff.all],
  subscriptionTypes: () => [queryKeys.subscriptionTypes.all, queryKeys.catalog.organization],
  telephony: () => [queryKeys.telephony.all],
  trainingNotes: () => [queryKeys.trainingNotes.all, queryKeys.clients.all],
  trainingPlans: () => [queryKeys.trainingPlans.all, queryKeys.bookings.all],
  utilization: () => [queryKeys.utilization.all],
  visitsAnalytics: () => [queryKeys.visitsAnalytics.all],
};

const DOMAIN_FALLBACK_GROUPS: Record<string, string[]> = {
  access: ['access', 'clients', 'visitsAnalytics'],
  accounts: ['accounts', 'staff'],
  bookings: ['bookings', 'visitsAnalytics'],
  booking_resources: ['bookings'],
  call_tasks: ['callTasks'],
  catalog: ['catalog', 'finance'],
  certificates: ['certificates', 'clients', 'bookings', 'visitsAnalytics'],
  client_bases: ['clientBases', 'callTasks'],
  client_subscriptions: ['clientSubscriptions', 'clients', 'bookings', 'visitsAnalytics'],
  clients: ['clients', 'visitsAnalytics'],
  corporate_clients: ['corporateClients', 'finance', 'prepayments', 'visitsAnalytics'],
  finance: ['finance', 'visitsAnalytics'],
  manager_control: ['managerControl'],
  methodology: ['methodology', 'methodologyAnalytics'],
  methodology_analytics: ['methodologyAnalytics'],
  motivation: ['motivation', 'finance'],
  onboarding: ['onboarding'],
  payroll: ['payroll', 'finance', 'staff'],
  prepayment_sales: ['prepayments', 'catalog', 'clients', 'visitsAnalytics'],
  prepayment_settings: ['prepayments', 'catalog'],
  prepayments: ['prepayments'],
  references: ['references', 'clients', 'access', 'visitsAnalytics'],
  reports: ['reports'],
  shifts: ['shifts', 'shiftCash', 'shiftReports', 'payroll', 'staff', 'motivation', 'finance'],
  staff: ['staff', 'payroll', 'accounts'],
  subscription_types: ['subscriptionTypes', 'catalog', 'prepayments'],
  telephony: ['telephony', 'clients', 'callTasks'],
  training_notes: ['trainingNotes', 'clients', 'methodologyAnalytics'],
  training_plans: ['trainingPlans', 'bookings', 'clients'],
  utilization: ['utilization'],
  visits_analytics: ['visitsAnalytics'],
};

function serializeQueryKey(queryKey: QueryKey) {
  return JSON.stringify(queryKey);
}

export function getRealtimeQueryGroups(event: CrmChangedEvent) {
  const hintedGroups = event.hints?.queryGroups || [];
  const fallbackGroups = DOMAIN_FALLBACK_GROUPS[event.domain] || [event.domain];
  return Array.from(new Set([...hintedGroups, ...fallbackGroups]));
}

export function isRealtimeEventForActiveTenant(event: CrmChangedEvent) {
  if (!isTenantCacheRealtimeCapabilityEnabled()) return true;
  const context = getActiveTenantContext();
  if (!context || event.organizationId !== context.organizationId) return false;
  if (event.tenantScope === 'organization') return event.clubId == null;
  if (event.tenantScope === 'membership') {
    return event.membershipId === context.membershipId && event.clubId == null;
  }
  if (event.tenantScope === 'club') return event.clubId === context.clubId;
  return false;
}

export function getRealtimeQueryKeys(event: CrmChangedEvent) {
  if (!isRealtimeEventForActiveTenant(event)) return [];
  const seen = new Set<string>();
  return getRealtimeQueryGroups(event).flatMap((group) => {
    const keys = REALTIME_QUERY_GROUP_KEYS[group]?.() || (
      isTenantCacheRealtimeCapabilityEnabled() ? [] : [[group]]
    );
    return keys.filter((queryKey) => {
      const serialized = serializeQueryKey(queryKey);
      if (seen.has(serialized)) return false;
      seen.add(serialized);
      return true;
    });
  });
}
