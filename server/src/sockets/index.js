const { Server } = require('socket.io');
const authService = require('../services/auth.service');
const {
  assertTenantFoundationInitialized,
} = require('../services/tenant-foundation.service');
const tenantContextService = require('../services/tenant-context.service');
const {
  assertTenantCapabilityDependencies,
  isTenantCacheRealtimeEnabled,
} = require('../tenant-context/capabilities');
const {
  requireExactSingletonDefault,
} = require('../tenant-enforcement/legacy-singleton');
const {
  ACCESS_SOCKET_ROOM,
  GLOBAL_SYSTEM_ROOM,
  getLegacyRealtimeRoomsForRole,
  getTenantRoomsForContext,
  revalidateSocket,
} = require('../realtime');
const {
  isRolloutMaintenanceActive,
} = require('../tenant-rollout/contract');
const {
  createBrowserOriginPolicy,
} = require('../security/browser-origin-policy');

function createSocketCorsOptions(originPolicy) {
  return {
    methods: ['GET', 'POST'],
    origin(origin, callback) {
      if (origin == null || originPolicy.isAllowed(origin)) {
        callback(null, true);
        return;
      }
      const error = new Error('Socket origin is not allowed');
      error.code = 'SOCKET_ORIGIN_DENIED';
      callback(error);
    },
  };
}

function rolloutSocketMaintenanceGate(_socket, next) {
  if (isRolloutMaintenanceActive()) {
    const maintenanceError = new Error('ROLLOUT_MAINTENANCE_ACTIVE');
    maintenanceError.data = {
      code: 'ROLLOUT_MAINTENANCE_ACTIVE',
      status: 503,
    };
    return next(maintenanceError);
  }
  return next();
}

function createSocketServer(
  httpServer,
  {
    assertFoundationInitialized = assertTenantFoundationInitialized,
    browserOriginPolicy,
    sessionRevalidateMs,
  } = {},
) {
  assertTenantCapabilityDependencies();
  const originPolicy = browserOriginPolicy || createBrowserOriginPolicy();
  const io = new Server(httpServer, {
    cors: createSocketCorsOptions(originPolicy),
  });

  io.use(rolloutSocketMaintenanceGate);
  io.use(async (socket, next) => {
    try {
      await assertFoundationInitialized();
    } catch (error) {
      const code = error.code || 'TENANT_FOUNDATION_UNAVAILABLE';
      const handshakeError = new Error(code);
      handshakeError.data = {
        code,
        details: error.details,
        status: error.statusCode || 503,
      };
      return next(handshakeError);
    }

    const token = String(socket.handshake.auth?.token || '').trim();
    let principal;
    try {
      principal = token
        ? await authService.authenticateBearerToken(token)
        : null;
    } catch {
      principal = null;
    }
    if (!principal?.account || !principal.authentication) {
      const unauthorized = new Error('Unauthorized');
      unauthorized.data = { code: 'UNAUTHORIZED', status: 401 };
      return next(unauthorized);
    }
    socket.data.account = principal.account;
    socket.data.authentication = principal.authentication;

    try {
      if (isTenantCacheRealtimeEnabled()) {
        const organizationId = Number(socket.handshake.auth?.organizationId);
        const clubId = Number(socket.handshake.auth?.clubId);
        if (
          !Number.isSafeInteger(organizationId) ||
          organizationId <= 0 ||
          !Number.isSafeInteger(clubId) ||
          clubId <= 0
        ) {
          const contextError = new Error('TENANT_CONTEXT_REQUIRED');
          contextError.data = { code: 'TENANT_CONTEXT_REQUIRED', status: 400 };
          return next(contextError);
        }
        socket.data.tenant = await tenantContextService.resolveTenantContext({
          accountId: principal.account.id,
          clubId,
          organizationId,
          scope: 'club',
        });
      } else {
        await requireExactSingletonDefault();
      }
      return next();
    } catch (error) {
      const handshakeError = new Error(error.code || 'Unauthorized');
      handshakeError.data = {
        code: error.code || 'UNAUTHORIZED',
        status: error.statusCode || 401,
      };
      return next(handshakeError);
    }
  });

  io.on('connection', (socket) => {
    if (isTenantCacheRealtimeEnabled()) {
      socket.join(GLOBAL_SYSTEM_ROOM);
      getTenantRoomsForContext(socket.data.tenant).forEach((room) => socket.join(room));
    } else {
      const role = socket.data.account?.role;
      getLegacyRealtimeRoomsForRole(role).forEach((room) => socket.join(room));
    }

    const configuredInterval = Number(
      sessionRevalidateMs ??
        process.env.AUTH_SOCKET_REVALIDATE_MS ??
        process.env.TENANT_SOCKET_REVALIDATE_MS ??
        30000,
    );
    const intervalMs = Number.isFinite(configuredInterval)
      ? Math.max(sessionRevalidateMs == null ? 1000 : 10, configuredInterval)
      : 30000;
    const revalidationTimer = setInterval(async () => {
      if (await revalidateSocket(socket)) return;
      socket.disconnect(true);
    }, intervalMs);
    revalidationTimer.unref?.();
    socket.once('disconnect', () => clearInterval(revalidationTimer));
  });

  return io;
}

module.exports = {
  ACCESS_SOCKET_ROOM,
  createSocketServer,
  createSocketCorsOptions,
  rolloutSocketMaintenanceGate,
};
