'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('ClientSavedViews', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER,
      },
      accountId: {
        allowNull: false,
        type: Sequelize.INTEGER,
        references: {
          model: 'Accounts',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      name: {
        allowNull: false,
        type: Sequelize.STRING,
      },
      filters: {
        allowNull: false,
        type: Sequelize.JSON,
      },
      createdAt: {
        allowNull: false,
        type: Sequelize.DATE,
      },
      updatedAt: {
        allowNull: false,
        type: Sequelize.DATE,
      },
    });

    await queryInterface.addIndex('ClientSavedViews', ['accountId'], {
      name: 'client_saved_views_account_id_idx',
    });
    await queryInterface.addIndex('ClientSavedViews', ['accountId', 'name'], {
      unique: true,
      name: 'client_saved_views_account_name_unique',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex(
      'ClientSavedViews',
      'client_saved_views_account_name_unique',
    );
    await queryInterface.removeIndex(
      'ClientSavedViews',
      'client_saved_views_account_id_idx',
    );
    await queryInterface.dropTable('ClientSavedViews');
  },
};
