const assert = require('node:assert/strict');
const test = require('node:test');
const {
  createRealtimeEvent,
  matchRealtimeChange,
} = require('../../src/realtime');
const { buildRealtimeFanoutChanges } = require('../../src/realtime/middleware');

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
  const transcription = matchRealtimeChange(
    req('POST', '/api/telephony/transcription-jobs/12/result'),
  );
  const workerRetry = matchRealtimeChange(
    req('POST', '/api/telephony/transcription-jobs/12/worker-retry'),
  );

  assert.equal(webhook.domain, 'finance');
  assert.equal(webhook.source, 'webhook');
  assert.equal(webhook.action, 'imported');
  assert.equal(webhook.hints.queryGroups.includes('visitsAnalytics'), true);
  assert.equal(telephony.domain, 'telephony');
  assert.equal(telephony.action, 'synced');
  assert.equal(transcription.domain, 'telephony');
  assert.equal(transcription.entity, 'telephony_transcription_job');
  assert.equal(transcription.action, 'updated');
  assert.equal(workerRetry.domain, 'telephony');
  assert.equal(workerRetry.entity, 'telephony_transcription_job');
  assert.equal(workerRetry.action, 'updated');
});

test('key correction publishes the same access invalidation as initial issue', () => {
  const initialIssue = matchRealtimeChange(
    req('POST', '/api/key'),
    { status: 'ok' },
  );
  const correction = matchRealtimeChange(
    req('PATCH', '/api/key'),
    { id: 91, keyNumber: '204', status: 'ok', visitId: 91 },
  );

  assert.equal(initialIssue.domain, 'access');
  assert.equal(correction.domain, 'access');
  assert.equal(correction.entity, 'visit_key');
  assert.equal(correction.action, 'updated');
  assert.equal(correction.entityId, '91');
  assert.equal(correction.hints.queryGroups.includes('access'), true);
  assert.equal(correction.hints.queryGroups.includes('clients'), true);
});

test('revenue dependencies fan out a sanitized visits analytics invalidation', () => {
  const pendingSale = matchRealtimeChange(
    req('POST', '/api/catalog/pending-sales/42/link'),
    { id: 42, client: { id: 7 } },
  );
  const [fanout] = buildRealtimeFanoutChanges(pendingSale);

  assert.deepEqual(fanout, {
    action: 'recalculated',
    domain: 'visits_analytics',
    entity: 'analytics_dependency',
    entityId: null,
    hints: {
      queryGroups: ['visitsAnalytics'],
      routes: ['/admin/visits-analytics'],
    },
    source: 'system',
  });
  assert.deepEqual(buildRealtimeFanoutChanges({
    domain: 'visits_analytics',
    hints: { queryGroups: ['visitsAnalytics'] },
  }), []);
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
