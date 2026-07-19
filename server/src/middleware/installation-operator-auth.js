'use strict';

const installationOperatorAuth = require('../services/installation-operator-auth.service');
const { sendError } = require('../utils/api-error');

function requireInstallationOperator(req, res, next) {
  try {
    const authorization = String(req.headers.authorization || '');
    const [scheme, token] = authorization.split(/\s+/, 2);
    if (scheme !== 'Bearer' || !token) {
      return sendError(res, { statusCode: 401 }, 'Требуется вход оператора');
    }
    if (!installationOperatorAuth.verifySession(token)) {
      return sendError(res, { statusCode: 401 }, 'Сессия оператора недействительна');
    }
    next();
  } catch (error) {
    return sendError(res, error, 'Не удалось проверить оператора');
  }
}

module.exports = { requireInstallationOperator };
