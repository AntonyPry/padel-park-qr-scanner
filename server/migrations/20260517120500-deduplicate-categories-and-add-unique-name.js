'use strict';

module.exports = {
  async up(queryInterface) {
    const [duplicates] = await queryInterface.sequelize.query(`
      SELECT LOWER(TRIM(name)) AS normalizedName, MAX(id) AS keepId, GROUP_CONCAT(id) AS ids
      FROM Categories
      GROUP BY LOWER(TRIM(name))
      HAVING COUNT(*) > 1
    `);

    for (const duplicate of duplicates) {
      const keepId = Number(duplicate.keepId);
      const ids = String(duplicate.ids)
        .split(',')
        .map((id) => Number(id))
        .filter((id) => Number.isInteger(id) && id !== keepId);

      if (ids.length === 0) continue;

      await queryInterface.sequelize.transaction(async (transaction) => {
        const [links] = await queryInterface.sequelize.query(
          `
            SELECT bonusRuleId
            FROM MotivationBonusRuleCategories
            WHERE categoryId IN (:ids)
          `,
          { replacements: { ids }, transaction },
        );

        for (const link of links) {
          await queryInterface.sequelize.query(
            `
              INSERT IGNORE INTO MotivationBonusRuleCategories
                (bonusRuleId, categoryId, createdAt, updatedAt)
              VALUES
                (:bonusRuleId, :keepId, NOW(), NOW())
            `,
            {
              replacements: {
                bonusRuleId: link.bonusRuleId,
                keepId,
              },
              transaction,
            },
          );
        }

        await queryInterface.sequelize.query(
          `
            DELETE FROM MotivationBonusRuleCategories
            WHERE categoryId IN (:ids)
          `,
          { replacements: { ids }, transaction },
        );

        await queryInterface.sequelize.query(
          `
            UPDATE Categories
            SET parentId = :keepId
            WHERE parentId IN (:ids)
          `,
          { replacements: { ids, keepId }, transaction },
        );

        await queryInterface.sequelize.query(
          `
            DELETE FROM Categories
            WHERE id IN (:ids)
          `,
          { replacements: { ids }, transaction },
        );
      });
    }

    await queryInterface.addIndex('Categories', ['name'], {
      name: 'categories_name_unique',
      unique: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('Categories', 'categories_name_unique');
  },
};
