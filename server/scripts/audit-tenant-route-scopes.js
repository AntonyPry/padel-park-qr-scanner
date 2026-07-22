#!/usr/bin/env node
'use strict';

const { endpointContracts } = require('../src/contracts/openapi');
const {
  auditEndpointScopeDeclarations,
  getEndpointTenantScope,
} = require('../src/tenant-context/route-scope-declarations');

function runTenantRouteScopeAudit(contracts = endpointContracts) {
  const audit = auditEndpointScopeDeclarations(contracts);
  const counts = contracts.reduce((result, endpoint) => {
    const scope = getEndpointTenantScope(endpoint.id) || 'undeclared';
    result[scope] = (result[scope] || 0) + 1;
    return result;
  }, {});
  return { ...audit, counts };
}

if (require.main === module) {
  const result = runTenantRouteScopeAudit();
  console.log('Tenant route scope audit');
  console.log(`Digest: ${result.digest}`);
  Object.entries(result.counts)
    .sort(([left], [right]) => left.localeCompare(right))
    .forEach(([scope, count]) => console.log(`- ${scope}: ${count}`));
  if (!result.ok) {
    console.error(JSON.stringify(result, null, 2));
    process.exitCode = 1;
  }
}

module.exports = {
  runTenantRouteScopeAudit,
};
