module.exports = (sequelize, DataTypes) => {
  const ShiftCashSession = sequelize.define('ShiftCashSession', {
    shiftId: { allowNull: false, type: DataTypes.INTEGER },
    contextKey: { allowNull: false, type: DataTypes.STRING },
    status: { allowNull: false, defaultValue: 'open', type: DataTypes.STRING },
    openingBanknotes: { allowNull: true, type: DataTypes.DECIMAL(12, 2) },
    openingCoins: { allowNull: true, type: DataTypes.DECIMAL(12, 2) },
    openingComment: { allowNull: true, type: DataTypes.TEXT },
    openingRecordedAt: { allowNull: true, type: DataTypes.DATE },
    openingRecordedByAccountId: { allowNull: true, type: DataTypes.INTEGER },
    closingBanknotes: { allowNull: true, type: DataTypes.DECIMAL(12, 2) },
    closingCoins: { allowNull: true, type: DataTypes.DECIMAL(12, 2) },
    closingComment: { allowNull: true, type: DataTypes.TEXT },
    closingRecordedAt: { allowNull: true, type: DataTypes.DATE },
    closingRecordedByAccountId: { allowNull: true, type: DataTypes.INTEGER },
    cashSalesSnapshot: { allowNull: true, type: DataTypes.DECIMAL(12, 2) },
    expensesSnapshot: { allowNull: true, type: DataTypes.DECIMAL(12, 2) },
    manualAdjustmentsSnapshot: {
      allowNull: false,
      defaultValue: 0,
      type: DataTypes.DECIMAL(12, 2),
    },
    expectedClosingCash: { allowNull: true, type: DataTypes.DECIMAL(12, 2) },
    variance: { allowNull: true, type: DataTypes.DECIMAL(12, 2) },
    isTraining: { allowNull: false, defaultValue: false, type: DataTypes.BOOLEAN },
    trainingRole: { allowNull: true, type: DataTypes.STRING },
    trainingAccountId: { allowNull: true, type: DataTypes.INTEGER },
  });

  ShiftCashSession.associate = (models) => {
    ShiftCashSession.belongsTo(models.Shift, { as: 'shift', foreignKey: 'shiftId' });
    ShiftCashSession.hasMany(models.ShiftCashExpense, {
      as: 'expenses',
      foreignKey: 'cashSessionId',
    });
    ShiftCashSession.belongsTo(models.Account, {
      as: 'openingRecordedBy',
      foreignKey: 'openingRecordedByAccountId',
    });
    ShiftCashSession.belongsTo(models.Account, {
      as: 'closingRecordedBy',
      foreignKey: 'closingRecordedByAccountId',
    });
    ShiftCashSession.belongsTo(models.Account, {
      as: 'trainingAccount',
      foreignKey: 'trainingAccountId',
    });
  };

  return ShiftCashSession;
};
