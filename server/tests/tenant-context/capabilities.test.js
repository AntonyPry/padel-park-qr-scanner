'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  assertTenantCapabilityDependencies,
  tenantContextCapability,
} = require('../../src/tenant-context/capabilities');

function restore(name, value) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

test('cache/realtime capability is server-owned and depends on tenant context', () => {
  const previousContext = process.env.TENANT_CONTEXT_ENABLED;
  const previousIsolation = process.env.TENANT_CACHE_REALTIME_ENABLED;
  try {
    process.env.TENANT_CONTEXT_ENABLED = 'true';
    process.env.TENANT_CACHE_REALTIME_ENABLED = 'false';
    assert.deepEqual(tenantContextCapability(), {
      tenantCacheRealtime: false,
      tenantContext: true,
    });

    process.env.TENANT_CACHE_REALTIME_ENABLED = 'true';
    assert.deepEqual(tenantContextCapability(), {
      tenantCacheRealtime: true,
      tenantContext: true,
    });

    process.env.TENANT_CONTEXT_ENABLED = 'false';
    assert.throws(
      () => assertTenantCapabilityDependencies(),
      (error) => error.code === 'TENANT_CAPABILITY_DEPENDENCY_INVALID',
    );
  } finally {
    restore('TENANT_CONTEXT_ENABLED', previousContext);
    restore('TENANT_CACHE_REALTIME_ENABLED', previousIsolation);
  }
});

test('files/workers capability depends on tenant context and Feature 4.1 isolation', () => {
  const previousContext = process.env.TENANT_CONTEXT_ENABLED;
  const previousCache = process.env.TENANT_CACHE_REALTIME_ENABLED;
  const previousFiles = process.env.TENANT_FILES_WORKERS_ENABLED;
  try {
    process.env.TENANT_CONTEXT_ENABLED = 'true';
    process.env.TENANT_CACHE_REALTIME_ENABLED = 'false';
    process.env.TENANT_FILES_WORKERS_ENABLED = 'true';
    assert.throws(
      () => assertTenantCapabilityDependencies(),
      (error) => error.code === 'TENANT_CAPABILITY_DEPENDENCY_INVALID'
        && error.message.includes('TENANT_CACHE_REALTIME_ENABLED'),
    );

    process.env.TENANT_CACHE_REALTIME_ENABLED = 'true';
    assert.equal(assertTenantCapabilityDependencies().tenantFilesWorkers, true);
  } finally {
    restore('TENANT_CONTEXT_ENABLED', previousContext);
    restore('TENANT_CACHE_REALTIME_ENABLED', previousCache);
    restore('TENANT_FILES_WORKERS_ENABLED', previousFiles);
  }
});

test('application construction fails fast for an invalid capability combination', () => {
  const previousContext = process.env.TENANT_CONTEXT_ENABLED;
  const previousIsolation = process.env.TENANT_CACHE_REALTIME_ENABLED;
  try {
    process.env.TENANT_CONTEXT_ENABLED = 'false';
    process.env.TENANT_CACHE_REALTIME_ENABLED = 'true';
    const createApp = require('../../src/app');
    assert.throws(
      () => createApp(),
      (error) => error.code === 'TENANT_CAPABILITY_DEPENDENCY_INVALID',
    );
  } finally {
    restore('TENANT_CONTEXT_ENABLED', previousContext);
    restore('TENANT_CACHE_REALTIME_ENABLED', previousIsolation);
  }
});

