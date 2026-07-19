'use strict';

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
    { tableName: 'OwnerActivationTokens' },
  );

  OwnerActivationToken.associate = (models) => {
    OwnerActivationToken.belongsTo(models.Organization, {
      foreignKey: 'organizationId',
    });
    OwnerActivationToken.belongsTo(models.Account, { foreignKey: 'accountId' });
  };

  return OwnerActivationToken;
};
