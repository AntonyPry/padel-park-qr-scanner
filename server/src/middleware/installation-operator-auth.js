'use strict';

const installationOperatorAuth = require('../services/installation-operator-auth.service');
const { sendError } = require('../utils/api-error');

async function requireInstallationOperator(req, res, next) {
  try {
    const authorization = String(req.headers.authorization || '');
    const [scheme, token] = authorization.split(/\s+/, 2);
    if (scheme !== 'Bearer' || !token) {
      return sendError(res, { statusCode: 401 }, 'Требуется вход оператора');
    }
    const operator = await installationOperatorAuth.verifySession(token);
    if (!operator) {
      return sendError(res, { statusCode: 401 }, 'Сессия оператора недействительна');
    }
    req.installationOperator = operator;
    next();
  } catch (error) {
    return sendError(res, error, 'Не удалось проверить оператора');
  }
}

function requireInstallationManagement(_req, res, next) {
  try {
    installationOperatorAuth.assertManagementEnabled();
    next();
  } catch (error) {
    return sendError(res, error, 'Управление организациями и клубами недоступно');
  }
}

function requireInstallationProvisioning(_req, res, next) {
  try {
    installationOperatorAuth.assertProvisioningEnabled();
    next();
  } catch (error) {
    return sendError(res, error, 'Создание организаций недоступно');
  }
}

module.exports = {
  requireInstallationManagement,
  requireInstallationOperator,
  requireInstallationProvisioning,
};
