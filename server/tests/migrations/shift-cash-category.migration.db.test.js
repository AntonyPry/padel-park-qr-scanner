const assert = require('node:assert/strict');
const { test } = require('node:test');
const db = require('../../models');
const createShiftCash = require('../../migrations/20260714100000-create-shift-cash');
const removeExpenseCategory = require('../../migrations/20260715190000-remove-shift-cash-expense-category');

function parseJson(value) {
  return typeof value === 'string' ? JSON.parse(value) : value;
}

async function loadExpense(sequelize) {
  const [expense] = await sequelize.query(
    'SELECT * FROM `ShiftCashExpenses` WHERE `id` = 51',
    { type: db.Sequelize.QueryTypes.SELECT },
  );
  return expense;
}

test('DB-backed category migration preserves sessions, expenses, attachments and Finance link through up/down', async () => {
  await db.sequelize.authenticate();

  const databaseName = `shift_cash_migration_${process.pid}_${Date.now()}`;
  let databaseCreated = false;
  let isolatedSequelize = null;

  try {
    await db.sequelize.query(
      `CREATE DATABASE \`${databaseName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    );
    databaseCreated = true;

    const config = db.sequelize.config;
    isolatedSequelize = new db.Sequelize(
      databaseName,
      config.username,
      config.password,
      {
        dialect: 'mysql',
        host: config.host,
        logging: false,
        port: config.port,
      },
    );
    await isolatedSequelize.authenticate();
    const queryInterface = isolatedSequelize.getQueryInterface();

    for (const table of ['Shifts', 'Accounts', 'Categories', 'Finances']) {
      await queryInterface.createTable(table, {
        id: {
          allowNull: false,
          primaryKey: true,
          type: db.Sequelize.INTEGER,
        },
      });
      await queryInterface.bulkInsert(table, [{ id: 1 }]);
    }

    await createShiftCash.up(queryInterface, db.Sequelize);

    const now = new Date();
    const attachment = {
      id: 'migration-attachment-1',
      mimeType: 'image/png',
      originalName: 'receipt.png',
      relativePath: 'shift-cash/51/migration-attachment-1.png',
      size: 321,
    };
    await queryInterface.bulkInsert('ShiftCashSessions', [
      {
        contextKey: 'production',
        createdAt: now,
        id: 41,
        isTraining: false,
        manualAdjustmentsSnapshot: 0,
        shiftId: 1,
        status: 'open',
        updatedAt: now,
      },
    ]);
    await queryInterface.bulkInsert('ShiftCashExpenses', [
      {
        amount: 900,
        attachments: JSON.stringify([attachment]),
        cashSessionId: 41,
        categoryId: 1,
        categoryName: 'Хозяйственные расходы',
        createdAt: now,
        description: 'Data-preserving migration fixture',
        financeId: 1,
        id: 51,
        isTraining: false,
        shiftId: 1,
        spentAt: now,
        status: 'active',
        updatedAt: now,
      },
    ]);

    await removeExpenseCategory.up(queryInterface);

    const columnsAfterUp = await queryInterface.describeTable('ShiftCashExpenses');
    assert.equal(columnsAfterUp.categoryId, undefined);
    assert.equal(columnsAfterUp.categoryName, undefined);
    const expenseAfterUp = await loadExpense(isolatedSequelize);
    assert.equal(expenseAfterUp.cashSessionId, 41);
    assert.equal(expenseAfterUp.financeId, 1);
    assert.deepEqual(parseJson(expenseAfterUp.attachments), [attachment]);
    assert.equal(
      await queryInterface.rawSelect('ShiftCashSessions', { where: { id: 41 } }, 'id'),
      41,
    );
    const referencesAfterUp = await queryInterface.getForeignKeyReferencesForTable(
      'ShiftCashExpenses',
    );
    assert.equal(
      referencesAfterUp.some((reference) => reference.columnName === 'cashSessionId'),
      true,
    );
    assert.equal(
      referencesAfterUp.some((reference) => reference.columnName === 'financeId'),
      true,
    );

    await removeExpenseCategory.down(queryInterface, db.Sequelize);

    const columnsAfterDown = await queryInterface.describeTable('ShiftCashExpenses');
    assert.ok(columnsAfterDown.categoryId);
    assert.ok(columnsAfterDown.categoryName);
    assert.equal(columnsAfterDown.categoryName.defaultValue, null);
    const expenseAfterDown = await loadExpense(isolatedSequelize);
    assert.equal(expenseAfterDown.id, 51);
    assert.equal(expenseAfterDown.cashSessionId, 41);
    assert.equal(expenseAfterDown.financeId, 1);
    assert.equal(expenseAfterDown.categoryId, null);
    assert.equal(expenseAfterDown.categoryName, 'Расходы из кассы');
    assert.deepEqual(parseJson(expenseAfterDown.attachments), [attachment]);

    await removeExpenseCategory.up(queryInterface);
    const expenseAfterReapply = await loadExpense(isolatedSequelize);
    assert.equal(expenseAfterReapply.id, 51);
    assert.equal(expenseAfterReapply.cashSessionId, 41);
    assert.equal(expenseAfterReapply.financeId, 1);
    assert.deepEqual(parseJson(expenseAfterReapply.attachments), [attachment]);
  } finally {
    if (isolatedSequelize) await isolatedSequelize.close();
    if (databaseCreated) {
      await db.sequelize.query(`DROP DATABASE IF EXISTS \`${databaseName}\``);
    }
  }
});
