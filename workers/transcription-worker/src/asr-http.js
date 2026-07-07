const fsp = require('node:fs/promises');
const path = require('node:path');

function normalizeBaseUrl(value) {
  return String(value || '').replace(/\/+$/, '');
}

function buildAsrUrl(baseUrl, config, initialPrompt) {
  const url = new URL(`${normalizeBaseUrl(baseUrl)}/asr`);
  url.searchParams.set('task', config.asrTask || 'transcribe');
  url.searchParams.set('language', config.whisperLanguage || 'ru');
  url.searchParams.set('output', config.asrOutput || 'json');
  url.searchParams.set('vad_filter', 'false');
  url.searchParams.set('word_timestamps', config.asrWordTimestamps ? 'true' : 'false');
  if (initialPrompt) {
    url.searchParams.set('initial_prompt', initialPrompt);
  }
  return url;
}

function endpointCandidates(config) {
  const defaultEndpoint = {
    baseUrl: normalizeBaseUrl(config.asrBaseUrl),
    profile: 'default',
  };
  if (
    config.asrProfile === 'quality' &&
    config.asrQualityBaseUrl &&
    normalizeBaseUrl(config.asrQualityBaseUrl) !== defaultEndpoint.baseUrl
  ) {
    const qualityEndpoint = {
      baseUrl: normalizeBaseUrl(config.asrQualityBaseUrl),
      profile: 'quality',
    };
    return config.asrQualityFallbackEnabled
      ? [qualityEndpoint, defaultEndpoint]
      : [qualityEndpoint];
  }
  return [defaultEndpoint];
}

function normalizeAsrTimeMs(segment, field, offsetMs) {
  const msValue = Number(segment[`${field}Ms`]);
  if (Number.isFinite(msValue) && msValue >= 0) return Math.round(msValue + offsetMs);

  const value = Number(segment[field]);
  if (!Number.isFinite(value) || value < 0) return null;
  const relativeMs = value <= 36 * 60 * 60 ? value * 1000 : value;
  return Math.round(relativeMs + offsetMs);
}

function textFromAsrSegment(segment) {
  return String(segment?.text || segment?.transcript || segment?.phrase || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseAsrResponse(payload, options = {}) {
  const offsetMs = Number(options.offsetMs || 0);
  const fallbackEndMs =
    Number.isFinite(Number(options.durationMs)) && Number(options.durationMs) > 0
      ? Math.round(offsetMs + Number(options.durationMs))
      : null;
  const rawSegments = Array.isArray(payload?.segments) ? payload.segments : [];
  const segments = rawSegments
    .map((segment) => {
      const text = textFromAsrSegment(segment);
      if (!text) return null;
      return {
        confidence:
          Number.isFinite(Number(segment.confidence)) && Number(segment.confidence) >= 0
            ? Math.max(0, Math.min(1, Number(segment.confidence)))
            : null,
        endMs: normalizeAsrTimeMs(segment, 'end', offsetMs),
        startMs: normalizeAsrTimeMs(segment, 'start', offsetMs),
        text,
      };
    })
    .filter(Boolean);

  const text = String(payload?.text || payload?.transcript || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (segments.length === 0 && text) {
    segments.push({
      confidence: null,
      endMs: fallbackEndMs,
      startMs: Math.round(offsetMs),
      text,
    });
  }

  return {
    segments,
    text: text || segments.map((segment) => segment.text).join(' ').trim(),
  };
}

async function postAsr(filePath, endpoint, config, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.asrTimeoutMs);
  const initialPrompt =
    config.asrInitialPromptEnabled === false ? null : options.initialPrompt || null;
  const url = buildAsrUrl(endpoint.baseUrl, config, initialPrompt);

  try {
    const buffer = await fsp.readFile(filePath);
    const form = new FormData();
    form.append(
      'audio_file',
      new Blob([buffer], { type: 'audio/wav' }),
      path.basename(filePath),
    );

    const started = Date.now();
    const response = await fetch(url, {
      body: form,
      method: 'POST',
      signal: controller.signal,
    });
    const rawText = await response.text();
    let payload = rawText;
    try {
      payload = rawText ? JSON.parse(rawText) : {};
    } catch (_error) {
      payload = rawText;
    }

    if (!response.ok) {
      const message =
        typeof payload === 'object'
          ? payload.error || payload.message || JSON.stringify(payload).slice(0, 500)
          : String(payload).slice(0, 500);
      throw new Error(`HTTP ${response.status}${message ? `: ${message}` : ''}`);
    }

    return {
      durationMs: Date.now() - started,
      endpointProfile: endpoint.profile,
      endpointUrl: endpoint.baseUrl,
      parsed: parseAsrResponse(payload, options),
      rawResponse: payload,
    };
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error(`timeout after ${Math.round(config.asrTimeoutMs / 1000)}s`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function transcribeHttpAsr(filePath, config, logger, options = {}) {
  const endpoints = endpointCandidates(config);
  const failures = [];

  for (const endpoint of endpoints) {
    try {
      const result = await postAsr(filePath, endpoint, config, options);
      if (failures.length > 0) {
        result.fallbackFrom = failures.map((failure) => failure.endpointUrl);
        logger?.warn?.('ASR quality endpoint failed, used fallback endpoint', {
          fallbackFrom: result.fallbackFrom,
          used: endpoint.baseUrl,
        });
      }
      return result;
    } catch (error) {
      failures.push({
        endpointUrl: endpoint.baseUrl,
        error: error.message,
      });
      logger?.warn?.('ASR endpoint request failed', {
        endpoint: endpoint.baseUrl,
        error: error.message,
        profile: endpoint.profile,
      });
    }
  }

  throw new Error(
    `ASR endpoint недоступен: ${failures
      .map((failure) => `${failure.endpointUrl} (${failure.error})`)
      .join('; ')}`,
  );
}

module.exports = {
  endpointCandidates,
  parseAsrResponse,
  transcribeHttpAsr,
};
