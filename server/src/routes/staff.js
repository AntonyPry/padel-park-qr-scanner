const express = require('express');
const staffController = require('../controllers/staff.controller');
const { requireRole } = require('../middleware/auth');
const { ACCESS_MATRIX } = require('../constants/access-matrix');

const router = express.Router();
const viewStaff = requireRole(...ACCESS_MATRIX.staffView);
const manageStaff = requireRole(...ACCESS_MATRIX.staffManage);

router.get('/staff', viewStaff, staffController.getAll);
router.post('/staff', manageStaff, staffController.create);
router.put('/staff/:id', manageStaff, staffController.update);
router.delete('/staff/:id', manageStaff, staffController.remove);

module.exports = router;
