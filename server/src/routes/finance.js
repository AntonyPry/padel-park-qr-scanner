const express = require('express');
const router = express.Router();
const financeController = require('../controllers/finance.controller');

// URL: GET и POST /api/finance
router.get('/', financeController.getFinanceRecords);
router.post('/', financeController.addManualFinance); // Этого не было в монолите, но я вижу, что клиент шлет POST

// URL: GET /api/finance/payroll
router.get('/payroll', financeController.getPayroll);

module.exports = router;
