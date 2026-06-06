'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('EvotorSaleSettings', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER,
      },
      itemName: {
        allowNull: false,
        type: Sequelize.STRING,
        unique: true,
      },
      saleIntent: {
        allowNull: false,
        defaultValue: 'normal',
        type: Sequelize.STRING,
      },
      saleSettings: {
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

    await queryInterface.addIndex('EvotorSaleSettings', ['saleIntent'], {
      name: 'evotor_sale_settings_intent_idx',
    });

    await queryInterface.createTable('PendingSales', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER,
      },
      receiptId: {
        allowNull: false,
        type: Sequelize.INTEGER,
        references: {
          model: 'Receipts',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      receiptItemId: {
        allowNull: false,
        type: Sequelize.INTEGER,
        unique: true,
        references: {
          model: 'ReceiptItems',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      saleSettingId: {
        allowNull: true,
        type: Sequelize.INTEGER,
        references: {
          model: 'EvotorSaleSettings',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      catalogRuleId: {
        allowNull: true,
        type: Sequelize.INTEGER,
        references: {
          model: 'CatalogRules',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      itemName: {
        allowNull: false,
        type: Sequelize.STRING,
      },
      saleIntent: {
        allowNull: false,
        type: Sequelize.STRING,
      },
      status: {
        allowNull: false,
        defaultValue: 'pending',
        type: Sequelize.STRING,
      },
      clientId: {
        allowNull: true,
        type: Sequelize.INTEGER,
        references: {
          model: 'Users',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      linkedAt: {
        allowNull: true,
        type: Sequelize.DATE,
      },
      linkedByAccountId: {
        allowNull: true,
        type: Sequelize.INTEGER,
        references: {
          model: 'Accounts',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      ignoredAt: {
        allowNull: true,
        type: Sequelize.DATE,
      },
      ignoredByAccountId: {
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
      statusReason: {
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

    await queryInterface.addIndex('PendingSales', ['status'], {
      name: 'pending_sales_status_idx',
    });
    await queryInterface.addIndex('PendingSales', ['saleIntent'], {
      name: 'pending_sales_intent_idx',
    });
    await queryInterface.addIndex('PendingSales', ['clientId'], {
      name: 'pending_sales_client_idx',
    });
    await queryInterface.addIndex('PendingSales', ['receiptId'], {
      name: 'pending_sales_receipt_idx',
    });

    await queryInterface.createTable('PendingSaleHistories', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER,
      },
      pendingSaleId: {
        allowNull: false,
        type: Sequelize.INTEGER,
        references: {
          model: 'PendingSales',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      action: {
        allowNull: false,
        type: Sequelize.STRING,
      },
      fromStatus: {
        allowNull: true,
        type: Sequelize.STRING,
      },
      toStatus: {
        allowNull: true,
        type: Sequelize.STRING,
      },
      accountId: {
        allowNull: true,
        type: Sequelize.INTEGER,
        references: {
          model: 'Accounts',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      role: {
        allowNull: true,
        type: Sequelize.STRING,
      },
      reason: {
        allowNull: true,
        type: Sequelize.TEXT,
      },
      beforeData: {
        allowNull: true,
        type: Sequelize.JSON,
      },
      afterData: {
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

    await queryInterface.addIndex('PendingSaleHistories', ['pendingSaleId', 'createdAt'], {
      name: 'pending_sale_histories_sale_created_idx',
    });
    await queryInterface.addIndex('PendingSaleHistories', ['accountId'], {
      name: 'pending_sale_histories_account_idx',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex(
      'PendingSaleHistories',
      'pending_sale_histories_account_idx',
    );
    await queryInterface.removeIndex(
      'PendingSaleHistories',
      'pending_sale_histories_sale_created_idx',
    );
    await queryInterface.dropTable('PendingSaleHistories');

    await queryInterface.removeIndex('PendingSales', 'pending_sales_receipt_idx');
    await queryInterface.removeIndex('PendingSales', 'pending_sales_client_idx');
    await queryInterface.removeIndex('PendingSales', 'pending_sales_intent_idx');
    await queryInterface.removeIndex('PendingSales', 'pending_sales_status_idx');
    await queryInterface.dropTable('PendingSales');

    await queryInterface.removeIndex(
      'EvotorSaleSettings',
      'evotor_sale_settings_intent_idx',
    );
    await queryInterface.dropTable('EvotorSaleSettings');
  },
};
