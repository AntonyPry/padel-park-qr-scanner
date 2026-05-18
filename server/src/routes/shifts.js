const express = require('express');
const shiftsController = require('../controllers/shifts.controller');
const { requireRole } = require('../middleware/auth');
const { ACCESS_MATRIX } = require('../constants/access-matrix');

const router = express.Router();
const operateShift = requireRole(...ACCESS_MATRIX.shiftsOperate);
const manageShifts = requireRole(...ACCESS_MATRIX.shiftsManage);

router.get('/shifts/active', operateShift, shiftsController.getActive);
router.post('/shifts/start', operateShift, shiftsController.startActive);
router.post('/shifts/end', operateShift, shiftsController.endActive);
router.post('/shifts', manageShifts, shiftsController.create);
router.put('/shifts', manageShifts, shiftsController.update);
router.delete('/shifts', manageShifts, shiftsController.delete);

module.exports = router;
