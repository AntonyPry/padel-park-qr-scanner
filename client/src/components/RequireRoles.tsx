import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '@/lib/useAuth';
import {
  getDefaultPath,
  hasRoleAccess,
} from '@/lib/permissions';
import type { AccountRole } from '@/lib/roles';

export function RequireRoles({
  roles,
  children,
}: {
  roles: AccountRole[];
  children: ReactNode;
}) {
  const { account } = useAuth();

  if (!hasRoleAccess(account?.role, roles)) {
    return <Navigate to={getDefaultPath(account?.role)} replace />;
  }

  return children;
}

export function HomeRedirect() {
  const { account } = useAuth();
  return <Navigate to={getDefaultPath(account?.role)} replace />;
}
