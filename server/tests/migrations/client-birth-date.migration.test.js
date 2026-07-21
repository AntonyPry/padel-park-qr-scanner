const assert = require('node:assert/strict');
const test = require('node:test');
const migration = require('../../migrations/20260721100000-add-client-birth-date');

test('client birth date migration is idempotent and reversible', async () => {
  const calls = [];
  let hasBirthDate = false;
  const queryInterface = {
    async addColumn(table, column, definition) {
      calls.push({ action: 'add', column, definition, table });
      hasBirthDate = true;
    },
    async describeTable(table) {
      assert.equal(table, 'Users');
      return hasBirthDate ? { birthDate: {} } : {};
    },
    async removeColumn(table, column) {
      calls.push({ action: 'remove', column, table });
      hasBirthDate = false;
    },
  };
  const Sequelize = { DATEONLY: Symbol('DATEONLY') };

  await migration.up(queryInterface, Sequelize);
  await migration.up(queryInterface, Sequelize);
  await migration.down(queryInterface, Sequelize);
  await migration.down(queryInterface, Sequelize);

  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0], {
    action: 'add',
    column: 'birthDate',
    definition: { allowNull: true, type: Sequelize.DATEONLY },
    table: 'Users',
  });
  assert.deepEqual(calls[1], {
    action: 'remove',
    column: 'birthDate',
    table: 'Users',
  });
});
