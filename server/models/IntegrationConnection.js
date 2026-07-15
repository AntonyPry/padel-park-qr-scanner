'use strict';

const {
  INTEGRATION_CONNECTION_STATUSES,
  INTEGRATION_PROVIDERS,
  INTEGRATION_PURPOSES,
} = require('../src/provider-integrations/constants');

module.exports = (sequelize, DataTypes) => {
  const IntegrationConnection = sequelize.define(
    'IntegrationConnection',
    {
      publicId: {
        allowNull: false,
        type: DataTypes.STRING(35),
      },
      organizationId: {
        allowNull: false,
        type: DataTypes.INTEGER,
      },
      clubId: {
        allowNull: false,
        type: DataTypes.INTEGER,
      },
      provider: {
        allowNull: false,
        type: DataTypes.ENUM(...INTEGRATION_PROVIDERS),
      },
      purpose: {
        allowNull: false,
        type: DataTypes.ENUM(...INTEGRATION_PURPOSES),
      },
      connectionKey: {
        allowNull: false,
        defaultValue: 'default',
        type: DataTypes.STRING(64),
      },
      status: {
        allowNull: false,
        defaultValue: 'active',
        type: DataTypes.ENUM(...INTEGRATION_CONNECTION_STATUSES),
      },
      config: {
        allowNull: false,
        defaultValue: {},
        type: DataTypes.JSON,
      },
      metadata: {
        allowNull: false,
        defaultValue: {},
        type: DataTypes.JSON,
      },
      secretCiphertext: {
        allowNull: false,
        type: DataTypes.TEXT('long'),
      },
      secretKeyVersion: {
        allowNull: false,
        type: DataTypes.STRING(32),
      },
      secretUpdatedAt: {
        allowNull: false,
        type: DataTypes.DATE,
      },
    },
    {
      defaultScope: {
        attributes: { exclude: ['secretCiphertext', 'secretKeyVersion'] },
      },
      hooks: {
        beforeUpdate(connection) {
          const immutable = [
            'publicId',
            'organizationId',
            'clubId',
            'provider',
            'purpose',
            'connectionKey',
          ];
          if (immutable.some((field) => connection.changed(field))) {
            const error = new Error('Integration connection identity is immutable');
            error.code = 'INTEGRATION_CONNECTION_IDENTITY_IMMUTABLE';
            throw error;
          }
        },
      },
      tableName: 'IntegrationConnections',
    },
  );

  IntegrationConnection.associate = (models) => {
    IntegrationConnection.belongsTo(models.Organization, {
      as: 'organization',
      foreignKey: 'organizationId',
    });
    IntegrationConnection.belongsTo(models.Club, {
      as: 'club',
      foreignKey: 'clubId',
    });
    IntegrationConnection.hasMany(models.TelephonyCall, {
      as: 'telephonyCalls',
      foreignKey: 'integrationConnectionId',
    });
    IntegrationConnection.hasMany(models.TelephonyRawEvent, {
      as: 'telephonyRawEvents',
      foreignKey: 'integrationConnectionId',
    });
    IntegrationConnection.hasMany(models.TelephonySubscription, {
      as: 'telephonySubscriptions',
      foreignKey: 'integrationConnectionId',
    });
    IntegrationConnection.hasMany(models.Receipt, {
      as: 'receipts',
      foreignKey: 'integrationConnectionId',
    });
  };

  return IntegrationConnection;
};
