const express = require('express');
const router = express.Router();
const prepaymentsDashboardController = require('../controllers/prepayments-dashboard.controller');
const { requireRole } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { ACCESS_MATRIX } = require('../constants/access-matrix');
const { apiSchemas } = require('../contracts/api-schemas');

const viewPrepaymentsDashboard = requireRole(
  ...ACCESS_MATRIX.prepaymentsDashboardView,
);

router.get(
  '/prepayments/dashboard',
  viewPrepaymentsDashboard,
  validate({ query: apiSchemas.prepaymentsDashboard.query }),
  prepaymentsDashboardController.getDashboard,
);

module.exports = router;
