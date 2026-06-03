module.exports = (sequelize, DataTypes) => {
  const TrainingNote = sequelize.define('TrainingNote', {
    userId: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    trainerAccountId: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    trainedAt: {
      type: DataTypes.DATEONLY,
      allowNull: false,
    },
    level: {
      type: DataTypes.ENUM('D', 'D+', 'C', 'C+', 'B', 'B+', 'A'),
      allowNull: false,
    },
    exercises: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    note: {
      type: DataTypes.TEXT,
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
  });

  TrainingNote.associate = (models) => {
    TrainingNote.belongsTo(models.User, { foreignKey: 'userId' });
    TrainingNote.belongsTo(models.Account, {
      as: 'trainerAccount',
      foreignKey: 'trainerAccountId',
    });
    TrainingNote.hasMany(models.TrainingNoteExercise, {
      as: 'exerciseResults',
      foreignKey: 'trainingNoteId',
    });
    TrainingNote.hasOne(models.TrainingPlanParticipant, {
      as: 'planParticipant',
      foreignKey: 'trainingNoteId',
    });
  };

  return TrainingNote;
};
