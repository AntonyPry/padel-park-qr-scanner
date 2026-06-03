module.exports = (sequelize, DataTypes) => {
  const TrainingExerciseSkill = sequelize.define(
    'TrainingExerciseSkill',
    {
      trainingExerciseId: {
        allowNull: false,
        primaryKey: true,
        type: DataTypes.INTEGER,
      },
      trainingSkillId: {
        allowNull: false,
        primaryKey: true,
        type: DataTypes.INTEGER,
      },
    },
    {
      timestamps: false,
    },
  );

  return TrainingExerciseSkill;
};
