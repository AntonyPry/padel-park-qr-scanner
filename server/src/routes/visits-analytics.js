const express = require('express');
const visitsAnalyticsController = require('../controllers/visits-analytics.controller');
const { requireRole } = require('../middleware/auth');

const router = express.Router();
const viewReports = requireRole('owner', 'manager', 'accountant', 'viewer');

router.get('/analytics/visits', viewReports, visitsAnalyticsController.getAnalytics);
router.get('/export/visits', viewReports, visitsAnalyticsController.exportVisits);

module.exports = router;
