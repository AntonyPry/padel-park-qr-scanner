'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable('Users');
    if (table.birthDate) return;

    await queryInterface.addColumn('Users', 'birthDate', {
      allowNull: true,
      type: Sequelize.DATEONLY,
    });
  },

  async down(queryInterface) {
    const table = await queryInterface.describeTable('Users');
    if (!table.birthDate) return;

    await queryInterface.removeColumn('Users', 'birthDate');
  },
};
