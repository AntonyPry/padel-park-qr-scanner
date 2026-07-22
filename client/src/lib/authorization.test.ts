import { describe, expect, it } from 'vitest';
import { selectAuthorizationRole, type RoleAuthority } from './authorization';
import type { AccountRole } from './roles';

function authority(
  accountRole: AccountRole,
  membershipRole: AccountRole,
  effectiveRole: AccountRole,
  tenantContextEnabled = true,
): RoleAuthority {
  return {
    accountRole,
    tenantContext: {
      clubId: 12,
      effectiveRole,
      membershipId: 21,
      membershipRole,
      organizationId: 11,
    },
    tenantContextEnabled,
  };
}

describe('scope-aware role authority', () => {
  it('uses membership role for organization UI and effective role for club UI', () => {
    const trainerWithManagerAccess = authority('trainer', 'trainer', 'manager');
    expect(selectAuthorizationRole(trainerWithManagerAccess, 'membership')).toBe('trainer');
    expect(selectAuthorizationRole(trainerWithManagerAccess, 'organization')).toBe('trainer');
    expect(selectAuthorizationRole(trainerWithManagerAccess, 'club')).toBe('manager');

    const managerWithTrainerAccess = authority('manager', 'manager', 'trainer');
    expect(selectAuthorizationRole(managerWithTrainerAccess, 'organization')).toBe('manager');
    expect(selectAuthorizationRole(managerWithTrainerAccess, 'club')).toBe('trainer');
  });

  it('preserves owner and every parity role', () => {
    const roles: AccountRole[] = [
      'owner',
      'manager',
      'admin',
      'accountant',
      'trainer',
      'viewer',
    ];

    for (const role of roles) {
      const value = authority(role, role, role);
      expect(selectAuthorizationRole(value, 'membership')).toBe(role);
      expect(selectAuthorizationRole(value, 'organization')).toBe(role);
      expect(selectAuthorizationRole(value, 'club')).toBe(role);
    }
  });

  it('uses legacy Account.role when the capability is off', () => {
    const value = authority('admin', 'trainer', 'manager', false);
    expect(selectAuthorizationRole(value, 'membership')).toBe('admin');
    expect(selectAuthorizationRole(value, 'organization')).toBe('admin');
    expect(selectAuthorizationRole(value, 'club')).toBe('admin');
  });

  it('fails closed without a ready context while the capability is on', () => {
    const value: RoleAuthority = {
      accountRole: 'owner',
      tenantContext: null,
      tenantContextEnabled: true,
    };
    expect(selectAuthorizationRole(value, 'membership')).toBeNull();
    expect(selectAuthorizationRole(value, 'organization')).toBeNull();
    expect(selectAuthorizationRole(value, 'club')).toBeNull();
    expect(selectAuthorizationRole(value, 'global')).toBe('owner');
  });
});
