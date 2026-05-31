'use strict';

const ONBOARDING_SOURCE_NAME = 'Онбординг';

module.exports = {
  async up(queryInterface) {
    const [rows] = await queryInterface.sequelize.query(
      'SELECT id, status FROM ClientSources WHERE LOWER(name) = LOWER(:name) LIMIT 1',
      { replacements: { name: ONBOARDING_SOURCE_NAME } },
    );

    if (rows.length > 0) {
      await queryInterface.sequelize.query(
        'UPDATE ClientSources SET status = :status, updatedAt = NOW() WHERE id = :id',
        {
          replacements: {
            id: rows[0].id,
            status: 'active',
          },
        },
      );
      return;
    }

    const [sortRows] = await queryInterface.sequelize.query(
      'SELECT COALESCE(MAX(sortOrder), 0) AS maxSortOrder FROM ClientSources',
    );
    const sortOrder = Number(sortRows[0]?.maxSortOrder || 0) + 1;

    await queryInterface.bulkInsert('ClientSources', [
      {
        createdAt: new Date(),
        name: ONBOARDING_SOURCE_NAME,
        sortOrder,
        status: 'active',
        updatedAt: new Date(),
      },
    ]);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(
      `
        UPDATE ClientSources cs
        SET cs.status = 'archived', cs.updatedAt = NOW()
        WHERE LOWER(cs.name) = LOWER(:name)
          AND NOT EXISTS (
            SELECT 1
            FROM Users u
            WHERE u.sourceId = cs.id
          )
      `,
      { replacements: { name: ONBOARDING_SOURCE_NAME } },
    );
  },
};
