const express = require('express');
const authController = require('../controllers/auth.controller');
const recoveryController = require('../controllers/account-recovery.controller');
const { requireAuth } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { limitCredentialEntry } = require('../middleware/auth-rate-limit');
const { SURFACES } = require('../services/auth-rate-limit.service');
const { apiSchemas } = require('../contracts/api-schemas');
const {
  requireRouteClassification,
  resolveRequestTenant,
} = require('../middleware/tenant-context');
const { TENANT_SCOPES } = require('../tenant-context/route-scope-declarations');

const router = express.Router();

const globalEndpoint = requireRouteClassification(TENANT_SCOPES.GLOBAL);

router.get('/status', globalEndpoint, authController.status);
router.post(
  '/bootstrap',
  globalEndpoint,
  limitCredentialEntry(SURFACES.AUTH_BOOTSTRAP),
  validate(apiSchemas.auth.bootstrap),
  authController.bootstrap,
);
router.post(
  '/login',
  globalEndpoint,
  limitCredentialEntry(SURFACES.AUTH_LOGIN),
  validate(apiSchemas.auth.login),
  authController.login,
);
router.post('/logout', globalEndpoint, authController.logout);
router.post('/recovery/status', globalEndpoint, limitCredentialEntry(SURFACES.AUTH_RECOVERY_USE), validate(apiSchemas.auth.recoveryStatus), recoveryController.status);
router.post('/recovery/reset', globalEndpoint, limitCredentialEntry(SURFACES.AUTH_RECOVERY_USE), validate(apiSchemas.auth.recoveryReset), recoveryController.reset);
router.get('/me', globalEndpoint, requireAuth, resolveRequestTenant, authController.me);
router.get(
  '/me/memberships',
  globalEndpoint,
  requireAuth,
  resolveRequestTenant,
  authController.memberships,
);

module.exports = router;
