const assert = require('node:assert/strict');
const test = require('node:test');
const {
  requireTranscriptionWorkerToken,
} = require('../../src/middleware/transcription-worker');

function createResponse() {
  return {
    body: null,
    statusCode: null,
    json(payload) {
      this.body = payload;
      return this;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
  };
}

function withEnv(env, callback) {
  const original = {
    CRM_WORKER_TOKEN: process.env.CRM_WORKER_TOKEN,
    TELEPHONY_TRANSCRIPTION_WORKER_TOKEN:
      process.env.TELEPHONY_TRANSCRIPTION_WORKER_TOKEN,
    TRANSCRIPTION_WORKER_TOKEN: process.env.TRANSCRIPTION_WORKER_TOKEN,
    TENANT_CONTEXT_ENABLED: process.env.TENANT_CONTEXT_ENABLED,
    TENANT_CACHE_REALTIME_ENABLED: process.env.TENANT_CACHE_REALTIME_ENABLED,
    TENANT_FILES_WORKERS_ENABLED: process.env.TENANT_FILES_WORKERS_ENABLED,
  };

  delete process.env.CRM_WORKER_TOKEN;
  delete process.env.TELEPHONY_TRANSCRIPTION_WORKER_TOKEN;
  delete process.env.TRANSCRIPTION_WORKER_TOKEN;
  delete process.env.TENANT_CONTEXT_ENABLED;
  delete process.env.TENANT_CACHE_REALTIME_ENABLED;
  delete process.env.TENANT_FILES_WORKERS_ENABLED;
  Object.assign(process.env, env);

  try {
    callback();
  } finally {
    delete process.env.CRM_WORKER_TOKEN;
    delete process.env.TELEPHONY_TRANSCRIPTION_WORKER_TOKEN;
    delete process.env.TRANSCRIPTION_WORKER_TOKEN;
    delete process.env.TENANT_CONTEXT_ENABLED;
    delete process.env.TENANT_CACHE_REALTIME_ENABLED;
    delete process.env.TENANT_FILES_WORKERS_ENABLED;
    Object.entries(original).forEach(([key, value]) => {
      if (value !== undefined) process.env[key] = value;
    });
  }
}

test('accepts CRM_WORKER_TOKEN from bearer authorization', () => {
  withEnv({ CRM_WORKER_TOKEN: 'worker-secret' }, () => {
    const req = {
      headers: {
        authorization: 'Bearer worker-secret',
      },
    };
    const res = createResponse();
    let nextCalled = false;

    requireTranscriptionWorkerToken(req, res, () => {
      nextCalled = true;
    });

    assert.equal(nextCalled, true);
    assert.equal(req.transcriptionWorker.authenticated, true);
    assert.equal(req.transcriptionWorker.scope, 'platform');
    assert.equal(req.transcriptionWorker.protocolVersion, 1);
    assert.equal(res.statusCode, null);
  });
});

test('requires worker protocol v2 only after files/workers isolation is enabled', () => {
  withEnv({
    CRM_WORKER_TOKEN: 'worker-secret',
    TENANT_CONTEXT_ENABLED: 'true',
    TENANT_CACHE_REALTIME_ENABLED: 'true',
    TENANT_FILES_WORKERS_ENABLED: 'true',
  }, () => {
    const legacyReq = { headers: { authorization: 'Bearer worker-secret' } };
    const legacyRes = createResponse();
    requireTranscriptionWorkerToken(legacyReq, legacyRes, () => assert.fail('must reject v1'));
    assert.equal(legacyRes.statusCode, 426);
    assert.equal(legacyRes.body.code, 'WORKER_PROTOCOL_UPGRADE_REQUIRED');

    const req = {
      headers: {
        authorization: 'Bearer worker-secret',
        'x-worker-instance-id': 'worker-a',
        'x-worker-protocol-version': '2',
      },
    };
    const res = createResponse();
    let called = false;
    requireTranscriptionWorkerToken(req, res, () => { called = true; });
    assert.equal(called, true);
    assert.equal(req.transcriptionWorker.credentialId, 'platform-transcription-worker');
    assert.equal(req.transcriptionWorker.instanceId, 'worker-a');
    assert.equal(req.transcriptionWorker.protocolVersion, 2);
  });
});

test('keeps x-worker-token compatibility for existing deployments', () => {
  withEnv({ TELEPHONY_TRANSCRIPTION_WORKER_TOKEN: 'legacy-secret' }, () => {
    const req = {
      headers: {
        'x-worker-token': 'legacy-secret',
      },
    };
    const res = createResponse();
    let nextCalled = false;

    requireTranscriptionWorkerToken(req, res, () => {
      nextCalled = true;
    });

    assert.equal(nextCalled, true);
    assert.equal(res.statusCode, null);
  });
});

test('rejects invalid worker token', () => {
  withEnv({ CRM_WORKER_TOKEN: 'worker-secret' }, () => {
    const req = {
      headers: {
        authorization: 'Bearer wrong-secret',
      },
    };
    const res = createResponse();
    let nextCalled = false;

    requireTranscriptionWorkerToken(req, res, () => {
      nextCalled = true;
    });

    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 401);
    assert.equal(res.body.error, 'Unauthorized worker');
  });
});
