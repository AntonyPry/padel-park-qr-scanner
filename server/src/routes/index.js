const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { auditMutations } = require('../middleware/audit');
const { captureTrainingMode } = require('../middleware/training-mode');
const { realtimeMutations } = require('../realtime');
const { captureOnboardingQuest } = require('../middleware/onboarding-quest');
const db = require('../../models');
const cacheService = require('../services/cache.service');
const { getOpenApiDocument } = require('../contracts/openapi');
const {
  classifyTenantFoundation,
} = require('../services/tenant-foundation.service');
const {
  TENANT_FOUNDATION_STATES,
} = require('../tenant-foundation/constants');
const {
  attachRouteDeclaration,
  requireRouteClassification,
  resolveRequestTenant,
} = require('../middleware/tenant-context');
const { TENANT_SCOPES } = require('../tenant-context/route-scope-declarations');
const router = express.Router();

const authRoutes = require('./auth');
const auditRoutes = require('./audit');
const bookingsRoutes = require('./bookings');
const callTasksRoutes = require('./call-tasks');
const financeRoutes = require('./finance');
const catalogRoutes = require('./catalog');
const corporateClientsRoutes = require('./corporate-clients');
const accessRoutes = require('./access');
const accountsRoutes = require('./accounts');
const clientBasesRoutes = require('./client-bases');
const clientsRoutes = require('./clients');
const staffRoutes = require('./staff');
const shiftsRoutes = require('./shifts');
const shiftReportsRoutes = require('./shift-reports');
const shiftCashRoutes = require('./shift-cash');
const utilizationRoutes = require('./utilization');
const visitsAnalyticsRoutes = require('./visits-analytics');
const motivationRoutes = require('./motivation');
const referencesRoutes = require('./references');
const subscriptionRoutes = require('./subscriptions');
const certificateRoutes = require('./certificates');
const managerControlDashboardRoutes = require('./manager-control-dashboard');
const prepaymentsDashboardRoutes = require('./prepayments-dashboard');
const trainingNotesRoutes = require('./training-notes');
const trainingPlansRoutes = require('./training-plans');
const trainingMethodologyRoutes = require('./training-methodology');
const telephonyRoutes = require('./telephony');
const telephonyTranscriptionWorkerRoutes = require('./telephony-transcription-worker');
const onboardingRoutes = require('./onboarding');

router.use(attachRouteDeclaration);

const globalEndpoint = requireRouteClassification(TENANT_SCOPES.GLOBAL);

router.get('/health', globalEndpoint, async (_req, res) => {
  const services = {
    cache: {
      configured: cacheService.isConfigured(),
      stats: cacheService.getStats(),
    },
    database: 'ok',
  };

  try {
    await db.sequelize.authenticate();
    const classification = await classifyTenantFoundation();
    services.tenantFoundation = {
      counts: classification.counts,
      state: classification.state,
    };
    if (classification.state === TENANT_FOUNDATION_STATES.INVALID) {
      return res.status(503).json({
        bootstrapPending: false,
        services,
        status: 'degraded',
        tenantFoundationState: classification.state,
        timestamp: new Date().toISOString(),
        uptimeSec: Math.round(process.uptime()),
      });
    }
    const bootstrapPending =
      classification.state === TENANT_FOUNDATION_STATES.BOOTSTRAP_PENDING;
    return res.json({
      bootstrapPending,
      services,
      status: 'ok',
      tenantFoundationState: classification.state,
      timestamp: new Date().toISOString(),
      uptimeSec: Math.round(process.uptime()),
    });
  } catch (error) {
    services.database = 'error';
    return res.status(503).json({
      services,
      status: 'degraded',
      timestamp: new Date().toISOString(),
      uptimeSec: Math.round(process.uptime()),
    });
  }

});

router.get('/openapi.json', globalEndpoint, (_req, res) => {
  res.json(getOpenApiDocument());
});

router.use('/auth', authRoutes);
router.use(realtimeMutations());
router.use(telephonyTranscriptionWorkerRoutes);

router.use(requireAuth);
router.use(resolveRequestTenant);
router.use(captureTrainingMode());
router.use(captureOnboardingQuest());
router.use(auditMutations);
router.use(auditRoutes);
router.use(bookingsRoutes);
router.use('/finance', financeRoutes);
router.use('/catalog', catalogRoutes);
router.use(corporateClientsRoutes);
router.use(accessRoutes);
router.use(accountsRoutes);
router.use(callTasksRoutes);
router.use(clientBasesRoutes);
router.use(subscriptionRoutes);
router.use(certificateRoutes);
router.use(managerControlDashboardRoutes);
router.use(prepaymentsDashboardRoutes);
router.use(clientsRoutes);
router.use(staffRoutes);
router.use(shiftReportsRoutes);
router.use(shiftCashRoutes);
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
