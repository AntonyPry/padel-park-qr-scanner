'use strict';

const { DEFAULT_MOTIVATION_RULES } = require('../src/constants/motivation-rules');

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('MotivationRules', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER,
      },
      key: {
        type: Sequelize.STRING,
        allowNull: false,
        unique: true,
      },
      label: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      description: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      group: {
        type: Sequelize.STRING,
        allowNull: false,
        defaultValue: 'general',
      },
      unit: {
        type: Sequelize.ENUM('currency', 'percent', 'quantity', 'hours'),
        allowNull: false,
        defaultValue: 'currency',
      },
      value: {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: false,
        defaultValue: 0,
      },
      sortOrder: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      isActive: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true,
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

    const now = new Date();
    await queryInterface.bulkInsert(
      'MotivationRules',
      DEFAULT_MOTIVATION_RULES.map((rule) => ({
        ...rule,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      })),
    );
  },

  async down(queryInterface) {
    await queryInterface.dropTable('MotivationRules');

    if (queryInterface.sequelize.getDialect() === 'postgres') {
      await queryInterface.sequelize.query(
        'DROP TYPE IF EXISTS "enum_MotivationRules_unit";',
      );
    }
  },
};
