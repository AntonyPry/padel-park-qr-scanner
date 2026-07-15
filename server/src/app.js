const path = require('path');
const express = require('express');
const cors = require('cors');
const apiRoutes = require('./routes');
const { requestTiming } = require('./middleware/performance');
const telephonyController = require('./controllers/telephony.controller');
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

function createApp({ onTenantInitialized } = {}) {
  assertTenantCapabilityDependencies();
  const app = express();

  app.set('onTenantInitialized', onTenantInitialized);
  app.use(cors());
  app.use(requestTiming);
  app.use('/api', tenantFoundationGate);
  app.post(
    '/api/integrations/beeline/events',
    express.text({ type: '*/*' }),
    attachRouteDeclaration,
    requireRouteClassification(ENDPOINT_CLASSIFICATIONS.PROVIDER_INGRESS),
    telephonyController.receiveBeelineEvent,
  );
  app.use(express.json({ limit: '6mb' }));
  app.use(express.static(path.resolve(__dirname, '../public')));
  app.use('/api', apiRoutes);

  return app;
}

module.exports = createApp;
