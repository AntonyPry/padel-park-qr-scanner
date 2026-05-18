const express = require('express');
const utilizationController = require('../controllers/utilization.controller');
const { requireRole } = require('../middleware/auth');
const { ACCESS_MATRIX } = require('../constants/access-matrix');

const router = express.Router();
const viewUtilization = requireRole(...ACCESS_MATRIX.utilizationView);
const manageUtilization = requireRole(...ACCESS_MATRIX.utilizationManage);

router.get('/utilization', viewUtilization, utilizationController.getAll);
router.post('/utilization', manageUtilization, utilizationController.upsert);

module.exports = router;
