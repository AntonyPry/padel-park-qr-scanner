const os = require('node:os');
const path = require('node:path');

const ALLOWED_BACKENDS = new Set(['http_asr', 'whisper_cpp']);
const ALLOWED_MODELS = new Set(['base', 'small', 'medium']);
const ALLOWED_CHANNELS = new Set(['left', 'right']);

function normalizeText(value) {
  const text = String(value || '').trim();
  return text || null;
}

function parseBoolean(value, defaultValue) {
  if (value === undefined || value === null || value === '') return defaultValue;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
  return defaultValue;
}

function parsePositiveInteger(value, defaultValue, min = 1) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < min) return defaultValue;
  return Math.round(number);
}

function parsePositiveNumber(value, defaultValue, min = 0) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < min) return defaultValue;
  return number;
}

function getArgValue(args, name) {
  const prefixed = `${name}=`;
  const inline = args.find((arg) => arg.startsWith(prefixed));
  if (inline) return inline.slice(prefixed.length);

  const index = args.indexOf(name);
  if (index >= 0 && args[index + 1] && !args[index + 1].startsWith('--')) {
    return args[index + 1];
  }

  return null;
}

function normalizeChannel(value, envName) {
  const channel = String(value || '').trim().toLowerCase();
  if (!ALLOWED_CHANNELS.has(channel)) {
    throw new Error(`${envName} must be "left" or "right"`);
  }
  return channel;
}

function readConfig(env = process.env, args = process.argv.slice(2)) {
  const sampleAudioPath =
    normalizeText(getArgValue(args, '--sample-audio')) ||
    normalizeText(env.SAMPLE_AUDIO_PATH);
  const asrBackend = normalizeText(env.ASR_BACKEND) || 'http_asr';
  if (!ALLOWED_BACKENDS.has(asrBackend)) {
    throw new Error('ASR_BACKEND must be "http_asr" or "whisper_cpp"');
  }

  const whisperModel = normalizeText(env.WHISPER_MODEL) || 'small';
  if (!ALLOWED_MODELS.has(whisperModel)) {
    throw new Error('WHISPER_MODEL must be "base", "small" or "medium"');
  }

  const channelAdmin = normalizeChannel(env.CHANNEL_ADMIN || 'left', 'CHANNEL_ADMIN');
  const channelClient = normalizeChannel(env.CHANNEL_CLIENT || 'right', 'CHANNEL_CLIENT');
  if (channelAdmin === channelClient) {
    throw new Error('CHANNEL_ADMIN and CHANNEL_CLIENT must point to different channels');
  }

  const cpuCount = Math.max(1, os.cpus().length || 1);
  const threads = parsePositiveInteger(
    env.WHISPER_THREADS,
    Math.max(1, Math.min(cpuCount - 1 || 1, 6)),
  );
  const runOnce = args.includes('--once') || parseBoolean(env.RUN_ONCE, false);

  const config = {
    asrBackend,
    asrBaseUrl:
      normalizeText(env.ASR_BASE_URL) ||
      normalizeText(env.TRANSCRIBER_BASE_URL) ||
      'http://10.8.0.2:9000',
    asrInitialPromptEnabled: parseBoolean(env.ASR_INITIAL_PROMPT_ENABLED, true),
    asrOutput: normalizeText(env.ASR_OUTPUT) || 'json',
    asrProfile: normalizeText(env.ASR_PROFILE) || 'default',
    asrQualityBaseUrl:
      normalizeText(env.ASR_QUALITY_BASE_URL) ||
      normalizeText(env.TRANSCRIBER_QUALITY_BASE_URL),
    asrQualityFallbackEnabled: parseBoolean(env.ASR_QUALITY_FALLBACK_ENABLED, true),
    asrTask: normalizeText(env.ASR_TASK) || 'transcribe',
    asrTimeoutMs: parsePositiveInteger(env.ASR_TIMEOUT_SECONDS, 15 * 60, 10) * 1000,
    asrVadFilter: false,
    asrWordTimestamps: parseBoolean(env.ASR_WORD_TIMESTAMPS, false),
    channelAdmin,
    channelClient,
    chunkMaxSeconds: parsePositiveNumber(env.ASR_CHUNK_MAX_SECONDS, 45, 5),
    chunkMinSpeechSeconds: parsePositiveNumber(env.ASR_CHUNK_MIN_SPEECH_SECONDS, 0.45, 0.1),
    chunkPaddingMs: parsePositiveInteger(env.ASR_CHUNK_PADDING_MS, 250, 0),
    chunkSilenceDetectionEnabled: parseBoolean(env.ASR_SILENCE_DETECTION_ENABLED, true),
    commandTimeoutMs: parsePositiveInteger(
      env.COMMAND_TIMEOUT_SECONDS,
      60 * 60,
      10,
    ) * 1000,
    crmApiUrl: normalizeText(env.CRM_API_URL),
    crmWorkerToken:
      normalizeText(env.CRM_WORKER_TOKEN) ||
      normalizeText(env.TELEPHONY_TRANSCRIPTION_WORKER_TOKEN) ||
      normalizeText(env.TRANSCRIPTION_WORKER_TOKEN),
    deleteAudioAfter: parseBoolean(env.DELETE_AUDIO_AFTER, true),
    domainGlossaryPath: normalizeText(env.ASR_DOMAIN_GLOSSARY_PATH),
    downloadTimeoutMs: parsePositiveInteger(
      env.DOWNLOAD_TIMEOUT_SECONDS,
      5 * 60,
      5,
    ) * 1000,
    pollIntervalMs: parsePositiveInteger(env.POLL_INTERVAL_SECONDS, 10, 1) * 1000,
    runOnce,
    sampleAudioPath,
    tempRoot: normalizeText(env.WORKER_TMP_DIR) || os.tmpdir(),
    whisperBinary: normalizeText(env.WHISPER_CPP_BINARY) || 'whisper-cli',
    whisperCppDir: normalizeText(env.WHISPER_CPP_DIR) || '/opt/whisper.cpp',
    whisperLanguage: normalizeText(env.WHISPER_LANGUAGE) || 'ru',
    whisperModel,
    whisperModelCacheDir:
      normalizeText(env.WHISPER_MODEL_CACHE_DIR) ||
      normalizeText(env.MODEL_CACHE_DIR) ||
      '/models',
    whisperThreads: threads,
    silenceMinDurationSeconds: parsePositiveNumber(
      env.ASR_SILENCE_MIN_DURATION_SECONDS,
      1.2,
      0.2,
    ),
    silenceNoiseDb: parsePositiveNumber(env.ASR_SILENCE_NOISE_DB, 45, 1),
    workerId:
      normalizeText(env.WORKER_ID) ||
      `transcription-worker-${os.hostname()}`,
  };

  config.whisperModelPath = path.join(
    config.whisperModelCacheDir,
    `ggml-${config.whisperModel}.bin`,
  );

  if (!sampleAudioPath) {
    if (!config.crmApiUrl) throw new Error('CRM_API_URL is required');
    if (!config.crmWorkerToken) throw new Error('CRM_WORKER_TOKEN is required');
  }

  return config;
}

module.exports = {
  readConfig,
};
