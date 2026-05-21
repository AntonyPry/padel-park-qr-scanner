'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('Receipts', 'paymentDetails', {
      type: Sequelize.JSON,
      allowNull: true,
    });
    await queryInterface.addColumn('Receipts', 'paymentParseStatus', {
      type: Sequelize.STRING,
      allowNull: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('Receipts', 'paymentParseStatus');
    await queryInterface.removeColumn('Receipts', 'paymentDetails');
  },
};
