const assert = require('node:assert/strict');
const { afterEach, test } = require('node:test');
const db = require('../../models');
const {
  getWorkerTranscriptionQueue,
  listTranscriptionJobs,
  mapCall,
  mapTranscriptionJob,
  normalizePayload,
  normalizeRecordingPayload,
  normalizeSubscriptionResponse,
  normalizeTranscriptSegments,
  parseIncomingBeelinePayload,
} = require('../../src/services/telephony.service');

const originalTranscriptionJobCount = db.TelephonyTranscriptionJob.count;
const originalTranscriptionJobFindAndCountAll = db.TelephonyTranscriptionJob.findAndCountAll;
const originalTranscriptionJobFindAll = db.TelephonyTranscriptionJob.findAll;

afterEach(() => {
  db.TelephonyTranscriptionJob.count = originalTranscriptionJobCount;
  db.TelephonyTranscriptionJob.findAndCountAll = originalTranscriptionJobFindAndCountAll;
  db.TelephonyTranscriptionJob.findAll = originalTranscriptionJobFindAll;
});

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

test('normalizes transcription result segments for CRM transcript view', () => {
  const normalized = normalizeTranscriptSegments({
    corrections: [
      {
        original: 'подал теннис',
        normalized: 'падел-теннис',
        rule: 'padel_tennis_alias',
      },
    ],
    language: 'ru',
    rawAsrJson: {
      channels: [
        {
          channel: 'left',
          parsedSegments: [
            {
              text: 'Добрый день, Падел Парк.',
              words: [
                { endMs: 1500, startMs: 1250, text: 'Добрый' },
                { endMs: 1900, startMs: 1520, text: 'день,' },
              ],
            },
          ],
          rawResponses: [{ text: 'Добрый день, Падел Парк.' }],
        },
      ],
    },
    rawTranscriptText: 'Администратор: Добрый день, Падел Парк.',
    transcriptText: [
      'Поздняя реплика клиента.',
      'Реплика без времени идет после реплик с startMs.',
      'Добрый день, Падел Парк.',
    ].join('\n'),
    segments: [
      {
        channel: 'right',
        endMs: 8700,
        role: 'customer',
        startMs: 4300,
        text: 'Здравствуйте, хочу записаться.',
      },
      {
        channel: 'left',
        confidence: 0.91,
        end: 4.2,
        speaker: 'operator',
        start: 1.25,
        text: 'Добрый день, Падел Парк.',
      },
      {
        speaker: 'noise',
        text: '   ',
      },
      {
        sortOrder: 99,
        speaker: 'unknown',
        text: 'Реплика без времени идет после реплик с startMs.',
      },
    ],
  });

  assert.equal(normalized.language, 'ru');
  assert.equal(normalized.rawTranscriptText, 'Администратор: Добрый день, Падел Парк.');
  assert.equal(normalized.rawAsrJson.channels[0].channel, 'left');
  assert.equal(normalized.rawAsrJson.channels[0].parsedSegments[0].words[0].text, 'Добрый');
  assert.deepEqual(normalized.corrections, [
    {
      original: 'подал теннис',
      normalized: 'падел-теннис',
      rule: 'padel_tennis_alias',
    },
  ]);
  assert.equal(normalized.segments.length, 3);
  assert.equal(normalized.segments[0].speaker, 'administrator');
  assert.equal(normalized.segments[0].channel, 'left');
  assert.equal(normalized.segments[0].startMs, 1250);
  assert.equal(normalized.segments[0].endMs, 4200);
  assert.equal(normalized.segments[0].sortOrder, 0);
  assert.equal(normalized.segments[1].speaker, 'client');
  assert.equal(normalized.segments[1].channel, 'right');
  assert.equal(normalized.segments[1].startMs, 4300);
  assert.equal(normalized.segments[1].sortOrder, 1);
  assert.equal(normalized.segments[2].speaker, 'unknown');
  assert.equal(normalized.segments[2].startMs, null);
  assert.equal(normalized.segments[2].sortOrder, 2);
  assert.equal(normalized.transcriptText, [
    'Добрый день, Падел Парк.',
    'Здравствуйте, хочу записаться.',
    'Реплика без времени идет после реплик с startMs.',
  ].join('\n'));
});

