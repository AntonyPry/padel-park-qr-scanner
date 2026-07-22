const crypto = require('crypto');
const { ACCOUNT_ROLE_VALUES } = require('../constants/account-roles');
const authService = require('../services/auth.service');
const tenantContextService = require('../services/tenant-context.service');
const {
  isTenantCacheRealtimeEnabled,
} = require('../tenant-context/capabilities');
const {
  requireExactSingletonDefault,
} = require('../tenant-enforcement/legacy-singleton');
const {
  getLegacyRealtimeRoomsForRole,
  getRealtimeDomainRoom,
  getTenantDomainRoom,
} = require('./permissions');

const CRM_CHANGED_EVENT = 'crm:changed';
const GLOBAL_SYSTEM_ROOM = 'system:global';
const GLOBAL_SYSTEM_EVENT_ALLOWLIST = new Set(['system:maintenance']);
const VALID_ACTIONS = new Set([
  'created',
  'updated',
  'deleted',
  'restored',
  'archived',
  'merged',
  'recalculated',
  'imported',
  'synced',
]);
const LEGACY_ROLE_DERIVED_ROOMS = new Set(
  ACCOUNT_ROLE_VALUES.flatMap(getLegacyRealtimeRoomsForRole),
);

function normalizeAction(action) {
  return VALID_ACTIONS.has(action) ? action : 'updated';
}

function assertImmutableTenantContext(tenant) {
  if (!tenant || !Object.isFrozen(tenant)) {
    const error = new Error('Validated immutable tenant context is required');
    error.code = 'TENANT_REALTIME_CONTEXT_REQUIRED';
    throw error;
  }
  if (!['membership', 'organization', 'club'].includes(tenant.scope)) {
    const error = new Error(`Unsupported tenant realtime scope: ${tenant.scope}`);
    error.code = 'TENANT_REALTIME_SCOPE_INVALID';
    throw error;
  }
  return tenant;
}

function createRealtimeEvent(payload, account, tenant = null) {
  const event = {
    id: payload.id || crypto.randomUUID(),
    domain: payload.domain,
    entity: payload.entity,
    entityId: payload.entityId == null ? null : String(payload.entityId),
    action: normalizeAction(payload.action),
    occurredAt: payload.occurredAt || new Date().toISOString(),
    actorRole: account?.role || payload.actorRole || null,
    actorId: account?.id == null ? payload.actorId || null : String(account.id),
    source: payload.source || 'api',
    trainingMode: Boolean(payload.trainingMode),
    trainingRole: payload.trainingRole || null,
    hints: {
      queryGroups: Array.isArray(payload.hints?.queryGroups)
        ? payload.hints.queryGroups
        : [],
      routes: Array.isArray(payload.hints?.routes) ? payload.hints.routes : [],
    },
  };

  if (!isTenantCacheRealtimeEnabled()) return event;
  const validatedTenant = assertImmutableTenantContext(tenant);
  return {
    ...event,
    clubId: validatedTenant.scope === 'club' ? validatedTenant.clubId : null,
    event: CRM_CHANGED_EVENT,
    membershipId: validatedTenant.membershipId,
    organizationId: validatedTenant.organizationId,
    tenantScope: validatedTenant.scope,
  };
}

async function reconcileLegacyRoleRooms(socket, role) {
  const authorizedRooms = new Set(getLegacyRealtimeRoomsForRole(role));
  for (const room of LEGACY_ROLE_DERIVED_ROOMS) {
    if (!authorizedRooms.has(room)) await socket.leave(room);
  }
  for (const room of authorizedRooms) {
    await socket.join(room);
  }
}

async function revalidateSocket(socket) {
  const authentication = socket.data?.authentication;
  if (!authentication?.accountId) return false;

  try {
    const principal = await authService.revalidateAuthentication(authentication);
    if (!principal?.account) return false;
    if (!isTenantCacheRealtimeEnabled()) {
      await reconcileLegacyRoleRooms(socket, principal.account.role);
      socket.data.account = principal.account;
      return true;
    }
    socket.data.account = principal.account;

    const tenant = socket.data?.tenant;
    if (!tenant) return false;
    const current = await tenantContextService.resolveTenantContext({
      accountId: principal.account.id,
      clubId: tenant.clubId,
      organizationId: tenant.organizationId,
      scope: 'club',
    });
    return (
      current.membershipId === tenant.membershipId &&
      current.membershipRole === tenant.membershipRole &&
      current.effectiveRole === tenant.effectiveRole
    );
  } catch {
    return false;
  }
}

async function revalidateRoomSockets(io, room) {
  if (!io?.in) return;
  const sockets = await io.in(room).fetchSockets();
  await Promise.all(
    sockets.map(async (socket) => {
      if (await revalidateSocket(socket)) return;
      socket.disconnect(true);
    }),
  );
}

async function publishRealtimeChange(io, payload, account, tenant = null) {
  if (!io || !payload?.domain || !payload?.entity) return null;

  if (!isTenantCacheRealtimeEnabled()) {
    await requireExactSingletonDefault();
  }

  const event = createRealtimeEvent(payload, account, tenant);
  const room = isTenantCacheRealtimeEnabled()
    ? getTenantDomainRoom(event.tenantScope, tenant, event.domain)
    : getRealtimeDomainRoom(event.domain);
  await revalidateRoomSockets(io, room);
  io.to(room).emit(CRM_CHANGED_EVENT, event);
  return event;
}

async function publishLegacyRealtimeChange(io, payload, account = null) {
  if (isTenantCacheRealtimeEnabled()) return null;
  return publishRealtimeChange(io, payload, account, null);
}

async function publishTenantSocketEvent(io, eventName, domain, payload, tenant) {
  if (!io || !eventName || !domain) return null;
  if (!isTenantCacheRealtimeEnabled()) return null;
  const validatedTenant = assertImmutableTenantContext(tenant);
  const envelope = {
    clubId: validatedTenant.scope === 'club' ? validatedTenant.clubId : null,
    data: payload,
    domain,
    event: eventName,
    membershipId: validatedTenant.membershipId,
    organizationId: validatedTenant.organizationId,
    tenantScope: validatedTenant.scope,
  };
  const room = getTenantDomainRoom(validatedTenant.scope, validatedTenant, domain);
  await revalidateRoomSockets(io, room);
  io.to(room).emit(eventName, envelope);
  return envelope;
}

function publishGlobalSystemEvent(io, eventName, payload = {}) {
  if (!GLOBAL_SYSTEM_EVENT_ALLOWLIST.has(eventName)) {
    const error = new Error(`Global realtime event is not allowlisted: ${eventName}`);
    error.code = 'GLOBAL_REALTIME_EVENT_NOT_ALLOWLISTED';
    throw error;
  }
  const envelope = {
    clubId: null,
    data: payload,
    domain: 'system',
    event: eventName,
    membershipId: null,
    organizationId: null,
    tenantScope: 'global',
  };
  io?.to(GLOBAL_SYSTEM_ROOM).emit(eventName, envelope);
  return envelope;
}

module.exports = {
  CRM_CHANGED_EVENT,
  GLOBAL_SYSTEM_EVENT_ALLOWLIST,
  GLOBAL_SYSTEM_ROOM,
  VALID_ACTIONS,
  assertImmutableTenantContext,
  createRealtimeEvent,
  publishLegacyRealtimeChange,
  publishGlobalSystemEvent,
  publishRealtimeChange,
  publishTenantSocketEvent,
  revalidateRoomSockets,
  revalidateSocket,
};
