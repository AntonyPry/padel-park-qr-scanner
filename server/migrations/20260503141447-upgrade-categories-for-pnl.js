'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('Categories', 'group', {
      type: Sequelize.STRING,
      defaultValue: 'OPEX', // По умолчанию кидаем в расходы
      allowNull: false,
    });

    await queryInterface.addColumn('Categories', 'commissionPercent', {
      type: Sequelize.DECIMAL(5, 2), // До 999.99%
      defaultValue: 0,
      allowNull: false,
    });

    await queryInterface.addColumn('Categories', 'isSystem', {
      type: Sequelize.BOOLEAN,
      defaultValue: false,
      allowNull: false,
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeColumn('Categories', 'isSystem');
    await queryInterface.removeColumn('Categories', 'commissionPercent');
    await queryInterface.removeColumn('Categories', 'group');
  },
};
