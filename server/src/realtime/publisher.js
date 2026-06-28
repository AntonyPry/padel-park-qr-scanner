const crypto = require('crypto');
const { getRealtimeDomainRoom } = require('./permissions');

const CRM_CHANGED_EVENT = 'crm:changed';
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

function normalizeAction(action) {
  return VALID_ACTIONS.has(action) ? action : 'updated';
}

function createRealtimeEvent(payload, account) {
  return {
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
}

function publishRealtimeChange(io, payload, account) {
  if (!io || !payload?.domain || !payload?.entity) return null;

  const event = createRealtimeEvent(payload, account);
  io.to(getRealtimeDomainRoom(event.domain)).emit(CRM_CHANGED_EVENT, event);
  return event;
}

module.exports = {
  CRM_CHANGED_EVENT,
  VALID_ACTIONS,
  createRealtimeEvent,
  publishRealtimeChange,
};
