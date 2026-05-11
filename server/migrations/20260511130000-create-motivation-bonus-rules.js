'use strict';

const { DEFAULT_BONUS_RULES } = require('../src/constants/motivation-bonus-rules');
const { DEFAULT_MOTIVATION_RULES } = require('../src/constants/motivation-rules');

function getDefaultValue(key) {
  const rule = DEFAULT_MOTIVATION_RULES.find((item) => item.key === key);
  return Number(rule?.value) || 0;
}

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

    const now = new Date();
    const motivationRulesTable = queryInterface.quoteTable('MotivationRules');
    const bonusRulesTable = queryInterface.quoteTable('MotivationBonusRules');
    const categoriesTable = queryInterface.quoteTable('Categories');
    const keyColumn = queryInterface.quoteIdentifier('key');
    const valueColumn = queryInterface.quoteIdentifier('value');
    const idColumn = queryInterface.quoteIdentifier('id');
    const nameColumn = queryInterface.quoteIdentifier('name');

    const [storedRules] = await queryInterface.sequelize.query(
      `SELECT ${keyColumn}, ${valueColumn} FROM ${motivationRulesTable}`,
    );
    const storedValueMap = storedRules.reduce((acc, rule) => {
      acc[rule.key] = Number(rule.value);
      return acc;
    }, {});

    const ruleRows = DEFAULT_BONUS_RULES.map((rule) => ({
      name: rule.name,
      description: rule.description,
      bonusPercent:
        storedValueMap[rule.bonusPercentKey] ?? getDefaultValue(rule.bonusPercentKey),
      thresholdType: rule.thresholdType,
      thresholdValue: rule.thresholdValueKey
        ? storedValueMap[rule.thresholdValueKey] ??
          getDefaultValue(rule.thresholdValueKey)
        : 0,
      sortOrder: rule.sortOrder,
      isActive: rule.isActive,
      createdAt: now,
      updatedAt: now,
    }));

    await queryInterface.bulkInsert('MotivationBonusRules', ruleRows);

    const [insertedRules] = await queryInterface.sequelize.query(
      `SELECT ${idColumn}, ${nameColumn} FROM ${bonusRulesTable}`,
    );
    const [categories] = await queryInterface.sequelize.query(
      `SELECT ${idColumn}, ${nameColumn} FROM ${categoriesTable}`,
    );
    const insertedByName = new Map(
      insertedRules.map((rule) => [String(rule.name), rule.id]),
    );
    const categoryByName = new Map(
      categories.map((category) => [String(category.name), category.id]),
    );

    const links = [];
    DEFAULT_BONUS_RULES.forEach((rule) => {
      const bonusRuleId = insertedByName.get(rule.name);
      if (!bonusRuleId) return;

      rule.categoryNames.forEach((categoryName) => {
        const categoryId = categoryByName.get(categoryName);
        if (!categoryId) return;

        links.push({
          bonusRuleId,
          categoryId,
          createdAt: now,
          updatedAt: now,
        });
      });
    });

    if (links.length > 0) {
      await queryInterface.bulkInsert('MotivationBonusRuleCategories', links);
    }
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
