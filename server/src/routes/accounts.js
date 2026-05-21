const express = require('express');
const accountsController = require('../controllers/accounts.controller');
const { requireRole } = require('../middleware/auth');
const { ACCESS_MATRIX } = require('../constants/access-matrix');

const router = express.Router();
const manageAccounts = requireRole(...ACCESS_MATRIX.systemUsersManage);

router.get('/accounts', manageAccounts, accountsController.getAll);
router.post('/accounts', manageAccounts, accountsController.create);
router.put('/accounts/:id', manageAccounts, accountsController.update);
router.post('/accounts/:id/restore', manageAccounts, accountsController.restore);
router.delete(
  '/accounts/:id/permanent',
  manageAccounts,
  accountsController.removeArchived,
);
router.delete('/accounts/:id', manageAccounts, accountsController.remove);

module.exports = router;
