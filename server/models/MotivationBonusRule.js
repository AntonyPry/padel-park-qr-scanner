module.exports = (sequelize, DataTypes) => {
  const MotivationBonusRule = sequelize.define('MotivationBonusRule', {
    name: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    bonusPercent: {
      type: DataTypes.DECIMAL(7, 2),
      allowNull: false,
      defaultValue: 0,
    },
    thresholdType: {
      type: DataTypes.ENUM('none', 'revenue', 'quantity'),
      allowNull: false,
      defaultValue: 'none',
    },
    thresholdValue: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false,
      defaultValue: 0,
    },
    sortOrder: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
    isActive: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
  });

  MotivationBonusRule.associate = (models) => {
    MotivationBonusRule.belongsToMany(models.Category, {
      through: models.MotivationBonusRuleCategory,
      as: 'categories',
      foreignKey: 'bonusRuleId',
      otherKey: 'categoryId',
    });
  };

  return MotivationBonusRule;
};
