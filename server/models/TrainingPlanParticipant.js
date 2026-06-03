module.exports = (sequelize, DataTypes) => {
  const TrainingPlanParticipant = sequelize.define('TrainingPlanParticipant', {
    trainingPlanId: {
      allowNull: false,
      type: DataTypes.INTEGER,
    },
    userId: {
      allowNull: false,
      type: DataTypes.INTEGER,
    },
    trainingNoteId: {
      allowNull: true,
      type: DataTypes.INTEGER,
    },
  });

  TrainingPlanParticipant.associate = (models) => {
    TrainingPlanParticipant.belongsTo(models.TrainingPlan, {
      as: 'plan',
      foreignKey: 'trainingPlanId',
    });
    TrainingPlanParticipant.belongsTo(models.User, {
      as: 'client',
      foreignKey: 'userId',
    });
    TrainingPlanParticipant.belongsTo(models.TrainingNote, {
      as: 'trainingNote',
      foreignKey: 'trainingNoteId',
    });
  };

  return TrainingPlanParticipant;
};
