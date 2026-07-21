'use strict';

const db = require('../../models');

function parseMetadata(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

async function markConnectionActivity(connection, occurredAt = new Date()) {
  const connectionId = Number(connection?.connectionId || connection?.id);
  if (!Number.isInteger(connectionId) || connectionId <= 0) return false;
  await db.sequelize.transaction(async (transaction) => {
    const row = await db.IntegrationConnection.unscoped().findByPk(connectionId, {
      lock: transaction.LOCK.UPDATE,
      transaction,
    });
    if (!row ||
      Number(row.organizationId) !== Number(connection.organizationId) ||
      Number(row.clubId) !== Number(connection.clubId) ||
      row.provider !== connection.provider) return;
    const metadata = parseMetadata(row.metadata);
    metadata.lastActivityAt = new Date(occurredAt).toISOString();
    await row.update({ metadata }, { silent: true, transaction });
  });
  return true;
}

module.exports = { markConnectionActivity };
