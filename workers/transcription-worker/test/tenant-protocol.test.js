'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { afterEach, test } = require('node:test');
const {
  attachClaimContext,
  CrmApiError,
  CrmClient,
  parseRetryAfterSeconds,
} = require('../src/crm-client');
const {
  claimAndProcessOne,
  createTempDir,
  pollingDelayMs,
} = require('../src/index');
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

test('Node worker strictly parses and caps Retry-After for bounded polling backoff', async () => {
  assert.equal(parseRetryAfterSeconds('1'), 1);
  assert.equal(parseRetryAfterSeconds('299'), 299);
  assert.equal(parseRetryAfterSeconds('999'), 300);
  for (const invalid of [null, '', '0', '01', '-1', '1.5', ' 10 ', 'Wed, 21 Oct 2015 07:28:00 GMT']) {
    assert.equal(parseRetryAfterSeconds(invalid), null, String(invalid));
  }

  global.fetch = async () => new Response(JSON.stringify({
    code: 'WORKER_RATE_LIMITED',
    error: 'worker-secret Authorization body must not be logged',
    status: 429,
  }), {
    headers: {
      'content-type': 'application/json',
      'retry-after': '999',
    },
    status: 429,
  });
  const client = new CrmClient({
    crmApiUrl: 'http://crm.invalid/api',
    crmWorkerToken: 'worker-secret',
    workerId: 'worker-node-a',
  });
  await assert.rejects(
    client.claimJob('worker-node-a'),
    (error) => {
      assert.equal(error instanceof CrmApiError, true);
      assert.equal(error.status, 429);
      assert.equal(error.retryAfterSeconds, 300);
      assert.equal(error.message.includes('worker-secret'), false);
      return true;
    },
  );
  assert.equal(
    pollingDelayMs(new CrmApiError('limited', { status: 429, retryAfterSeconds: 30 }), 10_000),
    30_000,
  );
  assert.equal(
    pollingDelayMs(new CrmApiError('limited', { status: 429 }), 10_000),
    10_000,
  );
  assert.equal(pollingDelayMs(new Error('network'), 10_000), 10_000);
});

test('Node worker never turns a rate-limited claimed operation into an automatic fail write', async () => {
  let failCalls = 0;
  const crmClient = {
    async claimJob() {
      return {
        job: { id: 77 },
        lease: { claimId: 'claim-id', claimToken: 'claim-token' },
        protocolVersion: 2,
        tenant: { clubKey: 'club_12345678', organizationKey: 'org_12345678' },
      };
    },
    async failJob() {
      failCalls += 1;
    },
  };
  const entries = [];
  const logger = {
    error: (message, details) => entries.push({ details, message }),
    info: () => {},
    warn: (message, details) => entries.push({ details, message }),
  };
  const limited = new CrmApiError('Worker request rate limited', {
    retryAfterSeconds: 17,
    status: 429,
  });

  await assert.rejects(
    claimAndProcessOne(
      crmClient,
      { workerId: 'worker-node-a' },
      logger,
      { processJob: async () => { throw limited; } },
    ),
    limited,
  );
  assert.equal(failCalls, 0);
  assert.equal(entries.some((entry) => entry.details?.retryAfterSeconds === 17), true);
  assert.equal(JSON.stringify(entries).includes('claim-token'), false);
  assert.equal(JSON.stringify(entries).includes('77'), false);
});
