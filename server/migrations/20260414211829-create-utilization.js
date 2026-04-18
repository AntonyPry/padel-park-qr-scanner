'use strict';
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('Utilizations', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER,
      },
      date: { type: Sequelize.DATEONLY, allowNull: false, unique: true },
      booked15: { type: Sequelize.DECIMAL(4, 1), defaultValue: 0 },
      booked6: { type: Sequelize.DECIMAL(4, 1), defaultValue: 0 },
      createdAt: { allowNull: false, type: Sequelize.DATE },
      updatedAt: { allowNull: false, type: Sequelize.DATE },
    });
  },
  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable('Utilizations');
  },
};
