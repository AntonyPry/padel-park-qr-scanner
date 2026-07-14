const path = require('path');
const express = require('express');
const cors = require('cors');
const apiRoutes = require('./routes');
const { requestTiming } = require('./middleware/performance');
const telephonyController = require('./controllers/telephony.controller');
const {
  tenantFoundationGate,
} = require('./middleware/tenant-foundation-gate');

function createApp({ onTenantInitialized } = {}) {
  const app = express();

  app.set('onTenantInitialized', onTenantInitialized);
  app.use(cors());
  app.use(requestTiming);
  app.use('/api', tenantFoundationGate);
  app.post(
    '/api/integrations/beeline/events',
    express.text({ type: '*/*' }),
    telephonyController.receiveBeelineEvent,
  );
  app.use(express.json({ limit: '6mb' }));
  app.use(express.static(path.resolve(__dirname, '../public')));
  app.use('/api', apiRoutes);

  return app;
}

module.exports = createApp;
