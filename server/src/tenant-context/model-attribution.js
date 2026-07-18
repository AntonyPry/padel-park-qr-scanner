'use strict';

const { QueryTypes } = require('sequelize');

const {
  requireExactSingletonDefault,
} = require('../tenant-enforcement/legacy-singleton');
const {
  isTenantClientMoneyInstrumentsEnabled,
} = require('./capabilities');
const {
  assertBulkFieldsAreMutable,
  immutableAttributionError,
} = require('../provider-integrations/immutable-attribution');

function missingTenantError(modelName) {
  const error = new Error(`${modelName} tenant attribution is required`);
  error.code = 'TENANT_CONTEXT_REQUIRED';
  error.statusCode = 503;
  return error;
}

async function loadDefaultTenant(instance, options = {}) {
  const models = instance?.sequelize?.models;
  if (!models?.Organization || !models?.Club) {
    throw missingTenantError(instance?.constructor?.name || 'Model');
  }
  return requireExactSingletonDefault({
    models,
    transaction: options.transaction,
  });
}

async function ensureTenantAttribution(instance, options, fields) {
  const missing = fields.filter((field) => !Number.isSafeInteger(Number(instance[field])));
  if (missing.length === 0) return;
  if (isTenantClientMoneyInstrumentsEnabled()) {
    throw missingTenantError(instance.constructor.name);
  }
  const tenant = await loadDefaultTenant(instance, options);
  for (const field of missing) {
    instance.set(field, tenant[field]);
  }
}

function createTenantAttributionHooks(fields, label) {
  const immutableFields = Object.freeze([...fields]);
  return {
    async beforeBulkCreate(instances, options) {
      await Promise.all(instances.map((instance) =>
        ensureTenantAttribution(instance, options, immutableFields)));
    },
    beforeBulkUpdate(options) {
      assertBulkFieldsAreMutable(
        options,
        immutableFields,
        `${label} tenant attribution is immutable`,
      );
    },
    async beforeValidate(instance, options) {
      if (
        (
          options?.type === QueryTypes.BULKUPDATE &&
          immutableFields.every((field) => !options.fields?.includes(field))
        ) || (
          !instance.isNewRecord &&
          immutableFields.every((field) => !instance.changed(field))
        )
      ) return;
      await ensureTenantAttribution(instance, options, immutableFields);
    },
    beforeUpdate(instance) {
      if (immutableFields.some((field) => instance.changed(field))) {
        throw immutableAttributionError(`${label} tenant attribution is immutable`);
      }
    },
  };
}

function createCapabilityTenantAttributionHooks(fields, label, isEnabled) {
  const immutableFields = Object.freeze([...fields]);
  async function ensure(instance, options = {}) {
    const missing = immutableFields.filter(
      (field) => !Number.isSafeInteger(Number(instance[field])),
    );
    if (missing.length === 0) return;
    if (isEnabled()) throw missingTenantError(label);
    const tenant = await loadDefaultTenant(instance, options);
    for (const field of missing) instance.set(field, tenant[field]);
  }
  return {
    async beforeBulkCreate(instances, options) {
      await Promise.all(instances.map((instance) => ensure(instance, options)));
    },
    beforeBulkUpdate(options) {
      assertBulkFieldsAreMutable(
        options,
        immutableFields,
        `${label} tenant attribution is immutable`,
      );
    },
    beforeUpdate(instance) {
      if (immutableFields.some((field) => instance.changed(field))) {
        throw immutableAttributionError(`${label} tenant attribution is immutable`);
      }
    },
    async beforeValidate(instance, options) {
      if (
        (
          options?.type === QueryTypes.BULKUPDATE &&
          immutableFields.every((field) => !options.fields?.includes(field))
        ) || (
          !instance.isNewRecord &&
          immutableFields.every((field) => !instance.changed(field))
        )
      ) return;
      await ensure(instance, options);
    },
  };
}

function createNullableTenantAttributionHooks(fields, label) {
  const immutableFields = Object.freeze([...fields]);
  return {
    beforeBulkUpdate(options) {
      assertBulkFieldsAreMutable(
        options,
        immutableFields,
        `${label} tenant attribution is immutable`,
      );
    },
    beforeUpdate(instance) {
      if (immutableFields.some((field) => instance.changed(field))) {
        throw immutableAttributionError(`${label} tenant attribution is immutable`);
      }
    },
  };
}

module.exports = {
  createCapabilityTenantAttributionHooks,
  createNullableTenantAttributionHooks,
  createTenantAttributionHooks,
  ensureTenantAttribution,
  loadDefaultTenant,
  missingTenantError,
};
