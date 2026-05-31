module.exports = (sequelize, DataTypes) => {
  const OnboardingProgress = sequelize.define('OnboardingProgress', {
    accountId: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    role: {
      type: DataTypes.ENUM(
        'owner',
        'manager',
        'admin',
        'accountant',
        'viewer',
        'trainer',
      ),
      allowNull: false,
    },
    taskKey: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    status: {
      type: DataTypes.ENUM('in_progress', 'completed', 'skipped'),
      allowNull: false,
      defaultValue: 'in_progress',
    },
    completedAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    metadata: {
      type: DataTypes.JSON,
      allowNull: true,
    },
  });

  OnboardingProgress.associate = (models) => {
    OnboardingProgress.belongsTo(models.Account, {
      as: 'account',
      foreignKey: 'accountId',
    });
  };

  return OnboardingProgress;
};