test('onboarding capability is server-owned and depends on accepted AuditLog isolation', () => {
  const names = [
    'TENANT_CONTEXT_ENABLED',
    'TENANT_CACHE_REALTIME_ENABLED',
    'TENANT_FILES_WORKERS_ENABLED',
    'TENANT_PROVIDER_INTEGRATIONS_ENABLED',
    'TENANT_STAFF_ACCESS_ENABLED',
    'TENANT_CLIENTS_REFERENCES_ENABLED',
    'TENANT_VISITS_SCANNER_ENABLED',
    'TENANT_CLIENT_BASES_CALL_TASKS_ENABLED',
    'TENANT_BOOKINGS_COURTS_ENABLED',
    'TENANT_METHODOLOGY_SKILL_MAP_ENABLED',
    'TENANT_TRAINING_NOTES_PLANS_ENABLED',
    'TENANT_CLIENT_MONEY_INSTRUMENTS_ENABLED',
    'TENANT_SHIFTS_REPORTS_ENABLED',
    'TENANT_AUDIT_LOG_ENABLED',
    'TENANT_ONBOARDING_ENABLED',
  ];
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  try {
    for (const name of names) process.env[name] = 'true';
    assert.equal(assertTenantCapabilityDependencies().tenantOnboarding, true);
    process.env.TENANT_AUDIT_LOG_ENABLED = 'false';
    assert.throws(
      () => assertTenantCapabilityDependencies(),
      (error) => error.code === 'TENANT_CAPABILITY_DEPENDENCY_INVALID' &&
        error.message.includes('TENANT_AUDIT_LOG_ENABLED'),
    );
  } finally {
    for (const name of names) restore(name, previous[name]);
  }
});

test('provider integration capability depends on Features 3, 4.1 and 4.2', () => {
  const names = [
    'TENANT_CONTEXT_ENABLED',
    'TENANT_CACHE_REALTIME_ENABLED',
    'TENANT_FILES_WORKERS_ENABLED',
    'TENANT_PROVIDER_INTEGRATIONS_ENABLED',
  ];
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  try {
    process.env.TENANT_CONTEXT_ENABLED = 'true';
    process.env.TENANT_CACHE_REALTIME_ENABLED = 'true';
    process.env.TENANT_FILES_WORKERS_ENABLED = 'false';
    process.env.TENANT_PROVIDER_INTEGRATIONS_ENABLED = 'true';
    assert.throws(
      () => assertTenantCapabilityDependencies(),
      (error) => error.code === 'TENANT_CAPABILITY_DEPENDENCY_INVALID'
        && error.message.includes('TENANT_FILES_WORKERS_ENABLED'),
    );

    process.env.TENANT_FILES_WORKERS_ENABLED = 'true';
    const capabilities = assertTenantCapabilityDependencies();
    assert.equal(capabilities.tenantProviderIntegrations, true);
  } finally {
    for (const name of names) restore(name, previous[name]);
  }
});

test('Staff/access capability is server-owned and depends on accepted Feature 4 capabilities', () => {
  const names = [
    'TENANT_CONTEXT_ENABLED',
    'TENANT_CACHE_REALTIME_ENABLED',
    'TENANT_FILES_WORKERS_ENABLED',
    'TENANT_PROVIDER_INTEGRATIONS_ENABLED',
    'TENANT_STAFF_ACCESS_ENABLED',
  ];
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  try {
    for (const name of names) process.env[name] = 'true';
    assert.equal(assertTenantCapabilityDependencies().tenantStaffAccess, true);
    assert.equal(
      Object.prototype.hasOwnProperty.call(
        tenantContextCapability(),
        'tenantStaffAccess',
      ),
      false,
    );

    process.env.TENANT_PROVIDER_INTEGRATIONS_ENABLED = 'false';
    assert.throws(
      () => assertTenantCapabilityDependencies(),
      (error) =>
        error.code === 'TENANT_CAPABILITY_DEPENDENCY_INVALID' &&
        error.message.includes('TENANT_PROVIDER_INTEGRATIONS_ENABLED'),
    );
  } finally {
    for (const name of names) restore(name, previous[name]);
  }
});

