module.exports = (sequelize, DataTypes) => {
  const MotivationBonusRuleCategory = sequelize.define(
    'MotivationBonusRuleCategory',
    {
      bonusRuleId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      categoryId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
    },
  );

  return MotivationBonusRuleCategory;
};
