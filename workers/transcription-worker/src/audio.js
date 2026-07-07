const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');

class AudioDownloadError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'AudioDownloadError';
    this.expired = Boolean(details.expired);
    this.status = details.status;
  }
}

function isExpiredLinkStatus(status) {
  return [401, 403, 404, 410].includes(Number(status));
}

async function downloadAudio(downloadUrl, targetPath, options = {}) {
  if (!downloadUrl) throw new AudioDownloadError('audio-reference did not include downloadUrl');

  const controller = new AbortController();
  const timeoutMs = Number(options.timeoutMs || 0);
  const timer = timeoutMs > 0
    ? setTimeout(() => controller.abort(), timeoutMs)
    : null;

  try {
    const response = await fetch(downloadUrl, { signal: controller.signal });
    if (!response.ok) {
      let body = '';
      try {
        body = (await response.text()).slice(0, 500);
      } catch (_error) {
        body = '';
      }
      throw new AudioDownloadError(
        `Audio download failed with HTTP ${response.status}${body ? `: ${body}` : ''}`,
        {
          expired: isExpiredLinkStatus(response.status),
          status: response.status,
        },
      );
    }

    if (!response.body) {
      throw new AudioDownloadError('Audio download response body is empty');
    }

    await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(targetPath));
    const stat = await fsp.stat(targetPath);
    if (stat.size <= 0) {
      throw new AudioDownloadError('Downloaded audio file is empty');
    }

    return {
      bytes: stat.size,
      contentType: response.headers.get('content-type') || null,
      filePath: targetPath,
    };
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new AudioDownloadError(`Audio download timed out after ${timeoutMs} ms`);
    }
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function parseProbeJson(stdout) {
  try {
    return JSON.parse(stdout);
  } catch (error) {
    throw new Error(`ffprobe returned invalid JSON: ${error.message}`);
  }
}

async function probeAudio(filePath, runCommand, config) {
  let result;
  try {
    result = await runCommand(
      'ffprobe',
      [
        '-v',
        'error',
        '-select_streams',
        'a:0',
        '-show_entries',
        'stream=codec_name,channels,channel_layout',
        '-show_entries',
        'format=duration',
        '-of',
        'json',
        filePath,
      ],
      { timeoutMs: config.commandTimeoutMs },
    );
  } catch (error) {
    throw new Error(`ffprobe error: ${error.message}${error.stderr ? `: ${error.stderr.trim()}` : ''}`);
  }

  const data = parseProbeJson(result.stdout);
  const stream = Array.isArray(data.streams) ? data.streams[0] : null;
  if (!stream) {
    throw new Error('ffprobe did not find an audio stream');
  }

  const channels = Number(stream.channels || 0);
  if (!Number.isFinite(channels) || channels <= 0) {
    throw new Error('ffprobe did not report a valid channel count');
  }

  const durationSeconds = Number(data.format?.duration);
  if (!stream.codec_name) {
    throw new Error('ffprobe did not report an audio codec');
  }
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new Error('ffprobe did not report a valid audio duration');
  }

  return {
    channelLayout: stream.channel_layout || null,
    channels,
    codec: stream.codec_name,
    durationSeconds,
  };
}

async function splitStereoAudio(inputPath, tempDir, runCommand, config) {
  const leftPath = path.join(tempDir, 'left.wav');
  const rightPath = path.join(tempDir, 'right.wav');
  const normalize = 'loudnorm=I=-18:TP=-2:LRA=11';

  try {
    await runCommand(
      'ffmpeg',
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-y',
        '-i',
        inputPath,
        '-filter_complex',
        `[0:a]pan=mono|c0=c0,${normalize}[left];[0:a]pan=mono|c0=c1,${normalize}[right]`,
        '-map',
        '[left]',
        '-ar',
        '16000',
        '-c:a',
        'pcm_s16le',
        leftPath,
        '-map',
        '[right]',
        '-ar',
        '16000',
        '-c:a',
        'pcm_s16le',
        rightPath,
      ],
      { timeoutMs: config.commandTimeoutMs },
    );
  } catch (error) {
    throw new Error(`ffmpeg stereo split error: ${error.message}${error.stderr ? `: ${error.stderr.trim()}` : ''}`);
  }

  return {
    mode: 'stereo',
    channels: [
      { filePath: leftPath, name: 'left' },
      { filePath: rightPath, name: 'right' },
    ],
  };
}

async function transcodeMonoAudio(inputPath, tempDir, runCommand, config) {
  const monoPath = path.join(tempDir, 'mono.wav');

  try {
    await runCommand(
      'ffmpeg',
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-y',
        '-i',
        inputPath,
        '-vn',
        '-ac',
        '1',
        '-af',
        'loudnorm=I=-18:TP=-2:LRA=11',
        '-ar',
        '16000',
        '-c:a',
        'pcm_s16le',
        monoPath,
      ],
      { timeoutMs: config.commandTimeoutMs },
    );
  } catch (error) {
    throw new Error(`ffmpeg mono transcode error: ${error.message}${error.stderr ? `: ${error.stderr.trim()}` : ''}`);
  }

  return {
    mode: 'mono',
    channels: [{ filePath: monoPath, name: 'mono' }],
  };
}

async function prepareAudio(inputPath, probe, tempDir, runCommand, config) {
  if (probe.channels >= 2) {
    return splitStereoAudio(inputPath, tempDir, runCommand, config);
  }
  if (probe.channels === 1) {
    return transcodeMonoAudio(inputPath, tempDir, runCommand, config);
  }

  throw new Error(`Unsupported audio channel count: ${probe.channels}`);
}

