'use strict';

const now = new Date();

const PRESET_TYPES = [
  {
    name: 'Групповая разовая 10:00-17:00',
    serviceType: 'training',
    trainingKind: 'group',
    timeSegment: 'off_peak',
    sessionsTotal: 1,
    isUnlimited: false,
    validityDays: 30,
    price: 1800,
    bonusPersonalSessions: 0,
    description: 'Разовое групповое занятие в будни 10:00-17:00.',
  },
  {
    name: 'Групповая разовая день/вечер/выходные',
    serviceType: 'training',
    trainingKind: 'group',
    timeSegment: 'standard',
    sessionsTotal: 1,
    isUnlimited: false,
    validityDays: 30,
    price: 2000,
    bonusPersonalSessions: 0,
    description: 'Разовое групповое занятие днем, вечером или в выходные.',
  },
  {
    name: 'Групповые 4 занятия 10:00-17:00',
    serviceType: 'training',
    trainingKind: 'group',
    timeSegment: 'off_peak',
    sessionsTotal: 4,
    isUnlimited: false,
    validityDays: 30,
    price: 5200,
    bonusPersonalSessions: 0,
    description: '4 групповых занятия в месяц в будни 10:00-17:00.',
  },
  {
    name: 'Групповые 4 занятия день/вечер/выходные',
    serviceType: 'training',
    trainingKind: 'group',
    timeSegment: 'standard',
    sessionsTotal: 4,
    isUnlimited: false,
    validityDays: 30,
    price: 6000,
    bonusPersonalSessions: 0,
    description: '4 групповых занятия в месяц днем, вечером или в выходные.',
  },
  {
    name: 'Групповые 8 занятий 10:00-17:00',
    serviceType: 'training',
    trainingKind: 'group',
    timeSegment: 'off_peak',
    sessionsTotal: 8,
    isUnlimited: false,
    validityDays: 30,
    price: 8000,
    bonusPersonalSessions: 0,
    description: '8 групповых занятий в месяц в будни 10:00-17:00.',
  },
  {
    name: 'Групповые 8 занятий день/вечер/выходные',
    serviceType: 'training',
    trainingKind: 'group',
    timeSegment: 'standard',
    sessionsTotal: 8,
    isUnlimited: false,
    validityDays: 30,
    price: 9600,
    bonusPersonalSessions: 0,
    description: '8 групповых занятий в месяц днем, вечером или в выходные.',
  },
  {
    name: 'Групповые 12 занятий 10:00-17:00',
    serviceType: 'training',
    trainingKind: 'group',
    timeSegment: 'off_peak',
    sessionsTotal: 12,
    isUnlimited: false,
    validityDays: 30,
    price: 10800,
    bonusPersonalSessions: 0,
    description: '12 групповых занятий в месяц в будни 10:00-17:00.',
  },
  {
    name: 'Групповые 12 занятий день/вечер/выходные',
    serviceType: 'training',
    trainingKind: 'group',
    timeSegment: 'standard',
    sessionsTotal: 12,
    isUnlimited: false,
    validityDays: 30,
    price: 12600,
    bonusPersonalSessions: 0,
    description: '12 групповых занятий в месяц днем, вечером или в выходные.',
  },
  {
    name: 'Безлимитные групповые',
    serviceType: 'training',
    trainingKind: 'group',
    timeSegment: 'all',
    sessionsTotal: null,
    isUnlimited: true,
    validityDays: 30,
    price: 19999,
    bonusPersonalSessions: 2,
    description: 'Безлимитные групповые занятия на месяц + 2 персональные тренировки в подарок.',
  },
  {
    name: 'Персональная разовая',
    serviceType: 'training',
    trainingKind: 'personal',
    timeSegment: 'all',
    sessionsTotal: 1,
    isUnlimited: false,
    validityDays: 30,
    price: 3500,
    bonusPersonalSessions: 0,
    description: 'Разовая персональная тренировка.',
  },
  {
    name: 'Персональные 4 занятия',
    serviceType: 'training',
    trainingKind: 'personal',
    timeSegment: 'all',
    sessionsTotal: 4,
    isUnlimited: false,
    validityDays: 30,
    price: 12800,
    bonusPersonalSessions: 0,
    description: '4 персональные тренировки в месяц.',
  },
  {
    name: 'Персональные 8 занятий',
    serviceType: 'training',
    trainingKind: 'personal',
    timeSegment: 'all',
    sessionsTotal: 8,
    isUnlimited: false,
    validityDays: 30,
    price: 21600,
    bonusPersonalSessions: 0,
    description: '8 персональных тренировок в месяц.',
  },
];

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('SubscriptionTypes', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER,
      },
      name: {
        allowNull: false,
        type: Sequelize.STRING,
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
      timeSegment: {
        allowNull: true,
        type: Sequelize.STRING,
      },
      sessionsTotal: {
        allowNull: true,
        type: Sequelize.INTEGER,
      },
      isUnlimited: {
        allowNull: false,
        defaultValue: false,
        type: Sequelize.BOOLEAN,
      },
      validityDays: {
        allowNull: false,
        defaultValue: 30,
        type: Sequelize.INTEGER,
      },
      price: {
        allowNull: false,
        defaultValue: 0,
        type: Sequelize.DECIMAL(10, 2),
      },
      bonusPersonalSessions: {
        allowNull: false,
        defaultValue: 0,
        type: Sequelize.INTEGER,
      },
      status: {
        allowNull: false,
        defaultValue: 'active',
        type: Sequelize.STRING,
      },
      description: {
        allowNull: true,
        type: Sequelize.TEXT,
      },
      metadata: {
        allowNull: true,
        type: Sequelize.JSON,
      },
      createdByAccountId: {
        allowNull: true,
        type: Sequelize.INTEGER,
        references: {
          model: 'Accounts',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      updatedByAccountId: {
        allowNull: true,
        type: Sequelize.INTEGER,
        references: {
          model: 'Accounts',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
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

    await queryInterface.addIndex('SubscriptionTypes', ['name'], {
      name: 'subscription_types_name_unique',
      unique: true,
    });
    await queryInterface.addIndex('SubscriptionTypes', ['status', 'serviceType'], {
      name: 'subscription_types_status_service_idx',
    });

    await queryInterface.bulkInsert(
      'SubscriptionTypes',
      PRESET_TYPES.map((type) => ({
        ...type,
        metadata: JSON.stringify({ preset: true }),
        createdAt: now,
        updatedAt: now,
      })),
    );

    await queryInterface.createTable('ClientSubscriptions', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER,
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
      subscriptionTypeId: {
        allowNull: true,
        type: Sequelize.INTEGER,
        references: {
          model: 'SubscriptionTypes',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      pendingSaleId: {
        allowNull: true,
        type: Sequelize.INTEGER,
        references: {
          model: 'PendingSales',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      sourceReceiptId: {
        allowNull: true,
        type: Sequelize.INTEGER,
        references: {
          model: 'Receipts',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      sourceReceiptItemId: {
        allowNull: true,
        type: Sequelize.INTEGER,
        references: {
          model: 'ReceiptItems',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      source: {
        allowNull: false,
        defaultValue: 'evotor_pending_sale',
        type: Sequelize.STRING,
      },
      typeName: {
        allowNull: false,
        type: Sequelize.STRING,
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
      timeSegment: {
        allowNull: true,
        type: Sequelize.STRING,
      },
      sessionsTotal: {
        allowNull: true,
        type: Sequelize.INTEGER,
      },
      sessionsUsed: {
        allowNull: false,
        defaultValue: 0,
        type: Sequelize.INTEGER,
      },
      isUnlimited: {
        allowNull: false,
        defaultValue: false,
        type: Sequelize.BOOLEAN,
      },
      bonusPersonalSessions: {
        allowNull: false,
        defaultValue: 0,
        type: Sequelize.INTEGER,
      },
      startsAt: {
        allowNull: false,
        type: Sequelize.DATE,
      },
      expiresAt: {
        allowNull: true,
        type: Sequelize.DATE,
      },
      status: {
        allowNull: false,
        defaultValue: 'active',
        type: Sequelize.STRING,
      },
      pricePaid: {
        allowNull: false,
        defaultValue: 0,
        type: Sequelize.DECIMAL(10, 2),
      },
      saleAmount: {
        allowNull: false,
        defaultValue: 0,
        type: Sequelize.DECIMAL(10, 2),
      },
      metadata: {
        allowNull: true,
        type: Sequelize.JSON,
      },
      createdByAccountId: {
        allowNull: true,
        type: Sequelize.INTEGER,
        references: {
          model: 'Accounts',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      canceledAt: {
        allowNull: true,
        type: Sequelize.DATE,
      },
      canceledByAccountId: {
        allowNull: true,
        type: Sequelize.INTEGER,
        references: {
          model: 'Accounts',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      cancelReason: {
        allowNull: true,
        type: Sequelize.TEXT,
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

    await queryInterface.addIndex('ClientSubscriptions', ['clientId', 'status'], {
      name: 'client_subscriptions_client_status_idx',
    });
    await queryInterface.addIndex('ClientSubscriptions', ['status', 'expiresAt'], {
      name: 'client_subscriptions_status_expiry_idx',
    });
    await queryInterface.addIndex('ClientSubscriptions', ['subscriptionTypeId'], {
      name: 'client_subscriptions_type_idx',
    });
    await queryInterface.addIndex('ClientSubscriptions', ['pendingSaleId'], {
      name: 'client_subscriptions_pending_sale_unique',
      unique: true,
    });
    await queryInterface.addIndex('ClientSubscriptions', ['sourceReceiptItemId'], {
      name: 'client_subscriptions_receipt_item_unique',
      unique: true,
    });
    await queryInterface.addIndex('ClientSubscriptions', ['sourceReceiptId'], {
      name: 'client_subscriptions_receipt_idx',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex(
      'ClientSubscriptions',
      'client_subscriptions_receipt_idx',
    );
    await queryInterface.removeIndex(
      'ClientSubscriptions',
      'client_subscriptions_receipt_item_unique',
    );
    await queryInterface.removeIndex(
      'ClientSubscriptions',
      'client_subscriptions_pending_sale_unique',
    );
    await queryInterface.removeIndex(
      'ClientSubscriptions',
      'client_subscriptions_type_idx',
    );
    await queryInterface.removeIndex(
      'ClientSubscriptions',
      'client_subscriptions_status_expiry_idx',
    );
    await queryInterface.removeIndex(
      'ClientSubscriptions',
      'client_subscriptions_client_status_idx',
    );
    await queryInterface.dropTable('ClientSubscriptions');

    await queryInterface.removeIndex(
      'SubscriptionTypes',
      'subscription_types_status_service_idx',
    );
    await queryInterface.removeIndex(
      'SubscriptionTypes',
      'subscription_types_name_unique',
    );
    await queryInterface.dropTable('SubscriptionTypes');
  },
};
