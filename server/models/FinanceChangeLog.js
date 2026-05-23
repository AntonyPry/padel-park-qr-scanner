module.exports = (sequelize, DataTypes) => {
  const FinanceChangeLog = sequelize.define('FinanceChangeLog', {
    action: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    entityType: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    entityId: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    date: {
      type: DataTypes.DATEONLY,
      allowNull: true,
    },
    fromDate: {
      type: DataTypes.DATEONLY,
      allowNull: true,
    },
    toDate: {
      type: DataTypes.DATEONLY,
      allowNull: true,
    },
    accountId: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    role: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    reason: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    beforeData: {
      type: DataTypes.JSON,
      allowNull: true,
    },
    afterData: {
      type: DataTypes.JSON,
      allowNull: true,
    },
  });

  FinanceChangeLog.associate = (models) => {
    FinanceChangeLog.belongsTo(models.Account, {
      as: 'account',
      foreignKey: 'accountId',
    });
  };

  return FinanceChangeLog;
};
