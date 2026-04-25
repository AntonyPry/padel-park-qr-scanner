'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    // 1. Переименовываем старые колонки
    await queryInterface.renameColumn('Utilizations', 'booked6', 'booked1');
    await queryInterface.renameColumn('Utilizations', 'booked15', 'booked2');

    // 2. Добавляем новые колонки для сессий
    await queryInterface.addColumn('Utilizations', 'sessions1', {
      type: Sequelize.INTEGER,
      defaultValue: 0,
      allowNull: false,
    });
    await queryInterface.addColumn('Utilizations', 'sessions2', {
      type: Sequelize.INTEGER,
      defaultValue: 0,
      allowNull: false,
    });
  },

  down: async (queryInterface, Sequelize) => {
    // Откат изменений
    await queryInterface.removeColumn('Utilizations', 'sessions1');
    await queryInterface.removeColumn('Utilizations', 'sessions2');
    await queryInterface.renameColumn('Utilizations', 'booked1', 'booked6');
    await queryInterface.renameColumn('Utilizations', 'booked2', 'booked15');
  },
};
