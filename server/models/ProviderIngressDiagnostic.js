'use strict';

module.exports = (sequelize, DataTypes) => sequelize.define(
  'ProviderIngressDiagnostic',
  {
    provider: {
      allowNull: false,
      type: DataTypes.STRING(32),
    },
    outcome: {
      allowNull: false,
      type: DataTypes.ENUM('rejected'),
    },
    reasonCode: {
      allowNull: false,
      type: DataTypes.STRING(64),
    },
    connectionPublicIdHash: {
      allowNull: true,
      type: DataTypes.STRING(64),
    },
    requestFingerprint: {
      allowNull: true,
      type: DataTypes.STRING(64),
    },
  },
  { tableName: 'ProviderIngressDiagnostics', updatedAt: false },
);
