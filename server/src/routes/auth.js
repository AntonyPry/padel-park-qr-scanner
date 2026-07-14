const express = require('express');
const authController = require('../controllers/auth.controller');
const { requireAuth } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { apiSchemas } = require('../contracts/api-schemas');
const {
  requireRouteClassification,
  resolveRequestTenant,
} = require('../middleware/tenant-context');
const { TENANT_SCOPES } = require('../tenant-context/route-scope-declarations');

const router = express.Router();

const globalEndpoint = requireRouteClassification(TENANT_SCOPES.GLOBAL);

router.get('/status', globalEndpoint, authController.status);
router.post('/bootstrap', globalEndpoint, validate(apiSchemas.auth.bootstrap), authController.bootstrap);
router.post('/login', globalEndpoint, validate(apiSchemas.auth.login), authController.login);
router.get('/me', globalEndpoint, requireAuth, resolveRequestTenant, authController.me);
router.get(
  '/me/memberships',
  globalEndpoint,
  requireAuth,
  resolveRequestTenant,
  authController.memberships,
);

module.exports = router;
