'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { QueryTypes } = require('sequelize');

const {
  createCapabilityTenantAttributionHooks,
} = require('../../src/tenant-context/model-attribution');

test('tenant attribution hooks allow unrelated partial updates', async () => {
  const hooks = createCapabilityTenantAttributionHooks(
    ['organizationId', 'clubId'],
    'Fixture',
    () => true,
  );
  const partialUpdate = {
    changed(field) {
      return field === 'clientId';
    },
    isNewRecord: true,
  };

  await hooks.beforeValidate(partialUpdate, {
    fields: ['clientId', 'updatedAt'],
    type: QueryTypes.BULKUPDATE,
  });
  assert.throws(
    () => hooks.beforeBulkUpdate({ fields: ['organizationId'] }),
    /tenant attribution is immutable/,
  );
});

test('tenant attribution hooks still reject missing attribution on create', async () => {
  const hooks = createCapabilityTenantAttributionHooks(
    ['organizationId', 'clubId'],
    'Fixture',
    () => true,
  );
  const newRecord = {
    changed() {
      return false;
    },
    isNewRecord: true,
  };

  await assert.rejects(
    hooks.beforeValidate(newRecord, {}),
    (error) => error.code === 'TENANT_CONTEXT_REQUIRED',
  );
});
