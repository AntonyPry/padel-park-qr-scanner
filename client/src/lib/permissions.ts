import {
  selectAuthorizationRole,
  type AuthorizationScope,
  type RoleAuthority,
} from '@/lib/authorization';
import type { AccountRole } from '@/lib/roles';

export const ROUTE_ACCESS = {
  '/admin': ['owner', 'manager', 'admin'],
  '/admin/manager-control': ['owner', 'manager'],
  '/admin/audit': ['owner', 'manager'],
  '/admin/onboarding': ['owner', 'manager', 'admin', 'accountant', 'viewer', 'trainer'],
  '/admin/bookings': ['owner', 'manager', 'admin', 'viewer'],
  '/admin/clients': ['owner', 'manager', 'admin', 'viewer'],
  '/admin/trainer': ['owner', 'manager', 'trainer'],
  '/admin/methodology': ['owner', 'manager', 'trainer'],
  '/admin/methodology-analytics': ['owner', 'manager'],
  '/admin/client-bases': ['owner', 'manager'],
  '/admin/call-tasks': ['owner', 'manager', 'admin'],
  '/admin/prepayments': ['owner', 'manager', 'admin', 'accountant'],
  '/admin/certificates': ['owner', 'manager', 'admin', 'viewer'],
  '/admin/corporate-clients': ['owner', 'manager', 'accountant', 'viewer'],
  '/admin/telephony': ['owner', 'manager', 'admin', 'viewer'],
  '/admin/visits-analytics': ['owner', 'manager', 'accountant', 'viewer'],
  '/admin/finances': ['owner', 'manager', 'accountant', 'viewer'],
  '/admin/staff': ['owner', 'manager', 'accountant'],
  '/admin/users': ['owner', 'manager'],
  '/admin/motivation': ['owner', 'manager', 'admin'],
  '/admin/shift-reports': ['owner', 'manager'],
  '/admin/utilization': ['owner', 'manager', 'accountant', 'viewer'],
  '/admin/catalog': ['owner', 'manager', 'accountant'],
  '/admin/references': ['owner', 'manager', 'admin', 'accountant', 'viewer'],
} as const satisfies Record<string, readonly AccountRole[]>;

export type ClientRoute = keyof typeof ROUTE_ACCESS;

export const ROUTE_SCOPES: Record<ClientRoute, AuthorizationScope> = {
  '/admin': 'club',
  '/admin/manager-control': 'club',
  '/admin/audit': 'organization',
  '/admin/onboarding': 'membership',
  '/admin/bookings': 'club',
  '/admin/clients': 'organization',
  '/admin/trainer': 'club',
  '/admin/methodology': 'organization',
  '/admin/methodology-analytics': 'organization',
  '/admin/client-bases': 'club',
  '/admin/call-tasks': 'club',
  '/admin/prepayments': 'club',
  '/admin/certificates': 'club',
  '/admin/corporate-clients': 'organization',
  '/admin/telephony': 'club',
  '/admin/visits-analytics': 'club',
  '/admin/finances': 'club',
  '/admin/staff': 'organization',
  '/admin/users': 'organization',
  '/admin/motivation': 'club',
  '/admin/shift-reports': 'club',
  '/admin/utilization': 'club',
  '/admin/catalog': 'organization',
  '/admin/references': 'organization',
};

export function hasRoleAccess(
  role: AccountRole | null | undefined,
  allowedRoles: readonly AccountRole[],
) {
  return Boolean(role && allowedRoles.includes(role));
}

export function canAccessPath(
  role: AccountRole | null | undefined,
  path: ClientRoute,
) {
  return hasRoleAccess(role, ROUTE_ACCESS[path]);
}

export function canAccessPathForAuthority(
  authority: RoleAuthority,
  path: ClientRoute,
) {
  return hasRoleAccess(
    selectAuthorizationRole(authority, ROUTE_SCOPES[path]),
    ROUTE_ACCESS[path],
  );
}

export function getDefaultPath(role: AccountRole | null | undefined) {
  if (role === 'accountant') return '/admin/finances';
  if (role === 'viewer') return '/admin/visits-analytics';
  if (role === 'trainer') return '/admin/trainer';

  const entry = Object.entries(ROUTE_ACCESS).find(([, roles]) =>
    hasRoleAccess(role, roles),
  );

  return entry?.[0] || '/admin/motivation';
}

const DEFAULT_PATH_PRIORITY: ClientRoute[] = [
  '/admin',
  '/admin/finances',
  '/admin/visits-analytics',
  '/admin/trainer',
  '/admin/onboarding',
  ...Object.keys(ROUTE_ACCESS).filter(
    (path) =>
      ![
        '/admin',
        '/admin/finances',
        '/admin/visits-analytics',
        '/admin/trainer',
        '/admin/onboarding',
      ].includes(path),
  ) as ClientRoute[],
];

export function getDefaultPathForAuthority(authority: RoleAuthority) {
  return (
    DEFAULT_PATH_PRIORITY.find((path) =>
      canAccessPathForAuthority(authority, path),
    ) || '/admin/motivation'
  );
}

export function canManageFinance(role: AccountRole | null | undefined) {
  return hasRoleAccess(role, ['owner', 'accountant']);
}

