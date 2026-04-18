'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    // 1. Переименовываем старые колонки
    await queryInterface.renameColumn('utilizations', 'booked6', 'booked1');
    await queryInterface.renameColumn('utilizations', 'booked15', 'booked2');

    // 2. Добавляем новые колонки для сессий
    await queryInterface.addColumn('utilizations', 'sessions1', {
      type: Sequelize.INTEGER,
      defaultValue: 0,
      allowNull: false,
    });
    await queryInterface.addColumn('utilizations', 'sessions2', {
      type: Sequelize.INTEGER,
      defaultValue: 0,
      allowNull: false,
    });
  },

  down: async (queryInterface, Sequelize) => {
    // Откат изменений
    await queryInterface.removeColumn('utilizations', 'sessions1');
    await queryInterface.removeColumn('utilizations', 'sessions2');
    await queryInterface.renameColumn('utilizations', 'booked1', 'booked6');
    await queryInterface.renameColumn('utilizations', 'booked2', 'booked15');
  },
};
