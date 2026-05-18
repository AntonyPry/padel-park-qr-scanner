const express = require('express');
const visitsAnalyticsController = require('../controllers/visits-analytics.controller');
const { requireRole } = require('../middleware/auth');
const { ACCESS_MATRIX } = require('../constants/access-matrix');

const router = express.Router();
const viewReports = requireRole(...ACCESS_MATRIX.reportsView);

router.get('/analytics/visits', viewReports, visitsAnalyticsController.getAnalytics);
router.get('/export/visits', viewReports, visitsAnalyticsController.exportVisits);

module.exports = router;
