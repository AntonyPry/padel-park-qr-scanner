'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('TrainingNoteExercises', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER,
      },
      trainingNoteId: {
        allowNull: false,
        references: {
          key: 'id',
          model: 'TrainingNotes',
        },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
        type: Sequelize.INTEGER,
      },
      trainingExerciseId: {
        allowNull: true,
        references: {
          key: 'id',
          model: 'TrainingExercises',
        },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
        type: Sequelize.INTEGER,
      },
      orderIndex: {
        allowNull: false,
        defaultValue: 0,
        type: Sequelize.INTEGER,
      },
      exerciseNameSnapshot: {
        allowNull: false,
        type: Sequelize.STRING,
      },
      rating: {
        allowNull: false,
        type: Sequelize.INTEGER,
      },
      repeatSkill: {
        allowNull: false,
        defaultValue: false,
        type: Sequelize.BOOLEAN,
      },
      repeatExercise: {
        allowNull: false,
        defaultValue: false,
        type: Sequelize.BOOLEAN,
      },
      canAdvance: {
        allowNull: false,
        defaultValue: false,
        type: Sequelize.BOOLEAN,
      },
      comment: {
        allowNull: true,
        type: Sequelize.TEXT,
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

    await queryInterface.addIndex('TrainingNoteExercises', ['trainingNoteId', 'orderIndex'], {
      name: 'training_note_exercises_note_order_idx',
    });
    await queryInterface.addIndex('TrainingNoteExercises', ['trainingExerciseId'], {
      name: 'training_note_exercises_exercise_idx',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('TrainingNoteExercises');
  },
};
