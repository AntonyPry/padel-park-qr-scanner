'use strict';

const {
  TRAINING_EXERCISE_E_LEVEL_VALUES,
} = require('../src/constants/training-methodology');

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('ClientTrainingSkills', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER,
      },
      userId: {
        allowNull: false,
        references: {
          key: 'id',
          model: 'Users',
        },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
        type: Sequelize.INTEGER,
      },
      trainingSkillId: {
        allowNull: false,
        references: {
          key: 'id',
          model: 'TrainingSkills',
        },
        onDelete: 'RESTRICT',
        onUpdate: 'CASCADE',
        type: Sequelize.INTEGER,
      },
      level: {
        allowNull: false,
        defaultValue: 0,
        type: Sequelize.INTEGER,
      },
      lastTrainedAt: {
        allowNull: true,
        type: Sequelize.DATEONLY,
      },
      latestExercises: {
        allowNull: true,
        type: Sequelize.TEXT,
      },
      latestAssessment: {
        allowNull: true,
        type: Sequelize.TEXT,
      },
      repeatFlag: {
        allowNull: false,
        defaultValue: false,
        type: Sequelize.BOOLEAN,
      },
      nextEStep: {
        allowNull: true,
        type: Sequelize.ENUM(...TRAINING_EXERCISE_E_LEVEL_VALUES),
      },
      isTraining: {
        allowNull: false,
        defaultValue: false,
        type: Sequelize.BOOLEAN,
      },
      trainingRole: {
        allowNull: true,
        type: Sequelize.STRING,
      },
      trainingAccountId: {
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

    await queryInterface.addIndex('ClientTrainingSkills', ['userId', 'trainingSkillId'], {
      name: 'client_training_skills_user_skill_unique',
      unique: true,
    });
    await queryInterface.addIndex('ClientTrainingSkills', ['trainingSkillId'], {
      name: 'client_training_skills_skill_idx',
    });
    await queryInterface.addIndex('ClientTrainingSkills', ['isTraining', 'trainingRole'], {
      name: 'client_training_skills_training_scope_idx',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('ClientTrainingSkills');
  },
};
