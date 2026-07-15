'use strict';

function readBooleanEnv(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function isTenantContextEnabled() {
  return readBooleanEnv(process.env.TENANT_CONTEXT_ENABLED, false);
}

function isTenantCacheRealtimeEnabled() {
  return readBooleanEnv(process.env.TENANT_CACHE_REALTIME_ENABLED, false);
}

function capabilityDependencyError() {
  const error = new Error(
    'TENANT_CACHE_REALTIME_ENABLED requires TENANT_CONTEXT_ENABLED',
  );
  error.code = 'TENANT_CAPABILITY_DEPENDENCY_INVALID';
  error.statusCode = 503;
  return error;
}

function assertTenantCapabilityDependencies() {
  if (isTenantCacheRealtimeEnabled() && !isTenantContextEnabled()) {
    throw capabilityDependencyError();
  }

  return Object.freeze({
    tenantCacheRealtime: isTenantCacheRealtimeEnabled(),
    tenantContext: isTenantContextEnabled(),
  });
}

function tenantContextCapability() {
  return { ...assertTenantCapabilityDependencies() };
}

module.exports = {
  assertTenantCapabilityDependencies,
  capabilityDependencyError,
  isTenantCacheRealtimeEnabled,
  isTenantContextEnabled,
  readBooleanEnv,
  tenantContextCapability,
};
