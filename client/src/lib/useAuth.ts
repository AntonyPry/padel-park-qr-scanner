import { useContext } from 'react';
import { AuthContext } from '@/lib/auth-context';
import {
  selectAuthorizationRole,
  type AuthorizationScope,
} from '@/lib/authorization';

export function useAuth() {
  const value = useContext(AuthContext);

  if (!value) {
    throw new Error('useAuth must be used inside AuthProvider');
  }

  return value;
}

export function useAuthorizationRole(scope: AuthorizationScope) {
  const { account, tenantContext, tenantContextEnabled } = useAuth();

  return selectAuthorizationRole(
    {
      accountRole: account?.role,
      tenantContext,
      tenantContextEnabled,
    },
    scope,
  );
}
