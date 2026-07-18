'use strict';

const { TENANT_SCOPES } = require('../tenant-context/route-scope-declarations');
const {
  isTenantTrainingNotesPlansEnabled,
} = require('../tenant-context/capabilities');
const { safeTenantDenial } = require('./tenant-context.service');
const {
  _private: methodologyAccessPrivate,
  bindMethodologyActor,
  resolveMethodologyAccessContext,
} = require('./methodology-access-context.service');

const resolvedTrainingOperationContexts = new WeakSet();

function positiveId(value) {
  const normalized = Number(value);
  return Number.isSafeInteger(normalized) && normalized > 0
    ? normalized
    : null;
}

async function resolveTrainingOperationsAccessContext(tenant, options = {}) {
  const enabled = isTenantTrainingNotesPlansEnabled();
  const context = enabled
    ? await resolveMethodologyAccessContext(tenant, options)
    : await methodologyAccessPrivate.resolveLegacyContext(options);
  if (
    enabled &&
    (
      context.scope !== TENANT_SCOPES.CLUB ||
      !positiveId(context.clubId) ||
      !context.readScoped
    )
  ) {
    throw safeTenantDenial();
  }
  if (!positiveId(context.clubId) || !positiveId(context.organizationId)) {
    throw safeTenantDenial();
  }
  resolvedTrainingOperationContexts.add(context);
  return context;
}

function bindTrainingOperationsActor(actor, context) {
  if (!resolvedTrainingOperationContexts.has(context)) throw safeTenantDenial();
  return bindMethodologyActor(actor, context);
}

function trainingOperationsTenantWhere(
  context,
  values = {},
  { force = false } = {},
) {
  if (!context || (!context.readScoped && !force)) return values;
  return { ...values, clubId: context.clubId };
}

module.exports = {
  _private: { positiveId },
  bindTrainingOperationsActor,
  resolveTrainingOperationsAccessContext,
  trainingOperationsTenantWhere,
};
