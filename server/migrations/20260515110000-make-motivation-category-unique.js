'use strict';

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      DELETE duplicateLinks
      FROM MotivationBonusRuleCategories duplicateLinks
      INNER JOIN MotivationBonusRuleCategories keptLinks
        ON duplicateLinks.categoryId = keptLinks.categoryId
        AND duplicateLinks.id > keptLinks.id
    `);

    await queryInterface.addIndex('MotivationBonusRuleCategories', ['categoryId'], {
      name: 'motivation_bonus_rule_categories_category_unique',
      unique: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex(
      'MotivationBonusRuleCategories',
      'motivation_bonus_rule_categories_category_unique',
    );
  },
};
