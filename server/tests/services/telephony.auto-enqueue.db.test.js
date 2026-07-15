const assert = require('node:assert/strict');
const { after, before, test } = require('node:test');
const db = require('../../models');
const authService = require('../../src/services/auth.service');
const tenantFoundation = require('../../src/services/tenant-foundation.service');
const {
  autoEnqueueTranscriptionJob,
  getCall,
  listCalls,
  listCallTranscriptionJobs,
  queueMissingTranscriptionJobs,
} = require('../../src/services/telephony.service');

const capabilityEnvNames = [
  'TENANT_CONTEXT_ENABLED',
  'TENANT_CACHE_REALTIME_ENABLED',
  'TENANT_FILES_WORKERS_ENABLED',
  'TENANT_FOUNDATION_GATE_CACHE_MS',
];
const previousCapabilityEnv = Object.fromEntries(
  capabilityEnvNames.map((name) => [name, process.env[name]]),
);
let createdBootstrapAccount = null;
let testTenant = null;

async function initializeDefaultTenantForTest() {
  tenantFoundation.invalidateTenantFoundationGateCache();
  let classification = await tenantFoundation.classifyTenantFoundation();
  if (classification.state === 'bootstrap-pending') {
    const session = await authService.bootstrapOwner({
      email: `feature-4-2-auto-enqueue-${process.pid}@setly.test`,
      name: 'Feature 4.2 Auto Enqueue Owner',
      password: 'Feature42AutoEnqueue!',
      phone: null,
    });
    createdBootstrapAccount = {
      accountId: Number(session.account.id),
      staffId: Number(session.account.staffId),
    };
  }
  tenantFoundation.invalidateTenantFoundationGateCache();
  classification = await tenantFoundation.classifyTenantFoundation();
  assert.equal(classification.state, 'initialized');
  return {
    organizationId: Number(classification.defaultOrganizationId),
    clubId: Number(classification.defaultClubId),
  };
}

async function cleanupCreatedBootstrapOwner() {
  if (!createdBootstrapAccount) return;
  await db.sequelize.transaction(async (transaction) => {
    const membership = await db.Membership.findOne({
      transaction,
      where: { accountId: createdBootstrapAccount.accountId },
    });
    if (membership) {
      await db.MembershipClubAccess.destroy({
        transaction,
        where: { membershipId: membership.id },
      });
      await membership.destroy({ transaction });
    }
    await db.Account.destroy({
      transaction,
      where: { id: createdBootstrapAccount.accountId },
    });
    await db.Staff.destroy({
      transaction,
      where: { id: createdBootstrapAccount.staffId },
    });
  });
  tenantFoundation.invalidateTenantFoundationGateCache();
  const classification = await tenantFoundation.classifyTenantFoundation();
  assert.equal(classification.state, 'bootstrap-pending');
}

before(async () => {
  assert.ok(process.env.DB_USER, 'DB_USER is required for DB-backed auto-enqueue tests');
  process.env.TENANT_CONTEXT_ENABLED = 'true';
  process.env.TENANT_CACHE_REALTIME_ENABLED = 'true';
  process.env.TENANT_FILES_WORKERS_ENABLED = 'true';
  process.env.TENANT_FOUNDATION_GATE_CACHE_MS = '0';
  await db.sequelize.authenticate();
  testTenant = await initializeDefaultTenantForTest();
});

after(async () => {
  await cleanupCreatedBootstrapOwner();
  for (const [name, value] of Object.entries(previousCapabilityEnv)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  tenantFoundation.invalidateTenantFoundationGateCache();
});

async function createRecordedCall(suffix, startedAt = new Date()) {
  return db.TelephonyCall.create({
    externalCallId: `auto-enqueue-db-${suffix}-${Date.now()}`,
    recordingStatus: 'available',
    startedAt,
  });
}

async function cleanupCall(call) {
  if (!call) return;
  await db.TelephonyTranscriptSegment.destroy({ where: { telephonyCallId: call.id } });
  await db.TelephonyTranscriptionJob.destroy({ where: { telephonyCallId: call.id } });
  await call.destroy();
}

async function defaultTenantAttribution() {
  return { ...testTenant };
}

test('DB-backed auto-enqueue stays idempotent across concurrency, statuses and queue-missing', async () => {
  await db.sequelize.authenticate();
  let call;
  let missingCall;
  try {
    call = await createRecordedCall('concurrent');
    await Promise.all([
      autoEnqueueTranscriptionJob(call.id, { tenant: testTenant }),
      autoEnqueueTranscriptionJob(call.id, { tenant: testTenant }),
    ]);
    assert.equal(await db.TelephonyTranscriptionJob.count({ where: { telephonyCallId: call.id } }), 1);

    await autoEnqueueTranscriptionJob(call.id, { tenant: testTenant });
    await autoEnqueueTranscriptionJob(call.id, { tenant: testTenant });
    assert.equal(await db.TelephonyTranscriptionJob.count({ where: { telephonyCallId: call.id } }), 1);

    const job = await db.TelephonyTranscriptionJob.findOne({
      attributes: ['id', 'status'],
      where: { telephonyCallId: call.id },
    });
    for (const status of ['queued', 'processing', 'completed', 'failed']) {
      await job.update({ status });
      await autoEnqueueTranscriptionJob(call.id, { tenant: testTenant });
      assert.equal(
        await db.TelephonyTranscriptionJob.count({ where: { telephonyCallId: call.id } }),
        1,
        `${status} must prevent an automatic duplicate`,
      );
    }

    await job.update({ status: 'queued' });
    assert.equal(job.status, 'queued');
    assert.equal(await db.TelephonyTranscriptionJob.count({ where: { telephonyCallId: call.id } }), 1);

    missingCall = await createRecordedCall('queue-missing', new Date('2099-01-01T00:00:00.000Z'));
    await Promise.all([
      queueMissingTranscriptionJobs({ id: null, role: 'owner' }, { limit: 1 }, testTenant),
      queueMissingTranscriptionJobs({ id: null, role: 'owner' }, { limit: 1 }, testTenant),
    ]);
    assert.equal(
      await db.TelephonyTranscriptionJob.count({ where: { telephonyCallId: missingCall.id } }),
      1,
    );
  } finally {
    await cleanupCall(missingCall);
    await cleanupCall(call);
  }
});

test('DB-backed call transcription list skips large transcript payloads', async () => {
  await db.sequelize.authenticate();
  let call;
  try {
    call = await createRecordedCall('lightweight-list');
    const tenant = await defaultTenantAttribution();
    const largeText = 'large transcript payload '.repeat(1_800);
    await db.TelephonyTranscriptionJob.create({
      ...tenant,
      aiTranscriptSegments: Array.from({ length: 300 }, (_, index) => ({
        editedText: `${index}: ${largeText.slice(0, 200)}`,
        segmentId: `segment-${index}`,
      })),
      aiTranscriptText: largeText,
      metadata: { progress: { percent: 100, stage: 'completed' } },
      rawAsrJson: { channels: [{ parsedSegments: [{ text: largeText }] }] },
      rawTranscriptText: largeText,
      status: 'completed',
      telephonyCallId: call.id,
      transcriptText: largeText,
    });

    const result = await listCallTranscriptionJobs(
      { id: null, role: 'owner' },
      call.id,
      { pageSize: 5 },
      testTenant,
    );

    assert.equal(result.total, 1);
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].status, 'completed');
    assert.equal(result.items[0].rawTranscriptText, null);
    assert.equal(result.items[0].transcriptText, undefined);
    assert.deepEqual(result.items[0].aiTranscriptSegments, []);
    assert.equal(result.items[0].aiTranscriptText, null);
  } finally {
    await cleanupCall(call);
  }
});

