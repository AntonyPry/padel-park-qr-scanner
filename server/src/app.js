const path = require('path');
const express = require('express');
const cors = require('cors');
const apiRoutes = require('./routes');
const { requestTiming } = require('./middleware/performance');
const telephonyController = require('./controllers/telephony.controller');

function createApp() {
  const app = express();

  app.use(cors());
  app.use(requestTiming);
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
