'use strict';

const db = require('../../models');
const {
  resolveTrustedTenantAttribution,
} = require('../files-workers/tenant-context');
const {
  buildProviderIdempotencyKey,
  buildProviderNamespace,
} = require('./idempotency');

async function resolveLegacyProviderContext(provider) {
  const tenant = await resolveTrustedTenantAttribution();
  return Object.freeze({
    ...tenant,
    connectionId: null,
    legacy: true,
    provider,
  });
}

function assertReconciliationConnection(connection) {
  if (
    !connection ||
    !Number.isInteger(Number(connection.connectionId)) ||
    !Number.isInteger(Number(connection.organizationId)) ||
    !Number.isInteger(Number(connection.clubId)) ||
    !connection.provider
  ) {
    const error = new Error('Provider reconciliation context is invalid');
    error.code = 'PROVIDER_RECONCILIATION_CONTEXT_INVALID';
    throw error;
  }
}

async function updateRows(rows, sql, connection, transaction, externalIdField) {
  let updated = 0;
  for (const row of rows) {
    const externalId = row[externalIdField] || `legacy-row:${row.id}`;
    const [result, metadata] = await db.sequelize.query(sql, {
      replacements: {
        clubId: Number(connection.clubId),
        connectionId: Number(connection.connectionId),
        id: Number(row.id),
        idempotencyKey: buildProviderIdempotencyKey(connection, externalId),
        organizationId: Number(connection.organizationId),
      },
      transaction,
    });
    updated += Number(metadata?.affectedRows ?? metadata ?? result?.affectedRows ?? result ?? 0);
  }
  return updated;
}

async function reconcileBeeline(connection, transaction) {
  const legacyNamespace = buildProviderNamespace(null);
  const providerNamespace = buildProviderNamespace(connection);
  const replacements = {
    clubId: Number(connection.clubId),
    connectionId: Number(connection.connectionId),
    legacyNamespace,
    organizationId: Number(connection.organizationId),
    providerNamespace,
  };
  const [rawEvents] = await db.sequelize.query(
    `SELECT id, externalEventId
     FROM TelephonyRawEvents
     WHERE organizationId = :organizationId
       AND clubId = :clubId
       AND integrationConnectionId IS NULL
       AND provider = 'beeline'
     ORDER BY id`,
    { replacements, transaction },
  );
  const rawEventCount = await updateRows(
    rawEvents,
    `UPDATE TelephonyRawEvents
     SET integrationConnectionId = :connectionId,
         idempotencyKey = :idempotencyKey
     WHERE id = :id
       AND organizationId = :organizationId
       AND clubId = :clubId
       AND integrationConnectionId IS NULL`,
    connection,
    transaction,
    'externalEventId',
  );
  const [callResult, callMetadata] = await db.sequelize.query(
    `UPDATE TelephonyCalls
     SET integrationConnectionId = :connectionId,
         providerNamespace = :providerNamespace
     WHERE organizationId = :organizationId
       AND clubId = :clubId
       AND integrationConnectionId IS NULL
       AND provider = 'beeline'
       AND providerNamespace = :legacyNamespace`,
    { replacements, transaction },
  );
  const [subscriptionResult, subscriptionMetadata] = await db.sequelize.query(
    `UPDATE TelephonySubscriptions
     SET integrationConnectionId = :connectionId,
         providerNamespace = :providerNamespace
     WHERE organizationId = :organizationId
       AND clubId = :clubId
       AND integrationConnectionId IS NULL
       AND provider = 'beeline'
       AND providerNamespace = :legacyNamespace`,
    { replacements, transaction },
  );
  return {
    rawEvents: rawEventCount,
    subscriptions: Number(
      subscriptionMetadata?.affectedRows ?? subscriptionMetadata ??
      subscriptionResult?.affectedRows ?? subscriptionResult ?? 0
    ),
    telephonyCalls: Number(
      callMetadata?.affectedRows ?? callMetadata ?? callResult?.affectedRows ?? callResult ?? 0
    ),
  };
}

async function reconcileEvotor(connection, transaction) {
  const replacements = {
    clubId: Number(connection.clubId),
    organizationId: Number(connection.organizationId),
  };
  const [receipts] = await db.sequelize.query(
    `SELECT id, evotorId
     FROM Receipts
     WHERE organizationId = :organizationId
       AND clubId = :clubId
       AND integrationConnectionId IS NULL
     ORDER BY id`,
    { replacements, transaction },
  );
  return {
    receipts: await updateRows(
      receipts,
      `UPDATE Receipts
       SET integrationConnectionId = :connectionId,
           idempotencyKey = :idempotencyKey
       WHERE id = :id
         AND organizationId = :organizationId
         AND clubId = :clubId
         AND integrationConnectionId IS NULL`,
      connection,
      transaction,
      'evotorId',
    ),
  };
}

async function reconcileLegacyProviderRows(connection) {
  assertReconciliationConnection(connection);
  const defaultTenant = await resolveTrustedTenantAttribution();
  if (
    Number(connection.organizationId) !== defaultTenant.organizationId ||
    Number(connection.clubId) !== defaultTenant.clubId
  ) {
    const error = new Error('Legacy provider rows can only be reconciled for the default tenant');
    error.code = 'PROVIDER_RECONCILIATION_TENANT_MISMATCH';
    throw error;
  }
  return db.sequelize.transaction(async (transaction) => {
    if (connection.provider === 'beeline') return reconcileBeeline(connection, transaction);
    if (connection.provider === 'evotor') return reconcileEvotor(connection, transaction);
    return {};
  });
}

module.exports = {
  reconcileLegacyProviderRows,
  resolveLegacyProviderContext,
};
