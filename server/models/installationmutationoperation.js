'use strict';

const {
  immutableAuthorityError,
} = require('../src/tenant-enforcement/immutable-authority');

module.exports = (sequelize, DataTypes) => {
  const InstallationMutationOperation = sequelize.define(
    'InstallationMutationOperation',
    {
      idempotencyKeyHash: { allowNull: false, type: DataTypes.STRING(64) },
      payloadHash: { allowNull: false, type: DataTypes.STRING(64) },
      organizationId: { allowNull: false, type: DataTypes.INTEGER },
      clubId: { allowNull: true, type: DataTypes.INTEGER },
      action: { allowNull: false, type: DataTypes.STRING(96) },
      response: { allowNull: false, type: DataTypes.JSON },
      auditLogId: { allowNull: false, type: DataTypes.INTEGER },
    },
    {
      hooks: {
        beforeBulkDestroy() {
          throw immutableAuthorityError('Installation mutation history is immutable');
        },
        beforeBulkUpdate() {
          throw immutableAuthorityError('Installation mutation history is immutable');
        },
        beforeDestroy() {
          throw immutableAuthorityError('Installation mutation history is immutable');
        },
        beforeUpdate() {
          throw immutableAuthorityError('Installation mutation history is immutable');
        },
      },
      tableName: 'InstallationMutationOperations',
    },
  );

  InstallationMutationOperation.associate = (models) => {
    InstallationMutationOperation.belongsTo(models.Organization, {
      foreignKey: 'organizationId',
    });
    InstallationMutationOperation.belongsTo(models.Club, {
      foreignKey: 'clubId',
    });
    InstallationMutationOperation.belongsTo(models.AuditLog, {
      as: 'auditLog',
      foreignKey: 'auditLogId',
    });
  };

  return InstallationMutationOperation;
};
