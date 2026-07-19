'use strict';

const installationOperatorAuth = require('../services/installation-operator-auth.service');
const installationProvisioning = require('../services/installation-provisioning.service');
const { sendError } = require('../utils/api-error');

class InstallationProvisioningController {
  status(_req, res) {
    res.json(installationOperatorAuth.getPublicStatus());
  }

  session(req, res) {
    try {
      res.json(installationOperatorAuth.createSession(req.body));
    } catch (error) {
      sendError(res, error, 'Не удалось войти как оператор');
    }
  }

  async snapshot(_req, res) {
    try {
      res.json(await installationProvisioning.getInstallationSnapshot());
    } catch (error) {
      sendError(res, error, 'Не удалось загрузить состояние установки');
    }
  }

  async create(req, res) {
    try {
      const result = await installationProvisioning.provisionOrganization(
        req.body,
        req.installationOperator,
      );
      const onTenantInitialized = req.app.get('onTenantInitialized');
      if (typeof onTenantInitialized === 'function') {
        try {
          await onTenantInitialized();
        } catch (error) {
          console.error('Не удалось обновить runtime после provisioning:', error);
        }
      }
      res.status(result.idempotency.replayed ? 200 : 201).json(result);
    } catch (error) {
      sendError(res, error, 'Не удалось создать организацию');
    }
  }

  async activationStatus(req, res) {
    try {
      res.json(await installationProvisioning.inspectActivation(req.body.token));
    } catch (error) {
      sendError(res, error, 'Не удалось проверить ссылку активации');
    }
  }

  async activate(req, res) {
    try {
      res.json(
        await installationProvisioning.activateOwner(
          req.body.token,
          req.body.password,
        ),
      );
    } catch (error) {
      sendError(res, error, 'Не удалось активировать аккаунт');
    }
  }

  async reissue(req, res) {
    try {
      res.json(
        await installationProvisioning.reissueActivation(
          req.params.organizationId,
          req.installationOperator,
        ),
      );
    } catch (error) {
      sendError(res, error, 'Не удалось перевыпустить ссылку активации');
    }
  }
}

module.exports = new InstallationProvisioningController();
