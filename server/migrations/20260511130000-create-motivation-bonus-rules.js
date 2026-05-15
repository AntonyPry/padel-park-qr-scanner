'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('MotivationBonusRules', {
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
      description: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      bonusPercent: {
        type: Sequelize.DECIMAL(7, 2),
        allowNull: false,
        defaultValue: 0,
      },
      thresholdType: {
        type: Sequelize.ENUM('none', 'revenue', 'quantity'),
        allowNull: false,
        defaultValue: 'none',
      },
      thresholdValue: {
        type: Sequelize.DECIMAL(12, 2),
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

    await queryInterface.createTable('MotivationBonusRuleCategories', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER,
      },
      bonusRuleId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: 'MotivationBonusRules',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      categoryId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: 'Categories',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
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

    await queryInterface.addIndex(
      'MotivationBonusRuleCategories',
      ['bonusRuleId', 'categoryId'],
      {
        name: 'motivation_bonus_rule_categories_unique',
        unique: true,
      },
    );
  },

  async down(queryInterface) {
    await queryInterface.dropTable('MotivationBonusRuleCategories');
    await queryInterface.dropTable('MotivationBonusRules');

    if (queryInterface.sequelize.getDialect() === 'postgres') {
      await queryInterface.sequelize.query(
        'DROP TYPE IF EXISTS "enum_MotivationBonusRules_thresholdType";',
      );
    }
  },
};
