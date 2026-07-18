module.exports = (sequelize, DataTypes) => {
  const ClientTrainingSkillHistory = sequelize.define('ClientTrainingSkillHistory', {
    userId: {
      allowNull: false,
      type: DataTypes.INTEGER,
    },
    trainingSkillId: {
      allowNull: false,
      type: DataTypes.INTEGER,
    },
    clientTrainingSkillId: {
      allowNull: false,
      type: DataTypes.INTEGER,
    },
    trainingNoteId: {
      allowNull: true,
      type: DataTypes.INTEGER,
    },
    trainingNoteExerciseId: {
      allowNull: true,
      type: DataTypes.INTEGER,
    },
    source: {
      allowNull: false,
      type: DataTypes.ENUM('manual', 'structured_training'),
    },
    changeType: {
      allowNull: false,
      type: DataTypes.ENUM(
        'manual_update',
        'advanced',
        'repeat',
        'consolidate',
        'hold',
        'blocked',
        'max_level',
      ),
    },
    previousLevel: {
      allowNull: false,
      type: DataTypes.INTEGER,
    },
    nextLevel: {
      allowNull: false,
      type: DataTypes.INTEGER,
    },
    rating: {
      allowNull: true,
      type: DataTypes.INTEGER,
    },
    repeatFlag: {
      allowNull: false,
      defaultValue: false,
      type: DataTypes.BOOLEAN,
    },
    nextEStep: {
      allowNull: true,
      type: DataTypes.ENUM('E1', 'E2', 'E3', 'E4', 'E5', 'E6', 'E7'),
    },
    eLevel: {
      allowNull: true,
      type: DataTypes.ENUM('E1', 'E2', 'E3', 'E4', 'E5', 'E6', 'E7'),
    },
    exerciseNameSnapshot: {
      allowNull: true,
      type: DataTypes.STRING,
    },
    explanation: {
      allowNull: false,
      type: DataTypes.TEXT,
    },
    occurredAt: {
      allowNull: true,
      type: DataTypes.DATEONLY,
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
    trainingSessionId: { allowNull: true, type: DataTypes.UUID },
    updatedByAccountId: {
      allowNull: true,
      type: DataTypes.INTEGER,
    },
  });

  ClientTrainingSkillHistory.associate = (models) => {
    ClientTrainingSkillHistory.belongsTo(models.User, { foreignKey: 'userId' });
    ClientTrainingSkillHistory.belongsTo(models.TrainingSkill, {
      as: 'skill',
      foreignKey: 'trainingSkillId',
    });
    ClientTrainingSkillHistory.belongsTo(models.ClientTrainingSkill, {
      as: 'clientTrainingSkill',
      foreignKey: 'clientTrainingSkillId',
    });
    ClientTrainingSkillHistory.belongsTo(models.TrainingNote, {
      as: 'trainingNote',
      foreignKey: 'trainingNoteId',
    });
    ClientTrainingSkillHistory.belongsTo(models.TrainingNoteExercise, {
      as: 'trainingNoteExercise',
      foreignKey: 'trainingNoteExerciseId',
    });
    ClientTrainingSkillHistory.belongsTo(models.Account, {
      as: 'updatedBy',
      foreignKey: 'updatedByAccountId',
    });
    ClientTrainingSkillHistory.belongsTo(models.Account, {
      as: 'trainingAccount',
      foreignKey: 'trainingAccountId',
    });
  };

  return ClientTrainingSkillHistory;
};
