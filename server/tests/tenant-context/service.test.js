'use strict';

const assert = require('node:assert/strict');
const { afterEach, beforeEach, test } = require('node:test');
const db = require('../../models');
const {
  discoverMemberships,
  resolveTenantContext,
} = require('../../src/services/tenant-context.service');

const originals = {};

beforeEach(() => {
  for (const [model, methods] of [
    [db.Membership, ['findAll', 'findOne']],
    [db.MembershipClubAccess, ['findOne']],
    [db.Club, ['findAll', 'findOne']],
  ]) {
    for (const method of methods) {
      originals[`${model.name}.${method}`] = model[method];
    }
  }
});

afterEach(() => {
  for (const [model, methods] of [
    [db.Membership, ['findAll', 'findOne']],
    [db.MembershipClubAccess, ['findOne']],
    [db.Club, ['findAll', 'findOne']],
  ]) {
    for (const method of methods) {
      model[method] = originals[`${model.name}.${method}`];
    }
  }
});

function membership(role = 'manager') {
  return {
    accountId: 7,
    id: 21,
    organizationId: 11,
    role,
    status: 'active',
  };
}

function club() {
  return {
    id: 12,
    name: 'Padel Park',
    organizationId: 11,
    slug: 'padel-park',
    status: 'active',
    timezone: 'Europe/Moscow',
  };
}

test('global, membership and organization contexts are deterministic and frozen', async () => {
  const globalContext = await resolveTenantContext({ accountId: 7, scope: 'global' });
  assert.deepEqual(globalContext, {
    accountId: 7,
    clubId: null,
    effectiveRole: null,
    membershipId: null,
    membershipRole: null,
    organizationId: null,
    scope: 'global',
  });
  assert.equal(Object.isFrozen(globalContext), true);

  let query;
  db.Membership.findOne = async (options) => {
    query = options;
    return membership('accountant');
  };
  const membershipContext = await resolveTenantContext({
    accountId: 7,
    organizationId: 11,
    scope: 'membership',
  });
  assert.equal(membershipContext.membershipRole, 'accountant');
  assert.equal(membershipContext.effectiveRole, 'accountant');
  assert.equal(membershipContext.clubId, null);
  assert.deepEqual(query.where, {
    accountId: 7,
    organizationId: 11,
    status: 'active',
  });
  assert.deepEqual(query.include[0].where, { status: 'active' });

  const organizationContext = await resolveTenantContext({
    accountId: 7,
    organizationId: 11,
    scope: 'organization',
  });
  assert.equal(organizationContext.scope, 'organization');
  assert.equal(organizationContext.membershipRole, 'accountant');
});

test('owner gets an active organization club without an explicit access row', async () => {
  db.Membership.findOne = async () => membership('owner');
  db.Club.findOne = async (options) => {
    assert.deepEqual(options.where, {
      id: 12,
      organizationId: 11,
      status: 'active',
    });
    return club();
  };
  db.MembershipClubAccess.findOne = async () => {
    throw new Error('owner must not query explicit access');
  };
  const context = await resolveTenantContext({
    accountId: 7,
    clubId: 12,
    organizationId: 11,
    scope: 'club',
  });
  assert.equal(context.effectiveRole, 'owner');
  assert.equal(context.clubId, 12);
});

test('non-owner requires active access and applies a non-owner override', async () => {
  db.Membership.findOne = async () => membership('manager');
  db.Club.findOne = async () => club();
  let accessQuery;
  db.MembershipClubAccess.findOne = async (options) => {
    accessQuery = options;
    return { roleOverride: 'trainer', status: 'active' };
  };
  const context = await resolveTenantContext({
    accountId: 7,
    clubId: 12,
    organizationId: 11,
    scope: 'club',
  });
  assert.equal(context.membershipRole, 'manager');
  assert.equal(context.effectiveRole, 'trainer');
  assert.deepEqual(accessQuery.where, {
    clubId: 12,
    membershipId: 21,
    organizationId: 11,
    status: 'active',
  });
});

test('inactive or mismatched chain and owner override fail with the same safe denial', async (t) => {
  const scenarios = [
    {
      name: 'inactive account organization or membership chain',
      setup() {
        db.Membership.findOne = async () => null;
      },
      scope: 'organization',
    },
    {
      name: 'organization club mismatch or inactive club',
      setup() {
        db.Membership.findOne = async () => membership('manager');
        db.Club.findOne = async () => null;
      },
      scope: 'club',
    },
    {
      name: 'inactive or missing access',
      setup() {
        db.Membership.findOne = async () => membership('manager');
        db.Club.findOne = async () => club();
        db.MembershipClubAccess.findOne = async () => null;
      },
      scope: 'club',
    },
    {
      name: 'owner override is impossible even if a corrupt row appears',
      setup() {
        db.Membership.findOne = async () => membership('manager');
        db.Club.findOne = async () => club();
        db.MembershipClubAccess.findOne = async () => ({ roleOverride: 'owner' });
      },
      scope: 'club',
    },
  ];

  for (const scenario of scenarios) {
    await t.test(scenario.name, async () => {
      scenario.setup();
      await assert.rejects(
        resolveTenantContext({
          accountId: 7,
          clubId: scenario.scope === 'club' ? 12 : null,
          organizationId: 11,
          scope: scenario.scope,
        }),
        (error) => error.statusCode === 404 && error.code === 'TENANT_CONTEXT_NOT_FOUND',
      );
    });
  }
});

test('discovery returns minimal owner and non-owner access with deterministic recommendation', async () => {
  const owner = {
    ...membership('owner'),
    MembershipClubAccesses: [],
    Organization: { id: 11, name: 'Padel Park', slug: 'padel-park' },
  };
  const accessibleClub = club();
  const manager = {
    ...membership('manager'),
    accountId: 8,
    id: 22,
    MembershipClubAccesses: [
      { Club: accessibleClub, roleOverride: 'admin', status: 'active' },
    ],
    Organization: { id: 11, name: 'Padel Park', slug: 'padel-park' },
  };

  db.Membership.findAll = async (options) => {
    assert.equal(options.where.status, 'active');
    return options.where.accountId === 7 ? [owner] : [manager];
  };
  db.Club.findAll = async (options) => {
    assert.deepEqual(options.where, { organizationId: 11, status: 'active' });
    return [accessibleClub];
  };

  const ownerDiscovery = await discoverMemberships(7);
  assert.deepEqual(ownerDiscovery.memberships[0].clubs, [
    {
      effectiveRole: 'owner',
      id: 12,
      name: 'Padel Park',
      slug: 'padel-park',
      timezone: 'Europe/Moscow',
    },
  ]);
  assert.deepEqual(ownerDiscovery.recommendedContext, {
    clubId: 12,
    effectiveRole: 'owner',
    membershipId: 21,
    organizationId: 11,
  });

  const managerDiscovery = await discoverMemberships(8);
  assert.equal(managerDiscovery.memberships[0].clubs[0].effectiveRole, 'admin');
  assert.equal('status' in managerDiscovery.memberships[0].clubs[0], false);
  assert.equal('accountId' in managerDiscovery.memberships[0], false);
});
