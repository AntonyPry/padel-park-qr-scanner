module.exports = (sequelize, DataTypes) => {
  const OnboardingEvent = sequelize.define('OnboardingEvent', {
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
    eventKey: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    entityType: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    entityId: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    isTraining: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    payload: {
      type: DataTypes.JSON,
      allowNull: true,
    },
    completedTaskKeys: {
      type: DataTypes.JSON,
      allowNull: true,
    },
  });

  OnboardingEvent.associate = (models) => {
    OnboardingEvent.belongsTo(models.Account, {
      as: 'account',
      foreignKey: 'accountId',
    });
  };

  return OnboardingEvent;
};
