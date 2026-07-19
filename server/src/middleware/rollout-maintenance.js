'use strict';

const {
  ROLLOUT_MAINTENANCE_MODE,
  isRolloutMaintenanceActive,
} = require('../tenant-rollout/contract');

const ALLOWED_API_PATHS = new Set(['/health', '/openapi.json']);

function rolloutMaintenanceGate(req, res, next) {
  if (
    !isRolloutMaintenanceActive() ||
    req.method === 'OPTIONS' ||
    ALLOWED_API_PATHS.has(req.path)
  ) {
    return next();
  }
  res.set('Retry-After', '60');
  return res.status(503).json({
    code: 'ROLLOUT_MAINTENANCE_ACTIVE',
    maintenanceMode: ROLLOUT_MAINTENANCE_MODE,
    message: 'Setly временно недоступна: выполняется безопасное обновление данных',
  });
}

module.exports = {
  ALLOWED_API_PATHS,
  rolloutMaintenanceGate,
};
