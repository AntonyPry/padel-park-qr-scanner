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
  '/admin/clients': ['owner', 'manager', 'viewer'],
  '/admin/trainer': ['owner', 'manager', 'trainer'],
  '/admin/methodology': ['owner', 'manager', 'trainer'],
  '/admin/methodology-analytics': ['owner', 'manager'],
  '/admin/client-bases': ['owner', 'manager'],
  '/admin/call-tasks': ['owner', 'manager', 'admin'],
  '/admin/prepayments': ['owner', 'manager', 'admin', 'accountant'],
  '/admin/certificates': ['owner', 'manager', 'admin', 'viewer'],
  '/admin/corporate-clients': ['owner', 'manager', 'accountant', 'viewer'],
  '/admin/visits-analytics': ['owner', 'manager', 'accountant', 'viewer'],
  '/admin/finances': ['owner', 'manager', 'accountant', 'viewer'],
  '/admin/staff': ['owner', 'manager', 'accountant'],
  '/admin/users': ['owner', 'manager'],
  '/admin/shift': ['owner', 'manager', 'admin'],
  '/admin/shift/motivation': ['owner', 'manager', 'admin'],
  '/admin/shift/reports': ['owner', 'manager', 'admin'],
  '/admin/shift/cash': ['owner', 'manager', 'admin'],
  '/admin/shift-settings': ['owner', 'manager'],
  '/admin/motivation': ['owner', 'manager', 'admin'],
  '/admin/shift-reports': ['owner', 'manager', 'admin'],
  '/admin/shift-cash': ['owner', 'manager', 'admin'],
  '/admin/utilization': ['owner', 'manager', 'accountant', 'viewer'],
  '/admin/catalog': ['owner', 'manager', 'accountant'],
  '/admin/references': ['owner', 'manager', 'accountant', 'viewer'],
} as const satisfies Record<string, readonly AccountRole[]>;

export type ClientRoute = keyof typeof ROUTE_ACCESS;

export const CLIENT_VIEW_ROLES = [
  'owner',
  'manager',
  'admin',
  'viewer',
  'trainer',
] as const satisfies readonly AccountRole[];

export type RouteAuthorizationStrategy =
  | 'single'
  | 'composite'
  | 'partial';

export interface RouteScopeRequirement {
  roles: readonly AccountRole[];
  scope: AuthorizationScope;
}

export interface RouteAuthorizationContract {
  requirements: readonly RouteScopeRequirement[];
  strategy: RouteAuthorizationStrategy;
}

const single = (
  scope: AuthorizationScope,
  roles: readonly AccountRole[],
): RouteAuthorizationContract => ({
  requirements: [{ roles, scope }],
  strategy: 'single',
});

const composite = (
  requirements: readonly RouteScopeRequirement[],
): RouteAuthorizationContract => ({ requirements, strategy: 'composite' });

const partial = (
  scope: AuthorizationScope,
  roles: readonly AccountRole[],
): RouteAuthorizationContract => ({
  requirements: [{ roles, scope }],
  strategy: 'partial',
});

export const ROUTE_AUTHORIZATION: Record<
  ClientRoute,
  RouteAuthorizationContract
