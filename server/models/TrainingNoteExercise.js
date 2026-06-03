module.exports = (sequelize, DataTypes) => {
  const TrainingNoteExercise = sequelize.define('TrainingNoteExercise', {
    trainingNoteId: {
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
    exerciseNameSnapshot: {
      allowNull: false,
      type: DataTypes.STRING,
    },
    rating: {
      allowNull: false,
      type: DataTypes.INTEGER,
    },
    repeatSkill: {
      allowNull: false,
      defaultValue: false,
      type: DataTypes.BOOLEAN,
    },
    repeatExercise: {
      allowNull: false,
      defaultValue: false,
      type: DataTypes.BOOLEAN,
    },
    canAdvance: {
      allowNull: false,
      defaultValue: false,
      type: DataTypes.BOOLEAN,
    },
    comment: {
      allowNull: true,
      type: DataTypes.TEXT,
    },
  });

  TrainingNoteExercise.associate = (models) => {
    TrainingNoteExercise.belongsTo(models.TrainingNote, {
      as: 'trainingNote',
      foreignKey: 'trainingNoteId',
    });
    TrainingNoteExercise.belongsTo(models.TrainingExercise, {
      as: 'exercise',
      foreignKey: 'trainingExerciseId',
    });
  };

  return TrainingNoteExercise;
};
