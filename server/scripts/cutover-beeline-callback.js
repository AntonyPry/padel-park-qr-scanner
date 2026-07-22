#!/usr/bin/env node
'use strict';

require('dotenv').config();

const db = require('../models');
const {
  resolveTenantConnection,
} = require('../src/provider-integrations/connection-service');
const {
  BEELINE_WEBHOOK_AUTH_MODES,
  buildCapabilityCallbackUrl,
  redactCapabilityValue,
} = require('../src/provider-integrations/beeline-callback');
const {
  getExactDefaultTenant,
} = require('../src/files-workers/tenant-context');
const {
  isRolloutMaintenanceActive,
  validateBeelineCapabilityCutoverConfiguration,
} = require('../src/tenant-rollout/contract');
const {
  subscribeToEvents,
} = require('../src/services/telephony.service');

function parseArgs(argv) {
  if (argv.length !== 1 || !['--apply', '--dry-run'].includes(argv[0])) {
    const error = new Error('Exactly one of --dry-run or --apply is required');
    error.code = 'BEELINE_CUTOVER_ARGUMENT_INVALID';
    throw error;
  }
  return { apply: argv[0] === '--apply' };
}

function assertCapabilityMode(connection) {
  if (connection.config.webhookAuthMode !== BEELINE_WEBHOOK_AUTH_MODES.CAPABILITY_URI) {
    const error = new Error('Beeline capability connection is required');
    error.code = 'BEELINE_CUTOVER_CONNECTION_INVALID';
    throw error;
  }
  return redactCapabilityValue(buildCapabilityCallbackUrl(connection));
}

async function cutoverBeelineCallback({ apply }, {
  resolveConnection = resolveTenantConnection,
  resolveTenant = getExactDefaultTenant,
  subscribe = subscribeToEvents,
} = {}) {
  if (apply) {
    const cutover = validateBeelineCapabilityCutoverConfiguration();
    if (!isRolloutMaintenanceActive() || !cutover.enabled) {
      const error = new Error('Beeline callback cutover requires the maintenance exception');
      error.code = 'BEELINE_CUTOVER_MAINTENANCE_REQUIRED';
      throw error;
    }
  }
  const tenant = await resolveTenant();
  const connection = await resolveConnection({
    connectionKey: 'default',
    provider: 'beeline',
    tenant,
  });
  const redactedCallbackUrl = assertCapabilityMode(connection);
  if (!apply) {
    return {
      action: 'dry-run',
      callbackUrl: redactedCallbackUrl,
      connectionPublicId: connection.publicId,
      status: 'ready',
    };
  }
  const subscription = redactCapabilityValue(
    await subscribe({}, tenant, connection),
    connection.secrets.callbackToken,
  );
  return {
    action: 'applied',
    callbackUrl: redactedCallbackUrl,
    connectionPublicId: connection.publicId,
    status: 'ok',
    subscriptionStatus: subscription?.status || 'unknown',
  };
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  await db.sequelize.authenticate();
  const result = await cutoverBeelineCallback(options);
  console.log(JSON.stringify(result, null, 2));
}

if (require.main === module) {
  main()
    .catch((error) => {
      console.error('Beeline callback cutover failed:', error.code || 'BEELINE_CUTOVER_FAILED');
      process.exitCode = 1;
    })
    .finally(async () => db.sequelize.close());
}

module.exports = {
  assertCapabilityMode,
  cutoverBeelineCallback,
  main,
  parseArgs,
};
