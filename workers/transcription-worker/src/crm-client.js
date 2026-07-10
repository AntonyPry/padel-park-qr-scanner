class CrmApiError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'CrmApiError';
    this.method = details.method;
    this.payload = details.payload;
    this.status = details.status;
    this.url = details.url;
  }
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
  }

  async request(path, options = {}) {
    const method = options.method || 'GET';
    const url = joinUrl(this.baseUrl, path);
    const headers = {
      Accept: 'application/json',
      Authorization: `Bearer ${this.token}`,
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

  getAudioReference(jobId) {
    return this.request(`/telephony/transcription-jobs/${jobId}/audio-reference`, {
      method: 'POST',
    });
  }

  updateProgress(jobId, stage, progress, message) {
    return this.request(`/telephony/transcription-jobs/${jobId}/progress`, {
      body: { message, progress, stage },
      method: 'POST',
    });
  }

  completeJob(jobId, payload) {
    return this.request(`/telephony/transcription-jobs/${jobId}/result`, {
      body: payload,
      method: 'POST',
    });
  }

  failJob(jobId, errorMessage) {
    return this.request(`/telephony/transcription-jobs/${jobId}/fail`, {
      body: { errorMessage },
      method: 'POST',
    });
  }
}

module.exports = {
  CrmApiError,
  CrmClient,
};
