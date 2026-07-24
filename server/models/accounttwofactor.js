'use strict';

module.exports = (sequelize, DataTypes) => {
  const AccountTwoFactor = sequelize.define(
    'AccountTwoFactor',
    {
      id: {
        allowNull: false,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
        type: DataTypes.UUID,
      },
      accountId: {
        allowNull: false,
        type: DataTypes.INTEGER,
        unique: true,
      },
      secretCiphertext: {
        allowNull: true,
        type: DataTypes.TEXT('medium'),
      },
      keyVersion: {
        allowNull: true,
        type: DataTypes.INTEGER,
      },
      pendingSecretCiphertext: {
        allowNull: true,
        type: DataTypes.TEXT('medium'),
      },
      pendingKeyVersion: {
        allowNull: true,
        type: DataTypes.INTEGER,
      },
      pendingStartedAt: {
        allowNull: true,
        type: DataTypes.DATE,
      },
      status: {
        allowNull: false,
        defaultValue: 'pending',
        type: DataTypes.ENUM('pending', 'active', 'disabled'),
      },
      factorVersion: {
        allowNull: false,
        defaultValue: 1,
        type: DataTypes.INTEGER,
      },
      recoveryGeneration: {
        allowNull: false,
        defaultValue: 0,
        type: DataTypes.INTEGER,
      },
      lastUsedCounter: {
        allowNull: true,
        type: DataTypes.BIGINT.UNSIGNED,
      },
      enrolledAt: {
        allowNull: true,
        type: DataTypes.DATE,
      },
      disabledAt: {
        allowNull: true,
        type: DataTypes.DATE,
      },
    },
    {
      defaultScope: {
        attributes: { exclude: ['pendingSecretCiphertext', 'secretCiphertext'] },
      },
      tableName: 'AccountTwoFactors',
    },
  );

  AccountTwoFactor.associate = (models) => {
    AccountTwoFactor.belongsTo(models.Account, { foreignKey: 'accountId' });
    AccountTwoFactor.hasMany(models.TwoFactorRecoveryCode, {
      as: 'recoveryCodes',
      foreignKey: 'accountTwoFactorId',
    });
  };

  return AccountTwoFactor;
};
