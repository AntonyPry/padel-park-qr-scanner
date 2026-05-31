import type { AccountRole } from '@/lib/roles';

export const ROUTE_ACCESS: Record<string, AccountRole[]> = {
  '/admin': ['owner', 'manager', 'admin'],
  '/admin/audit': ['owner', 'manager'],
  '/admin/onboarding': ['owner', 'manager', 'admin', 'accountant', 'viewer', 'trainer'],
  '/admin/bookings': ['owner', 'manager', 'admin', 'viewer'],
  '/admin/clients': ['owner', 'manager', 'admin', 'viewer'],
  '/admin/trainer': ['owner', 'manager', 'trainer'],
  '/admin/client-bases': ['owner', 'manager'],
  '/admin/call-tasks': ['owner', 'manager', 'admin'],
  '/admin/telephony': ['owner', 'manager', 'admin', 'viewer'],
  '/admin/visits-analytics': ['owner', 'manager', 'accountant', 'viewer'],
  '/admin/finances': ['owner', 'manager', 'accountant', 'viewer'],
  '/admin/staff': ['owner', 'manager', 'accountant'],
  '/admin/users': ['owner', 'manager'],
  '/admin/motivation': ['owner', 'manager', 'admin'],
  '/admin/utilization': ['owner', 'manager', 'accountant', 'viewer'],
  '/admin/catalog': ['owner', 'manager', 'accountant'],
  '/admin/references': ['owner', 'manager', 'admin', 'accountant', 'viewer'],
};

export function hasRoleAccess(
  role: AccountRole | null | undefined,
  allowedRoles: AccountRole[],
) {
  return Boolean(role && allowedRoles.includes(role));
}

export function canAccessPath(role: AccountRole | null | undefined, path: string) {
  return hasRoleAccess(role, ROUTE_ACCESS[path] || []);
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
