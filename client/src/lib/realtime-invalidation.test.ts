import { afterEach, describe, expect, it } from 'vitest';
import { queryKeys } from '@/api/query-keys';
import {
  getRealtimeQueryGroups,
  getRealtimeQueryKeys,
  type CrmChangedEvent,
} from './realtime-invalidation';
import {
  clearActiveTenantContext,
  selectTenantContext,
  setTenantCacheRealtimeCapability,
  setTenantContextCapability,
} from './tenant-context';

function event(overrides: Partial<CrmChangedEvent>): CrmChangedEvent {
  return {
    action: 'updated',
    actorId: '1',
    actorRole: 'owner',
    domain: 'clients',
    entity: 'client',
    entityId: '42',
    id: 'change-1',
    occurredAt: '2026-06-28T12:00:00.000Z',
    source: 'api',
    ...overrides,
  };
}

function enableTenantContext() {
  setTenantContextCapability(true);
  setTenantCacheRealtimeCapability(true);
  selectTenantContext({
    memberships: [
      {
        clubs: [
          {
            effectiveRole: 'manager',
            id: 12,
            name: 'A',
            slug: 'a',
            timezone: 'Europe/Moscow',
          },
        ],
        id: 21,
        organization: { id: 11, name: 'A', slug: 'a' },
        role: 'manager',
      },
    ],
    recommendedContext: {
      clubId: 12,
      effectiveRole: 'manager',
      membershipId: 21,
      organizationId: 11,
    },
  });
}

afterEach(() => {
  clearActiveTenantContext({ clearPreference: true });
  setTenantContextCapability(false);
});

describe('realtime invalidation mapping', () => {
  it('uses server hints and domain fallback without duplicate query keys', () => {
    const keys = getRealtimeQueryKeys(
      event({
        domain: 'access',
        hints: {
          queryGroups: ['access', 'clients', 'visitsAnalytics', 'clients'],
          routes: ['/admin'],
        },
      }),
    );

    expect(keys).toEqual([['access'], ['clients'], ['visits-analytics']]);
  });

  it('invalidates bookings for training plan lifecycle changes', () => {
    const groups = getRealtimeQueryGroups(
      event({
        domain: 'training_plans',
        hints: { queryGroups: ['trainingPlans', 'bookings'] },
      }),
    );

    expect(groups).toContain('trainingPlans');
    expect(groups).toContain('bookings');
  });

  it('invalidates revenue LTV for finance and prepayment changes', () => {
    expect(getRealtimeQueryKeys(event({ domain: 'finance' }))).toContainEqual(['visits-analytics']);
    expect(getRealtimeQueryKeys(event({ domain: 'prepayment_sales' }))).toContainEqual(['visits-analytics']);
  });

  it('invalidates shifts, motivation, and finance for shift cash changes', () => {
    const groups = getRealtimeQueryGroups(
      event({
        domain: 'shifts',
        entity: 'shift_cash_expense',
        hints: { queryGroups: ['shifts', 'motivation', 'finance'] },
      }),
    );

    expect(groups).toContain('shifts');
    expect(groups).toContain('motivation');
    expect(groups).toContain('finance');
  });

  it('invalidates the active reports query through the shared shiftReports group', () => {
    const keys = getRealtimeQueryKeys(
      event({
        domain: 'shifts',
        entity: 'shift_report',
        hints: { queryGroups: ['shiftReports'] },
      }),
    );
    const activeReportsKey = queryKeys.shiftReports.active();

    expect(
      keys.some((key) =>
        key.every((segment, index) => activeReportsKey[index] === segment),
      ),
    ).toBe(true);
  });

  it('keeps unknown groups usable for legacy screens', () => {
    expect(
      getRealtimeQueryKeys(
        event({
          domain: 'custom_domain',
          hints: { queryGroups: ['legacyThing'] },
        }),
      ),
    ).toEqual([['legacyThing'], ['custom_domain']]);
  });

  it('uses tenant-aware keys and ignores another tenant or delayed old-context event', () => {
    enableTenantContext();
    const currentEvent = event({
      clubId: 12,
      domain: 'bookings',
      membershipId: 21,
      organizationId: 11,
      tenantScope: 'club',
    });
    const otherTenantEvent = event({
      clubId: 13,
      domain: 'bookings',
      membershipId: 21,
      organizationId: 11,
      tenantScope: 'club',
    });

    expect(getRealtimeQueryKeys(currentEvent)).toContainEqual([
      'tenant', 11, 12, 'bookings',
    ]);
    expect(getRealtimeQueryKeys(otherTenantEvent)).toEqual([]);
  });

  it('coalesces duplicate/reordered event targets to the same scoped keys', () => {
    enableTenantContext();
    const first = event({
      clubId: 12,
      domain: 'clients',
      id: 'later',
      membershipId: 21,
      organizationId: 11,
      occurredAt: '2026-07-15T12:00:01.000Z',
      tenantScope: 'club',
    });
    const reordered = { ...first, id: 'earlier', occurredAt: '2026-07-15T12:00:00.000Z' };
    expect(getRealtimeQueryKeys(first)).toEqual(getRealtimeQueryKeys(reordered));
  });
});
