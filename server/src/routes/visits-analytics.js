const express = require('express');
const visitsAnalyticsController = require('../controllers/visits-analytics.controller');
const { requireRole } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { ACCESS_MATRIX } = require('../constants/access-matrix');
const { apiSchemas } = require('../contracts/api-schemas');

const router = express.Router();
const viewReports = requireRole(...ACCESS_MATRIX.reportsView);
const manageClientBases = requireRole(...ACCESS_MATRIX.clientBasesManage);

router.get('/analytics/visits', viewReports, validate({ query: apiSchemas.visitsAnalytics.dateRangeQuery }), visitsAnalyticsController.getAnalytics);
router.get('/analytics/visits/source-quality', viewReports, validate({ query: apiSchemas.visitsAnalytics.sourceQualityQuery }), visitsAnalyticsController.getSourceQuality);
router.get('/analytics/visits/cohorts-lifecycle', viewReports, validate({ query: apiSchemas.visitsAnalytics.filteredDateRangeQuery }), visitsAnalyticsController.getCohortsLifecycle);
router.post('/analytics/visits/client-base-preview', manageClientBases, validate({ body: apiSchemas.visitsAnalytics.clientBasePreviewBody }), visitsAnalyticsController.previewClientBase);
router.post('/analytics/visits/client-bases', manageClientBases, validate({ body: apiSchemas.visitsAnalytics.clientBaseCreateBody }), visitsAnalyticsController.createClientBase);
router.get('/export/visits', viewReports, validate({ query: apiSchemas.visitsAnalytics.filteredDateRangeQuery }), visitsAnalyticsController.exportVisits);
router.get('/export/visits/source-quality', viewReports, validate({ query: apiSchemas.visitsAnalytics.sourceQualityQuery }), visitsAnalyticsController.exportSourceQuality);

module.exports = router;
