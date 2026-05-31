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
    await queryInterface.changeColumn('OnboardingProgresses', 'status', {
      allowNull: false,
      defaultValue: 'in_progress',
      type: Sequelize.ENUM('in_progress', 'completed', 'skipped'),
    });

    await queryInterface.changeColumn('OnboardingProgresses', 'role', {
      allowNull: false,
      type: Sequelize.ENUM(...ACCOUNT_ROLE_VALUES),
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.sequelize.query(
      "UPDATE OnboardingProgresses SET status = 'completed' WHERE status = 'in_progress'",
    );
    await queryInterface.changeColumn('OnboardingProgresses', 'status', {
      allowNull: false,
      defaultValue: 'completed',
      type: Sequelize.ENUM('completed', 'skipped'),
    });
  },
};
