import { queryKeys } from '@/api/query-keys';

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
  hints?: {
    queryGroups?: string[];
    routes?: string[];
  };
}

type QueryKey = readonly unknown[];

export const REALTIME_QUERY_GROUP_KEYS: Record<string, QueryKey[]> = {
  access: [['access']],
  accounts: [['accounts']],
  audit: [queryKeys.audit.all],
  bookings: [queryKeys.bookings.all, queryKeys.visitsAnalytics.all],
  callTasks: [['callTasks']],
  catalog: [['catalog']],
  certificates: [['certificates'], queryKeys.clients.all, queryKeys.bookings.all, queryKeys.visitsAnalytics.all],
  clientBases: [['clientBases']],
  clientSubscriptions: [['clientSubscriptions'], queryKeys.clients.all, queryKeys.visitsAnalytics.all],
  clients: [queryKeys.clients.all, queryKeys.visitsAnalytics.all],
  corporateClients: [['corporateClients'], ['finance'], ['prepayments'], queryKeys.visitsAnalytics.all],
  finance: [['finance'], queryKeys.visitsAnalytics.all],
  managerControl: [['manager-control-dashboard']],
  methodology: [queryKeys.methodology.all],
  methodologyAnalytics: [queryKeys.methodology.all],
  motivation: [['motivation']],
  onboarding: [queryKeys.onboarding.all],
  payroll: [['payroll'], ['finance'], ['staff']],
  prepayments: [['prepayments'], queryKeys.visitsAnalytics.all],
  references: [queryKeys.references.all, queryKeys.visitsAnalytics.all],
  reports: [['reports']],
  shiftReports: [['shiftReports'], ['shifts']],
  shiftCash: [['shiftCash'], ['shifts'], ['finance']],
  shifts: [['shifts'], ['shiftCash'], ['shiftReports'], ['payroll'], ['staff'], ['finance'], ['motivation']],
  staff: [['staff']],
  subscriptionTypes: [['subscriptionTypes'], ['catalog']],
  telephony: [queryKeys.telephony.all],
  trainingNotes: [queryKeys.clients.all],
  trainingPlans: [queryKeys.trainingPlans.all, queryKeys.bookings.all],
  utilization: [queryKeys.utilization.all],
  visitsAnalytics: [queryKeys.visitsAnalytics.all],
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

export function getRealtimeQueryKeys(event: CrmChangedEvent) {
  const seen = new Set<string>();
  return getRealtimeQueryGroups(event).flatMap((group) => {
    const keys = REALTIME_QUERY_GROUP_KEYS[group] || [[group]];
    return keys.filter((queryKey) => {
      const serialized = serializeQueryKey(queryKey);
      if (seen.has(serialized)) return false;
      seen.add(serialized);
      return true;
    });
  });
}
