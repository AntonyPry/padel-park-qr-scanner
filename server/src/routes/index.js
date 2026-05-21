const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { auditMutations } = require('../middleware/audit');
const router = express.Router();

const authRoutes = require('./auth');
const webhookRoutes = require('./webhooks');
const auditRoutes = require('./audit');
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

router.use('/auth', authRoutes);
router.use('/webhooks', webhookRoutes);

router.use(requireAuth);
router.use(auditMutations);
router.use(auditRoutes);
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

module.exports = router;
