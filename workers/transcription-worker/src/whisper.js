const fsp = require('node:fs/promises');
const path = require('node:path');
const { parseWhisperOutput } = require('./transcript');

async function fileExists(filePath) {
  try {
    const stat = await fsp.stat(filePath);
    return stat.isFile() && stat.size > 0;
  } catch (_error) {
    return false;
  }
}

async function ensureWhisperModel(config, runCommand, logger) {
  await fsp.mkdir(config.whisperModelCacheDir, { recursive: true });
  if (await fileExists(config.whisperModelPath)) {
    return config.whisperModelPath;
  }

  const script = path.join(config.whisperCppDir, 'models', 'download-ggml-model.sh');
  logger.info('Downloading whisper.cpp model', {
    cacheDir: config.whisperModelCacheDir,
    model: config.whisperModel,
  });

  try {
    await runCommand(
      'bash',
      [script, config.whisperModel, config.whisperModelCacheDir],
      { timeoutMs: config.commandTimeoutMs, maxBufferBytes: 10 * 1024 * 1024 },
    );
  } catch (error) {
    throw new Error(`whisper.cpp model download failed: ${error.message}${error.stderr ? `: ${error.stderr.trim()}` : ''}`);
  }

  if (!(await fileExists(config.whisperModelPath))) {
    throw new Error(`whisper.cpp model was not found after download: ${config.whisperModelPath}`);
  }

  return config.whisperModelPath;
}

async function runWhisper(channel, config, runCommand, logger, options = {}) {
  logger.info('Running whisper.cpp', {
    channel: channel.name,
    model: config.whisperModel,
  });

  let result;
  try {
    result = await runCommand(
      config.whisperBinary,
      [
        '-m',
        config.whisperModelPath,
        '-f',
        channel.filePath,
        '-l',
        config.whisperLanguage,
        '-t',
        String(config.whisperThreads),
      ],
      { timeoutMs: config.commandTimeoutMs, maxBufferBytes: 100 * 1024 * 1024 },
    );
  } catch (error) {
    throw new Error(`whisper.cpp error on ${channel.name}: ${error.message}${error.stderr ? `: ${error.stderr.trim()}` : ''}`);
  }

  const output = `${result.stdout}\n${result.stderr}`;
  const offsetMs = Number(options.offsetMs || 0);
  const segments = parseWhisperOutput(output).map((segment) => ({
    ...segment,
    endMs: Number.isFinite(segment.endMs) ? segment.endMs + offsetMs : null,
    startMs: Number.isFinite(segment.startMs) ? segment.startMs + offsetMs : null,
  }));
  if (segments.length === 0 && !options.allowEmpty) {
    throw new Error(`whisper.cpp produced no transcript for ${channel.name}`);
  }

  return {
    channel: channel.name,
    durationMs: result.durationMs,
    segments,
  };
}

module.exports = {
  ensureWhisperModel,
  runWhisper,
};
