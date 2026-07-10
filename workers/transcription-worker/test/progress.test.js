const assert = require('node:assert/strict');
const test = require('node:test');
const { processJob } = require('../src/index');

test('Node production worker reports every CRM progress stage and ignores heartbeat failures', async () => {
  const stages = [];
  const warnings = [];
  let completed = false;
  const crmClient = {
    async completeJob() {
      completed = true;
    },
    async updateProgress(_jobId, stage, progress) {
      stages.push({ progress, stage });
      if (stage === 'ffmpeg_preprocess') throw new Error('progress endpoint unavailable');
    },
  };
  const logger = {
    info() {},
    warn(message, details) {
      warnings.push({ details, message });
    },
  };
  const config = {
    asrBackend: 'http_asr',
    asrInitialPrompt: null,
    asrInitialPromptEnabled: false,
    asrProfile: 'default',
    asrQualityFallbackEnabled: false,
    asrWordTimestamps: false,
    channelAdmin: 'left',
    channelClient: 'right',
    chunkMaxSeconds: 45,
    chunkMinSpeechSeconds: 1,
    chunkPaddingMs: 200,
    chunkSilenceDetectionEnabled: false,
    deleteAudioAfter: false,
    domainGlossary: { aliases: [], canonicalTerms: [] },
    silenceMinDurationSeconds: 1.2,
    silenceNoiseDb: 45,
  };
  const dependencies = {
    async createTempDir() { return '/tmp/progress-test'; },
    async downloadJobAudio() {
      return { bytes: 10, contentType: 'audio/wav', filePath: '/tmp/input.wav' };
    },
    async prepareAudio() {
      return { mode: 'stereo', channels: [{ name: 'left' }, { name: 'right' }, { name: 'mono' }] };
    },
    async probeAudio() {
      return { channelLayout: 'stereo', channels: 2, codec: 'pcm', durationSeconds: 5 };
    },
    async transcribePreparedChannel(channel) {
      return { channel: channel.name, durationMs: 1, segments: [] };
    },
    buildTranscriptResult() {
      return { segments: [], transcriptText: 'ok' };
    },
    async postprocessTranscriptWithLlm(result) { return result; },
  };

  await processJob(crmClient, { id: 77, telephonyCallId: 107 }, config, logger, dependencies);

  assert.equal(completed, true);
  assert.deepEqual(stages.map((item) => item.stage), [
    'downloading_audio',
    'ffmpeg_preprocess',
    'transcribing_admin_channel',
    'transcribing_client_channel',
    'transcribing_unknown_channel',
    'merging_segments',
    'ai_postprocessing',
    'uploading_result',
  ]);
  assert.equal(stages.every((item) => Number.isInteger(item.progress)), true);
  const heartbeatWarnings = warnings.filter((item) => item.message === 'CRM progress heartbeat failed');
  assert.equal(heartbeatWarnings.length, 1);
  assert.equal(heartbeatWarnings[0].details.stage, 'ffmpeg_preprocess');
});
