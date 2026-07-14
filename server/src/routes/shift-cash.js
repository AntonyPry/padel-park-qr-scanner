'use strict';

const express = require('express');
const shiftCashController = require('../controllers/shift-cash.controller');
const { requireRole } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { ACCESS_MATRIX } = require('../constants/access-matrix');
const { apiSchemas } = require('../contracts/api-schemas');

const router = express.Router();
const operateShift = requireRole(...ACCESS_MATRIX.shiftsOperate);
const manageShifts = requireRole(...ACCESS_MATRIX.shiftsManage);

router.get('/shifts/active/cash', operateShift, shiftCashController.getActive);
router.put(
  '/shifts/active/cash/opening',
  operateShift,
  validate({ body: apiSchemas.shiftCash.openingBody }),
  shiftCashController.saveOpening,
);
router.post(
  '/shifts/active/cash/expenses',
  operateShift,
  validate({ body: apiSchemas.shiftCash.expenseBody }),
  shiftCashController.createExpense,
);
router.put(
  '/shifts/active/cash/expenses/:expenseId',
  operateShift,
  validate({
    body: apiSchemas.shiftCash.expenseBody,
    params: apiSchemas.shiftCash.expenseParams,
  }),
  shiftCashController.updateExpense,
);
router.post(
  '/shifts/active/cash/expenses/:expenseId/cancel',
  operateShift,
  validate({
    body: apiSchemas.shiftCash.cancelBody,
    params: apiSchemas.shiftCash.expenseParams,
  }),
  shiftCashController.cancelExpense,
);
router.post(
  '/shifts/active/cash/expenses/:expenseId/attachments',
  operateShift,
  validate({
    body: apiSchemas.shiftCash.attachmentBody,
    params: apiSchemas.shiftCash.expenseParams,
  }),
  shiftCashController.uploadAttachment,
);
router.delete(
  '/shifts/active/cash/expenses/:expenseId/attachments/:attachmentId',
  operateShift,
  validate({ params: apiSchemas.shiftCash.attachmentParams }),
  shiftCashController.removeAttachment,
);
router.get(
  '/shifts/cash/expenses/:expenseId/attachments/:attachmentId',
  operateShift,
  validate({ params: apiSchemas.shiftCash.attachmentParams }),
  shiftCashController.getAttachment,
);
router.get(
  '/shifts/:shiftId/cash',
  manageShifts,
  validate({ params: apiSchemas.shiftCash.shiftParams }),
  shiftCashController.getByShift,
);

module.exports = router;
