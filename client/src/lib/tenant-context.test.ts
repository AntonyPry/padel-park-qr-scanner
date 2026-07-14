import { beforeEach, describe, expect, it } from 'vitest';
import {
  applyTenantHeaders,
  clearActiveTenantContext,
  getActiveTenantContext,
  resolveClientRequestTenantScope,
  selectTenantContext,
  setTenantContextCapability,
  type TenantDiscoveryResponse,
} from './tenant-context';

const discovery: TenantDiscoveryResponse = {
  memberships: [
    {
      clubs: [
        {
          effectiveRole: 'manager',
          id: 12,
          name: 'Padel Park',
          slug: 'padel-park',
          timezone: 'Europe/Moscow',
        },
      ],
      id: 21,
      organization: { id: 11, name: 'Padel Park', slug: 'padel-park' },
      role: 'manager',
    },
  ],
  recommendedContext: {
    clubId: 12,
    effectiveRole: 'manager',
    membershipId: 21,
    organizationId: 11,
  },
};

beforeEach(() => {
  localStorage.clear();
  clearActiveTenantContext({ clearPreference: true });
  setTenantContextCapability(false);
});

describe('tenant context transport', () => {
  it('auto-selects the deterministic single club and keeps preference non-authoritative', () => {
    const selected = selectTenantContext(discovery);
    expect(selected).toEqual({
      ...discovery.recommendedContext,
      membershipRole: 'manager',
    });
    expect(Object.isFrozen(selected)).toBe(true);
    expect(getActiveTenantContext()).toEqual(selected);

    localStorage.setItem(
      'setly_tenant_context_preference',
      JSON.stringify({ organizationId: 999, clubId: 999 }),
    );
    expect(selectTenantContext(discovery)).toEqual({
      ...discovery.recommendedContext,
      membershipRole: 'manager',
    });
  });

  it('reselects membership and effective roles together without trusting the preference', () => {
    const multiContextDiscovery: TenantDiscoveryResponse = {
      memberships: [
        discovery.memberships[0],
        {
          clubs: [
            {
              effectiveRole: 'trainer',
              id: 32,
              name: 'Second club',
              slug: 'second-club',
              timezone: 'Europe/Moscow',
            },
          ],
          id: 31,
          organization: { id: 30, name: 'Second org', slug: 'second-org' },
          role: 'viewer',
        },
      ],
      recommendedContext: null,
    };
    localStorage.setItem(
      'setly_tenant_context_preference',
      JSON.stringify({ organizationId: 30, clubId: 32 }),
    );

    expect(selectTenantContext(multiContextDiscovery)).toEqual({
      clubId: 32,
      effectiveRole: 'trainer',
      membershipId: 31,
      membershipRole: 'viewer',
      organizationId: 30,
    });

    localStorage.setItem(
      'setly_tenant_context_preference',
      JSON.stringify({ organizationId: 11, clubId: 12 }),
    );
    expect(selectTenantContext(multiContextDiscovery)).toMatchObject({
      effectiveRole: 'manager',
      membershipRole: 'manager',
      organizationId: 11,
    });
  });

  it('maps generated global, membership, organization and club contracts', () => {
    expect(resolveClientRequestTenantScope('/api/auth/me/memberships')).toBe('global');
    expect(resolveClientRequestTenantScope('/api/onboarding')).toBe('membership');
    expect(resolveClientRequestTenantScope('/api/accounts')).toBe('organization');
    expect(resolveClientRequestTenantScope('/api/bookings/schedule')).toBe('club');
    expect(resolveClientRequestTenantScope('/api/accounts/42', 'PUT')).toBe('organization');
  });

  it('adds only required explicit headers and leaves discovery global', () => {
    setTenantContextCapability(true);
    selectTenantContext(discovery);

    const globalHeaders = new Headers();
    applyTenantHeaders('/api/auth/me/memberships', {}, globalHeaders);
    expect([...globalHeaders.entries()]).toEqual([]);

    const organizationHeaders = new Headers({ 'X-Club-Id': '999' });
    applyTenantHeaders('/api/accounts', {}, organizationHeaders);
    expect(organizationHeaders.get('X-Organization-Id')).toBe('11');
    expect(organizationHeaders.has('X-Club-Id')).toBe(false);

    const clubHeaders = new Headers();
    applyTenantHeaders('/api/bookings/schedule', {}, clubHeaders);
    expect(clubHeaders.get('X-Organization-Id')).toBe('11');
    expect(clubHeaders.get('X-Club-Id')).toBe('12');
  });

  it('blocks domain requests until context is ready and preserves legacy flag-off transport', () => {
    const headers = new Headers();
    setTenantContextCapability(true);
    expect(() => applyTenantHeaders('/api/bookings/schedule', {}, headers)).toThrow(
      'Tenant context is not ready',
    );

    setTenantContextCapability(false);
    expect(() => applyTenantHeaders('/api/bookings/schedule', {}, headers)).not.toThrow();
    expect([...headers.entries()]).toEqual([]);
  });
});
