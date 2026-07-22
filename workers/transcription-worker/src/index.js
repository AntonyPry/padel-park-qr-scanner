const fsp = require('node:fs/promises');
const crypto = require('node:crypto');
const path = require('node:path');
const { createSpeechChunks, downloadAudio, prepareAudio, probeAudio } = require('./audio');
const { transcribeHttpAsr } = require('./asr-http');
const { runCommand } = require('./commands');
const { readConfig } = require('./config');
const { attachClaimContext, CrmApiError, CrmClient } = require('./crm-client');
const { buildInitialPrompt, loadDomainGlossary } = require('./glossary');
const { createLogger } = require('./logger');
const { postprocessTranscriptWithLlm } = require('./llm-postprocess');
const { buildTranscriptResult } = require('./transcript');
const { ensureWhisperModel, runWhisper } = require('./whisper');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pollingDelayMs(error, defaultDelayMs) {
  if (!(error instanceof CrmApiError) || error.status !== 429) return defaultDelayMs;
  const retryDelayMs = Number(error.retryAfterSeconds) * 1000;
  return Number.isSafeInteger(retryDelayMs) && retryDelayMs > 0
    ? Math.max(defaultDelayMs, retryDelayMs)
    : defaultDelayMs;
}

function getCallId(job) {
  return job?.call?.id || job?.telephonyCallId || null;
}

function normalizePromptValue(value) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text || null;
}

function buildCallPromptContext(job) {
  const call = job?.call || {};
  const clientName = normalizePromptValue(call.client?.name);
  const staffName = normalizePromptValue(call.staff?.name);

  return {
    metadata: {
      hasClientName: Boolean(clientName),
      hasStaffName: Boolean(staffName),
      direction: normalizePromptValue(call.direction),
      durationSeconds: Number.isFinite(Number(call.durationSeconds))
        ? Math.round(Number(call.durationSeconds))
        : null,
    },
  };
}

function truncateErrorMessage(error) {
  const message = error && error.stack ? error.stack : String(error?.message || error);
  return message.slice(0, 4000);
}

const PROGRESS_PERCENT = {
  downloading_audio: 10,
  ffmpeg_preprocess: 25,
  transcribing_admin_channel: 45,
  transcribing_client_channel: 65,
  transcribing_unknown_channel: 55,
  merging_segments: 80,
  ai_postprocessing: 90,
  uploading_result: 97,
};

function progressStageForChannel(channelName, config) {
  if (channelName === config.channelAdmin) return 'transcribing_admin_channel';
  if (channelName === config.channelClient) return 'transcribing_client_channel';
  return 'transcribing_unknown_channel';
}

async function reportProgress(crmClient, job, stage, message, logger) {
  try {
    await crmClient.updateProgress(job, stage, PROGRESS_PERCENT[stage], message);
  } catch (error) {
    logger.warn('CRM progress heartbeat failed', {
      error: error.message,
      jobId: job.id,
      stage,
    });
  }
}

async function loadQualityConfig(config, logger) {
  const glossary = await loadDomainGlossary(config.domainGlossaryPath);
  config.domainGlossary = glossary;
  config.asrInitialPrompt = buildInitialPrompt(glossary);
  logger.info('Loaded transcription domain glossary', {
    aliases: glossary.aliases.length,
    canonicalTerms: glossary.canonicalTerms.length,
    initialPromptChars: config.asrInitialPrompt ? config.asrInitialPrompt.length : 0,
    promptTerms: glossary.promptTerms.length,
  });
}

