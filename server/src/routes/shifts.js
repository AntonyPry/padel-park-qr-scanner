const express = require('express');
const shiftsController = require('../controllers/shifts.controller');
const { requireRole } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { ACCESS_MATRIX } = require('../constants/access-matrix');
const { apiSchemas } = require('../contracts/api-schemas');

const router = express.Router();
const operateShift = requireRole(...ACCESS_MATRIX.shiftsOperate);
const manageShifts = requireRole(...ACCESS_MATRIX.shiftsManage);

router.get('/shifts/active', operateShift, shiftsController.getActive);
router.post('/shifts/start', operateShift, shiftsController.startActive);
router.post(
  '/shifts/end',
  operateShift,
  validate({ body: apiSchemas.shifts.endBody }),
  shiftsController.endActive,
);
router.post('/shifts', manageShifts, validate({ body: apiSchemas.shifts.body }), shiftsController.create);
router.put('/shifts', manageShifts, validate({ body: apiSchemas.shifts.updateBody }), shiftsController.update);
router.delete('/shifts', manageShifts, validate({ body: apiSchemas.shifts.deleteBody }), shiftsController.delete);

module.exports = router;
