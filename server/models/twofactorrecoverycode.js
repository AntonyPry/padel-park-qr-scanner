'use strict';

module.exports = (sequelize, DataTypes) => {
  const TwoFactorRecoveryCode = sequelize.define(
    'TwoFactorRecoveryCode',
    {
      id: {
        allowNull: false,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
        type: DataTypes.UUID,
      },
      accountTwoFactorId: {
        allowNull: true,
        type: DataTypes.UUID,
      },
      installationOperatorTwoFactorId: {
        allowNull: true,
        type: DataTypes.UUID,
      },
      generation: {
        allowNull: false,
        type: DataTypes.INTEGER,
      },
      codeDigest: {
        allowNull: false,
        type: DataTypes.CHAR(64).BINARY,
      },
      consumedAt: {
        allowNull: true,
        type: DataTypes.DATE,
      },
      revokedAt: {
        allowNull: true,
        type: DataTypes.DATE,
      },
    },
    {
      defaultScope: {
        attributes: { exclude: ['codeDigest'] },
      },
      tableName: 'TwoFactorRecoveryCodes',
    },
  );

  TwoFactorRecoveryCode.associate = (models) => {
    TwoFactorRecoveryCode.belongsTo(models.AccountTwoFactor, {
      foreignKey: 'accountTwoFactorId',
    });
    TwoFactorRecoveryCode.belongsTo(models.InstallationOperatorTwoFactor, {
      foreignKey: 'installationOperatorTwoFactorId',
    });
  };

  return TwoFactorRecoveryCode;
};