test('normalizes AI transcript layer without trusting LLM roles or timings', () => {
  const normalized = normalizeTranscriptSegments({
    aiMetadata: {
      model: 'qwen2.5:7b',
      status: 'completed',
    },
    aiTranscriptSegments: [
      {
        changes: [['корт заманировать -> корт забронировать'], 123],
        confidence: 'high',
        editedText: 'Можно корт забронировать на семь?',
        endMs: 1,
        segmentId: 's2',
        speaker: 'administrator',
        startMs: 999999,
      },
      {
        changes: ['ignored'],
        editedText: 'Неизвестный сегмент',
        segmentId: 's404',
      },
      {
        editedText: 'Контекст: звонок клиента.',
        segmentId: 's1',
      },
    ],
    segments: [
      {
        channel: 'left',
        endMs: 2400,
        speaker: 'operator',
        startMs: 0,
        text: 'Добрый день, Падел Парк.',
      },
      {
        channel: 'right',
        endMs: 6200,
        speaker: 'customer',
        startMs: 3000,
        text: 'Можно корт заманировать на семь?',
      },
    ],
  });

  assert.equal(normalized.aiTranscriptSegments.length, 2);
  assert.equal(normalized.aiTranscriptSegments[0].text, 'Добрый день, Падел Парк.');
  assert.equal(normalized.aiTranscriptSegments[1].text, 'Можно корт забронировать на семь?');
  assert.equal(normalized.aiTranscriptSegments[1].speaker, 'client');
  assert.equal(normalized.aiTranscriptSegments[1].channel, 'right');
  assert.equal(normalized.aiTranscriptSegments[1].startMs, 3000);
  assert.equal(normalized.aiTranscriptSegments[1].endMs, 6200);
  assert.deepEqual(normalized.aiTranscriptSegments[1].changes, [
    'корт заманировать -> корт забронировать',
  ]);
  assert.deepEqual(normalized.aiMetadata.ignoredUnknownSegmentIds, ['s404']);
  assert.deepEqual(normalized.aiMetadata.rejectedSegmentIds, ['s1']);
  assert.deepEqual(normalized.aiMetadata.missingSegmentIds, ['s1']);
  assert.equal(normalized.aiCorrections.length, 1);
  assert.equal(normalized.aiCorrections[0].segmentId, 's2');
});

test('keeps normalized transcript when AI metadata reports LLM failure', () => {
  const normalized = normalizeTranscriptSegments({
    aiMetadata: {
      error: 'connect ECONNREFUSED',
      status: 'failed',
    },
    segments: [
      {
        speaker: 'customer',
        text: 'Можно корт заманировать на семь?',
      },
    ],
  });

  assert.equal(normalized.transcriptText, 'Можно корт заманировать на семь?');
  assert.equal(normalized.aiMetadata.status, 'failed');
  assert.equal(normalized.aiTranscriptText, null);
  assert.deepEqual(normalized.aiTranscriptSegments, []);
});

