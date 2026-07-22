'use strict';

const {
  TENANT_FOUNDATION_STATES,
} = require('../tenant-foundation/constants');

class TenantSingletonRequiredError extends Error {
  constructor(details) {
    super('Legacy tenant bridge requires exactly one initialized default tenant');
    this.name = 'TenantSingletonRequiredError';
    this.code = 'TENANT_SINGLE_DEFAULT_REQUIRED';
    this.statusCode = 503;
    this.details = details;
  }
}

function resolveSequelize(models) {
  return models?.sequelize ||
    models?.Organization?.sequelize ||
    models?.Club?.sequelize ||
    null;
}

async function classifyExactLegacySnapshot({ models, transaction }) {
  const sequelize = resolveSequelize(models);
  if (!sequelize) {
    throw new TenantSingletonRequiredError({
      reasons: ['tenant foundation sequelize authority is unavailable'],
    });
  }
  const {
    classifyLegacySnapshot,
    loadTenantFoundationSnapshot,
  } = require('../services/tenant-foundation.service');
  const classify = async (activeTransaction) => {
    const snapshot = await loadTenantFoundationSnapshot({
      lock: true,
      sequelize,
      transaction: activeTransaction,
    });
    return classifyLegacySnapshot(snapshot);
  };
  if (transaction) return classify(transaction);
  const SequelizePackage = require('sequelize');
  return sequelize.transaction(
    {
      isolationLevel:
        SequelizePackage.Transaction.ISOLATION_LEVELS.REPEATABLE_READ,
    },
    classify,
  );
}

async function requireExactSingletonDefault({
  models = null,
  requireClub = true,
  transaction,
} = {}) {
  const db = models || require('../../models');
  const classification = await classifyExactLegacySnapshot({
    models: db,
    transaction,
  });
  if (classification.state !== TENANT_FOUNDATION_STATES.INITIALIZED) {
    throw new TenantSingletonRequiredError({
      checksum: classification.checksum,
      counts: classification.counts,
      reasons: classification.diagnostics?.reasons || [],
      requireClub,
      state: classification.state,
    });
  }
  // requireClub controls only what the legacy caller consumes. Eligibility
  // always requires the classifier's exact one-Organization/one-Club graph.
  return Object.freeze({
    clubId: requireClub ? Number(classification.defaultClubId) : null,
    organizationId: Number(classification.defaultOrganizationId),
  });
}

module.exports = {
  TenantSingletonRequiredError,
  classifyExactLegacySnapshot,
  requireExactSingletonDefault,
};
