const { normalizeTranscriptSegments } = require('./normalizer');

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

const NOISE_TEXTS = new Set(['', '.', '..', '...', '…', '-', '--', 'шум', '[шум]', '(шум)', 'музыка', '[музыка]', '(музыка)']);
const SHORT_SEGMENT_MAX_MS = 1800;
const MERGE_GAP_MAX_MS = 650;
const MERGE_TEXT_MAX_CHARS = 260;

function parseTimestampMs(hours, minutes, seconds, milliseconds) {
  return (
    Number(hours) * 60 * 60 * 1000 +
    Number(minutes) * 60 * 1000 +
    Number(seconds) * 1000 +
    Number(milliseconds)
  );
}

function parseWhisperOutput(output) {
  const lines = String(output || '').split(/\r?\n/);
  const segments = [];
  const pattern =
    /^\s*\[(\d{2}):(\d{2}):(\d{2})[.,](\d{3})\s+-->\s+(\d{2}):(\d{2}):(\d{2})[.,](\d{3})\]\s*(.*)$/;

  lines.forEach((line) => {
    const match = line.match(pattern);
    if (!match) return;

    const text = normalizeText(match[9]);
    if (!text) return;

    segments.push({
      endMs: parseTimestampMs(match[5], match[6], match[7], match[8]),
      startMs: parseTimestampMs(match[1], match[2], match[3], match[4]),
      text,
    });
  });

  return segments;
}

function isNoiseText(text) {
  const normalized = normalizeText(text).toLowerCase();
  if (NOISE_TEXTS.has(normalized)) return true;
  return normalized.replace(/[.,!?;:—\-–()[\]{} ]/g, '') === '';
}

function speakerForChannel(channelName, config) {
  if (channelName === config.channelAdmin) return 'administrator';
  if (channelName === config.channelClient) return 'client';
  return 'unknown';
}

function formatTime(ms) {
  if (!Number.isFinite(ms)) return '??:??';
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const prefix = hours > 0 ? `${String(hours).padStart(2, '0')}:` : '';
  return `${prefix}${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function speakerLabel(speaker) {
  if (speaker === 'administrator') return 'Администратор';
  if (speaker === 'client') return 'Клиент';
  return 'Неизвестно';
}

function formatTranscriptLines(segments) {
  return segments
    .map((segment) => {
      const prefix = segment.startMs === null ? '' : `[${formatTime(segment.startMs)}] `;
      return `${prefix}${speakerLabel(segment.speaker)}: ${segment.text}`;
    })
    .join('\n');
}

function mergeAdjacentShortSegments(segments) {
  const merged = [];
  segments.forEach((segment) => {
    const previous = merged.at(-1);
    const sameVoice = previous &&
      previous.speaker === segment.speaker &&
      previous.channel === segment.channel;
    const gap = sameVoice && Number.isFinite(previous.endMs) && Number.isFinite(segment.startMs)
      ? segment.startMs - previous.endMs
      : null;
    const duration = Number.isFinite(segment.startMs) && Number.isFinite(segment.endMs)
      ? Math.max(0, segment.endMs - segment.startMs)
      : null;
    const combinedText = previous ? `${previous.text} ${segment.text}`.trim() : segment.text;

    if (
      sameVoice &&
      gap !== null &&
      gap >= 0 &&
      gap <= MERGE_GAP_MAX_MS &&
      duration !== null &&
      duration <= SHORT_SEGMENT_MAX_MS &&
      combinedText.length <= MERGE_TEXT_MAX_CHARS
    ) {
      previous.text = combinedText;
      previous.endMs = segment.endMs;
      return;
    }
    merged.push({ ...segment });
  });
  return merged;
}

function buildTranscriptResult(channelResults, probe, config, extraMetadata = {}) {
  const segments = [];

  channelResults.forEach((channelResult, channelIndex) => {
    const speaker = speakerForChannel(channelResult.channel, config);
    channelResult.segments.forEach((segment, segmentIndex) => {
      const text = normalizeText(segment.text);
      if (isNoiseText(text)) return;

      segments.push({
        channel: channelResult.channel,
        channelIndex,
        confidence: Number.isFinite(Number(segment.confidence)) ? Number(segment.confidence) : null,
        endMs: Number.isFinite(segment.endMs) ? segment.endMs : null,
        originalOrder: segmentIndex,
        speaker,
        startMs: Number.isFinite(segment.startMs) ? segment.startMs : null,
        text,
      });
    });
  });

  segments.sort((left, right) => {
    const leftStart = Number.isFinite(left.startMs) ? left.startMs : Number.MAX_SAFE_INTEGER;
    const rightStart = Number.isFinite(right.startMs) ? right.startMs : Number.MAX_SAFE_INTEGER;
    if (leftStart !== rightStart) return leftStart - rightStart;
    if (left.channelIndex !== right.channelIndex) return left.channelIndex - right.channelIndex;
    return left.originalOrder - right.originalOrder;
  });
  const mergedSegments = mergeAdjacentShortSegments(segments);

  if (mergedSegments.length === 0) {
    throw new Error('ASR produced no transcript segments');
  }

  const rawSegments = mergedSegments.map((segment, index) => ({
    channel: segment.channel,
    confidence: segment.confidence,
    endMs: segment.endMs,
    sortOrder: index,
    speaker: segment.speaker,
    startMs: segment.startMs,
    text: segment.text,
  }));
  const rawTranscriptText = formatTranscriptLines(rawSegments);
  const normalized = normalizeTranscriptSegments(
    rawSegments,
    config.domainGlossary || {},
  );
  const transcriptText = formatTranscriptLines(normalized.segments);

  return {
    corrections: normalized.corrections,
    language: config.whisperLanguage,
    metadata: {
      asrBackend: config.asrBackend,
      audio: {
        channelLayout: probe.channelLayout,
        channels: probe.channels,
        codec: probe.codec,
        durationSeconds: probe.durationSeconds,
      },
      channelMapping: {
        administrator: config.channelAdmin,
        client: config.channelClient,
      },
      merge: {
        gapMaxMs: MERGE_GAP_MAX_MS,
        shortSegmentMaxMs: SHORT_SEGMENT_MAX_MS,
      },
      preprocessing: {
        audioFilter: 'loudnorm=I=-18:TP=-2:LRA=11',
        sampleRate: 16000,
      },
      workerId: config.workerId,
      whisper: {
        language: config.whisperLanguage,
        model: config.whisperModel,
        threads: config.whisperThreads,
      },
      ...extraMetadata,
    },
    rawAsrJson: {
      channels: channelResults.map((result) => ({
        channel: result.channel,
        chunks: result.chunks || null,
        rawResponse: result.rawResponse || null,
        rawResponses: result.rawResponses || null,
      })),
    },
    rawTranscriptText,
    segments: normalized.segments,
    transcriptText,
  };
}

module.exports = {
  buildTranscriptResult,
  formatTime,
  mergeAdjacentShortSegments,
  parseWhisperOutput,
  speakerForChannel,
};
