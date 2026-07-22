module.exports = (sequelize, DataTypes) => {
  const TrainingSkill = sequelize.define('TrainingSkill', {
    organizationId: {
      allowNull: false,
      type: DataTypes.INTEGER,
    },
    name: {
      allowNull: false,
      type: DataTypes.STRING,
    },
    direction: {
      allowNull: false,
      type: DataTypes.ENUM(
        'technique',
        'tactics',
        'game_situations',
        'pair_interaction',
        'physical_coordination',
      ),
    },
    description: {
      allowNull: true,
      type: DataTypes.TEXT,
    },
    status: {
      allowNull: false,
      defaultValue: 'active',
      type: DataTypes.ENUM('active', 'archived'),
    },
    createdByAccountId: {
      allowNull: true,
      type: DataTypes.INTEGER,
    },
    updatedByAccountId: {
      allowNull: true,
      type: DataTypes.INTEGER,
    },
  }, {
    hooks: {
      beforeBulkUpdate(options) {
        if (Object.prototype.hasOwnProperty.call(
          options.attributes || {},
          'organizationId',
        )) {
          const error = new Error('TrainingSkill organization attribution is immutable');
          error.code = 'TRAINING_SKILL_ORGANIZATION_IMMUTABLE';
          throw error;
        }
      },
      beforeUpdate(skill) {
        if (skill.changed('organizationId')) {
          const error = new Error('TrainingSkill organization attribution is immutable');
          error.code = 'TRAINING_SKILL_ORGANIZATION_IMMUTABLE';
          throw error;
        }
      },
    },
  });

  TrainingSkill.associate = (models) => {
    TrainingSkill.belongsTo(models.Organization, { foreignKey: 'organizationId' });
    TrainingSkill.belongsTo(models.Account, {
      as: 'createdBy',
      foreignKey: 'createdByAccountId',
    });
    TrainingSkill.belongsTo(models.Account, {
      as: 'updatedBy',
      foreignKey: 'updatedByAccountId',
    });
    TrainingSkill.hasMany(models.TrainingExercise, {
      as: 'mainExercises',
      foreignKey: 'mainSkillId',
    });
    TrainingSkill.belongsToMany(models.TrainingExercise, {
      as: 'additionalExercises',
      foreignKey: 'trainingSkillId',
      otherKey: 'trainingExerciseId',
      through: models.TrainingExerciseSkill,
    });
    TrainingSkill.hasMany(models.ClientTrainingSkill, {
      as: 'clientSkillLevels',
      foreignKey: 'trainingSkillId',
    });
  };

  return TrainingSkill;
};
