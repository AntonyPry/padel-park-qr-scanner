function normalizeText(value) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text || null;
}

function normalizeBaseUrl(value) {
  return String(value || '').replace(/\/+$/, '');
}

function segmentIdForIndex(index) {
  return `s${index + 1}`;
}

function speakerLabel(speaker) {
  if (speaker === 'administrator') return 'Администратор';
  if (speaker === 'client') return 'Клиент';
  return 'Неизвестно';
}

function formatTime(ms) {
  if (!Number.isFinite(Number(ms))) return '??:??';
  const totalSeconds = Math.max(0, Math.floor(Number(ms) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const prefix = hours > 0 ? `${String(hours).padStart(2, '0')}:` : '';
  return `${prefix}${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function formatTranscriptLines(segments = []) {
  return segments
    .map((segment) => {
      const prefix = segment.startMs === null || segment.startMs === undefined
        ? ''
        : `[${formatTime(segment.startMs)}] `;
      return `${prefix}${speakerLabel(segment.speaker)}: ${segment.text}`;
    })
    .join('\n');
}

function flattenStringList(value, output = []) {
  if (typeof value === 'string') {
    const text = normalizeText(value);
    if (text) output.push(text);
    return output;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => flattenStringList(item, output));
  }
  return output;
}

function normalizeStringList(value, maxItems = 12) {
  return [...new Set(flattenStringList(value))].slice(0, maxItems);
}

function normalizeConfidence(value) {
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['high', 'medium', 'low'].includes(normalized)) return normalized;
    return null;
  }
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0 || number > 1) return null;
  return number;
}

function hasForbiddenArtifact(text) {
  const normalized = normalizeText(text)?.toLowerCase().replace(/ё/g, 'е') || '';
  if (!normalized) return true;
  if (normalized.includes('продолжение следует')) return true;
  if (/^контекст(?=$|[\s:;,.!?-])/u.test(normalized)) return true;
  if (/^редактор(?=$|[\s:;,.!?-])/u.test(normalized)) return true;
  if (/^корректор(?=$|[\s:;,.!?-])/u.test(normalized)) return true;
  return false;
}

function buildLlmInputSegments(segments = []) {
  return segments.map((segment, index) => ({
    segmentId: segmentIdForIndex(index),
    speaker: segment.speaker || 'unknown',
    startMs: Number.isFinite(Number(segment.startMs)) ? Number(segment.startMs) : null,
    endMs: Number.isFinite(Number(segment.endMs)) ? Number(segment.endMs) : null,
    text: normalizeText(segment.text) || '',
  }));
}

function buildLlmPrompt(inputSegments) {
  return [
    'Ты редактируешь ASR-транскрибацию телефонного звонка падел-клуба.',
    'Исправляй только очевидные ошибки распознавания русской речи и терминов клуба.',
    'Не переписывай диалог целиком, не добавляй новые факты, имена, цены, даты или телефоны.',
    'Не меняй роли, каналы и тайминги. Не возвращай speaker, startMs или endMs.',
    'Не добавляй служебные фразы: Контекст, Продолжение следует, Редактор, Корректор.',
    'Пример безопасной правки: "корт заманировать" -> "корт забронировать".',
    'Верни строго JSON без markdown по схеме:',
    '{"segments":[{"segmentId":"s1","editedText":"...","confidence":"high|medium|low","changes":["..."],"warnings":[]}],"warnings":[]}',
    'Если сегмент не требует правки, верни его с исходным текстом и пустым changes.',
    '',
    JSON.stringify({ segments: inputSegments }, null, 2),
  ].join('\n');
}

function parseJsonText(value) {
  if (value && typeof value === 'object') return value;
  const text = String(value || '').trim();
  if (!text) throw new Error('LLM returned empty response');
  try {
    return JSON.parse(text);
  } catch (error) {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced) return JSON.parse(fenced[1]);
    const objectMatch = text.match(/\{[\s\S]*\}/);
    if (objectMatch) return JSON.parse(objectMatch[0]);
    throw error;
  }
}

function normalizeLlmPayload(rawPayload) {
  const payload = rawPayload && typeof rawPayload === 'object' ? rawPayload : {};
  const segments = Array.isArray(payload.segments) ? payload.segments : [];
  return {
    rawPayload: payload,
    segments,
    warnings: normalizeStringList(payload.warnings),
  };
}

function applyLlmEditsToTranscript(transcript, rawPayload, baseMetadata = {}) {
  const baseSegments = Array.isArray(transcript?.segments) ? transcript.segments : [];
  const inputSegments = buildLlmInputSegments(baseSegments);
  const outputSegments = baseSegments.map((segment, index) => ({
    channel: segment.channel || null,
    changes: [],
    confidence: null,
    editedText: normalizeText(segment.text) || '',
    endMs: Number.isFinite(Number(segment.endMs)) ? Number(segment.endMs) : null,
    segmentId: segmentIdForIndex(index),
    sortOrder: index,
    sourceText: normalizeText(segment.text) || '',
    speaker: segment.speaker || 'unknown',
    startMs: Number.isFinite(Number(segment.startMs)) ? Number(segment.startMs) : null,
    text: normalizeText(segment.text) || '',
    warnings: [],
  }));
  const byId = new Map(outputSegments.map((segment) => [segment.segmentId, segment]));
  const knownIds = new Set(outputSegments.map((segment) => segment.segmentId));
  const acceptedIds = new Set();
  const ignoredUnknownSegmentIds = [];
  const rejectedSegmentIds = [];
  const corrections = [];
  const normalizedPayload = normalizeLlmPayload(rawPayload);

  normalizedPayload.segments.forEach((item) => {
    if (!item || typeof item !== 'object') return;
    const segmentId = normalizeText(item.segmentId);
    if (!segmentId || !byId.has(segmentId)) {
      if (segmentId) ignoredUnknownSegmentIds.push(segmentId);
      return;
    }

    const editedText = normalizeText(item.editedText);
    if (!editedText || hasForbiddenArtifact(editedText)) {
      rejectedSegmentIds.push(segmentId);
      return;
    }

    const target = byId.get(segmentId);
    const changes = normalizeStringList(item.changes);
    const warnings = normalizeStringList(item.warnings);
    target.text = editedText;
    target.editedText = editedText;
    target.confidence = normalizeConfidence(item.confidence);
    target.changes = changes;
    target.warnings = warnings;
    acceptedIds.add(segmentId);

    if (target.sourceText !== editedText || changes.length > 0 || warnings.length > 0) {
      corrections.push({
        channel: target.channel,
        changes,
        confidence: target.confidence,
        endMs: target.endMs,
        original: target.sourceText,
        normalized: editedText,
        segmentId,
        speaker: target.speaker,
        startMs: target.startMs,
        type: 'llm_edit',
        warnings,
      });
    }
  });

  const missingSegmentIds = [...knownIds].filter((segmentId) => !acceptedIds.has(segmentId));

  return {
    aiCorrections: corrections,
    aiMetadata: {
      ...baseMetadata,
      acceptedSegmentIds: [...acceptedIds],
      ignoredUnknownSegmentIds: [...new Set(ignoredUnknownSegmentIds)],
      inputSegments: inputSegments.length,
      missingSegmentIds,
      rejectedSegmentIds: [...new Set(rejectedSegmentIds)],
      returnedSegments: normalizedPayload.segments.length,
      status: 'completed',
      warnings: normalizedPayload.warnings,
    },
    aiTranscriptSegments: outputSegments,
    aiTranscriptText: formatTranscriptLines(outputSegments),
  };
}

async function callOllamaGenerate(prompt, config, fetchImpl) {
  const baseUrl = normalizeBaseUrl(config.transcriptionLlmBaseUrl);
  const url = `${baseUrl}/api/generate`;
  const timeoutMs = config.transcriptionLlmTimeoutMs;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(url, {
      body: JSON.stringify({
        format: 'json',
        model: config.transcriptionLlmModel,
        options: {
          num_ctx: config.transcriptionLlmNumCtx,
          temperature: 0,
        },
        prompt,
        stream: false,
      }),
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      method: 'POST',
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${text.slice(0, 500)}`);
    }
    const outerPayload = parseJsonText(text);
    const innerPayload = parseJsonText(outerPayload.response || outerPayload);
    return {
      outerPayload,
      payload: innerPayload,
    };
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error(`timeout after ${Math.round(timeoutMs / 1000)}s`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function postprocessTranscriptWithLlm(
  transcript,
  config,
  logger = null,
  fetchImpl = globalThis.fetch,
) {
  if (!config.transcriptionAiPostprocessingEnabled) {
    return {
      ...transcript,
      aiCorrections: [],
      aiMetadata: {
        enabled: false,
        status: 'disabled',
      },
      aiTranscriptSegments: [],
      aiTranscriptText: null,
    };
  }

  const inputSegments = buildLlmInputSegments(transcript.segments);
  if (inputSegments.length === 0) {
    return {
      ...transcript,
      aiCorrections: [],
      aiMetadata: {
        enabled: true,
        status: 'skipped',
        warnings: ['Нет сегментов для AI-редактуры.'],
      },
      aiTranscriptSegments: [],
      aiTranscriptText: null,
    };
  }

  const prompt = buildLlmPrompt(inputSegments);
  const retryCount = Math.max(0, Number(config.transcriptionLlmRetryCount || 0));
  const attempts = retryCount + 1;
  const started = Date.now();
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await callOllamaGenerate(prompt, config, fetchImpl);
      const applied = applyLlmEditsToTranscript(transcript, response.payload, {
        attempts: attempt,
        baseUrl: normalizeBaseUrl(config.transcriptionLlmBaseUrl),
        durationMs: Date.now() - started,
        enabled: true,
        model: config.transcriptionLlmModel,
        numCtx: config.transcriptionLlmNumCtx,
        provider: 'ollama',
        rawResponse: response.payload,
        timeoutMs: config.transcriptionLlmTimeoutMs,
      });
      logger?.info?.('LLM transcription postprocessing completed', {
        acceptedSegments: applied.aiMetadata.acceptedSegmentIds.length,
        ignoredUnknownSegmentIds: applied.aiMetadata.ignoredUnknownSegmentIds.length,
        missingSegmentIds: applied.aiMetadata.missingSegmentIds.length,
        returnedSegments: applied.aiMetadata.returnedSegments,
      });
      return {
        ...transcript,
        ...applied,
      };
    } catch (error) {
      lastError = error;
      logger?.warn?.('LLM transcription postprocessing failed', {
        attempt,
        attempts,
        error: error.message,
      });
    }
  }

  return {
    ...transcript,
    aiCorrections: [],
    aiMetadata: {
      attempts,
      baseUrl: normalizeBaseUrl(config.transcriptionLlmBaseUrl),
      durationMs: Date.now() - started,
      enabled: true,
      error: lastError?.message || 'LLM postprocessing failed',
      fallback: config.transcriptionLlmFallbackEnabled ? 'normalized_transcript_saved' : 'none',
      model: config.transcriptionLlmModel,
      provider: 'ollama',
      status: 'failed',
      timeoutMs: config.transcriptionLlmTimeoutMs,
    },
    aiTranscriptSegments: [],
    aiTranscriptText: null,
  };
}

module.exports = {
  applyLlmEditsToTranscript,
  buildLlmInputSegments,
  buildLlmPrompt,
  hasForbiddenArtifact,
  postprocessTranscriptWithLlm,
};
