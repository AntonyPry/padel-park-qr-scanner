const assert = require('node:assert/strict');
const { test } = require('node:test');
const db = require('../../models');
const shiftCashMigration = require('../../migrations/20260714100000-create-shift-cash');

function hasTable(tables, tableName) {
  return tables.some((table) => {
    if (typeof table === 'string') return table === tableName;
    return table?.tableName === tableName;
  });
}

async function assertCurrentSchema(queryInterface) {
  const tables = await queryInterface.showAllTables();
  assert.equal(hasTable(tables, 'ShiftCashSessions'), true);
  assert.equal(hasTable(tables, 'ShiftCashExpenses'), true);

  const expenseColumns = await queryInterface.describeTable('ShiftCashExpenses');
  assert.equal(expenseColumns.categoryId, undefined);
  assert.equal(expenseColumns.categoryName, undefined);
  assert.ok(expenseColumns.attachments);
  assert.ok(expenseColumns.financeId);

  const references = await queryInterface.getForeignKeyReferencesForTable(
    'ShiftCashExpenses',
  );
  assert.equal(
    references.some((reference) => reference.columnName === 'cashSessionId'),
    true,
  );
  assert.equal(
    references.some((reference) => reference.columnName === 'financeId'),
    true,
  );
}

test('DB-backed source migration recreates clean Shift Cash schema through up/down/up', async () => {
  await db.sequelize.authenticate();

  const databaseName = `shift_cash_schema_${process.pid}_${Date.now()}`;
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

    for (const table of ['Shifts', 'Accounts', 'Finances']) {
      await queryInterface.createTable(table, {
        id: {
          allowNull: false,
          primaryKey: true,
          type: db.Sequelize.INTEGER,
        },
      });
    }

    await shiftCashMigration.up(queryInterface, db.Sequelize);
    await assertCurrentSchema(queryInterface);

    await shiftCashMigration.down(queryInterface);
    const tablesAfterDown = await queryInterface.showAllTables();
    assert.equal(hasTable(tablesAfterDown, 'ShiftCashSessions'), false);
    assert.equal(hasTable(tablesAfterDown, 'ShiftCashExpenses'), false);

    await shiftCashMigration.up(queryInterface, db.Sequelize);
    await assertCurrentSchema(queryInterface);
  } finally {
    if (isolatedSequelize) await isolatedSequelize.close();
    if (databaseCreated) {
      await db.sequelize.query(`DROP DATABASE IF EXISTS \`${databaseName}\``);
    }
  }
});
