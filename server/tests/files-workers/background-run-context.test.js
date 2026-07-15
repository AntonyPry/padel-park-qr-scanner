'use strict';

const assert = require('node:assert/strict');
const { afterEach, test } = require('node:test');
const {
  BACKGROUND_COMPONENTS,
  assertBackgroundComponentCanRun,
  buildTenantJobRunContext,
} = require('../../src/files-workers/background-run-context');

const original = {
  TENANT_CONTEXT_ENABLED: process.env.TENANT_CONTEXT_ENABLED,
  TENANT_CACHE_REALTIME_ENABLED: process.env.TENANT_CACHE_REALTIME_ENABLED,
  TENANT_FILES_WORKERS_ENABLED: process.env.TENANT_FILES_WORKERS_ENABLED,
};

afterEach(() => {
  for (const [key, value] of Object.entries(original)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

test('isolation capability blocks unscoped global loops instead of simulating tenant safety', () => {
  process.env.TENANT_CONTEXT_ENABLED = 'true';
  process.env.TENANT_CACHE_REALTIME_ENABLED = 'true';
  process.env.TENANT_FILES_WORKERS_ENABLED = 'true';

  for (const component of [
    BACKGROUND_COMPONENTS.CALL_TASKS_RECURRING,
    BACKGROUND_COMPONENTS.TELEPHONY_SUBSCRIPTION,
    BACKGROUND_COMPONENTS.TELEGRAM_BOT,
    BACKGROUND_COMPONENTS.VK_BOT,
  ]) {
    assert.throws(
      () => assertBackgroundComponentCanRun(component),
      (error) => error.code === 'TENANT_BACKGROUND_COMPONENT_DEFERRED' && error.statusCode === 503,
    );
  }
});

test('transcription run context contains only opaque routing and job-attempt identity', () => {
  process.env.TENANT_CONTEXT_ENABLED = 'true';
  process.env.TENANT_CACHE_REALTIME_ENABLED = 'true';
  process.env.TENANT_FILES_WORKERS_ENABLED = 'true';
  const context = buildTenantJobRunContext({
    attempt: 3,
    component: BACKGROUND_COMPONENTS.TRANSCRIPTION_WORKER,
    jobId: 77,
    tenant: { organizationId: 4, clubId: 9 },
  });

  assert.equal(context.attempt, 3);
  assert.equal(context.jobId, '77');
  assert.match(context.organizationKey, /^org_/);
  assert.match(context.clubKey, /^club_/);
  assert.equal(JSON.stringify(context).includes('organizationId'), false);
});