> = {
  '/admin': partial('club', ROUTE_ACCESS['/admin']),
  '/admin/manager-control': single(
    'club',
    ROUTE_ACCESS['/admin/manager-control'],
  ),
  '/admin/audit': single('organization', ROUTE_ACCESS['/admin/audit']),
  '/admin/onboarding': partial(
    'membership',
    ROUTE_ACCESS['/admin/onboarding'],
  ),
  '/admin/bookings': composite([
    { roles: ROUTE_ACCESS['/admin/bookings'], scope: 'club' },
    { roles: CLIENT_VIEW_ROLES, scope: 'organization' },
  ]),
  '/admin/clients': composite([
    { roles: ROUTE_ACCESS['/admin/clients'], scope: 'organization' },
    { roles: CLIENT_VIEW_ROLES, scope: 'club' },
  ]),
  '/admin/trainer': composite([
    { roles: ROUTE_ACCESS['/admin/trainer'], scope: 'club' },
    { roles: ROUTE_ACCESS['/admin/trainer'], scope: 'organization' },
  ]),
  '/admin/methodology': single(
    'organization',
    ROUTE_ACCESS['/admin/methodology'],
  ),
  '/admin/methodology-analytics': single(
    'organization',
    ROUTE_ACCESS['/admin/methodology-analytics'],
  ),
  '/admin/client-bases': partial(
    'club',
    ROUTE_ACCESS['/admin/client-bases'],
  ),
  '/admin/call-tasks': partial('club', ROUTE_ACCESS['/admin/call-tasks']),
  '/admin/prepayments': single('club', ROUTE_ACCESS['/admin/prepayments']),
  '/admin/certificates': single('club', ROUTE_ACCESS['/admin/certificates']),
  '/admin/corporate-clients': partial(
    'organization',
    ROUTE_ACCESS['/admin/corporate-clients'],
  ),
  '/admin/visits-analytics': single(
    'club',
    ROUTE_ACCESS['/admin/visits-analytics'],
  ),
  '/admin/finances': composite([
    { roles: ROUTE_ACCESS['/admin/finances'], scope: 'club' },
    { roles: ROUTE_ACCESS['/admin/finances'], scope: 'organization' },
  ]),
  '/admin/staff': partial('organization', ROUTE_ACCESS['/admin/staff']),
  '/admin/users': single('organization', ROUTE_ACCESS['/admin/users']),
  '/admin/shift': single('club', ROUTE_ACCESS['/admin/shift']),
  '/admin/shift/motivation': composite([
    { roles: ROUTE_ACCESS['/admin/shift/motivation'], scope: 'club' },
    { roles: ROUTE_ACCESS['/admin/shift/motivation'], scope: 'organization' },
  ]),
  '/admin/shift/reports': single(
    'club',
    ROUTE_ACCESS['/admin/shift/reports'],
  ),
  '/admin/shift/cash': single('club', ROUTE_ACCESS['/admin/shift/cash']),
  '/admin/shift-settings': single(
    'organization',
    ROUTE_ACCESS['/admin/shift-settings'],
  ),
  '/admin/motivation': composite([
    { roles: ROUTE_ACCESS['/admin/motivation'], scope: 'club' },
    { roles: ROUTE_ACCESS['/admin/motivation'], scope: 'organization' },
  ]),
  '/admin/shift-reports': single(
    'club',
    ROUTE_ACCESS['/admin/shift-reports'],
  ),
  '/admin/shift-cash': single('club', ROUTE_ACCESS['/admin/shift-cash']),
  '/admin/utilization': single('club', ROUTE_ACCESS['/admin/utilization']),
  '/admin/catalog': composite([
    { roles: ROUTE_ACCESS['/admin/catalog'], scope: 'organization' },
    { roles: ROUTE_ACCESS['/admin/catalog'], scope: 'club' },
  ]),
  '/admin/references': single(
    'organization',
    ROUTE_ACCESS['/admin/references'],
  ),
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

export function isClientRoute(path: string): path is ClientRoute {
  return path in ROUTE_ACCESS;
}

export function canAccessPathForAuthority(
  authority: RoleAuthority,
  path: ClientRoute,
) {
  return ROUTE_AUTHORIZATION[path].requirements.every((requirement) =>
    hasRoleAccess(
      selectAuthorizationRole(authority, requirement.scope),
      requirement.roles,
    ),
  );
}

export function getDefaultPath(role: AccountRole | null | undefined) {
  if (role === 'accountant') return '/admin/finances';
  if (role === 'viewer') return '/admin/visits-analytics';
  if (role === 'trainer') return '/admin/trainer';

  const entry = Object.entries(ROUTE_ACCESS).find(([, roles]) =>
    hasRoleAccess(role, roles),
  );

  return entry?.[0] || '/admin/shift/motivation';
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
    ) || '/admin/shift/motivation'
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

export function canViewClients(role: AccountRole | null | undefined) {
  return hasRoleAccess(role, CLIENT_VIEW_ROLES);
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

export function canViewReferences(role: AccountRole | null | undefined) {
  return hasRoleAccess(role, ['owner', 'manager', 'admin', 'accountant', 'viewer']);
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