test('clients/references capability is server-owned and depends on accepted Staff/access', () => {
  const names = [
    'TENANT_CONTEXT_ENABLED',
    'TENANT_CACHE_REALTIME_ENABLED',
    'TENANT_FILES_WORKERS_ENABLED',
    'TENANT_PROVIDER_INTEGRATIONS_ENABLED',
    'TENANT_STAFF_ACCESS_ENABLED',
    'TENANT_CLIENTS_REFERENCES_ENABLED',
  ];
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  try {
    for (const name of names) process.env[name] = 'true';
    const capabilities = assertTenantCapabilityDependencies();
    assert.equal(capabilities.tenantClientsReferences, true);
    assert.equal(
      Object.prototype.hasOwnProperty.call(
        tenantContextCapability(),
        'tenantClientsReferences',
      ),
      false,
    );

    process.env.TENANT_STAFF_ACCESS_ENABLED = 'false';
    assert.throws(
      () => assertTenantCapabilityDependencies(),
      (error) =>
        error.code === 'TENANT_CAPABILITY_DEPENDENCY_INVALID' &&
        error.message.includes('TENANT_STAFF_ACCESS_ENABLED'),
    );
  } finally {
    for (const name of names) restore(name, previous[name]);
  }
});

test('visits/scanner capability is server-owned and depends on accepted clients/references', () => {
  const names = [
    'TENANT_CONTEXT_ENABLED',
    'TENANT_CACHE_REALTIME_ENABLED',
    'TENANT_FILES_WORKERS_ENABLED',
    'TENANT_PROVIDER_INTEGRATIONS_ENABLED',
    'TENANT_STAFF_ACCESS_ENABLED',
    'TENANT_CLIENTS_REFERENCES_ENABLED',
    'TENANT_VISITS_SCANNER_ENABLED',
  ];
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  try {
    for (const name of names) process.env[name] = 'true';
    const capabilities = assertTenantCapabilityDependencies();
    assert.equal(capabilities.tenantVisitsScanner, true);
    assert.equal(
      Object.prototype.hasOwnProperty.call(
        tenantContextCapability(),
        'tenantVisitsScanner',
      ),
      false,
    );

    process.env.TENANT_CLIENTS_REFERENCES_ENABLED = 'false';
    assert.throws(
      () => assertTenantCapabilityDependencies(),
      (error) =>
        error.code === 'TENANT_CAPABILITY_DEPENDENCY_INVALID' &&
        error.message.includes('TENANT_CLIENTS_REFERENCES_ENABLED'),
    );
  } finally {
    for (const name of names) restore(name, previous[name]);
  }
});

test('client bases/call tasks capability is server-owned and depends on visits/scanner', () => {
  const names = [
    'TENANT_CONTEXT_ENABLED',
    'TENANT_CACHE_REALTIME_ENABLED',
    'TENANT_FILES_WORKERS_ENABLED',
    'TENANT_PROVIDER_INTEGRATIONS_ENABLED',
    'TENANT_STAFF_ACCESS_ENABLED',
    'TENANT_CLIENTS_REFERENCES_ENABLED',
    'TENANT_VISITS_SCANNER_ENABLED',
    'TENANT_CLIENT_BASES_CALL_TASKS_ENABLED',
  ];
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  try {
    for (const name of names) process.env[name] = 'true';
    const capabilities = assertTenantCapabilityDependencies();
    assert.equal(capabilities.tenantClientBasesCallTasks, true);
    assert.equal(
      Object.prototype.hasOwnProperty.call(
        tenantContextCapability(),
        'tenantClientBasesCallTasks',
      ),
      false,
    );

    process.env.TENANT_VISITS_SCANNER_ENABLED = 'false';
    assert.throws(
      () => assertTenantCapabilityDependencies(),
      (error) =>
        error.code === 'TENANT_CAPABILITY_DEPENDENCY_INVALID' &&
        error.message.includes('TENANT_VISITS_SCANNER_ENABLED'),
    );
  } finally {
    for (const name of names) restore(name, previous[name]);
  }
});

