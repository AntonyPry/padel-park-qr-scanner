'use strict';

const {
  buildProviderNamespace,
} = require('../src/provider-integrations/idempotency');

const CONSTRAINTS = Object.freeze({
  callConnection: 'telephony_calls_connection_tenant_fk',
  callTenant: 'telephony_calls_tenant_club_fk',
  connectionClub: 'integration_connections_tenant_club_fk',
  rawConnection: 'telephony_raw_events_connection_tenant_fk',
  rawTenant: 'telephony_raw_events_tenant_club_fk',
  receiptConnection: 'receipts_integration_connection_tenant_fk',
  receiptTenant: 'receipts_tenant_club_fk',
  subscriptionConnection: 'telephony_subscriptions_connection_tenant_fk',
  subscriptionTenant: 'telephony_subscriptions_tenant_club_fk',
});

const TRIGGERS = Object.freeze({
  calls: 'telephony_calls_provider_attribution_immutable',
  connections: 'integration_connections_identity_immutable',
  rawEvents: 'telephony_raw_events_provider_attribution_immutable',
  receipts: 'receipts_provider_attribution_immutable',
  subscriptions: 'telephony_subscriptions_provider_attribution_immutable',
});

const BUSINESS_CONSTRAINTS = Object.freeze([
  ['TelephonyCalls', CONSTRAINTS.callTenant, CONSTRAINTS.callConnection],
  ['TelephonyRawEvents', CONSTRAINTS.rawTenant, CONSTRAINTS.rawConnection],
  ['TelephonySubscriptions', CONSTRAINTS.subscriptionTenant, CONSTRAINTS.subscriptionConnection],
  ['Receipts', CONSTRAINTS.receiptTenant, CONSTRAINTS.receiptConnection],
]);

async function removeConstraintIfPresent(queryInterface, table, name) {
  const constraints = await queryInterface.getForeignKeyReferencesForTable(table);
  if (constraints.some((constraint) => constraint.constraintName === name)) {
    await queryInterface.removeConstraint(table, name);
  }
}

async function replaceForeignKeys(queryInterface, onUpdate) {
  for (const [table, tenantName, connectionName] of BUSINESS_CONSTRAINTS) {
    await removeConstraintIfPresent(queryInterface, table, connectionName);
    await removeConstraintIfPresent(queryInterface, table, tenantName);
  }
  await removeConstraintIfPresent(
    queryInterface,
    'IntegrationConnections',
    CONSTRAINTS.connectionClub,
  );

  await queryInterface.addConstraint('IntegrationConnections', {
    fields: ['organizationId', 'clubId'],
    name: CONSTRAINTS.connectionClub,
    onDelete: 'RESTRICT',
    onUpdate,
    references: { table: 'Clubs', fields: ['organizationId', 'id'] },
    type: 'foreign key',
  });
  for (const [table, tenantName, connectionName] of BUSINESS_CONSTRAINTS) {
    await queryInterface.addConstraint(table, {
      fields: ['organizationId', 'clubId'],
      name: tenantName,
      onDelete: 'RESTRICT',
      onUpdate,
      references: { table: 'Clubs', fields: ['organizationId', 'id'] },
      type: 'foreign key',
    });
    await queryInterface.addConstraint(table, {
      fields: ['integrationConnectionId', 'organizationId', 'clubId'],
      name: connectionName,
      onDelete: 'RESTRICT',
      onUpdate,
      references: {
        table: 'IntegrationConnections',
        fields: ['id', 'organizationId', 'clubId'],
      },
      type: 'foreign key',
    });
  }
}

async function dropTriggers(queryInterface) {
  for (const name of Object.values(TRIGGERS)) {
    await queryInterface.sequelize.query(`DROP TRIGGER IF EXISTS ${name}`);
  }
}

function immutableSignal(message) {
  return `SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '${message}';`;
}

async function createTriggers(queryInterface) {
  const legacyNamespace = buildProviderNamespace(null);
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
         ) THEN
           ${immutableSignal('Telephony call provider attribution is immutable')}
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
         ) THEN
           ${immutableSignal('Raw event provider attribution is immutable')}
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
         ) THEN
           ${immutableSignal('Subscription provider attribution is immutable')}
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
         ) THEN
           ${immutableSignal('Receipt provider attribution is immutable')}
         END IF;
       END IF;
     END`,
  );
}

module.exports = {
  async up(queryInterface) {
    await replaceForeignKeys(queryInterface, 'RESTRICT');
    await dropTriggers(queryInterface);
    await createTriggers(queryInterface);
  },

  async down(queryInterface) {
    await dropTriggers(queryInterface);
    await replaceForeignKeys(queryInterface, 'CASCADE');
  },
};
