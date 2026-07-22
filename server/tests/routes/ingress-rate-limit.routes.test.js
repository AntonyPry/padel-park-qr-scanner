'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const express = require('express');

const {
  limitProviderIngress,
  limitWorkerIngress,
} = require('../../src/middleware/auth-rate-limit');
const {
  SURFACES,
  createAuthRateLimiter,
} = require('../../src/services/auth-rate-limit.service');

async function listen(app) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1');
    server.once('listening', () => resolve(server));
    server.once('error', reject);
  });
}

async function close(server) {
  if (!server?.listening) return;
  await new Promise((resolve, reject) => server.close((error) => (
    error ? reject(error) : resolve()
  )));
}

test('provider denial is pre-parser while worker denial is post-global-parser and pre-controller', async () => {
  const observed = [];
  const downstream = { providerAuth: 0, providerController: 0, workerAuth: 0, workerController: 0 };
  const limiter = {
    async consumeRequest(surface, req) {
      observed.push({ body: req.body, surface });
      return { blocked: true, retryAfterSeconds: 11 };
    },
  };
  const app = express();
  app.set('authRateLimiter', limiter);
  app.post(
    '/provider',
    limitProviderIngress(SURFACES.PROVIDER_BEELINE_CAPABILITY),
    (_req, _res, next) => {
      downstream.providerAuth += 1;
      next();
    },
    express.text({ limit: '1kb', type: '*/*' }),
    (_req, res) => {
      downstream.providerController += 1;
      res.sendStatus(204);
    },
  );
  app.use(express.json({ limit: '1kb' }));
  app.post(
    '/worker',
    limitWorkerIngress(SURFACES.WORKER_CLAIM),
    (_req, _res, next) => {
      downstream.workerAuth += 1;
      next();
    },
    (_req, res) => {
      downstream.workerController += 1;
      res.sendStatus(204);
    },
  );
  app.use((error, _req, res, _next) => res.status(error.status || 500).end());
  const server = await listen(app);
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    const provider = await fetch(`${base}/provider`, {
      body: 'x'.repeat(2_000),
      headers: { 'Content-Type': 'text/plain' },
      method: 'POST',
    });
    assert.equal(provider.status, 429);
    assert.equal(provider.headers.get('retry-after'), '11');
    assert.match(provider.headers.get('content-type'), /^text\/plain/u);
    assert.equal(await provider.text(), 'Too Many Requests');
    assert.equal(observed[0].body, undefined);

    const worker = await fetch(`${base}/worker`, {
      body: JSON.stringify({ workerId: 'worker-a' }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });
    assert.equal(worker.status, 429);
    assert.equal(worker.headers.get('retry-after'), '11');
    assert.deepEqual(await worker.json(), {
      code: 'WORKER_RATE_LIMITED',
      error: 'Worker request rate limited',
      status: 429,
    });
    assert.deepEqual(observed[1].body, { workerId: 'worker-a' });
    assert.deepEqual(downstream, {
      providerAuth: 0,
      providerController: 0,
      workerAuth: 0,
      workerController: 0,
    });

    const workerPreParserBoundary = await fetch(`${base}/worker`, {
      body: JSON.stringify({ payload: 'x'.repeat(2_000) }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });
    assert.equal(workerPreParserBoundary.status, 413);
    assert.equal(observed.length, 2);
  } finally {
    await close(server);
  }
});

test('off mode preserves all twelve ingress middleware paths without counter or response work', async () => {
  const limiter = createAuthRateLimiter({ env: {}, logger: () => assert.fail('off emitted') });
  const providerSurfaces = [
    SURFACES.PROVIDER_BEELINE_CAPABILITY,
    SURFACES.PROVIDER_BEELINE_CONNECTION,
    SURFACES.PROVIDER_BEELINE_LEGACY,
    SURFACES.PROVIDER_EVOTOR_CONNECTION,
    SURFACES.PROVIDER_EVOTOR_LEGACY,
  ];
  const workerSurfaces = [
    SURFACES.WORKER_AUDIO_REFERENCE,
    SURFACES.WORKER_CLAIM,
    SURFACES.WORKER_FAIL,
    SURFACES.WORKER_PROGRESS,
    SURFACES.WORKER_QUEUE,
    SURFACES.WORKER_RESULT,
    SURFACES.WORKER_RETRY,
  ];
  let nextCalls = 0;
  const req = { app: { get: () => limiter }, headers: {}, socket: {} };
  const res = {};
  for (const surface of providerSurfaces) {
    await limitProviderIngress(surface)(req, res, () => { nextCalls += 1; });
  }
  for (const surface of workerSurfaces) {
    await limitWorkerIngress(surface)(req, res, () => { nextCalls += 1; });
  }
  assert.equal(nextCalls, 12);
  assert.deepEqual(limiter.getStats(), { mode: 'off' });
});

test('the exact five provider and seven worker routes keep limiter ordering and socket-only peer input', () => {
  const appSource = fs.readFileSync(path.resolve(__dirname, '../../src/app.js'), 'utf8');
  const workerSource = fs.readFileSync(
    path.resolve(__dirname, '../../src/routes/telephony-transcription-worker.js'),
    'utf8',
  );
  const serviceSource = fs.readFileSync(
    path.resolve(__dirname, '../../src/services/auth-rate-limit.service.js'),
    'utf8',
  );
  const providerOrder = [
    ['PROVIDER_BEELINE_CAPABILITY', 'beelineCapabilityIngress'],
    ['PROVIDER_BEELINE_LEGACY', 'rejectLegacyBeelineIngress'],
    ['PROVIDER_EVOTOR_CONNECTION', 'evotorConnectionFirstIngress'],
    ['PROVIDER_EVOTOR_LEGACY', 'evotorConnectionFirstIngress'],
    ['PROVIDER_BEELINE_CONNECTION', 'beelineConnectionFirstIngress'],
  ];
  let cursor = 0;
  for (const [surface, nextMiddleware] of providerOrder) {
    const limiterIndex = appSource.indexOf(`limitProviderIngress(SURFACES.${surface})`, cursor);
    assert.notEqual(limiterIndex, -1, surface);
    assert.equal(
      appSource.includes(`...providerIngress,\n    limitProviderIngress(SURFACES.${surface})`),
      true,
      `${surface} classification ordering`,
    );
    const authIndex = appSource.indexOf(nextMiddleware, limiterIndex);
    assert.equal(authIndex > limiterIndex, true, surface);
    cursor = limiterIndex + 1;
  }
  const workerOrder = [
    ['WORKER_QUEUE', 'getWorkerTranscriptionQueue'],
    ['WORKER_CLAIM', 'claimTranscriptionJob'],
    ['WORKER_AUDIO_REFERENCE', 'getTranscriptionJobAudioReference'],
    ['WORKER_PROGRESS', 'updateTranscriptionJobProgress'],
    ['WORKER_RESULT', 'completeTranscriptionJob'],
    ['WORKER_FAIL', 'failTranscriptionJob'],
    ['WORKER_RETRY', 'retryTranscriptionJobForWorker'],
  ];
  cursor = 0;
  for (const [surface, controller] of workerOrder) {
    const limiterIndex = workerSource.indexOf(`limitWorkerIngress(SURFACES.${surface})`, cursor);
    assert.notEqual(limiterIndex, -1, surface);
    assert.equal(
      workerSource.includes(`workerEndpoint,\n  limitWorkerIngress(SURFACES.${surface})`),
      true,
      `${surface} classification ordering`,
    );
    const authIndex = workerSource.indexOf('requireTranscriptionWorkerToken', limiterIndex);
    const controllerIndex = workerSource.indexOf(`telephonyController.${controller}`, limiterIndex);
    assert.equal(authIndex > limiterIndex, true, `${surface} auth ordering`);
    assert.equal(controllerIndex > authIndex, true, `${surface} controller ordering`);
    cursor = limiterIndex + 1;
  }
  assert.equal(appSource.indexOf('app.use(express.json') < appSource.indexOf("app.use('/api', apiRoutes)"), true);
  assert.match(serviceSource, /request\?\.socket\?\.remoteAddress/u);
  assert.doesNotMatch(serviceSource, /x-forwarded-for|x-real-ip|trust proxy/iu);
  assert.doesNotMatch(appSource, /trust proxy/iu);
});
