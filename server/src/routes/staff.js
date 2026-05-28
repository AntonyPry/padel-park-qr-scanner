const express = require('express');
const staffController = require('../controllers/staff.controller');
const { requireRole } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { ACCESS_MATRIX } = require('../constants/access-matrix');
const { apiSchemas } = require('../contracts/api-schemas');

const router = express.Router();
const viewStaff = requireRole(...ACCESS_MATRIX.staffView);
const manageStaff = requireRole(...ACCESS_MATRIX.staffManage);

router.get('/staff', viewStaff, validate({ query: apiSchemas.staff.listQuery }), staffController.getAll);
router.post('/staff', manageStaff, validate({ body: apiSchemas.staff.body }), staffController.create);
router.put('/staff/:id', manageStaff, validate({ body: apiSchemas.staff.body, params: apiSchemas.staff.params }), staffController.update);
router.post('/staff/:id/restore', manageStaff, validate({ params: apiSchemas.staff.params }), staffController.restore);
router.delete(
  '/staff/:id/permanent',
  manageStaff,
  validate({ params: apiSchemas.staff.params }),
  staffController.removeArchived,
);
router.delete('/staff/:id', manageStaff, validate({ params: apiSchemas.staff.params }), staffController.remove);

module.exports = router;
