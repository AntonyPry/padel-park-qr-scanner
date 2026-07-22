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

test('user telephony routes allow owner and manager but reject admin and viewer', async () => {
  const previousTenantContext = process.env.TENANT_CONTEXT_ENABLED;
  const previousWorkerToken = process.env.CRM_WORKER_TOKEN;
  const previousFilesWorkers = process.env.TENANT_FILES_WORKERS_ENABLED;
  process.env.TENANT_CONTEXT_ENABLED = 'false';
  process.env.CRM_WORKER_TOKEN = 'telephony-role-test-worker-token';
  process.env.TENANT_FILES_WORKERS_ENABLED = 'true';
  const telephonyController = require('../../src/controllers/telephony.controller');
  const originalGetCalls = telephonyController.getCalls;
  telephonyController.getCalls = (req, res) => res.json({ role: req.account.role });
  delete require.cache[require.resolve('../../src/routes/telephony')];

  let server;
  try {
    const telephonyRoutes = require('../../src/routes/telephony');
    const workerRoutes = require('../../src/routes/telephony-transcription-worker');
    const app = express();
    app.use(express.json());
    app.use('/api', workerRoutes);
    app.use('/api', (req, _res, next) => {
      req.account = { id: 901, role: req.headers['x-test-role'] };
      next();
    });
    app.use('/api', telephonyRoutes);
    server = await listen(app);

    const api = (path, role) => fetch(
      `http://127.0.0.1:${server.address().port}/api${path}`,
      { headers: role ? { 'X-Test-Role': role } : {} },
    );

    for (const role of ['owner', 'manager']) {
      const response = await api('/telephony/calls', role);
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { role });
    }

    for (const role of ['admin', 'viewer']) {
      const response = await api('/telephony/calls', role);
      assert.equal(response.status, 403);
      assert.equal((await response.json()).error, 'Forbidden');
    }

    const worker = await api('/telephony/transcription-jobs/worker-queue');
    assert.equal(worker.status, 401);
    assert.equal((await worker.json()).error, 'Unauthorized worker');
  } finally {
    await close(server);
    telephonyController.getCalls = originalGetCalls;
    delete require.cache[require.resolve('../../src/routes/telephony')];
    if (previousTenantContext === undefined) delete process.env.TENANT_CONTEXT_ENABLED;
    else process.env.TENANT_CONTEXT_ENABLED = previousTenantContext;
    if (previousWorkerToken === undefined) delete process.env.CRM_WORKER_TOKEN;
    else process.env.CRM_WORKER_TOKEN = previousWorkerToken;
    if (previousFilesWorkers === undefined) delete process.env.TENANT_FILES_WORKERS_ENABLED;
    else process.env.TENANT_FILES_WORKERS_ENABLED = previousFilesWorkers;
  }
});