test('serializes chronological transcript text from sorted segments', () => {
  const mapped = mapTranscriptionJob(
    {
      attemptCount: 1,
      aiCorrections: [
        {
          original: 'заманировать',
          normalized: 'забронировать',
          segmentId: 's2',
          type: 'llm_edit',
        },
      ],
      aiMetadata: {
        model: 'qwen2.5:7b',
        status: 'completed',
      },
      aiTranscriptSegments: [
        {
          channel: 'right',
          endMs: 96000,
          segmentId: 's3',
          sortOrder: 2,
          speaker: 'client',
          startMs: 90000,
          text: 'Поздняя AI-реплика клиента.',
        },
      ],
      aiTranscriptText: 'Поздняя AI-реплика клиента.',
      id: 77,
      corrections: [
        {
          original: 'код',
          normalized: 'корт',
          rule: 'court_size_context',
        },
      ],
      rawTranscriptText: '[00:00] Администратор: маленький код',
      status: 'completed',
      telephonyCallId: 12,
      transcriptText: [
        'Поздняя реплика клиента.',
        'Средняя реплика.',
        'Первая реплика администратора.',
      ].join('\n'),
      segments: [
        {
          endMs: 96000,
          id: 3,
          sortOrder: 0,
          speaker: 'client',
          startMs: 90000,
          text: 'Поздняя реплика клиента.',
        },
        {
          endMs: 12000,
          id: 1,
          sortOrder: 1,
          speaker: 'administrator',
          startMs: 0,
          text: 'Первая реплика администратора.',
        },
        {
          endMs: 42000,
          id: 2,
          sortOrder: 2,
          speaker: 'unknown',
          startMs: 30000,
          text: 'Средняя реплика.',
        },
      ],
    },
    { includeSegments: true },
  );

  assert.deepEqual(
    mapped.segments.map((segment) => segment.text),
    [
      'Первая реплика администратора.',
      'Средняя реплика.',
      'Поздняя реплика клиента.',
    ],
  );
  assert.equal(mapped.rawTranscriptText, '[00:00] Администратор: маленький код');
  assert.equal(mapped.aiTranscriptText, 'Поздняя AI-реплика клиента.');
  assert.equal(mapped.aiMetadata.model, 'qwen2.5:7b');
  assert.equal(mapped.aiTranscriptSegments[0].segmentId, 's3');
  assert.equal(mapped.aiCorrections[0].type, 'llm_edit');
  assert.deepEqual(mapped.corrections, [
    {
      original: 'код',
      normalized: 'корт',
      rule: 'court_size_context',
    },
  ]);
  assert.equal(
    mapped.transcriptText,
    [
      'Первая реплика администратора.',
      'Средняя реплика.',
      'Поздняя реплика клиента.',
    ].join('\n'),
  );
});

test('hides recording and transcription details from viewer call payloads', () => {
  const mapped = mapCall(
    {
      toJSON() {
        return {
          id: 105,
          callStatus: 'completed',
          clientPhone: '+7 (999) 111-22-33',
          direction: 'inbound',
          durationSeconds: 126,
          processingStatus: 'processed',
          recordExternalId: 'external-record-105',
          recordId: 'record-105',
          recordingExpiresAt: '2026-07-07T12:30:00.000Z',
          recordingFileSize: 204800,
          recordingFileType: 'audio/mpeg',
          recordingStatus: 'available',
          recordingSyncedAt: '2026-07-07T12:00:00.000Z',
          recordingUrl: 'https://recording.example/105.mp3',
          transcriptionJobs: [
            {
              attemptCount: 1,
              corrections: [
                {
                  original: 'подал теннис',
                  normalized: 'падел-теннис',
                  rule: 'padel_tennis_alias',
                },
              ],
              id: 501,
              rawTranscriptText: 'Администратор: подал теннис',
              status: 'completed',
              telephonyCallId: 105,
              transcriptText: 'Администратор: падел-теннис',
            },
          ],
        };
      },
    },
    { role: 'viewer' },
  );

  assert.equal(mapped.recordingStatus, undefined);
  assert.equal(mapped.recordingUrl, undefined);
  assert.equal(mapped.recordingFileSize, undefined);
  assert.equal(mapped.recordingFileType, undefined);
  assert.equal(mapped.recordingExpiresAt, undefined);
  assert.equal(mapped.recordingSyncedAt, undefined);
  assert.equal(mapped.recordId, undefined);
  assert.equal(mapped.recordExternalId, undefined);
  assert.equal(mapped.transcription, undefined);
});

