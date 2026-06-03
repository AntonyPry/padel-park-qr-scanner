'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('TrainingPlans', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER,
      },
      kind: {
        allowNull: false,
        type: Sequelize.ENUM('personal', 'group'),
      },
      status: {
        allowNull: false,
        defaultValue: 'planned',
        type: Sequelize.ENUM('planned', 'completed'),
      },
      sourceType: {
        allowNull: false,
        defaultValue: 'manual',
        type: Sequelize.ENUM('manual', 'personal_recommendation', 'group_recommendation'),
      },
      trainerAccountId: {
        allowNull: true,
        references: {
          key: 'id',
          model: 'Accounts',
        },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
        type: Sequelize.INTEGER,
      },
      plannedAt: {
        allowNull: false,
        type: Sequelize.DATEONLY,
      },
      completedAt: {
        allowNull: true,
        type: Sequelize.DATE,
      },
      goal: {
        allowNull: true,
        type: Sequelize.STRING,
      },
      notes: {
        allowNull: true,
        type: Sequelize.TEXT,
      },
      sourceSnapshot: {
        allowNull: true,
        type: Sequelize.JSON,
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
      createdAt: {
        allowNull: false,
        type: Sequelize.DATE,
      },
      updatedAt: {
        allowNull: false,
        type: Sequelize.DATE,
      },
    });

    await queryInterface.createTable('TrainingPlanParticipants', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER,
      },
      trainingPlanId: {
        allowNull: false,
        references: {
          key: 'id',
          model: 'TrainingPlans',
        },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
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
      createdAt: {
        allowNull: false,
        type: Sequelize.DATE,
      },
      updatedAt: {
        allowNull: false,
        type: Sequelize.DATE,
      },
    });

    await queryInterface.createTable('TrainingPlanExercises', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER,
      },
      trainingPlanId: {
        allowNull: false,
        references: {
          key: 'id',
          model: 'TrainingPlans',
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
      blockKey: {
        allowNull: true,
        type: Sequelize.STRING,
      },
      blockTitle: {
        allowNull: true,
        type: Sequelize.STRING,
      },
      exerciseNameSnapshot: {
        allowNull: false,
        type: Sequelize.STRING,
      },
      reasonSnapshot: {
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

    await queryInterface.addIndex('TrainingPlans', ['status', 'plannedAt'], {
      name: 'training_plans_status_planned_at_idx',
    });
    await queryInterface.addIndex('TrainingPlans', ['trainerAccountId', 'status'], {
      name: 'training_plans_trainer_status_idx',
    });
    await queryInterface.addIndex('TrainingPlanParticipants', ['trainingPlanId', 'userId'], {
      name: 'training_plan_participants_plan_user_unique',
      unique: true,
    });
    await queryInterface.addIndex('TrainingPlanParticipants', ['userId', 'trainingPlanId'], {
      name: 'training_plan_participants_user_plan_idx',
    });
    await queryInterface.addIndex('TrainingPlanParticipants', ['trainingNoteId'], {
      name: 'training_plan_participants_note_idx',
    });
    await queryInterface.addIndex('TrainingPlanExercises', ['trainingPlanId', 'orderIndex'], {
      name: 'training_plan_exercises_plan_order_idx',
    });
    await queryInterface.addIndex('TrainingPlanExercises', ['trainingExerciseId'], {
      name: 'training_plan_exercises_exercise_idx',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('TrainingPlanExercises');
    await queryInterface.dropTable('TrainingPlanParticipants');
    await queryInterface.dropTable('TrainingPlans');
  },
};
