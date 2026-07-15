'use strict';

const assert = require('node:assert/strict');
const { after, before, test } = require('node:test');
const db = require('../../models');
const authService = require('../../src/services/auth.service');
const tenantFoundation = require('../../src/services/tenant-foundation.service');
const {
  autoEnqueueTranscriptionJob,
  claimTranscriptionJob,
  completeTranscriptionJob,
  getTranscriptionJobAudioReference,
  getWorkerTranscriptionQueue,
  listTranscriptionJobs,
  updateTranscriptionJobProgress,
} = require('../../src/services/telephony.service');

const envNames = [
  'TENANT_CONTEXT_ENABLED',
  'TENANT_CACHE_REALTIME_ENABLED',
  'TENANT_FILES_WORKERS_ENABLED',
  'TENANT_FOUNDATION_GATE_CACHE_MS',
  'TRANSCRIPTION_WORKER_LEASE_SECONDS',
];
const previousEnv = Object.fromEntries(envNames.map((name) => [name, process.env[name]]));
const calls = [];

const platformWorker = Object.freeze({
  authenticated: true,
  credentialId: 'platform-transcription-worker',
  instanceId: 'db-worker-a',
  protocolVersion: 2,
  scope: 'platform',
});

async function ensureInitializedTenant() {
  tenantFoundation.invalidateTenantFoundationGateCache();
  const classification = await tenantFoundation.classifyTenantFoundation();
  if (classification.state === 'bootstrap-pending') {
    await authService.bootstrapOwner({
      email: 'feature-4-2-owner@setly.test',
      name: 'Feature 4.2 Owner',
      password: 'Feature42Owner!',
      phone: null,
    });
  }
  tenantFoundation.invalidateTenantFoundationGateCache();
  const initialized = await tenantFoundation.classifyTenantFoundation();
  assert.equal(initialized.state, 'initialized');
  return {
    organizationId: Number(initialized.defaultOrganizationId),
    clubId: Number(initialized.defaultClubId),
  };
}

async function recordedCall(suffix) {
  const call = await db.TelephonyCall.create({
    clientPhone: '+7 999 123-45-67',
    externalCallId: `feature-4-2-${suffix}-${Date.now()}`,
    recordingExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
    recordingStatus: 'available',
    recordingUrl: `https://recordings.invalid/${suffix}?token=must-not-leak`,
    startedAt: new Date(),
  });
  calls.push(call);
  return call;
}

before(async () => {
  assert.ok(process.env.DB_USER, 'DB_USER is required for DB-backed files/workers tests');
  process.env.TENANT_CONTEXT_ENABLED = 'true';
  process.env.TENANT_CACHE_REALTIME_ENABLED = 'true';
  process.env.TENANT_FILES_WORKERS_ENABLED = 'true';
  process.env.TENANT_FOUNDATION_GATE_CACHE_MS = '0';
  process.env.TRANSCRIPTION_WORKER_LEASE_SECONDS = '60';
  await db.sequelize.authenticate();
  await ensureInitializedTenant();
});

