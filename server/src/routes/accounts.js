const express = require('express');
const accountsController = require('../controllers/accounts.controller');
const { requireRole } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { ACCESS_MATRIX } = require('../constants/access-matrix');
const { apiSchemas } = require('../contracts/api-schemas');

const router = express.Router();
const manageAccounts = requireRole(...ACCESS_MATRIX.systemUsersManage);

router.get('/accounts', manageAccounts, validate({ query: apiSchemas.accounts.listQuery }), accountsController.getAll);
router.post('/accounts', manageAccounts, validate({ body: apiSchemas.accounts.createBody }), accountsController.create);
router.put('/accounts/:id', manageAccounts, validate({ body: apiSchemas.accounts.body.partial().passthrough(), params: apiSchemas.accounts.params }), accountsController.update);
router.post('/accounts/:id/restore', manageAccounts, validate({ params: apiSchemas.accounts.params }), accountsController.restore);
router.delete(
  '/accounts/:id/permanent',
  manageAccounts,
  validate({ params: apiSchemas.accounts.params }),
  accountsController.removeArchived,
);
router.delete('/accounts/:id', manageAccounts, validate({ params: apiSchemas.accounts.params }), accountsController.remove);

module.exports = router;