async function createTempDir(config, job) {
  const tenant = job?.claimContext?.tenant || {};
  const claimId = job?.claimContext?.claimId;
  const fallback = crypto
    .createHash('sha256')
    .update(`legacy-job:${job?.id || 'unknown'}`)
    .digest('hex')
    .slice(0, 24);
  const safe = (value, prefix) => {
    const normalized = String(value || '').trim();
    if (/^[a-z0-9][a-z0-9_-]{7,80}$/i.test(normalized)) return normalized;
    return `${prefix}-${crypto.createHash('sha256').update(normalized || fallback).digest('hex').slice(0, 24)}`;
  };
  const root = path.resolve(config.tempRoot, 'setly-transcription');
  const parent = path.resolve(
    root,
    safe(tenant.organizationKey, 'org'),
    safe(tenant.clubKey, 'club'),
  );
  const attemptDir = path.resolve(parent, safe(claimId, 'attempt'));
  if (!attemptDir.startsWith(`${root}${path.sep}`)) {
    throw new Error('Unsafe transcription attempt namespace');
  }
  await fsp.mkdir(parent, { recursive: true });
  await fsp.mkdir(attemptDir);
  return attemptDir;
}

async function downloadJobAudio(crmClient, job, tempDir, config, logger) {
  const targetPath = path.join(tempDir, 'input.audio');
  const load = async () => {
    const reference = await crmClient.getAudioReference(job);
    return downloadAudio(reference?.audio?.downloadUrl, targetPath, {
      timeoutMs: config.downloadTimeoutMs,
    });
  };

  try {
    return await load();
  } catch (error) {
    if (!error.expired) throw error;
    logger.warn('Audio link is expired or forbidden, refreshing audio-reference once', {
      jobId: job.id,
      status: error.status,
    });
    return load();
  }
}

async function processJob(crmClient, job, config, logger, dependencies = {}) {
  const deps = {
    buildTranscriptResult,
    createTempDir,
    downloadJobAudio,
    ensureWhisperModel,
    postprocessTranscriptWithLlm,
    prepareAudio,
    probeAudio,
    transcribePreparedChannel,
    ...dependencies,
  };
  let tempDir = null;

  try {
    tempDir = await deps.createTempDir(config, job);
    await reportProgress(crmClient, job, 'downloading_audio', 'Downloading recording', logger);
    const downloaded = await deps.downloadJobAudio(crmClient, job, tempDir, config, logger);
    logger.info('Downloaded call recording', {
      bytes: downloaded.bytes,
      contentType: downloaded.contentType,
      jobId: job.id,
    });

    await reportProgress(crmClient, job, 'ffmpeg_preprocess', 'Preparing audio', logger);
    const probe = await deps.probeAudio(downloaded.filePath, runCommand, config);
    logger.info('Audio probe completed', {
      channelLayout: probe.channelLayout,
      channels: probe.channels,
      codec: probe.codec,
      durationSeconds: probe.durationSeconds,
      jobId: job.id,
    });

    const preparedAudio = await deps.prepareAudio(
      downloaded.filePath,
      probe,
      tempDir,
      runCommand,
      config,
    );
    if (preparedAudio.mode === 'mono') {
      logger.warn('Recording is mono; transcript will be saved with unknown speaker', {
        jobId: job.id,
      });
    }

    if (config.asrBackend === 'whisper_cpp') {
      await deps.ensureWhisperModel(config, runCommand, logger);
    }

    const promptContext = buildCallPromptContext(job);
    const jobInitialPrompt = config.asrInitialPrompt;

    const channelResults = [];
    for (const channel of preparedAudio.channels) {
      const channelStage = progressStageForChannel(channel.name, config);
      await reportProgress(crmClient, job, channelStage, 'Transcribing channel', logger);
      channelResults.push(
        await deps.transcribePreparedChannel(channel, probe, tempDir, config, logger, {
          initialPrompt: jobInitialPrompt,
        }),
      );
    }

    await reportProgress(crmClient, job, 'merging_segments', 'Merging transcript segments', logger);
    let result = deps.buildTranscriptResult(channelResults, probe, config, {
      audioDeleted: config.deleteAudioAfter,
      callId: getCallId(job),
      jobId: job.id,
      preparedAudioMode: preparedAudio.mode,
      asr: {
        baseUrl: config.asrBaseUrl,
        initialPromptEnabled: config.asrInitialPromptEnabled,
        profile: config.asrProfile,
        qualityBaseUrl: config.asrQualityBaseUrl || null,
        qualityFallbackEnabled: config.asrQualityFallbackEnabled,
        vadFilter: false,
        wordTimestamps: config.asrWordTimestamps,
      },
      chunking: {
        maxSeconds: config.chunkMaxSeconds,
        minSpeechSeconds: config.chunkMinSpeechSeconds,
        paddingMs: config.chunkPaddingMs,
        silenceDetectionEnabled: config.chunkSilenceDetectionEnabled,
        silenceMinDurationSeconds: config.silenceMinDurationSeconds,
        silenceNoiseDb: -Math.abs(Number(config.silenceNoiseDb || 45)),
      },
      glossary: {
        aliases: config.domainGlossary?.aliases?.length || 0,
        canonicalTerms: config.domainGlossary?.canonicalTerms?.length || 0,
        initialPrompt: jobInitialPrompt || null,
      },
      promptContext: promptContext.metadata,
      whisperDurationsMs: Object.fromEntries(
        channelResults.map((item) => [item.channel, item.durationMs]),
      ),
    });
    await reportProgress(crmClient, job, 'ai_postprocessing', 'Running AI postprocessing', logger);
    result = await deps.postprocessTranscriptWithLlm(result, config, logger);

    await reportProgress(crmClient, job, 'uploading_result', 'Submitting transcript to CRM', logger);
    await crmClient.completeJob(job, result);
    logger.info('Submitted transcription result to CRM', {
      jobId: job.id,
      segments: result.segments.length,
    });

    return result;
  } finally {
    if (tempDir && config.deleteAudioAfter) {
      await fsp.rm(tempDir, { force: true, recursive: true });
      logger.info('Deleted temporary audio files', { jobId: job.id });
    } else if (tempDir) {
      logger.warn('Temporary audio files were kept because DELETE_AUDIO_AFTER=false', {
        jobId: job.id,
      });
    }
  }
}

