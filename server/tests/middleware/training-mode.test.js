const assert = require('node:assert/strict');
const test = require('node:test');
const { captureTrainingMode } = require('../../src/middleware/training-mode');

test('captures training mode request headers', () => {
  const req = {
    get(name) {
      return {
        'x-training-mode': 'true',
        'x-training-role': 'trainer',
      }[name.toLowerCase()];
    },
  };
  let nextCalled = false;

  captureTrainingMode()(req, {}, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
  assert.deepEqual(req.trainingMode, {
    requested: true,
    role: 'trainer',
  });
});

test('ignores unknown training role header values', () => {
  const req = {
    get(name) {
      return {
        'x-training-mode': 'true',
        'x-training-role': 'unknown',
      }[name.toLowerCase()];
    },
  };

  captureTrainingMode()(req, {}, () => {});

  assert.deepEqual(req.trainingMode, {
    requested: true,
    role: undefined,
  });
});
