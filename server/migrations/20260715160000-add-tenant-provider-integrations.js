'use strict';

const { buildProviderIdempotencyKey, buildProviderNamespace } = require('../src/provider-integrations/idempotency');

const DEFAULT_ORGANIZATION_SLUG = 'padel-park';
const DEFAULT_CLUB_SLUG = 'padel-park';

const BUSINESS_TABLES = Object.freeze([
  'TelephonyCalls',
  'TelephonyRawEvents',
  'TelephonySubscriptions',
  'Receipts',
]);

const CONSTRAINTS = Object.freeze({
  connectionClub: 'integration_connections_tenant_club_fk',
  receiptConnection: 'receipts_integration_connection_tenant_fk',
  receiptTenant: 'receipts_tenant_club_fk',
  rawConnection: 'telephony_raw_events_connection_tenant_fk',
  rawTenant: 'telephony_raw_events_tenant_club_fk',
  subscriptionConnection: 'telephony_subscriptions_connection_tenant_fk',
  subscriptionTenant: 'telephony_subscriptions_tenant_club_fk',
  callConnection: 'telephony_calls_connection_tenant_fk',
  callTenant: 'telephony_calls_tenant_club_fk',
});

async function rows(queryInterface, sql, options = {}) {
  const [result] = await queryInterface.sequelize.query(sql, options);
  return result;
}

async function exactDefaultTenant(queryInterface) {
  const organizations = await rows(
    queryInterface,
    'SELECT id, slug, status FROM Organizations ORDER BY id',
  );
  const clubs = await rows(
    queryInterface,
    'SELECT id, organizationId, slug, status FROM Clubs ORDER BY id',
  );
  if (
    organizations.length !== 1 ||
    clubs.length !== 1 ||
    organizations[0].slug !== DEFAULT_ORGANIZATION_SLUG ||
    clubs[0].slug !== DEFAULT_CLUB_SLUG ||
    organizations[0].status !== 'active' ||
    clubs[0].status !== 'active' ||
    Number(clubs[0].organizationId) !== Number(organizations[0].id)
  ) {
    throw new Error('Feature 4.3 migration requires the exact active default tenant');
  }
  return {
    clubId: Number(clubs[0].id),
    organizationId: Number(organizations[0].id),
  };
}

async function addColumnIfMissing(queryInterface, table, name, definition) {
  const description = await queryInterface.describeTable(table);
  if (!description[name]) await queryInterface.addColumn(table, name, definition);
}

async function removeColumnIfPresent(queryInterface, table, name) {
  const description = await queryInterface.describeTable(table);
  if (description[name]) await queryInterface.removeColumn(table, name);
}

async function addIndexIfMissing(queryInterface, table, fields, options) {
  const indexes = await queryInterface.showIndex(table);
  if (!indexes.some((index) => index.name === options.name)) {
    await queryInterface.addIndex(table, fields, options);
  }
}

async function removeIndexIfPresent(queryInterface, table, name) {
  const indexes = await queryInterface.showIndex(table);
  if (indexes.some((index) => index.name === name)) await queryInterface.removeIndex(table, name);
}

async function removeUniqueSingleColumnIndexes(queryInterface, table, column) {
  const indexes = await queryInterface.showIndex(table);
  for (const index of indexes) {
    const fields = (index.fields || []).map((field) => field.attribute || field.name);
    if (index.unique && fields.length === 1 && fields[0] === column && index.name !== 'PRIMARY') {
      await queryInterface.removeIndex(table, index.name);
    }
  }
}

async function addConstraintIfMissing(queryInterface, table, options) {
  const constraints = await queryInterface.getForeignKeyReferencesForTable(table);
  if (!constraints.some((constraint) => constraint.constraintName === options.name)) {
    await queryInterface.addConstraint(table, options);
  }
}

async function removeConstraintIfPresent(queryInterface, table, name) {
  const constraints = await queryInterface.getForeignKeyReferencesForTable(table);
  if (constraints.some((constraint) => constraint.constraintName === name)) {
    await queryInterface.removeConstraint(table, name);
  }
}

