const express = require('express');
const router = express.Router();
const financeController = require('../controllers/finance.controller');
const { requireRole } = require('../middleware/auth');

const viewFinance = requireRole('owner', 'manager', 'accountant', 'viewer');
const manageFinance = requireRole('owner', 'accountant');
const viewPayroll = requireRole('owner', 'manager', 'accountant', 'viewer');

// URL: GET и POST /api/finance
router.get('/', viewFinance, financeController.getFinanceRecords);
router.post('/', manageFinance, financeController.addManualFinance);

// URL: GET /api/finance/payroll
router.get('/payroll', viewPayroll, financeController.getPayroll);

module.exports = router;
