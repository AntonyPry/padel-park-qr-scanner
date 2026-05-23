'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('PayrollPeriods', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER,
      },
      fromDate: {
        type: Sequelize.DATEONLY,
        allowNull: false,
      },
      toDate: {
        type: Sequelize.DATEONLY,
        allowNull: false,
      },
      status: {
        type: Sequelize.ENUM('draft', 'reviewed', 'approved', 'paid'),
        allowNull: false,
        defaultValue: 'draft',
      },
      note: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      snapshot: {
        type: Sequelize.JSON,
        allowNull: true,
      },
      reviewedByAccountId: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: {
          model: 'Accounts',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      reviewedAt: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      approvedByAccountId: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: {
          model: 'Accounts',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      approvedAt: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      paidByAccountId: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: {
          model: 'Accounts',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      paidAt: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      createdAt: {
        allowNull: false,
        type: Sequelize.DATE,
        defaultValue: Sequelize.fn('NOW'),
      },
      updatedAt: {
        allowNull: false,
        type: Sequelize.DATE,
        defaultValue: Sequelize.fn('NOW'),
      },
    });

    await queryInterface.addIndex('PayrollPeriods', ['fromDate', 'toDate'], {
      unique: true,
      name: 'payroll_periods_range_unique',
    });
    await queryInterface.addIndex('PayrollPeriods', ['status'], {
      name: 'payroll_periods_status_idx',
    });

    await queryInterface.createTable('FinanceChangeLogs', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER,
      },
      action: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      entityType: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      entityId: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      date: {
        type: Sequelize.DATEONLY,
        allowNull: true,
      },
      fromDate: {
        type: Sequelize.DATEONLY,
        allowNull: true,
      },
      toDate: {
        type: Sequelize.DATEONLY,
        allowNull: true,
      },
      accountId: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: {
          model: 'Accounts',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      role: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      reason: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      beforeData: {
        type: Sequelize.JSON,
        allowNull: true,
      },
      afterData: {
        type: Sequelize.JSON,
        allowNull: true,
      },
      createdAt: {
        allowNull: false,
        type: Sequelize.DATE,
        defaultValue: Sequelize.fn('NOW'),
      },
      updatedAt: {
        allowNull: false,
        type: Sequelize.DATE,
        defaultValue: Sequelize.fn('NOW'),
      },
    });

    await queryInterface.addIndex('FinanceChangeLogs', ['createdAt'], {
      name: 'finance_change_logs_created_at_idx',
    });
    await queryInterface.addIndex('FinanceChangeLogs', ['entityType', 'entityId'], {
      name: 'finance_change_logs_entity_idx',
    });
    await queryInterface.addIndex('FinanceChangeLogs', ['fromDate', 'toDate'], {
      name: 'finance_change_logs_range_idx',
    });

    await queryInterface.addColumn('Shifts', 'archivedAt', {
      type: Sequelize.DATE,
      allowNull: true,
    });
    await queryInterface.addColumn('Shifts', 'archivedByAccountId', {
      type: Sequelize.INTEGER,
      allowNull: true,
      references: {
        model: 'Accounts',
        key: 'id',
      },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    });
    await queryInterface.addColumn('Shifts', 'archiveReason', {
      type: Sequelize.TEXT,
      allowNull: true,
    });
    await queryInterface.addColumn('Finances', 'createdByAccountId', {
      type: Sequelize.INTEGER,
      allowNull: true,
      references: {
        model: 'Accounts',
        key: 'id',
      },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    });

    await queryInterface.addIndex('Shifts', ['archivedAt'], {
      name: 'shifts_archived_at_idx',
    });
    await queryInterface.addIndex('Finances', ['createdByAccountId'], {
      name: 'finances_created_by_account_idx',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('Finances', 'finances_created_by_account_idx');
    await queryInterface.removeIndex('Shifts', 'shifts_archived_at_idx');
    await queryInterface.removeColumn('Finances', 'createdByAccountId');
    await queryInterface.removeColumn('Shifts', 'archiveReason');
    await queryInterface.removeColumn('Shifts', 'archivedByAccountId');
    await queryInterface.removeColumn('Shifts', 'archivedAt');

    await queryInterface.removeIndex('FinanceChangeLogs', 'finance_change_logs_range_idx');
    await queryInterface.removeIndex('FinanceChangeLogs', 'finance_change_logs_entity_idx');
    await queryInterface.removeIndex('FinanceChangeLogs', 'finance_change_logs_created_at_idx');
    await queryInterface.dropTable('FinanceChangeLogs');

    await queryInterface.removeIndex('PayrollPeriods', 'payroll_periods_status_idx');
    await queryInterface.removeIndex('PayrollPeriods', 'payroll_periods_range_unique');
    await queryInterface.dropTable('PayrollPeriods');
  },
};