async function addAttributionColumns(queryInterface, Sequelize, table, extras = {}) {
  await addColumnIfMissing(queryInterface, table, 'organizationId', {
    allowNull: true,
    type: Sequelize.INTEGER,
  });
  await addColumnIfMissing(queryInterface, table, 'clubId', {
    allowNull: true,
    type: Sequelize.INTEGER,
  });
  await addColumnIfMissing(queryInterface, table, 'integrationConnectionId', {
    allowNull: true,
    type: Sequelize.INTEGER,
  });
  for (const [name, definition] of Object.entries(extras)) {
    await addColumnIfMissing(queryInterface, table, name, definition);
  }
}

async function backfillAttribution(queryInterface, tenant) {
  for (const table of BUSINESS_TABLES) {
    await queryInterface.sequelize.query(
      `UPDATE ${table}
       SET organizationId = COALESCE(organizationId, :organizationId),
           clubId = COALESCE(clubId, :clubId)`,
      { replacements: tenant },
    );
  }

  const legacyNamespace = buildProviderNamespace(null);
  await queryInterface.sequelize.query(
    `UPDATE TelephonyCalls
     SET providerNamespace = :legacyNamespace
     WHERE providerNamespace IS NULL`,
    { replacements: { legacyNamespace } },
  );
  await queryInterface.sequelize.query(
    `UPDATE TelephonySubscriptions
     SET providerNamespace = :legacyNamespace
     WHERE providerNamespace IS NULL`,
    { replacements: { legacyNamespace } },
  );

  const rawEvents = await rows(
    queryInterface,
    'SELECT id, externalEventId FROM TelephonyRawEvents WHERE idempotencyKey IS NULL ORDER BY id',
  );
  for (const event of rawEvents) {
    const externalId = event.externalEventId || `legacy-row:${event.id}`;
    await queryInterface.sequelize.query(
      'UPDATE TelephonyRawEvents SET idempotencyKey = :key, deliveryCount = COALESCE(deliveryCount, 1), lastReceivedAt = COALESCE(lastReceivedAt, receivedAt) WHERE id = :id',
      {
        replacements: {
          id: event.id,
          key: buildProviderIdempotencyKey(null, externalId),
        },
      },
    );
  }

  const receipts = await rows(
    queryInterface,
    'SELECT id, evotorId FROM Receipts WHERE idempotencyKey IS NULL ORDER BY id',
  );
  for (const receipt of receipts) {
    await queryInterface.sequelize.query(
      'UPDATE Receipts SET idempotencyKey = :key WHERE id = :id',
      {
        replacements: {
          id: receipt.id,
          key: buildProviderIdempotencyKey(null, receipt.evotorId),
        },
      },
    );
  }
}

async function addBusinessConstraints(queryInterface) {
  const definitions = [
    ['TelephonyCalls', CONSTRAINTS.callTenant, CONSTRAINTS.callConnection],
    ['TelephonyRawEvents', CONSTRAINTS.rawTenant, CONSTRAINTS.rawConnection],
    ['TelephonySubscriptions', CONSTRAINTS.subscriptionTenant, CONSTRAINTS.subscriptionConnection],
    ['Receipts', CONSTRAINTS.receiptTenant, CONSTRAINTS.receiptConnection],
  ];
  for (const [table, tenantName, connectionName] of definitions) {
    await addConstraintIfMissing(queryInterface, table, {
      fields: ['organizationId', 'clubId'],
      name: tenantName,
      onDelete: 'RESTRICT',
      onUpdate: 'CASCADE',
      references: { table: 'Clubs', fields: ['organizationId', 'id'] },
      type: 'foreign key',
    });
    await addConstraintIfMissing(queryInterface, table, {
      fields: ['integrationConnectionId', 'organizationId', 'clubId'],
      name: connectionName,
      onDelete: 'RESTRICT',
      onUpdate: 'CASCADE',
      references: {
        table: 'IntegrationConnections',
        fields: ['id', 'organizationId', 'clubId'],
      },
      type: 'foreign key',
    });
  }
}

async function removeBusinessConstraints(queryInterface) {
  const definitions = [
    ['Receipts', CONSTRAINTS.receiptConnection, CONSTRAINTS.receiptTenant],
    ['TelephonySubscriptions', CONSTRAINTS.subscriptionConnection, CONSTRAINTS.subscriptionTenant],
    ['TelephonyRawEvents', CONSTRAINTS.rawConnection, CONSTRAINTS.rawTenant],
    ['TelephonyCalls', CONSTRAINTS.callConnection, CONSTRAINTS.callTenant],
  ];
  for (const [table, connectionName, tenantName] of definitions) {
    await removeConstraintIfPresent(queryInterface, table, connectionName);
    await removeConstraintIfPresent(queryInterface, table, tenantName);
  }
}

