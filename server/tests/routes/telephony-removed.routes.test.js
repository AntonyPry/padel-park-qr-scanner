'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const { test } = require('node:test');
const express = require('express');

async function listen(app) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => resolve(server));
    server.once('error', reject);
  });
}

async function close(server) {
  if (!server?.listening) return;
  await new Promise((resolve, reject) =>
    server.close((error) => (
      error && error.code !== 'ERR_SERVER_NOT_RUNNING' ? reject(error) : resolve()
    )));
}

test('removed user telephony routes fail closed without intercepting worker routes', async () => {
  const previousWorkerToken = process.env.CRM_WORKER_TOKEN;
  const previousFilesWorkers = process.env.TENANT_FILES_WORKERS_ENABLED;
  process.env.CRM_WORKER_TOKEN = 'removed-route-worker-token';
  process.env.TENANT_FILES_WORKERS_ENABLED = 'true';
  const authService = require('../../src/services/auth.service');
  const originalVerifyToken = authService.verifyToken;
  const originalGetAccountById = authService.getAccountById;
  authService.verifyToken = (token) => (
    token === 'removed-route-test-token' ? { accountId: 901 } : null
  );
  authService.getAccountById = async (accountId) => ({
    id: accountId,
    role: 'admin',
    status: 'active',
  });

  let server;
  try {
    const workerRoutes = require('../../src/routes/telephony-transcription-worker');
    const removedRoutes = require('../../src/routes/telephony-removed');
    const app = express();
    app.use(express.json());
    app.use('/api', workerRoutes);
    app.use('/api', removedRoutes);
    server = await listen(app);
    const api = (path, options = {}) => fetch(
      `http://127.0.0.1:${server.address().port}/api${path}`,
      options,
    );

    const unauthenticated = await api('/telephony/calls');
    assert.equal(unauthenticated.status, 401);
    assert.equal((await unauthenticated.json()).error, 'Unauthorized');

    const authenticated = await api('/telephony/calls', {
      headers: { Authorization: 'Bearer removed-route-test-token' },
    });
    assert.equal(authenticated.status, 410);
    assert.deepEqual(await authenticated.json(), {
      code: 'TELEPHONY_REMOVED',
      error: 'Раздел телефонии удалён',
      status: 410,
    });

    const worker = await api('/telephony/transcription-jobs/worker-queue');
    assert.equal(worker.status, 401);
    assert.equal((await worker.json()).error, 'Unauthorized worker');

    const workerProtocol = await api('/telephony/transcription-jobs/worker-queue', {
      headers: {
        'X-Worker-Protocol-Version': '1',
        'X-Worker-Token': 'removed-route-worker-token',
      },
    });
    assert.equal(workerProtocol.status, 426);
    assert.equal(
      (await workerProtocol.json()).code,
      'WORKER_PROTOCOL_UPGRADE_REQUIRED',
    );
  } finally {
    await close(server);
    authService.verifyToken = originalVerifyToken;
    authService.getAccountById = originalGetAccountById;
    if (previousWorkerToken === undefined) delete process.env.CRM_WORKER_TOKEN;
    else process.env.CRM_WORKER_TOKEN = previousWorkerToken;
    if (previousFilesWorkers === undefined) delete process.env.TENANT_FILES_WORKERS_ENABLED;
    else process.env.TENANT_FILES_WORKERS_ENABLED = previousFilesWorkers;
  }
});
