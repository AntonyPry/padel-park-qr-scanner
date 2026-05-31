'use strict';

const TABLES = [
  'Users',
  'Visits',
  'Bookings',
  'BookingSeries',
  'Finances',
  'ClientBases',
  'CallTasks',
  'CallTaskClients',
  'CallTaskAttempts',
  'TrainingNotes',
];

async function addTrainingColumns(queryInterface, Sequelize, tableName) {
  await queryInterface.addColumn(tableName, 'isTraining', {
    type: Sequelize.BOOLEAN,
    allowNull: false,
    defaultValue: false,
  });
  await queryInterface.addColumn(tableName, 'trainingRole', {
    type: Sequelize.STRING,
    allowNull: true,
  });
  await queryInterface.addColumn(tableName, 'trainingAccountId', {
    type: Sequelize.INTEGER,
    allowNull: true,
    references: {
      model: 'Accounts',
      key: 'id',
    },
    onUpdate: 'CASCADE',
    onDelete: 'SET NULL',
  });
  await queryInterface.addIndex(tableName, ['isTraining', 'trainingRole'], {
    name: `${tableName}_training_scope_idx`,
  });
}

async function removeTrainingColumns(queryInterface, tableName) {
  await queryInterface.removeIndex(tableName, `${tableName}_training_scope_idx`);
  await queryInterface.removeColumn(tableName, 'trainingAccountId');
  await queryInterface.removeColumn(tableName, 'trainingRole');
  await queryInterface.removeColumn(tableName, 'isTraining');
}

module.exports = {
  async up(queryInterface, Sequelize) {
    for (const tableName of TABLES) {
      await addTrainingColumns(queryInterface, Sequelize, tableName);
    }
  },

  async down(queryInterface) {
    for (const tableName of [...TABLES].reverse()) {
      await removeTrainingColumns(queryInterface, tableName);
    }
  },
};