test('bookings/courts capability is server-owned and depends on client bases/call tasks', () => {
  const names = [
    'TENANT_CONTEXT_ENABLED',
    'TENANT_CACHE_REALTIME_ENABLED',
    'TENANT_FILES_WORKERS_ENABLED',
    'TENANT_PROVIDER_INTEGRATIONS_ENABLED',
    'TENANT_STAFF_ACCESS_ENABLED',
    'TENANT_CLIENTS_REFERENCES_ENABLED',
    'TENANT_VISITS_SCANNER_ENABLED',
    'TENANT_CLIENT_BASES_CALL_TASKS_ENABLED',
    'TENANT_BOOKINGS_COURTS_ENABLED',
  ];
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  try {
    for (const name of names) process.env[name] = 'true';
    const capabilities = assertTenantCapabilityDependencies();
    assert.equal(capabilities.tenantBookingsCourts, true);
    assert.equal(
      Object.prototype.hasOwnProperty.call(
        tenantContextCapability(),
        'tenantBookingsCourts',
      ),
      false,
    );

    process.env.TENANT_CLIENT_BASES_CALL_TASKS_ENABLED = 'false';
    assert.throws(
      () => assertTenantCapabilityDependencies(),
      (error) =>
        error.code === 'TENANT_CAPABILITY_DEPENDENCY_INVALID' &&
        error.message.includes('TENANT_CLIENT_BASES_CALL_TASKS_ENABLED'),
    );
  } finally {
    for (const name of names) restore(name, previous[name]);
  }
});

test('methodology/skill-map capability is server-owned and depends on bookings/courts', () => {
  const names = [
    'TENANT_CONTEXT_ENABLED',
    'TENANT_CACHE_REALTIME_ENABLED',
    'TENANT_FILES_WORKERS_ENABLED',
    'TENANT_PROVIDER_INTEGRATIONS_ENABLED',
    'TENANT_STAFF_ACCESS_ENABLED',
    'TENANT_CLIENTS_REFERENCES_ENABLED',
    'TENANT_VISITS_SCANNER_ENABLED',
    'TENANT_CLIENT_BASES_CALL_TASKS_ENABLED',
    'TENANT_BOOKINGS_COURTS_ENABLED',
    'TENANT_METHODOLOGY_SKILL_MAP_ENABLED',
  ];
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  try {
    for (const name of names) process.env[name] = 'true';
    const capabilities = assertTenantCapabilityDependencies();
    assert.equal(capabilities.tenantMethodologySkillMap, true);
    assert.equal(
      Object.prototype.hasOwnProperty.call(
        tenantContextCapability(),
        'tenantMethodologySkillMap',
      ),
      false,
    );

    process.env.TENANT_BOOKINGS_COURTS_ENABLED = 'false';
    assert.throws(
      () => assertTenantCapabilityDependencies(),
      (error) =>
        error.code === 'TENANT_CAPABILITY_DEPENDENCY_INVALID' &&
        error.message.includes('TENANT_BOOKINGS_COURTS_ENABLED'),
    );
  } finally {
    for (const name of names) restore(name, previous[name]);
  }
});

test('training notes/plans capability is server-owned and depends on methodology/skill-map', () => {
  const names = [
    'TENANT_CONTEXT_ENABLED',
    'TENANT_CACHE_REALTIME_ENABLED',
    'TENANT_FILES_WORKERS_ENABLED',
    'TENANT_PROVIDER_INTEGRATIONS_ENABLED',
    'TENANT_STAFF_ACCESS_ENABLED',
    'TENANT_CLIENTS_REFERENCES_ENABLED',
    'TENANT_VISITS_SCANNER_ENABLED',
    'TENANT_CLIENT_BASES_CALL_TASKS_ENABLED',
    'TENANT_BOOKINGS_COURTS_ENABLED',
    'TENANT_METHODOLOGY_SKILL_MAP_ENABLED',
    'TENANT_TRAINING_NOTES_PLANS_ENABLED',
  ];
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  try {
    for (const name of names) process.env[name] = 'true';
    const capabilities = assertTenantCapabilityDependencies();
    assert.equal(capabilities.tenantTrainingNotesPlans, true);
    assert.equal(
      Object.prototype.hasOwnProperty.call(
        tenantContextCapability(),
        'tenantTrainingNotesPlans',
      ),
      false,
    );

    process.env.TENANT_METHODOLOGY_SKILL_MAP_ENABLED = 'false';
    assert.throws(
      () => assertTenantCapabilityDependencies(),
      (error) =>
        error.code === 'TENANT_CAPABILITY_DEPENDENCY_INVALID' &&
        error.message.includes('TENANT_METHODOLOGY_SKILL_MAP_ENABLED'),
    );
  } finally {
    for (const name of names) restore(name, previous[name]);
  }
});

