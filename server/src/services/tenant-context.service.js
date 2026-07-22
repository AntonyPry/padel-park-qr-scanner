'use strict';

const db = require('../../models');
const { TENANT_SCOPES } = require('../tenant-context/route-scope-declarations');

const ACTIVE = 'active';
const trustedTenantContexts = new WeakSet();

function freezeTenantContext(values) {
  const context = Object.freeze(values);
  trustedTenantContexts.add(context);
  return context;
}

function isTrustedTenantContext(value) {
  return Boolean(value && trustedTenantContexts.has(value));
}

function tenantError(message, statusCode, code) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function safeTenantDenial() {
  return tenantError('Контекст организации или клуба недоступен', 404, 'TENANT_CONTEXT_NOT_FOUND');
}

async function findActiveMembership(accountId, organizationId) {
  return db.Membership.findOne({
    where: {
      accountId,
      organizationId,
      status: ACTIVE,
    },
    include: [
      {
        model: db.Organization,
        required: true,
        where: { status: ACTIVE },
      },
    ],
  });
}

async function resolveTenantContext({ accountId, clubId = null, organizationId = null, scope }) {
  if (scope === TENANT_SCOPES.GLOBAL) {
    return freezeTenantContext({
      accountId,
      clubId: null,
      effectiveRole: null,
      membershipId: null,
      membershipRole: null,
      organizationId: null,
      scope,
    });
  }

  const membership = await findActiveMembership(accountId, organizationId);
  if (!membership) throw safeTenantDenial();

  const membershipRole = membership.role;
  const baseContext = {
    accountId,
    clubId: null,
    effectiveRole: membershipRole,
    membershipId: membership.id,
    membershipRole,
    organizationId: membership.organizationId,
    scope,
  };

  if (scope === TENANT_SCOPES.MEMBERSHIP || scope === TENANT_SCOPES.ORGANIZATION) {
    return freezeTenantContext(baseContext);
  }

  if (scope !== TENANT_SCOPES.CLUB || !clubId) {
    throw tenantError('Tenant scope declaration is invalid', 500, 'TENANT_SCOPE_INVALID');
  }

  const club = await db.Club.findOne({
    where: {
      id: clubId,
      organizationId: membership.organizationId,
      status: ACTIVE,
    },
  });
  if (!club) throw safeTenantDenial();

  let effectiveRole = membershipRole;
  if (membershipRole !== 'owner') {
    const access = await db.MembershipClubAccess.findOne({
      where: {
        clubId: club.id,
        membershipId: membership.id,
        organizationId: membership.organizationId,
        status: ACTIVE,
      },
    });
    if (!access || access.roleOverride === 'owner') throw safeTenantDenial();
    effectiveRole = access.roleOverride || membershipRole;
  }

  return freezeTenantContext({
    ...baseContext,
    clubId: club.id,
    effectiveRole,
  });
}

function toDiscoveryClub(club, effectiveRole) {
  return {
    effectiveRole,
    id: club.id,
    name: club.name,
    slug: club.slug,
    timezone: club.timezone,
  };
}

async function discoverMemberships(accountId) {
  const memberships = await db.Membership.findAll({
    where: { accountId, status: ACTIVE },
    include: [
      {
        model: db.Organization,
        required: true,
        where: { status: ACTIVE },
      },
      {
        model: db.MembershipClubAccess,
        required: false,
        where: { status: ACTIVE },
        include: [
          {
            model: db.Club,
            required: true,
            where: { status: ACTIVE },
          },
        ],
      },
    ],
    order: [['organizationId', 'ASC'], ['id', 'ASC']],
  });

  const result = [];
  for (const membership of memberships) {
    let clubs;
    if (membership.role === 'owner') {
      const ownerClubs = await db.Club.findAll({
        where: { organizationId: membership.organizationId, status: ACTIVE },
        order: [['id', 'ASC']],
      });
      clubs = ownerClubs.map((club) => toDiscoveryClub(club, 'owner'));
    } else {
      clubs = (membership.MembershipClubAccesses || [])
        .filter((access) => access.Club && access.roleOverride !== 'owner')
        .sort((left, right) => left.Club.id - right.Club.id)
        .map((access) =>
          toDiscoveryClub(access.Club, access.roleOverride || membership.role),
        );
    }

    result.push({
      clubs,
      id: membership.id,
      organization: {
        id: membership.Organization.id,
        name: membership.Organization.name,
        slug: membership.Organization.slug,
      },
      role: membership.role,
    });
  }

  const firstMembershipWithClub = result.find((membership) => membership.clubs.length > 0);
  const firstClub = firstMembershipWithClub?.clubs[0] || null;
  const recommendedContext = firstMembershipWithClub && firstClub
    ? {
        clubId: firstClub.id,
        effectiveRole: firstClub.effectiveRole,
        membershipId: firstMembershipWithClub.id,
        organizationId: firstMembershipWithClub.organization.id,
      }
    : null;

  return {
    memberships: result,
    recommendedContext,
  };
}

module.exports = {
  discoverMemberships,
  isTrustedTenantContext,
  resolveTenantContext,
  safeTenantDenial,
};
