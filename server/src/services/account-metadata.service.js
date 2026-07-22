'use strict';

const db = require('../../models');
const normalUserSessions = require('./normal-user-session.service');
const { assertTenantFoundationInitialized } = require('./tenant-foundation.service');

const ACCOUNT_METADATA_FIELDS = Object.freeze([
  'lastLoginAt',
  'email',
  'passwordHash',
]);

function metadataError(message, statusCode = 400, code = 'ACCOUNT_METADATA_INVALID') {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function assertMetadataPayload(payload) {
  const fields = Object.keys(payload || {});
  if (fields.length === 0) return;
  const rejected = fields.filter((field) => !ACCOUNT_METADATA_FIELDS.includes(field));
  if (rejected.length > 0) {
    throw metadataError(
      `Account metadata writer rejected fields: ${rejected.join(', ')}`,
      400,
      rejected.some((field) => ['role', 'status', 'staffId'].includes(field))
        ? 'ACCOUNT_LIFECYCLE_REQUIRED'
        : 'ACCOUNT_METADATA_INVALID',
    );
  }
}

async function updateAccountMetadata(accountId, payload, options = {}) {
  assertMetadataPayload(payload);
  if (options.transaction) {
    const locked = await db.Account.findByPk(accountId, {
      lock: options.transaction.LOCK.UPDATE,
      transaction: options.transaction,
    });
    if (!locked) {
      throw metadataError('Пользователь не найден', 404, 'ACCOUNT_NOT_FOUND');
    }
    if (
      Object.prototype.hasOwnProperty.call(payload, 'passwordHash') &&
      payload.passwordHash !== locked.passwordHash
    ) {
      await normalUserSessions.revokeAllForAccount(
        locked.id,
        normalUserSessions.REVOCATION_REASONS.PASSWORD_CHANGED,
        { transaction: options.transaction },
      );
    }
    await locked.update(payload, { transaction: options.transaction });
    return locked;
  }
  await assertTenantFoundationInitialized();
  const account = await db.sequelize.transaction(async (transaction) => {
    const locked = await db.Account.findByPk(accountId, {
      lock: transaction.LOCK.UPDATE,
      transaction,
    });
    if (!locked) {
      throw metadataError('Пользователь не найден', 404, 'ACCOUNT_NOT_FOUND');
    }
    if (
      Object.prototype.hasOwnProperty.call(payload, 'passwordHash') &&
      payload.passwordHash !== locked.passwordHash
    ) {
      await normalUserSessions.revokeAllForAccount(
        locked.id,
        normalUserSessions.REVOCATION_REASONS.PASSWORD_CHANGED,
        { transaction },
      );
    }
    await locked.update(payload, { transaction });
    if (options.failAfter === 'account') {
      throw metadataError('Forced Account metadata failure', 409);
    }
    return locked;
  });

  await assertTenantFoundationInitialized();
  return account;
}

async function compareAndSwapPasswordHash(accountId, previousHash, nextHash) {
  const normalizedAccountId = Number(accountId);
  if (
    !Number.isInteger(normalizedAccountId) ||
    normalizedAccountId <= 0 ||
    typeof previousHash !== 'string' ||
    previousHash.length === 0 ||
    previousHash.length > 255 ||
    typeof nextHash !== 'string' ||
    nextHash.length === 0 ||
    nextHash.length > 255
  ) {
    throw metadataError(
      'Password hash compare-and-swap arguments are invalid',
      400,
      'ACCOUNT_PASSWORD_HASH_CAS_INVALID',
    );
  }
  const [updatedRows] = await db.Account.update(
    { passwordHash: nextHash },
    {
      where: {
        id: normalizedAccountId,
        passwordHash: previousHash,
      },
    },
  );
  return updatedRows === 1;
}

module.exports = {
  ACCOUNT_METADATA_FIELDS,
  assertMetadataPayload,
  compareAndSwapPasswordHash,
  updateAccountMetadata,
};
