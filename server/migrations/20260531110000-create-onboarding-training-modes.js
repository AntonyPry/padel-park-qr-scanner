'use strict';

const ACCOUNT_ROLE_VALUES = [
  'owner',
  'manager',
  'admin',
  'accountant',
  'viewer',
  'trainer',
];

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('OnboardingTrainingModes', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER,
      },
      accountId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        unique: true,
        references: {
          model: 'Accounts',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      isEnabled: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      role: {
        type: Sequelize.ENUM(...ACCOUNT_ROLE_VALUES),
        allowNull: true,
      },
      enabledAt: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      disabledAt: {
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

    await queryInterface.addIndex('OnboardingTrainingModes', ['accountId', 'isEnabled'], {
      name: 'onboarding_training_modes_account_enabled_idx',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('OnboardingTrainingModes');
  },
};
