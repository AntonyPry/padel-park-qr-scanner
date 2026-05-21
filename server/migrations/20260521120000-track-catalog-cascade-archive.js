'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('Categories', 'archivedByCascadeParentId', {
      type: Sequelize.INTEGER,
      allowNull: true,
    });
    await queryInterface.addColumn('CatalogRules', 'archivedByCascadeCategoryId', {
      type: Sequelize.INTEGER,
      allowNull: true,
    });
    await queryInterface.addIndex('Categories', ['archivedByCascadeParentId'], {
      name: 'categories_archive_cascade_parent_idx',
    });
    await queryInterface.addIndex('CatalogRules', ['archivedByCascadeCategoryId'], {
      name: 'catalog_rules_archive_cascade_category_idx',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex(
      'CatalogRules',
      'catalog_rules_archive_cascade_category_idx',
    );
    await queryInterface.removeIndex(
      'Categories',
      'categories_archive_cascade_parent_idx',
    );
    await queryInterface.removeColumn('CatalogRules', 'archivedByCascadeCategoryId');
    await queryInterface.removeColumn('Categories', 'archivedByCascadeParentId');
  },
};