test('client-money capability depends on accepted training notes/plans', () => {
  const names = [
    'TENANT_CONTEXT_ENABLED',
    'TENANT_CACHE_REALTIME_ENABLED',
    'TENANT_FILES_WORKERS_ENABLED',
    'TENANT_PROVIDER_INTEGRATIONS_ENABLED',
    'TENANT_STAFF_ACCESS_ENABLED',
    'TENANT_CLIENTS_REFERENCES_ENABLED',
    'TENANT_VISITS_SCANNER_ENABLED',
    'TENANT_CLIENT_BASES_CALL_TASKS_ENABLED',
    'TENANT_BOOKINGS_COURTS_ENABLED',
    'TENANT_METHODOLOGY_SKILL_MAP_ENABLED',
    'TENANT_TRAINING_NOTES_PLANS_ENABLED',
    'TENANT_CLIENT_MONEY_INSTRUMENTS_ENABLED',
  ];
  const previous = Object.fromEntries(
    names.map((name) => [name, process.env[name]]),
  );
  try {
    for (const name of names) process.env[name] = 'true';
    const capabilities = assertTenantCapabilityDependencies();
    assert.equal(capabilities.tenantClientMoneyInstruments, true);
    assert.equal(
      Object.prototype.hasOwnProperty.call(
        tenantContextCapability(),
        'tenantClientMoneyInstruments',
      ),
      false,
    );

    process.env.TENANT_TRAINING_NOTES_PLANS_ENABLED = 'false';
    assert.throws(
      () => assertTenantCapabilityDependencies(),
      (error) =>
        error.code === 'TENANT_CAPABILITY_DEPENDENCY_INVALID' &&
        error.message.includes('TENANT_TRAINING_NOTES_PLANS_ENABLED'),
    );
  } finally {
    for (const name of names) restore(name, previous[name]);
  }
});

test('shifts/reports capability depends on accepted client-money isolation', () => {
  const names = [
    'TENANT_CONTEXT_ENABLED',
    'TENANT_CACHE_REALTIME_ENABLED',
    'TENANT_FILES_WORKERS_ENABLED',
    'TENANT_PROVIDER_INTEGRATIONS_ENABLED',
    'TENANT_STAFF_ACCESS_ENABLED',
    'TENANT_CLIENTS_REFERENCES_ENABLED',
    'TENANT_VISITS_SCANNER_ENABLED',
    'TENANT_CLIENT_BASES_CALL_TASKS_ENABLED',
    'TENANT_BOOKINGS_COURTS_ENABLED',
    'TENANT_METHODOLOGY_SKILL_MAP_ENABLED',
    'TENANT_TRAINING_NOTES_PLANS_ENABLED',
    'TENANT_CLIENT_MONEY_INSTRUMENTS_ENABLED',
    'TENANT_SHIFTS_REPORTS_ENABLED',
  ];
  const previous = Object.fromEntries(
    names.map((name) => [name, process.env[name]]),
  );
  try {
    for (const name of names) process.env[name] = 'true';
    const capabilities = assertTenantCapabilityDependencies();
    assert.equal(capabilities.tenantShiftsReports, true);
    assert.equal(
      Object.prototype.hasOwnProperty.call(
        tenantContextCapability(),
        'tenantShiftsReports',
      ),
      false,
    );

    process.env.TENANT_CLIENT_MONEY_INSTRUMENTS_ENABLED = 'false';
    assert.throws(
      () => assertTenantCapabilityDependencies(),
      (error) =>
        error.code === 'TENANT_CAPABILITY_DEPENDENCY_INVALID' &&
        error.message.includes('TENANT_CLIENT_MONEY_INSTRUMENTS_ENABLED'),
    );
  } finally {
    for (const name of names) restore(name, previous[name]);
  }
});

