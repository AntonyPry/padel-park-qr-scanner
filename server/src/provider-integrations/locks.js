'use strict';

const db = require('../../models');
const { buildProviderNamespace, hashParts } = require('./idempotency');

const localQueues = new Map();

function providerLockName(context, resource = 'connection') {
  const digest = hashParts([buildProviderNamespace(context), String(resource)]);
  return `setly:provider:${digest.slice(0, 48)}`;
}

function providerLockBusyError() {
  const error = new Error('Provider connection is busy');
  error.code = 'PROVIDER_CONNECTION_BUSY';
  error.statusCode = 409;
  return error;
}

async function withLocalLock(name, callback) {
  const previous = localQueues.get(name) || Promise.resolve();
  let release;
  const current = new Promise((resolve) => {
    release = resolve;
  });
  const tail = previous.then(() => current);
  localQueues.set(name, tail);
  await previous;
  try {
    return await callback();
  } finally {
    release();
    if (localQueues.get(name) === tail) localQueues.delete(name);
  }
}

async function withProviderConnectionLock(
  context,
  callback,
  { resource = 'connection', timeoutSeconds } = {},
) {
  const name = providerLockName(context, resource);
  if (db.sequelize.getDialect() !== 'mysql') return withLocalLock(name, callback);

  const rawTimeout = timeoutSeconds ?? Number(process.env.PROVIDER_LOCK_TIMEOUT_SECONDS || 5);
  const timeout = Number.isInteger(rawTimeout) && rawTimeout >= 0 && rawTimeout <= 30
    ? rawTimeout
    : 5;
  return db.sequelize.transaction(async (transaction) => {
    const [rows] = await db.sequelize.query('SELECT GET_LOCK(:name, :timeout) AS locked', {
      replacements: { name, timeout },
      transaction,
    });
    if (Number(rows?.[0]?.locked) !== 1) throw providerLockBusyError();
    try {
      return await callback();
    } finally {
      await db.sequelize.query('SELECT RELEASE_LOCK(:name)', {
        replacements: { name },
        transaction,
      });
    }
  });
}

module.exports = {
  providerLockBusyError,
  providerLockName,
  withLocalProviderConnectionLock: (context, callback, resource = 'connection') =>
    withLocalLock(providerLockName(context, resource), callback),
  withProviderConnectionLock,
};
