import type { AccountRole } from '@/lib/roles';
import type { ActiveTenantContext } from '@/lib/tenant-context';

export type AuthorizationScope =
  | 'global'
  | 'membership'
  | 'organization'
  | 'club';

export interface RoleAuthority {
  accountRole: AccountRole | null | undefined;
  tenantContext: ActiveTenantContext | null;
  tenantContextEnabled: boolean;
}

export function selectAuthorizationRole(
  authority: RoleAuthority,
  scope: AuthorizationScope,
) {
  if (!authority.tenantContextEnabled || scope === 'global') {
    return authority.accountRole ?? null;
  }

  if (!authority.tenantContext) return null;

  return scope === 'club'
    ? authority.tenantContext.effectiveRole
    : authority.tenantContext.membershipRole;
}
