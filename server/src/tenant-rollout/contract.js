'use strict';

const crypto = require('node:crypto');

const ROLLOUT_MAINTENANCE_ENV = 'SETLY_ROLLOUT_MAINTENANCE_MODE';
const ROLLOUT_MAINTENANCE_MODE = 'full-stop';
const BEELINE_CAPABILITY_CUTOVER_ENV = 'SETLY_BEELINE_CAPABILITY_CUTOVER_ENABLED';

const TENANT_ROLLOUT_STAGES = Object.freeze([
  Object.freeze({ id: 'context', env: 'TENANT_CONTEXT_ENABLED' }),
  Object.freeze({ id: 'cache-realtime', env: 'TENANT_CACHE_REALTIME_ENABLED' }),
  Object.freeze({ id: 'files-workers', env: 'TENANT_FILES_WORKERS_ENABLED' }),
  Object.freeze({ id: 'provider-integrations', env: 'TENANT_PROVIDER_INTEGRATIONS_ENABLED' }),
  Object.freeze({ id: 'staff-access', env: 'TENANT_STAFF_ACCESS_ENABLED' }),
  Object.freeze({ id: 'clients-references', env: 'TENANT_CLIENTS_REFERENCES_ENABLED' }),
  Object.freeze({ id: 'visits-scanner', env: 'TENANT_VISITS_SCANNER_ENABLED' }),
  Object.freeze({ id: 'client-bases-call-tasks', env: 'TENANT_CLIENT_BASES_CALL_TASKS_ENABLED' }),
  Object.freeze({ id: 'bookings-courts', env: 'TENANT_BOOKINGS_COURTS_ENABLED' }),
  Object.freeze({ id: 'methodology-skill-map', env: 'TENANT_METHODOLOGY_SKILL_MAP_ENABLED' }),
  Object.freeze({ id: 'training-notes-plans', env: 'TENANT_TRAINING_NOTES_PLANS_ENABLED' }),
  Object.freeze({ id: 'client-money-instruments', env: 'TENANT_CLIENT_MONEY_INSTRUMENTS_ENABLED' }),
  Object.freeze({ id: 'shifts-reports', env: 'TENANT_SHIFTS_REPORTS_ENABLED' }),
  Object.freeze({ id: 'audit-log', env: 'TENANT_AUDIT_LOG_ENABLED' }),
  Object.freeze({ id: 'onboarding', env: 'TENANT_ONBOARDING_ENABLED' }),
  Object.freeze({ id: 'enforcement', env: 'TENANT_ENFORCEMENT_ENABLED' }),
]);

const DISABLED_VALUES = new Set(['', '0', 'false', 'no', 'off']);
const ENABLED_VALUES = new Set(['1', 'true', 'yes', 'on']);

function parseExplicitBoolean(value) {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim().toLowerCase();
  if (DISABLED_VALUES.has(normalized)) return false;
  if (ENABLED_VALUES.has(normalized)) return true;
  return null;
}

function isRolloutMaintenanceActive(env = process.env) {
  return String(env[ROLLOUT_MAINTENANCE_ENV] || '').trim().toLowerCase() ===
    ROLLOUT_MAINTENANCE_MODE;
}

function validateRolloutMaintenanceConfiguration(env = process.env) {
  const value = String(env[ROLLOUT_MAINTENANCE_ENV] || '').trim().toLowerCase();
  if (DISABLED_VALUES.has(value) || value === ROLLOUT_MAINTENANCE_MODE) {
    return Object.freeze({ active: value === ROLLOUT_MAINTENANCE_MODE, value });
  }
  const error = new Error(
    `${ROLLOUT_MAINTENANCE_ENV} must be disabled or ${ROLLOUT_MAINTENANCE_MODE}`,
  );
  error.code = 'ROLLOUT_MAINTENANCE_CONFIGURATION_INVALID';
  error.statusCode = 503;
  throw error;
}

function validateBeelineCapabilityCutoverConfiguration(env = process.env) {
  const raw = env[BEELINE_CAPABILITY_CUTOVER_ENV];
  const enabled = raw === undefined || String(raw).trim() === ''
    ? false
    : parseExplicitBoolean(raw);
  if (enabled === null) {
    const error = new Error(`${BEELINE_CAPABILITY_CUTOVER_ENV} must be an explicit boolean`);
    error.code = 'BEELINE_CAPABILITY_CUTOVER_CONFIGURATION_INVALID';
    error.statusCode = 503;
    throw error;
  }
  if (enabled && !isRolloutMaintenanceActive(env)) {
    const error = new Error(
      `${BEELINE_CAPABILITY_CUTOVER_ENV} is allowed only during full-stop maintenance`,
    );
    error.code = 'BEELINE_CAPABILITY_CUTOVER_CONFIGURATION_INVALID';
    error.statusCode = 503;
    throw error;
  }
  return Object.freeze({ enabled });
}

function resolveRolloutStage(stageId) {
  if (stageId === 'schema-off') return -1;
  const index = TENANT_ROLLOUT_STAGES.findIndex((stage) => stage.id === stageId);
  if (index === -1) {
    const error = new Error(`Unknown tenant rollout stage: ${stageId}`);
    error.code = 'TENANT_ROLLOUT_STAGE_INVALID';
    throw error;
  }
  return index;
}

function evaluateCapabilityStage(env = process.env, stageId = 'schema-off') {
  const expectedThrough = resolveRolloutStage(stageId);
  const findings = [];
  const capabilities = TENANT_ROLLOUT_STAGES.map((stage, index) => {
    const raw = env[stage.env];
    const enabled = parseExplicitBoolean(raw);
    const expected = index <= expectedThrough;
    if (enabled === null) {
      findings.push({
        code: raw === undefined
          ? 'TENANT_ROLLOUT_FLAG_MISSING'
          : 'TENANT_ROLLOUT_FLAG_INVALID',
        env: stage.env,
        stage: stage.id,
      });
    } else if (enabled !== expected) {
      findings.push({
        code: expected
          ? 'TENANT_ROLLOUT_REQUIRED_FLAG_DISABLED'
          : 'TENANT_ROLLOUT_LATER_FLAG_ENABLED',
        env: stage.env,
        stage: stage.id,
      });
    }
    return Object.freeze({ enabled, env: stage.env, expected, stage: stage.id });
  });
  return Object.freeze({
    capabilities: Object.freeze(capabilities),
    findings: Object.freeze(findings),
    ok: findings.length === 0,
    stage: stageId,
  });
}

function digestJson(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

module.exports = {
  BEELINE_CAPABILITY_CUTOVER_ENV,
  ROLLOUT_MAINTENANCE_ENV,
  ROLLOUT_MAINTENANCE_MODE,
  TENANT_ROLLOUT_STAGES,
  digestJson,
  evaluateCapabilityStage,
  isRolloutMaintenanceActive,
  parseExplicitBoolean,
  resolveRolloutStage,
  validateRolloutMaintenanceConfiguration,
  validateBeelineCapabilityCutoverConfiguration,
};
