const express = require('express');
const router = express.Router();
const financeController = require('../controllers/finance.controller');
const { requireRole } = require('../middleware/auth');
const { ACCESS_MATRIX } = require('../constants/access-matrix');

const viewFinance = requireRole(...ACCESS_MATRIX.financeView);
const manageFinance = requireRole(...ACCESS_MATRIX.financeManage);
const viewPayroll = requireRole(...ACCESS_MATRIX.payrollView);

// URL: GET и POST /api/finance
router.get('/', viewFinance, financeController.getFinanceRecords);
router.post('/', manageFinance, financeController.addManualFinance);

// URL: GET /api/finance/payroll
router.get('/payroll', viewPayroll, financeController.getPayroll);

module.exports = router;
