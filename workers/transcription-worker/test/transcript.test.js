const assert = require('node:assert/strict');
const test = require('node:test');
const { parseAsrResponse } = require('../src/asr-http');
const {
  buildQualityWarnings,
  buildTranscriptResult,
  formatTime,
  parseWhisperOutput,
  speakerForChannel,
} = require('../src/transcript');
const { readConfig } = require('../src/config');
const { normalizeGlossary } = require('../src/glossary');

const config = readConfig(
  {
    ASR_BACKEND: 'whisper_cpp',
    CHANNEL_ADMIN: 'left',
    CHANNEL_CLIENT: 'right',
    CRM_API_URL: 'http://crm.test/api',
    CRM_WORKER_TOKEN: 'secret',
    WHISPER_MODEL: 'small',
  },
  [],
);
const qualityConfig = {
  ...config,
  domainGlossary: normalizeGlossary({
    aliases: [
      {
        aliases: ['подал парк', 'падал парк', 'падел парк', 'петал парк', 'папарк', 'попарк', 'па парк'],
        canonical: 'Падел Парк',
        rule: 'padel_park_alias',
      },
      {
        aliases: ['падлу', 'падла', 'подлу', 'падл'],
        canonical: 'падел',
        contextAny: ['записаться', 'корт', 'играть', 'тренировка'],
        rule: 'padel_alias',
      },
    ],
  }),
};

test('parses whisper.cpp timestamped output', () => {
  const parsed = parseWhisperOutput(`
whisper_init_from_file_with_params_no_state: loading model
[00:00:01.250 --> 00:00:04.200]  Добрый день, Падел Парк.
[00:00:04.300 --> 00:00:08.700]  Здравствуйте, хочу записаться.
`);

  assert.equal(parsed.length, 2);
  assert.deepEqual(parsed[0], {
    endMs: 4200,
    startMs: 1250,
    text: 'Добрый день, Падел Парк.',
  });
});

test('maps env-configured stereo channels to CRM speakers', () => {
  assert.equal(speakerForChannel('left', config), 'administrator');
  assert.equal(speakerForChannel('right', config), 'client');
  assert.equal(speakerForChannel('mono', config), 'unknown');
});

test('combines left and right channel transcript by timestamps', () => {
  const result = buildTranscriptResult(
    [
      {
        channel: 'left',
        segments: [
          { endMs: 3000, startMs: 1000, text: 'Добрый день.' },
          { endMs: 9000, startMs: 8000, text: 'Подберу время.' },
        ],
      },
      {
        channel: 'right',
        segments: [
          { endMs: 6000, startMs: 4000, text: 'Хочу забронировать корт.' },
        ],
      },
    ],
    {
      channelLayout: 'stereo',
      channels: 2,
      codec: 'mp3',
      durationSeconds: 10,
    },
    config,
    { jobId: 17 },
  );

  assert.equal(result.segments.length, 3);
  assert.equal(result.segments[0].speaker, 'administrator');
  assert.equal(result.segments[0].channel, 'left');
  assert.equal(result.segments[1].speaker, 'client');
  assert.equal(result.segments[1].channel, 'right');
  assert.equal(result.segments[2].speaker, 'administrator');
  assert.equal(result.segments[2].channel, 'left');
  assert.equal(result.transcriptText, [
    '[00:01] Администратор: Добрый день.',
    '[00:04] Клиент: Хочу забронировать корт.',
    '[00:08] Администратор: Подберу время.',
  ].join('\n'));
  assert.equal(result.metadata.channelMapping.administrator, 'left');
  assert.equal(result.metadata.jobId, 17);
  assert.deepEqual(result.metadata.qualityWarnings, []);
});

test('builds compact quality warnings from normalization corrections', () => {
  const warnings = buildQualityWarnings(
    [
      { type: 'subtitle_outro_drop' },
      { type: 'asr_gibberish_drop' },
      { type: 'domain_term' },
    ],
    [{ text: 'Добрый день.' }, { text: 'Здравствуйте.' }, { text: 'Записали.' }],
  );

  assert.deepEqual(
    warnings.map((warning) => warning.code),
    [
      'subtitle_hallucinations_removed',
      'gibberish_segments_removed',
      'automatic_domain_normalization',
    ],
  );
});

test('keeps ASR chunk offsets as absolute timestamps before merge', () => {
  const parsed = parseAsrResponse(
    {
      segments: [
        { end: 2.25, start: 0.5, text: 'Хочу забронировать корт.' },
      ],
      text: 'Хочу забронировать корт.',
    },
    { durationMs: 3000, offsetMs: 62000 },
  );
  const result = buildTranscriptResult(
    [
      {
        channel: 'left',
        segments: [{ endMs: 61000, startMs: 60000, text: 'Добрый день.' }],
      },
      {
        channel: 'right',
        segments: parsed.segments,
      },
    ],
    {
      channelLayout: 'stereo',
      channels: 2,
      codec: 'mp3',
      durationSeconds: 90,
    },
    config,
  );

  assert.equal(parsed.segments[0].startMs, 62500);
  assert.deepEqual(result.segments.map((segment) => segment.startMs), [60000, 62500]);
  assert.equal(result.segments[1].speaker, 'client');
});

