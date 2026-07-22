'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  WORKER_PROTOCOL_VERSION,
  assertActiveLease,
  createLease,
} = require('../../src/files-workers/transcription-lease');

function claimedJob(lease, overrides = {}) {
  return {
    claimExpiresAt: lease.claimExpiresAt,
    claimId: lease.claimId,
    claimTokenHash: lease.claimTokenHash,
    claimWorkerCredentialId: 'platform-a',
    status: 'processing',
    workerProtocolVersion: WORKER_PROTOCOL_VERSION,
    ...overrides,
  };
}

const worker = { credentialId: 'platform-a', protocolVersion: WORKER_PROTOCOL_VERSION };

test('active lease binds claim token, credential and protocol to the server-owned job', () => {
  const now = new Date('2026-07-15T12:00:00.000Z');
  const lease = createLease(now);
  assert.equal(
    assertActiveLease(
      claimedJob(lease),
      { claimId: lease.claimId, claimToken: lease.claimToken, organizationId: 999 },
      worker,
      new Date('2026-07-15T12:01:00.000Z'),
    ).claimId,
    lease.claimId,
  );
});

test('wrong worker, stale token, expired lease and reclaimed attempt fail with safe denial', () => {
  const now = new Date('2026-07-15T12:00:00.000Z');
  const oldLease = createLease(now);
  const currentLease = createLease(now);
  const request = { claimId: oldLease.claimId, claimToken: oldLease.claimToken };
  const cases = [
    [claimedJob(oldLease), request, { credentialId: 'other', protocolVersion: 2 }, new Date('2026-07-15T12:01:00.000Z')],
    [claimedJob(oldLease), { ...request, claimToken: 'forged-token' }, worker, new Date('2026-07-15T12:01:00.000Z')],
    [claimedJob(oldLease, { claimExpiresAt: new Date('2026-07-15T11:59:59.000Z') }), request, worker, now],
    [claimedJob(currentLease), request, worker, new Date('2026-07-15T12:01:00.000Z')],
  ];
  for (const args of cases) {
    assert.throws(
      () => assertActiveLease(...args),
      (error) => error.code === 'WORKER_LEASE_INVALID' && error.statusCode === 404,
    );
  }
});
