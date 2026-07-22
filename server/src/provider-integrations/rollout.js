'use strict';

const db = require('../../models');
const {
  resolveTrustedTenantAttribution,
} = require('../files-workers/tenant-context');
const {
  buildProviderIdempotencyKey,
  buildProviderNamespace,
} = require('./idempotency');
const { PROVIDER_PURPOSE } = require('./constants');

const RECONCILABLE_PROVIDERS = Object.freeze(['beeline', 'evotor']);
const legacyProviderContexts = new WeakSet();

function canReconcileLegacyProviderRows(provider) {
  return RECONCILABLE_PROVIDERS.includes(provider);
}

async function resolveLegacyProviderContext(provider) {
  const tenant = await resolveTrustedTenantAttribution();
  const context = Object.freeze({
    ...tenant,
    connectionId: null,
    legacy: true,
    provider,
  });
  legacyProviderContexts.add(context);
  return context;
}

function isLegacyProviderContext(context, provider = null) {
  return Boolean(
    context &&
      legacyProviderContexts.has(context) &&
      context.legacy === true &&
      (!provider || context.provider === provider),
  );
}

function assertReconciliationConnection(connection) {
  if (
    !connection ||
    !Number.isInteger(Number(connection.connectionId)) ||
    Number(connection.connectionId) <= 0
  ) {
    const error = new Error('Provider reconciliation context is invalid');
    error.code = 'PROVIDER_RECONCILIATION_CONTEXT_INVALID';
    throw error;
  }
}

function reconciliationError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function assertSnapshotMatchesAuthoritativeConnection(snapshot, authoritative) {
  const identity = [
    ['organizationId', authoritative.organizationId],
    ['clubId', authoritative.clubId],
    ['provider', authoritative.provider],
    ['purpose', authoritative.purpose],
    ['connectionKey', authoritative.connectionKey],
  ];
  for (const [field, authoritativeValue] of identity) {
    if (
      Object.prototype.hasOwnProperty.call(snapshot, field) &&
      String(snapshot[field]) !== String(authoritativeValue)
    ) {
      throw reconciliationError(
        'PROVIDER_RECONCILIATION_AUTHORITY_MISMATCH',
        'Provider reconciliation snapshot does not match the authoritative connection',
      );
    }
  }
}

async function loadAuthoritativeReconciliationConnection(snapshot, transaction) {
  const row = await db.IntegrationConnection.unscoped().findByPk(
    Number(snapshot.connectionId),
    {
      attributes: [
        'id',
        'organizationId',
        'clubId',
        'provider',
        'purpose',
        'connectionKey',
      ],
      transaction,
    },
  );
  if (!row) {
    throw reconciliationError(
      'PROVIDER_RECONCILIATION_CONNECTION_NOT_FOUND',
      'Provider reconciliation connection was not found',
    );
  }
  const authoritative = Object.freeze({
    clubId: Number(row.clubId),
    connectionId: Number(row.id),
    connectionKey: row.connectionKey,
    organizationId: Number(row.organizationId),
    provider: row.provider,
    purpose: row.purpose,
  });
  assertSnapshotMatchesAuthoritativeConnection(snapshot, authoritative);
  if (
    !canReconcileLegacyProviderRows(authoritative.provider) ||
    PROVIDER_PURPOSE[authoritative.provider] !== authoritative.purpose ||
    authoritative.connectionKey !== 'default'
  ) {
    throw reconciliationError(
      'PROVIDER_RECONCILIATION_CONNECTION_INVALID',
      'Provider reconciliation requires the authoritative default provider connection',
    );
  }
  return authoritative;
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

async function reconcileLegacyProviderRows(connection, { transaction } = {}) {
  assertReconciliationConnection(connection);
  const defaultTenant = await resolveTrustedTenantAttribution();
  const reconcile = async (activeTransaction) => {
    const authoritative = await loadAuthoritativeReconciliationConnection(
      connection,
      activeTransaction,
    );
    if (
      authoritative.organizationId !== defaultTenant.organizationId ||
      authoritative.clubId !== defaultTenant.clubId
    ) {
      throw reconciliationError(
        'PROVIDER_RECONCILIATION_TENANT_MISMATCH',
        'Legacy provider rows can only be reconciled for the default tenant',
      );
    }
    if (authoritative.provider === 'beeline') {
      return reconcileBeeline(authoritative, activeTransaction);
    }
    if (authoritative.provider === 'evotor') {
      return reconcileEvotor(authoritative, activeTransaction);
    }
    return {};
  };
  return transaction
    ? reconcile(transaction)
    : db.sequelize.transaction(reconcile);
}

module.exports = {
  canReconcileLegacyProviderRows,
  isLegacyProviderContext,
  reconcileLegacyProviderRows,
  resolveLegacyProviderContext,
};
