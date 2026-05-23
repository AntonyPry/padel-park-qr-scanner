const express = require('express');
const router = express.Router();
const financeController = require('../controllers/finance.controller');
const { requireRole } = require('../middleware/auth');
const { ACCESS_MATRIX } = require('../constants/access-matrix');

const viewFinance = requireRole(...ACCESS_MATRIX.financeView);
const manageFinance = requireRole(...ACCESS_MATRIX.financeManage);
const exportFinance = requireRole(...ACCESS_MATRIX.financeExport);
const approvePayroll = requireRole(...ACCESS_MATRIX.payrollApprove);
const exportPayroll = requireRole(...ACCESS_MATRIX.payrollExport);
const payPayroll = requireRole(...ACCESS_MATRIX.payrollPay);
const reviewPayroll = requireRole(...ACCESS_MATRIX.payrollReview);
const viewPayroll = requireRole(...ACCESS_MATRIX.payrollView);

const managePayrollStatus = (req, res, next) => {
  const status = String(req.body?.status || '');
  if (status === 'approved') return approvePayroll(req, res, next);
  if (status === 'paid') return payPayroll(req, res, next);
  return reviewPayroll(req, res, next);
};

// URL: GET и POST /api/finance
router.get('/', viewFinance, financeController.getFinanceRecords);
router.post('/', manageFinance, financeController.addManualFinance);
router.get('/export', exportFinance, financeController.exportFinance);
router.get('/history', viewFinance, financeController.getFinanceHistory);

// URL: GET /api/finance/payroll
router.get('/payroll', viewPayroll, financeController.getPayroll);
router.get('/payroll/export', exportPayroll, financeController.exportPayroll);
router.get('/payroll/periods', viewPayroll, financeController.listPayrollPeriods);
router.post('/payroll/periods', reviewPayroll, financeController.createPayrollPeriod);
router.post(
  '/payroll/periods/:id/recalculate',
  reviewPayroll,
  financeController.recalculatePayrollPeriod,
);
router.patch(
  '/payroll/periods/:id/status',
  managePayrollStatus,
  financeController.updatePayrollPeriodStatus,
);

module.exports = router;
