const {
  createNullableTenantAttributionHooks,
} = require('../src/tenant-context/model-attribution');

module.exports = (sequelize, DataTypes) => {
  const Finance = sequelize.define('Finance', {
    organizationId: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    clubId: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    date: {
      type: DataTypes.DATEONLY,
      allowNull: false,
    },
    category: {
      type: DataTypes.STRING,
      allowNull: false, // Например: 'Аренда кортов', 'Бар', 'Зарплата', 'Налоги'
    },
    amount: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
    },
    type: {
      type: DataTypes.ENUM('income', 'expense'),
      allowNull: false,
    },
    comment: {
      type: DataTypes.TEXT,
    },
    createdByAccountId: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    isTraining: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    trainingRole: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    trainingAccountId: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
  }, {
    hooks: createNullableTenantAttributionHooks(
      ['organizationId', 'clubId'],
      'Finance',
    ),
  });

  Finance.associate = (models) => {
    Finance.belongsTo(models.Organization, { foreignKey: 'organizationId' });
    Finance.belongsTo(models.Club, { foreignKey: 'clubId' });
    Finance.belongsTo(models.Account, {
      as: 'createdBy',
      foreignKey: 'createdByAccountId',
    });
    Finance.hasOne(models.ShiftCashExpense, {
      as: 'shiftCashExpense',
      foreignKey: 'financeId',
    });
  };

  return Finance;
};
