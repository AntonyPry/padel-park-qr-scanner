const fsp = require('node:fs/promises');
const path = require('node:path');
const { createSpeechChunks, downloadAudio, prepareAudio, probeAudio } = require('./audio');
const { transcribeHttpAsr } = require('./asr-http');
const { runCommand } = require('./commands');
const { readConfig } = require('./config');
const { CrmClient } = require('./crm-client');
const { buildInitialPrompt, loadDomainGlossary } = require('./glossary');
const { createLogger } = require('./logger');
const { buildTranscriptResult } = require('./transcript');
const { ensureWhisperModel, runWhisper } = require('./whisper');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getCallId(job) {
  return job?.call?.id || job?.telephonyCallId || null;
}

function truncateErrorMessage(error) {
  const message = error && error.stack ? error.stack : String(error?.message || error);
  return message.slice(0, 4000);
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
  const callId = getCallId(job) || 'unknown-call';
  const prefix = path.join(config.tempRoot, `crm-transcription-${callId}-`);
  return fsp.mkdtemp(prefix);
}

async function downloadJobAudio(crmClient, job, tempDir, config, logger) {
  const targetPath = path.join(tempDir, `call-${getCallId(job) || job.id}.audio`);
  const load = async () => {
    const reference = await crmClient.getAudioReference(job.id);
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

async function processJob(crmClient, job, config, logger) {
  let tempDir = null;

  try {
    tempDir = await createTempDir(config, job);
    const downloaded = await downloadJobAudio(crmClient, job, tempDir, config, logger);
    logger.info('Downloaded call recording', {
      bytes: downloaded.bytes,
      callId: getCallId(job),
      contentType: downloaded.contentType,
      jobId: job.id,
    });

    const probe = await probeAudio(downloaded.filePath, runCommand, config);
    logger.info('Audio probe completed', {
      channelLayout: probe.channelLayout,
      channels: probe.channels,
      codec: probe.codec,
      durationSeconds: probe.durationSeconds,
      jobId: job.id,
    });

    const preparedAudio = await prepareAudio(
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
      await ensureWhisperModel(config, runCommand, logger);
    }

    const channelResults = [];
    for (const channel of preparedAudio.channels) {
      channelResults.push(
        await transcribePreparedChannel(channel, probe, tempDir, config, logger),
      );
    }

    const result = buildTranscriptResult(channelResults, probe, config, {
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
        initialPrompt: config.asrInitialPrompt || null,
      },
      whisperDurationsMs: Object.fromEntries(
        channelResults.map((item) => [item.channel, item.durationMs]),
      ),
    });

    await crmClient.completeJob(job.id, result);
    logger.info('Submitted transcription result to CRM', {
      callId: getCallId(job),
      jobId: job.id,
      segments: result.segments.length,
    });

    return result;
  } finally {
    if (tempDir && config.deleteAudioAfter) {
      await fsp.rm(tempDir, { force: true, recursive: true });
      logger.info('Deleted temporary audio files', { jobId: job.id, tempDir });
    } else if (tempDir) {
      logger.warn('Temporary audio files were kept because DELETE_AUDIO_AFTER=false', {
        jobId: job.id,
        tempDir,
      });
    }
  }
}

async function transcribePreparedChannel(channel, probe, tempDir, config, logger) {
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
        initialPrompt: config.asrInitialPrompt,
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

async function claimAndProcessOne(crmClient, config, logger) {
  const claimed = await crmClient.claimJob(config.workerId);
  const job = claimed?.job || null;

  if (!job) {
    logger.info('No transcription jobs available');
    return 'none';
  }

  logger.info('Claimed transcription job', {
    callId: getCallId(job),
    jobId: job.id,
    workerId: config.workerId,
  });

  try {
    await processJob(crmClient, job, config, logger);
    return 'completed';
  } catch (error) {
    logger.error('Transcription job failed', {
      error: error.message,
      jobId: job.id,
    });

    try {
      await crmClient.failJob(job.id, truncateErrorMessage(error));
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

    const result = buildTranscriptResult(channelResults, probe, config, {
      preparedAudioMode: preparedAudio.mode,
      sampleAudioPath: config.sampleAudioPath,
      glossary: {
        aliases: config.domainGlossary?.aliases?.length || 0,
        canonicalTerms: config.domainGlossary?.canonicalTerms?.length || 0,
        initialPrompt: config.asrInitialPrompt || null,
      },
    });
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
    try {
      await claimAndProcessOne(crmClient, config, logger);
    } catch (error) {
      logger.error('Worker loop error', { error: error.message });
    }
    await sleep(config.pollIntervalMs);
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
  processJob,
  runSample,
};