test('keeps zero millisecond stereo segments at the beginning', () => {
  const result = buildTranscriptResult(
    [
      {
        channel: 'left',
        segments: [
          { endMs: 5200, startMs: 4000, text: 'Подберу время.' },
          { endMs: 1500, startMs: 0, text: 'Добрый день.' },
        ],
      },
      {
        channel: 'right',
        segments: [
          { endMs: 1700, startMs: 0, text: 'Здравствуйте.' },
        ],
      },
    ],
    {
      channelLayout: 'stereo',
      channels: 2,
      codec: 'mp3',
      durationSeconds: 6,
    },
    config,
  );

  assert.deepEqual(result.segments.map((segment) => segment.startMs), [0, 0, 4000]);
  const lines = result.transcriptText.split('\n');
  assert.ok(lines[0].startsWith('[00:00] Администратор:'));
  assert.ok(lines[1].startsWith('[00:00] Клиент:'));
});

test('preserves raw transcript while normalized transcript drops outro and corrects terms', () => {
  const result = buildTranscriptResult(
    [
      {
        channel: 'left',
        segments: [
          { endMs: 2000, startMs: 1000, text: 'Добрый день, Папа, слушаю вас.' },
          { endMs: 9000, startMs: 8000, text: 'Продолжение следует.' },
          { endMs: 10400, startMs: 9400, text: 'Редактор суббота Корректор А.Кулакова' },
          { endMs: 11800, startMs: 11200, text: 'Д brц! Диа, диа, вагер на! Ага, имя!' },
        ],
      },
      {
        channel: 'right',
        segments: [
          { endMs: 5200, startMs: 3000, text: 'Хочу записаться на падлу.' },
          { endMs: 11400, startMs: 10800, text: 'Субтитры создавал DimaTorzok' },
          { endMs: 12400, startMs: 12000, text: 'ЧИ ЧИ НЕ ВА' },
        ],
      },
    ],
    {
      channelLayout: 'stereo',
      channels: 2,
      codec: 'mp3',
      durationSeconds: 12,
    },
    qualityConfig,
  );

  assert.match(result.rawTranscriptText, /Продолжение следует/);
  assert.match(result.rawTranscriptText, /Папа/);
  assert.match(result.rawTranscriptText, /падлу/);
  assert.match(result.rawTranscriptText, /ЧИ ЧИ НЕ ВА/);
  assert.doesNotMatch(result.transcriptText, /Продолжение следует|Редактор|Корректор|Субтитры создавал|ЧИ ЧИ НЕ ВА|brц/);
  assert.match(result.transcriptText, /Падел Парк/);
  assert.match(result.transcriptText, /падел/);
  assert.equal(result.segments.length, 2);
  assert.equal(result.segments.every((segment) => segment.speaker && segment.channel), true);
  assert.equal(result.segments.every((segment) => Number.isFinite(segment.startMs)), true);
  assert.equal(result.segments.every((segment) => Number.isFinite(segment.endMs)), true);
  assert.deepEqual(
    result.corrections.map((correction) => correction.type),
    [
      'greeting_normalization',
      'domain_term',
      'subtitle_outro_drop',
      'subtitle_outro_drop',
      'asr_gibberish_drop',
      'asr_gibberish_drop',
    ],
  );
  assert.deepEqual(
    result.metadata.qualityWarnings.map((warning) => warning.code),
    [
      'subtitle_hallucinations_removed',
      'gibberish_segments_removed',
      'automatic_domain_normalization',
    ],
  );
});

test('merges adjacent short segments only inside the same channel speaker lane', () => {
  const result = buildTranscriptResult(
    [
      {
        channel: 'left',
        segments: [
          { endMs: 1600, startMs: 1000, text: 'Да,' },
          { endMs: 2400, startMs: 1800, text: 'слушаю вас.' },
        ],
      },
      {
        channel: 'right',
        segments: [
          { endMs: 3500, startMs: 2600, text: 'Здравствуйте.' },
        ],
      },
    ],
    {
      channelLayout: 'stereo',
      channels: 2,
      codec: 'mp3',
      durationSeconds: 4,
    },
    config,
  );

  assert.equal(result.segments.length, 2);
  assert.equal(result.segments[0].speaker, 'administrator');
  assert.equal(result.segments[0].channel, 'left');
  assert.equal(result.segments[0].text, 'Да, слушаю вас.');
  assert.equal(result.segments[1].speaker, 'client');
});

test('formats long timestamps with hours', () => {
  assert.equal(formatTime(3_723_000), '01:02:03');
});

test('rejects duplicate admin/client channel mapping', () => {
  assert.throws(
    () =>
      readConfig(
        {
          ASR_BACKEND: 'whisper_cpp',
          CHANNEL_ADMIN: 'left',
          CHANNEL_CLIENT: 'left',
          CRM_API_URL: 'http://crm.test/api',
          CRM_WORKER_TOKEN: 'secret',
          WHISPER_MODEL: 'small',
        },
        [],
      ),
    /different channels/,
  );
});
