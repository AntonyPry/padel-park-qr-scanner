module.exports = (sequelize, DataTypes) => {
  const ScannerEvent = sequelize.define('ScannerEvent', {
    organizationId: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    clubId: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    eventType: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    severity: {
      type: DataTypes.ENUM('info', 'warning', 'error'),
      allowNull: false,
      defaultValue: 'info',
    },
    status: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    message: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    code: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    source: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    qrPreview: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    qrHash: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    visitId: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    userId: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    accountId: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    clientEventId: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    metadata: {
      type: DataTypes.JSON,
      allowNull: true,
    },
  }, {
    indexes: [
      {
        fields: ['organizationId', 'clubId', 'clientEventId', 'eventType'],
        name: 'uq_scanner_events_tenant_client_event_type',
        unique: true,
      },
    ],
    hooks: {
      beforeBulkUpdate(options) {
        const attributes = options.attributes || {};
        if (
          Object.prototype.hasOwnProperty.call(attributes, 'organizationId') ||
          Object.prototype.hasOwnProperty.call(attributes, 'clubId')
        ) {
          const error = new Error('Scanner event tenant attribution is immutable');
          error.code = 'SCANNER_EVENT_TENANT_IMMUTABLE';
          throw error;
        }
      },
      beforeUpdate(event) {
        if (event.changed('organizationId') || event.changed('clubId')) {
          const error = new Error('Scanner event tenant attribution is immutable');
          error.code = 'SCANNER_EVENT_TENANT_IMMUTABLE';
          throw error;
        }
      },
    },
  });

  ScannerEvent.associate = (models) => {
    ScannerEvent.belongsTo(models.Organization, { foreignKey: 'organizationId' });
    ScannerEvent.belongsTo(models.Club, { foreignKey: 'clubId' });
    ScannerEvent.belongsTo(models.Account, {
      as: 'account',
      foreignKey: 'accountId',
    });
    ScannerEvent.belongsTo(models.User, {
      as: 'user',
      foreignKey: 'userId',
    });
    ScannerEvent.belongsTo(models.Visit, {
      as: 'visit',
      foreignKey: 'visitId',
    });
  };

  return ScannerEvent;
};
