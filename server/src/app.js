const path = require('path');
const express = require('express');
const cors = require('cors');
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
  ONBOARDING_COMPLETED_TASKS_HEADER,
  ONBOARDING_PROGRESSED_TASKS_HEADER,
} = require('./middleware/onboarding-quest');
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

function createApp({ onIntegrationConnectionChanged, onTenantInitialized } = {}) {
  assertTenantCapabilityDependencies();
  validateRolloutMaintenanceConfiguration();
  validateBeelineCapabilityCutoverConfiguration();
  validatePasswordHashingConfiguration();
  const app = express();

  app.set('onTenantInitialized', onTenantInitialized);
  app.set('onIntegrationConnectionChanged', onIntegrationConnectionChanged);
  app.use(cors({
    exposedHeaders: [
      ONBOARDING_COMPLETED_TASKS_HEADER,
      ONBOARDING_PROGRESSED_TASKS_HEADER,
    ],
  }));
  app.use(requestTiming);
  const providerIngress = [
    attachRouteDeclaration,
    requireRouteClassification(ENDPOINT_CLASSIFICATIONS.PROVIDER_INGRESS),
  ];
  app.post(
    '/api/integrations/beeline/events/:connectionPublicId/:callbackToken',
    ...providerIngress,
    beelineCapabilityIngress,
    beelineCapabilityCutoverGate,
    express.text({ limit: '64kb', type: '*/*' }),
    telephonyController.receiveBeelineEvent,
  );
  app.post(
    '/api/integrations/beeline/events',
    ...providerIngress,
    rejectLegacyBeelineIngress,
  );
  app.use('/api', rolloutMaintenanceGate);
  app.use('/api', tenantFoundationGate);
  app.post(
    '/api/webhooks/evotor/:connectionPublicId',
    ...providerIngress,
    evotorConnectionFirstIngress,
    express.raw({ limit: '6mb', type: '*/*' }),
    webhookController.handleEvotor,
  );
  app.post(
    '/api/webhooks/evotor',
    ...providerIngress,
    evotorConnectionFirstIngress,
    express.raw({ limit: '6mb', type: '*/*' }),
    webhookController.handleEvotor,
  );
  app.post(
    '/api/integrations/beeline/events/:connectionPublicId',
    ...providerIngress,
    beelineConnectionFirstIngress,
    express.text({ limit: '64kb', type: '*/*' }),
    telephonyController.receiveBeelineEvent,
  );
  app.use(express.json({ limit: '6mb' }));
  app.use(express.static(path.resolve(__dirname, '../public')));
  app.use('/api', apiRoutes);

  return app;
}

module.exports = createApp;
