const express = require('express');
const router = express.Router();
const managerControlDashboardController = require('../controllers/manager-control-dashboard.controller');
const { requireRole } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { ACCESS_MATRIX } = require('../constants/access-matrix');
const { apiSchemas } = require('../contracts/api-schemas');

const viewManagerControlDashboard = requireRole(
  ...ACCESS_MATRIX.managerControlDashboardView,
);

router.get(
  '/manager-control/dashboard',
  viewManagerControlDashboard,
  validate({ query: apiSchemas.managerControlDashboard.query }),
  managerControlDashboardController.getDashboard,
);

module.exports = router;
