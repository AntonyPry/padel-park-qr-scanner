#!/usr/bin/env node
'use strict';

require('dotenv').config();

const db = require('../models');
const {
  contextWithSecrets,
  createConnection,
  generatePublicId,
  serializeConnection,
} = require('../src/provider-integrations/connection-service');
const {
  BEELINE_WEBHOOK_AUTH_MODES,
  CALLBACK_TOKEN_PATTERN,
  generateCallbackToken,
} = require('../src/provider-integrations/beeline-callback');
const {
  canReconcileLegacyProviderRows,
  reconcileLegacyProviderRows,
} = require('../src/provider-integrations/rollout');
const {
  assertIntegrationSecretConfiguration,
  normalizeSecretBundle,
} = require('../src/provider-integrations/secrets');
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
  const beelineSharedSecret = text(process.env.BEELINE_WEBHOOK_SECRET);
  const beelineAuthMode = beelineSharedSecret
    ? BEELINE_WEBHOOK_AUTH_MODES.SHARED_SECRET_HEADER
    : BEELINE_WEBHOOK_AUTH_MODES.CAPABILITY_URI;
  const callbackBaseUrl = text(process.env.BEELINE_CALLBACK_URL);
  return [
    {
      config: {
        apiBaseUrl: text(process.env.BEELINE_API_BASE_URL),
        apiTimeoutMs: Number(process.env.BEELINE_API_TIMEOUT_MS || 15000),
        ...(beelineAuthMode === BEELINE_WEBHOOK_AUTH_MODES.CAPABILITY_URI
          ? { callbackBaseUrl }
          : { callbackUrl: callbackForConnection(callbackBaseUrl, beelinePublicId) }),
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
        webhookAuthMode: beelineAuthMode,
      },
      configurationSignals: [
        process.env.BEELINE_API_BASE_URL,
        process.env.BEELINE_API_TOKEN,
        process.env.BEELINE_CALLBACK_URL,
        process.env.BEELINE_WEBHOOK_SECRET,
      ],
      generateCallbackToken:
        beelineAuthMode === BEELINE_WEBHOOK_AUTH_MODES.CAPABILITY_URI,
      provider: 'beeline',
      publicId: beelinePublicId,
      required: [
        process.env.BEELINE_API_BASE_URL,
        process.env.BEELINE_API_TOKEN,
        process.env.BEELINE_CALLBACK_URL,
      ],
      secrets: {
        apiToken: process.env.BEELINE_API_TOKEN,
        ...(beelineSharedSecret ? { webhookSecret: beelineSharedSecret } : {}),
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

function definitionIsConfigured(definition) {
  return definition.required.every((value) => text(value));
}

function definitionConfigurationState(definition) {
  const signals = definition.configurationSignals || definition.required;
  const anySignal = signals.some((value) => text(value));
  if (!anySignal) return 'not_configured';
  return definitionIsConfigured(definition) ? 'configured' : 'incomplete';
}

function providerConfigurationError(provider) {
  const error = new Error(`Provider ${provider} configuration is invalid`);
  error.code = 'PROVIDER_CONFIGURATION_INCOMPLETE';
  error.provider = provider;
  return error;
}

function assertProviderUrl(value, { requireHttps = false } = {}) {
  let parsed;
  try {
    parsed = new URL(String(value || ''));
  } catch {
    throw providerConfigurationError('beeline');
  }
  if (
    !['http:', 'https:'].includes(parsed.protocol) ||
    (requireHttps && parsed.protocol !== 'https:') ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  ) {
    throw providerConfigurationError('beeline');
  }
  return parsed;
}

function assertBeelineDefinition(definition) {
  if (definition.provider !== 'beeline' || !definitionIsConfigured(definition)) return;
  const { config, secrets } = definition;
  const mode = config.webhookAuthMode;
  assertProviderUrl(config.apiBaseUrl);
  const callback = assertProviderUrl(
    mode === BEELINE_WEBHOOK_AUTH_MODES.CAPABILITY_URI
      ? config.callbackBaseUrl
      : config.callbackUrl,
    { requireHttps: true },
  );
  const numericContractIsValid =
    Number.isFinite(config.apiTimeoutMs) && config.apiTimeoutMs > 0 &&
    Number.isFinite(config.subscriptionExpiresSeconds) &&
      config.subscriptionExpiresSeconds > 0 &&
    Number.isFinite(config.subscriptionRenewBeforeSeconds) &&
      config.subscriptionRenewBeforeSeconds >= 0;
  const authContractIsValid = mode === BEELINE_WEBHOOK_AUTH_MODES.CAPABILITY_URI
    ? !text(secrets.webhookSecret)
    : mode === BEELINE_WEBHOOK_AUTH_MODES.SHARED_SECRET_HEADER &&
      Boolean(text(secrets.webhookSecret));
  if (
    (mode === BEELINE_WEBHOOK_AUTH_MODES.CAPABILITY_URI &&
      /\/ic_[a-f0-9]{32}(?:\/|$)/u.test(callback.pathname)) ||
    !numericContractIsValid ||
    !authContractIsValid ||
    (config.subscriptionAutoRenewEnabled && !text(config.subscriptionPattern))
  ) {
    throw providerConfigurationError('beeline');
  }
}

function preflightProviderDefinitions(definitions) {
  assertIntegrationSecretConfiguration({ requireExplicitVersion: true });
  for (const definition of definitions) {
    const state = definitionConfigurationState(definition);
    if (state === 'incomplete') {
      const error = new Error(`Provider ${definition.provider} configuration is incomplete`);
      error.code = 'PROVIDER_CONFIGURATION_INCOMPLETE';
      error.provider = definition.provider;
      throw error;
    }
    if (state === 'configured') {
      normalizeSecretBundle(definition.secrets);
      assertBeelineDefinition(definition);
    }
  }
  return definitions;
}

function providerRootConfigurationError(provider, count) {
  const error = new Error(`Historical ${provider} roots require a configured provider connection`);
  error.code = 'PROVIDER_HISTORICAL_ROOT_CONFIGURATION_INVALID';
  error.provider = provider;
  error.rootCount = count;
  return error;
}

async function collectLegacyProviderRootCounts({ models = db, tenant } = {}) {
  const replacements = {
    clubId: Number(tenant.clubId),
    organizationId: Number(tenant.organizationId),
  };
  const queries = {
    beeline: [
      'TelephonyCalls',
      'TelephonyRawEvents',
      'TelephonySubscriptions',
    ],
    evotor: ['Receipts'],
  };
  const counts = {};
  for (const [provider, tables] of Object.entries(queries)) {
    let count = 0;
    for (const table of tables) {
      const [rows] = await models.sequelize.query(
        `SELECT COUNT(*) AS count FROM ${table}
         WHERE organizationId=:organizationId AND clubId=:clubId
           AND integrationConnectionId IS NULL`,
        { replacements },
      );
      count += Number(rows[0]?.count || 0);
    }
    counts[provider] = count;
  }
  return Object.freeze(counts);
}

function assertHistoricalRootsConfigured(definitions, rootCounts) {
  for (const provider of ['beeline', 'evotor']) {
    const count = Number(rootCounts?.[provider] || 0);
    const definition = definitions.find((item) => item.provider === provider);
    if (count > 0 && (!definition || !definitionIsConfigured(definition))) {
      throw providerRootConfigurationError(provider, count);
    }
  }
}

function materializeDefinition(definition) {
  if (!definition.generateCallbackToken) return definition;
  return {
    ...definition,
    secrets: {
      ...definition.secrets,
      callbackToken: generateCallbackToken(),
    },
  };
}

function assertExistingBeelineConnection(row, definition) {
  if (definition.provider !== 'beeline') return;
  const connection = contextWithSecrets(row);
  const mode = connection.config.webhookAuthMode;
  if (mode !== definition.config.webhookAuthMode || !connection.secrets.apiToken) {
    throw providerRootConfigurationError('beeline', 0);
  }
  if (
    mode === BEELINE_WEBHOOK_AUTH_MODES.CAPABILITY_URI &&
    !CALLBACK_TOKEN_PATTERN.test(String(connection.secrets.callbackToken || ''))
  ) {
    throw providerRootConfigurationError('beeline', 0);
  }
  if (
    mode === BEELINE_WEBHOOK_AUTH_MODES.SHARED_SECRET_HEADER &&
    !text(connection.secrets.webhookSecret)
  ) {
    throw providerRootConfigurationError('beeline', 0);
  }
}

async function bootstrapProviderConnections({
  create = createConnection,
  definitions = providerDefinitions(),
  inspectRoots = collectLegacyProviderRootCounts,
  models = db,
  reconcile = reconcileLegacyProviderRows,
  reconcileAllowed = canReconcileLegacyProviderRows,
  resolveTenant = getExactDefaultTenant,
} = {}) {
  preflightProviderDefinitions(definitions);
  const tenant = await resolveTenant();
  const rootCounts = await inspectRoots({ models, tenant });
  assertHistoricalRootsConfigured(definitions, rootCounts);
  return models.sequelize.transaction(async (transaction) => {
    const results = [];
    for (const definition of definitions) {
      if (!definitionIsConfigured(definition)) {
        results.push({
          action: 'skipped',
          provider: definition.provider,
          reason: 'not_configured',
        });
        continue;
      }
      const connectionModel = typeof models.IntegrationConnection.unscoped === 'function'
        ? models.IntegrationConnection.unscoped()
        : models.IntegrationConnection;
      const existing = await connectionModel.findOne({
        transaction,
        where: {
          ...tenant,
          connectionKey: 'default',
          provider: definition.provider,
        },
      });
      if (existing) assertExistingBeelineConnection(existing, definition);
      const materialized = existing ? definition : materializeDefinition(definition);
      const row = existing || await create({
        ...tenant,
        config: materialized.config,
        metadata: { source: 'legacy_env_bootstrap' },
        provider: materialized.provider,
        publicId: materialized.publicId,
        secrets: materialized.secrets,
      }, { transaction });
      const reconciliation = reconcileAllowed(definition.provider)
        ? await reconcile(serializeConnection(row), { transaction })
        : {};
      results.push({
        action: existing ? 'exists' : 'created',
        provider: definition.provider,
        publicId: row.publicId,
        reconciliation,
      });
    }
    return results;
  });
}

async function main() {
  await db.sequelize.authenticate();
  const connections = await bootstrapProviderConnections();
  console.log(JSON.stringify({ connections }, null, 2));
}

if (require.main === module) {
  main()
    .catch((error) => {
      console.error('Provider connection bootstrap failed:', error.code || 'PROVIDER_BOOTSTRAP_FAILED');
      process.exitCode = 1;
    })
    .finally(async () => {
      await db.sequelize.close();
    });
}

module.exports = {
  assertBeelineDefinition,
  assertHistoricalRootsConfigured,
  bootstrapProviderConnections,
  collectLegacyProviderRootCounts,
  definitionIsConfigured,
  definitionConfigurationState,
  preflightProviderDefinitions,
  providerDefinitions,
};
