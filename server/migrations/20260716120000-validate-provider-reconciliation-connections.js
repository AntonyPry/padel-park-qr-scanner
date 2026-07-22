'use strict';

const {
  buildProviderNamespace,
} = require('../src/provider-integrations/idempotency');
const previousMigration = require('./20260716100000-harden-tenant-provider-integrations');

const TRIGGERS = Object.freeze({
  calls: 'telephony_calls_provider_attribution_immutable',
  connections: 'integration_connections_identity_immutable',
  rawEvents: 'telephony_raw_events_provider_attribution_immutable',
  receipts: 'receipts_provider_attribution_immutable',
  subscriptions: 'telephony_subscriptions_provider_attribution_immutable',
});

function immutableSignal(message) {
  return `SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '${message}';`;
}

function authoritativeConnectionExists({ provider, purpose }) {
  return `EXISTS (
             SELECT 1
             FROM IntegrationConnections AS authoritativeConnection
             WHERE authoritativeConnection.id = NEW.integrationConnectionId
               AND authoritativeConnection.organizationId = NEW.organizationId
               AND authoritativeConnection.clubId = NEW.clubId
               AND authoritativeConnection.provider = '${provider}'
               AND authoritativeConnection.purpose = '${purpose}'
               AND authoritativeConnection.connectionKey = 'default'
           )`;
}

async function dropTriggers(queryInterface) {
  for (const name of Object.values(TRIGGERS)) {
    await queryInterface.sequelize.query(`DROP TRIGGER IF EXISTS ${name}`);
  }
}

async function createValidatedTriggers(queryInterface) {
  const legacyNamespace = buildProviderNamespace(null);
  const beelineDefaultConnection = authoritativeConnectionExists({
    provider: 'beeline',
    purpose: 'telephony',
  });
  const evotorDefaultConnection = authoritativeConnectionExists({
    provider: 'evotor',
    purpose: 'point_of_sale',
  });

  await queryInterface.sequelize.query(
    `CREATE TRIGGER ${TRIGGERS.connections}
     BEFORE UPDATE ON IntegrationConnections
     FOR EACH ROW
     BEGIN
       IF NOT (OLD.publicId <=> NEW.publicId)
          OR NOT (OLD.organizationId <=> NEW.organizationId)
          OR NOT (OLD.clubId <=> NEW.clubId)
          OR NOT (OLD.provider <=> NEW.provider)
          OR NOT (OLD.purpose <=> NEW.purpose)
          OR NOT (OLD.connectionKey <=> NEW.connectionKey) THEN
         ${immutableSignal('Integration connection identity is immutable')}
       END IF;
     END`,
  );
  await queryInterface.sequelize.query(
    `CREATE TRIGGER ${TRIGGERS.calls}
     BEFORE UPDATE ON TelephonyCalls
     FOR EACH ROW
     BEGIN
       IF NOT (OLD.organizationId <=> NEW.organizationId)
          OR NOT (OLD.clubId <=> NEW.clubId) THEN
         ${immutableSignal('Telephony call tenant attribution is immutable')}
       END IF;
       IF NOT (OLD.integrationConnectionId <=> NEW.integrationConnectionId)
          OR NOT (OLD.providerNamespace <=> NEW.providerNamespace) THEN
         IF NOT (
           OLD.integrationConnectionId IS NULL
           AND NEW.integrationConnectionId IS NOT NULL
           AND OLD.providerNamespace = '${legacyNamespace}'
           AND NEW.providerNamespace IS NOT NULL
           AND ${beelineDefaultConnection}
         ) THEN
           ${immutableSignal('Telephony call provider attribution is immutable or connection contract is invalid')}
         END IF;
       END IF;
     END`,
  );
  await queryInterface.sequelize.query(
    `CREATE TRIGGER ${TRIGGERS.rawEvents}
     BEFORE UPDATE ON TelephonyRawEvents
     FOR EACH ROW
     BEGIN
       IF NOT (OLD.organizationId <=> NEW.organizationId)
          OR NOT (OLD.clubId <=> NEW.clubId) THEN
         ${immutableSignal('Raw event tenant attribution is immutable')}
       END IF;
       IF NOT (OLD.integrationConnectionId <=> NEW.integrationConnectionId)
          OR NOT (OLD.idempotencyKey <=> NEW.idempotencyKey) THEN
         IF NOT (
           OLD.integrationConnectionId IS NULL
           AND NEW.integrationConnectionId IS NOT NULL
           AND NOT (OLD.idempotencyKey <=> NEW.idempotencyKey)
           AND ${beelineDefaultConnection}
         ) THEN
           ${immutableSignal('Raw event provider attribution is immutable or connection contract is invalid')}
         END IF;
       END IF;
     END`,
  );
  await queryInterface.sequelize.query(
    `CREATE TRIGGER ${TRIGGERS.subscriptions}
     BEFORE UPDATE ON TelephonySubscriptions
     FOR EACH ROW
     BEGIN
       IF NOT (OLD.organizationId <=> NEW.organizationId)
          OR NOT (OLD.clubId <=> NEW.clubId) THEN
         ${immutableSignal('Subscription tenant attribution is immutable')}
       END IF;
       IF NOT (OLD.integrationConnectionId <=> NEW.integrationConnectionId)
          OR NOT (OLD.providerNamespace <=> NEW.providerNamespace) THEN
         IF NOT (
           OLD.integrationConnectionId IS NULL
           AND NEW.integrationConnectionId IS NOT NULL
           AND OLD.providerNamespace = '${legacyNamespace}'
           AND NEW.providerNamespace IS NOT NULL
           AND ${beelineDefaultConnection}
         ) THEN
           ${immutableSignal('Subscription provider attribution is immutable or connection contract is invalid')}
         END IF;
       END IF;
     END`,
  );
  await queryInterface.sequelize.query(
    `CREATE TRIGGER ${TRIGGERS.receipts}
     BEFORE UPDATE ON Receipts
     FOR EACH ROW
     BEGIN
       IF NOT (OLD.organizationId <=> NEW.organizationId)
          OR NOT (OLD.clubId <=> NEW.clubId) THEN
         ${immutableSignal('Receipt tenant attribution is immutable')}
       END IF;
       IF NOT (OLD.integrationConnectionId <=> NEW.integrationConnectionId)
          OR NOT (OLD.idempotencyKey <=> NEW.idempotencyKey) THEN
         IF NOT (
           OLD.integrationConnectionId IS NULL
           AND NEW.integrationConnectionId IS NOT NULL
           AND NOT (OLD.idempotencyKey <=> NEW.idempotencyKey)
           AND ${evotorDefaultConnection}
         ) THEN
           ${immutableSignal('Receipt provider attribution is immutable or connection contract is invalid')}
         END IF;
       END IF;
     END`,
  );
}

module.exports = {
  async up(queryInterface) {
    await dropTriggers(queryInterface);
    await createValidatedTriggers(queryInterface);
  },

  async down(queryInterface) {
    await previousMigration.up(queryInterface);
  },
};
