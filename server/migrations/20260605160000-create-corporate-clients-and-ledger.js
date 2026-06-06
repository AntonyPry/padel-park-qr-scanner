'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('CorporateClients', {
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
      contactName: {
        allowNull: true,
        type: Sequelize.STRING,
      },
      contactPhone: {
        allowNull: true,
        type: Sequelize.STRING,
      },
      contactEmail: {
        allowNull: true,
        type: Sequelize.STRING,
      },
      status: {
        allowNull: false,
        defaultValue: 'active',
        type: Sequelize.STRING,
      },
      comment: {
        allowNull: true,
        type: Sequelize.TEXT,
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
      archivedAt: {
        allowNull: true,
        type: Sequelize.DATE,
      },
      archivedByAccountId: {
        allowNull: true,
        type: Sequelize.INTEGER,
        references: {
          model: 'Accounts',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      archiveReason: {
        allowNull: true,
        type: Sequelize.TEXT,
      },
      isTraining: {
        allowNull: false,
        defaultValue: false,
        type: Sequelize.BOOLEAN,
      },
      trainingRole: {
        allowNull: true,
        type: Sequelize.STRING,
      },
      trainingAccountId: {
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

    await queryInterface.addIndex('CorporateClients', ['status', 'name'], {
      name: 'corporate_clients_status_name_idx',
    });
    await queryInterface.addIndex(
      'CorporateClients',
      ['isTraining', 'trainingRole'],
      {
        name: 'corporate_clients_training_idx',
      },
    );

    await queryInterface.createTable('CorporateLedgerEntries', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER,
      },
      corporateClientId: {
        allowNull: false,
        type: Sequelize.INTEGER,
        references: {
          model: 'CorporateClients',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      type: {
        allowNull: false,
        defaultValue: 'deposit',
        type: Sequelize.STRING,
      },
      status: {
        allowNull: false,
        defaultValue: 'active',
        type: Sequelize.STRING,
      },
      date: {
        allowNull: false,
        type: Sequelize.DATEONLY,
      },
      amount: {
        allowNull: false,
        type: Sequelize.DECIMAL(10, 2),
      },
      financeId: {
        allowNull: true,
        type: Sequelize.INTEGER,
        references: {
          model: 'Finances',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      financeCreatedByLedger: {
        allowNull: false,
        defaultValue: false,
        type: Sequelize.BOOLEAN,
      },
      category: {
        allowNull: true,
        type: Sequelize.STRING,
      },
      comment: {
        allowNull: true,
        type: Sequelize.TEXT,
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
      metadata: {
        allowNull: true,
        type: Sequelize.JSON,
      },
      isTraining: {
        allowNull: false,
        defaultValue: false,
        type: Sequelize.BOOLEAN,
      },
      trainingRole: {
        allowNull: true,
        type: Sequelize.STRING,
      },
      trainingAccountId: {
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

    await queryInterface.addIndex(
      'CorporateLedgerEntries',
      ['corporateClientId', 'status', 'date'],
      {
        name: 'corporate_ledger_client_status_date_idx',
      },
    );
    await queryInterface.addIndex('CorporateLedgerEntries', ['financeId'], {
      name: 'corporate_ledger_finance_idx',
    });
    await queryInterface.addIndex(
      'CorporateLedgerEntries',
      ['isTraining', 'trainingRole'],
      {
        name: 'corporate_ledger_training_idx',
      },
    );
  },

  async down(queryInterface) {
    await queryInterface.dropTable('CorporateLedgerEntries');
    await queryInterface.dropTable('CorporateClients');
  },
};
