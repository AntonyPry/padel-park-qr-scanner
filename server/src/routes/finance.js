const express = require('express');
const router = express.Router();
const financeController = require('../controllers/finance.controller');
const { requireRole } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { ACCESS_MATRIX } = require('../constants/access-matrix');
const { apiSchemas } = require('../contracts/api-schemas');

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
router.get('/', viewFinance, validate({ query: apiSchemas.finance.dateRangeQuery }), financeController.getFinanceRecords);
router.post('/', manageFinance, validate({ body: apiSchemas.finance.manualBody }), financeController.addManualFinance);
router.get('/export', exportFinance, validate({ query: apiSchemas.finance.dateRangeQuery }), financeController.exportFinance);
router.get('/history', viewFinance, validate({ query: apiSchemas.finance.historyQuery }), financeController.getFinanceHistory);

// URL: GET /api/finance/payroll
router.get('/payroll', viewPayroll, validate({ query: apiSchemas.finance.dateRangeQuery }), financeController.getPayroll);
router.get('/payroll/export', exportPayroll, validate({ query: apiSchemas.finance.dateRangeQuery }), financeController.exportPayroll);
router.get('/payroll/periods', viewPayroll, validate({ query: apiSchemas.finance.dateRangeQuery }), financeController.listPayrollPeriods);
router.post('/payroll/periods', reviewPayroll, validate({ body: apiSchemas.finance.payrollPeriodBody }), financeController.createPayrollPeriod);
router.post(
  '/payroll/periods/:id/recalculate',
  reviewPayroll,
  validate({
    body: apiSchemas.finance.recalculateBody,
    params: apiSchemas.finance.withId.params,
  }),
  financeController.recalculatePayrollPeriod,
);
router.patch(
  '/payroll/periods/:id/status',
  validate({
    body: apiSchemas.finance.payrollStatusBody,
    params: apiSchemas.finance.withId.params,
  }),
  managePayrollStatus,
  financeController.updatePayrollPeriodStatus,
);

module.exports = router;
