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
