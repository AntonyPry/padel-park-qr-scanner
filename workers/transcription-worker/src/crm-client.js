class CrmApiError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'CrmApiError';
    this.method = details.method;
    this.payload = details.payload;
    this.retryAfterSeconds = details.retryAfterSeconds || null;
    this.status = details.status;
    this.url = details.url;
  }
}

const MAX_RETRY_AFTER_SECONDS = 300;

function parseRetryAfterSeconds(value, maximum = MAX_RETRY_AFTER_SECONDS) {
  if (typeof value !== 'string' || value.length > 10 || !/^[1-9]\d*$/u.test(value)) {
    return null;
  }
  const seconds = Number(value);
  if (!Number.isSafeInteger(seconds) || seconds < 1) return null;
  return Math.min(seconds, maximum);
}

function joinUrl(baseUrl, path) {
  return `${String(baseUrl || '').replace(/\/+$/, '')}/${String(path || '').replace(/^\/+/, '')}`;
}

function extractErrorMessage(payload) {
  if (!payload) return null;
  if (typeof payload === 'string') return payload.slice(0, 500);
  if (typeof payload.error === 'string') return payload.error;
  if (typeof payload.message === 'string') return payload.message;
  return JSON.stringify(payload).slice(0, 500);
}

class CrmClient {
  constructor(config) {
    this.baseUrl = config.crmApiUrl;
    this.token = config.crmWorkerToken;
    this.workerInstanceId = config.workerId;
  }

  async request(path, options = {}) {
    const method = options.method || 'GET';
    const url = joinUrl(this.baseUrl, path);
    const headers = {
      Accept: 'application/json',
      Authorization: `Bearer ${this.token}`,
      'X-Worker-Instance-Id': this.workerInstanceId,
      'X-Worker-Protocol-Version': '2',
      ...(options.headers || {}),
    };
    const request = { headers, method };

    if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      request.body = JSON.stringify(options.body);
    }

    let response;
    try {
      response = await fetch(url, request);
    } catch (error) {
      throw new CrmApiError(`CRM request failed: ${error.message}`, {
        method,
        url,
      });
    }

    if (response.status === 429) {
      throw new CrmApiError('CRM request rate limited', {
        method,
        retryAfterSeconds: parseRetryAfterSeconds(response.headers.get('retry-after')),
        status: response.status,
      });
    }

    const contentType = response.headers.get('content-type') || '';
    const raw = await response.text();
    let payload = raw;
    if (contentType.includes('application/json') && raw) {
      try {
        payload = JSON.parse(raw);
      } catch (_error) {
        payload = raw;
      }
    }

    if (!response.ok) {
      const apiMessage = extractErrorMessage(payload);
      throw new CrmApiError(
        `CRM ${method} ${path} returned HTTP ${response.status}${apiMessage ? `: ${apiMessage}` : ''}`,
        {
          method,
          payload,
          status: response.status,
          url,
        },
      );
    }

    return payload || null;
  }

  claimJob(workerId) {
    return this.request('/telephony/transcription-jobs/claim', {
      body: { workerId },
      method: 'POST',
    });
  }

  getAudioReference(job) {
    return this.request(`/telephony/transcription-jobs/${job.id}/audio-reference`, {
      body: leaseBody(job),
      method: 'POST',
    });
  }

  updateProgress(job, stage, progress, message) {
    return this.request(`/telephony/transcription-jobs/${job.id}/progress`, {
      body: { ...leaseBody(job), message, progress, stage },
      method: 'POST',
    });
  }

  completeJob(job, payload) {
    return this.request(`/telephony/transcription-jobs/${job.id}/result`, {
      body: { ...payload, ...leaseBody(job) },
      method: 'POST',
    });
  }

  failJob(job, errorMessage) {
    return this.request(`/telephony/transcription-jobs/${job.id}/fail`, {
      body: { ...leaseBody(job), errorMessage },
      method: 'POST',
    });
  }
}

function leaseBody(job) {
  const claim = job?.claimContext;
  if (!claim?.claimId || !claim?.claimToken) return {};
  return { claimId: claim.claimId, claimToken: claim.claimToken };
}

function attachClaimContext(job, claimed) {
  if (!job || !claimed?.lease) return job;
  Object.defineProperty(job, 'claimContext', {
    configurable: false,
    enumerable: false,
    value: Object.freeze({
      ...claimed.lease,
      protocolVersion: claimed.protocolVersion,
      tenant: claimed.tenant,
    }),
    writable: false,
  });
  return job;
}

module.exports = {
  CrmApiError,
  CrmClient,
  MAX_RETRY_AFTER_SECONDS,
  attachClaimContext,
  leaseBody,
  parseRetryAfterSeconds,
};
