'use strict';

const {
  TRAINING_EXERCISE_E_LEVEL_VALUES,
} = require('../src/constants/training-methodology');

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('ClientTrainingSkills', 'autoBaselineLevel', {
      allowNull: true,
      type: Sequelize.INTEGER,
    });

    await queryInterface.createTable('ClientTrainingSkillHistories', {
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
      clientTrainingSkillId: {
        allowNull: false,
        references: {
          key: 'id',
          model: 'ClientTrainingSkills',
        },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
        type: Sequelize.INTEGER,
      },
      trainingNoteId: {
        allowNull: true,
        references: {
          key: 'id',
          model: 'TrainingNotes',
        },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
        type: Sequelize.INTEGER,
      },
      trainingNoteExerciseId: {
        allowNull: true,
        references: {
          key: 'id',
          model: 'TrainingNoteExercises',
        },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
        type: Sequelize.INTEGER,
      },
      source: {
        allowNull: false,
        type: Sequelize.ENUM('manual', 'structured_training'),
      },
      changeType: {
        allowNull: false,
        type: Sequelize.ENUM(
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
        type: Sequelize.INTEGER,
      },
      nextLevel: {
        allowNull: false,
        type: Sequelize.INTEGER,
      },
      rating: {
        allowNull: true,
        type: Sequelize.INTEGER,
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
      eLevel: {
        allowNull: true,
        type: Sequelize.ENUM(...TRAINING_EXERCISE_E_LEVEL_VALUES),
      },
      exerciseNameSnapshot: {
        allowNull: true,
        type: Sequelize.STRING,
      },
      explanation: {
        allowNull: false,
        type: Sequelize.TEXT,
      },
      occurredAt: {
        allowNull: true,
        type: Sequelize.DATEONLY,
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

    await queryInterface.addIndex(
      'ClientTrainingSkillHistories',
      ['userId', 'trainingSkillId', 'source'],
      {
        name: 'client_training_skill_history_user_skill_source_idx',
      },
    );
    await queryInterface.addIndex(
      'ClientTrainingSkillHistories',
      ['trainingNoteId', 'trainingNoteExerciseId'],
      {
        name: 'client_training_skill_history_note_result_idx',
      },
    );
    await queryInterface.addIndex(
      'ClientTrainingSkillHistories',
      ['isTraining', 'trainingRole'],
      {
        name: 'client_training_skill_history_training_scope_idx',
      },
    );
  },

  async down(queryInterface) {
    await queryInterface.dropTable('ClientTrainingSkillHistories');
    await queryInterface.removeColumn('ClientTrainingSkills', 'autoBaselineLevel');
  },
};
