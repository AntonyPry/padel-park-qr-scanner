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
  };

  delete process.env.CRM_WORKER_TOKEN;
  delete process.env.TELEPHONY_TRANSCRIPTION_WORKER_TOKEN;
  delete process.env.TRANSCRIPTION_WORKER_TOKEN;
  Object.assign(process.env, env);

  try {
    callback();
  } finally {
    delete process.env.CRM_WORKER_TOKEN;
    delete process.env.TELEPHONY_TRANSCRIPTION_WORKER_TOKEN;
    delete process.env.TRANSCRIPTION_WORKER_TOKEN;
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
    assert.deepEqual(req.transcriptionWorker, { authenticated: true });
    assert.equal(res.statusCode, null);
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
