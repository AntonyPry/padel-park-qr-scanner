const assert = require('node:assert/strict');
const test = require('node:test');
const {
  createRealtimeEvent,
  matchRealtimeChange,
} = require('../../src/realtime');

function req(method, originalUrl) {
  return { method, originalUrl };
}

test('route mapper emits minimal client create event hints', () => {
  const change = matchRealtimeChange(req('POST', '/api/clients'), { id: 42 });

  assert.equal(change.domain, 'clients');
  assert.equal(change.entity, 'client');
  assert.equal(change.entityId, '42');
  assert.equal(change.action, 'created');
  assert.deepEqual(change.hints.queryGroups.slice(0, 2), ['clients', 'callTasks']);
});

test('route mapper classifies destructive and lifecycle actions', () => {
  assert.equal(
    matchRealtimeChange(req('DELETE', '/api/clients/42/permanent')).action,
    'deleted',
  );
  assert.equal(
    matchRealtimeChange(req('POST', '/api/bookings/series/7/archive')).action,
    'archived',
  );
  assert.equal(
    matchRealtimeChange(req('POST', '/api/catalog/rules/9/restore')).action,
    'restored',
  );
});

test('route mapper covers integrations and system-facing sync endpoints', () => {
  const webhook = matchRealtimeChange(req('POST', '/api/webhooks/evotor'));
  const telephony = matchRealtimeChange(req('POST', '/api/telephony/beeline/sync'));

  assert.equal(webhook.domain, 'finance');
  assert.equal(webhook.source, 'webhook');
  assert.equal(webhook.action, 'imported');
  assert.equal(telephony.domain, 'telephony');
  assert.equal(telephony.action, 'synced');
});

test('event schema stays narrow and excludes response body data', () => {
  const event = createRealtimeEvent(
    {
      action: 'created',
      domain: 'clients',
      entity: 'client',
      entityId: 42,
      hints: { queryGroups: ['clients'], routes: ['/admin/clients'] },
      responseBody: { phone: '+79990000000' },
    },
    { id: 7, role: 'manager' },
  );

  assert.deepEqual(Object.keys(event).sort(), [
    'action',
    'actorId',
    'actorRole',
    'domain',
    'entity',
    'entityId',
    'hints',
    'id',
    'occurredAt',
    'source',
    'trainingMode',
    'trainingRole',
  ]);
  assert.equal(event.actorRole, 'manager');
  assert.equal(event.actorId, '7');
  assert.equal(event.entityId, '42');
  assert.equal(JSON.stringify(event).includes('+79990000000'), false);
});
