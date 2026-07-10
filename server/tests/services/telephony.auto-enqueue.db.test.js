const assert = require('node:assert/strict');
const { test } = require('node:test');
const db = require('../../models');
const {
  autoEnqueueTranscriptionJob,
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
