'use strict';

const express = require('express');
const controller = require('../controllers/installation-provisioning.controller');
const {
  requireInstallationManagement,
  requireInstallationOperator,
  requireInstallationProvisioning,
} = require('../middleware/installation-operator-auth');
const { validate } = require('../middleware/validate');
const { limitCredentialEntry } = require('../middleware/auth-rate-limit');
const { SURFACES } = require('../services/auth-rate-limit.service');
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
  limitCredentialEntry(SURFACES.INSTALLATION_OPERATOR_SESSION),
  validate(apiSchemas.installationProvisioning.session),
  controller.session,
);
router.post(
  '/session/revoke',
  installationEndpoint,
  requireInstallationOperator,
  validate(apiSchemas.installationProvisioning.sessionRevoke),
  controller.revokeSession,
);
router.get(
  '/snapshot',
  installationEndpoint,
  requireInstallationOperator,
  controller.snapshot,
);
router.put(
  '/organizations/:organizationId',
  installationEndpoint,
  requireInstallationOperator,
  requireInstallationManagement,
  validate(apiSchemas.installationProvisioning.organizationUpdate),
  controller.updateOrganization.bind(controller),
);
router.post(
  '/organizations/:organizationId/archive',
  installationEndpoint,
  requireInstallationOperator,
  requireInstallationManagement,
  validate(apiSchemas.installationProvisioning.organizationLifecycle),
  controller.archiveOrganization.bind(controller),
);
router.post(
  '/organizations/:organizationId/reactivate',
  installationEndpoint,
  requireInstallationOperator,
  requireInstallationManagement,
  validate(apiSchemas.installationProvisioning.organizationLifecycle),
  controller.reactivateOrganization.bind(controller),
);
router.put(
  '/organizations/:organizationId/clubs/:clubId',
  installationEndpoint,
  requireInstallationOperator,
  requireInstallationManagement,
  validate(apiSchemas.installationProvisioning.clubUpdate),
  controller.updateClub.bind(controller),
);
router.post(
  '/organizations/:organizationId/clubs/:clubId/archive',
  installationEndpoint,
  requireInstallationOperator,
  requireInstallationManagement,
  validate(apiSchemas.installationProvisioning.clubLifecycle),
  controller.archiveClub.bind(controller),
);
router.post(
  '/organizations/:organizationId/clubs/:clubId/reactivate',
  installationEndpoint,
  requireInstallationOperator,
  requireInstallationManagement,
  validate(apiSchemas.installationProvisioning.clubLifecycle),
  controller.reactivateClub.bind(controller),
);

const providerSchemas = Object.freeze({
  beeline: apiSchemas.installationProvisioning.integrationConfigureBeeline,
  evotor: apiSchemas.installationProvisioning.integrationConfigureEvotor,
  telegram: apiSchemas.installationProvisioning.integrationConfigureTelegram,
  vk: apiSchemas.installationProvisioning.integrationConfigureVk,
});
for (const [provider, schema] of Object.entries(providerSchemas)) {
  const integrationPath = `/organizations/:organizationId/clubs/:clubId/integrations/${provider}`;
  const withProvider = (handler) => (req, res, next) => {
    req.params.provider = provider;
    return handler.call(controller, req, res, next);
  };
  router.put(
    integrationPath,
    installationEndpoint,
    requireInstallationOperator,
    requireInstallationManagement,
    validate(schema),
    withProvider(controller.configureIntegration),
  );
  router.post(
    `${integrationPath}/credentials`,
    installationEndpoint,
    requireInstallationOperator,
    requireInstallationManagement,
    validate(provider === 'telegram'
      ? apiSchemas.installationProvisioning.integrationRotateTelegram
      : apiSchemas.installationProvisioning.integrationRotate),
    withProvider(controller.rotateIntegration),
  );
  router.post(
    `${integrationPath}/validate`,
    installationEndpoint,
    requireInstallationOperator,
    requireInstallationManagement,
    validate(apiSchemas.installationProvisioning.integrationAction),
    withProvider(controller.validateIntegration),
  );
  for (const action of ['activate', 'disable', 'revoke']) {
    router.post(
      `${integrationPath}/${action}`,
      installationEndpoint,
      requireInstallationOperator,
      requireInstallationManagement,
      validate(apiSchemas.installationProvisioning.integrationAction),
      (req, res, next) => {
        req.params.provider = provider;
        req.params.action = action;
        return controller.setIntegrationStatus(req, res, next);
      },
    );
  }
  if (['telegram', 'vk'].includes(provider)) {
    router.post(
      `${integrationPath}/restart`,
      installationEndpoint,
      requireInstallationOperator,
      requireInstallationManagement,
      validate(apiSchemas.installationProvisioning.integrationAction),
      (req, res, next) => {
        req.params.provider = provider;
        return controller.restartIntegration(req, res, next);
      },
    );
  }
  if (provider === 'beeline') {
    for (const action of ['check', 'renew', 'cutover']) {
      router.post(
        `${integrationPath}/${action}`,
        installationEndpoint,
        requireInstallationOperator,
        requireInstallationManagement,
        validate(apiSchemas.installationProvisioning.integrationAction),
        (req, res, next) => {
          req.params.provider = provider;
          req.params.action = action;
          return controller.beelineAction(req, res, next);
        },
      );
    }
  }
}
router.get(
  '/organizations/:organizationId',
  installationEndpoint,
  requireInstallationOperator,
  requireInstallationManagement,
  validate(apiSchemas.installationProvisioning.organization),
  controller.organization,
);
router.post(
  '/organizations',
  installationEndpoint,
  requireInstallationOperator,
  requireInstallationProvisioning,
  validate(apiSchemas.installationProvisioning.create),
  controller.create,
);
router.post(
  '/organizations/:organizationId/activation/reissue',
  installationEndpoint,
  requireInstallationOperator,
  requireInstallationProvisioning,
  validate(apiSchemas.installationProvisioning.reissue),
  controller.reissue,
);
router.post(
  '/activation/status',
  installationEndpoint,
  limitCredentialEntry(SURFACES.ACTIVATION_STATUS),
  validate(apiSchemas.installationProvisioning.activationStatus),
  controller.activationStatus,
);
router.post(
  '/activation/consume',
  installationEndpoint,
  limitCredentialEntry(SURFACES.ACTIVATION_CONSUME),
  validate(apiSchemas.installationProvisioning.activate),
  controller.activate,
);

module.exports = router;