export function canExportFinance(role: AccountRole | null | undefined) {
  return hasRoleAccess(role, ['owner', 'manager', 'accountant']);
}

export function canManageClients(role: AccountRole | null | undefined) {
  return hasRoleAccess(role, ['owner', 'manager', 'admin']);
}

export function canManageBookings(role: AccountRole | null | undefined) {
  return hasRoleAccess(role, ['owner', 'manager', 'admin']);
}

export function canManageBookingResources(role: AccountRole | null | undefined) {
  return hasRoleAccess(role, ['owner', 'manager']);
}

export function canViewTrainingNotes(role: AccountRole | null | undefined) {
  return hasRoleAccess(role, ['owner', 'manager', 'trainer']);
}

export function canManageTrainingNotes(role: AccountRole | null | undefined) {
  return hasRoleAccess(role, ['owner', 'manager', 'trainer']);
}

export function canManageMethodology(role: AccountRole | null | undefined) {
  return hasRoleAccess(role, ['owner', 'manager']);
}

export function canViewMethodologyAnalytics(role: AccountRole | null | undefined) {
  return hasRoleAccess(role, ['owner', 'manager']);
}

export function canCreateMethodologyDraft(role: AccountRole | null | undefined) {
  return hasRoleAccess(role, ['owner', 'manager', 'trainer']);
}

export function canMergeClients(role: AccountRole | null | undefined) {
  return hasRoleAccess(role, ['owner', 'manager']);
}

export function canManageClientBases(role: AccountRole | null | undefined) {
  return hasRoleAccess(role, ['owner', 'manager']);
}

export function canManageCallTasks(role: AccountRole | null | undefined) {
  return hasRoleAccess(role, ['owner', 'manager']);
}

export function canManageTelephony(role: AccountRole | null | undefined) {
  return hasRoleAccess(role, ['owner', 'manager']);
}

export function canWorkTelephony(role: AccountRole | null | undefined) {
  return hasRoleAccess(role, ['owner', 'manager', 'admin']);
}

export function canManageCatalog(role: AccountRole | null | undefined) {
  return hasRoleAccess(role, ['owner', 'accountant']);
}

export function canManagePrepaymentSales(role: AccountRole | null | undefined) {
  return hasRoleAccess(role, ['owner', 'manager']);
}

export function canManagePrepaymentSettings(role: AccountRole | null | undefined) {
  return hasRoleAccess(role, ['owner', 'manager']);
}

export function canViewPrepaymentsDashboard(role: AccountRole | null | undefined) {
  return hasRoleAccess(role, ['owner', 'manager', 'admin', 'accountant']);
}

export function canViewManagerControlDashboard(role: AccountRole | null | undefined) {
  return hasRoleAccess(role, ['owner', 'manager']);
}

export function canViewClientSubscriptions(role: AccountRole | null | undefined) {
  return hasRoleAccess(role, ['owner', 'manager', 'admin', 'viewer']);
}

export function canRedeemClientSubscriptions(role: AccountRole | null | undefined) {
  return hasRoleAccess(role, ['owner', 'manager', 'admin']);
}

export function canViewCertificates(role: AccountRole | null | undefined) {
  return hasRoleAccess(role, ['owner', 'manager', 'admin', 'viewer']);
}

export function canRedeemCertificates(role: AccountRole | null | undefined) {
  return hasRoleAccess(role, ['owner', 'manager', 'admin']);
}

export function canViewCorporateClients(role: AccountRole | null | undefined) {
  return hasRoleAccess(role, ['owner', 'manager', 'accountant', 'viewer']);
}

export function canManageCorporateDeposits(role: AccountRole | null | undefined) {
  return canManageFinance(role);
}

export function canManageSubscriptionTypes(role: AccountRole | null | undefined) {
  return hasRoleAccess(role, ['owner', 'manager']);
}

export function canManageReferences(role: AccountRole | null | undefined) {
  return hasRoleAccess(role, ['owner', 'manager']);
}

export function canManageMotivation(role: AccountRole | null | undefined) {
  return hasRoleAccess(role, ['owner', 'manager']);
}

export function canManageStaff(role: AccountRole | null | undefined) {
  return hasRoleAccess(role, ['owner', 'manager']);
}

export function canManageSystemUsers(role: AccountRole | null | undefined) {
  return hasRoleAccess(role, ['owner', 'manager']);
}

export function canManageShifts(role: AccountRole | null | undefined) {
  return hasRoleAccess(role, ['owner', 'manager']);
}

export function canManageShiftReportTemplates(role: AccountRole | null | undefined) {
  return hasRoleAccess(role, ['owner', 'manager']);
}

export function canReviewPayroll(role: AccountRole | null | undefined) {
  return hasRoleAccess(role, ['owner', 'manager', 'accountant']);
}

export function canApprovePayroll(role: AccountRole | null | undefined) {
  return hasRoleAccess(role, ['owner', 'manager']);
}

export function canPayPayroll(role: AccountRole | null | undefined) {
  return hasRoleAccess(role, ['owner', 'accountant']);
}

export function canManageUtilization(role: AccountRole | null | undefined) {
  return hasRoleAccess(role, ['owner', 'manager']);
}

export function canViewAudit(role: AccountRole | null | undefined) {
  return hasRoleAccess(role, ['owner', 'manager']);
}