test('lists transcription jobs with chronological transcript text from included segments', async () => {
  let capturedOptions = null;
  db.TelephonyTranscriptionJob.findAndCountAll = async (options) => {
    capturedOptions = options;
    return {
      count: 1,
      rows: [
        {
          toJSON() {
            return {
              attemptCount: 1,
              call: {
                callStatus: 'completed',
                client: {
                  id: 34,
                  name: 'Анна Клиент',
                  phone: '+7 (999) 111-22-33',
                  status: 'active',
                },
                clientPhone: '+7 (999) 111-22-33',
                direction: 'inbound',
                durationSeconds: 96,
                id: 12,
                recordingStatus: 'available',
                staff: {
                  id: 7,
                  name: 'Мария Администратор',
                  role: 'admin',
                },
                startedAt: '2026-06-30T09:00:00.000Z',
              },
              completedAt: '2026-06-30T09:05:00.000Z',
              createdAt: '2026-06-30T09:01:00.000Z',
              id: 77,
              language: 'ru',
              segments: [
                {
                  endMs: 96000,
                  id: 3,
                  sortOrder: 0,
                  speaker: 'client',
                  startMs: 90000,
                  text: 'Поздняя реплика клиента.',
                },
                {
                  endMs: 12000,
                  id: 1,
                  sortOrder: 1,
                  speaker: 'administrator',
                  startMs: 0,
                  text: 'Первая реплика администратора.',
                },
                {
                  endMs: 42000,
                  id: 2,
                  sortOrder: 2,
                  speaker: 'unknown',
                  startMs: 30000,
                  text: 'Средняя реплика.',
                },
              ],
              status: 'completed',
              telephonyCallId: 12,
              transcriptText: [
                'Поздняя реплика клиента.',
                'Средняя реплика.',
                'Первая реплика администратора.',
              ].join('\n'),
              updatedAt: '2026-06-30T09:05:00.000Z',
            };
          },
        },
      ],
    };
  };

  const result = await listTranscriptionJobs({ role: 'owner' }, { status: 'all' });

  assert.ok(capturedOptions);
  assert.ok(capturedOptions.include.some((include) => include.as === 'segments'));
  assert.deepEqual(
    result.items[0].segments.map((segment) => segment.text),
    [
      'Первая реплика администратора.',
      'Средняя реплика.',
      'Поздняя реплика клиента.',
    ],
  );
  assert.equal(
    result.items[0].transcriptText,
    [
      'Первая реплика администратора.',
      'Средняя реплика.',
      'Поздняя реплика клиента.',
    ].join('\n'),
  );
});

test('serializes worker queue transcript text from included segments', async () => {
  const findAllCalls = [];
  db.TelephonyTranscriptionJob.count = async () => 1;
  db.TelephonyTranscriptionJob.findAll = async (options) => {
    findAllCalls.push(options);
    if (options.raw) {
      return [{ count: '1', status: 'completed' }];
    }

    return [
      {
        id: 88,
        status: 'completed',
        toJSON() {
          return {
            attemptCount: 1,
            call: {
              callStatus: 'completed',
              client: {
                id: 44,
                name: 'Анна Клиент',
                phone: '+7 (999) 111-22-33',
                status: 'active',
              },
              clientPhone: '+7 (999) 111-22-33',
              direction: 'inbound',
              durationSeconds: 96,
              id: 13,
              recordingStatus: 'available',
              startedAt: '2026-06-30T09:00:00.000Z',
            },
            completedAt: '2026-06-30T09:05:00.000Z',
            createdAt: '2026-06-30T09:01:00.000Z',
            id: 88,
            language: 'ru',
            segments: [
              {
                endMs: 96000,
                id: 3,
                sortOrder: 0,
                speaker: 'client',
                startMs: 90000,
                text: 'Поздняя реплика клиента.',
              },
              {
                endMs: 12000,
                id: 1,
                sortOrder: 1,
                speaker: 'administrator',
                startMs: 0,
                text: 'Первая реплика администратора.',
              },
            ],
            status: 'completed',
            telephonyCallId: 13,
            transcriptText: [
              'Поздняя реплика клиента.',
              'Первая реплика администратора.',
            ].join('\n'),
            updatedAt: '2026-06-30T09:05:00.000Z',
            workerId: 'mac-worker',
          };
        },
      },
    ];
  };

  const result = await getWorkerTranscriptionQueue({ pageSize: 10 });
  const jobsQuery = findAllCalls.find((options) => Array.isArray(options.include));

  assert.ok(jobsQuery);
  assert.ok(jobsQuery.include.some((include) => include.as === 'segments'));
  assert.deepEqual(
    result.items[0].segments.map((segment) => segment.text),
    ['Первая реплика администратора.', 'Поздняя реплика клиента.'],
  );
  assert.equal(
    result.items[0].transcriptText,
    ['Первая реплика администратора.', 'Поздняя реплика клиента.'].join('\n'),
  );
});

test('keeps transcript text when worker sends no diarized segments', () => {
  const normalized = normalizeTranscriptSegments({
    text: 'Администратор: добрый день.\nКлиент: хочу забронировать корт.',
  });

  assert.equal(normalized.segments.length, 1);
  assert.equal(normalized.segments[0].speaker, 'unknown');
  assert.equal(normalized.transcriptText.includes('Клиент'), true);
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