async function assertRollbackSafe(queryInterface) {
  const connectionCount = await rows(
    queryInterface,
    'SELECT COUNT(*) AS count FROM IntegrationConnections',
  );
  const diagnosticCount = await rows(
    queryInterface,
    'SELECT COUNT(*) AS count FROM ProviderIngressDiagnostics',
  );
  if (Number(connectionCount[0]?.count) !== 0 || Number(diagnosticCount[0]?.count) !== 0) {
    throw new Error('Feature 4.3 rollback requires empty connection and provider diagnostic tables');
  }
  for (const table of BUSINESS_TABLES) {
    const attributed = await rows(
      queryInterface,
      `SELECT id FROM ${table} WHERE integrationConnectionId IS NOT NULL LIMIT 1`,
    );
    if (attributed.length > 0) {
      throw new Error(`Feature 4.3 rollback blocked by attributed rows in ${table}`);
    }
  }
}

module.exports = {
  async up(queryInterface, Sequelize) {
    const tenant = await exactDefaultTenant(queryInterface);

    await queryInterface.createTable('IntegrationConnections', {
      id: { allowNull: false, autoIncrement: true, primaryKey: true, type: Sequelize.INTEGER },
      publicId: { allowNull: false, type: Sequelize.STRING(35) },
      organizationId: { allowNull: false, type: Sequelize.INTEGER },
      clubId: { allowNull: false, type: Sequelize.INTEGER },
      provider: { allowNull: false, type: Sequelize.ENUM('beeline', 'evotor', 'telegram', 'vk') },
      purpose: { allowNull: false, type: Sequelize.ENUM('telephony', 'point_of_sale', 'client_registration') },
      connectionKey: { allowNull: false, defaultValue: 'default', type: Sequelize.STRING(64) },
      status: { allowNull: false, defaultValue: 'active', type: Sequelize.ENUM('active', 'disabled', 'revoked') },
      config: { allowNull: false, type: Sequelize.JSON },
      metadata: { allowNull: false, type: Sequelize.JSON },
      secretCiphertext: { allowNull: false, type: Sequelize.TEXT('long') },
      secretKeyVersion: { allowNull: false, type: Sequelize.STRING(32) },
      secretUpdatedAt: { allowNull: false, type: Sequelize.DATE },
      createdAt: { allowNull: false, type: Sequelize.DATE },
      updatedAt: { allowNull: false, type: Sequelize.DATE },
    });
    await addIndexIfMissing(queryInterface, 'IntegrationConnections', ['publicId'], {
      name: 'integration_connections_public_id_unique',
      unique: true,
    });
    await addIndexIfMissing(
      queryInterface,
      'IntegrationConnections',
      ['organizationId', 'clubId', 'provider', 'purpose', 'connectionKey'],
      { name: 'integration_connections_tenant_slot_unique', unique: true },
    );
    await addIndexIfMissing(
      queryInterface,
      'IntegrationConnections',
      ['id', 'organizationId', 'clubId'],
      { name: 'integration_connections_identity_tenant_unique', unique: true },
    );
    await addIndexIfMissing(
      queryInterface,
      'IntegrationConnections',
      ['provider', 'purpose', 'status', 'organizationId', 'clubId', 'id'],
      { name: 'integration_connections_active_provider_idx' },
    );
    await addConstraintIfMissing(queryInterface, 'IntegrationConnections', {
      fields: ['organizationId', 'clubId'],
      name: CONSTRAINTS.connectionClub,
      onDelete: 'RESTRICT',
      onUpdate: 'CASCADE',
      references: { table: 'Clubs', fields: ['organizationId', 'id'] },
      type: 'foreign key',
    });

    await queryInterface.createTable('ProviderIngressDiagnostics', {
      id: { allowNull: false, autoIncrement: true, primaryKey: true, type: Sequelize.INTEGER },
      provider: { allowNull: false, type: Sequelize.STRING(32) },
      outcome: { allowNull: false, type: Sequelize.ENUM('rejected') },
      reasonCode: { allowNull: false, type: Sequelize.STRING(64) },
      connectionPublicIdHash: { allowNull: true, type: Sequelize.STRING(64) },
      requestFingerprint: { allowNull: true, type: Sequelize.STRING(64) },
      createdAt: { allowNull: false, type: Sequelize.DATE },
    });
    await addIndexIfMissing(
      queryInterface,
      'ProviderIngressDiagnostics',
      ['provider', 'reasonCode', 'createdAt', 'id'],
      { name: 'provider_ingress_diagnostics_provider_reason_idx' },
    );

    await addAttributionColumns(queryInterface, Sequelize, 'TelephonyCalls', {
      providerNamespace: { allowNull: true, type: Sequelize.STRING(64) },
    });
    await addAttributionColumns(queryInterface, Sequelize, 'TelephonyRawEvents', {
      deliveryCount: { allowNull: false, defaultValue: 1, type: Sequelize.INTEGER },
      idempotencyKey: { allowNull: true, type: Sequelize.STRING(64) },
      lastReceivedAt: { allowNull: true, type: Sequelize.DATE },
    });
    await addAttributionColumns(queryInterface, Sequelize, 'TelephonySubscriptions', {
      providerNamespace: { allowNull: true, type: Sequelize.STRING(64) },
    });
    await addAttributionColumns(queryInterface, Sequelize, 'Receipts', {
      idempotencyKey: { allowNull: true, type: Sequelize.STRING(64) },
    });
    await backfillAttribution(queryInterface, tenant);
    await addBusinessConstraints(queryInterface);

    for (const name of [
      'telephony_calls_provider_external_call_unique',
      'telephony_calls_provider_external_tracking_unique',
      'telephony_calls_provider_record_unique',
      'telephony_calls_provider_phone_started_unique',
    ]) await removeIndexIfPresent(queryInterface, 'TelephonyCalls', name);
    await addIndexIfMissing(queryInterface, 'TelephonyCalls', ['providerNamespace', 'externalCallId'], {
      name: 'telephony_calls_connection_external_call_unique', unique: true,
    });
    await addIndexIfMissing(queryInterface, 'TelephonyCalls', ['providerNamespace', 'externalTrackingId'], {
      name: 'telephony_calls_connection_external_tracking_unique', unique: true,
    });
    await addIndexIfMissing(queryInterface, 'TelephonyCalls', ['providerNamespace', 'recordId'], {
      name: 'telephony_calls_connection_record_unique', unique: true,
    });
    await addIndexIfMissing(
      queryInterface,
      'TelephonyCalls',
      ['providerNamespace', 'clientPhoneNormalized', 'startedAt'],
      { name: 'telephony_calls_connection_phone_started_unique', unique: true },
    );
    await addIndexIfMissing(
      queryInterface,
      'TelephonyCalls',
      ['organizationId', 'clubId', 'integrationConnectionId', 'startedAt', 'id'],
      { name: 'telephony_calls_connection_tenant_time_idx' },
    );

    await removeIndexIfPresent(
      queryInterface,
      'TelephonyRawEvents',
      'telephony_raw_events_provider_external_event_idx',
    );
    await addIndexIfMissing(queryInterface, 'TelephonyRawEvents', ['idempotencyKey'], {
      name: 'telephony_raw_events_idempotency_unique', unique: true,
    });
    await addIndexIfMissing(
      queryInterface,
      'TelephonyRawEvents',
      ['organizationId', 'clubId', 'integrationConnectionId', 'receivedAt', 'id'],
      { name: 'telephony_raw_events_connection_tenant_time_idx' },
    );

    await removeIndexIfPresent(
      queryInterface,
      'TelephonySubscriptions',
      'telephony_subscriptions_provider_subscription_id_unique',
    );
    await addIndexIfMissing(
      queryInterface,
      'TelephonySubscriptions',
      ['providerNamespace', 'subscriptionId'],
      { name: 'telephony_subscriptions_connection_subscription_unique', unique: true },
    );
    await addIndexIfMissing(
      queryInterface,
      'TelephonySubscriptions',
      ['organizationId', 'clubId', 'integrationConnectionId', 'status', 'expiresAt', 'id'],
      { name: 'telephony_subscriptions_connection_tenant_status_idx' },
    );

    await removeUniqueSingleColumnIndexes(queryInterface, 'Receipts', 'evotorId');
    await addIndexIfMissing(queryInterface, 'Receipts', ['idempotencyKey'], {
      name: 'receipts_provider_idempotency_unique', unique: true,
    });
    await addIndexIfMissing(
      queryInterface,
      'Receipts',
      ['organizationId', 'clubId', 'integrationConnectionId', 'dateTime', 'id'],
      { name: 'receipts_connection_tenant_time_idx' },
    );
  },

  async down(queryInterface) {
    await assertRollbackSafe(queryInterface);
    await removeBusinessConstraints(queryInterface);

    await removeIndexIfPresent(queryInterface, 'Receipts', 'receipts_connection_tenant_time_idx');
    await removeIndexIfPresent(queryInterface, 'Receipts', 'receipts_provider_idempotency_unique');
    await addIndexIfMissing(queryInterface, 'Receipts', ['evotorId'], {
      name: 'receipts_evotor_id_legacy_unique', unique: true,
    });

    await removeIndexIfPresent(
      queryInterface,
      'TelephonySubscriptions',
      'telephony_subscriptions_connection_tenant_status_idx',
    );
    await removeIndexIfPresent(
      queryInterface,
      'TelephonySubscriptions',
      'telephony_subscriptions_connection_subscription_unique',
    );
    await addIndexIfMissing(
      queryInterface,
      'TelephonySubscriptions',
      ['provider', 'subscriptionId'],
      { name: 'telephony_subscriptions_provider_subscription_id_unique', unique: true },
    );

    await removeIndexIfPresent(
      queryInterface,
      'TelephonyRawEvents',
      'telephony_raw_events_connection_tenant_time_idx',
    );
    await removeIndexIfPresent(queryInterface, 'TelephonyRawEvents', 'telephony_raw_events_idempotency_unique');
    await addIndexIfMissing(
      queryInterface,
      'TelephonyRawEvents',
      ['provider', 'externalEventId'],
      { name: 'telephony_raw_events_provider_external_event_idx', unique: true },
    );

    await removeIndexIfPresent(queryInterface, 'TelephonyCalls', 'telephony_calls_connection_tenant_time_idx');
    for (const name of [
      'telephony_calls_connection_phone_started_unique',
      'telephony_calls_connection_record_unique',
      'telephony_calls_connection_external_tracking_unique',
      'telephony_calls_connection_external_call_unique',
    ]) await removeIndexIfPresent(queryInterface, 'TelephonyCalls', name);
    await addIndexIfMissing(queryInterface, 'TelephonyCalls', ['provider', 'externalCallId'], {
      name: 'telephony_calls_provider_external_call_unique', unique: true,
    });
    await addIndexIfMissing(queryInterface, 'TelephonyCalls', ['provider', 'externalTrackingId'], {
      name: 'telephony_calls_provider_external_tracking_unique', unique: true,
    });
    await addIndexIfMissing(queryInterface, 'TelephonyCalls', ['provider', 'recordId'], {
      name: 'telephony_calls_provider_record_unique', unique: true,
    });
    await addIndexIfMissing(
      queryInterface,
      'TelephonyCalls',
      ['provider', 'clientPhoneNormalized', 'startedAt'],
      { name: 'telephony_calls_provider_phone_started_unique', unique: true },
    );

    for (const [table, columns] of [
      ['Receipts', ['idempotencyKey', 'integrationConnectionId', 'clubId', 'organizationId']],
      ['TelephonySubscriptions', ['providerNamespace', 'integrationConnectionId', 'clubId', 'organizationId']],
      ['TelephonyRawEvents', ['lastReceivedAt', 'deliveryCount', 'idempotencyKey', 'integrationConnectionId', 'clubId', 'organizationId']],
      ['TelephonyCalls', ['providerNamespace', 'integrationConnectionId', 'clubId', 'organizationId']],
    ]) {
      for (const column of columns) await removeColumnIfPresent(queryInterface, table, column);
    }

    await removeConstraintIfPresent(
      queryInterface,
      'IntegrationConnections',
      CONSTRAINTS.connectionClub,
    );
    await queryInterface.dropTable('ProviderIngressDiagnostics');
    await queryInterface.dropTable('IntegrationConnections');
  },
};
