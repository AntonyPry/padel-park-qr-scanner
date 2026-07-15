#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

function read(relative) {
  return fs.readFileSync(path.join(ROOT, relative), 'utf8');
}

function auditTenantProviderIntegrations() {
  const failures = [];
  const requireText = (file, patterns) => {
    const source = read(file);
    for (const pattern of patterns) {
      if (!pattern.test(source)) failures.push(`${file} is missing ${pattern}`);
    }
  };

  requireText('models/IntegrationConnection.js', [
    /defaultScope/u,
    /exclude: \['secretCiphertext', 'secretKeyVersion'\]/u,
    /INTEGRATION_CONNECTION_IDENTITY_IMMUTABLE/u,
  ]);
  requireText('src/app.js', [
    /webhooks\/evotor\/:connectionPublicId/u,
    /integrations\/beeline\/events\/:connectionPublicId/u,
  ]);
  requireText('src/middleware/provider-ingress.js', [
    /resolveIngressConnection/u,
    /assertIngressSecret/u,
    /assertLegacyDownstreamReady/u,
    /req\.providerConnection = connection/u,
  ]);
  requireText('src/controllers/webhook.controller.js', [
    /parseEvotorBody/u,
    /withProviderConnectionLock/u,
  ]);
  requireText('src/services/telephony.service.js', [
    /resolveIngressConnection/u,
    /buildProviderIdempotencyKey/u,
    /maintainAllEventSubscriptions/u,
    /withProviderConnectionLock/u,
  ]);
  requireText('src/provider-integrations/secrets.js', [
    /aes-256-gcm/u,
    /setAAD/u,
    /setAuthTag/u,
  ]);
  requireText('src/provider-integrations/connection-service.js', [
    /normalizeSafeObject/u,
    /recordRejectedIngress/u,
    /PROVIDER_CONNECTION_REJECTED/u,
  ]);
  requireText('src/provider-integrations/locks.js', [
    /buildProviderNamespace/u,
    /GET_LOCK/u,
  ]);
  requireText('src/provider-integrations/runner.js', [
    /Promise\.all/u,
    /Provider connection task failed/u,
  ]);
  requireText('src/files-workers/background-run-context.js', [
    /CALL_TASKS_RECURRING[\s\S]*classification: 'deferred'/u,
    /TELEPHONY_SUBSCRIPTION[\s\S]*classification: 'provider-routed'/u,
  ]);

  const connectionSource = read('src/provider-integrations/connection-service.js');
  const serializationBody = connectionSource.match(
    /function serializeConnection\(row\) \{([\s\S]*?)\n\}/u,
  )?.[1] || '';
  for (const sensitive of ['secretCiphertext', 'secretKeyVersion', 'secrets']) {
    if (new RegExp(`\\b${sensitive}\\b`, 'u').test(serializationBody)) {
      failures.push(`serializeConnection exposes ${sensitive}`);
    }
  }

  return { failures, ok: failures.length === 0 };
}

if (require.main === module) {
  const result = auditTenantProviderIntegrations();
  if (!result.ok) {
    console.error(JSON.stringify(result, null, 2));
    process.exitCode = 1;
  } else {
    console.log('Tenant provider integrations audit passed');
  }
}

module.exports = { auditTenantProviderIntegrations };
