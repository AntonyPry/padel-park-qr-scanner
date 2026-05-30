const assert = require('node:assert/strict');
const test = require('node:test');
const {
  normalizePayload,
  normalizeRecordingPayload,
  normalizeSubscriptionResponse,
  parseIncomingBeelinePayload,
} = require('../../src/services/telephony.service');

test('normalizes Beeline statistics payload into an inbound call', () => {
  const normalized = normalizePayload({
    direction: 'INBOUND',
    duration: 185000,
    externalTrackingId: 'track-1',
    phone_from: '+7 921 545 39 39',
    phone_to: '78121234567',
    startDate: '2026-05-28T12:00:00+03:00',
    status: 'RECIEVED',
  });

  assert.equal(normalized.direction, 'inbound');
  assert.equal(normalized.callStatus, 'answered');
  assert.equal(normalized.clientPhoneNormalized, '9215453939');
  assert.equal(normalized.durationSeconds, 185);
  assert.equal(normalized.externalTrackingId, 'track-1');
});

test('infers Beeline statistics direction from status when direction is missing', () => {
  const outbound = normalizePayload({
    abonent: {
      extension: '200',
      phone: '+79215453939',
      userId: '9215453939@vol.nw.ims.mnc099.mcc250.3gppnetwork.org',
    },
    duration: 254200,
    phone_to: '+79814271847',
    startDate: 1779987798000,
    status: 'PLACED',
  });
  const inbound = normalizePayload({
    abonent: {
      extension: '200',
      phone: '+79215453939',
      userId: '9215453939@vol.nw.ims.mnc099.mcc250.3gppnetwork.org',
    },
    duration: 800,
    phone_from: '+79814271847',
    startDate: 1779987798000,
    status: 'RECIEVED',
  });

  assert.equal(outbound.direction, 'outbound');
  assert.equal(outbound.clientPhoneNormalized, '9814271847');
  assert.equal(inbound.direction, 'inbound');
  assert.equal(inbound.clientPhoneNormalized, '9814271847');
});

test('normalizes real Beeline v2 statistics payload shape', () => {
  const normalized = normalizePayload({
    abonent: {
      email: 'manager@example.com',
      extension: '200',
      lastName: 'Менеджер',
      phone: '+79215453939',
      userId: '9215453939@vol.nw.ims.mnc099.mcc250.3gppnetwork.org',
    },
    direction: 'OUTBOUND',
    duration: 254200,
    phone_to: '+79814271847',
    startDate: 1779987798000,
    status: 'PLACED',
  });

  assert.equal(normalized.direction, 'outbound');
  assert.equal(normalized.callStatus, 'completed');
  assert.equal(normalized.clientPhone, '+7 (981) 427-18-47');
  assert.equal(normalized.clientPhoneNormalized, '9814271847');
  assert.equal(normalized.employeePhone, '+79215453939');
  assert.equal(normalized.abonentExtension, '200');
  assert.equal(normalized.beelineUserId, '9215453939@vol.nw.ims.mnc099.mcc250.3gppnetwork.org');
  assert.equal(normalized.durationSeconds, 254);
  assert.equal(normalized.startedAt.toISOString(), '2026-05-28T17:03:18.000Z');
});

test('keeps short Beeline statistics durations in milliseconds', () => {
  const normalized = normalizePayload({
    abonent: {
      extension: '200',
      phone: '+79215453939',
      userId: '9215453939@vol.nw.ims.mnc099.mcc250.3gppnetwork.org',
    },
    direction: 'INBOUND',
    duration: 800,
    phone_from: '+79814271847',
    startDate: 1779987798000,
    status: 'RECIEVED',
  });

  assert.equal(normalized.durationSeconds, 1);
});

test('normalizes Beeline recording payload', () => {
  const normalized = normalizeRecordingPayload({
    abonent: {
      extension: '200',
      phone: '9215453939',
      userId: '9215453939@vol.nw.ims.mnc099.mcc250.3gppnetwork.org',
    },
    date: 1779946651443,
    direction: 'INBOUND',
    duration: 5560,
    externalId: 'd90c86b2-950a-491a-8f9c-a09bda5309bc',
    fileSize: 11808,
    id: '551594285',
    phone: '9997918231',
  });

  assert.equal(normalized.recordId, '551594285');
  assert.equal(normalized.recordExternalId, 'd90c86b2-950a-491a-8f9c-a09bda5309bc');
  assert.equal(normalized.recordingStatus, 'available');
  assert.equal(normalized.clientPhone, '+7 (999) 791-82-31');
  assert.equal(normalized.clientPhoneNormalized, '9997918231');
  assert.equal(normalized.direction, 'inbound');
  assert.equal(normalized.durationSeconds, 6);
  assert.equal(normalized.recordingFileSize, 11808);
  assert.equal(normalized.startedAt.toISOString(), '2026-05-28T05:37:31.443Z');
});

test('normalizes missed call events and keeps client phone lookup digits', () => {
  const normalized = normalizePayload({
    callId: 'call-1',
    eventType: 'missed',
    phone: '8 (999) 111-22-33',
  });

  assert.equal(normalized.callStatus, 'missed');
  assert.equal(normalized.clientPhone, '+7 (999) 111-22-33');
  assert.equal(normalized.clientPhoneNormalized, '9991112233');
  assert.equal(normalized.externalCallId, 'call-1');
});

