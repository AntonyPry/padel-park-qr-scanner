const express = require('express');
const router = express.Router();

const webhookRoutes = require('./webhooks');
const financeRoutes = require('./finance');
const catalogRoutes = require('./catalog');
// Сюда потом добавим users, catalog, analytics и т.д.

router.use('/webhooks', webhookRoutes);
router.use('/finance', financeRoutes);
router.use('/catalog', catalogRoutes);

module.exports = router;
