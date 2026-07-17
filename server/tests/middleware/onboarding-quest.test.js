const assert = require('node:assert/strict');
const test = require('node:test');
const {
  captureOnboardingQuest,
  ONBOARDING_COMPLETED_TASKS_HEADER,
  ONBOARDING_PROGRESSED_TASKS_HEADER,
  setOnboardingEventResultHeaders,
} = require('../../src/middleware/onboarding-quest');

function requestWithHeaders(headers) {
  return {
    get(name) {
      return headers[name.toLowerCase()];
    },
  };
}

test('captures validated onboarding quest request context', () => {
  const req = requestWithHeaders({
    'x-onboarding-quest-role': 'admin',
    'x-onboarding-quest-task-key': 'admin.client.create',
  });
  let nextCalled = false;

  captureOnboardingQuest()(req, {}, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
  assert.deepEqual(req.onboardingQuest, {
    role: 'admin',
    taskKey: 'admin.client.create',
  });
});

test('drops invalid quest task keys and roles', () => {
  const req = requestWithHeaders({
    'x-onboarding-quest-role': 'unknown',
    'x-onboarding-quest-task-key': 'admin client create',
  });

  captureOnboardingQuest()(req, {}, () => {});

  assert.equal(req.onboardingQuest, undefined);
});

test('writes only confirmed onboarding progress response headers', () => {
  const headers = new Map();
  const res = {
    set(name, value) {
      headers.set(name, value);
    },
  };

  setOnboardingEventResultHeaders(res, {
    completedTaskKeys: ['admin.client.create'],
    progressedTaskKeys: ['admin.client.create'],
  });

  assert.equal(
    headers.get(ONBOARDING_PROGRESSED_TASKS_HEADER),
    'admin.client.create',
  );
  assert.equal(
    headers.get(ONBOARDING_COMPLETED_TASKS_HEADER),
    'admin.client.create',
  );
});
