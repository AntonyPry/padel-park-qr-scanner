import type { AccountRole } from '@/lib/roles';

export const ROUTE_ACCESS: Record<string, AccountRole[]> = {
  '/admin': ['owner', 'manager', 'admin'],
  '/admin/visits-analytics': ['owner', 'manager', 'accountant', 'viewer'],
  '/admin/finances': ['owner', 'manager', 'accountant', 'viewer'],
  '/admin/staff': ['owner', 'manager', 'accountant', 'viewer'],
  '/admin/users': ['owner', 'manager'],
  '/admin/motivation': ['owner', 'manager', 'admin'],
  '/admin/utilization': ['owner', 'manager', 'accountant', 'viewer'],
  '/admin/catalog': ['owner', 'manager', 'accountant'],
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

  const entry = Object.entries(ROUTE_ACCESS).find(([, roles]) =>
    hasRoleAccess(role, roles),
  );

  return entry?.[0] || '/admin/motivation';
}

export function canManageFinance(role: AccountRole | null | undefined) {
  return hasRoleAccess(role, ['owner', 'accountant']);
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

export function canManageUtilization(role: AccountRole | null | undefined) {
  return hasRoleAccess(role, ['owner', 'manager']);
}
