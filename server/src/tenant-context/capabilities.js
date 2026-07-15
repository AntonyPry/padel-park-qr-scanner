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

function isTenantFilesWorkersEnabled() {
  return readBooleanEnv(process.env.TENANT_FILES_WORKERS_ENABLED, false);
}

function isTenantProviderIntegrationsEnabled() {
  return readBooleanEnv(process.env.TENANT_PROVIDER_INTEGRATIONS_ENABLED, false);
}

function capabilityDependencyError(
  capability = 'TENANT_CACHE_REALTIME_ENABLED',
  dependency = 'TENANT_CONTEXT_ENABLED',
) {
  const error = new Error(
    `${capability} requires ${dependency}`,
  );
  error.code = 'TENANT_CAPABILITY_DEPENDENCY_INVALID';
  error.statusCode = 503;
  return error;
}

function assertTenantCapabilityDependencies() {
  if (isTenantCacheRealtimeEnabled() && !isTenantContextEnabled()) {
    throw capabilityDependencyError('TENANT_CACHE_REALTIME_ENABLED');
  }
  if (isTenantFilesWorkersEnabled() && !isTenantContextEnabled()) {
    throw capabilityDependencyError('TENANT_FILES_WORKERS_ENABLED');
  }
  if (isTenantFilesWorkersEnabled() && !isTenantCacheRealtimeEnabled()) {
    throw capabilityDependencyError(
      'TENANT_FILES_WORKERS_ENABLED',
      'TENANT_CACHE_REALTIME_ENABLED',
    );
  }
  if (isTenantProviderIntegrationsEnabled() && !isTenantContextEnabled()) {
    throw capabilityDependencyError('TENANT_PROVIDER_INTEGRATIONS_ENABLED');
  }
  if (isTenantProviderIntegrationsEnabled() && !isTenantCacheRealtimeEnabled()) {
    throw capabilityDependencyError(
      'TENANT_PROVIDER_INTEGRATIONS_ENABLED',
      'TENANT_CACHE_REALTIME_ENABLED',
    );
  }
  if (isTenantProviderIntegrationsEnabled() && !isTenantFilesWorkersEnabled()) {
    throw capabilityDependencyError(
      'TENANT_PROVIDER_INTEGRATIONS_ENABLED',
      'TENANT_FILES_WORKERS_ENABLED',
    );
  }

  return Object.freeze({
    tenantCacheRealtime: isTenantCacheRealtimeEnabled(),
    tenantContext: isTenantContextEnabled(),
    tenantFilesWorkers: isTenantFilesWorkersEnabled(),
    tenantProviderIntegrations: isTenantProviderIntegrationsEnabled(),
  });
}

function tenantContextCapability() {
  const capabilities = assertTenantCapabilityDependencies();
  return {
    tenantCacheRealtime: capabilities.tenantCacheRealtime,
    tenantContext: capabilities.tenantContext,
  };
}

module.exports = {
  assertTenantCapabilityDependencies,
  capabilityDependencyError,
  isTenantCacheRealtimeEnabled,
  isTenantContextEnabled,
  isTenantFilesWorkersEnabled,
  isTenantProviderIntegrationsEnabled,
  readBooleanEnv,
  tenantContextCapability,
};
