module.exports = (sequelize, DataTypes) => {
  const TrainingPlan = sequelize.define('TrainingPlan', {
    kind: {
      allowNull: false,
      type: DataTypes.ENUM('personal', 'group'),
    },
    status: {
      allowNull: false,
      defaultValue: 'planned',
      type: DataTypes.ENUM('planned', 'completed'),
    },
    sourceType: {
      allowNull: false,
      defaultValue: 'manual',
      type: DataTypes.ENUM('manual', 'personal_recommendation', 'group_recommendation'),
    },
    trainerAccountId: {
      allowNull: true,
      type: DataTypes.INTEGER,
    },
    bookingId: {
      allowNull: true,
      type: DataTypes.INTEGER,
    },
    plannedAt: {
      allowNull: false,
      type: DataTypes.DATEONLY,
    },
    completedAt: {
      allowNull: true,
      type: DataTypes.DATE,
    },
    goal: {
      allowNull: true,
      type: DataTypes.STRING,
    },
    notes: {
      allowNull: true,
      type: DataTypes.TEXT,
    },
    sourceSnapshot: {
      allowNull: true,
      type: DataTypes.JSON,
    },
    isTraining: {
      allowNull: false,
      defaultValue: false,
      type: DataTypes.BOOLEAN,
    },
    trainingRole: {
      allowNull: true,
      type: DataTypes.STRING,
    },
    trainingAccountId: {
      allowNull: true,
      type: DataTypes.INTEGER,
    },
  });

  TrainingPlan.associate = (models) => {
    TrainingPlan.belongsTo(models.Account, {
      as: 'trainerAccount',
      foreignKey: 'trainerAccountId',
    });
    TrainingPlan.belongsTo(models.Booking, {
      as: 'booking',
      foreignKey: 'bookingId',
    });
    TrainingPlan.hasMany(models.TrainingPlanParticipant, {
      as: 'participants',
      foreignKey: 'trainingPlanId',
    });
    TrainingPlan.hasMany(models.TrainingPlanExercise, {
      as: 'plannedExercises',
      foreignKey: 'trainingPlanId',
    });
  };

  return TrainingPlan;
};
