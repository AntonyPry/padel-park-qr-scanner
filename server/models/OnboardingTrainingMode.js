module.exports = (sequelize, DataTypes) => {
  const OnboardingTrainingMode = sequelize.define('OnboardingTrainingMode', {
    accountId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      unique: true,
    },
    isEnabled: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
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
      allowNull: true,
    },
    enabledAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    disabledAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    metadata: {
      type: DataTypes.JSON,
      allowNull: true,
    },
  });

  OnboardingTrainingMode.associate = (models) => {
    OnboardingTrainingMode.belongsTo(models.Account, {
      as: 'account',
      foreignKey: 'accountId',
    });
  };

  return OnboardingTrainingMode;
};
