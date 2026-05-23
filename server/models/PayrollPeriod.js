module.exports = (sequelize, DataTypes) => {
  const PayrollPeriod = sequelize.define('PayrollPeriod', {
    fromDate: {
      type: DataTypes.DATEONLY,
      allowNull: false,
    },
    toDate: {
      type: DataTypes.DATEONLY,
      allowNull: false,
    },
    status: {
      type: DataTypes.ENUM('draft', 'reviewed', 'approved', 'paid'),
      allowNull: false,
      defaultValue: 'draft',
    },
    note: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    snapshot: {
      type: DataTypes.JSON,
      allowNull: true,
    },
    reviewedByAccountId: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    reviewedAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    approvedByAccountId: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    approvedAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    paidByAccountId: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    paidAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
  });

  PayrollPeriod.associate = (models) => {
    PayrollPeriod.belongsTo(models.Account, {
      as: 'reviewedBy',
      foreignKey: 'reviewedByAccountId',
    });
    PayrollPeriod.belongsTo(models.Account, {
      as: 'approvedBy',
      foreignKey: 'approvedByAccountId',
    });
    PayrollPeriod.belongsTo(models.Account, {
      as: 'paidBy',
      foreignKey: 'paidByAccountId',
    });
  };

  return PayrollPeriod;
};
