const path = require('path');
const express = require('express');
const cors = require('cors');
const apiRoutes = require('./routes');
const { requestTiming } = require('./middleware/performance');

function createApp() {
  const app = express();

  app.use(cors());
  app.use(requestTiming);
  app.use(express.json());
  app.use(express.static(path.resolve(__dirname, '../public')));
  app.use('/api', apiRoutes);

  return app;
}

module.exports = createApp;
