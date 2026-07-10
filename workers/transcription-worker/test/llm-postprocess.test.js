const assert = require('node:assert/strict');
const test = require('node:test');
const { readConfig } = require('../src/config');
const {
  applyLlmEditsToTranscript,
  postprocessTranscriptWithLlm,
} = require('../src/llm-postprocess');

function config(overrides = {}) {
  return readConfig(
    {
      ASR_BACKEND: 'http_asr',
      CRM_API_URL: 'http://crm.test/api',
      CRM_WORKER_TOKEN: 'secret',
      TRANSCRIPTION_AI_POSTPROCESSING_ENABLED: 'true',
      TRANSCRIPTION_LLM_BASE_URL: 'http://llm.test',
      TRANSCRIPTION_LLM_FALLBACK_ENABLED: 'true',
      TRANSCRIPTION_LLM_MODEL: 'qwen2.5:7b',
      TRANSCRIPTION_LLM_RETRY_COUNT: '0',
      TRANSCRIPTION_LLM_TIMEOUT_SECONDS: '5',
      ...overrides,
    },
    [],
  );
}

const transcript = {
  language: 'ru',
  segments: [
    {
      channel: 'left',
      endMs: 2400,
      sortOrder: 0,
      speaker: 'administrator',
      startMs: 0,
      text: 'Добрый день, Падел Парк.',
    },
    {
      channel: 'right',
      endMs: 6200,
      sortOrder: 1,
      speaker: 'client',
      startMs: 3000,
      text: 'Можно корт заманировать на семь?',
    },
  ],
  transcriptText: 'Добрый день, Падел Парк.\nМожно корт заманировать на семь?',
};

test('applies LLM edits by segmentId while preserving CRM role and timings', () => {
  const result = applyLlmEditsToTranscript(transcript, {
    segments: [
      {
        changes: [['заманировать -> забронировать'], null],
        confidence: 'high',
        editedText: 'Можно корт забронировать на семь?',
        endMs: 1,
        segmentId: 's2',
        speaker: 'wrong-speaker',
        startMs: 999999,
      },
      {
        changes: ['ignored'],
        editedText: 'Неизвестный сегмент',
        segmentId: 's404',
      },
    ],
    warnings: ['ok'],
  });

  assert.equal(result.aiTranscriptSegments.length, 2);
  assert.equal(result.aiTranscriptSegments[1].text, 'Можно корт забронировать на семь?');
  assert.equal(result.aiTranscriptSegments[1].speaker, 'client');
  assert.equal(result.aiTranscriptSegments[1].startMs, 3000);
  assert.equal(result.aiTranscriptSegments[1].endMs, 6200);
  assert.deepEqual(result.aiTranscriptSegments[1].changes, [
    'заманировать -> забронировать',
  ]);
  assert.deepEqual(result.aiMetadata.ignoredUnknownSegmentIds, ['s404']);
  assert.deepEqual(result.aiMetadata.missingSegmentIds, ['s1']);
  assert.equal(result.aiCorrections[0].type, 'llm_edit');
});

test('rejects unsafe LLM artifacts and keeps the normalized segment text', () => {
  const result = applyLlmEditsToTranscript(transcript, {
    segments: [
      {
        editedText: 'Контекст: звонок клиента в клуб.',
        segmentId: 's1',
      },
      {
        editedText: 'Продолжение следует.',
        segmentId: 's2',
      },
    ],
  });

  assert.equal(result.aiTranscriptSegments[0].text, 'Добрый день, Падел Парк.');
  assert.equal(result.aiTranscriptSegments[1].text, 'Можно корт заманировать на семь?');
  assert.deepEqual(result.aiMetadata.rejectedSegmentIds, ['s1', 's2']);
  assert.equal(result.aiCorrections.length, 0);
});

test('LLM outage does not fail postprocessing result', async () => {
  const result = await postprocessTranscriptWithLlm(
    transcript,
    config(),
    null,
    async () => {
      throw new Error('connect ECONNREFUSED');
    },
  );

  assert.equal(result.transcriptText, transcript.transcriptText);
  assert.equal(result.aiMetadata.status, 'failed');
  assert.match(result.aiMetadata.error, /ECONNREFUSED/);
  assert.deepEqual(result.aiTranscriptSegments, []);
});

test('calls Ollama JSON endpoint and stores AI edited transcript', async () => {
  let requestBody = null;
  const result = await postprocessTranscriptWithLlm(
    transcript,
    config(),
    null,
    async (_url, request) => {
      requestBody = JSON.parse(request.body);
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({
            response: JSON.stringify({
              segments: [
                {
                  changes: [],
                  confidence: 'high',
                  editedText: 'Добрый день, Падел Парк.',
                  segmentId: 's1',
                },
                {
                  changes: ['корт заманировать -> корт забронировать'],
                  confidence: 'high',
                  editedText: 'Можно корт забронировать на семь?',
                  segmentId: 's2',
                },
              ],
              warnings: [],
            }),
          });
        },
      };
    },
  );

  assert.equal(requestBody.model, 'qwen2.5:7b');
  assert.match(requestBody.prompt, /корт заманировать/);
  assert.match(result.aiTranscriptText, /корт забронировать/);
  assert.equal(result.aiMetadata.status, 'completed');
  assert.equal(result.aiCorrections.length, 1);
});
