import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '@/lib/useAuth';
import {
  canAccessPathForAuthority,
  getDefaultPathForAuthority,
  type ClientRoute,
} from '@/lib/permissions';

export function RequireRoles({
  path,
  children,
}: {
  path: ClientRoute;
  children: ReactNode;
}) {
  const { account, tenantContext, tenantContextEnabled } = useAuth();
  const authority = {
    accountRole: account?.role,
    tenantContext,
    tenantContextEnabled,
  };

  if (!canAccessPathForAuthority(authority, path)) {
    return <Navigate to={getDefaultPathForAuthority(authority)} replace />;
  }

  return children;
}

export function HomeRedirect() {
  const { account, tenantContext, tenantContextEnabled } = useAuth();
  return (
    <Navigate
      to={getDefaultPathForAuthority({
        accountRole: account?.role,
        tenantContext,
        tenantContextEnabled,
      })}
      replace
    />
  );
}
