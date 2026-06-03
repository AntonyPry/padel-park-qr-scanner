'use strict';

const {
  TRAINING_EXERCISE_E_LEVEL_VALUES,
  TRAINING_EXERCISE_STATUS_VALUES,
  TRAINING_SKILL_DIRECTION_VALUES,
  TRAINING_SKILL_STATUS_VALUES,
} = require('../src/constants/training-methodology');

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('TrainingSkills', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER,
      },
      name: {
        allowNull: false,
        type: Sequelize.STRING,
      },
      direction: {
        allowNull: false,
        type: Sequelize.ENUM(...TRAINING_SKILL_DIRECTION_VALUES),
      },
      description: {
        allowNull: true,
        type: Sequelize.TEXT,
      },
      status: {
        allowNull: false,
        defaultValue: 'active',
        type: Sequelize.ENUM(...TRAINING_SKILL_STATUS_VALUES),
      },
      createdByAccountId: {
        allowNull: true,
        references: {
          key: 'id',
          model: 'Accounts',
        },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
        type: Sequelize.INTEGER,
      },
      updatedByAccountId: {
        allowNull: true,
        references: {
          key: 'id',
          model: 'Accounts',
        },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
        type: Sequelize.INTEGER,
      },
      createdAt: {
        allowNull: false,
        type: Sequelize.DATE,
      },
      updatedAt: {
        allowNull: false,
        type: Sequelize.DATE,
      },
    });

    await queryInterface.createTable('TrainingExercises', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER,
      },
      name: {
        allowNull: false,
        type: Sequelize.STRING,
      },
      description: {
        allowNull: true,
        type: Sequelize.TEXT,
      },
      successCriterion: {
        allowNull: true,
        type: Sequelize.TEXT,
      },
      simplification: {
        allowNull: true,
        type: Sequelize.TEXT,
      },
      complication: {
        allowNull: true,
        type: Sequelize.TEXT,
      },
      mainSkillId: {
        allowNull: true,
        references: {
          key: 'id',
          model: 'TrainingSkills',
        },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
        type: Sequelize.INTEGER,
      },
      eLevel: {
        allowNull: true,
        type: Sequelize.ENUM(...TRAINING_EXERCISE_E_LEVEL_VALUES),
      },
      skillLevelMin: {
        allowNull: true,
        type: Sequelize.INTEGER,
      },
      skillLevelMax: {
        allowNull: true,
        type: Sequelize.INTEGER,
      },
      formats: {
        allowNull: false,
        type: Sequelize.JSON,
      },
      status: {
        allowNull: false,
        defaultValue: 'draft',
        type: Sequelize.ENUM(...TRAINING_EXERCISE_STATUS_VALUES),
      },
      createdByAccountId: {
        allowNull: true,
        references: {
          key: 'id',
          model: 'Accounts',
        },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
        type: Sequelize.INTEGER,
      },
      updatedByAccountId: {
        allowNull: true,
        references: {
          key: 'id',
          model: 'Accounts',
        },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
        type: Sequelize.INTEGER,
      },
      approvedByAccountId: {
        allowNull: true,
        references: {
          key: 'id',
          model: 'Accounts',
        },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
        type: Sequelize.INTEGER,
      },
      approvedAt: {
        allowNull: true,
        type: Sequelize.DATE,
      },
      createdAt: {
        allowNull: false,
        type: Sequelize.DATE,
      },
      updatedAt: {
        allowNull: false,
        type: Sequelize.DATE,
      },
    });

    await queryInterface.createTable('TrainingExerciseSkills', {
      trainingExerciseId: {
        allowNull: false,
        primaryKey: true,
        references: {
          key: 'id',
          model: 'TrainingExercises',
        },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
        type: Sequelize.INTEGER,
      },
      trainingSkillId: {
        allowNull: false,
        primaryKey: true,
        references: {
          key: 'id',
          model: 'TrainingSkills',
        },
        onDelete: 'RESTRICT',
        onUpdate: 'CASCADE',
        type: Sequelize.INTEGER,
      },
    });

    await queryInterface.addIndex('TrainingSkills', ['name'], {
      name: 'training_skills_name_unique',
      unique: true,
    });
    await queryInterface.addIndex('TrainingSkills', ['status', 'direction'], {
      name: 'training_skills_status_direction_idx',
    });
    await queryInterface.addIndex('TrainingExercises', ['status', 'eLevel'], {
      name: 'training_exercises_status_elevel_idx',
    });
    await queryInterface.addIndex('TrainingExercises', ['mainSkillId'], {
      name: 'training_exercises_main_skill_idx',
    });
    await queryInterface.addIndex('TrainingExercises', ['createdByAccountId', 'status'], {
      name: 'training_exercises_creator_status_idx',
    });
    await queryInterface.addIndex('TrainingExerciseSkills', ['trainingSkillId'], {
      name: 'training_exercise_skills_skill_idx',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('TrainingExerciseSkills');
    await queryInterface.dropTable('TrainingExercises');
    await queryInterface.dropTable('TrainingSkills');
  },
};
