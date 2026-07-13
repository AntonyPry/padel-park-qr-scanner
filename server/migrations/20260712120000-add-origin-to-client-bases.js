'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('ClientBases', 'origin', {
      allowNull: true,
      type: Sequelize.STRING,
    });
    await queryInterface.addColumn('ClientBases', 'originMetadata', {
      allowNull: true,
      type: Sequelize.JSON,
    });
    await queryInterface.addIndex('ClientBases', ['origin'], {
      name: 'client_bases_origin_idx',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('ClientBases', 'client_bases_origin_idx');
    await queryInterface.removeColumn('ClientBases', 'originMetadata');
    await queryInterface.removeColumn('ClientBases', 'origin');
  },
};
