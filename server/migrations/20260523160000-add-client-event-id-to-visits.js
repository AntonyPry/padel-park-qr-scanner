'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('Visits', 'clientEventId', {
      type: Sequelize.STRING,
      allowNull: true,
    });

    await queryInterface.addIndex('Visits', ['clientEventId'], {
      unique: true,
      name: 'visits_client_event_id_unique',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('Visits', 'visits_client_event_id_unique');
    await queryInterface.removeColumn('Visits', 'clientEventId');
  },
};