test('does not treat generic id as a recording id', () => {
  const normalized = normalizePayload({
    direction: 'INBOUND',
    id: 'generic-stat-row',
    phone_from: '+7 921 545 39 39',
    startDate: '2026-05-28T12:00:00+03:00',
    status: 'MISSED',
  });

  assert.equal(normalized.externalCallId, null);
  assert.equal(normalized.recordId, null);
  assert.equal(normalized.recordingStatus, 'unknown');
});

test('normalizes Beeline XSI subscription response', () => {
  const normalized = normalizeSubscriptionResponse(
    {
      id: 'xsi-subscription-1',
      status: 'created',
    },
    {
      expires: 3600,
      subscriptionType: 'BASIC_CALL',
    },
  );

  assert.equal(normalized.subscriptionId, 'xsi-subscription-1');
  assert.equal(normalized.status, 'active');
  assert.equal(normalized.expiresSeconds, 3600);
  assert.equal(normalized.subscriptionType, 'BASIC_CALL');
  assert.ok(normalized.expiresAt instanceof Date);
});

test('accepts Beeline XSI XML callback payloads', () => {
  const [payload] = parseIncomingBeelinePayload(
    `<?xml version="1.0" encoding="UTF-8"?>
    <xsi:Event xmlns:xsi="http://schema.broadsoft.com/xsi">
      <xsi:eventData xsi:type="xsi:CallEvent">
        <xsi:callId>xsi-call-1</xsi:callId>
        <xsi:extTrackingId>xsi-track-1</xsi:extTrackingId>
        <xsi:personality>Terminator</xsi:personality>
        <xsi:state>Alerting</xsi:state>
        <xsi:startTime>2026-05-29T12:00:00+03:00</xsi:startTime>
        <xsi:remoteAddress>tel:+79814271847</xsi:remoteAddress>
        <xsi:extension>200</xsi:extension>
      </xsi:eventData>
    </xsi:Event>`,
    { 'content-type': 'application/xml' },
  );
  const normalized = normalizePayload(payload);

  assert.equal(payload.contentType, 'application/xml');
  assert.equal(normalized.direction, 'inbound');
  assert.equal(normalized.callStatus, 'ringing');
  assert.equal(normalized.externalCallId, 'xsi-call-1');
  assert.equal(normalized.externalTrackingId, 'xsi-track-1');
  assert.equal(normalized.clientPhoneNormalized, '9814271847');
  assert.equal(normalized.abonentExtension, '200');
  assert.equal(normalized.startedAt.toISOString(), '2026-05-29T09:00:00.000Z');
});

test('normalizes Beeline XSI received event with nested endpoint parties', () => {
  const [payload] = parseIncomingBeelinePayload(
    `<?xml version="1.0" encoding="UTF-8"?>
    <xsi:Event xmlns:xsi="http://schema.broadsoft.com/xsi">
      <xsi:eventData xsi:type="xsi:CallReceivedEvent">
        <xsi:callId>xsi-call-2</xsi:callId>
        <xsi:personality>Terminator</xsi:personality>
        <xsi:startTime>2026-05-29T12:00:00+03:00</xsi:startTime>
        <xsi:remoteParty>
          <xsi:address>tel:+79814271847</xsi:address>
        </xsi:remoteParty>
        <xsi:endpoint>
          <xsi:address>sip:9215453939@vol.nw.ims.mnc099.mcc250.3gppnetwork.org</xsi:address>
        </xsi:endpoint>
        <xsi:extension>200</xsi:extension>
      </xsi:eventData>
    </xsi:Event>`,
    { 'content-type': 'application/xml' },
  );
  const normalized = normalizePayload(payload);

  assert.equal(normalized.direction, 'inbound');
  assert.equal(normalized.callStatus, 'ringing');
  assert.equal(normalized.clientPhoneNormalized, '9814271847');
  assert.equal(normalized.employeePhone, '9215453939');
});

test('normalizes Beeline XSI released event as completed', () => {
  const [payload] = parseIncomingBeelinePayload(
    `<?xml version="1.0" encoding="UTF-8"?>
    <xsi:Event xmlns:xsi="http://schema.broadsoft.com/xsi">
      <xsi:eventData xsi:type="xsi:CallReleasedEvent">
        <xsi:callId>xsi-call-3</xsi:callId>
        <xsi:personality>Terminator</xsi:personality>
        <xsi:startTime>2026-05-29T12:00:00+03:00</xsi:startTime>
        <xsi:remoteParty>
          <xsi:address>tel:+79814271847</xsi:address>
        </xsi:remoteParty>
      </xsi:eventData>
    </xsi:Event>`,
    { 'content-type': 'application/xml' },
  );
  const normalized = normalizePayload(payload);

  assert.equal(normalized.callStatus, 'completed');
  assert.equal(normalized.clientPhoneNormalized, '9814271847');
});

test('accepts Beeline XSI subscription XML as service event payload', () => {
  const [payload] = parseIncomingBeelinePayload(
    `<?xml version="1.0" encoding="UTF-8"?>
    <xsi:Event xmlns:xsi="http://schema.broadsoft.com/xsi">
      <xsi:eventData xsi:type="xsi:SubscriptionEvent">
        <xsi:subscriptionId>deploy-check</xsi:subscriptionId>
      </xsi:eventData>
    </xsi:Event>`,
    { 'content-type': 'application/xml' },
  );
  const normalized = normalizePayload(payload);

  assert.equal(payload.eventType, 'xsi:SubscriptionEvent');
  assert.equal(payload.contentType, 'application/xml');
  assert.equal(normalized.eventType, 'xsi:SubscriptionEvent');
  assert.equal(normalized.externalCallId, null);
  assert.equal(normalized.clientPhoneNormalized, null);
});
