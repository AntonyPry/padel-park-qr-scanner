const {
  assertBulkFieldsAreMutable,
} = require('../src/provider-integrations/immutable-attribution');

const IMMUTABLE_PROVIDER_FIELDS = Object.freeze([
  'organizationId',
  'clubId',
  'integrationConnectionId',
  'idempotencyKey',
]);

module.exports = (sequelize, DataTypes) => {
  const TelephonyRawEvent = sequelize.define('TelephonyRawEvent', {
    organizationId: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    clubId: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    integrationConnectionId: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    idempotencyKey: {
      type: DataTypes.STRING(64),
      allowNull: true,
    },
    deliveryCount: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 1,
    },
    lastReceivedAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    provider: {
      type: DataTypes.ENUM('beeline'),
      allowNull: false,
      defaultValue: 'beeline',
    },
    eventType: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    externalEventId: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    payload: {
      type: DataTypes.JSON,
      allowNull: false,
    },
    headers: {
      type: DataTypes.JSON,
      allowNull: true,
    },
    query: {
      type: DataTypes.JSON,
      allowNull: true,
    },
    sourceIp: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    receivedAt: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
    processingStatus: {
      type: DataTypes.ENUM('new', 'processed', 'failed'),
      allowNull: false,
      defaultValue: 'new',
    },
    processingError: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    telephonyCallId: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
  }, {
    hooks: {
      beforeBulkUpdate(options) {
        assertBulkFieldsAreMutable(
          options,
          IMMUTABLE_PROVIDER_FIELDS,
          'Raw event provider attribution is immutable',
        );
      },
      beforeUpdate(event) {
        if (IMMUTABLE_PROVIDER_FIELDS.some((field) => event.changed(field))) {
          const error = new Error('Raw event provider attribution is immutable');
          error.code = 'PROVIDER_ATTRIBUTION_IMMUTABLE';
          throw error;
        }
      },
    },
  });

  TelephonyRawEvent.associate = (models) => {
    TelephonyRawEvent.belongsTo(models.IntegrationConnection, {
      as: 'integrationConnection',
      foreignKey: 'integrationConnectionId',
    });
    TelephonyRawEvent.belongsTo(models.TelephonyCall, {
      as: 'call',
      foreignKey: 'telephonyCallId',
    });
  };

  return TelephonyRawEvent;
};
