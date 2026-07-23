const express = require('express');
const accountsController = require('../controllers/accounts.controller');
const recoveryController = require('../controllers/account-recovery.controller');
const { requireRole } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { ACCESS_MATRIX } = require('../constants/access-matrix');
const { apiSchemas } = require('../contracts/api-schemas');
const { limitCredentialEntry } = require('../middleware/auth-rate-limit');
const { SURFACES } = require('../services/auth-rate-limit.service');

const router = express.Router();
const manageAccounts = requireRole(...ACCESS_MATRIX.systemUsersManage);
const recoverEmployee = requireRole('owner');

router.get('/accounts', manageAccounts, validate({ query: apiSchemas.accounts.listQuery }), accountsController.getAll);
router.post('/accounts', manageAccounts, validate({ body: apiSchemas.accounts.createBody }), accountsController.create);
router.put('/accounts/:id', manageAccounts, validate({ body: apiSchemas.accounts.body.partial(), params: apiSchemas.accounts.params }), accountsController.update);
router.post('/accounts/:id/restore', manageAccounts, validate({ params: apiSchemas.accounts.params }), accountsController.restore);
router.delete(
  '/accounts/:id/permanent',
  manageAccounts,
  validate({ params: apiSchemas.accounts.params }),
  accountsController.removeArchived,
);
router.delete('/accounts/:id', manageAccounts, validate({ params: apiSchemas.accounts.params }), accountsController.remove);
router.post('/accounts/:id/recovery', limitCredentialEntry(SURFACES.AUTH_RECOVERY_ISSUE), recoverEmployee, validate({ body: apiSchemas.accounts.recoveryRequest, params: apiSchemas.accounts.params }), (req, res) => {
  req.body.accountId = Number(req.params.id);
  return recoveryController.ownerCreate(req, res);
});
router.get('/accounts/:id/recovery', limitCredentialEntry(SURFACES.AUTH_RECOVERY_ISSUE), recoverEmployee, validate({ query: apiSchemas.accounts.recoveryQuery, params: apiSchemas.accounts.params }), recoveryController.ownerRequests);
router.post('/accounts/recovery/:requestId/issue', limitCredentialEntry(SURFACES.AUTH_RECOVERY_ISSUE), recoverEmployee, validate({ body: apiSchemas.accounts.recoveryAction, params: apiSchemas.accounts.recoveryRequestParams }), recoveryController.ownerIssue);
router.post('/accounts/recovery/:requestId/revoke', limitCredentialEntry(SURFACES.AUTH_RECOVERY_ISSUE), recoverEmployee, validate({ body: apiSchemas.accounts.recoveryAction, params: apiSchemas.accounts.recoveryRequestParams }), recoveryController.ownerRevoke);

module.exports = router;
