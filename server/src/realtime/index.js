const {
  CRM_CHANGED_EVENT,
  createRealtimeEvent,
  publishRealtimeChange,
} = require('./publisher');
const { realtimeMutations } = require('./middleware');
const {
  canReceiveDomain,
  getRealtimeDomainRoom,
  getRealtimeRoomsForRole,
  getRolesForDomain,
} = require('./permissions');
const { matchRealtimeChange } = require('./route-map');

module.exports = {
  CRM_CHANGED_EVENT,
  canReceiveDomain,
  createRealtimeEvent,
  getRealtimeDomainRoom,
  getRealtimeRoomsForRole,
  getRolesForDomain,
  matchRealtimeChange,
  publishRealtimeChange,
  realtimeMutations,
};
