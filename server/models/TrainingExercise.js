module.exports = (sequelize, DataTypes) => {
  const TrainingExercise = sequelize.define('TrainingExercise', {
    organizationId: {
      allowNull: false,
      type: DataTypes.INTEGER,
    },
    name: {
      allowNull: false,
      type: DataTypes.STRING,
    },
    description: {
      allowNull: true,
      type: DataTypes.TEXT,
    },
    successCriterion: {
      allowNull: true,
      type: DataTypes.TEXT,
    },
    simplification: {
      allowNull: true,
      type: DataTypes.TEXT,
    },
    complication: {
      allowNull: true,
      type: DataTypes.TEXT,
    },
    mainSkillId: {
      allowNull: true,
      type: DataTypes.INTEGER,
    },
    eLevel: {
      allowNull: true,
      type: DataTypes.ENUM('E1', 'E2', 'E3', 'E4', 'E5', 'E6', 'E7'),
    },
    skillLevelMin: {
      allowNull: true,
      type: DataTypes.INTEGER,
    },
    skillLevelMax: {
      allowNull: true,
      type: DataTypes.INTEGER,
    },
    formats: {
      allowNull: false,
      type: DataTypes.JSON,
    },
    status: {
      allowNull: false,
      defaultValue: 'draft',
      type: DataTypes.ENUM('draft', 'approved', 'archived'),
    },
    createdByAccountId: {
      allowNull: true,
      type: DataTypes.INTEGER,
    },
    updatedByAccountId: {
      allowNull: true,
      type: DataTypes.INTEGER,
    },
    approvedByAccountId: {
      allowNull: true,
      type: DataTypes.INTEGER,
    },
    approvedAt: {
      allowNull: true,
      type: DataTypes.DATE,
    },
  }, {
    hooks: {
      beforeBulkUpdate(options) {
        if (Object.prototype.hasOwnProperty.call(
          options.attributes || {},
          'organizationId',
        )) {
          const error = new Error('TrainingExercise organization attribution is immutable');
          error.code = 'TRAINING_EXERCISE_ORGANIZATION_IMMUTABLE';
          throw error;
        }
      },
      beforeUpdate(exercise) {
        if (exercise.changed('organizationId')) {
          const error = new Error('TrainingExercise organization attribution is immutable');
          error.code = 'TRAINING_EXERCISE_ORGANIZATION_IMMUTABLE';
          throw error;
        }
      },
    },
  });

  TrainingExercise.associate = (models) => {
    TrainingExercise.belongsTo(models.Organization, { foreignKey: 'organizationId' });
    TrainingExercise.belongsTo(models.TrainingSkill, {
      as: 'mainSkill',
      foreignKey: 'mainSkillId',
    });
    TrainingExercise.belongsToMany(models.TrainingSkill, {
      as: 'additionalSkills',
      foreignKey: 'trainingExerciseId',
      otherKey: 'trainingSkillId',
      through: models.TrainingExerciseSkill,
    });
    TrainingExercise.belongsTo(models.Account, {
      as: 'createdBy',
      foreignKey: 'createdByAccountId',
    });
    TrainingExercise.belongsTo(models.Account, {
      as: 'updatedBy',
      foreignKey: 'updatedByAccountId',
    });
    TrainingExercise.belongsTo(models.Account, {
      as: 'approvedBy',
      foreignKey: 'approvedByAccountId',
    });
    TrainingExercise.hasMany(models.TrainingNoteExercise, {
      as: 'noteResults',
      foreignKey: 'trainingExerciseId',
    });
    TrainingExercise.hasMany(models.TrainingPlanExercise, {
      as: 'plannedUses',
      foreignKey: 'trainingExerciseId',
    });
  };

  return TrainingExercise;
};
