'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  classifySnapshot,
  getTenantFoundationGateState,
  invalidateTenantFoundationGateCache,
  resolveGateCacheTtlMs,
} = require('../../src/services/tenant-foundation.service');

function snapshot({ accounts = [], memberships = [], accesses = [], organizations, clubs } = {}) {
  return {
    accesses,
    accounts,
    clubs:
      clubs ||
      [
        {
          id: 1,
          organizationId: 1,
          slug: 'padel-park',
          status: 'active',
        },
      ],
    memberships,
    organizations:
      organizations || [{ id: 1, slug: 'padel-park', status: 'active' }],
  };
}

test('tenant foundation classifier recognizes exact bootstrap-pending state', () => {
  const result = classifySnapshot(snapshot());
  assert.equal(result.state, 'bootstrap-pending');
  assert.equal(result.bootstrapPending, true);
  assert.deepEqual(result.counts, {
    accesses: 0,
    accounts: 0,
    clubs: 1,
    memberships: 0,
    organizations: 1,
  });
});

test('tenant foundation classifier recognizes initialized parity', () => {
  const result = classifySnapshot(
    snapshot({
      accounts: [
        { id: 1, role: 'owner', status: 'active' },
        { id: 2, role: 'manager', status: 'inactive' },
      ],
      memberships: [
        { id: 10, accountId: 1, organizationId: 1, role: 'owner', status: 'active' },
        { id: 11, accountId: 2, organizationId: 1, role: 'manager', status: 'inactive' },
      ],
      accesses: [
        {
          clubId: 1,
          membershipId: 11,
          organizationId: 1,
          roleOverride: null,
          status: 'inactive',
        },
      ],
    }),
  );
  assert.equal(result.state, 'initialized');
  assert.equal(result.diagnostics.activeOwners, 1);
});

test('tenant foundation classifier rejects partial, parity, owner and second-tenant states', () => {
  const partial = classifySnapshot(
    snapshot({ accounts: [{ id: 1, role: 'owner', status: 'active' }] }),
  );
  assert.equal(partial.state, 'invalid');
  assert.match(partial.diagnostics.reasons.join(' '), /partially empty/);

  const mismatch = classifySnapshot(
    snapshot({
      accounts: [{ id: 1, role: 'owner', status: 'active' }],
      memberships: [
        { id: 10, accountId: 1, organizationId: 1, role: 'manager', status: 'active' },
      ],
      accesses: [
        {
          clubId: 1,
          membershipId: 10,
          organizationId: 1,
          roleOverride: null,
          status: 'active',
        },
      ],
    }),
  );
  assert.equal(mismatch.state, 'invalid');
  assert.match(mismatch.diagnostics.reasons.join(' '), /parity mismatch/);
  assert.match(mismatch.diagnostics.reasons.join(' '), /active owner/);

  const secondTenant = classifySnapshot(
    snapshot({
      organizations: [
        { id: 1, slug: 'padel-park', status: 'active' },
        { id: 2, slug: 'other', status: 'active' },
      ],
      clubs: [
        { id: 1, organizationId: 1, slug: 'padel-park', status: 'active' },
        { id: 2, organizationId: 2, slug: 'other', status: 'active' },
      ],
    }),
  );
  assert.equal(secondTenant.state, 'invalid');
  assert.match(secondTenant.diagnostics.reasons.join(' '), /exactly one/);
});

test('owner access and owner roleOverride are never accepted by classifier', () => {
  const result = classifySnapshot(
    snapshot({
      accounts: [{ id: 1, role: 'owner', status: 'active' }],
      memberships: [
        { id: 10, accountId: 1, organizationId: 1, role: 'owner', status: 'active' },
      ],
      accesses: [
        {
          clubId: 1,
          membershipId: 10,
          organizationId: 1,
          roleOverride: 'owner',
          status: 'active',
        },
      ],
    }),
  );
  assert.equal(result.state, 'invalid');
  assert.match(result.diagnostics.reasons.join(' '), /must not have Club access/);
});

test('ready Staff identity schema requires Account/Membership/Staff parity', () => {
  const base = snapshot({
    accounts: [{ id: 1, role: 'owner', staffId: 5, status: 'active' }],
    memberships: [
      {
        id: 10,
        accountId: 1,
        organizationId: 1,
        role: 'owner',
        staffId: 5,
        status: 'active',
      },
    ],
  });
  base.staffIdentitySchema = 'ready';
  base.staffs = [{ id: 5, organizationId: 1, status: 'active' }];
  assert.equal(classifySnapshot(base).state, 'initialized');

  base.memberships[0].staffId = null;
  const mismatch = classifySnapshot(base);
  assert.equal(mismatch.state, 'invalid');
  assert.match(mismatch.diagnostics.reasons.join(' '), /Staff link parity/);

  const partial = snapshot();
  partial.staffIdentitySchema = 'partial';
  partial.staffs = [];
  assert.equal(classifySnapshot(partial).state, 'invalid');
});

