module.exports = (sequelize, DataTypes) => {
  const TrainingPlanExercise = sequelize.define('TrainingPlanExercise', {
    trainingPlanId: {
      allowNull: false,
      type: DataTypes.INTEGER,
    },
    trainingExerciseId: {
      allowNull: true,
      type: DataTypes.INTEGER,
    },
    orderIndex: {
      allowNull: false,
      defaultValue: 0,
      type: DataTypes.INTEGER,
    },
    blockKey: {
      allowNull: true,
      type: DataTypes.STRING,
    },
    blockTitle: {
      allowNull: true,
      type: DataTypes.STRING,
    },
    exerciseNameSnapshot: {
      allowNull: false,
      type: DataTypes.STRING,
    },
    reasonSnapshot: {
      allowNull: true,
      type: DataTypes.TEXT,
    },
  });

  TrainingPlanExercise.associate = (models) => {
    TrainingPlanExercise.belongsTo(models.TrainingPlan, {
      as: 'plan',
      foreignKey: 'trainingPlanId',
    });
    TrainingPlanExercise.belongsTo(models.TrainingExercise, {
      as: 'exercise',
      foreignKey: 'trainingExerciseId',
    });
  };

  return TrainingPlanExercise;
};