after(async () => {
  for (const call of calls.reverse()) {
    await db.TelephonyTranscriptSegment.destroy({ where: { telephonyCallId: call.id } }).catch(() => {});
    await db.TelephonyTranscriptionJob.destroy({ where: { telephonyCallId: call.id } }).catch(() => {});
    await call.destroy().catch(() => {});
  }
  for (const [name, value] of Object.entries(previousEnv)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  tenantFoundation.invalidateTenantFoundationGateCache();
});

test('claim is tenant-attributed, minimal and unique under concurrent workers', async () => {
  const tenant = await ensureInitializedTenant();
  const firstCall = await recordedCall('claim-a');
  const secondCall = await recordedCall('claim-b');
  await Promise.all([
    autoEnqueueTranscriptionJob(firstCall.id),
    autoEnqueueTranscriptionJob(secondCall.id),
  ]);

  const [first, second] = await Promise.all([
    claimTranscriptionJob({}, platformWorker),
    claimTranscriptionJob({}, { ...platformWorker, instanceId: 'db-worker-b' }),
  ]);
  assert.ok(first.job && second.job);
  assert.notEqual(first.job.id, second.job.id);
  for (const claimed of [first, second]) {
    assert.equal(claimed.protocolVersion, 2);
    assert.equal(claimed.tenant.organizationId, tenant.organizationId);
    assert.equal(claimed.tenant.clubId, tenant.clubId);
    assert.match(claimed.tenant.organizationKey, /^org_/);
    assert.match(claimed.tenant.clubKey, /^club_/);
    assert.ok(claimed.lease.claimId);
    assert.ok(claimed.lease.claimToken);
    assert.equal(claimed.job.transcriptText, undefined);
    assert.equal(claimed.job.rawTranscriptText, undefined);
    assert.equal(claimed.job.call.clientPhone, undefined);
    assert.equal(JSON.stringify(claimed.job).includes('must-not-leak'), false);
  }
  const persisted = await db.TelephonyTranscriptionJob.findByPk(first.job.id);
  await assert.rejects(
    persisted.update({ clubId: tenant.clubId + 999 }),
    (error) => error.code === 'TENANT_ATTRIBUTION_IMMUTABLE',
  );
});

test('lease owns audio/progress/result and rejects forged tenant, wrong worker and stale reclaim', async () => {
  const tenant = await ensureInitializedTenant();
  const call = await recordedCall('lease');
  await autoEnqueueTranscriptionJob(call.id, { tenant });
  const claimed = await claimTranscriptionJob({}, platformWorker);
  assert.ok(claimed.job);
  const leaseRequest = {
    claimId: claimed.lease.claimId,
    claimToken: claimed.lease.claimToken,
  };

  const audio = await getTranscriptionJobAudioReference(
    claimed.job.id,
    { ...leaseRequest, organizationId: 999999, clubId: 999999 },
    platformWorker,
  );
  assert.equal(audio.job.organizationId, tenant.organizationId);
  assert.equal(audio.job.clubId, tenant.clubId);
  assert.ok(audio.audio.downloadUrl);

  await assert.rejects(
    updateTranscriptionJobProgress(
      claimed.job.id,
      { ...leaseRequest, progress: 25, stage: 'ffmpeg_preprocess' },
      { ...platformWorker, credentialId: 'other-platform-worker' },
    ),
    (error) => error.code === 'WORKER_LEASE_INVALID' && error.statusCode === 404,
  );
  await updateTranscriptionJobProgress(
    claimed.job.id,
    { ...leaseRequest, progress: 25, stage: 'ffmpeg_preprocess' },
    platformWorker,
  );

  await db.TelephonyTranscriptionJob.update(
    { claimExpiresAt: new Date(Date.now() - 1000) },
    { where: { id: claimed.job.id } },
  );
  const reclaimed = await claimTranscriptionJob({}, platformWorker);
  assert.equal(reclaimed.job.id, claimed.job.id);
  assert.notEqual(reclaimed.lease.claimId, claimed.lease.claimId);
  assert.equal(reclaimed.lease.attempt, claimed.lease.attempt + 1);

  await assert.rejects(
    completeTranscriptionJob(
      claimed.job.id,
      { ...leaseRequest, transcriptText: 'stale result must fail' },
      platformWorker,
    ),
    (error) => error.code === 'WORKER_LEASE_INVALID' && error.statusCode === 404,
  );
  const completed = await completeTranscriptionJob(
    reclaimed.job.id,
    {
      claimId: reclaimed.lease.claimId,
      claimToken: reclaimed.lease.claimToken,
      segments: [{ speaker: 'client', startMs: 100, endMs: 200, text: 'Безопасный результат' }],
    },
    platformWorker,
  );
  assert.equal(completed.job.status, 'completed');
});

test('tenant list probing is non-disclosing and worker queue omits raw/AI payloads and PII', async () => {
  const tenant = await ensureInitializedTenant();
  const probed = await listTranscriptionJobs(
    { id: null, role: 'owner' },
    { pageSize: 10 },
    { organizationId: tenant.organizationId + 999, clubId: tenant.clubId + 999 },
  );
  assert.equal(probed.total, 0);
  assert.deepEqual(probed.items, []);

  const queue = await getWorkerTranscriptionQueue({ pageSize: 100 });
  for (const item of queue.items) {
    assert.equal(item.rawTranscriptText, undefined);
    assert.equal(item.transcriptText, undefined);
    assert.equal(item.aiTranscriptText, undefined);
    assert.equal(item.call?.clientPhone, undefined);
    assert.equal(JSON.stringify(item).includes('must-not-leak'), false);
  }
});
