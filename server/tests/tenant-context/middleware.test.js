'use strict';

const assert = require('node:assert/strict');
const { afterEach, beforeEach, test } = require('node:test');
const tenantContextService = require('../../src/services/tenant-context.service');
const authService = require('../../src/services/auth.service');
const db = require('../../models');
const {
  resolveRequestTenant,
} = require('../../src/middleware/tenant-context');
const { requireAuth, requireRole } = require('../../src/middleware/auth');

const originalResolve = tenantContextService.resolveTenantContext;
let previousFlag;
let originalAuthenticateBearerToken;

beforeEach(() => {
  previousFlag = process.env.TENANT_CONTEXT_ENABLED;
  originalAuthenticateBearerToken = authService.authenticateBearerToken;
});

afterEach(() => {
  tenantContextService.resolveTenantContext = originalResolve;
  process.env.TENANT_CONTEXT_ENABLED = previousFlag;
  authService.authenticateBearerToken = originalAuthenticateBearerToken;
});

function response() {
  return {
    body: null,
    statusCode: null,
    json(payload) {
      this.body = payload;
      return this;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
  };
}

function request(path, classification, headers = {}, rawHeaders = []) {
  return {
    account: {
      id: 7,
      role: 'manager',
      status: 'active',
      toJSON() {
        return { id: this.id, role: this.role, status: this.status };
      },
    },
    body: { clubId: 999, organizationId: 999 },
    headers,
    method: 'GET',
    originalUrl: `/api${path}`,
    path,
    query: { clubId: '999', organizationId: '999' },
    rawHeaders,
    tenantRoute: {
      classification,
      id: 'synthetic.declared',
      method: 'GET',
      path,
      public: false,
    },
  };
}

async function runResolver(req) {
  const res = response();
  let nextCalled = false;
  await resolveRequestTenant(req, res, () => {
    nextCalled = true;
  });
  return { nextCalled, res };
}

test('flag off preserves legacy account authorization and requires no tenant headers', async () => {
  const originalOrganizations = db.Organization.findAll;
  const originalClubs = db.Club.findAll;
  try {
    db.Organization.findAll = async () => [
      { id: 1, slug: 'padel-park', status: 'active' },
    ];
    db.Club.findAll = async () => [
      {
        id: 1,
        organizationId: 1,
        slug: 'padel-park',
        status: 'active',
      },
    ];
    process.env.TENANT_CONTEXT_ENABLED = 'false';
    const req = request('/bookings/schedule', 'club');
    const result = await runResolver(req);
    assert.equal(result.nextCalled, true);
    assert.equal(req.tenant, undefined);

    let roleNext = false;
    requireRole('manager')(req, response(), () => {
      roleNext = true;
    });
    assert.equal(roleNext, true);
  } finally {
    db.Organization.findAll = originalOrganizations;
    db.Club.findAll = originalClubs;
  }
});

test('inactive Account remains rejected by identity auth before tenant resolution', async () => {
  authService.authenticateBearerToken = async () => null;
  const req = { headers: { authorization: 'Bearer token' } };
  const res = response();
  let nextCalled = false;
  await requireAuth(req, res, () => {
    nextCalled = true;
  });
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 401);
});

test('missing, malformed and duplicate organization headers fail before DB lookup', async (t) => {
  process.env.TENANT_CONTEXT_ENABLED = 'true';
  let lookups = 0;
  tenantContextService.resolveTenantContext = async () => {
    lookups += 1;
    throw new Error('should not execute');
  };

  for (const [name, req, expectedCode] of [
    ['missing', request('/accounts', 'organization'), 'TENANT_CONTEXT_REQUIRED'],
    [
      'malformed',
      request('/accounts', 'organization', { 'x-organization-id': '0' }),
      'TENANT_CONTEXT_INVALID',
    ],
    [
      'duplicate',
      request(
        '/accounts',
        'organization',
        { 'x-organization-id': '1, 2' },
        ['X-Organization-Id', '1', 'X-Organization-Id', '2'],
      ),
      'TENANT_CONTEXT_INVALID',
    ],
  ]) {
    await t.test(name, async () => {
      const { nextCalled, res } = await runResolver(req);
      assert.equal(nextCalled, false);
      assert.equal(res.statusCode, 400);
      assert.equal(res.body.code, expectedCode);
    });
  }
  assert.equal(lookups, 0);
});

test('club resolver uses only explicit headers and creates immutable effective authorization', async () => {
  process.env.TENANT_CONTEXT_ENABLED = 'true';
  let input;
  tenantContextService.resolveTenantContext = async (value) => {
    input = value;
    return Object.freeze({
      accountId: value.accountId,
      clubId: value.clubId,
      effectiveRole: 'trainer',
      membershipId: 21,
      membershipRole: 'manager',
      organizationId: value.organizationId,
      scope: value.scope,
    });
  };
  const req = request(
    '/bookings/schedule',
    'club',
    { 'x-club-id': '12', 'x-organization-id': '11' },
    ['X-Organization-Id', '11', 'X-Club-Id', '12'],
  );
  const { nextCalled } = await runResolver(req);
  assert.equal(nextCalled, true);
  assert.deepEqual(input, {
    accountId: 7,
    clubId: 12,
    organizationId: 11,
    scope: 'club',
  });
  assert.equal(req.body.organizationId, 999);
  assert.equal(req.query.clubId, '999');
  assert.equal(req.account.role, 'trainer');
  assert.equal(req.account.identityRole, 'manager');
  assert.equal(Object.isFrozen(req.tenant), true);
  assert.throws(() => {
    req.tenant.clubId = 99;
  }, TypeError);

  let trainerNext = false;
  requireRole('trainer')(req, response(), () => {
    trainerNext = true;
  });
  assert.equal(trainerNext, true);
  const denied = response();
  requireRole('manager')(req, denied, () => {});
  assert.equal(denied.statusCode, 403);
});

test('organization authorization uses membershipRole instead of club effectiveRole', () => {
  process.env.TENANT_CONTEXT_ENABLED = 'true';
  const req = request('/accounts', 'organization');
  req.tenant = {
    accountId: 7,
    clubId: null,
    effectiveRole: 'trainer',
    membershipId: 21,
    membershipRole: 'manager',
    organizationId: 11,
    scope: 'organization',
  };
  let nextCalled = false;
  requireRole('manager')(req, response(), () => {
    nextCalled = true;
  });
  assert.equal(nextCalled, true);
});
