const express = require('express');
const visitsAnalyticsController = require('../controllers/visits-analytics.controller');
const { requireRole } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { ACCESS_MATRIX } = require('../constants/access-matrix');
const { apiSchemas } = require('../contracts/api-schemas');

const router = express.Router();
const viewReports = requireRole(...ACCESS_MATRIX.reportsView);

router.get('/analytics/visits', viewReports, validate({ query: apiSchemas.visitsAnalytics.dateRangeQuery }), visitsAnalyticsController.getAnalytics);
router.get('/export/visits', viewReports, validate({ query: apiSchemas.visitsAnalytics.dateRangeQuery }), visitsAnalyticsController.exportVisits);

module.exports = router;
