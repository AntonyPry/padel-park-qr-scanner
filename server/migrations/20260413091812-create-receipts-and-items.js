'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    // 1. Создаем таблицу для заголовков чеков
    await queryInterface.createTable('Receipts', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER,
      },
      evotorId: {
        type: Sequelize.STRING,
        unique: true,
        allowNull: false,
      },
      dateTime: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      type: {
        type: Sequelize.STRING,
        defaultValue: 'SELL',
      },
      totalAmount: {
        type: Sequelize.DECIMAL(10, 2),
        defaultValue: 0,
      },
      cash: {
        type: Sequelize.DECIMAL(10, 2),
        defaultValue: 0,
      },
      cashless: {
        type: Sequelize.DECIMAL(10, 2),
        defaultValue: 0,
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

    // 2. Создаем таблицу для позиций внутри чека
    await queryInterface.createTable('ReceiptItems', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER,
      },
      name: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      quantity: {
        type: Sequelize.DECIMAL(10, 3),
        allowNull: false,
      },
      price: {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: false,
      },
      sum: {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: false,
      },
      receiptId: {
        type: Sequelize.INTEGER,
        references: {
          model: 'Receipts',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
        allowNull: false,
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

    // Добавляем индекс для быстрого поиска по ID Эвотора
    await queryInterface.addIndex('Receipts', ['evotorId']);
  },

  async down(queryInterface, Sequelize) {
    // Удаляем в обратном порядке
    await queryInterface.dropTable('ReceiptItems');
    await queryInterface.dropTable('Receipts');
  },
};
