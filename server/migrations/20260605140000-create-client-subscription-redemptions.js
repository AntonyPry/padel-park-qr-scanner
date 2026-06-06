'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('ClientSubscriptionRedemptions', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER,
      },
      clientSubscriptionId: {
        allowNull: false,
        type: Sequelize.INTEGER,
        references: {
          model: 'ClientSubscriptions',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      clientId: {
        allowNull: false,
        type: Sequelize.INTEGER,
        references: {
          model: 'Users',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      quantity: {
        allowNull: false,
        defaultValue: 1,
        type: Sequelize.INTEGER,
      },
      serviceType: {
        allowNull: false,
        defaultValue: 'training',
        type: Sequelize.STRING,
      },
      trainingKind: {
        allowNull: true,
        type: Sequelize.STRING,
      },
      redeemedAt: {
        allowNull: false,
        type: Sequelize.DATE,
      },
      redeemedByAccountId: {
        allowNull: true,
        type: Sequelize.INTEGER,
        references: {
          model: 'Accounts',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      comment: {
        allowNull: true,
        type: Sequelize.TEXT,
      },
      status: {
        allowNull: false,
        defaultValue: 'active',
        type: Sequelize.STRING,
      },
      reversedAt: {
        allowNull: true,
        type: Sequelize.DATE,
      },
      reversedByAccountId: {
        allowNull: true,
        type: Sequelize.INTEGER,
        references: {
          model: 'Accounts',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      reversalReason: {
        allowNull: true,
        type: Sequelize.TEXT,
      },
      metadata: {
        allowNull: true,
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

    await queryInterface.addIndex(
      'ClientSubscriptionRedemptions',
      ['clientSubscriptionId', 'status'],
      { name: 'client_subscription_redemptions_subscription_status_idx' },
    );
    await queryInterface.addIndex(
      'ClientSubscriptionRedemptions',
      ['clientId', 'redeemedAt'],
      { name: 'client_subscription_redemptions_client_date_idx' },
    );
    await queryInterface.addIndex(
      'ClientSubscriptionRedemptions',
      ['redeemedByAccountId'],
      { name: 'client_subscription_redemptions_redeemed_by_idx' },
    );
    await queryInterface.addIndex(
      'ClientSubscriptionRedemptions',
      ['reversedByAccountId'],
      { name: 'client_subscription_redemptions_reversed_by_idx' },
    );
  },

  async down(queryInterface) {
    await queryInterface.removeIndex(
      'ClientSubscriptionRedemptions',
      'client_subscription_redemptions_reversed_by_idx',
    );
    await queryInterface.removeIndex(
      'ClientSubscriptionRedemptions',
      'client_subscription_redemptions_redeemed_by_idx',
    );
    await queryInterface.removeIndex(
      'ClientSubscriptionRedemptions',
      'client_subscription_redemptions_client_date_idx',
    );
    await queryInterface.removeIndex(
      'ClientSubscriptionRedemptions',
      'client_subscription_redemptions_subscription_status_idx',
    );
    await queryInterface.dropTable('ClientSubscriptionRedemptions');
  },
};
