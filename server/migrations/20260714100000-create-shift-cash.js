'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('ShiftCashSessions', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER,
      },
      shiftId: {
        allowNull: false,
        type: Sequelize.INTEGER,
        references: { model: 'Shifts', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      contextKey: {
        allowNull: false,
        type: Sequelize.STRING(191),
      },
      status: {
        allowNull: false,
        defaultValue: 'open',
        type: Sequelize.STRING,
      },
      openingBanknotes: { allowNull: true, type: Sequelize.DECIMAL(12, 2) },
      openingCoins: { allowNull: true, type: Sequelize.DECIMAL(12, 2) },
      openingComment: { allowNull: true, type: Sequelize.TEXT },
      openingRecordedAt: { allowNull: true, type: Sequelize.DATE },
      openingRecordedByAccountId: {
        allowNull: true,
        type: Sequelize.INTEGER,
        references: { model: 'Accounts', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      closingBanknotes: { allowNull: true, type: Sequelize.DECIMAL(12, 2) },
      closingCoins: { allowNull: true, type: Sequelize.DECIMAL(12, 2) },
      closingComment: { allowNull: true, type: Sequelize.TEXT },
      closingRecordedAt: { allowNull: true, type: Sequelize.DATE },
      closingRecordedByAccountId: {
        allowNull: true,
        type: Sequelize.INTEGER,
        references: { model: 'Accounts', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      cashSalesSnapshot: { allowNull: true, type: Sequelize.DECIMAL(12, 2) },
      expensesSnapshot: { allowNull: true, type: Sequelize.DECIMAL(12, 2) },
      manualAdjustmentsSnapshot: {
        allowNull: false,
        defaultValue: 0,
        type: Sequelize.DECIMAL(12, 2),
      },
      expectedClosingCash: { allowNull: true, type: Sequelize.DECIMAL(12, 2) },
      variance: { allowNull: true, type: Sequelize.DECIMAL(12, 2) },
      isTraining: {
        allowNull: false,
        defaultValue: false,
        type: Sequelize.BOOLEAN,
      },
      trainingRole: { allowNull: true, type: Sequelize.STRING },
      trainingAccountId: {
        allowNull: true,
        type: Sequelize.INTEGER,
        references: { model: 'Accounts', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      createdAt: { allowNull: false, type: Sequelize.DATE },
      updatedAt: { allowNull: false, type: Sequelize.DATE },
    });

    await queryInterface.addIndex('ShiftCashSessions', ['shiftId', 'contextKey'], {
      name: 'shift_cash_sessions_shift_context_unique',
      unique: true,
    });
    await queryInterface.addIndex('ShiftCashSessions', ['shiftId', 'status'], {
      name: 'shift_cash_sessions_shift_status_idx',
    });
    await queryInterface.addIndex(
      'ShiftCashSessions',
      ['isTraining', 'trainingRole', 'trainingAccountId'],
      { name: 'shift_cash_sessions_training_idx' },
    );

    await queryInterface.createTable('ShiftCashExpenses', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER,
      },
      shiftId: {
        allowNull: false,
        type: Sequelize.INTEGER,
        references: { model: 'Shifts', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      cashSessionId: {
        allowNull: false,
        type: Sequelize.INTEGER,
        references: { model: 'ShiftCashSessions', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      amount: { allowNull: false, type: Sequelize.DECIMAL(12, 2) },
      description: { allowNull: false, type: Sequelize.TEXT },
      spentAt: { allowNull: false, type: Sequelize.DATE },
      createdByAccountId: {
        allowNull: true,
        type: Sequelize.INTEGER,
        references: { model: 'Accounts', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      status: {
        allowNull: false,
        defaultValue: 'active',
        type: Sequelize.STRING,
      },
      canceledAt: { allowNull: true, type: Sequelize.DATE },
      canceledByAccountId: {
        allowNull: true,
        type: Sequelize.INTEGER,
        references: { model: 'Accounts', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      cancelReason: { allowNull: true, type: Sequelize.TEXT },
      financeId: {
        allowNull: true,
        type: Sequelize.INTEGER,
        references: { model: 'Finances', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      attachments: { allowNull: false, defaultValue: [], type: Sequelize.JSON },
      isTraining: {
        allowNull: false,
        defaultValue: false,
        type: Sequelize.BOOLEAN,
      },
      trainingRole: { allowNull: true, type: Sequelize.STRING },
      trainingAccountId: {
        allowNull: true,
        type: Sequelize.INTEGER,
        references: { model: 'Accounts', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      createdAt: { allowNull: false, type: Sequelize.DATE },
      updatedAt: { allowNull: false, type: Sequelize.DATE },
    });

    await queryInterface.addIndex('ShiftCashExpenses', ['shiftId', 'status'], {
      name: 'shift_cash_expenses_shift_status_idx',
    });
    await queryInterface.addIndex('ShiftCashExpenses', ['cashSessionId'], {
      name: 'shift_cash_expenses_session_idx',
    });
    await queryInterface.addIndex('ShiftCashExpenses', ['spentAt'], {
      name: 'shift_cash_expenses_spent_at_idx',
    });
    await queryInterface.addIndex('ShiftCashExpenses', ['financeId'], {
      name: 'shift_cash_expenses_finance_idx',
    });
    await queryInterface.addIndex(
      'ShiftCashExpenses',
      ['isTraining', 'trainingRole', 'trainingAccountId'],
      { name: 'shift_cash_expenses_training_idx' },
    );
  },

  async down(queryInterface) {
    await queryInterface.dropTable('ShiftCashExpenses');
    await queryInterface.dropTable('ShiftCashSessions');
  },
};
