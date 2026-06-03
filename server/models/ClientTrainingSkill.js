module.exports = (sequelize, DataTypes) => {
  const ClientTrainingSkill = sequelize.define('ClientTrainingSkill', {
    userId: {
      allowNull: false,
      type: DataTypes.INTEGER,
    },
    trainingSkillId: {
      allowNull: false,
      type: DataTypes.INTEGER,
    },
    level: {
      allowNull: false,
      defaultValue: 0,
      type: DataTypes.INTEGER,
    },
    autoBaselineLevel: {
      allowNull: true,
      type: DataTypes.INTEGER,
    },
    lastTrainedAt: {
      allowNull: true,
      type: DataTypes.DATEONLY,
    },
    latestExercises: {
      allowNull: true,
      type: DataTypes.TEXT,
    },
    latestAssessment: {
      allowNull: true,
      type: DataTypes.TEXT,
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
    updatedByAccountId: {
      allowNull: true,
      type: DataTypes.INTEGER,
    },
  });

  ClientTrainingSkill.associate = (models) => {
    ClientTrainingSkill.belongsTo(models.User, { foreignKey: 'userId' });
    ClientTrainingSkill.belongsTo(models.TrainingSkill, {
      as: 'skill',
      foreignKey: 'trainingSkillId',
    });
    ClientTrainingSkill.belongsTo(models.Account, {
      as: 'trainingAccount',
      foreignKey: 'trainingAccountId',
    });
    ClientTrainingSkill.belongsTo(models.Account, {
      as: 'updatedBy',
      foreignKey: 'updatedByAccountId',
    });
    ClientTrainingSkill.hasMany(models.ClientTrainingSkillHistory, {
      as: 'history',
      foreignKey: 'clientTrainingSkillId',
    });
  };

  return ClientTrainingSkill;
};
