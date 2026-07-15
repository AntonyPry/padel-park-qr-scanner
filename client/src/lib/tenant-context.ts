import { apiEndpoints, type TenantScope } from '@/api/generated';
import type { AccountRole } from '@/lib/roles';

const TENANT_PREFERENCE_KEY = 'setly_tenant_context_preference';

export interface TenantClubDiscovery {
  effectiveRole: AccountRole;
  id: number;
  name: string;
  slug: string;
  timezone: string;
}

export interface TenantMembershipDiscovery {
  clubs: TenantClubDiscovery[];
  id: number;
  organization: {
    id: number;
    name: string;
    slug: string;
  };
  role: AccountRole;
}

export interface TenantDiscoveryResponse {
  memberships: TenantMembershipDiscovery[];
  recommendedContext: {
    clubId: number;
    effectiveRole: AccountRole;
    membershipId: number;
    organizationId: number;
  } | null;
}

export interface ActiveTenantContext {
  clubId: number;
  effectiveRole: AccountRole;
  membershipId: number;
  membershipRole: AccountRole;
  organizationId: number;
}

let tenantCapabilityEnabled = false;
let tenantCacheRealtimeCapabilityEnabled = false;
let activeTenantContext: ActiveTenantContext | null = null;

function readPreference() {
  try {
    const raw = localStorage.getItem(TENANT_PREFERENCE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ActiveTenantContext>;
    if (
      !Number.isSafeInteger(parsed.organizationId) ||
      !Number.isSafeInteger(parsed.clubId) ||
      Number(parsed.organizationId) <= 0 ||
      Number(parsed.clubId) <= 0
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function persistPreference(context: ActiveTenantContext) {
  localStorage.setItem(
    TENANT_PREFERENCE_KEY,
    JSON.stringify({
      clubId: context.clubId,
      organizationId: context.organizationId,
    }),
  );
}

export function setTenantContextCapability(enabled: boolean) {
  tenantCapabilityEnabled = enabled;
  if (!enabled) {
    tenantCacheRealtimeCapabilityEnabled = false;
    activeTenantContext = null;
  }
}

export function isTenantContextCapabilityEnabled() {
  return tenantCapabilityEnabled;
}

export function setTenantCacheRealtimeCapability(enabled: boolean) {
  if (enabled && !tenantCapabilityEnabled) {
    throw new Error('Tenant cache/realtime capability requires tenant context');
  }
  tenantCacheRealtimeCapabilityEnabled = enabled;
}

export function isTenantCacheRealtimeCapabilityEnabled() {
  return tenantCacheRealtimeCapabilityEnabled;
}

export function getActiveTenantContext() {
  return activeTenantContext;
}

export function clearActiveTenantContext(options: { clearPreference?: boolean } = {}) {
  activeTenantContext = null;
  if (options.clearPreference) localStorage.removeItem(TENANT_PREFERENCE_KEY);
}

export function selectTenantContext(discovery: TenantDiscoveryResponse) {
  const available = discovery.memberships.flatMap((membership) =>
    membership.clubs.map((club) => ({
      clubId: club.id,
      effectiveRole: club.effectiveRole,
      membershipId: membership.id,
      membershipRole: membership.role,
      organizationId: membership.organization.id,
    })),
  );
  if (available.length === 0) {
    throw new Error('Для аккаунта нет доступного активного клуба');
  }

  const preference = readPreference();
  const selected =
    available.find(
      (candidate) =>
        candidate.organizationId === preference?.organizationId &&
        candidate.clubId === preference?.clubId,
    ) ||
    available.find(
      (candidate) =>
        candidate.organizationId === discovery.recommendedContext?.organizationId &&
        candidate.clubId === discovery.recommendedContext?.clubId,
    ) ||
    available[0];

  activeTenantContext = Object.freeze(selected);
  persistPreference(selected);
  return activeTenantContext;
}

function normalizeApiPath(input: string) {
  const withoutQuery = input.split('?')[0];
  let path = withoutQuery;
  try {
    path = new URL(input, window.location.origin).pathname;
  } catch {
    // Keep the relative path; apiFetch will surface malformed URLs separately.
  }
  path = path === '/api' ? '/' : path.replace(/^\/api(?=\/)/, '');
  return path.length > 1 ? path.replace(/\/+$/, '') : path;
}

const endpointMatchers = Object.values(apiEndpoints).map((endpoint) => {
  const source = endpoint.path
    .split('/')
    .map((segment) => (/^\{[^}]+\}$/.test(segment) ? '[^/]+' : segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    .join('/');
  return {
    method: endpoint.method,
    pattern: new RegExp(`^${source}/?$`),
    tenantScope: endpoint.tenantScope as TenantScope,
  };
});

export function resolveClientRequestTenantScope(input: string, method = 'GET') {
  const path = normalizeApiPath(input);
  const normalizedMethod = method.toUpperCase();
  return (
    endpointMatchers.find(
      (endpoint) => endpoint.method === normalizedMethod && endpoint.pattern.test(path),
    )?.tenantScope || null
  );
}

export function applyTenantHeaders(input: string, init: RequestInit, headers: Headers) {
  if (!tenantCapabilityEnabled) return;
  const scope = resolveClientRequestTenantScope(input, init.method || 'GET');
  if (!scope) {
    throw new Error(`Tenant scope is not declared for client request: ${init.method || 'GET'} ${input}`);
  }
  if (scope === 'global' || scope === 'provider_ingress' || scope === 'worker') return;
  if (!activeTenantContext) {
    throw new Error('Tenant context is not ready');
  }

  headers.set('X-Organization-Id', String(activeTenantContext.organizationId));
  if (scope === 'club') {
    headers.set('X-Club-Id', String(activeTenantContext.clubId));
  } else {
    headers.delete('X-Club-Id');
  }
}