test('DB-backed paginated call list skips large transcript payloads while detail stays full', async () => {
  await db.sequelize.authenticate();
  const calls = [];
  const phoneSuffix = String(Date.now()).slice(-7);
  try {
    for (let index = 0; index < 3; index += 1) {
      calls.push(
        await db.TelephonyCall.create({
          clientPhone: `+7 (900) ${phoneSuffix.slice(0, 3)}-${phoneSuffix.slice(3, 5)}-${index}${index}`,
          clientPhoneNormalized: `900${phoneSuffix}${index}${index}`,
          externalCallId: `call-list-db-${phoneSuffix}-${index}`,
          processingStatus: 'new',
          recordingStatus: 'available',
          startedAt: new Date(`2099-01-0${index + 1}T00:00:00.000Z`),
        }),
      );
    }
    const detailCall = calls[0];
    const tenant = await defaultTenantAttribution();
    const largeText = 'large transcript payload '.repeat(1_800);
    await db.TelephonyTranscriptionJob.create({
      ...tenant,
      aiTranscriptSegments: [{ editedText: largeText, segmentId: 'large-1' }],
      aiTranscriptText: largeText,
      metadata: { progress: { percent: 73, stage: 'asr_left' } },
      rawAsrJson: { channels: [{ parsedSegments: [{ text: largeText }] }] },
      rawTranscriptText: largeText,
      status: 'failed',
      errorMessage: 'ASR unavailable',
      telephonyCallId: detailCall.id,
      transcriptText: largeText,
    });
    await db.TelephonyTranscriptSegment.create({
      sortOrder: 0,
      speaker: 'administrator',
      startMs: 0,
      telephonyCallId: detailCall.id,
      transcriptionJobId: (
        await db.TelephonyTranscriptionJob.findOne({ where: { telephonyCallId: detailCall.id } })
      ).id,
      text: largeText,
    });

    const page = await listCalls(
      { id: null, role: 'owner' },
      { page: 3, pageSize: 1, search: phoneSuffix.slice(0, 5), status: 'active' },
      testTenant,
    );
    assert.equal(page.total, 3);
    assert.equal(page.page, 3);
    assert.equal(page.items.length, 1);
    assert.equal(page.items[0].transcription.id > 0, true);
    assert.equal(page.items[0].transcription.status, 'failed');
    const metadata = page.items[0].transcription.metadata;
    assert.equal(typeof metadata, 'object');
    assert.equal(metadata.progress.percent, 73);
    assert.equal(page.items[0].transcription.errorMessage, 'ASR unavailable');
    assert.equal(page.items[0].transcription.transcriptText, undefined);
    assert.deepEqual(page.items[0].transcription.aiTranscriptSegments, []);

    const detail = await getCall({ id: null, role: 'owner' }, detailCall.id, testTenant);
    assert.ok(detail.transcription.transcriptText.startsWith('large transcript payload'));
    assert.ok(detail.transcription.transcriptText.length > 40_000);
    assert.ok(detail.transcription.rawTranscriptText.startsWith('large transcript payload'));
    assert.ok(detail.transcription.rawTranscriptText.length > 40_000);
    assert.ok(detail.transcription.aiTranscriptText.startsWith('large transcript payload'));
    assert.ok(detail.transcription.aiTranscriptText.length > 40_000);
    assert.ok(detail.transcription.segments[0].text.startsWith('large transcript payload'));
    assert.ok(detail.transcription.segments[0].text.length > 40_000);
  } finally {
    for (const call of calls) await cleanupCall(call);
  }
});
