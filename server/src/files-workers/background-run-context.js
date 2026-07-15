'use strict';

const {
  isTenantFilesWorkersEnabled,
  isTenantProviderIntegrationsEnabled,
} = require('../tenant-context/capabilities');
const { tenantRoutingMetadata } = require('./tenant-context');

const BACKGROUND_COMPONENTS = Object.freeze({
  CALL_TASKS_RECURRING: 'call-tasks-recurring',
  TELEPHONY_SUBSCRIPTION: 'beeline-subscription',
  TELEGRAM_BOT: 'telegram-bot',
  VK_BOT: 'vk-bot',
  TRANSCRIPTION_WORKER: 'transcription-worker',
});

const BACKGROUND_COMPONENT_POLICIES = Object.freeze({
  [BACKGROUND_COMPONENTS.CALL_TASKS_RECURRING]: Object.freeze({
    classification: 'deferred',
    deferredTo: 'Feature 5',
    reason: 'ClientBase and CallTask are not tenant-scoped yet',
  }),
  [BACKGROUND_COMPONENTS.TELEPHONY_SUBSCRIPTION]: Object.freeze({
    classification: 'provider-routed',
    reason: 'Feature 4.3 resolves each connection before tenant-scoped subscription work',
  }),
  [BACKGROUND_COMPONENTS.TELEGRAM_BOT]: Object.freeze({
    classification: 'provider-routed',
    reason: 'Feature 4.3 binds bot bootstrap to one immutable provider connection',
  }),
  [BACKGROUND_COMPONENTS.VK_BOT]: Object.freeze({
    classification: 'provider-routed',
    reason: 'Feature 4.3 binds bot bootstrap to one immutable provider connection',
  }),
  [BACKGROUND_COMPONENTS.TRANSCRIPTION_WORKER]: Object.freeze({
    classification: 'tenant-routed',
    credentialScope: 'platform',
    reason: 'The server selects an attributed job and binds all mutations to its lease',
  }),
});

function backgroundIsolationError(component) {
  const policy = BACKGROUND_COMPONENT_POLICIES[component];
  const error = new Error(
    `${component} is disabled while tenant files/workers isolation is enabled; deferred to ${policy?.deferredTo || 'a tenant domain wave'}`,
  );
  error.code = 'TENANT_BACKGROUND_COMPONENT_DEFERRED';
  error.statusCode = 503;
  return error;
}

function assertBackgroundComponentCanRun(component) {
  const policy = BACKGROUND_COMPONENT_POLICIES[component];
  if (!policy) throw new Error(`Unknown background component: ${component}`);
  if (
    isTenantFilesWorkersEnabled() &&
    policy.classification === 'deferred'
  ) {
    throw backgroundIsolationError(component);
  }
  if (
    isTenantFilesWorkersEnabled() &&
    policy.classification === 'provider-routed' &&
    !isTenantProviderIntegrationsEnabled()
  ) {
    throw backgroundIsolationError(component);
  }
  return policy;
}

function buildTenantJobRunContext({ component, jobId, attempt, tenant }) {
  const policy = assertBackgroundComponentCanRun(component);
  if (policy.classification !== 'tenant-routed') {
    throw backgroundIsolationError(component);
  }
  const routing = tenantRoutingMetadata(tenant);
  return Object.freeze({
    attempt: Number(attempt),
    clubKey: routing.clubKey,
    component,
    jobId: String(jobId),
    organizationKey: routing.organizationKey,
  });
}

module.exports = {
  BACKGROUND_COMPONENTS,
  BACKGROUND_COMPONENT_POLICIES,
  assertBackgroundComponentCanRun,
  backgroundIsolationError,
  buildTenantJobRunContext,
};