function parseSilenceEvents(output) {
  const events = [];
  String(output || '').split(/\r?\n/).forEach((line) => {
    const start = line.match(/silence_start:\s*([0-9.]+)/);
    if (start) {
      events.push({ at: Number(start[1]), type: 'start' });
      return;
    }

    const end = line.match(/silence_end:\s*([0-9.]+)/);
    if (end) {
      events.push({ at: Number(end[1]), type: 'end' });
    }
  });
  return events.filter((event) => Number.isFinite(event.at) && event.at >= 0);
}

function buildSpeechIntervals(events, durationSeconds, config) {
  const duration = Number(durationSeconds);
  if (!Number.isFinite(duration) || duration <= 0) return [];
  if (!events || events.length === 0) return [{ end: duration, start: 0 }];

  const intervals = [];
  let speechStart = 0;
  let inSilence = false;
  for (const event of events.sort((left, right) => left.at - right.at)) {
    if (event.type === 'start' && !inSilence) {
      if (event.at > speechStart) {
        intervals.push({ end: Math.min(event.at, duration), start: speechStart });
      }
      inSilence = true;
      continue;
    }

    if (event.type === 'end' && inSilence) {
      speechStart = Math.min(event.at, duration);
      inSilence = false;
    }
  }

  if (!inSilence && speechStart < duration) {
    intervals.push({ end: duration, start: speechStart });
  }

  const minSpeechSeconds = Number(config.chunkMinSpeechSeconds || 0.45);
  const paddingSeconds = Number(config.chunkPaddingMs || 0) / 1000;
  const padded = intervals
    .filter((interval) => interval.end - interval.start >= minSpeechSeconds)
    .map((interval) => ({
      end: Math.min(duration, interval.end + paddingSeconds),
      start: Math.max(0, interval.start - paddingSeconds),
    }));

  const merged = [];
  for (const interval of padded) {
    const previous = merged.at(-1);
    if (previous && interval.start <= previous.end + 0.1) {
      previous.end = Math.max(previous.end, interval.end);
    } else {
      merged.push({ ...interval });
    }
  }
  return merged;
}

function splitLongIntervals(intervals, config) {
  const maxSeconds = Number(config.chunkMaxSeconds || 45);
  const chunks = [];
  intervals.forEach((interval) => {
    let start = interval.start;
    while (start < interval.end) {
      const end = Math.min(interval.end, start + maxSeconds);
      if (end - start >= Number(config.chunkMinSpeechSeconds || 0.45)) {
        chunks.push({ end, start });
      }
      start = end;
    }
  });
  return chunks;
}

async function detectSpeechIntervals(channel, probe, runCommand, config) {
  if (!config.chunkSilenceDetectionEnabled) {
    return splitLongIntervals([{ end: probe.durationSeconds, start: 0 }], config);
  }

  let result;
  try {
    result = await runCommand(
      'ffmpeg',
      [
        '-hide_banner',
        '-i',
        channel.filePath,
        '-af',
        `silencedetect=noise=-${Number(config.silenceNoiseDb || 45)}dB:d=${Number(config.silenceMinDurationSeconds || 1.2)}`,
        '-f',
        'null',
        '-',
      ],
      { timeoutMs: config.commandTimeoutMs, maxBufferBytes: 20 * 1024 * 1024 },
    );
  } catch (error) {
    throw new Error(`ffmpeg silence detection error on ${channel.name}: ${error.message}${error.stderr ? `: ${error.stderr.trim()}` : ''}`);
  }

  const events = parseSilenceEvents(`${result.stdout}\n${result.stderr}`);
  return splitLongIntervals(buildSpeechIntervals(events, probe.durationSeconds, config), config);
}

async function exportAudioChunk(channel, interval, index, tempDir, runCommand, config) {
  const safeChannel = String(channel.name || 'channel').replace(/[^a-z0-9_-]/gi, '_');
  const chunkPath = path.join(tempDir, `${safeChannel}-chunk-${String(index + 1).padStart(3, '0')}.wav`);
  const start = Math.max(0, interval.start);
  const duration = Math.max(0, interval.end - interval.start);

  try {
    await runCommand(
      'ffmpeg',
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-y',
        '-ss',
        String(start.toFixed(3)),
        '-t',
        String(duration.toFixed(3)),
        '-i',
        channel.filePath,
        '-vn',
        '-ac',
        '1',
        '-ar',
        '16000',
        '-c:a',
        'pcm_s16le',
        chunkPath,
      ],
      { timeoutMs: config.commandTimeoutMs },
    );
  } catch (error) {
    throw new Error(`ffmpeg chunk export error on ${channel.name}: ${error.message}${error.stderr ? `: ${error.stderr.trim()}` : ''}`);
  }

  return {
    durationMs: Math.round(duration * 1000),
    filePath: chunkPath,
    index,
    offsetMs: Math.round(start * 1000),
  };
}

async function createSpeechChunks(channel, probe, tempDir, runCommand, config) {
  const intervals = await detectSpeechIntervals(channel, probe, runCommand, config);
  const chunks = [];
  for (let index = 0; index < intervals.length; index += 1) {
    chunks.push(await exportAudioChunk(channel, intervals[index], index, tempDir, runCommand, config));
  }
  return chunks;
}

module.exports = {
  AudioDownloadError,
  buildSpeechIntervals,
  createSpeechChunks,
  downloadAudio,
  parseSilenceEvents,
  prepareAudio,
  probeAudio,
};
