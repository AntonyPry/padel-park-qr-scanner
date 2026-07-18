'use strict';

const crypto = require('crypto');

const TENANT_SCOPES = Object.freeze({
  CLUB: 'club',
  GLOBAL: 'global',
  MEMBERSHIP: 'membership',
  ORGANIZATION: 'organization',
});

const ENDPOINT_CLASSIFICATIONS = Object.freeze({
  PROVIDER_INGRESS: 'provider_ingress',
  WORKER: 'worker',
});

const GLOBAL_ENDPOINT_IDS = new Set([
  'system.health',
  'system.openapi',
  'auth.status',
  'auth.bootstrap',
  'auth.login',
  'auth.me',
  'auth.memberships',
]);

const PROVIDER_INGRESS_ENDPOINT_IDS = new Set([
  'telephony.beelineConnectionWebhook',
  'webhooks.evotor',
  'webhooks.evotorConnection',
  'telephony.beelineWebhook',
]);

const WORKER_ENDPOINT_IDS = new Set([
  'telephony.workerTranscriptionQueue',
  'telephony.claimTranscriptionJob',
  'telephony.transcriptionAudioReference',
  'telephony.updateTranscriptionProgress',
  'telephony.completeTranscriptionJob',
  'telephony.failTranscriptionJob',
  'telephony.workerRetryTranscriptionJob',
]);

const MEMBERSHIP_ENDPOINT_IDS = new Set([
  'onboarding.overview',
  'onboarding.taskDetail',
  'onboarding.completeTask',
  'onboarding.lessonRead',
  'onboarding.practiceStep',
  'onboarding.quizAttempt',
  'onboarding.resetProgress',
]);

const ORGANIZATION_ENDPOINT_IDS = new Set([
  'onboarding.metrics',
  'catalog.categories.list',
  'catalog.categories.create',
  'catalog.categories.update',
  'catalog.categories.restore',
  'catalog.categories.deletePermanent',
  'catalog.categories.archive',
  'subscriptions.types.list',
  'subscriptions.types.create',
  'subscriptions.types.update',
  'subscriptions.types.archive',
  'subscriptions.types.restore',
  'subscriptions.types.deletePermanent',
  'corporateClients.list',
  'corporateClients.create',
  'corporateClients.get',
  'corporateClients.update',
  'corporateClients.archive',
  'corporateClients.restore',
  'finance.payroll',
  'finance.payrollExport',
  'finance.payrollPeriods',
  'finance.payrollPeriodCreate',
  'finance.payrollRecalculate',
  'finance.payrollStatus',
  'motivation.rules',
  'motivation.bonusRules',
  'motivation.categories',
  'motivation.ruleUpdate',
  'motivation.assignCategory',
  'motivation.bonusRuleCreate',
  'motivation.bonusRuleUpdate',
  'motivation.bonusRuleDelete',
]);

const ORGANIZATION_ENDPOINT_PREFIXES = Object.freeze([
  'accounts.',
  'audit.',
  'references.',
  'staff.',
  'methodology.',
]);

const CLUB_ENDPOINT_PREFIXES = Object.freeze([
  'access.',
  'bookings.',
  'callTasks.',
  'certificates.',
  'clientBases.',
  'managerControl.',
  'prepayments.',
  'shiftCash.',
  'shiftReportTemplates.',
  'shiftReportTemplateItems.',
  'shiftReports.',
  'shifts.',
  'telephony.',
  'trainingNotes.',
  'trainingPlans.',
  'utilization.',
  'visitsAnalytics.',
]);

const CLUB_ENDPOINT_IDS = new Set([
  'onboarding.trainingMode',
  'onboarding.trainingModeUpdate',
  'onboarding.practiceStart',
  'onboarding.trainingData',
  'onboarding.trainingDataCleanup',
  'onboarding.recordEvent',
  'catalog.saleSettings.list',
  'catalog.saleSettings.save',
  'catalog.pendingSales.list',
  'catalog.pendingSales.link',
  'catalog.pendingSales.ignore',
  'catalog.pendingSales.cancel',
  'catalog.unmapped',
  'catalog.rules.list',
  'catalog.rules.create',
  'catalog.rules.restore',
  'catalog.rules.deletePermanent',
  'catalog.rules.archive',
  'subscriptions.client.list',
  'subscriptions.client.get',
  'subscriptions.client.redemptions',
  'subscriptions.client.redeem',
  'subscriptions.client.reverseRedemption',
  'corporateClients.ledger',
  'corporateClients.ledgerExport',
  'corporateClients.deposit',
  'corporateClients.depositCancel',
  'corporateClients.spending',
  'corporateClients.spendingReverse',
  'clients.views.list',
  'clients.views.create',
  'clients.views.update',
  'clients.views.delete',
  'clients.get',
  'clients.groupTrainingRecommendation',
  'clients.trainingRecommendation',
  'finance.report',
  'finance.manualCreate',
  'finance.export',
  'finance.history',
  'motivation.currentSales',
]);

