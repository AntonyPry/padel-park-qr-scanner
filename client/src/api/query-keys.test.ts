import { describe, expect, it } from 'vitest';
import {
  createTenantQueryKey,
  isTenantQueryReady,
  type TenantQueryAuthority,
} from './query-keys';

const authority = (
  organizationId: number,
  clubId: number,
  membershipId: number,
  enabled = true,
): TenantQueryAuthority => ({
  context: {
    clubId,
    effectiveRole: 'manager',
    membershipId,
    membershipRole: 'manager',
    organizationId,
  },
  enabled,
});

describe('tenant query key factory', () => {
  it('keeps global keys outside the tenant namespace', () => {
    expect(createTenantQueryKey(authority(10, 20, 30), 'global', 'publicConfig'))
      .toEqual(['publicConfig']);
  });

  it('builds membership, organization and club authorities explicitly', () => {
    const current = authority(10, 20, 30);
    expect(createTenantQueryKey(current, 'membership', 'onboarding', 7)).toEqual([
      'tenant', 10, 'membership', 30, 'onboarding', 7,
    ]);
    expect(createTenantQueryKey(current, 'organization', 'clients', 7)).toEqual([
      'tenant', 10, 'org', 'clients', 7,
    ]);
    expect(createTenantQueryKey(current, 'club', 'bookings', 7)).toEqual([
      'tenant', 10, 20, 'bookings', 7,
    ]);
  });

  it('separates identical domain and entity IDs in different tenants', () => {
    const first = createTenantQueryKey(authority(10, 20, 30), 'club', 'bookings', 42);
    const second = createTenantQueryKey(authority(11, 21, 31), 'club', 'bookings', 42);
    expect(first).not.toEqual(second);
  });

  it('fails before context readiness and preserves the exact legacy path when disabled', () => {
    expect(isTenantQueryReady({ context: null, enabled: true })).toBe(false);
    expect(() =>
      createTenantQueryKey({ context: null, enabled: true }, 'club', 'bookings'),
    ).toThrow(/before tenant context is ready/);
    expect(
      createTenantQueryKey({ context: null, enabled: false }, 'club', 'bookings', 42),
    ).toEqual(['bookings', 42]);
  });
});
