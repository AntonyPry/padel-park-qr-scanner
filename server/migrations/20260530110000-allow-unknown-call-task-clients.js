'use strict';

async function dropUserForeignKeys(queryInterface) {
  if (queryInterface.sequelize.getDialect() !== 'mysql') return;

  const [rows] = await queryInterface.sequelize.query(`
    SELECT CONSTRAINT_NAME
    FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'CallTaskClients'
      AND COLUMN_NAME = 'userId'
      AND REFERENCED_TABLE_NAME = 'Users'
  `);

  for (const row of rows) {
    const constraintName = row.CONSTRAINT_NAME || row.constraint_name;
    if (!constraintName) continue;
    await queryInterface.sequelize.query(
      `ALTER TABLE CallTaskClients DROP FOREIGN KEY \`${constraintName}\``,
    );
  }
}

async function addUserForeignKey(queryInterface, onDelete) {
  if (queryInterface.sequelize.getDialect() !== 'mysql') return;

  await queryInterface.addConstraint('CallTaskClients', {
    fields: ['userId'],
    name: 'call_task_clients_user_id_fk',
    onDelete,
    onUpdate: 'CASCADE',
    references: {
      field: 'id',
      table: 'Users',
    },
    type: 'foreign key',
  });
}

module.exports = {
  async up(queryInterface, Sequelize) {
    await dropUserForeignKeys(queryInterface);
    await queryInterface.changeColumn('CallTaskClients', 'userId', {
      allowNull: true,
      type: Sequelize.INTEGER,
    });
    await addUserForeignKey(queryInterface, 'SET NULL');
  },

  async down(queryInterface, Sequelize) {
    const [[{ count }]] = await queryInterface.sequelize.query(
      'SELECT COUNT(*) AS count FROM CallTaskClients WHERE userId IS NULL',
    );
    if (Number(count) > 0) {
      throw new Error('Cannot make CallTaskClients.userId required while unknown call tasks exist');
    }

    await dropUserForeignKeys(queryInterface);
    await queryInterface.changeColumn('CallTaskClients', 'userId', {
      allowNull: false,
      type: Sequelize.INTEGER,
    });
    await addUserForeignKey(queryInterface, 'CASCADE');
  },
};
