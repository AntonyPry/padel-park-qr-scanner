const express = require('express');
const { requireAuth } = require('../middleware/auth');
const router = express.Router();

const authRoutes = require('./auth');
const webhookRoutes = require('./webhooks');
const financeRoutes = require('./finance');
const catalogRoutes = require('./catalog');
const accessRoutes = require('./access');
const accountsRoutes = require('./accounts');
const staffRoutes = require('./staff');
const shiftsRoutes = require('./shifts');
const utilizationRoutes = require('./utilization');
const visitsAnalyticsRoutes = require('./visits-analytics');
const motivationRoutes = require('./motivation');

router.use('/auth', authRoutes);
router.use('/webhooks', webhookRoutes);

router.use(requireAuth);
router.use('/finance', financeRoutes);
router.use('/catalog', catalogRoutes);
router.use(accessRoutes);
router.use(accountsRoutes);
router.use(staffRoutes);
router.use(shiftsRoutes);
router.use(utilizationRoutes);
router.use(visitsAnalyticsRoutes);
router.use(motivationRoutes);

module.exports = router;
