'use strict';

const {
  getTenantFoundationGateState,
} = require('../services/tenant-foundation.service');
const {
  TENANT_FOUNDATION_STATES,
} = require('../tenant-foundation/constants');
const { opaqueComponent } = require('../storage/tenant-storage');

function contextError(
  message = 'Tenant-scoped resource was not found',
  statusCode = 404,
  code = 'TENANT_RESOURCE_NOT_FOUND',
) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function normalizeTenantIds(tenant) {
  const organizationId = Number(tenant?.organizationId);
  const clubId = Number(tenant?.clubId);
  if (!Number.isInteger(organizationId) || organizationId <= 0) {
    throw contextError('Tenant context is required', 400, 'TENANT_CONTEXT_REQUIRED');
  }
  if (!Number.isInteger(clubId) || clubId <= 0) {
    throw contextError('Club context is required', 400, 'TENANT_CONTEXT_REQUIRED');
  }
  return { clubId, organizationId };
}

async function getExactDefaultTenant() {
  const classification = await getTenantFoundationGateState();
  if (classification.state !== TENANT_FOUNDATION_STATES.INITIALIZED) {
    throw contextError(
      'Tenant foundation is not initialized',
      503,
      classification.state === TENANT_FOUNDATION_STATES.BOOTSTRAP_PENDING
        ? 'BOOTSTRAP_REQUIRED'
        : 'TENANT_FOUNDATION_INVALID',
    );
  }
  return {
    clubId: Number(classification.defaultClubId),
    organizationId: Number(classification.defaultOrganizationId),
  };
}

async function requireDefaultTenantContext(tenant) {
  const requested = normalizeTenantIds(tenant);
  const expected = await getExactDefaultTenant();
  if (
    requested.organizationId !== expected.organizationId ||
    requested.clubId !== expected.clubId
  ) {
    throw contextError();
  }
  return requested;
}

async function resolveTrustedTenantAttribution(tenant = null) {
  if (tenant) return requireDefaultTenantContext(tenant);
  return getExactDefaultTenant();
}

function tenantMatches(left, right) {
  if (!left || !right) return false;
  return (
    Number(left.organizationId) === Number(right.organizationId) &&
    Number(left.clubId) === Number(right.clubId)
  );
}

function tenantRoutingMetadata(tenant) {
  const normalized = normalizeTenantIds(tenant);
  return Object.freeze({
    clubId: normalized.clubId,
    clubKey: opaqueComponent('club', `${normalized.organizationId}:${normalized.clubId}`),
    organizationId: normalized.organizationId,
    organizationKey: opaqueComponent('org', normalized.organizationId),
  });
}

module.exports = {
  contextError,
  getExactDefaultTenant,
  normalizeTenantIds,
  requireDefaultTenantContext,
  resolveTrustedTenantAttribution,
  tenantMatches,
  tenantRoutingMetadata,
};
