#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DOMAIN_AUDITS = Object.freeze([
  ['accounts', './audit-account-writes'],
  ['staff-memberships', './audit-staff-membership-writes'],
  ['clients-references', './audit-client-reference-writes'],
  ['visits-scanner', './audit-visit-scanner-writes'],
  ['client-bases-call-tasks', './audit-client-base-call-task-writes'],
  ['bookings-courts', './audit-booking-court-writes'],
  ['methodology-skill-map', './audit-methodology-skill-map-writes'],
  ['client-money', './audit-client-money-writes'],
  ['shifts-reports', './audit-shifts-reports-writes'],
  ['audit-log', './audit-audit-log-writes'],
  ['onboarding', './audit-onboarding-writes'],
]);
const LEGACY_CONTEXT_FILES = Object.freeze([
  'audit-access-context.service.js',
  'booking-access-context.service.js',
  'call-task-access-context.service.js',
  'client-access-context.service.js',
  'client-money-access-context.service.js',
  'methodology-access-context.service.js',
  'onboarding-access-context.service.js',
  'staff-access-context.service.js',
  'visit-access-context.service.js',
]);

function auditLegacyBridgeSources(serverRoot = path.resolve(__dirname, '..')) {
  const findings = [];
  for (const file of LEGACY_CONTEXT_FILES) {
    const relative = `src/services/${file}`;
    const source = fs.readFileSync(path.join(serverRoot, relative), 'utf8');
    if (!source.includes("require('../tenant-enforcement/legacy-singleton')")) {
      findings.push({ file: relative, type: 'legacy bridge lacks exact-singleton guard' });
    }
    if (/DEFAULT_(?:ORGANIZATION|CLUB)_SLUG/u.test(source)) {
      findings.push({ file: relative, type: 'legacy bridge performs local default lookup' });
    }
  }
  return findings;
}

function runFinalTenantEnforcementAudit() {
  const domains = DOMAIN_AUDITS.map(([name, modulePath]) => {
    const findings = require(modulePath).auditRepository();
    return { findings, name, ok: findings.length === 0 };
  });
  const cacheRealtimeFindings = require('./audit-tenant-cache-realtime').auditRepository();
  const filesWorkers = require('./audit-tenant-files-workers').runAudit();
  const providers = require('./audit-tenant-provider-integrations')
    .auditTenantProviderIntegrations();
  const routes = require('./audit-tenant-route-scopes').runTenantRouteScopeAudit();
  const legacyBridges = auditLegacyBridgeSources();
  const findings = [
    ...domains.flatMap((domain) => domain.findings.map((item) => ({
      ...item,
      audit: domain.name,
    }))),
    ...cacheRealtimeFindings.map((item) => ({ ...item, audit: 'cache-realtime' })),
    ...filesWorkers.findings.map((item) => ({ ...item, audit: 'files-workers' })),
    ...providers.failures.map((failure) => ({ audit: 'providers', failure })),
    ...(!routes.ok ? (routes.findings || routes.errors || [{ digest: routes.digest }]) : [])
      .map((item) => ({ ...item, audit: 'route-scopes' })),
    ...legacyBridges.map((item) => ({ ...item, audit: 'legacy-bridges' })),
  ];
  return {
    counts: {
      domainAudits: domains.length,
      filesWorkerInventory: filesWorkers.inventory.length,
      findings: findings.length,
      routeScopes: routes.counts,
    },
    domains: domains.map(({ findings: domainFindings, name, ok }) => ({
      findings: domainFindings.length,
      name,
      ok,
    })),
    findings,
    ok: findings.length === 0,
    schema: 'setly.final-tenant-enforcement-audit',
    schemaVersion: 1,
  };
}

if (require.main === module) {
  const report = runFinalTenantEnforcementAudit();
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.ok) process.exitCode = 1;
}

module.exports = {
  DOMAIN_AUDITS,
  LEGACY_CONTEXT_FILES,
  auditLegacyBridgeSources,
  runFinalTenantEnforcementAudit,
};
