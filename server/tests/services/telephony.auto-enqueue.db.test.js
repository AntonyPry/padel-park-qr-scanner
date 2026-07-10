const assert = require('node:assert/strict');
const { test } = require('node:test');
const db = require('../../models');
const {
  autoEnqueueTranscriptionJob,
  listCallTranscriptionJobs,
  queueMissingTranscriptionJobs,
} = require('../../src/services/telephony.service');

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

test('DB-backed auto-enqueue stays idempotent across concurrency, statuses and queue-missing', async () => {
  await db.sequelize.authenticate();
  let call;
  let missingCall;
  try {
    call = await createRecordedCall('concurrent');
    await Promise.all([
      autoEnqueueTranscriptionJob(call.id),
      autoEnqueueTranscriptionJob(call.id),
    ]);
    assert.equal(await db.TelephonyTranscriptionJob.count({ where: { telephonyCallId: call.id } }), 1);

    await autoEnqueueTranscriptionJob(call.id);
    await autoEnqueueTranscriptionJob(call.id);
    assert.equal(await db.TelephonyTranscriptionJob.count({ where: { telephonyCallId: call.id } }), 1);

    const job = await db.TelephonyTranscriptionJob.findOne({
      attributes: ['id', 'status'],
      where: { telephonyCallId: call.id },
    });
    for (const status of ['queued', 'processing', 'completed', 'failed']) {
      await job.update({ status });
      await autoEnqueueTranscriptionJob(call.id);
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
      queueMissingTranscriptionJobs({ id: null, role: 'owner' }, { limit: 1 }),
      queueMissingTranscriptionJobs({ id: null, role: 'owner' }, { limit: 1 }),
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
    const largeText = 'large transcript payload '.repeat(1_800);
    await db.TelephonyTranscriptionJob.create({
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
