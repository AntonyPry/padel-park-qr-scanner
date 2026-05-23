module.exports = (sequelize, DataTypes) => {
  const ScannerEvent = sequelize.define('ScannerEvent', {
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
  });

  ScannerEvent.associate = (models) => {
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
