import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { createTenantQueryKey, type TenantQueryAuthority } from '@/api/query-keys';
import {
  beginTenantContextTransition,
  clearTenantClientState,
  transitionTenantQueryCache,
} from './query-client';
import type { ActiveTenantContext } from './tenant-context';

function context(
  organizationId: number,
  clubId: number,
  membershipId: number,
): ActiveTenantContext {
  return {
    clubId,
    effectiveRole: 'manager',
    membershipId,
    membershipRole: 'manager',
    organizationId,
  };
}

function authority(value: ActiveTenantContext): TenantQueryAuthority {
  return { context: value, enabled: true };
}

function createClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

describe('tenant query cache lifecycle', () => {
  it('invalidates one tenant without touching an identical key in another tenant', async () => {
    const client = createClient();
    const first = createTenantQueryKey(authority(context(1, 11, 21)), 'club', 'bookings', 42);
    const second = createTenantQueryKey(authority(context(2, 11, 21)), 'club', 'bookings', 42);
    client.setQueryData(first, { tenant: 'a' });
    client.setQueryData(second, { tenant: 'b' });

    await client.invalidateQueries({ queryKey: first, refetchType: 'none' });

    expect(client.getQueryState(first)?.isInvalidated).toBe(true);
    expect(client.getQueryState(second)?.isInvalidated).toBe(false);
  });

  it('cancels in-flight old-context work and removes stale club data on switch', async () => {
    const client = createClient();
    const previous = context(1, 11, 21);
    const next = context(1, 12, 21);
    const previousKey = createTenantQueryKey(authority(previous), 'club', 'bookings', 42);
    const nextKey = createTenantQueryKey(authority(next), 'club', 'bookings', 42);
    const organizationKey = createTenantQueryKey(authority(previous), 'organization', 'clients', 42);
    client.setQueryData(previousKey, { tenant: 'old' });
    client.setQueryData(nextKey, { tenant: 'new' });
    client.setQueryData(organizationKey, { organization: 1 });

    let aborted = false;
    void client.fetchQuery({
      queryKey: previousKey,
      queryFn: ({ signal }) =>
        new Promise((resolve, reject) => {
          const timer = setTimeout(() => resolve({ tenant: 'late-old' }), 10_000);
          signal.addEventListener('abort', () => {
            clearTimeout(timer);
            aborted = true;
            reject(new Error('aborted'));
          });
        }),
    });
    await vi.waitFor(() => expect(client.isFetching({ queryKey: previousKey })).toBe(1));

    await transitionTenantQueryCache(client, previous, next);

    expect(aborted).toBe(true);
    expect(client.getQueryData(previousKey)).toBeUndefined();
    expect(client.getQueryData(nextKey)).toEqual({ tenant: 'new' });
    expect(client.getQueryData(organizationKey)).toEqual({ organization: 1 });
  });

  it('auth cleanup removes tenant queries and completed mutation state but preserves global cache', async () => {
    const client = createClient();
    const current = authority(context(1, 11, 21));
    const tenantKey = createTenantQueryKey(current, 'club', 'bookings', 42);
    client.setQueryData(tenantKey, 'tenant');
    client.setQueryData(['clients', 42], 'legacy-tenant');
    client.setQueryData(['publicConfig'], 'global');
    const mutation = client.getMutationCache().build(client, {
      mutationFn: async (variables: { organizationId: number; payload: string }) => ({
        organizationId: variables.organizationId,
        result: 'tenant-A-result',
      }),
      mutationKey: ['bookings', 'save'],
    });
    await mutation.execute({
      organizationId: 1001,
      payload: 'tenant-A-sensitive-draft',
    });
    expect(mutation.state).toMatchObject({
      data: { organizationId: 1001, result: 'tenant-A-result' },
      status: 'success',
      variables: {
        organizationId: 1001,
        payload: 'tenant-A-sensitive-draft',
      },
    });

    await clearTenantClientState(client);

    expect(client.getQueryData(tenantKey)).toBeUndefined();
    expect(client.getQueryData(['clients', 42])).toBeUndefined();
    expect(client.getQueryData(['publicConfig'])).toBe('global');
    expect(client.getMutationCache().getAll()).toHaveLength(0);
  });

  it('background invalidation keeps loaded data visible while marking it stale', async () => {
    const client = createClient();
    const key = createTenantQueryKey(authority(context(1, 11, 21)), 'club', 'bookings');
    const data = { rows: [1, 2, 3] };
    client.setQueryData(key, data);

    await client.invalidateQueries({ queryKey: key, refetchType: 'none' });

    expect(client.getQueryData(key)).toBe(data);
    expect(client.getQueryState(key)?.isInvalidated).toBe(true);
  });

  it('clears mutation lifecycle state before the new context mounts', async () => {
    const client = createClient();
    client.getMutationCache().build(client, {
      mutationFn: async () => ({ ok: true }),
      mutationKey: ['bookings', 'save'],
    });
    expect(client.getMutationCache().getAll()).toHaveLength(1);

    await beginTenantContextTransition(client);

    expect(client.getMutationCache().getAll()).toHaveLength(0);
  });
});
