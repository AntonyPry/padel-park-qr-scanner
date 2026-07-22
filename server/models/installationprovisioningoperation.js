'use strict';

const {
  assertBulkAuthorityFieldsAreMutable,
  assertInstanceAuthorityFieldsAreMutable,
  immutableAuthorityError,
} = require('../src/tenant-enforcement/immutable-authority');

const IMMUTABLE_FIELDS = Object.freeze([
  'idempotencyKeyHash',
  'payloadHash',
  'organizationId',
  'ownerAccountId',
  'auditLogId',
  'createdAt',
]);

module.exports = (sequelize, DataTypes) => {
  const InstallationProvisioningOperation = sequelize.define(
    'InstallationProvisioningOperation',
    {
      idempotencyKeyHash: { allowNull: false, type: DataTypes.STRING(64) },
      payloadHash: { allowNull: false, type: DataTypes.STRING(64) },
      organizationId: { allowNull: false, type: DataTypes.INTEGER },
      ownerAccountId: { allowNull: false, type: DataTypes.INTEGER },
      activationTokenId: { allowNull: false, type: DataTypes.INTEGER },
      auditLogId: { allowNull: false, type: DataTypes.INTEGER },
    },
    {
      hooks: {
        beforeBulkDestroy() {
          throw immutableAuthorityError('Provisioning operation history is immutable');
        },
        beforeBulkUpdate(options) {
          assertBulkAuthorityFieldsAreMutable(
            options,
            IMMUTABLE_FIELDS,
            'Provisioning operation authority is immutable',
          );
        },
        beforeDestroy() {
          throw immutableAuthorityError('Provisioning operation history is immutable');
        },
        beforeUpdate(operation) {
          assertInstanceAuthorityFieldsAreMutable(
            operation,
            IMMUTABLE_FIELDS,
            'Provisioning operation authority is immutable',
          );
        },
      },
      tableName: 'InstallationProvisioningOperations',
    },
  );

  InstallationProvisioningOperation.associate = (models) => {
    InstallationProvisioningOperation.belongsTo(models.Organization, {
      foreignKey: 'organizationId',
    });
    InstallationProvisioningOperation.belongsTo(models.Account, {
      as: 'ownerAccount',
      foreignKey: 'ownerAccountId',
    });
    InstallationProvisioningOperation.belongsTo(models.OwnerActivationToken, {
      as: 'activationToken',
      foreignKey: 'activationTokenId',
    });
    InstallationProvisioningOperation.belongsTo(models.AuditLog, {
      as: 'auditLog',
      foreignKey: 'auditLogId',
    });
  };

  return InstallationProvisioningOperation;
};