const ORGANIZATION_CLIENT_ENDPOINT_IDS = new Set([
  'clients.list',
  'clients.lookup',
  'clients.duplicates',
  'clients.create',
  'clients.skillMap.list',
  'clients.skillMap.update',
  'clients.update',
  'clients.deletePermanent',
  'clients.merge',
]);

const EXPECTED_ROUTE_SCOPE_DIGEST =
  '669189de4b6d59b4525d1e00ef24b446b5924857a36958ef6019e8160a32e7f6';

function getEndpointTenantScope(endpointId) {
  if (GLOBAL_ENDPOINT_IDS.has(endpointId)) return TENANT_SCOPES.GLOBAL;
  if (PROVIDER_INGRESS_ENDPOINT_IDS.has(endpointId)) {
    return ENDPOINT_CLASSIFICATIONS.PROVIDER_INGRESS;
  }
  if (WORKER_ENDPOINT_IDS.has(endpointId)) {
    return ENDPOINT_CLASSIFICATIONS.WORKER;
  }
  if (MEMBERSHIP_ENDPOINT_IDS.has(endpointId)) return TENANT_SCOPES.MEMBERSHIP;
  if (
    ORGANIZATION_ENDPOINT_IDS.has(endpointId) ||
    ORGANIZATION_CLIENT_ENDPOINT_IDS.has(endpointId) ||
    ORGANIZATION_ENDPOINT_PREFIXES.some((prefix) => endpointId.startsWith(prefix))
  ) {
    return TENANT_SCOPES.ORGANIZATION;
  }
  if (
    CLUB_ENDPOINT_IDS.has(endpointId) ||
    CLUB_ENDPOINT_PREFIXES.some((prefix) => endpointId.startsWith(prefix)) ||
    endpointId.startsWith('catalog.') ||
    endpointId.startsWith('subscriptions.') ||
    endpointId.startsWith('corporateClients.') ||
    endpointId.startsWith('finance.') ||
    endpointId.startsWith('motivation.')
  ) {
    return TENANT_SCOPES.CLUB;
  }
  return null;
}

function calculateRouteScopeDigest(endpointContracts) {
  const rows = endpointContracts
    .map((endpoint) => {
      const scope = getEndpointTenantScope(endpoint.id);
      return `${endpoint.id}|${endpoint.method}|${endpoint.path}|${scope || 'UNDECLARED'}`;
    })
    .sort();
  return crypto.createHash('sha256').update(rows.join('\n')).digest('hex');
}

function auditEndpointScopeDeclarations(endpointContracts, options = {}) {
  const expectedDigest = options.expectedDigest ?? EXPECTED_ROUTE_SCOPE_DIGEST;
  const undeclared = endpointContracts
    .filter((endpoint) => !getEndpointTenantScope(endpoint.id))
    .map((endpoint) => endpoint.id);
  const duplicateKeys = [];
  const seen = new Set();

  for (const endpoint of endpointContracts) {
    const key = `${String(endpoint.method).toUpperCase()} ${endpoint.path}`;
    if (seen.has(key)) duplicateKeys.push(key);
    seen.add(key);
  }

  const digest = calculateRouteScopeDigest(endpointContracts);
  const digestMatches = !expectedDigest || expectedDigest === digest;
  return {
    digest,
    digestMatches,
    duplicateKeys,
    ok: undeclared.length === 0 && duplicateKeys.length === 0 && digestMatches,
    undeclared,
  };
}

module.exports = {
  ENDPOINT_CLASSIFICATIONS,
  EXPECTED_ROUTE_SCOPE_DIGEST,
  GLOBAL_ENDPOINT_IDS,
  PROVIDER_INGRESS_ENDPOINT_IDS,
  TENANT_SCOPES,
  WORKER_ENDPOINT_IDS,
  auditEndpointScopeDeclarations,
  calculateRouteScopeDigest,
  getEndpointTenantScope,
};
