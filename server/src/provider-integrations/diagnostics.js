'use strict';

const crypto = require('node:crypto');
const db = require('../../models');

function diagnosticHash(value) {
  const normalized = String(value || '').trim();
  return normalized
    ? crypto.createHash('sha256').update(normalized).digest('hex')
    : null;
}

async function recordRejectedIngress({
  provider,
  publicId,
  reasonCode,
  requestId,
  sourceIp,
} = {}) {
  try {
    return await db.ProviderIngressDiagnostic.create({
      connectionPublicIdHash: diagnosticHash(publicId),
      outcome: 'rejected',
      provider: String(provider || 'unknown').slice(0, 32),
      reasonCode: String(reasonCode || 'PROVIDER_CONNECTION_REJECTED').slice(0, 64),
      requestFingerprint: diagnosticHash(requestId || sourceIp || 'unavailable'),
    });
  } catch {
    return null;
  }
}

module.exports = {
  diagnosticHash,
  recordRejectedIngress,
};
