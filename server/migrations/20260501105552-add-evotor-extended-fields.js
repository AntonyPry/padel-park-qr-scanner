'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    // Добавляем поля в Receipts
    await queryInterface.addColumn('Receipts', 'employeeId', {
      type: Sequelize.STRING,
    });
    await queryInterface.addColumn('Receipts', 'shiftId', {
      type: Sequelize.STRING,
    });
    await queryInterface.addColumn('Receipts', 'totalTax', {
      type: Sequelize.DECIMAL(10, 2),
      defaultValue: 0,
    });
    await queryInterface.addColumn('Receipts', 'totalDiscount', {
      type: Sequelize.DECIMAL(10, 2),
      defaultValue: 0,
    });
    await queryInterface.addColumn('Receipts', 'paymentSource', {
      type: Sequelize.STRING,
    });

    // Добавляем поля в ReceiptItems
    await queryInterface.addColumn('ReceiptItems', 'itemType', {
      type: Sequelize.STRING,
    });
    await queryInterface.addColumn('ReceiptItems', 'measureName', {
      type: Sequelize.STRING,
    });
    await queryInterface.addColumn('ReceiptItems', 'costPrice', {
      type: Sequelize.DECIMAL(10, 2),
      defaultValue: 0,
    });
    await queryInterface.addColumn('ReceiptItems', 'sumPrice', {
      type: Sequelize.DECIMAL(10, 2),
      defaultValue: 0,
    });
    await queryInterface.addColumn('ReceiptItems', 'tax', {
      type: Sequelize.DECIMAL(10, 2),
      defaultValue: 0,
    });
    await queryInterface.addColumn('ReceiptItems', 'taxPercent', {
      type: Sequelize.DECIMAL(10, 2),
      defaultValue: 0,
    });
    await queryInterface.addColumn('ReceiptItems', 'discount', {
      type: Sequelize.DECIMAL(10, 2),
      defaultValue: 0,
    });
  },

  async down(queryInterface, Sequelize) {
    // Откат миграции (удаление в обратном порядке)
    await queryInterface.removeColumn('ReceiptItems', 'discount');
    await queryInterface.removeColumn('ReceiptItems', 'taxPercent');
    await queryInterface.removeColumn('ReceiptItems', 'tax');
    await queryInterface.removeColumn('ReceiptItems', 'sumPrice');
    await queryInterface.removeColumn('ReceiptItems', 'costPrice');
    await queryInterface.removeColumn('ReceiptItems', 'measureName');
    await queryInterface.removeColumn('ReceiptItems', 'itemType');

    await queryInterface.removeColumn('Receipts', 'paymentSource');
    await queryInterface.removeColumn('Receipts', 'totalDiscount');
    await queryInterface.removeColumn('Receipts', 'totalTax');
    await queryInterface.removeColumn('Receipts', 'shiftId');
    await queryInterface.removeColumn('Receipts', 'employeeId');
  },
};
