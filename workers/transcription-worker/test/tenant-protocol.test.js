'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { afterEach, test } = require('node:test');
const { attachClaimContext, CrmClient } = require('../src/crm-client');
const { createTempDir } = require('../src/index');
const { redactDetails } = require('../src/logger');

const roots = [];
const originalFetch = global.fetch;

afterEach(async () => {
  global.fetch = originalFetch;
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { force: true, recursive: true })));
});

test('Node worker sends protocol v2 and the immutable lease on every job mutation', async () => {
  const requests = [];
  global.fetch = async (url, options) => {
    requests.push({
      body: options.body ? JSON.parse(options.body) : null,
      headers: options.headers,
      method: options.method,
      url,
    });
    return new Response(JSON.stringify({ ok: true }), {
      headers: { 'content-type': 'application/json' },
      status: 200,
    });
  };
  const client = new CrmClient({
    crmApiUrl: 'http://crm.invalid/api',
    crmWorkerToken: 'worker-secret',
    workerId: 'worker-node-a',
  });
  const job = attachClaimContext({ id: 77 }, {
    lease: { claimId: '160dca15-56e8-41df-885f-b91793733f5c', claimToken: 'lease-token' },
    protocolVersion: 2,
    tenant: { organizationKey: 'org_12345678', clubKey: 'club_12345678' },
  });

  await client.getAudioReference(job);
  await client.updateProgress(job, 'ffmpeg_preprocess', 25, 'Preparing');
  await client.completeJob(job, { claimId: 'forged', transcriptText: 'done' });
  await client.failJob(job, 'failed');

  assert.equal(requests.length, 4);
  for (const request of requests) {
    assert.equal(request.headers['X-Worker-Protocol-Version'], '2');
    assert.equal(request.headers['X-Worker-Instance-Id'], 'worker-node-a');
    assert.equal(request.body.claimId, '160dca15-56e8-41df-885f-b91793733f5c');
    assert.equal(request.body.claimToken, 'lease-token');
  }
});

test('Node temp namespace uses opaque tenant/claim identity and cleanup cannot target siblings', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'setly-node-worker-'));
  roots.push(root);
  const job = attachClaimContext({ id: 77, telephonyCallId: 998877 }, {
    lease: { claimId: '160dca15-56e8-41df-885f-b91793733f5c', claimToken: 'lease-token' },
    protocolVersion: 2,
    tenant: { organizationKey: 'org_12345678', clubKey: 'club_12345678' },
  });
  const attemptDir = await createTempDir({ tempRoot: root }, job);
  const sibling = path.join(path.dirname(attemptDir), 'other-attempt');
  await fs.mkdir(sibling);
  await fs.rm(attemptDir, { recursive: true });

  assert.equal(attemptDir.includes('998877'), false);
  assert.equal(attemptDir.includes('org_12345678'), true);
  assert.equal(attemptDir.includes('club_12345678'), true);
  assert.equal(attemptDir.includes('160dca15-56e8-41df-885f-b91793733f5c'), true);
  assert.equal((await fs.stat(sibling)).isDirectory(), true);
});

test('Node log redaction removes tokens, URLs, phone numbers, paths and transcript bodies', () => {
  const redacted = redactDetails({
    authorization: 'Bearer secret-token',
    downloadUrl: 'https://recordings.invalid/audio?token=abc',
    error: 'Call +7 (999) 123-45-67 failed at https://recordings.invalid/a',
    ffmpegError: 'failed to open /tmp/private-audio/input.wav',
    rawTranscriptText: 'private transcript',
    tempPath: '/tmp/private-audio',
  });
  const serialized = JSON.stringify(redacted);
  for (const secret of ['secret-token', 'recordings.invalid', '999', 'private transcript', '/tmp']) {
    assert.equal(serialized.includes(secret), false);
  }
});
