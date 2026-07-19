import { QueryClient } from '@tanstack/react-query';
import { TENANT_QUERY_DOMAINS } from '@/api/query-keys';
import type { ActiveTenantContext } from '@/lib/tenant-context';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
      staleTime: 30_000,
    },
    mutations: {
      retry: 0,
    },
  },
});

export function isTenantSensitiveQueryKey(queryKey: readonly unknown[]) {
  if (queryKey[0] === 'tenant') return true;
  return typeof queryKey[0] === 'string' && TENANT_QUERY_DOMAINS.has(queryKey[0]);
}

function shouldRemoveForTransition(
  queryKey: readonly unknown[],
  previous: ActiveTenantContext | null,
  next: ActiveTenantContext | null,
) {
  if (!isTenantSensitiveQueryKey(queryKey)) return false;
  if (queryKey[0] !== 'tenant') return true;
  if (!previous || !next) return true;
  if (queryKey[1] !== previous.organizationId) return false;
  if (previous.organizationId !== next.organizationId) return true;

  const scopeMarker = queryKey[2];
  if (scopeMarker === 'org') return false;
  if (scopeMarker === 'membership') {
    return previous.membershipId !== next.membershipId;
  }
  return scopeMarker === previous.clubId && previous.clubId !== next.clubId;
}

export async function transitionTenantQueryCache(
  client: QueryClient,
  previous: ActiveTenantContext | null,
  next: ActiveTenantContext | null,
) {
  const predicate = (query: { queryKey: readonly unknown[] }) =>
    shouldRemoveForTransition(query.queryKey, previous, next);
  await client.cancelQueries({ predicate });
  client.removeQueries({ predicate });
}

export function clearTenantSensitiveQueryCache(client: QueryClient = queryClient) {
  const predicate = (query: { queryKey: readonly unknown[] }) =>
    isTenantSensitiveQueryKey(query.queryKey);
  void client.cancelQueries({ predicate });
  client.removeQueries({ predicate });
}

export async function beginTenantContextTransition(
  client: QueryClient = queryClient,
) {
  const predicate = (query: { queryKey: readonly unknown[] }) =>
    isTenantSensitiveQueryKey(query.queryKey);
  await client.cancelQueries({ predicate });
  client.removeQueries({ predicate });
  client.getMutationCache().clear();
}
