'use strict';

const {
  assertBulkAuthorityFieldsAreMutable,
  assertInstanceAuthorityFieldsAreMutable,
  immutableAuthorityError,
} = require('../src/tenant-enforcement/immutable-authority');

const IMMUTABLE_FIELDS = Object.freeze([
  'organizationId',
  'accountId',
  'tokenHash',
  'expiresAt',
  'createdAt',
]);

module.exports = (sequelize, DataTypes) => {
  const OwnerActivationToken = sequelize.define(
    'OwnerActivationToken',
    {
      organizationId: { allowNull: false, type: DataTypes.INTEGER },
      accountId: { allowNull: false, type: DataTypes.INTEGER },
      tokenHash: { allowNull: false, type: DataTypes.STRING(64) },
      expiresAt: { allowNull: false, type: DataTypes.DATE },
      consumedAt: { allowNull: true, type: DataTypes.DATE },
      invalidatedAt: { allowNull: true, type: DataTypes.DATE },
    },
    {
      hooks: {
        beforeBulkDestroy() {
          throw immutableAuthorityError('Owner activation history is immutable');
        },
        beforeBulkUpdate(options) {
          assertBulkAuthorityFieldsAreMutable(
            options,
            IMMUTABLE_FIELDS,
            'Owner activation authority is immutable',
          );
        },
        beforeDestroy() {
          throw immutableAuthorityError('Owner activation history is immutable');
        },
        beforeUpdate(token) {
          assertInstanceAuthorityFieldsAreMutable(
            token,
            IMMUTABLE_FIELDS,
            'Owner activation authority is immutable',
          );
        },
      },
      tableName: 'OwnerActivationTokens',
    },
  );

  OwnerActivationToken.associate = (models) => {
    OwnerActivationToken.belongsTo(models.Organization, {
      foreignKey: 'organizationId',
    });
    OwnerActivationToken.belongsTo(models.Account, { foreignKey: 'accountId' });
  };

  return OwnerActivationToken;
};
