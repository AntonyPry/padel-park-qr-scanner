'use strict';
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('Users', 'vkId', {
      type: Sequelize.STRING,
      allowNull: true,
      unique: true,
    });
    await queryInterface.changeColumn('Users', 'telegramId', {
      type: Sequelize.STRING,
      allowNull: true,
    });
  },
  async down(queryInterface, Sequelize) {
    await queryInterface.removeColumn('Users', 'vkId');
    await queryInterface.changeColumn('Users', 'telegramId', {
      type: Sequelize.STRING,
      allowNull: false,
    });
  },
};
