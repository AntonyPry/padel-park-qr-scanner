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
router.get(
  '/organizations/:organizationId',
  installationEndpoint,
  requireInstallationOperator,
  validate(apiSchemas.installationProvisioning.organization),
  controller.organization,
);
router.post(
  '/organizations',
  installationEndpoint,
  requireInstallationOperator,
  validate(apiSchemas.installationProvisioning.create),
  controller.create,
);
router.post(
  '/organizations/:organizationId/activation/reissue',
  installationEndpoint,
  requireInstallationOperator,
  validate(apiSchemas.installationProvisioning.reissue),
  controller.reissue,
);
router.post(
  '/activation/status',
  installationEndpoint,
  validate(apiSchemas.installationProvisioning.activationStatus),
  controller.activationStatus,
);
router.post(
  '/activation/consume',
  installationEndpoint,
  validate(apiSchemas.installationProvisioning.activate),
  controller.activate,
);

module.exports = router;
