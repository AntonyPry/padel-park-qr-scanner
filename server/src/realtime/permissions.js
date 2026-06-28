const { ACCESS_MATRIX } = require('../constants/access-matrix');
const { ACCOUNT_ROLE_VALUES } = require('../constants/account-roles');

const REALTIME_DOMAIN_ROOM_PREFIX = 'crm:domain:';

const DOMAIN_ACCESS_KEYS = {
  access: ['accessOperate'],
  accounts: ['systemUsersManage'],
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

module.exports = {
  DOMAIN_ACCESS_KEYS,
  REALTIME_DOMAIN_ROOM_PREFIX,
  canReceiveDomain,
  getRealtimeDomainRoom,
  getRealtimeRoomsForRole,
  getRolesForDomain,
};
