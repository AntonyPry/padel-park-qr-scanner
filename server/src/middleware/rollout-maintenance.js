'use strict';

const {
  BEELINE_CAPABILITY_CUTOVER_ENV,
  ROLLOUT_MAINTENANCE_MODE,
  isRolloutMaintenanceActive,
  validateBeelineCapabilityCutoverConfiguration,
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

function beelineCapabilityCutoverGate(req, res, next) {
  if (!isRolloutMaintenanceActive()) return next();
  const cutover = validateBeelineCapabilityCutoverConfiguration();
  if (cutover.enabled) return next();
  res.set('Retry-After', '60');
  return res.status(503).json({
    code: 'ROLLOUT_MAINTENANCE_ACTIVE',
    maintenanceMode: ROLLOUT_MAINTENANCE_MODE,
    message: 'Setly temporarily blocks provider callbacks during maintenance',
    requiredEnv: BEELINE_CAPABILITY_CUTOVER_ENV,
  });
}

module.exports = {
  ALLOWED_API_PATHS,
  beelineCapabilityCutoverGate,
  rolloutMaintenanceGate,
};
