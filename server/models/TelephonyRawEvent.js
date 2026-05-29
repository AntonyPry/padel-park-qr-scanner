module.exports = (sequelize, DataTypes) => {
  const TelephonyRawEvent = sequelize.define('TelephonyRawEvent', {
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
  });

  TelephonyRawEvent.associate = (models) => {
    TelephonyRawEvent.belongsTo(models.TelephonyCall, {
      as: 'call',
      foreignKey: 'telephonyCallId',
    });
  };

  return TelephonyRawEvent;
};
