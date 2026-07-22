import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { ShieldX } from 'lucide-react';
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
    return <AccessDeniedPage />;
  }

  return children;
}

export function AccessDeniedPage({
  section,
}: {
  section?: string;
}) {
  return (
    <div className="flex min-h-[420px] items-center justify-center p-6">
      <div className="max-w-md rounded-2xl border bg-card p-8 text-center shadow-sm">
        <ShieldX className="mx-auto h-10 w-10 text-muted-foreground" />
        <h1 className="mt-4 text-xl font-semibold">Нет доступа</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {section
            ? `Раздел «${section}» недоступен для вашей роли.`
            : 'Этот раздел недоступен для вашей роли.'}
        </p>
      </div>
    </div>
  );
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
