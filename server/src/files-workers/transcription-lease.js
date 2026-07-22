'use strict';

const crypto = require('node:crypto');

const WORKER_PROTOCOL_VERSION = 2;
const DEFAULT_LEASE_SECONDS = 30 * 60;
const MIN_LEASE_SECONDS = 60;
const MAX_LEASE_SECONDS = 60 * 60;

function normalizeWorkerLabel(value, fallback = null) {
  const label = String(value || '').trim();
  if (!label) return fallback;
  return label.replace(/[^a-zA-Z0-9._:-]/g, '_').slice(0, 96) || fallback;
}

function getWorkerCredentialId() {
  return normalizeWorkerLabel(
    process.env.CRM_WORKER_CREDENTIAL_ID,
    'platform-transcription-worker',
  );
}

function getLeaseDurationMs(value = process.env.TRANSCRIPTION_WORKER_LEASE_SECONDS) {
  const parsed = Number(value);
  const seconds = Number.isFinite(parsed)
    ? Math.min(Math.max(Math.trunc(parsed), MIN_LEASE_SECONDS), MAX_LEASE_SECONDS)
    : DEFAULT_LEASE_SECONDS;
  return seconds * 1000;
}

function hashClaimToken(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

function createLease(now = new Date()) {
  const claimToken = crypto.randomBytes(32).toString('base64url');
  return {
    claimExpiresAt: new Date(now.getTime() + getLeaseDurationMs()),
    claimId: crypto.randomUUID(),
    claimToken,
    claimTokenHash: hashClaimToken(claimToken),
  };
}

function secureEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ''));
  const rightBuffer = Buffer.from(String(right || ''));
  if (leftBuffer.length === 0 || leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function leaseError(message = 'Worker lease is invalid or expired') {
  const error = new Error(message);
  error.statusCode = 404;
  error.code = 'WORKER_LEASE_INVALID';
  return error;
}

function assertActiveLease(job, data, worker, now = new Date()) {
  const claimId = String(data?.claimId || '').trim();
  const claimToken = String(data?.claimToken || '').trim();
  const expiresAt = job?.claimExpiresAt ? new Date(job.claimExpiresAt) : null;
  const valid =
    job?.status === 'processing' &&
    claimId &&
    claimToken &&
    claimId === String(job.claimId || '') &&
    secureEqual(hashClaimToken(claimToken), job.claimTokenHash) &&
    worker?.credentialId === job.claimWorkerCredentialId &&
    Number(worker?.protocolVersion) === WORKER_PROTOCOL_VERSION &&
    Number(job.workerProtocolVersion) === WORKER_PROTOCOL_VERSION &&
    expiresAt &&
    Number.isFinite(expiresAt.getTime()) &&
    expiresAt.getTime() > now.getTime();
  if (!valid) throw leaseError();
  return {
    claimExpiresAt: expiresAt,
    claimId,
    claimToken,
  };
}

function publicLease(lease, attempt) {
  return Object.freeze({
    attempt: Number(attempt),
    claimId: lease.claimId,
    claimToken: lease.claimToken,
    expiresAt: lease.claimExpiresAt.toISOString(),
  });
}

module.exports = {
  DEFAULT_LEASE_SECONDS,
  MAX_LEASE_SECONDS,
  MIN_LEASE_SECONDS,
  WORKER_PROTOCOL_VERSION,
  assertActiveLease,
  createLease,
  getLeaseDurationMs,
  getWorkerCredentialId,
  hashClaimToken,
  leaseError,
  normalizeWorkerLabel,
  publicLease,
  secureEqual,
};
