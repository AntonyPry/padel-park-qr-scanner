'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.changeColumn('Accounts', 'status', {
      type: Sequelize.ENUM('active', 'inactive', 'archived'),
      allowNull: false,
      defaultValue: 'active',
    });
    await queryInterface.changeColumn('Staffs', 'status', {
      type: Sequelize.ENUM('active', 'inactive', 'archived'),
      allowNull: false,
      defaultValue: 'active',
    });
    await queryInterface.addColumn('CatalogRules', 'status', {
      type: Sequelize.ENUM('active', 'archived'),
      allowNull: false,
      defaultValue: 'active',
    });
    await queryInterface.addIndex('CatalogRules', ['status'], {
      name: 'catalog_rules_status_idx',
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeIndex('CatalogRules', 'catalog_rules_status_idx');
    await queryInterface.removeColumn('CatalogRules', 'status');
    await queryInterface.bulkUpdate(
      'Accounts',
      { status: 'inactive' },
      { status: 'archived' },
    );
    await queryInterface.bulkUpdate(
      'Staffs',
      { status: 'inactive' },
      { status: 'archived' },
    );
    await queryInterface.changeColumn('Staffs', 'status', {
      type: Sequelize.ENUM('active', 'inactive'),
      allowNull: false,
      defaultValue: 'active',
    });
    await queryInterface.changeColumn('Accounts', 'status', {
      type: Sequelize.ENUM('active', 'inactive'),
      allowNull: false,
      defaultValue: 'active',
    });
  },
};
