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
    await queryInterface.createTable('OnboardingEvents', {
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
      eventKey: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      entityType: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      entityId: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      isTraining: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      payload: {
        type: Sequelize.JSON,
        allowNull: true,
      },
      completedTaskKeys: {
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

    await queryInterface.addIndex('OnboardingEvents', ['accountId', 'role', 'eventKey'], {
      name: 'onboarding_events_account_role_event_idx',
    });
    await queryInterface.addIndex('OnboardingEvents', ['entityType', 'entityId'], {
      name: 'onboarding_events_entity_idx',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('OnboardingEvents');
  },
};
