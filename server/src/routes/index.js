const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { auditMutations } = require('../middleware/audit');
const { captureTrainingMode } = require('../middleware/training-mode');
const db = require('../../models');
const cacheService = require('../services/cache.service');
const { getOpenApiDocument } = require('../contracts/openapi');
const router = express.Router();

const authRoutes = require('./auth');
const webhookRoutes = require('./webhooks');
const auditRoutes = require('./audit');
const bookingsRoutes = require('./bookings');
const callTasksRoutes = require('./call-tasks');
const financeRoutes = require('./finance');
const catalogRoutes = require('./catalog');
const accessRoutes = require('./access');
const accountsRoutes = require('./accounts');
const clientBasesRoutes = require('./client-bases');
const clientsRoutes = require('./clients');
const staffRoutes = require('./staff');
const shiftsRoutes = require('./shifts');
const utilizationRoutes = require('./utilization');
const visitsAnalyticsRoutes = require('./visits-analytics');
const motivationRoutes = require('./motivation');
const referencesRoutes = require('./references');
const trainingNotesRoutes = require('./training-notes');
const trainingPlansRoutes = require('./training-plans');
const trainingMethodologyRoutes = require('./training-methodology');
const telephonyRoutes = require('./telephony');
const onboardingRoutes = require('./onboarding');

router.get('/health', async (_req, res) => {
  const services = {
    cache: {
      configured: cacheService.isConfigured(),
      stats: cacheService.getStats(),
    },
    database: 'ok',
  };

  try {
    await db.sequelize.authenticate();
  } catch (error) {
    services.database = 'error';
    return res.status(503).json({
      services,
      status: 'degraded',
      timestamp: new Date().toISOString(),
      uptimeSec: Math.round(process.uptime()),
    });
  }

  return res.json({
    services,
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptimeSec: Math.round(process.uptime()),
  });
});

router.get('/openapi.json', (_req, res) => {
  res.json(getOpenApiDocument());
});

router.use('/auth', authRoutes);
router.use('/webhooks', webhookRoutes);

router.use(requireAuth);
router.use(captureTrainingMode());
router.use(auditMutations);
router.use(auditRoutes);
router.use(bookingsRoutes);
router.use('/finance', financeRoutes);
router.use('/catalog', catalogRoutes);
router.use(accessRoutes);
router.use(accountsRoutes);
router.use(callTasksRoutes);
router.use(clientBasesRoutes);
router.use(clientsRoutes);
router.use(staffRoutes);
router.use(shiftsRoutes);
router.use(utilizationRoutes);
router.use(visitsAnalyticsRoutes);
router.use(motivationRoutes);
router.use(referencesRoutes);
router.use(trainingNotesRoutes);
router.use(trainingPlansRoutes);
router.use(trainingMethodologyRoutes);
router.use(telephonyRoutes);
router.use(onboardingRoutes);

module.exports = router;
