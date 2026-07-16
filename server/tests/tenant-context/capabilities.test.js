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
