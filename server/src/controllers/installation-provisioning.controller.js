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
}

module.exports = new InstallationProvisioningController();
