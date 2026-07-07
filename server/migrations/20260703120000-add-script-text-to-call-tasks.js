'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('CallTasks', 'scriptText', {
      allowNull: true,
      type: Sequelize.TEXT,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('CallTasks', 'scriptText');
  },
};