async function transcribePreparedChannel(channel, probe, tempDir, config, logger, options = {}) {
  const chunks = await createSpeechChunks(channel, probe, tempDir, runCommand, config);
  logger.info('Prepared speech chunks for channel', {
    channel: channel.name,
    chunks: chunks.length,
    silenceDetection: config.chunkSilenceDetectionEnabled,
  });

  if (chunks.length === 0) {
    return {
      channel: channel.name,
      chunks: [],
      durationMs: 0,
      rawResponses: [],
      segments: [],
    };
  }

  const started = Date.now();
  const segments = [];
  const rawResponses = [];
  for (const chunk of chunks) {
    if (config.asrBackend === 'http_asr') {
      const asr = await transcribeHttpAsr(chunk.filePath, config, logger, {
        durationMs: chunk.durationMs,
        initialPrompt: options.initialPrompt || config.asrInitialPrompt,
        offsetMs: chunk.offsetMs,
      });
      segments.push(...asr.parsed.segments);
      rawResponses.push({
        chunk: {
          durationMs: chunk.durationMs,
          index: chunk.index,
          offsetMs: chunk.offsetMs,
        },
        durationMs: asr.durationMs,
        endpointProfile: asr.endpointProfile,
        endpointUrl: asr.endpointUrl,
        fallbackFrom: asr.fallbackFrom || null,
        response: asr.rawResponse,
      });
    } else {
      const result = await runWhisper(
        { filePath: chunk.filePath, name: channel.name },
        config,
        runCommand,
        logger,
        { allowEmpty: true, offsetMs: chunk.offsetMs },
      );
      segments.push(...result.segments);
      rawResponses.push({
        chunk: {
          durationMs: chunk.durationMs,
          index: chunk.index,
          offsetMs: chunk.offsetMs,
        },
        durationMs: result.durationMs,
      });
    }
  }

  return {
    channel: channel.name,
    chunks: chunks.map((chunk) => ({
      durationMs: chunk.durationMs,
      index: chunk.index,
      offsetMs: chunk.offsetMs,
    })),
    durationMs: Date.now() - started,
    rawResponses,
    segments,
  };
}

