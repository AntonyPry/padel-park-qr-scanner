'use strict';

const {
  TENANT_FOUNDATION_STATES,
} = require('../tenant-foundation/constants');
const {
  getTenantFoundationGateState,
} = require('../services/tenant-foundation.service');

const PENDING_ALLOWLIST = new Set([
  'GET /health',
  'GET /auth/status',
  'POST /auth/bootstrap',
]);
const INVALID_DIAGNOSTIC_ALLOWLIST = new Set([
  'GET /health',
  'GET /auth/status',
  'POST /auth/bootstrap',
]);

function sendGateError(res, classification, code, message) {
  return res.status(503).json({
    code,
    details: classification.diagnostics,
    error: message,
    status: 503,
  });
}

async function tenantFoundationGate(req, res, next) {
  try {
    const classification = await getTenantFoundationGateState();
    req.tenantFoundation = classification;
    if (classification.state === TENANT_FOUNDATION_STATES.INITIALIZED) {
      return next();
    }

    const requestKey = `${req.method.toUpperCase()} ${req.path}`;
    if (
      classification.state === TENANT_FOUNDATION_STATES.BOOTSTRAP_PENDING &&
      PENDING_ALLOWLIST.has(requestKey)
    ) {
      return next();
    }
    if (
      classification.state === TENANT_FOUNDATION_STATES.INVALID &&
      INVALID_DIAGNOSTIC_ALLOWLIST.has(requestKey)
    ) {
      return next();
    }

    if (classification.state === TENANT_FOUNDATION_STATES.BOOTSTRAP_PENDING) {
      return sendGateError(
        res,
        classification,
        'BOOTSTRAP_REQUIRED',
        'Первичная настройка Setly еще не завершена',
      );
    }
    return sendGateError(
      res,
      classification,
      'TENANT_FOUNDATION_INVALID',
      'Состояние tenant foundation некорректно',
    );
  } catch (error) {
    return sendGateError(
      res,
      { diagnostics: { reasons: ['tenant foundation check failed'] } },
      'TENANT_FOUNDATION_UNAVAILABLE',
      'Не удалось проверить состояние tenant foundation',
    );
  }
}

module.exports = {
  INVALID_DIAGNOSTIC_ALLOWLIST,
  PENDING_ALLOWLIST,
  tenantFoundationGate,
};