test('final enforcement classifier accepts valid multi-tenant authority and rejects cross-parent links', () => {
  const enforced = snapshot({
    accounts: [
      { id: 1, role: 'owner', staffId: null, status: 'active' },
      { id: 2, role: 'admin', staffId: 5, status: 'active' },
      { id: 3, role: 'owner', staffId: null, status: 'active' },
      { id: 4, role: 'admin', staffId: 6, status: 'active' },
    ],
    memberships: [
      { id: 10, accountId: 1, organizationId: 1, role: 'owner', staffId: null, status: 'active' },
      { id: 11, accountId: 2, organizationId: 1, role: 'admin', staffId: 5, status: 'active' },
      { id: 12, accountId: 3, organizationId: 2, role: 'owner', staffId: null, status: 'active' },
      { id: 13, accountId: 4, organizationId: 2, role: 'admin', staffId: 6, status: 'active' },
    ],
    accesses: [
      { clubId: 1, membershipId: 11, organizationId: 1, roleOverride: null, status: 'active' },
      { clubId: 2, membershipId: 13, organizationId: 2, roleOverride: null, status: 'active' },
    ],
    organizations: [
      { id: 1, slug: 'padel-park', status: 'active' },
      { id: 2, slug: 'second', status: 'active' },
    ],
    clubs: [
      { id: 1, organizationId: 1, slug: 'padel-park', status: 'active' },
      { id: 2, organizationId: 2, slug: 'padel-park', status: 'active' },
    ],
  });
  enforced.staffIdentitySchema = 'ready';
  enforced.staffs = [
    { id: 5, organizationId: 1, status: 'active' },
    { id: 6, organizationId: 2, status: 'active' },
  ];
  const valid = classifySnapshot(enforced, { enforcementEnabled: true });
  assert.equal(valid.state, 'initialized');
  assert.equal(valid.diagnostics.activeOwners, 2);

  enforced.accesses[1].organizationId = 1;
  const invalid = classifySnapshot(enforced, { enforcementEnabled: true });
  assert.equal(invalid.state, 'invalid');
  assert.match(invalid.diagnostics.reasons.join(' '), /Organization mismatch/);
});

test('request gate cache is short, bounded and coalesces concurrent strict reads', async () => {
  invalidateTenantFoundationGateCache();
  assert.equal(resolveGateCacheTtlMs(-10), 0);
  assert.equal(resolveGateCacheTtlMs(50000), 1000);

  let nowMs = 100;
  let calls = 0;
  let releaseFirst;
  const classify = async () => {
    calls += 1;
    if (calls === 1) {
      await new Promise((resolve) => {
        releaseFirst = resolve;
      });
    }
    return { state: 'initialized', sequence: calls };
  };

  const first = getTenantFoundationGateState({
    classify,
    now: () => nowMs,
    ttlMs: 250,
  });
  const concurrent = getTenantFoundationGateState({
    classify,
    now: () => nowMs,
    ttlMs: 250,
  });
  await Promise.resolve();
  assert.equal(calls, 1);
  releaseFirst();
  assert.equal((await first).sequence, 1);
  assert.equal((await concurrent).sequence, 1);
  assert.equal(
    (
      await getTenantFoundationGateState({
        classify,
        now: () => nowMs,
        ttlMs: 250,
      })
    ).sequence,
    1,
  );

  nowMs += 251;
  assert.equal(
    (
      await getTenantFoundationGateState({
        classify,
        now: () => nowMs,
        ttlMs: 250,
      })
    ).sequence,
    2,
  );
  invalidateTenantFoundationGateCache();
});

test('cache invalidation generation prevents an old in-flight snapshot from returning', async () => {
  invalidateTenantFoundationGateCache();
  let releaseOld;
  const oldResult = getTenantFoundationGateState({
    classify: async () => {
      await new Promise((resolve) => {
        releaseOld = resolve;
      });
      return { state: 'bootstrap-pending', source: 'old' };
    },
    now: () => 100,
    ttlMs: 250,
  });
  await Promise.resolve();
  invalidateTenantFoundationGateCache();

  const currentResult = await getTenantFoundationGateState({
    classify: async () => ({ state: 'initialized', source: 'current' }),
    now: () => 100,
    ttlMs: 250,
  });
  assert.equal(currentResult.source, 'current');
  releaseOld();
  assert.equal((await oldResult).source, 'old');

  let unexpectedCalls = 0;
  const cached = await getTenantFoundationGateState({
    classify: async () => {
      unexpectedCalls += 1;
      return { state: 'invalid', source: 'unexpected' };
    },
    now: () => 100,
    ttlMs: 250,
  });
  assert.equal(cached.source, 'current');
  assert.equal(unexpectedCalls, 0);
  invalidateTenantFoundationGateCache();
});
