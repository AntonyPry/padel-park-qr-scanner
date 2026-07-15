#!/usr/bin/env node
'use strict';

require('dotenv').config();

const db = require('../models');
const {
  createConnection,
  generatePublicId,
  serializeConnection,
} = require('../src/provider-integrations/connection-service');
const {
  reconcileLegacyProviderRows,
} = require('../src/provider-integrations/rollout');
const {
  getExactDefaultTenant,
} = require('../src/files-workers/tenant-context');

function text(value) {
  const normalized = String(value || '').trim();
  return normalized || null;
}

function callbackForConnection(baseUrl, publicId) {
  const normalized = text(baseUrl);
  if (!normalized) return null;
  return normalized.includes(publicId)
    ? normalized
    : `${normalized.replace(/\/+$/u, '')}/${publicId}`;
}

function providerDefinitions() {
  const beelinePublicId = generatePublicId();
  return [
    {
      config: {
        apiBaseUrl: text(process.env.BEELINE_API_BASE_URL),
        apiTimeoutMs: Number(process.env.BEELINE_API_TIMEOUT_MS || 15000),
        callbackUrl: callbackForConnection(process.env.BEELINE_CALLBACK_URL, beelinePublicId),
        recordsPath: text(process.env.BEELINE_RECORDS_PATH) || '/records',
        statisticsPath: text(process.env.BEELINE_STATISTICS_PATH) || '/v2/statistics',
        subscriptionAutoRenewEnabled: ['1', 'true', 'yes', 'on'].includes(
          String(process.env.BEELINE_SUBSCRIPTION_AUTORENEW_ENABLED || '').toLowerCase(),
        ),
        subscriptionExpiresSeconds: Number(process.env.BEELINE_SUBSCRIPTION_EXPIRES || 3600),
        subscriptionPath: text(process.env.BEELINE_SUBSCRIPTION_PATH) || '/subscription',
        subscriptionPattern: text(process.env.BEELINE_SUBSCRIPTION_PATTERN),
        subscriptionRenewBeforeSeconds: Number(
          process.env.BEELINE_SUBSCRIPTION_RENEW_BEFORE_SECONDS || 600,
        ),
        subscriptionType: text(process.env.BEELINE_SUBSCRIPTION_TYPE) || 'BASIC_CALL',
      },
      provider: 'beeline',
      publicId: beelinePublicId,
      required: [
        process.env.BEELINE_API_BASE_URL,
        process.env.BEELINE_API_TOKEN,
        process.env.BEELINE_CALLBACK_URL,
        process.env.BEELINE_WEBHOOK_SECRET,
      ],
      secrets: {
        apiToken: process.env.BEELINE_API_TOKEN,
        webhookSecret: process.env.BEELINE_WEBHOOK_SECRET,
      },
    },
    {
      config: {},
      provider: 'evotor',
      publicId: generatePublicId(),
      required: [process.env.EVOTOR_WEBHOOK_SECRET],
      secrets: { webhookSecret: process.env.EVOTOR_WEBHOOK_SECRET },
    },
    {
      config: {},
      provider: 'telegram',
      publicId: generatePublicId(),
      required: [process.env.BOT_TOKEN],
      secrets: {
        botToken: process.env.BOT_TOKEN,
        ...(text(process.env.TG_PROXY_CREDS) ? { proxyUrl: process.env.TG_PROXY_CREDS } : {}),
      },
    },
    {
      config: {},
      provider: 'vk',
      publicId: generatePublicId(),
      required: [process.env.VK_TOKEN],
      secrets: { botToken: process.env.VK_TOKEN },
    },
  ];
}

async function main() {
  await db.sequelize.authenticate();
  const tenant = await getExactDefaultTenant();
  const results = [];
  for (const definition of providerDefinitions()) {
    if (definition.required.some((value) => !text(value))) {
      results.push({ action: 'skipped', provider: definition.provider, reason: 'not_configured' });
      continue;
    }
    const existing = await db.IntegrationConnection.findOne({
      where: {
        ...tenant,
        connectionKey: 'default',
        provider: definition.provider,
      },
    });
    if (existing) {
      const reconciliation = await reconcileLegacyProviderRows(serializeConnection(existing));
      results.push({
        action: 'exists',
        provider: definition.provider,
        publicId: existing.publicId,
        reconciliation,
      });
      continue;
    }
    const row = await createConnection({
      ...tenant,
      config: definition.config,
      metadata: { source: 'legacy_env_bootstrap' },
      provider: definition.provider,
      publicId: definition.publicId,
      secrets: definition.secrets,
    });
    const reconciliation = await reconcileLegacyProviderRows(serializeConnection(row));
    results.push({
      action: 'created',
      provider: definition.provider,
      publicId: row.publicId,
      reconciliation,
    });
  }
  console.log(JSON.stringify({ connections: results }, null, 2));
}

main()
  .catch((error) => {
    console.error('Provider connection bootstrap failed:', error.code || 'PROVIDER_BOOTSTRAP_FAILED');
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.sequelize.close();
  });