test('AuditLog capability depends on accepted shifts/reports isolation', () => {
  const names = [
    'TENANT_CONTEXT_ENABLED',
    'TENANT_CACHE_REALTIME_ENABLED',
    'TENANT_FILES_WORKERS_ENABLED',
    'TENANT_PROVIDER_INTEGRATIONS_ENABLED',
    'TENANT_STAFF_ACCESS_ENABLED',
    'TENANT_CLIENTS_REFERENCES_ENABLED',
    'TENANT_VISITS_SCANNER_ENABLED',
    'TENANT_CLIENT_BASES_CALL_TASKS_ENABLED',
    'TENANT_BOOKINGS_COURTS_ENABLED',
    'TENANT_METHODOLOGY_SKILL_MAP_ENABLED',
    'TENANT_TRAINING_NOTES_PLANS_ENABLED',
    'TENANT_CLIENT_MONEY_INSTRUMENTS_ENABLED',
    'TENANT_SHIFTS_REPORTS_ENABLED',
    'TENANT_AUDIT_LOG_ENABLED',
  ];
  const previous = Object.fromEntries(
    names.map((name) => [name, process.env[name]]),
  );
  try {
    for (const name of names) process.env[name] = 'true';
    const capabilities = assertTenantCapabilityDependencies();
    assert.equal(capabilities.tenantAuditLog, true);
    assert.equal(
      Object.prototype.hasOwnProperty.call(
        tenantContextCapability(),
        'tenantAuditLog',
      ),
      false,
    );

    process.env.TENANT_SHIFTS_REPORTS_ENABLED = 'false';
    assert.throws(
      () => assertTenantCapabilityDependencies(),
      (error) =>
        error.code === 'TENANT_CAPABILITY_DEPENDENCY_INVALID' &&
        error.message.includes('TENANT_SHIFTS_REPORTS_ENABLED'),
    );
  } finally {
    for (const name of names) restore(name, previous[name]);
  }
});

test('final tenant enforcement is server-owned and depends on accepted onboarding isolation', () => {
  const names = [
    'TENANT_CONTEXT_ENABLED',
    'TENANT_CACHE_REALTIME_ENABLED',
    'TENANT_FILES_WORKERS_ENABLED',
    'TENANT_PROVIDER_INTEGRATIONS_ENABLED',
    'TENANT_STAFF_ACCESS_ENABLED',
    'TENANT_CLIENTS_REFERENCES_ENABLED',
    'TENANT_VISITS_SCANNER_ENABLED',
    'TENANT_CLIENT_BASES_CALL_TASKS_ENABLED',
    'TENANT_BOOKINGS_COURTS_ENABLED',
    'TENANT_METHODOLOGY_SKILL_MAP_ENABLED',
    'TENANT_TRAINING_NOTES_PLANS_ENABLED',
    'TENANT_CLIENT_MONEY_INSTRUMENTS_ENABLED',
    'TENANT_SHIFTS_REPORTS_ENABLED',
    'TENANT_AUDIT_LOG_ENABLED',
    'TENANT_ONBOARDING_ENABLED',
    'TENANT_ENFORCEMENT_ENABLED',
  ];
  const previous = Object.fromEntries(
    names.map((name) => [name, process.env[name]]),
  );
  try {
    for (const name of names) process.env[name] = 'true';
    const capabilities = assertTenantCapabilityDependencies();
    assert.equal(capabilities.tenantEnforcement, true);
    assert.equal(
      Object.prototype.hasOwnProperty.call(
        tenantContextCapability(),
        'tenantEnforcement',
      ),
      false,
    );

    process.env.TENANT_ONBOARDING_ENABLED = 'false';
    assert.throws(
      () => assertTenantCapabilityDependencies(),
      (error) =>
        error.code === 'TENANT_CAPABILITY_DEPENDENCY_INVALID' &&
        error.message.includes('TENANT_ONBOARDING_ENABLED'),
    );
  } finally {
    for (const name of names) restore(name, previous[name]);
  }
});
