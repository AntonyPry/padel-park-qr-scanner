const express = require('express');
const utilizationController = require('../controllers/utilization.controller');
const { requireRole } = require('../middleware/auth');

const router = express.Router();
const viewUtilization = requireRole('owner', 'manager', 'accountant', 'viewer');
const manageUtilization = requireRole('owner', 'manager');

router.get('/utilization', viewUtilization, utilizationController.getAll);
router.post('/utilization', manageUtilization, utilizationController.upsert);

module.exports = router;
