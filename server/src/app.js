const path = require('path');
const express = require('express');
const cors = require('cors');
const apiRoutes = require('./routes');
const { requestTiming } = require('./middleware/performance');
const telephonyController = require('./controllers/telephony.controller');
const {
  ONBOARDING_COMPLETED_TASKS_HEADER,
  ONBOARDING_PROGRESSED_TASKS_HEADER,
} = require('./middleware/onboarding-quest');

function createApp() {
  const app = express();

  app.use(cors({
    exposedHeaders: [
      ONBOARDING_COMPLETED_TASKS_HEADER,
      ONBOARDING_PROGRESSED_TASKS_HEADER,
    ],
  }));
  app.use(requestTiming);
  app.post(
    '/api/integrations/beeline/events',
    express.text({ type: '*/*' }),
    telephonyController.receiveBeelineEvent,
  );
  app.use(express.json());
  app.use(express.static(path.resolve(__dirname, '../public')));
  app.use('/api', apiRoutes);

  return app;
}

module.exports = createApp;
