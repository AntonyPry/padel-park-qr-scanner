'use strict';

const db = require('../../models');
const { TENANT_SCOPES } = require('../tenant-context/route-scope-declarations');
const {
  isTenantShiftsReportsEnabled,
} = require('../tenant-context/capabilities');
const { safeTenantDenial } = require('./tenant-context.service');
const {
  _private: clientMoneyPrivate,
  resolveClientMoneyAccessContext,
} = require('./client-money-access-context.service');

const resolvedContexts = new WeakSet();

function positiveId(value) {
  const normalized = Number(value);
  return Number.isSafeInteger(normalized) && normalized > 0 ? normalized : null;
}

function queryLock(transaction, lock) {
  return transaction && lock ? transaction.LOCK.UPDATE : undefined;
}

async function resolveShiftOperationsAccessContext(tenant, options = {}) {
  const enabled = isTenantShiftsReportsEnabled();
  const base = enabled
    ? await resolveClientMoneyAccessContext(tenant, options)
    : await clientMoneyPrivate.resolveLegacyContext(options);
  if (
    !positiveId(base.clubId) ||
    !positiveId(base.organizationId) ||
    (enabled && (
      base.scope !== TENANT_SCOPES.CLUB ||
      !base.readScoped ||
      base.authority !== 'request'
    ))
  ) {
    throw safeTenantDenial();
  }

  let staffId = null;
  if (base.readScoped) {
    const account = await db.Account.findOne({
      attributes: ['id', 'staffId', 'status'],
      lock: queryLock(options.transaction, options.lock),
      transaction: options.transaction,
      where: { id: base.accountId, status: 'active' },
    });
    if (!account) throw safeTenantDenial();
    staffId = positiveId(account.staffId);
  }

  const context = Object.freeze({ ...base, staffId });
  resolvedContexts.add(context);
  return context;
}

function requireResolvedContext(context) {
  if (!resolvedContexts.has(context) || !Object.isFrozen(context)) {
    throw safeTenantDenial();
  }
  return context;
}

function bindShiftOperationsActor(actor, context) {
  requireResolvedContext(context);
  if (!context.readScoped) return actor;
  if (!actor || positiveId(actor.id) !== positiveId(context.accountId)) {
    throw safeTenantDenial();
  }
  if (!context.effectiveRole) throw safeTenantDenial();
  return Object.freeze({
    ...actor,
    id: context.accountId,
    role: context.effectiveRole,
    staffId: context.staffId,
  });
}

function shiftOperationsTenantWhere(context, values = {}, { force = false } = {}) {
  requireResolvedContext(context);
  if (!context.readScoped && !force) return values;
  return { ...values, clubId: context.clubId };
}

function shiftOperationsTenantValues(context) {
  requireResolvedContext(context);
  return { clubId: context.clubId };
}

module.exports = {
  _private: { positiveId },
  bindShiftOperationsActor,
  resolveShiftOperationsAccessContext,
  shiftOperationsTenantValues,
  shiftOperationsTenantWhere,
};
