const path = require('path');
const express = require('express');
const apiRoutes = require('./routes');
const { requestTiming } = require('./middleware/performance');
const telephonyController = require('./controllers/telephony.controller');
const webhookController = require('./controllers/webhook.controller');
const {
  beelineCapabilityIngress,
  beelineConnectionFirstIngress,
  evotorConnectionFirstIngress,
  rejectLegacyBeelineIngress,
} = require('./middleware/provider-ingress');
const {
  tenantFoundationGate,
} = require('./middleware/tenant-foundation-gate');
const {
  attachRouteDeclaration,
  requireRouteClassification,
} = require('./middleware/tenant-context');
const {
  ENDPOINT_CLASSIFICATIONS,
} = require('./tenant-context/route-scope-declarations');
const {
  assertTenantCapabilityDependencies,
} = require('./tenant-context/capabilities');
const {
  CSP_REPORT_PATH,
  createBrowserCorsMiddleware,
  createSecurityHeadersMiddleware,
  discardCspReport,
} = require('./middleware/browser-security');
const {
  beelineCapabilityCutoverGate,
  rolloutMaintenanceGate,
} = require('./middleware/rollout-maintenance');
const {
  validateBeelineCapabilityCutoverConfiguration,
  validateRolloutMaintenanceConfiguration,
} = require('./tenant-rollout/contract');
const {
  validatePasswordHashingConfiguration,
} = require('./services/auth.service');
const {
  createAuthRateLimiter,
  SURFACES,
  validateAuthRateLimitConfiguration,
} = require('./services/auth-rate-limit.service');
const { limitProviderIngress } = require('./middleware/auth-rate-limit');
const {
  createBrowserOriginPolicy,
} = require('./security/browser-origin-policy');

function createApp({
  browserOriginPolicy,
  onIntegrationConnectionChanged,
  onTenantInitialized,
  publicDirectory = path.resolve(__dirname, '../public'),
} = {}) {
  assertTenantCapabilityDependencies();
  validateRolloutMaintenanceConfiguration();
  validateBeelineCapabilityCutoverConfiguration();
  validatePasswordHashingConfiguration();
  validateAuthRateLimitConfiguration();
  const originPolicy = browserOriginPolicy || createBrowserOriginPolicy();
  const authRateLimiter = createAuthRateLimiter();
  const app = express();

  app.set('authRateLimiter', authRateLimiter);
  app.set('onTenantInitialized', onTenantInitialized);
  app.set('onIntegrationConnectionChanged', onIntegrationConnectionChanged);
  app.set('browserOriginPolicy', originPolicy);
  app.use(createSecurityHeadersMiddleware(originPolicy));
  app.use(createBrowserCorsMiddleware(originPolicy));
  app.post(CSP_REPORT_PATH, rolloutMaintenanceGate, discardCspReport);
  app.use(requestTiming);
  const providerIngress = [
    attachRouteDeclaration,
    requireRouteClassification(ENDPOINT_CLASSIFICATIONS.PROVIDER_INGRESS),
  ];
  app.post(
    '/api/integrations/beeline/events/:connectionPublicId/:callbackToken',
    ...providerIngress,
    limitProviderIngress(SURFACES.PROVIDER_BEELINE_CAPABILITY),
    beelineCapabilityIngress,
    beelineCapabilityCutoverGate,
    express.text({ limit: '64kb', type: '*/*' }),
    telephonyController.receiveBeelineEvent,
  );
  app.post(
    '/api/integrations/beeline/events',
    ...providerIngress,
    limitProviderIngress(SURFACES.PROVIDER_BEELINE_LEGACY),
    rejectLegacyBeelineIngress,
  );
  app.use('/api', rolloutMaintenanceGate);
  app.use('/api', tenantFoundationGate);
  app.post(
    '/api/webhooks/evotor/:connectionPublicId',
    ...providerIngress,
    limitProviderIngress(SURFACES.PROVIDER_EVOTOR_CONNECTION),
    evotorConnectionFirstIngress,
    express.raw({ limit: '6mb', type: '*/*' }),
    webhookController.handleEvotor,
  );
  app.post(
    '/api/webhooks/evotor',
    ...providerIngress,
    limitProviderIngress(SURFACES.PROVIDER_EVOTOR_LEGACY),
    evotorConnectionFirstIngress,
    express.raw({ limit: '6mb', type: '*/*' }),
    webhookController.handleEvotor,
  );
  app.post(
    '/api/integrations/beeline/events/:connectionPublicId',
    ...providerIngress,
    limitProviderIngress(SURFACES.PROVIDER_BEELINE_CONNECTION),
    beelineConnectionFirstIngress,
    express.text({ limit: '64kb', type: '*/*' }),
    telephonyController.receiveBeelineEvent,
  );
  app.use(express.json({ limit: '6mb' }));
  app.use(express.static(publicDirectory));
  app.use('/api', apiRoutes);

  return app;
}

module.exports = createApp;
