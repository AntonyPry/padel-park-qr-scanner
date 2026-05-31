'use strict';

const ACCOUNT_ROLE_VALUES = [
  'owner',
  'manager',
  'admin',
  'accountant',
  'viewer',
  'trainer',
];
const PROGRESS_STATUS_VALUES = ['completed', 'skipped'];

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('OnboardingProgresses', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER,
      },
      accountId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: 'Accounts',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      role: {
        type: Sequelize.ENUM(...ACCOUNT_ROLE_VALUES),
        allowNull: false,
      },
      taskKey: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      status: {
        type: Sequelize.ENUM(...PROGRESS_STATUS_VALUES),
        allowNull: false,
        defaultValue: 'completed',
      },
      completedAt: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      metadata: {
        type: Sequelize.JSON,
        allowNull: true,
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

    await queryInterface.addIndex('OnboardingProgresses', ['accountId', 'role', 'taskKey'], {
      name: 'onboarding_progress_account_role_task_unique',
      unique: true,
    });
    await queryInterface.addIndex('OnboardingProgresses', ['role', 'status'], {
      name: 'onboarding_progress_role_status_idx',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('OnboardingProgresses');
  },
};
