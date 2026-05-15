'use strict';

const DEFAULT_BONUS_RULE_NAMES = new Set([
  'Бар',
  'Магазин',
  'VIP',
  'Ракетка шефа',
  'Тубусы',
]);

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.bulkDelete('MotivationRules', {
      group: 'sales',
    });

    const bonusRulesTable =
      queryInterface.queryGenerator.quoteTable('MotivationBonusRules');
    const idColumn = queryInterface.queryGenerator.quoteIdentifier('id');
    const nameColumn = queryInterface.queryGenerator.quoteIdentifier('name');

    const [rules] = await queryInterface.sequelize.query(
      `SELECT ${idColumn}, ${nameColumn} FROM ${bonusRulesTable}`,
    );
    const hasOnlyDefaultRules =
      rules.length > 0 &&
      rules.length <= DEFAULT_BONUS_RULE_NAMES.size &&
      rules.every((rule) => DEFAULT_BONUS_RULE_NAMES.has(String(rule.name)));

    if (!hasOnlyDefaultRules) return;

    const ruleIds = rules.map((rule) => rule.id);
    await queryInterface.bulkDelete('MotivationBonusRuleCategories', {
      bonusRuleId: {
        [Sequelize.Op.in]: ruleIds,
      },
    });
    await queryInterface.bulkDelete('MotivationBonusRules', {
      id: {
        [Sequelize.Op.in]: ruleIds,
      },
    });
  },

  async down() {
    // No-op: кастомные правила мотивации не должны восстанавливаться хардкодом.
  },
};
