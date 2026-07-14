'use strict';

const { endpointContracts } = require('../contracts/openapi');
const {
  auditEndpointScopeDeclarations,
  getEndpointTenantScope,
} = require('./route-scope-declarations');

function normalizeRequestPath(value) {
  const raw = String(value || '/').split('?')[0] || '/';
  const withoutApi = raw === '/api' ? '/' : raw.replace(/^\/api(?=\/)/, '');
  return withoutApi.length > 1 ? withoutApi.replace(/\/+$/, '') : withoutApi;
}

function compilePath(path) {
  const normalized = normalizeRequestPath(path);
  const source = normalized
    .split('/')
    .map((segment) => {
      if (/^\{[^}]+\}$/.test(segment)) return '[^/]+';
      return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('/');
  return new RegExp(`^${source}/?$`);
}

const declarations = endpointContracts
  .map((endpoint) => ({
    classification: getEndpointTenantScope(endpoint.id),
    id: endpoint.id,
    method: String(endpoint.method).toUpperCase(),
    path: endpoint.path,
    pattern: compilePath(endpoint.path),
    public: Boolean(endpoint.public),
  }))
  .sort((left, right) => {
    const leftParams = (left.path.match(/\{/g) || []).length;
    const rightParams = (right.path.match(/\{/g) || []).length;
    return leftParams - rightParams || right.path.length - left.path.length;
  });

function resolveRouteDeclaration(method, path) {
  const normalizedMethod = String(method || '').toUpperCase();
  const normalizedPath = normalizeRequestPath(path);
  return (
    declarations.find(
      (entry) => entry.method === normalizedMethod && entry.pattern.test(normalizedPath),
    ) || null
  );
}

function assertRouteScopeRegistry() {
  const audit = auditEndpointScopeDeclarations(endpointContracts);
  if (!audit.ok) {
    const error = new Error('Tenant route scope manifest is incomplete or stale');
    error.code = 'TENANT_ROUTE_SCOPE_AUDIT_FAILED';
    error.details = audit;
    throw error;
  }
  return audit;
}

module.exports = {
  assertRouteScopeRegistry,
  declarations,
  normalizeRequestPath,
  resolveRouteDeclaration,
};
