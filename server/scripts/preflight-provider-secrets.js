#!/usr/bin/env node
'use strict';

require('dotenv').config();

const {
  assertIntegrationSecretConfiguration,
} = require('../src/provider-integrations/secrets');

try {
  const { keyVersion } = assertIntegrationSecretConfiguration({
    requireExplicitVersion: true,
  });
  console.log(JSON.stringify({ keyVersion, status: 'ok' }));
} catch (error) {
  console.error('Provider secret preflight failed:', error.code || 'INTEGRATION_SECRET_CONFIGURATION_INVALID');
  process.exitCode = 1;
}
