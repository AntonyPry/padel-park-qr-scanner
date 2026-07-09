const { normalizeTranscriptSegments } = require('./normalizer');

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

const NOISE_TEXTS = new Set(['', '.', '..', '...', '…', '-', '--', 'шум', '[шум]', '(шум)', 'музыка', '[музыка]', '(музыка)']);
const SHORT_SEGMENT_MAX_MS = 1800;
const MERGE_GAP_MAX_MS = 650;
const MERGE_TEXT_MAX_CHARS = 260;
const LONG_SEGMENT_MIN_MS = 5000;
const REPLY_MAX_DURATION_MS = 6500;
const REPLY_MAX_CHARS = 180;
const WORD_PAUSE_SPLIT_MS = 750;
const INTERRUPTION_GUARD_MS = 120;
const MIN_SPLIT_PART_MS = 550;

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

function finiteMs(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.round(number) : null;
}

function segmentDurationMs(segment) {
  const startMs = finiteMs(segment?.startMs);
  const endMs = finiteMs(segment?.endMs);
  if (startMs === null || endMs === null || endMs <= startMs) return null;
  return endMs - startMs;
}

function normalizeWordText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeWordTimestamps(words = []) {
  if (!Array.isArray(words)) return [];
  return words
    .map((word, index) => {
      const text = normalizeWordText(word?.text || word?.word || word?.token);
      const startMs = finiteMs(word?.startMs);
      const endMs = finiteMs(word?.endMs);
      if (!text || startMs === null || endMs === null || endMs < startMs) return null;
      return {
        confidence: Number.isFinite(Number(word?.confidence)) ? Number(word.confidence) : null,
        endMs,
        index,
        startMs,
        text,
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.startMs - right.startMs || left.index - right.index)
    .map(({ index: _index, ...word }) => word);
}

function joinWords(words = []) {
  return words
    .map((word) => normalizeWordText(word.text))
    .filter(Boolean)
    .join(' ')
    .replace(/\s+([,.!?;:])/g, '$1')
    .replace(/([([{«])\s+/g, '$1')
    .replace(/\s+([)\]}»])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function hasHardPunctuation(text) {
  return /[.!?…;:]$/u.test(normalizeText(text));
}

function hasSoftPunctuation(text) {
  return /,$/u.test(normalizeText(text));
}

function buildSplitGroupId(segment, index) {
  return `${segment.channel || 'channel'}:${segment.originalOrder ?? index}:${segment.startMs ?? 'x'}:${segment.endMs ?? 'x'}`;
}

function sameSegmentLane(left, right) {
  return left?.speaker === right?.speaker && left?.channel === right?.channel;
}

function getIntersections(segment, allSegments) {
  const startMs = finiteMs(segment.startMs);
  const endMs = finiteMs(segment.endMs);
  if (startMs === null || endMs === null) return [];

  return allSegments
    .filter((other) => {
      if (!other || other === segment || sameSegmentLane(segment, other)) return false;
      const otherStart = finiteMs(other.startMs);
      const otherEnd = finiteMs(other.endMs);
      if (otherStart === null || otherEnd === null) return false;
      return otherStart < endMs - INTERRUPTION_GUARD_MS && otherEnd > startMs + INTERRUPTION_GUARD_MS;
    })
    .map((other) => ({
      endMs: Math.min(endMs, finiteMs(other.endMs)),
      startMs: Math.max(startMs, finiteMs(other.startMs)),
    }))
    .filter((item) => item.startMs !== null && item.endMs !== null && item.endMs > item.startMs)
    .sort((left, right) => left.startMs - right.startMs || left.endMs - right.endMs);
}

function hasInterruptionBetweenWords(leftWord, rightWord, intersections) {
  return intersections.some(
    (intersection) =>
      intersection.startMs >= leftWord.endMs - INTERRUPTION_GUARD_MS &&
      intersection.endMs <= rightWord.startMs + INTERRUPTION_GUARD_MS,
  );
}

function buildWordPart(segment, words, splitGroupId, splitPart) {
  const text = joinWords(words);
  if (!text) return null;
  return {
    ...segment,
    endMs: words.at(-1).endMs,
    splitGroupId,
    splitPart,
    startMs: words[0].startMs,
    text,
    words,
  };
}

function splitSegmentByWords(segment, intersections, segmentIndex) {
  const words = normalizeWordTimestamps(segment.words);
  if (words.length < 2) return null;

  const groups = [];
  let current = [];
  words.forEach((word, index) => {
    current.push(word);
    const next = words[index + 1];
    if (!next) {
      groups.push(current);
      return;
    }

    const currentText = joinWords(current);
    const currentDuration = current.at(-1).endMs - current[0].startMs;
    const gap = next.startMs - word.endMs;
    const shouldSplit =
      gap >= WORD_PAUSE_SPLIT_MS ||
      hasInterruptionBetweenWords(word, next, intersections) ||
      (hasHardPunctuation(currentText) && currentDuration >= MIN_SPLIT_PART_MS) ||
      (hasSoftPunctuation(currentText) &&
        (currentDuration >= 2500 || currentText.length >= REPLY_MAX_CHARS)) ||
      (currentDuration >= REPLY_MAX_DURATION_MS && current.length >= 3) ||
      currentText.length >= REPLY_MAX_CHARS;

    if (shouldSplit) {
      groups.push(current);
      current = [];
    }
  });

  if (groups.length <= 1) return null;
  const splitGroupId = buildSplitGroupId(segment, segmentIndex);
  return groups
    .map((group, index) => buildWordPart(segment, group, splitGroupId, index))
    .filter(Boolean);
}

function splitTextByPunctuation(text) {
  const units = normalizeText(text).match(/[^.!?…;:]+[.!?…;:]?|[^.!?…;:]+$/gu) || [];
  const parts = [];
  let current = '';

  units.forEach((unit) => {
    const next = normalizeText(`${current} ${unit}`);
    if (current && next.length > REPLY_MAX_CHARS) {
      parts.push(current);
      current = normalizeText(unit);
    } else {
      current = next;
    }
  });

  if (current) parts.push(current);
  return parts.filter(Boolean);
}

function splitTextIntoCount(text, count) {
  const normalized = normalizeText(text);
  if (count <= 1) return [normalized];

  const punctuationParts = splitTextByPunctuation(normalized);
  if (punctuationParts.length === count) return punctuationParts;
  if (punctuationParts.length > count) {
    const merged = Array.from({ length: count }, () => '');
    punctuationParts.forEach((part, index) => {
      const bucket = Math.min(count - 1, Math.floor((index * count) / punctuationParts.length));
      merged[bucket] = normalizeText(`${merged[bucket]} ${part}`);
    });
    return merged.filter(Boolean);
  }

  const words = normalized.split(/\s+/).filter(Boolean);
  if (words.length <= count) return words;
  const parts = [];
  for (let index = 0; index < count; index += 1) {
    const from = Math.floor((index * words.length) / count);
    const to = Math.floor(((index + 1) * words.length) / count);
    const part = words.slice(from, Math.max(from + 1, to)).join(' ');
    if (part) parts.push(part);
  }
  return parts;
}

function buildSpeechWindowsAroundIntersections(segment, intersections) {
  const startMs = finiteMs(segment.startMs);
  const endMs = finiteMs(segment.endMs);
  if (startMs === null || endMs === null || intersections.length === 0) return [];

  const windows = [];
  let cursor = startMs;
  intersections.forEach((intersection) => {
    const beforeEnd = Math.max(cursor, intersection.startMs - INTERRUPTION_GUARD_MS);
    if (beforeEnd - cursor >= MIN_SPLIT_PART_MS) {
      windows.push({ endMs: beforeEnd, startMs: cursor });
    }
    cursor = Math.max(cursor, intersection.endMs + INTERRUPTION_GUARD_MS);
  });
  if (endMs - cursor >= MIN_SPLIT_PART_MS) {
    windows.push({ endMs, startMs: cursor });
  }
  return windows;
}

function buildTimedTextParts(segment, parts, splitGroupId) {
  const startMs = finiteMs(segment.startMs);
  const endMs = finiteMs(segment.endMs);
  if (startMs === null || endMs === null || parts.length <= 1) return null;

  const duration = endMs - startMs;
  const totalChars = parts.reduce((sum, part) => sum + Math.max(1, part.length), 0);
  let cursor = startMs;
  return parts.map((part, index) => {
    const partEnd =
      index === parts.length - 1
        ? endMs
        : Math.round(cursor + duration * (Math.max(1, part.length) / totalChars));
    const next = {
      ...segment,
      endMs: Math.max(cursor, partEnd),
      splitGroupId,
      splitPart: index,
      startMs: cursor,
      text: part,
      words: [],
    };
    cursor = next.endMs;
    return next;
  });
}

function splitSegmentByText(segment, intersections, segmentIndex) {
  const duration = segmentDurationMs(segment);
  const text = normalizeText(segment.text);
  if (!duration || !text) return null;

  const splitGroupId = buildSplitGroupId(segment, segmentIndex);
  const windows = buildSpeechWindowsAroundIntersections(segment, intersections);
  if (windows.length > 1) {
    const parts = splitTextIntoCount(text, windows.length);
    if (parts.length !== windows.length) return null;
    return parts.map((part, index) => ({
      ...segment,
      endMs: windows[index].endMs,
      splitGroupId,
      splitPart: index,
      startMs: windows[index].startMs,
      text: part,
      words: [],
    }));
  }

  if (duration < LONG_SEGMENT_MIN_MS && text.length < REPLY_MAX_CHARS) return null;

  let parts = splitTextByPunctuation(text);
  if (parts.length <= 1 && duration >= REPLY_MAX_DURATION_MS) {
    parts = splitTextIntoCount(text, Math.max(2, Math.ceil(duration / REPLY_MAX_DURATION_MS)));
  }
  if (parts.length <= 1) return null;
  return buildTimedTextParts(segment, parts, splitGroupId);
}

function splitLongConversationSegments(segments) {
  const stats = {
    inputSegments: segments.length,
    outputSegments: 0,
    splitSegments: 0,
    wordTimestampSegments: 0,
  };
  const refined = [];

  segments.forEach((segment, index) => {
    const intersections = getIntersections(segment, segments);
    const duration = segmentDurationMs(segment);
    const hasWords = normalizeWordTimestamps(segment.words).length > 1;
    if (hasWords) stats.wordTimestampSegments += 1;

    const shouldTrySplit =
      hasWords ||
      intersections.length > 0 ||
      (duration !== null && duration >= LONG_SEGMENT_MIN_MS) ||
      normalizeText(segment.text).length >= REPLY_MAX_CHARS;
    const split = shouldTrySplit
      ? splitSegmentByWords(segment, intersections, index) ||
        splitSegmentByText(segment, intersections, index)
      : null;

    if (split && split.length > 1) {
      stats.splitSegments += 1;
      refined.push(...split);
    } else {
      refined.push({
        ...segment,
        words: normalizeWordTimestamps(segment.words),
      });
    }
  });

  stats.outputSegments = refined.length;
  return { segments: refined, stats };
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

function buildQualityWarnings(corrections = [], segments = []) {
  const warnings = [];
  const countByType = corrections.reduce((acc, correction) => {
    const type = correction?.type || 'unknown';
    acc[type] = (acc[type] || 0) + 1;
    return acc;
  }, {});

  if (countByType.subtitle_outro_drop) {
    warnings.push({
      code: 'subtitle_hallucinations_removed',
      count: countByType.subtitle_outro_drop,
      message: 'ASR добавил служебные фразы про субтитры, они удалены из нормализованного текста.',
      severity: 'info',
    });
  }
  if (countByType.prompt_leak_drop) {
    warnings.push({
      code: 'prompt_leak_removed',
      count: countByType.prompt_leak_drop,
      message: 'ASR повторил технический prompt как речь, этот фрагмент удален.',
      severity: 'warning',
    });
  }
  if (countByType.asr_gibberish_drop) {
    warnings.push({
      code: 'gibberish_segments_removed',
      count: countByType.asr_gibberish_drop,
      message: 'Удалены шумовые фрагменты ASR. Проверьте конец разговора и спорные места в raw-тексте.',
      severity: 'warning',
    });
  }
  if (countByType.greeting_normalization || countByType.domain_term) {
    warnings.push({
      code: 'automatic_domain_normalization',
      count: (countByType.greeting_normalization || 0) + (countByType.domain_term || 0),
      message: 'Применены автоматические правки терминов клуба и приветствия администратора.',
      severity: 'info',
    });
  }
  return warnings;
}

function mergeAdjacentShortSegments(segments) {
  const merged = [];
  segments.forEach((segment) => {
    const previous = merged.at(-1);
    const sameVoice = previous &&
      previous.speaker === segment.speaker &&
      previous.channel === segment.channel;
    const sameSplitGroup =
      sameVoice &&
      previous.splitGroupId &&
      segment.splitGroupId &&
      previous.splitGroupId === segment.splitGroupId;
    const gap = sameVoice && Number.isFinite(previous.endMs) && Number.isFinite(segment.startMs)
      ? segment.startMs - previous.endMs
      : null;
    const duration = Number.isFinite(segment.startMs) && Number.isFinite(segment.endMs)
      ? Math.max(0, segment.endMs - segment.startMs)
      : null;
    const combinedText = previous ? `${previous.text} ${segment.text}`.trim() : segment.text;

    if (
      sameVoice &&
      !sameSplitGroup &&
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
        words: normalizeWordTimestamps(segment.words),
      });
    });
  });

  const splitResult = splitLongConversationSegments(segments);
  const refinedSegments = splitResult.segments;

  refinedSegments.sort((left, right) => {
    const leftStart = Number.isFinite(left.startMs) ? left.startMs : Number.MAX_SAFE_INTEGER;
    const rightStart = Number.isFinite(right.startMs) ? right.startMs : Number.MAX_SAFE_INTEGER;
    if (leftStart !== rightStart) return leftStart - rightStart;
    if (left.channelIndex !== right.channelIndex) return left.channelIndex - right.channelIndex;
    if (left.originalOrder !== right.originalOrder) return left.originalOrder - right.originalOrder;
    return Number(left.splitPart || 0) - Number(right.splitPart || 0);
  });
  const mergedSegments = mergeAdjacentShortSegments(refinedSegments);

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
  const qualityWarnings = buildQualityWarnings(normalized.corrections, normalized.segments);

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
      segmentation: {
        ...splitResult.stats,
        mergedSegments: mergedSegments.length,
        replyMaxChars: REPLY_MAX_CHARS,
        replyMaxDurationMs: REPLY_MAX_DURATION_MS,
        wordPauseSplitMs: WORD_PAUSE_SPLIT_MS,
      },
      workerId: config.workerId,
      whisper: {
        language: config.whisperLanguage,
        model: config.whisperModel,
        threads: config.whisperThreads,
      },
      qualityWarnings,
      ...extraMetadata,
    },
    rawAsrJson: {
      channels: channelResults.map((result) => ({
        channel: result.channel,
        chunks: result.chunks || null,
        parsedSegments: (result.segments || []).map((segment) => ({
          endMs: Number.isFinite(Number(segment.endMs)) ? Number(segment.endMs) : null,
          startMs: Number.isFinite(Number(segment.startMs)) ? Number(segment.startMs) : null,
          text: normalizeText(segment.text),
          words: normalizeWordTimestamps(segment.words),
        })),
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
  buildQualityWarnings,
  buildTranscriptResult,
  formatTime,
  mergeAdjacentShortSegments,
  parseWhisperOutput,
  speakerForChannel,
};
