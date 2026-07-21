'use strict';

const db = require('../../models');
const { createTelegramBot } = require('../bots/telegram');
const { createVkBot } = require('../bots/vk');
const { listActiveConnections } = require('./connection-service');
const { credentialFingerprint } = require('./fingerprints');
const { assertLegacyDownstreamReady } = require('./runtime');

function runnerKey({ clubId, organizationId, provider }) {
  return `${provider}:${Number(organizationId)}:${Number(clubId)}`;
}

function duplicateError(provider) {
  const error = new Error(`Duplicate ${provider} bot authority`);
  error.code = 'INTEGRATION_CREDENTIAL_DUPLICATE';
  error.statusCode = 409;
  return error;
}

class BotRunnerRegistry {
  constructor({
    factories = {
      telegram: (connection) => createTelegramBot({
        connection,
        proxyUrl: connection.secrets.proxyUrl,
        token: connection.secrets.botToken,
      }),
      vk: (connection) => createVkBot({
        connection,
        token: connection.secrets.botToken,
      }),
    },
    assertReady = assertLegacyDownstreamReady,
    listConnections = listActiveConnections,
    listIdentityRows = (provider) => db.IntegrationConnection.unscoped().findAll({
      attributes: ['id', 'providerIdentityFingerprint'],
      where: { provider, status: 'active' },
    }),
  } = {}) {
    this.assertReady = assertReady;
    this.factories = factories;
    this.listConnections = listConnections;
    this.listIdentityRows = listIdentityRows;
    this.runners = new Map();
  }

  async assertUniqueActive(provider, connections) {
    const credentialFingerprints = new Set();
    for (const connection of connections) {
      if (connection.configurationError) continue;
      const fingerprint = credentialFingerprint(provider, connection.secrets.botToken);
      if (credentialFingerprints.has(fingerprint)) throw duplicateError(provider);
      credentialFingerprints.add(fingerprint);
    }
    const identityRows = await this.listIdentityRows(provider);
    const identities = new Set();
    for (const row of identityRows) {
      if (!row.providerIdentityFingerprint) continue;
      if (identities.has(row.providerIdentityFingerprint)) throw duplicateError(provider);
      identities.add(row.providerIdentityFingerprint);
    }
  }

  async startConnection(connection) {
    const key = runnerKey(connection);
    if (this.runners.has(key)) return this.runners.get(key);
    await this.assertReady(connection);
    const instance = this.factories[connection.provider]?.(connection);
    if (!instance) throw new Error('Provider runner is not configured');
    await instance.start();
    const handle = Object.freeze({ connection, instance, key });
    this.runners.set(key, handle);
    return handle;
  }

  async stopKey(key) {
    const current = this.runners.get(key);
    if (!current) return false;
    this.runners.delete(key);
    try {
      await current.instance.stop?.();
    } catch {
      console.error('BOT_CONNECTION_STOP_FAILED', current.connection.publicId);
    }
    return true;
  }

  async startProvider(provider) {
    const connections = await this.listConnections({ provider });
    await this.assertUniqueActive(provider, connections);
    const results = [];
    for (const connection of connections) {
      try {
        if (connection.configurationError) throw new Error('Connection configuration is invalid');
        await this.startConnection(connection);
        results.push({ publicId: connection.publicId, status: 'started' });
      } catch {
        console.error(`${provider.toUpperCase()}_CONNECTION_START_FAILED`, connection.publicId);
        results.push({ publicId: connection.publicId, status: 'failed' });
      }
    }
    return results;
  }

  async reconcile(scope) {
    const provider = String(scope.provider);
    if (!['telegram', 'vk'].includes(provider)) return { action: 'not_applicable' };
    const key = runnerKey(scope);
    await this.stopKey(key);
    const connections = await this.listConnections({ provider });
    await this.assertUniqueActive(provider, connections);
    const target = connections.find((connection) =>
      Number(connection.organizationId) === Number(scope.organizationId) &&
      Number(connection.clubId) === Number(scope.clubId));
    if (!target || target.configurationError) return { action: 'stopped' };
    await this.startConnection(target);
    return { action: 'restarted', publicId: target.publicId };
  }

  async stopAll() {
    for (const key of [...this.runners.keys()]) await this.stopKey(key);
  }

  snapshot() {
    return [...this.runners.values()].map(({ connection, key }) => ({
      clubId: connection.clubId,
      key,
      organizationId: connection.organizationId,
      provider: connection.provider,
      publicId: connection.publicId,
    }));
  }
}

module.exports = { BotRunnerRegistry, runnerKey };
