'use strict';

const PROVIDER_VALUES = ['beeline'];
const STATUS_VALUES = ['unknown', 'active', 'disabled', 'expired', 'failed'];
const SUBSCRIPTION_TYPE_VALUES = ['BASIC_CALL', 'ADVANCED_CALL'];

async function removeIndexIfExists(queryInterface, tableName, indexName) {
  try {
    await queryInterface.removeIndex(tableName, indexName);
  } catch (error) {
    const message = String(error.message || '');
    if (!/not exist|does not exist|check that it exists|Can't DROP/i.test(message)) {
      throw error;
    }
  }
}

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('TelephonySubscriptions', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER,
      },
      provider: {
        type: Sequelize.ENUM(...PROVIDER_VALUES),
        allowNull: false,
        defaultValue: 'beeline',
      },
      subscriptionId: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      status: {
        type: Sequelize.ENUM(...STATUS_VALUES),
        allowNull: false,
        defaultValue: 'unknown',
      },
      subscriptionType: {
        type: Sequelize.ENUM(...SUBSCRIPTION_TYPE_VALUES),
        allowNull: false,
        defaultValue: 'BASIC_CALL',
      },
      pattern: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      callbackUrl: {
        type: Sequelize.TEXT,
        allowNull: false,
      },
      expiresSeconds: {
        type: Sequelize.INTEGER,
        allowNull: true,
      },
      expiresAt: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      lastCheckedAt: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      lastRequest: {
        type: Sequelize.JSON,
        allowNull: true,
      },
      lastResponse: {
        type: Sequelize.JSON,
        allowNull: true,
      },
      lastError: {
        type: Sequelize.TEXT,
        allowNull: true,
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

    await queryInterface.addIndex('TelephonySubscriptions', ['provider', 'status'], {
      name: 'telephony_subscriptions_provider_status_idx',
    });
    await queryInterface.addIndex('TelephonySubscriptions', ['provider', 'subscriptionId'], {
      name: 'telephony_subscriptions_provider_subscription_id_unique',
      unique: true,
    });
  },

  async down(queryInterface) {
    await removeIndexIfExists(
      queryInterface,
      'TelephonySubscriptions',
      'telephony_subscriptions_provider_subscription_id_unique',
    );
    await removeIndexIfExists(
      queryInterface,
      'TelephonySubscriptions',
      'telephony_subscriptions_provider_status_idx',
    );
    await queryInterface.dropTable('TelephonySubscriptions');

    if (queryInterface.sequelize.getDialect() === 'postgres') {
      await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_TelephonySubscriptions_provider";');
      await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_TelephonySubscriptions_status";');
      await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_TelephonySubscriptions_subscriptionType";');
    }
  },
};
