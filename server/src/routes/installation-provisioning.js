'use strict';

const express = require('express');
const controller = require('../controllers/installation-provisioning.controller');
const {
  requireInstallationOperator,
} = require('../middleware/installation-operator-auth');
const { validate } = require('../middleware/validate');
const { apiSchemas } = require('../contracts/api-schemas');
const {
  requireRouteClassification,
} = require('../middleware/tenant-context');
const {
  TENANT_SCOPES,
} = require('../tenant-context/route-scope-declarations');

const router = express.Router();
const installationEndpoint = requireRouteClassification(TENANT_SCOPES.INSTALLATION);

router.get('/status', installationEndpoint, controller.status);
router.post(
  '/session',
  installationEndpoint,
  validate(apiSchemas.installationProvisioning.session),
  controller.session,
);
router.get(
  '/snapshot',
  installationEndpoint,
  requireInstallationOperator,
  controller.snapshot,
);

module.exports = router;
