const crypto = require('crypto');
const { sendError } = require('../utils/api-error');
const {
  isTenantFilesWorkersEnabled,
} = require('../tenant-context/capabilities');
const {
  WORKER_PROTOCOL_VERSION,
  getWorkerCredentialId,
  normalizeWorkerLabel,
} = require('../files-workers/transcription-lease');

function normalizeToken(value) {
  const token = String(value || '').trim();
  return token || null;
}

function getConfiguredWorkerToken() {
  return (
    normalizeToken(process.env.CRM_WORKER_TOKEN) ||
    normalizeToken(process.env.TELEPHONY_TRANSCRIPTION_WORKER_TOKEN) ||
    normalizeToken(process.env.TRANSCRIPTION_WORKER_TOKEN)
  );
}

function readWorkerToken(req) {
  const authorization = normalizeToken(req.headers.authorization);
  if (authorization) {
    const bearer = authorization.replace(/^Bearer\s+/i, '').trim();
    if (bearer) return bearer;
  }

  const headerValue = req.headers['x-worker-token'];
  return normalizeToken(Array.isArray(headerValue) ? headerValue[0] : headerValue);
}

function secureCompare(left, right) {
  const leftBuffer = Buffer.from(String(left || ''));
  const rightBuffer = Buffer.from(String(right || ''));
  if (leftBuffer.length !== rightBuffer.length) return false;

  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function requireTranscriptionWorkerToken(req, res, next) {
  const configuredToken = getConfiguredWorkerToken();
  if (!configuredToken) {
    return sendError(
      res,
      { statusCode: 503 },
      'CRM_WORKER_TOKEN или TELEPHONY_TRANSCRIPTION_WORKER_TOKEN не настроен',
    );
  }

  const providedToken = readWorkerToken(req);
  if (!providedToken || !secureCompare(providedToken, configuredToken)) {
    return sendError(res, { statusCode: 401 }, 'Unauthorized worker');
  }

  const requestedProtocol = Number(req.headers['x-worker-protocol-version'] || 1);
  if (
    isTenantFilesWorkersEnabled() &&
    requestedProtocol !== WORKER_PROTOCOL_VERSION
  ) {
    return sendError(
      res,
      {
        code: 'WORKER_PROTOCOL_UPGRADE_REQUIRED',
        message: `Worker protocol ${WORKER_PROTOCOL_VERSION} is required`,
        statusCode: 426,
      },
      'Worker protocol upgrade is required',
    );
  }

  req.transcriptionWorker = Object.freeze({
    authenticated: true,
    credentialId: getWorkerCredentialId(),
    instanceId: normalizeWorkerLabel(req.headers['x-worker-instance-id']),
    protocolVersion: requestedProtocol,
    scope: 'platform',
  });
  next();
}

module.exports = {
  requireTranscriptionWorkerToken,
  getConfiguredWorkerToken,
  readWorkerToken,
};
