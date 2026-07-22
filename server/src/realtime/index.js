const {
  CRM_CHANGED_EVENT,
  GLOBAL_SYSTEM_EVENT_ALLOWLIST,
  GLOBAL_SYSTEM_ROOM,
  createRealtimeEvent,
  publishLegacyRealtimeChange,
  publishGlobalSystemEvent,
  publishRealtimeChange,
  publishTenantSocketEvent,
  revalidateSocket,
} = require('./publisher');
const { realtimeMutations } = require('./middleware');
const {
  canReceiveDomain,
  getRealtimeDomainRoom,
  getRealtimeRoomsForRole,
  getRolesForDomain,
  getTenantBaseRoom,
  getTenantDomainRoom,
  getTenantRoomsForContext,
} = require('./permissions');
const { matchRealtimeChange } = require('./route-map');

module.exports = {
  CRM_CHANGED_EVENT,
  GLOBAL_SYSTEM_EVENT_ALLOWLIST,
  GLOBAL_SYSTEM_ROOM,
  canReceiveDomain,
  createRealtimeEvent,
  getRealtimeDomainRoom,
  getRealtimeRoomsForRole,
  getRolesForDomain,
  getTenantBaseRoom,
  getTenantDomainRoom,
  getTenantRoomsForContext,
  matchRealtimeChange,
  publishLegacyRealtimeChange,
  publishGlobalSystemEvent,
  publishRealtimeChange,
  publishTenantSocketEvent,
  revalidateSocket,
  realtimeMutations,
};
