const express = require('express');
const staffController = require('../controllers/staff.controller');
const { requireRole } = require('../middleware/auth');

const router = express.Router();
const viewStaff = requireRole('owner', 'manager', 'accountant', 'viewer');
const manageStaff = requireRole('owner', 'manager');

router.get('/staff', viewStaff, staffController.getAll);
router.post('/staff', manageStaff, staffController.create);

module.exports = router;
