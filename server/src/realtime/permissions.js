const { ACCESS_MATRIX } = require('../constants/access-matrix');
const { ACCOUNT_ROLE_VALUES } = require('../constants/account-roles');

const REALTIME_DOMAIN_ROOM_PREFIX = 'crm:domain:';
const TENANT_ROOM_PREFIXES = Object.freeze({
  club: 'club',
  membership: 'membership',
  organization: 'org',
});

const DOMAIN_ACCESS_KEYS = {
  access: ['accessOperate'],
  accounts: ['systemUsersManage'],
  audit: ['auditView'],
  bookings: ['bookingsView'],
  booking_resources: ['bookingsView'],
  call_tasks: ['callTasksView'],
  catalog: ['catalogView'],
  certificates: ['certificatesView'],
  client_bases: ['clientBasesView'],
  client_subscriptions: ['clientSubscriptionsView'],
  clients: ['clientsView'],
  corporate_clients: ['corporateClientsView'],
  finance: ['financeView'],
  manager_control: ['managerControlDashboardView'],
  methodology: ['trainingMethodologyView'],
  methodology_analytics: ['trainingMethodologyAnalyticsView'],
  motivation: ['motivationView'],
  onboarding: [],
  payroll: ['payrollView'],
  prepayment_sales: ['prepaymentSalesView'],
  prepayment_settings: ['prepaymentSalesView', 'prepaymentSettingsManage'],
  prepayments: ['prepaymentsDashboardView'],
  references: ['referencesView'],
  reports: ['reportsView'],
  shifts: ['shiftsOperate', 'shiftsManage'],
  staff: ['staffView'],
  subscription_types: ['subscriptionTypesView'],
  telephony: ['telephonyView'],
  training_notes: ['trainingNotesView'],
  training_plans: ['trainingNotesView'],
  utilization: ['utilizationView'],
  visits_analytics: ['reportsView'],
};

function uniq(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function getRealtimeDomainRoom(domain) {
  return `${REALTIME_DOMAIN_ROOM_PREFIX}${domain}`;
}

function getRolesForDomain(domain) {
  if (domain === 'onboarding') return [...ACCOUNT_ROLE_VALUES];

  const accessKeys = DOMAIN_ACCESS_KEYS[domain] || [];
  return uniq(accessKeys.flatMap((key) => ACCESS_MATRIX[key] || []));
}

function canReceiveDomain(role, domain) {
  if (!role) return false;
  return getRolesForDomain(domain).includes(role);
}

function getRealtimeRoomsForRole(role) {
  return Object.keys(DOMAIN_ACCESS_KEYS)
    .filter((domain) => canReceiveDomain(role, domain))
    .map(getRealtimeDomainRoom);
}

function positiveTenantId(value, label) {
  const normalized = Number(value);
  if (!Number.isSafeInteger(normalized) || normalized <= 0) {
    const error = new Error(`Validated tenant ${label} is required for realtime`);
    error.code = 'TENANT_REALTIME_CONTEXT_REQUIRED';
    throw error;
  }
  return normalized;
}

function getTenantBaseRoom(scope, tenant) {
  if (scope === 'organization') {
    return `${TENANT_ROOM_PREFIXES.organization}:${positiveTenantId(tenant?.organizationId, 'organizationId')}`;
  }
  if (scope === 'club') {
    positiveTenantId(tenant?.organizationId, 'organizationId');
    return `${TENANT_ROOM_PREFIXES.club}:${positiveTenantId(tenant?.clubId, 'clubId')}`;
  }
  if (scope === 'membership') {
    positiveTenantId(tenant?.organizationId, 'organizationId');
    return `${TENANT_ROOM_PREFIXES.membership}:${positiveTenantId(tenant?.membershipId, 'membershipId')}`;
  }

  const error = new Error(`Unsupported tenant realtime scope: ${scope}`);
  error.code = 'TENANT_REALTIME_SCOPE_INVALID';
  throw error;
}

function getTenantDomainRoom(scope, tenant, domain) {
  const normalizedDomain = String(domain || '').trim();
  if (!normalizedDomain) {
    const error = new Error('Realtime domain is required');
    error.code = 'TENANT_REALTIME_DOMAIN_REQUIRED';
    throw error;
  }
  if (scope === 'membership') return getTenantBaseRoom(scope, tenant);
  return `${getTenantBaseRoom(scope, tenant)}:domain:${normalizedDomain}`;
}

function getTenantRoomsForContext(tenant) {
  const organizationRoom = getTenantBaseRoom('organization', tenant);
  const clubRoom = getTenantBaseRoom('club', tenant);
  const membershipRoom = getTenantBaseRoom('membership', tenant);
  const organizationDomains = getRealtimeRoomsForRole(tenant?.membershipRole)
    .map((room) => room.slice(REALTIME_DOMAIN_ROOM_PREFIX.length))
    .map((domain) => getTenantDomainRoom('organization', tenant, domain));
  const clubDomains = getRealtimeRoomsForRole(tenant?.effectiveRole)
    .map((room) => room.slice(REALTIME_DOMAIN_ROOM_PREFIX.length))
    .map((domain) => getTenantDomainRoom('club', tenant, domain));

  return uniq([
    organizationRoom,
    clubRoom,
    membershipRoom,
    ...organizationDomains,
    ...clubDomains,
  ]);
}

module.exports = {
  DOMAIN_ACCESS_KEYS,
  REALTIME_DOMAIN_ROOM_PREFIX,
  TENANT_ROOM_PREFIXES,
  canReceiveDomain,
  getRealtimeDomainRoom,
  getRealtimeRoomsForRole,
  getRolesForDomain,
  getTenantBaseRoom,
  getTenantDomainRoom,
  getTenantRoomsForContext,
};
