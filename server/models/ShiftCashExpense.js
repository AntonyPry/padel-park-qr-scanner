module.exports = (sequelize, DataTypes) => {
  const ShiftCashExpense = sequelize.define('ShiftCashExpense', {
    shiftId: { allowNull: false, type: DataTypes.INTEGER },
    cashSessionId: { allowNull: false, type: DataTypes.INTEGER },
    amount: { allowNull: false, type: DataTypes.DECIMAL(12, 2) },
    description: { allowNull: false, type: DataTypes.TEXT },
    spentAt: { allowNull: false, type: DataTypes.DATE },
    createdByAccountId: { allowNull: true, type: DataTypes.INTEGER },
    status: { allowNull: false, defaultValue: 'active', type: DataTypes.STRING },
    canceledAt: { allowNull: true, type: DataTypes.DATE },
    canceledByAccountId: { allowNull: true, type: DataTypes.INTEGER },
    cancelReason: { allowNull: true, type: DataTypes.TEXT },
    financeId: { allowNull: true, type: DataTypes.INTEGER },
    attachments: { allowNull: false, defaultValue: [], type: DataTypes.JSON },
    isTraining: { allowNull: false, defaultValue: false, type: DataTypes.BOOLEAN },
    trainingRole: { allowNull: true, type: DataTypes.STRING },
    trainingAccountId: { allowNull: true, type: DataTypes.INTEGER },
    trainingSessionId: { allowNull: true, type: DataTypes.UUID },
  });

  ShiftCashExpense.associate = (models) => {
    ShiftCashExpense.belongsTo(models.Shift, { as: 'shift', foreignKey: 'shiftId' });
    ShiftCashExpense.belongsTo(models.ShiftCashSession, {
      as: 'cashSession',
      foreignKey: 'cashSessionId',
    });
    ShiftCashExpense.belongsTo(models.Finance, {
      as: 'finance',
      foreignKey: 'financeId',
    });
    ShiftCashExpense.belongsTo(models.Account, {
      as: 'createdBy',
      foreignKey: 'createdByAccountId',
    });
    ShiftCashExpense.belongsTo(models.Account, {
      as: 'canceledBy',
      foreignKey: 'canceledByAccountId',
    });
    ShiftCashExpense.belongsTo(models.Account, {
      as: 'trainingAccount',
      foreignKey: 'trainingAccountId',
    });
  };

  return ShiftCashExpense;
};
