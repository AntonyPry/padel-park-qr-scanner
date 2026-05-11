const express = require('express');
const shiftsController = require('../controllers/shifts.controller');
const { requireRole } = require('../middleware/auth');

const router = express.Router();
const operateShift = requireRole('owner', 'manager', 'admin');
const manageShifts = requireRole('owner', 'manager');

router.get('/shifts/active', operateShift, shiftsController.getActive);
router.post('/shifts/start', operateShift, shiftsController.startActive);
router.post('/shifts/end', operateShift, shiftsController.endActive);
router.post('/shifts', manageShifts, shiftsController.create);
router.put('/shifts', manageShifts, shiftsController.update);
router.delete('/shifts', manageShifts, shiftsController.delete);

module.exports = router;
