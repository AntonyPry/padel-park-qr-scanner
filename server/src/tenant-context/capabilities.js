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

function isTenantStaffAccessEnabled() {
  return readBooleanEnv(process.env.TENANT_STAFF_ACCESS_ENABLED, false);
}

function isTenantClientsReferencesEnabled() {
  return readBooleanEnv(
    process.env.TENANT_CLIENTS_REFERENCES_ENABLED,
    false,
  );
}

function isTenantVisitsScannerEnabled() {
  return readBooleanEnv(
    process.env.TENANT_VISITS_SCANNER_ENABLED,
    false,
  );
}

function isTenantClientBasesCallTasksEnabled() {
  return readBooleanEnv(
    process.env.TENANT_CLIENT_BASES_CALL_TASKS_ENABLED,
    false,
  );
}

function isTenantBookingsCourtsEnabled() {
  return readBooleanEnv(
    process.env.TENANT_BOOKINGS_COURTS_ENABLED,
    false,
  );
}

function isTenantMethodologySkillMapEnabled() {
  return readBooleanEnv(
    process.env.TENANT_METHODOLOGY_SKILL_MAP_ENABLED,
    false,
  );
}

function isTenantTrainingNotesPlansEnabled() {
  return readBooleanEnv(
    process.env.TENANT_TRAINING_NOTES_PLANS_ENABLED,
    false,
  );
}

function isTenantClientMoneyInstrumentsEnabled() {
  return readBooleanEnv(
    process.env.TENANT_CLIENT_MONEY_INSTRUMENTS_ENABLED,
    false,
  );
}

function isTenantShiftsReportsEnabled() {
  return readBooleanEnv(
    process.env.TENANT_SHIFTS_REPORTS_ENABLED,
    false,
  );
}

function isTenantAuditLogEnabled() {
  return readBooleanEnv(
    process.env.TENANT_AUDIT_LOG_ENABLED,
    false,
  );
}

function isTenantOnboardingEnabled() {
  return readBooleanEnv(
    process.env.TENANT_ONBOARDING_ENABLED,
    false,
  );
}