async function claimAndProcessOne(crmClient, config, logger, dependencies = {}) {
  const processJobFn = dependencies.processJob || processJob;
  const claimed = await crmClient.claimJob(config.workerId);
  const job = attachClaimContext(claimed?.job || null, claimed);

  if (!job) {
    logger.info('No transcription jobs available');
    return 'none';
  }

  logger.info('Claimed transcription job', {
    claimId: job.claimContext?.claimId || null,
    jobId: job.id,
    organizationKey: job.claimContext?.tenant?.organizationKey || null,
    clubKey: job.claimContext?.tenant?.clubKey || null,
    workerId: config.workerId,
  });

  try {
    await processJobFn(crmClient, job, config, logger);
    return 'completed';
  } catch (error) {
    if (error instanceof CrmApiError && error.status === 429) {
      logger.warn('CRM rate limited the claimed job; leaving the lease to expire', {
        retryAfterSeconds: error.retryAfterSeconds,
      });
      throw error;
    }
    logger.error('Transcription job failed', {
      error: error.message,
      jobId: job.id,
    });

    try {
      await crmClient.failJob(job, truncateErrorMessage(error));
      logger.info('Submitted transcription failure to CRM', { jobId: job.id });
      return 'failed';
    } catch (failError) {
      logger.error('CRM fail API error', {
        error: failError.message,
        jobId: job.id,
      });
      throw failError;
    }
  }
}

async function runSample(config, logger) {
  const tempDir = await fsp.mkdtemp(path.join(config.tempRoot, 'crm-transcription-sample-'));
  try {
    const probe = await probeAudio(config.sampleAudioPath, runCommand, config);
    const preparedAudio = await prepareAudio(
      config.sampleAudioPath,
      probe,
      tempDir,
      runCommand,
      config,
    );
    if (config.asrBackend === 'whisper_cpp') {
      await ensureWhisperModel(config, runCommand, logger);
    }

    const channelResults = [];
    for (const channel of preparedAudio.channels) {
      channelResults.push(
        await transcribePreparedChannel(channel, probe, tempDir, config, logger),
      );
    }

    let result = buildTranscriptResult(channelResults, probe, config, {
      preparedAudioMode: preparedAudio.mode,
      sampleAudioPath: config.sampleAudioPath,
      glossary: {
        aliases: config.domainGlossary?.aliases?.length || 0,
        canonicalTerms: config.domainGlossary?.canonicalTerms?.length || 0,
        initialPrompt: config.asrInitialPrompt || null,
      },
    });
    result = await postprocessTranscriptWithLlm(result, config, logger);
    console.log(JSON.stringify(result, null, 2));
  } finally {
    if (config.deleteAudioAfter) {
      await fsp.rm(tempDir, { force: true, recursive: true });
    }
  }
}

async function main() {
  const logger = createLogger();
  let config;
  try {
    config = readConfig();
    await loadQualityConfig(config, logger);
  } catch (error) {
    logger.error('Invalid transcription worker configuration', { error: error.message });
    process.exitCode = 1;
    return;
  }

  logger.info('Starting transcription worker', {
    apiUrl: config.crmApiUrl,
    asrBackend: config.asrBackend,
    asrEndpoint: config.asrProfile === 'quality' && config.asrQualityBaseUrl
      ? config.asrQualityBaseUrl
      : config.asrBaseUrl,
    model: config.whisperModel,
    modelCache: config.whisperModelCacheDir,
    runOnce: config.runOnce,
  });

  if (config.sampleAudioPath) {
    await runSample(config, logger);
    return;
  }

  const crmClient = new CrmClient(config);

  if (config.runOnce) {
    await claimAndProcessOne(crmClient, config, logger);
    return;
  }

  while (true) {
    let loopError = null;
    try {
      await claimAndProcessOne(crmClient, config, logger);
    } catch (error) {
      loopError = error;
      logger.error('Worker loop error', { error: error.message });
    }
    await sleep(pollingDelayMs(loopError, config.pollIntervalMs));
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = {
  claimAndProcessOne,
  createTempDir,
  processJob,
  pollingDelayMs,
  progressStageForChannel,
  reportProgress,
  runSample,
};
