'use strict';

const { sendError } = require('../utils/api-error');
const tenantContextService = require('../services/tenant-context.service');
const {
  ENDPOINT_CLASSIFICATIONS,
  TENANT_SCOPES,
} = require('../tenant-context/route-scope-declarations');
const { resolveRouteDeclaration } = require('../tenant-context/route-registry');
const {
  isTenantContextEnabled,
  readBooleanEnv,
  tenantContextCapability,
} = require('../tenant-context/capabilities');
const {
  requireExactSingletonDefault,
} = require('../tenant-enforcement/legacy-singleton');

const ORGANIZATION_HEADER = 'x-organization-id';
const CLUB_HEADER = 'x-club-id';

function getRawHeaderValues(req, headerName) {
  const values = [];
  const rawHeaders = Array.isArray(req.rawHeaders) ? req.rawHeaders : [];
  for (let index = 0; index < rawHeaders.length; index += 2) {
    if (String(rawHeaders[index]).toLowerCase() === headerName) {
      values.push(String(rawHeaders[index + 1] ?? ''));
    }
  }

  if (values.length === 0) {
    const value = req.headers?.[headerName];
    if (Array.isArray(value)) return value.map(String);
    if (value !== undefined) values.push(String(value));
  }
  return values;
}

function parseRequiredTenantHeader(req, headerName, displayName) {
  const values = getRawHeaderValues(req, headerName);
  if (values.length === 0) {
    const error = new Error(`${displayName} обязателен для этого запроса`);
    error.statusCode = 400;
    error.code = 'TENANT_CONTEXT_REQUIRED';
    throw error;
  }
  if (values.length !== 1 || values[0].includes(',')) {
    const error = new Error(`${displayName} должен быть передан ровно один раз`);
    error.statusCode = 400;
    error.code = 'TENANT_CONTEXT_INVALID';
    throw error;
  }

  const raw = values[0].trim();
  if (!/^[1-9]\d*$/.test(raw)) {
    const error = new Error(`${displayName} должен быть положительным целым ID`);
    error.statusCode = 400;
    error.code = 'TENANT_CONTEXT_INVALID';
    throw error;
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    const error = new Error(`${displayName} должен быть положительным целым ID`);
    error.statusCode = 400;
    error.code = 'TENANT_CONTEXT_INVALID';
    throw error;
  }
  return value;
}

function defineImmutableTenant(req, tenant) {
  Object.defineProperty(req, 'tenant', {
    configurable: false,
    enumerable: true,
    value: Object.freeze(tenant),
    writable: false,
  });
}

function applyTenantAuthorizationAccount(req, tenant) {
  if (!req.account || tenant.scope === TENANT_SCOPES.GLOBAL) return;
  const authorizationRole =
    tenant.scope === TENANT_SCOPES.CLUB
      ? tenant.effectiveRole
      : tenant.membershipRole;
  const raw = req.account.toJSON ? req.account.toJSON() : { ...req.account };
  Object.defineProperty(raw, 'identityRole', {
    enumerable: false,
    value: req.account.role,
    writable: false,
  });
  raw.role = authorizationRole;
  req.identityAccount = req.account;
  req.account = Object.freeze(raw);
}

function attachRouteDeclaration(req, _res, next) {
  req.tenantRoute = resolveRouteDeclaration(req.method, req.originalUrl || req.path);
  next();
}

function requireRouteClassification(expectedClassification) {
  return (req, res, next) => {
    const declaration =
      req.tenantRoute || resolveRouteDeclaration(req.method, req.originalUrl || req.path);
    if (!declaration) {
      return sendError(
        res,
        {
          code: 'TENANT_SCOPE_UNDECLARED',
          statusCode: 500,
        },
        'Endpoint tenant scope is not declared',
      );
    }
    if (declaration.classification !== expectedClassification) {
      return sendError(
        res,
        {
          code: 'TENANT_SCOPE_CLASSIFICATION_INVALID',
          statusCode: 500,
        },
        'Endpoint tenant classification is invalid',
      );
    }
    req.tenantRoute = declaration;
    next();
  };
}

async function resolveRequestTenant(req, res, next) {
  try {
    const declaration =
      req.tenantRoute || resolveRouteDeclaration(req.method, req.originalUrl || req.path);
    if (!declaration) {
      return sendError(
        res,
        { code: 'TENANT_SCOPE_UNDECLARED', statusCode: 500 },
        'Endpoint tenant scope is not declared',
      );
    }
    req.tenantRoute = declaration;

    if (!isTenantContextEnabled()) {
      await requireExactSingletonDefault();
      return next();
    }
    if (!req.account?.id) {
      return sendError(res, { statusCode: 401 }, 'Unauthorized');
    }
    if (
      declaration.classification === ENDPOINT_CLASSIFICATIONS.PROVIDER_INGRESS ||
      declaration.classification === ENDPOINT_CLASSIFICATIONS.WORKER
    ) {
      return sendError(
        res,
        { code: 'TENANT_SCOPE_CLASSIFICATION_INVALID', statusCode: 500 },
        'Endpoint tenant classification is invalid',
      );
    }

    const scope = declaration.classification;
    const organizationId = scope === TENANT_SCOPES.GLOBAL
      ? null
      : parseRequiredTenantHeader(req, ORGANIZATION_HEADER, 'X-Organization-Id');
    const clubId = scope === TENANT_SCOPES.CLUB
      ? parseRequiredTenantHeader(req, CLUB_HEADER, 'X-Club-Id')
      : null;
    const tenant = await tenantContextService.resolveTenantContext({
      accountId: req.account.id,
      clubId,
      organizationId,
      scope,
    });
    defineImmutableTenant(req, tenant);
    applyTenantAuthorizationAccount(req, tenant);
    next();
  } catch (error) {
    return sendError(res, error, 'Не удалось проверить tenant context');
  }
}

module.exports = {
  attachRouteDeclaration,
  defineImmutableTenant,
  getRawHeaderValues,
  isTenantContextEnabled,
  parseRequiredTenantHeader,
  requireRouteClassification,
  resolveRequestTenant,
  tenantContextCapability,
};