function isTenantEnforcementEnabled() {
  return readBooleanEnv(
    process.env.TENANT_ENFORCEMENT_ENABLED,
    false,
  );
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
  if (isTenantStaffAccessEnabled() && !isTenantContextEnabled()) {
    throw capabilityDependencyError('TENANT_STAFF_ACCESS_ENABLED');
  }
  if (isTenantStaffAccessEnabled() && !isTenantCacheRealtimeEnabled()) {
    throw capabilityDependencyError(
      'TENANT_STAFF_ACCESS_ENABLED',
      'TENANT_CACHE_REALTIME_ENABLED',
    );
  }
  if (isTenantStaffAccessEnabled() && !isTenantFilesWorkersEnabled()) {
    throw capabilityDependencyError(
      'TENANT_STAFF_ACCESS_ENABLED',
      'TENANT_FILES_WORKERS_ENABLED',
    );
  }
  if (isTenantStaffAccessEnabled() && !isTenantProviderIntegrationsEnabled()) {
    throw capabilityDependencyError(
      'TENANT_STAFF_ACCESS_ENABLED',
      'TENANT_PROVIDER_INTEGRATIONS_ENABLED',
    );
  }
  if (isTenantClientsReferencesEnabled() && !isTenantStaffAccessEnabled()) {
    throw capabilityDependencyError(
      'TENANT_CLIENTS_REFERENCES_ENABLED',
      'TENANT_STAFF_ACCESS_ENABLED',
    );
  }
  if (isTenantVisitsScannerEnabled() && !isTenantClientsReferencesEnabled()) {
    throw capabilityDependencyError(
      'TENANT_VISITS_SCANNER_ENABLED',
      'TENANT_CLIENTS_REFERENCES_ENABLED',
    );
  }
  if (isTenantClientBasesCallTasksEnabled() && !isTenantVisitsScannerEnabled()) {
    throw capabilityDependencyError(
      'TENANT_CLIENT_BASES_CALL_TASKS_ENABLED',
      'TENANT_VISITS_SCANNER_ENABLED',
    );
  }
  if (isTenantBookingsCourtsEnabled() && !isTenantClientBasesCallTasksEnabled()) {
    throw capabilityDependencyError(
      'TENANT_BOOKINGS_COURTS_ENABLED',
      'TENANT_CLIENT_BASES_CALL_TASKS_ENABLED',
    );
  }
  if (isTenantMethodologySkillMapEnabled() && !isTenantBookingsCourtsEnabled()) {
    throw capabilityDependencyError(
      'TENANT_METHODOLOGY_SKILL_MAP_ENABLED',
      'TENANT_BOOKINGS_COURTS_ENABLED',
    );
  }
  if (
    isTenantTrainingNotesPlansEnabled() &&
    !isTenantMethodologySkillMapEnabled()
  ) {
    throw capabilityDependencyError(
      'TENANT_TRAINING_NOTES_PLANS_ENABLED',
      'TENANT_METHODOLOGY_SKILL_MAP_ENABLED',
    );
  }
  if (
    isTenantClientMoneyInstrumentsEnabled() &&
    !isTenantTrainingNotesPlansEnabled()
  ) {
    throw capabilityDependencyError(
      'TENANT_CLIENT_MONEY_INSTRUMENTS_ENABLED',
      'TENANT_TRAINING_NOTES_PLANS_ENABLED',
    );
  }
  if (
    isTenantShiftsReportsEnabled() &&
    !isTenantClientMoneyInstrumentsEnabled()
  ) {
    throw capabilityDependencyError(
      'TENANT_SHIFTS_REPORTS_ENABLED',
      'TENANT_CLIENT_MONEY_INSTRUMENTS_ENABLED',
    );
  }
  if (isTenantAuditLogEnabled() && !isTenantShiftsReportsEnabled()) {
    throw capabilityDependencyError(
      'TENANT_AUDIT_LOG_ENABLED',
      'TENANT_SHIFTS_REPORTS_ENABLED',
    );
  }
  if (isTenantOnboardingEnabled() && !isTenantAuditLogEnabled()) {
    throw capabilityDependencyError(
      'TENANT_ONBOARDING_ENABLED',
      'TENANT_AUDIT_LOG_ENABLED',
    );
  }
  if (isTenantEnforcementEnabled() && !isTenantOnboardingEnabled()) {
    throw capabilityDependencyError(
      'TENANT_ENFORCEMENT_ENABLED',
      'TENANT_ONBOARDING_ENABLED',
    );
  }

  return Object.freeze({
    tenantCacheRealtime: isTenantCacheRealtimeEnabled(),
    tenantContext: isTenantContextEnabled(),
    tenantFilesWorkers: isTenantFilesWorkersEnabled(),
    tenantProviderIntegrations: isTenantProviderIntegrationsEnabled(),
    tenantStaffAccess: isTenantStaffAccessEnabled(),
    tenantClientsReferences: isTenantClientsReferencesEnabled(),
    tenantClientBasesCallTasks: isTenantClientBasesCallTasksEnabled(),
    tenantBookingsCourts: isTenantBookingsCourtsEnabled(),
    tenantMethodologySkillMap: isTenantMethodologySkillMapEnabled(),
    tenantTrainingNotesPlans: isTenantTrainingNotesPlansEnabled(),
    tenantClientMoneyInstruments: isTenantClientMoneyInstrumentsEnabled(),
    tenantShiftsReports: isTenantShiftsReportsEnabled(),
    tenantAuditLog: isTenantAuditLogEnabled(),
    tenantOnboarding: isTenantOnboardingEnabled(),
    tenantEnforcement: isTenantEnforcementEnabled(),
    tenantVisitsScanner: isTenantVisitsScannerEnabled(),
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
  isTenantBookingsCourtsEnabled,
  isTenantAuditLogEnabled,
  isTenantCacheRealtimeEnabled,
  isTenantClientBasesCallTasksEnabled,
  isTenantClientMoneyInstrumentsEnabled,
  isTenantClientsReferencesEnabled,
  isTenantContextEnabled,
  isTenantEnforcementEnabled,
  isTenantFilesWorkersEnabled,
  isTenantMethodologySkillMapEnabled,
  isTenantOnboardingEnabled,
  isTenantTrainingNotesPlansEnabled,
  isTenantProviderIntegrationsEnabled,
  isTenantShiftsReportsEnabled,
  isTenantStaffAccessEnabled,
  isTenantVisitsScannerEnabled,
  readBooleanEnv,
  tenantContextCapability,
};
