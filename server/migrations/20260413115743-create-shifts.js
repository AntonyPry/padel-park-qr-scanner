'use strict';
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('Shifts', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER,
      },
      date: { type: Sequelize.DATEONLY, allowNull: false },
      adminName: { type: Sequelize.STRING, allowNull: false },
      hours: { type: Sequelize.DECIMAL(4, 1), allowNull: false },
      manualAdjustment: { type: Sequelize.DECIMAL(10, 2), defaultValue: 0 },
      comment: { type: Sequelize.TEXT },
      createdAt: { allowNull: false, type: Sequelize.DATE },
      updatedAt: { allowNull: false, type: Sequelize.DATE },
    });
  },
  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable('Shifts');
  },
};
