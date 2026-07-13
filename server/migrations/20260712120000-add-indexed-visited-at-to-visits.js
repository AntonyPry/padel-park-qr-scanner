'use strict';

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      ALTER TABLE Visits
      ADD COLUMN visitedAt DATETIME
      GENERATED ALWAYS AS (COALESCE(scannedAt, createdAt)) STORED
    `);
    await queryInterface.addIndex('Visits', ['visitedAt'], {
      name: 'idx_visits_visited_at',
    });
    await queryInterface.addIndex('Visits', ['userId', 'visitedAt'], {
      name: 'idx_visits_user_visited_at',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('Visits', 'idx_visits_user_visited_at');
    await queryInterface.removeIndex('Visits', 'idx_visits_visited_at');
    await queryInterface.removeColumn('Visits', 'visitedAt');
  },
};
